import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { hermesPaymentsResponseSchema, hermesStatusResponseSchema } from "@funnel/shared";
import { hashPassword } from "@/admin/password";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  businessConnections,
  events,
  hermesPayments,
  integrationHeartbeats,
  leads,
  segmentRuns,
  users,
} from "@/db/schema";
import { resetEnv } from "@/env";
import { clickCountsAsAdminContact, HERMES_HEARTBEAT_TTL_MS } from "@/funnel/adminContact";
import { setTestEnv } from "@/test/env";
import { isolatedDatabase } from "@/test/isolatedDb";
import { ensureActiveTestVideo } from "@/test/videos";
import { signHermesPayload } from "./signature";

const isolatedDb = isolatedDatabase("vf_hermes");
const testDbUrl = isolatedDb.url;
const HERMES_SECRET = "hermes-test-secret-0123456789abcdef0123456789";
const ADMIN_TELEGRAM_ID = 777_000_001;
const TEST_ADMIN_PASSWORD = "test-hermes-admin-password-2026";

vi.mock("@/leads/notifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/leads/notifier")>()),
  kickLeadNotifier: () => {},
}));

describe.skipIf(!testDbUrl)("Hermes mirror integration", () => {
  let createApp: typeof import("@/app").createApp;
  let adminSessionCookie: string;

  beforeAll(async () => {
    await isolatedDb.create();
    const passwordHash = await hashPassword(TEST_ADMIN_PASSWORD);
    setTestEnv({
      DATABASE_URL: testDbUrl!,
      ADMIN_PASSWORD_HASH: passwordHash,
      HERMES_SYNC_SECRET: HERMES_SECRET,
    });
    resetEnv();
    await runMigrations(testDbUrl!);
    await ensureActiveTestVideo();

    const appModule = await import("@/app");
    createApp = appModule.createApp;

    const login = await createApp().request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.42" },
      body: JSON.stringify({ username: "admin", password: TEST_ADMIN_PASSWORD }),
    });
    expect(login.status).toBe(200);
    adminSessionCookie = login.headers.get("set-cookie")!.match(/admin_session=[^;]+/)![0];
  });

  beforeEach(async () => {
    process.env.HERMES_SYNC_SECRET = HERMES_SECRET;
    resetEnv();
    await db().delete(hermesPayments);
    await db().delete(integrationHeartbeats);
    await db().delete(businessConnections);
    await db().delete(events);
    await db().delete(leads);
    await db().delete(segmentRuns);
    await db().delete(users);
  });

  afterAll(async () => {
    await closeDb();
    await isolatedDb.drop();
  });

  function postHermes(body: unknown, opts?: { secret?: string; timestamp?: string; signature?: string; rawBody?: string }) {
    const raw = opts?.rawBody ?? JSON.stringify(body);
    const ts = opts?.timestamp ?? String(Math.floor(Date.now() / 1000));
    const sig = opts?.signature ?? signHermesPayload(opts?.secret ?? HERMES_SECRET, ts, raw);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ts !== "") headers["x-hermes-timestamp"] = ts;
    if (sig !== "") headers["x-hermes-signature"] = sig;
    return createApp().request("/integrations/hermes/events", {
      method: "POST",
      headers,
      body: raw,
    });
  }

  it("rejects unsigned/badly signed requests with 401 and returns 404 when secret is unset", async () => {
    const app = createApp();
    const payload = { adminTelegramId: ADMIN_TELEGRAM_ID, events: [] };

    const unsigned = await app.request("/integrations/hermes/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ error: "unauthorized" });

    const badSig = await postHermes(payload, { secret: "different-secret-0123456789abcdef012345" });
    expect(badSig.status).toBe(401);
    expect(await badSig.json()).toEqual({ error: "unauthorized" });

    const invalidSchema = await postHermes({ adminTelegramId: -1, events: [] });
    expect(invalidSchema.status).toBe(400);
    expect(await invalidSchema.json()).toEqual({ error: "invalid_request" });

    const oversizedBody = "x".repeat(1024 * 1024 + 10);
    const oversized = await postHermes(null, { rawBody: oversizedBody });
    expect(oversized.status).toBe(413);

    delete process.env.HERMES_SYNC_SECRET;
    resetEnv();
    const disabled = await postHermes(payload);
    expect(disabled.status).toBe(404);
    expect(await disabled.json()).toEqual({ error: "not_found" });
  });

  it("applies inbound/outbound messages, logs via hermes, and skips unknown or self chats", async () => {
    const customerTgId = 800_000_001;
    const t0 = new Date("2026-11-20T10:00:00.000Z");
    const t1 = "2026-11-20T10:05:00+05:00";
    const t2 = "2026-11-20T10:10:00+05:00";
    const t3 = "2026-11-20T10:15:00+05:00";

    const [customer] = await db()
      .insert(users)
      .values({ telegramId: customerTgId, name: "Customer One", registeredAt: t0, offerWatchedAt: t0 })
      .returning();
    await db().insert(segmentRuns).values({ userId: customer.id, segment: "C", enteredAt: t0 });

    // Inbound message from known user + unknown chat + self chat
    const res1 = await postHermes({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      events: [
        { type: "message", chatId: customerTgId, messageId: 10, direction: "in", at: t1 },
        { type: "message", chatId: 999_999_999, messageId: 11, direction: "in", at: t1 },
        { type: "message", chatId: ADMIN_TELEGRAM_ID, messageId: 12, direction: "in", at: t1 },
      ],
    });
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual({
      ok: true,
      applied: { messages: 1, payments: 0, heartbeats: 0 },
      skipped: 2,
    });

    const [afterFirst] = await db().select().from(users).where(eq(users.id, customer.id));
    expect(afterFirst.wroteAdminAt).toEqual(new Date(t1));
    expect(afterFirst.wroteAdminBy).toBe(ADMIN_TELEGRAM_ID);
    expect(afterFirst.lastAdminChatAt).toEqual(new Date(t1));

    const chatEvents1 = await db()
      .select()
      .from(events)
      .where(eq(events.userId, customer.id))
      .orderBy(asc(events.id));
    const adminChats1 = chatEvents1.filter((e) => e.type === "admin_chat");
    expect(adminChats1).toHaveLength(1);
    expect(adminChats1[0].meta).toMatchObject({ via: "hermes", by: ADMIN_TELEGRAM_ID });

    // Second inbound message at later timestamp: no second admin_chat event, bumps lastAdminChatAt only
    const res2 = await postHermes({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      events: [{ type: "message", chatId: customerTgId, messageId: 13, direction: "in", at: t2 }],
    });
    expect(res2.status).toBe(200);
    const [afterSecond] = await db().select().from(users).where(eq(users.id, customer.id));
    expect(afterSecond.wroteAdminAt).toEqual(new Date(t1));
    expect(afterSecond.lastAdminChatAt).toEqual(new Date(t2));
    const adminChats2 = (await db().select().from(events).where(eq(events.userId, customer.id))).filter(
      (e) => e.type === "admin_chat",
    );
    expect(adminChats2).toHaveLength(1);

    // Outbound message for a second user who hasn't written yet: only bumps lastAdminChatAt
    const customer2TgId = 800_000_002;
    const [customer2] = await db()
      .insert(users)
      .values({ telegramId: customer2TgId, registeredAt: t0 })
      .returning();

    const res3 = await postHermes({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      events: [
        { type: "message", chatId: customer2TgId, messageId: 14, direction: "out", at: t3 },
        { type: "message", chatId: 888_888_888, messageId: 15, direction: "out", at: t3 },
      ],
    });
    expect(res3.status).toBe(200);
    expect(await res3.json()).toEqual({
      ok: true,
      applied: { messages: 1, payments: 0, heartbeats: 0 },
      skipped: 1,
    });

    const [afterOut] = await db().select().from(users).where(eq(users.id, customer2.id));
    expect(afterOut.wroteAdminAt).toBeNull();
    expect(afterOut.lastAdminChatAt).toEqual(new Date(t3));
  });

  it("mirrors payments, derives kind, triggers purchase side effects for paid, and upserts on replay", async () => {
    const paidTgId = 800_000_010;
    const depositTgId = 800_000_011;
    const unknownTgId = 800_000_099;

    const [paidUser] = await db()
      .insert(users)
      .values({ telegramId: paidTgId, name: "Paid Student", registeredAt: new Date("2026-11-19T10:00:00Z") })
      .returning();
    const [lead] = await db()
      .insert(leads)
      .values({
        source: "bot",
        userId: paidUser.id,
        name: "Paid Student",
        phone: "+998901234567",
      })
      .returning();

    const [depositUser] = await db()
      .insert(users)
      .values({ telegramId: depositTgId, firstName: "DepositOnly", registeredAt: new Date("2026-11-19T10:00:00Z") })
      .returning();

    const res = await postHermes({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      events: [
        {
          type: "payment",
          hermesId: 5001,
          telegramId: paidTgId,
          payDate: "2026-11-20",
          amountUzs: 1_500_000,
          monthNo: 1,
          tariff: "Pro",
          confidence: "partial",
          source: "receipt_ai",
          createdAt: "2026-11-20T09:00:00+05:00",
        },
        {
          type: "payment",
          hermesId: 5002,
          telegramId: depositTgId,
          payDate: "2026-11-20",
          amountUzs: 200_000,
          monthNo: null,
          tariff: "Standard",
          confidence: "deposit",
          source: "receipt_ai",
          createdAt: "2026-11-20T09:30:00+05:00",
        },
        {
          type: "payment",
          hermesId: 5003,
          telegramId: unknownTgId,
          payDate: null,
          amountUzs: 50_000,
          monthNo: null,
          tariff: null,
          confidence: "unclear",
          source: "receipt_ai",
          createdAt: "2026-11-20T10:00:00+05:00",
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      applied: { messages: 0, payments: 3, heartbeats: 0 },
      skipped: 0,
    });

    const rows = await db().select().from(hermesPayments).orderBy(asc(hermesPayments.hermesId));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ hermesId: 5001, userId: paidUser.id, kind: "paid", amountUzs: 1_500_000 });
    expect(rows[1]).toMatchObject({ hermesId: 5002, userId: depositUser.id, kind: "deposit", amountUzs: 200_000 });
    expect(rows[2]).toMatchObject({ hermesId: 5003, userId: null, kind: "ignored", amountUzs: 50_000 });

    const [updatedPaidUser] = await db().select().from(users).where(eq(users.id, paidUser.id));
    expect(updatedPaidUser.paidAt).toEqual(new Date("2026-11-20T12:00:00+05:00"));
    const [updatedLead] = await db().select().from(leads).where(eq(leads.id, lead.id));
    expect(updatedLead.outcome).toBe("won");

    const [updatedDepositUser] = await db().select().from(users).where(eq(users.id, depositUser.id));
    expect(updatedDepositUser.paidAt).toBeNull();

    // Re-send same hermesId 5002 with changed confidence -> updates row without duplicate
    const resUpsert = await postHermes({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      events: [
        {
          type: "payment",
          hermesId: 5002,
          telegramId: depositTgId,
          payDate: "2026-11-21",
          amountUzs: 1_200_000,
          monthNo: 1,
          tariff: "Standard",
          confidence: "partial_complete",
          source: "admin",
          createdAt: "2026-11-20T09:30:00+05:00",
        },
      ],
    });
    expect(resUpsert.status).toBe(200);
    const afterUpsert = await db().select().from(hermesPayments).orderBy(asc(hermesPayments.hermesId));
    expect(afterUpsert).toHaveLength(3);
    expect(afterUpsert[1]).toMatchObject({
      hermesId: 5002,
      kind: "paid",
      confidence: "partial_complete",
      amountUzs: 1_200_000,
      payDate: "2026-11-21",
    });
    const [depositUserNowPaid] = await db().select().from(users).where(eq(users.id, depositUser.id));
    expect(depositUserNowPaid.paidAt).toEqual(new Date("2026-11-21T12:00:00+05:00"));
  });

  it("updates clickCountsAsAdminContact based on Hermes heartbeat freshness", async () => {
    expect(HERMES_HEARTBEAT_TTL_MS).toBe(10 * 60_000);
    expect(await clickCountsAsAdminContact()).toBe(true);

    const res = await postHermes({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      events: [{ type: "heartbeat", at: "2026-11-20T12:00:00+05:00" }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      applied: { messages: 0, payments: 0, heartbeats: 1 },
      skipped: 0,
    });

    expect(await clickCountsAsAdminContact()).toBe(false);

    // Move last_seen_at 11 minutes into the past -> clicks count again
    await db()
      .update(integrationHeartbeats)
      .set({ lastSeenAt: sql`now() - interval '11 minutes'` })
      .where(eq(integrationHeartbeats.name, "hermes"));

    expect(await clickCountsAsAdminContact()).toBe(true);
  });

  it("protects /admin/hermes/status and /admin/hermes/payments with admin auth and returns expected shapes", async () => {
    const app = createApp();

    const unauthStatus = await app.request("/admin/hermes/status");
    expect(unauthStatus.status).toBe(401);
    const unauthPayments = await app.request("/admin/hermes/payments");
    expect(unauthPayments.status).toBe(401);

    const [user] = await db()
      .insert(users)
      .values({ telegramId: 800_000_050, name: "Malika", registeredAt: new Date("2026-11-20T08:00:00Z") })
      .returning();

    await postHermes({
      adminTelegramId: ADMIN_TELEGRAM_ID,
      events: [
        {
          type: "payment",
          hermesId: 6001,
          telegramId: 800_000_050,
          payDate: "2026-11-19",
          amountUzs: 1_000_000,
          monthNo: 1,
          tariff: "Basic",
          confidence: "first",
          source: "ai",
          createdAt: "2026-11-19T12:00:00+05:00",
        },
        {
          type: "payment",
          hermesId: 6002,
          telegramId: 800_000_051,
          payDate: "2026-11-20",
          amountUzs: 300_000,
          monthNo: null,
          tariff: "Basic",
          confidence: "deposit",
          source: "ai",
          createdAt: "2026-11-20T12:00:00+05:00",
        },
        {
          type: "payment",
          hermesId: 6003,
          telegramId: 800_000_052,
          payDate: null,
          amountUzs: null,
          monthNo: null,
          tariff: null,
          confidence: "not_receipt",
          source: null,
          createdAt: "2026-11-21T08:00:00+05:00",
        },
      ],
    });

    const statusRes = await app.request("/admin/hermes/status", {
      headers: { cookie: adminSessionCookie },
    });
    expect(statusRes.status).toBe(200);
    const statusJson = hermesStatusResponseSchema.parse(await statusRes.json());
    expect(statusJson.configured).toBe(true);
    expect(statusJson.live).toBe(true);
    expect(statusJson.lastSeenAt).not.toBeNull();

    const paymentsRes = await app.request("/admin/hermes/payments", {
      headers: { cookie: adminSessionCookie },
    });
    expect(paymentsRes.status).toBe(200);
    const paymentsJson = hermesPaymentsResponseSchema.parse(await paymentsRes.json());
    expect(paymentsJson.totals).toEqual({
      paid: { count: 1, amountUzs: 1_000_000 },
      deposit: { count: 1, amountUzs: 300_000 },
      ignored: { count: 1 },
    });
    // Ordered by coalesce(pay_date, hermes_created_at::date) desc, hermes_id desc -> 6003 (2026-11-21), 6002 (2026-11-20), 6001 (2026-11-19)
    expect(paymentsJson.items.map((i) => i.hermesId)).toEqual([6003, 6002, 6001]);
    expect(paymentsJson.items[2]).toMatchObject({
      hermesId: 6001,
      userId: user.id,
      userName: "Malika",
      kind: "paid",
    });

    const paidOnlyRes = await app.request("/admin/hermes/payments?kind=paid&limit=10", {
      headers: { cookie: adminSessionCookie },
    });
    expect(paidOnlyRes.status).toBe(200);
    const paidOnlyJson = hermesPaymentsResponseSchema.parse(await paidOnlyRes.json());
    expect(paidOnlyJson.items).toHaveLength(1);
    expect(paidOnlyJson.items[0].hermesId).toBe(6001);
  });
});
