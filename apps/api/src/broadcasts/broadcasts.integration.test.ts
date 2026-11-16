import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { Bot } from "grammy";
import type { BroadcastAudience, FunnelSegment } from "@funnel/shared";
import { hashPassword } from "@/admin/password";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  events,
  leads,
  scheduledBroadcastRecipients,
  scheduledBroadcasts,
  segmentRuns,
  users,
} from "@/db/schema";
import { setTestEnv } from "@/test/env";
import { isolatedDatabase } from "@/test/isolatedDb";

const isolatedDb = isolatedDatabase("vf_broadcasts");
const ADMIN_ID = 555_001;
const TEST_PASSWORD = "broadcasts-admin-password-2026";
const LEADS_CHAT_ID = "-1001234567899";
const LEADS_THREAD_ID = 9;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const kickSpy = vi.fn();

vi.mock("@/messages/dispatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/messages/dispatch")>()),
  kickMessageDispatcher: () => {
    kickSpy();
  },
}));

type ApiCall = { method: string; payload: Record<string, unknown> };
type Injection = { method: string; error_code: number; description: string; parameters?: Record<string, unknown> };

describe.skipIf(!isolatedDb.url)("Scheduled broadcasts", () => {
  let app: ReturnType<typeof import("@/app").createApp>;
  let testBot: Bot;
  let processBroadcasts: typeof import("./run").processBroadcasts;
  let resetBroadcastPause: typeof import("./run").resetBroadcastPause;
  let cookie: string;
  let blockedChats = new Set<number>();
  let injections: Injection[] = [];
  let messageSeq = 2000;
  let telegramSeq = 900_000;
  const calls: ApiCall[] = [];

  beforeAll(async () => {
    await isolatedDb.create();
    setTestEnv({
      DATABASE_URL: isolatedDb.url!,
      ADMIN_PASSWORD_HASH: await hashPassword(TEST_PASSWORD),
      ADMIN_TELEGRAM_IDS: String(ADMIN_ID),
      LEADS_CHAT_ID,
      LEADS_THREAD_ID: String(LEADS_THREAD_ID),
    });
    await runMigrations(isolatedDb.url!);

    testBot = (await import("@/telegram/bot")).bot();
    testBot.api.config.use(async (_prev, method, payload) => {
      const body = payload as Record<string, unknown>;
      calls.push({ method, payload: body });
      const idx = injections.findIndex((item) => item.method === method);
      if (idx >= 0) {
        const [failure] = injections.splice(idx, 1);
        return {
          ok: false,
          error_code: failure.error_code,
          description: failure.description,
          parameters: failure.parameters,
        } as never;
      }
      if (method.startsWith("send") && blockedChats.has(body.chat_id as number)) {
        return { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } as never;
      }
      if (method === "sendPhoto") {
        return { ok: true, result: { message_id: ++messageSeq, photo: [{ file_id: "b-photo-id" }] } } as never;
      }
      if (method === "sendVideo") {
        return { ok: true, result: { message_id: ++messageSeq, video: { file_id: "b-video-id" } } } as never;
      }
      if (method === "sendVoice") {
        return { ok: true, result: { message_id: ++messageSeq, voice: { file_id: "b-voice-id" } } } as never;
      }
      if (method.startsWith("send")) {
        return { ok: true, result: { message_id: ++messageSeq } } as never;
      }
      return { ok: true, result: true } as never;
    });

    ({ processBroadcasts, resetBroadcastPause } = await import("./run"));
    app = (await import("@/app")).createApp();

    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.88" },
      body: JSON.stringify({ username: "admin", password: TEST_PASSWORD }),
    });
    cookie = login.headers.get("set-cookie")!.split(";")[0];
  });

  beforeEach(async () => {
    calls.length = 0;
    blockedChats = new Set();
    injections = [];
    kickSpy.mockReset();
    resetBroadcastPause();
    await db().delete(events);
    await db().delete(leads);
    await db().delete(scheduledBroadcastRecipients);
    await db().delete(scheduledBroadcasts);
    await db().delete(segmentRuns);
    await db().delete(users);
  });

  afterAll(async () => {
    await closeDb();
    await isolatedDb.drop();
  });

  const adminReq = (path: string, init: RequestInit = {}) =>
    app.request(`/admin/broadcasts${path}`, { ...init, headers: { cookie, ...init.headers } });

  async function seedUser(opts: {
    name?: string;
    firstName?: string;
    telegramId?: number;
    segment?: FunnelSegment | null;
    paidAt?: Date | null;
    wonLead?: boolean;
    botBlocked?: boolean;
  } = {}) {
    const telegramId = opts.telegramId ?? ++telegramSeq;
    const [user] = await db()
      .insert(users)
      .values({
        telegramId,
        name: opts.name ?? "Aziza",
        firstName: opts.firstName ?? "Aziza",
        registeredAt: new Date("2026-11-01T10:00:00Z"),
        paidAt: opts.paidAt ?? null,
        botBlocked: opts.botBlocked ?? false,
      })
      .returning();
    if (opts.segment) {
      await db().insert(segmentRuns).values({
        userId: user.id,
        segment: opts.segment,
        enteredAt: new Date("2026-11-01T10:00:00Z"),
      });
    }
    if (opts.wonLead) {
      await db().insert(leads).values({
        source: "bot",
        userId: user.id,
        name: user.name ?? "Aziza",
        phone: "+998901112233",
        outcome: "won",
        outcomeAt: new Date("2026-11-02T10:00:00Z"),
      });
    }
    return user;
  }

  async function preview(audiences: BroadcastAudience[]) {
    const res = await adminReq("/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audiences }),
    });
    expect(res.status).toBe(200);
    return (await res.json() as { count: number }).count;
  }

  it("requires admin authentication for all broadcast routes", async () => {
    expect((await app.request("/admin/broadcasts")).status).toBe(401);
    expect((await app.request("/admin/broadcasts/preview", { method: "POST" })).status).toBe(401);
    expect((await app.request("/admin/broadcasts", { method: "POST" })).status).toBe(401);
  });

  it("filters audience previews across all, A, B, C, E, bought, and not_bought while excluding blocked and admin users", async () => {
    await seedUser({ segment: "A" });
    await seedUser({ segment: "B" });
    await seedUser({ segment: "C" });
    await seedUser({ segment: "E" });
    await seedUser({ segment: null, paidAt: new Date("2026-11-02T12:00:00Z") });
    await seedUser({ segment: "C", wonLead: true });
    await seedUser({ segment: "A", botBlocked: true });
    await seedUser({ telegramId: ADMIN_ID, segment: "A" });

    expect(await preview(["all"])).toBe(6);
    expect(await preview(["A"])).toBe(1);
    expect(await preview(["B"])).toBe(1);
    expect(await preview(["C"])).toBe(2);
    expect(await preview(["E"])).toBe(1);
    expect(await preview(["bought"])).toBe(2);
    expect(await preview(["not_bought"])).toBe(4);
    expect(await preview(["A", "B"])).toBe(2);
    expect(await preview(["C", "bought"])).toBe(3);
  });

  it("creates, edits, validates, and cancels broadcasts with immediate dispatcher kick when due soon", async () => {
    const futureIso = new Date(Date.now() + 2 * HOUR).toISOString();
    const soonIso = new Date(Date.now() + 10_000).toISOString();

    const badVar = await adminReq("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Salom {unknown}",
        media: null,
        buttons: [],
        audiences: ["all"],
        scheduledAt: futureIso,
        autoDeleteMinutes: null,
      }),
    });
    expect(badVar.status).toBe(422);
    expect(await badVar.json()).toEqual({ error: "unknown_variable", variable: "unknown" });

    const createdRes = await adminReq("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Salom {ism}!",
        media: null,
        buttons: [],
        audiences: ["A", "B"],
        scheduledAt: futureIso,
        autoDeleteMinutes: 120,
      }),
    });
    expect(createdRes.status).toBe(201);
    expect(kickSpy).toHaveBeenCalledTimes(0);
    const created = (await createdRes.json() as { broadcast: { id: number; status: string } }).broadcast;
    expect(created.status).toBe("scheduled");

    const updatedRes = await adminReq(`/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Yangilangan {name}!",
        media: null,
        buttons: [{ kind: "resume", text: "Davom" }],
        audiences: ["all"],
        scheduledAt: soonIso,
        autoDeleteMinutes: 60,
      }),
    });
    expect(updatedRes.status).toBe(200);
    expect(kickSpy).toHaveBeenCalledTimes(1);

    const listRes = await adminReq("");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { mediaEnabled: boolean; broadcasts: { id: number; text: string }[] };
    expect(listBody.mediaEnabled).toBe(true);
    expect(listBody.broadcasts).toHaveLength(1);
    expect(listBody.broadcasts[0].text).toBe("Yangilangan {name}!");

    const cancelRes = await adminReq(`/${created.id}/cancel`, { method: "POST" });
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json() as { broadcast: { status: string } }).broadcast.status).toBe("cancelled");

    const editCancelled = await adminReq(`/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Test",
        media: null,
        buttons: [],
        audiences: ["all"],
        scheduledAt: futureIso,
        autoDeleteMinutes: null,
      }),
    });
    expect(editCancelled.status).toBe(409);

    const cancelAgain = await adminReq(`/${created.id}/cancel`, { method: "POST" });
    expect(cancelAgain.status).toBe(409);
  });

  it("uploads broadcast media via media chat and rejects unsupported file types", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "promo.png", { type: "image/png" }));
    const uploadRes = await adminReq("/media", { method: "POST", body: form });
    expect(uploadRes.status).toBe(200);
    expect(await uploadRes.json()).toEqual({ type: "photo", fileId: "b-photo-id" });

    const badForm = new FormData();
    badForm.append("file", new File(["x"], "bad.gif", { type: "image/gif" }));
    expect((await adminReq("/media", { method: "POST", body: badForm })).status).toBe(415);
  });

  it("delivers broadcast messages with variables, media, tracked buttons, redirect clicks, and blocked handling", async () => {
    const u1 = await seedUser({ name: "Ali <script>", firstName: "Ali", segment: "C" });
    const u2 = await seedUser({ name: "Bobur", firstName: "Bobur", segment: "C" });
    await seedUser({ name: "Excluded", segment: "A" });
    blockedChats.add(u2.telegramId);

    const scheduledAt = new Date("2026-11-14T12:00:00.000Z");
    const createRes = await adminReq("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "<b>Assalomu alaykum</b>, {ism}!",
        media: { type: "photo", fileId: "b-photo-id" },
        buttons: [
          { kind: "link", text: "Sayt", url: "https://example.org/promo" },
          { kind: "admin", text: "Admin", prefill: "Salom {ism}" },
          { kind: "resume", text: "Darsga" },
        ],
        audiences: ["C"],
        scheduledAt: scheduledAt.toISOString(),
        autoDeleteMinutes: 30,
      }),
    });
    const broadcastId = (await createRes.json() as { broadcast: { id: number } }).broadcast.id;

    await processBroadcasts(testBot.api, new Date(scheduledAt.getTime() - 1000), async () => {});
    expect(calls).toHaveLength(0);

    await processBroadcasts(testBot.api, scheduledAt, async () => {});

    const [after] = await db().select().from(scheduledBroadcasts).where(eq(scheduledBroadcasts.id, broadcastId));
    expect(after.status).toBe("done");
    expect(after.targetCount).toBe(2);
    expect(after.sentCount).toBe(1);
    expect(after.blockedCount).toBe(1);
    expect(after.failedCount).toBe(0);
    expect(after.finishedAt).toEqual(scheduledAt);

    const recipients = await db()
      .select()
      .from(scheduledBroadcastRecipients)
      .where(eq(scheduledBroadcastRecipients.broadcastId, broadcastId))
      .orderBy(asc(scheduledBroadcastRecipients.id));
    const r1 = recipients.find((r) => r.userId === u1.id)!;
    const r2 = recipients.find((r) => r.userId === u2.id)!;
    expect(r1.state).toBe("sent");
    expect(r1.deleteAt).toEqual(new Date(scheduledAt.getTime() + 30 * MINUTE));
    expect(r2.state).toBe("blocked");

    const [u2After] = await db().select().from(users).where(eq(users.id, u2.id));
    expect(u2After.botBlocked).toBe(true);

    const photoCall = calls.find((c) => c.method === "sendPhoto" && c.payload.chat_id === u1.telegramId)!;
    expect(photoCall.payload.caption).toBe("<b>Assalomu alaykum</b>, Ali &lt;script&gt;!");
    const keyboard = (photoCall.payload.reply_markup as { inline_keyboard: { text: string; url?: string; web_app?: { url: string } }[][] }).inline_keyboard;
    expect(keyboard[0][0].url).toBe(`https://api.example.com/r/${r1.clickToken}/0`);
    expect(keyboard[1][0].url).toBe(`https://api.example.com/r/${r1.clickToken}/1`);
    expect(keyboard[2][0].web_app?.url).toBe("https://example.com/app?start=resume");

    const clickLink = await app.request(`/r/${r1.clickToken}/0`);
    expect(clickLink.status).toBe(302);
    expect(clickLink.headers.get("location")).toBe("https://example.org/promo");

    const clickAdmin = await app.request(`/r/${r1.clickToken}/1`);
    expect(clickAdmin.status).toBe(302);
    expect(clickAdmin.headers.get("location")).toBe("https://t.me/example?text=Salom+Ali+%3Cscript%3E");

    const [r1Clicked] = await db()
      .select()
      .from(scheduledBroadcastRecipients)
      .where(eq(scheduledBroadcastRecipients.id, r1.id));
    expect(r1Clicked.clickedAt).not.toBeNull();
    const [u1After] = await db().select().from(users).where(eq(users.id, u1.id));
    expect(u1After.channelClickAt).not.toBeNull();

    const userEvents = await db().select().from(events).where(eq(events.userId, u1.id));
    expect(userEvents.filter((e) => e.type === "message_click")).toHaveLength(2);
    expect(userEvents.filter((e) => e.type === "channel_click")).toHaveLength(1);
  });

  it("handles 429 rate limits and resumes pending recipients on the next tick", async () => {
    const u1 = await seedUser({ name: "User1" });
    const u2 = await seedUser({ name: "User2" });
    const scheduledAt = new Date("2026-11-14T13:00:00.000Z");

    const createRes = await adminReq("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Hi {ism}",
        media: null,
        buttons: [],
        audiences: ["all"],
        scheduledAt: scheduledAt.toISOString(),
        autoDeleteMinutes: null,
      }),
    });
    const broadcastId = (await createRes.json() as { broadcast: { id: number } }).broadcast.id;

    injections.push({
      method: "sendMessage",
      error_code: 429,
      description: "Too Many Requests",
      parameters: { retry_after: 10 },
    });

    await processBroadcasts(testBot.api, scheduledAt, async () => {});

    const [mid] = await db().select().from(scheduledBroadcasts).where(eq(scheduledBroadcasts.id, broadcastId));
    expect(mid.status).toBe("running");

    await processBroadcasts(testBot.api, new Date(scheduledAt.getTime() + 5_000), async () => {});
    const [stillPaused] = await db().select().from(scheduledBroadcasts).where(eq(scheduledBroadcasts.id, broadcastId));
    expect(stillPaused.status).toBe("running");

    await processBroadcasts(testBot.api, new Date(scheduledAt.getTime() + 11_000), async () => {});
    const [done] = await db().select().from(scheduledBroadcasts).where(eq(scheduledBroadcasts.id, broadcastId));
    expect(done.status).toBe("done");
    expect(done.sentCount).toBe(2);

    const recipients = await db()
      .select()
      .from(scheduledBroadcastRecipients)
      .where(eq(scheduledBroadcastRecipients.broadcastId, broadcastId));
    expect(recipients.map((r) => [r.userId, r.state].join(":")).sort()).toEqual([
      `${u1.id}:sent`,
      `${u2.id}:sent`,
    ].sort());
  });

  it("sweeps expired auto-delete broadcast messages and marks messages >= 48h old as too_old", async () => {
    const u1 = await seedUser({ name: "DeleteSoon" });
    const u2 = await seedUser({ name: "TooOld" });
    const sentAt = new Date("2026-11-10T10:00:00.000Z");

    const [broadcast] = await db()
      .insert(scheduledBroadcasts)
      .values({
        text: "Auto delete test",
        audiences: ["all"],
        scheduledAt: sentAt,
        autoDeleteMinutes: 60,
        status: "done",
        targetCount: 2,
        sentCount: 2,
        finishedAt: sentAt,
      })
      .returning();

    await db()
      .insert(scheduledBroadcastRecipients)
      .values([
        {
          broadcastId: broadcast.id,
          userId: u1.id,
          state: "sent",
          telegramMessageId: 4001,
          sentAt: new Date(sentAt.getTime() + 47 * HOUR),
          deleteAt: new Date(sentAt.getTime() + 47 * HOUR + 30 * MINUTE),
        },
        {
          broadcastId: broadcast.id,
          userId: u2.id,
          state: "sent",
          telegramMessageId: 4002,
          sentAt,
          deleteAt: new Date(sentAt.getTime() + 60 * MINUTE),
        },
      ]);

    const sweepNow = new Date(sentAt.getTime() + 48 * HOUR + 5 * MINUTE);
    await processBroadcasts(testBot.api, sweepNow, async () => {});

    const deleteCalls = calls.filter((c) => c.method === "deleteMessage").map((c) => c.payload);
    expect(deleteCalls).toEqual([{ chat_id: u1.telegramId, message_id: 4001 }]);

    const rows = await db()
      .select()
      .from(scheduledBroadcastRecipients)
      .where(eq(scheduledBroadcastRecipients.broadcastId, broadcast.id));
    const r1 = rows.find((r) => r.userId === u1.id)!;
    const r2 = rows.find((r) => r.userId === u2.id)!;
    expect(r1.deletedAt).toEqual(sweepNow);
    expect(r2.deletedAt).toBeNull();
    expect(r2.deleteError).toBe("too_old");
  });

  it("delivers video and voice broadcasts and substitutes {name}", async () => {
    const u1 = await seedUser({ name: "Madina", segment: "B" });
    const now = new Date("2026-11-14T14:00:00.000Z");

    await adminReq("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Video xabar {name}",
        media: { type: "video", fileId: "b-video-id" },
        buttons: [],
        audiences: ["B"],
        scheduledAt: now.toISOString(),
        autoDeleteMinutes: null,
      }),
    });
    await processBroadcasts(testBot.api, now, async () => {});

    await adminReq("", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Ovozli xabar {name}",
        media: { type: "voice", fileId: "b-voice-id" },
        buttons: [],
        audiences: ["B"],
        scheduledAt: new Date(now.getTime() + 1000).toISOString(),
        autoDeleteMinutes: null,
      }),
    });
    await processBroadcasts(testBot.api, new Date(now.getTime() + 1000), async () => {});

    const videoCall = calls.find((c) => c.method === "sendVideo" && c.payload.chat_id === u1.telegramId);
    const voiceCall = calls.find((c) => c.method === "sendVoice" && c.payload.chat_id === u1.telegramId);
    expect(videoCall?.payload).toMatchObject({
      video: "b-video-id",
      caption: "Video xabar Madina",
      supports_streaming: true,
    });
    expect(voiceCall?.payload).toMatchObject({
      voice: "b-voice-id",
      caption: "Ovozli xabar Madina",
    });
  });
});
