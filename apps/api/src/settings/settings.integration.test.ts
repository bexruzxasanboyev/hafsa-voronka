import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/admin/password";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  DEFAULT_MESSAGE_CAPS,
  DEFAULT_NIGHT_RESTRICTION_ENABLED,
  DEFAULT_SEGMENT_LOOPS,
  businessConnectionsResponseSchema,
  businessConnectionItemSchema,
} from "@funnel/shared";
import { businessConnections, settings, users } from "@/db/schema";
import { isolatedDatabase } from "@/test/isolatedDb";
import { setTestEnv } from "@/test/env";

const database = isolatedDatabase("vf_settings");
const PASSWORD = "settings-admin-password";

describe.skipIf(!database.url)("Admin settings", () => {
  let app: ReturnType<typeof import("@/app").createApp>;
  let cookie: string;

  beforeAll(async () => {
    await database.create();
    setTestEnv({
      DATABASE_URL: database.url!,
      ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
    });
    await runMigrations(database.url!);
    app = (await import("@/app")).createApp();

    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    cookie = login.headers.get("set-cookie")!.split(";")[0];
  });

  afterAll(async () => {
    await closeDb();
    await database.drop();
  });

  const put = (body: unknown) =>
    app.request("/admin/settings", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("rejects unauthenticated requests", async () => {
    expect((await app.request("/admin/settings")).status).toBe(401);
    const res = await app.request("/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ linkTtlHours: 48 }),
    });
    expect(res.status).toBe(401);
  });

  it("returns the default link TTL", async () => {
    const res = await app.request("/admin/settings", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      linkTtlHours: 24,
      messageCaps: DEFAULT_MESSAGE_CAPS,
      chatCleanupHours: 24,
      nightRestrictionEnabled: DEFAULT_NIGHT_RESTRICTION_ENABLED,
      segmentLoops: DEFAULT_SEGMENT_LOOPS,
    });
  });

  it("rejects out-of-range and non-numeric values", async () => {
    for (const body of [{ linkTtlHours: 0 }, { linkTtlHours: 721 }, { linkTtlHours: "abc" }, { linkTtlHours: 1.5 }, {}, "not json"]) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("saves the TTL and applies it to users registered afterwards", async () => {
    const saved = await put({ linkTtlHours: 48 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      linkTtlHours: 48,
      messageCaps: DEFAULT_MESSAGE_CAPS,
      chatCleanupHours: 24,
      nightRestrictionEnabled: DEFAULT_NIGHT_RESTRICTION_ENABLED,
      segmentLoops: DEFAULT_SEGMENT_LOOPS,
    });

    const res = await app.request("/admin/settings", { headers: { cookie } });
    expect(await res.json()).toEqual({
      linkTtlHours: 48,
      messageCaps: DEFAULT_MESSAGE_CAPS,
      chatCleanupHours: 24,
      nightRestrictionEnabled: DEFAULT_NIGHT_RESTRICTION_ENABLED,
      segmentLoops: DEFAULT_SEGMENT_LOOPS,
    });

    const { linkTtlHours } = await import("./service");
    expect(await linkTtlHours()).toBe(48);

    const { markRegistered } = await import("@/funnel/users");
    const [created] = await db().insert(users).values({ telegramId: 7_100_001, firstName: "Ttl" }).returning();
    await markRegistered(created.id, { name: "Ttl User", phone: "+998901234567", phoneVerified: true });
    const [registered] = await db().select().from(users).where(eq(users.id, created.id));
    expect(registered.linkExpiresAt!.getTime() - registered.registeredAt!.getTime()).toBe(48 * 3_600_000);
  });

  it("saves per-audience message caps without touching the TTL", async () => {
    const caps = { A: { daily: 8, total: null }, B: { daily: 3, total: 6 }, C: { daily: 10, total: 20 }, E: { daily: 2, total: 4 } };
    const saved = await put({ messageCaps: caps });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      linkTtlHours: 48,
      messageCaps: caps,
      chatCleanupHours: 24,
      nightRestrictionEnabled: DEFAULT_NIGHT_RESTRICTION_ENABLED,
      segmentLoops: DEFAULT_SEGMENT_LOOPS,
    });
    const { messageCaps } = await import("./service");
    expect(await messageCaps()).toEqual(caps);
  });

  it("upgrades legacy message caps rows missing segment E with defaults", async () => {
    const legacy = { A: { daily: 7, total: null }, B: { daily: 3, total: 6 }, C: { daily: 9, total: 15 } };
    await db()
      .insert(settings)
      .values({ key: "MESSAGE_CAPS", value: JSON.stringify(legacy) })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(legacy), updatedAt: new Date() } });
    const { invalidateSettings } = await import("./service");
    invalidateSettings();

    const res = await app.request("/admin/settings", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messageCaps: Record<string, unknown> };
    expect(body.messageCaps).toEqual({
      ...legacy,
      E: DEFAULT_MESSAGE_CAPS.E,
    });
  });

  it("lists and approves or revokes Telegram Business connections", async () => {
    expect((await app.request("/admin/settings/business-connections")).status).toBe(401);
    expect(
      (
        await app.request("/admin/settings/business-connections/missing", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isApproved: true }),
        })
      ).status,
    ).toBe(401);

    await db().insert(businessConnections).values([
      {
        id: "bc_old",
        userTelegramId: 88001,
        userChatId: 88001,
        username: "old_seller",
        firstName: "Old",
        lastName: null,
        canReply: false,
        isEnabled: true,
        isApproved: true,
        connectedAt: new Date("2026-05-01T10:00:00.000Z"),
        updatedAt: new Date("2026-05-01T10:00:00.000Z"),
      },
      {
        id: "bc_new",
        userTelegramId: 88002,
        userChatId: 88002,
        username: "new_seller",
        firstName: "New",
        lastName: "Seller",
        canReply: true,
        isEnabled: true,
        isApproved: false,
        connectedAt: new Date("2026-05-02T10:00:00.000Z"),
        updatedAt: new Date("2026-05-02T10:00:00.000Z"),
      },
    ]);

    const listRes = await app.request("/admin/settings/business-connections", { headers: { cookie } });
    expect(listRes.status).toBe(200);
    const listBody = businessConnectionsResponseSchema.parse(await listRes.json());
    expect(listBody.botUsername).toBe("test_bot");
    expect(listBody.items.map((item) => item.id)).toEqual(["bc_new", "bc_old"]);
    expect(listBody.items[0]).toMatchObject({
      id: "bc_new",
      userTelegramId: 88002,
      username: "new_seller",
      firstName: "New",
      lastName: "Seller",
      canReply: true,
      isEnabled: true,
      isApproved: false,
    });

    const approveRes = await app.request("/admin/settings/business-connections/bc_new", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ isApproved: true }),
    });
    expect(approveRes.status).toBe(200);
    const approvedBody = (await approveRes.json()) as { item: unknown };
    const approvedItem = businessConnectionItemSchema.parse(approvedBody.item);
    expect(approvedItem.isApproved).toBe(true);

    const revokeRes = await app.request("/admin/settings/business-connections/bc_new", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ isApproved: false }),
    });
    expect(revokeRes.status).toBe(200);
    const revokedBody = (await revokeRes.json()) as { item: unknown };
    expect(businessConnectionItemSchema.parse(revokedBody.item).isApproved).toBe(false);

    const invalidRes = await app.request("/admin/settings/business-connections/bc_new", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ isApproved: "yes" }),
    });
    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toEqual({ error: "invalid_request" });

    const missingRes = await app.request("/admin/settings/business-connections/non_existent_id", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ isApproved: true }),
    });
    expect(missingRes.status).toBe(404);
    expect(await missingRes.json()).toEqual({ error: "not_found" });
  });

  it("saves the chat cleanup delay and rejects values outside the offered choices", async () => {
    const saved = await put({ chatCleanupHours: 1 });
    expect(saved.status).toBe(200);
    expect((await saved.json()).chatCleanupHours).toBe(1);
    const { chatCleanupHours } = await import("./service");
    expect(await chatCleanupHours()).toBe(1);

    for (const value of [0, 2, 48, 1.5, "1"]) {
      expect((await put({ chatCleanupHours: value })).status).toBe(400);
    }
  });

  it("rejects caps above the daily ceiling or below one", async () => {
    const valid = DEFAULT_MESSAGE_CAPS;
    for (const B of [{ daily: 11, total: 7 }, { daily: 0, total: 7 }, { daily: 4, total: 0 }, { daily: 4 }]) {
      const res = await put({ messageCaps: { ...valid, B } });
      expect(res.status).toBe(400);
    }
  });

  it("saves night restriction and segment loops and kicks the dispatcher when changed", async () => {
    const dispatch = await import("@/messages/dispatch");
    const kickSpy = vi.spyOn(dispatch, "kickMessageDispatcher").mockImplementation(() => {});
    try {
      const unchanged = await put({ linkTtlHours: 24 });
      expect(unchanged.status).toBe(200);
      expect(kickSpy).not.toHaveBeenCalled();

      const nightSaved = await put({ nightRestrictionEnabled: true });
      expect(nightSaved.status).toBe(200);
      expect((await nightSaved.json()).nightRestrictionEnabled).toBe(true);
      expect(kickSpy).toHaveBeenCalledTimes(1);

      const loops = { A: true, B: false, C: true, E: false };
      const loopsSaved = await put({ segmentLoops: loops });
      expect(loopsSaved.status).toBe(200);
      expect((await loopsSaved.json()).segmentLoops).toEqual(loops);
      expect(kickSpy).toHaveBeenCalledTimes(2);

      const { nightRestrictionEnabled, segmentLoops } = await import("./service");
      expect(await nightRestrictionEnabled()).toBe(true);
      expect(await segmentLoops()).toEqual(loops);

      expect((await put({ nightRestrictionEnabled: "true" })).status).toBe(400);
      expect((await put({ segmentLoops: { A: true } })).status).toBe(400);
    } finally {
      kickSpy.mockRestore();
    }
  });
});
