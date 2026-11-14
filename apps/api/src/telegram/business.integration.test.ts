import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { Bot } from "grammy";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { businessConnections, campaignLinks, events, segmentRuns, users } from "@/db/schema";
import { setTestEnv } from "@/test/env";
import { isolatedDatabase } from "@/test/isolatedDb";
import { ensureActiveTestVideo } from "@/test/videos";

const isolatedDb = isolatedDatabase("vf_business");
const testDbUrl = isolatedDb.url;
const ADMIN_TELEGRAM_ID = 111_222_333;
const SALES_TELEGRAM_ID = 444_555_666;

vi.mock("@/leads/notifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/leads/notifier")>()),
  kickLeadNotifier: () => {},
}));

describe.skipIf(!testDbUrl)("Telegram Business lifecycle and Last-Touch attribution", () => {
  let testBot: Bot;
  let updateId = 1;
  let messageSeq = 100_000;

  beforeAll(async () => {
    await isolatedDb.create();
    setTestEnv({
      DATABASE_URL: testDbUrl!,
      ADMIN_TELEGRAM_IDS: String(ADMIN_TELEGRAM_ID),
    });
    await runMigrations(testDbUrl!);
    await ensureActiveTestVideo();
    const { bot } = await import("./bot");
    testBot = bot();
    testBot.botInfo = {
      id: 1,
      is_bot: true,
      first_name: "Test",
      username: "test_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: true,
      has_main_web_app: false,
    } as Bot["botInfo"];
    testBot.api.config.use(async (_prev, method) => {
      if (method.startsWith("send")) return { ok: true, result: { message_id: ++messageSeq } } as never;
      return { ok: true, result: true } as never;
    });
  });

  beforeEach(async () => {
    await db().delete(businessConnections);
    await db().delete(events);
    await db().delete(segmentRuns);
    await db().update(users).set({ linkId: null });
    await db().delete(users);
    await db().delete(campaignLinks);
  });

  afterAll(async () => {
    await closeDb();
    await isolatedDb.drop();
  });

  function sendBusinessConnection(params: {
    id: string;
    userId: number;
    username?: string;
    firstName?: string;
    isEnabled?: boolean;
    canReply?: boolean;
    date?: number;
  }) {
    return testBot.handleUpdate({
      update_id: updateId++,
      business_connection: {
        id: params.id,
        user: {
          id: params.userId,
          is_bot: false,
          first_name: params.firstName ?? "Sales",
          username: params.username,
        },
        user_chat_id: params.userId,
        date: params.date ?? 1_700_000_000,
        rights: { can_reply: params.canReply ?? true },
        is_enabled: params.isEnabled ?? true,
      },
    } as never);
  }

  function sendBusinessMessage(params: {
    connectionId: string;
    customerTelegramId: number;
    fromTelegramId: number;
    date: number;
    text?: string;
  }) {
    return testBot.handleUpdate({
      update_id: updateId++,
      business_message: {
        message_id: ++messageSeq,
        business_connection_id: params.connectionId,
        date: params.date,
        chat: { id: params.customerTelegramId, type: "private", first_name: "Customer" },
        from: { id: params.fromTelegramId, is_bot: false, first_name: "Sender" },
        text: params.text ?? "Assalomu alaykum",
      },
    } as never);
  }

  function sendStart(telegramId: number, param?: string) {
    const text = param ? `/start ${param}` : "/start";
    return testBot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: ++messageSeq,
        date: Math.floor(Date.now() / 1000),
        chat: { id: telegramId, type: "private", first_name: "User" },
        from: { id: telegramId, is_bot: false, first_name: "User" },
        text,
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    } as never);
  }

  it("auto-approves admin business_connection and requires approval for non-admin sales accounts", async () => {
    await sendBusinessConnection({
      id: "conn_admin",
      userId: ADMIN_TELEGRAM_ID,
      username: "boss_admin",
      firstName: "Boss",
    });
    await sendBusinessConnection({
      id: "conn_sales",
      userId: SALES_TELEGRAM_ID,
      username: "sales_one",
      firstName: "Sotuvchi",
    });

    const [adminConn] = await db()
      .select()
      .from(businessConnections)
      .where(eq(businessConnections.id, "conn_admin"));
    const [salesConn] = await db()
      .select()
      .from(businessConnections)
      .where(eq(businessConnections.id, "conn_sales"));

    expect(adminConn).toMatchObject({
      userTelegramId: ADMIN_TELEGRAM_ID,
      username: "boss_admin",
      canReply: true,
      isEnabled: true,
      isApproved: true,
    });
    expect(salesConn).toMatchObject({
      userTelegramId: SALES_TELEGRAM_ID,
      username: "sales_one",
      canReply: true,
      isEnabled: true,
      isApproved: false,
    });

    const customerTgId = 900_000_001;
    const [customer] = await db()
      .insert(users)
      .values({ telegramId: customerTgId, registeredAt: new Date(1_700_000_000_000) })
      .returning();

    await sendBusinessMessage({
      connectionId: "conn_sales",
      customerTelegramId: customerTgId,
      fromTelegramId: customerTgId,
      date: 1_700_000_100,
    });
    const [beforeApproval] = await db().select().from(users).where(eq(users.id, customer.id));
    expect(beforeApproval.wroteAdminAt).toBeNull();

    await db()
      .update(businessConnections)
      .set({ isApproved: true })
      .where(eq(businessConnections.id, "conn_sales"));

    await sendBusinessConnection({
      id: "conn_sales",
      userId: SALES_TELEGRAM_ID,
      username: "sales_one_renamed",
      firstName: "Sotuvchi",
      canReply: false,
    });
    const [preserved] = await db()
      .select()
      .from(businessConnections)
      .where(eq(businessConnections.id, "conn_sales"));
    expect(preserved.isApproved).toBe(true);
    expect(preserved.username).toBe("sales_one_renamed");
    expect(preserved.canReply).toBe(false);

    await sendBusinessMessage({
      connectionId: "conn_sales",
      customerTelegramId: customerTgId,
      fromTelegramId: customerTgId,
      date: 1_700_000_200,
    });
    const [afterApproval] = await db().select().from(users).where(eq(users.id, customer.id));
    expect(afterApproval.wroteAdminAt).toEqual(new Date(1_700_000_200_000));
    expect(afterApproval.wroteAdminBy).toBe(SALES_TELEGRAM_ID);
  });

  it("advances C to E on inbound business_message and updates lastAdminChatAt on outbound admin replies", async () => {
    await sendBusinessConnection({
      id: "conn_active",
      userId: ADMIN_TELEGRAM_ID,
    });

    const customerTgId = 900_000_002;
    const t0 = new Date(1_700_000_000_000);
    const [customer] = await db()
      .insert(users)
      .values({ telegramId: customerTgId, registeredAt: t0, offerWatchedAt: t0 })
      .returning();
    await db().insert(segmentRuns).values({ userId: customer.id, segment: "C", enteredAt: t0 });

    await sendBusinessMessage({
      connectionId: "conn_active",
      customerTelegramId: customerTgId,
      fromTelegramId: ADMIN_TELEGRAM_ID,
      date: 1_700_000_050,
    });
    const [afterPreOutbound] = await db().select().from(users).where(eq(users.id, customer.id));
    expect(afterPreOutbound.wroteAdminAt).toBeNull();
    expect(afterPreOutbound.lastAdminChatAt).toEqual(new Date(1_700_000_050_000));

    await sendBusinessMessage({
      connectionId: "conn_active",
      customerTelegramId: customerTgId,
      fromTelegramId: customerTgId,
      date: 1_700_000_120,
    });

    const [afterInbound] = await db().select().from(users).where(eq(users.id, customer.id));
    expect(afterInbound.wroteAdminAt).toEqual(new Date(1_700_000_120_000));
    expect(afterInbound.wroteAdminBy).toBe(ADMIN_TELEGRAM_ID);
    expect(afterInbound.lastAdminChatAt).toEqual(new Date(1_700_000_120_000));

    const runs = await db()
      .select()
      .from(segmentRuns)
      .where(eq(segmentRuns.userId, customer.id))
      .orderBy(asc(segmentRuns.id));
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ segment: "C", endReason: "advanced" });
    expect(runs[1]).toMatchObject({ segment: "E", endedAt: null });

    const adminChatEvents = await db().select().from(events).where(eq(events.userId, customer.id));
    expect(adminChatEvents.filter((e) => e.type === "admin_chat")).toHaveLength(1);
    expect(adminChatEvents[0].meta).toMatchObject({
      via: "business",
      by: ADMIN_TELEGRAM_ID,
      businessConnectionId: "conn_active",
    });

    await sendBusinessMessage({
      connectionId: "conn_active",
      customerTelegramId: customerTgId,
      fromTelegramId: ADMIN_TELEGRAM_ID,
      date: 1_700_000_300,
    });
    const [afterReply] = await db().select().from(users).where(eq(users.id, customer.id));
    expect(afterReply.wroteAdminAt).toEqual(new Date(1_700_000_120_000));
    expect(afterReply.lastAdminChatAt).toEqual(new Date(1_700_000_300_000));
  });

  it("updates lastUtm* on repeat /start c_... while preserving First-Touch utm*", async () => {
    await db()
      .insert(campaignLinks)
      .values([
        {
          code: "fb_first",
          utm: { utm_source: "fb", utm_campaign: "fb_camp_1", utm_content: "video_a" },
        },
        {
          code: "tg_second",
          utm: { utm_source: "tg", utm_campaign: "tg_camp_2", utm_content: "post_b" },
        },
      ]);

    const tgId = 900_000_003;
    await sendStart(tgId, "c_fb_first");

    const [first] = await db().select().from(users).where(eq(users.telegramId, tgId));
    expect(first.utmSource).toBe("fb");
    expect(first.utmCampaign).toBe("fb_camp_1");
    expect(first.utmContent).toBe("video_a");
    expect(first.lastUtmSource).toBe("fb");
    expect(first.lastUtmCampaign).toBe("fb_camp_1");
    expect(first.lastUtmContent).toBe("video_a");
    expect(first.lastTouchAt).not.toBeNull();

    await sendStart(tgId, "c_tg_second");

    const [second] = await db().select().from(users).where(eq(users.telegramId, tgId));
    expect(second.utmSource).toBe("fb");
    expect(second.utmCampaign).toBe("fb_camp_1");
    expect(second.utmContent).toBe("video_a");
    expect(second.lastUtmSource).toBe("tg");
    expect(second.lastUtmCampaign).toBe("tg_camp_2");
    expect(second.lastUtmContent).toBe("post_b");
    expect(second.lastTouchAt!.getTime()).toBeGreaterThanOrEqual(first.lastTouchAt!.getTime());
  });
});
