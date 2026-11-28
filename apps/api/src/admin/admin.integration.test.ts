import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  adminLeadsResponseSchema,
  adminStatsResponseSchema,
  campaignLinkItemSchema,
  campaignLinksResponseSchema,
} from "@funnel/shared";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  events,
  leads,
  users,
  watchProgress,
} from "@/db/schema";
import { upsertUser } from "@/funnel/users";
import { isolatedDatabase } from "@/test/isolatedDb";
import { ensureActiveTestVideo } from "@/test/videos";
import { hashPassword } from "./password";

const isolatedDb = isolatedDatabase("vf_admin");
const testDbUrl = isolatedDb.url;
const TEST_PASSWORD = "test-admin-password-2026";

describe.skipIf(!testDbUrl)("Admin Integration Tests", () => {
  let createApp: typeof import("@/app").createApp;
  let testPasswordHash: string;
  let adminSessionCookie: string;

  beforeAll(async () => {
    await isolatedDb.create();
    testPasswordHash = await hashPassword(TEST_PASSWORD);

    Object.assign(process.env, {
      BOT_TOKEN: "123456:TEST-token",
      BOT_USERNAME: "test_bot",
      WEBHOOK_SECRET: "test-secret-0123456789",
      API_URL: "https://api.example.com",
      WEB_URL: "https://example.com",
      DATABASE_URL: testDbUrl,
      CHANNEL_URL: "https://t.me/example",
      VIDEO_POSTER_URL: "https://video.example.com/poster.webp",
      ADMIN_PASSWORD_HASH: testPasswordHash,
    });

    await runMigrations(testDbUrl!);
    const appModule = await import("@/app");
    createApp = appModule.createApp;

    const login = await createApp().request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" },
      body: JSON.stringify({ username: "admin", password: TEST_PASSWORD }),
    });
    expect(login.status).toBe(200);
    adminSessionCookie = login.headers.get("set-cookie")!.match(/admin_session=[^;]+/)![0];

    await db().execute(sql`
      DELETE FROM events WHERE (created_at AT TIME ZONE 'Asia/Tashkent')::date >= '2026-05-01'::date AND (created_at AT TIME ZONE 'Asia/Tashkent')::date <= '2026-05-10'::date;
      DELETE FROM leads WHERE user_id IN (SELECT id FROM users WHERE (registered_at AT TIME ZONE 'Asia/Tashkent')::date >= '2026-05-01'::date AND (registered_at AT TIME ZONE 'Asia/Tashkent')::date <= '2026-05-10'::date);
      DELETE FROM watch_progress WHERE user_id IN (SELECT id FROM users WHERE (registered_at AT TIME ZONE 'Asia/Tashkent')::date >= '2026-05-01'::date AND (registered_at AT TIME ZONE 'Asia/Tashkent')::date <= '2026-05-10'::date);
      DELETE FROM users WHERE (registered_at AT TIME ZONE 'Asia/Tashkent')::date >= '2026-05-01'::date AND (registered_at AT TIME ZONE 'Asia/Tashkent')::date <= '2026-05-10'::date;
    `);
  });

  afterAll(async () => {
    await closeDb();
    await isolatedDb.drop();
  });

  it("computes exact funnel counts, midnight boundaries, campaign stats, and dropoff", async () => {
    const app = createApp();

    const fromDate = "2026-05-06";
    const toDate = "2026-05-07";

    const visitorA = "vis_test_may_a";
    const visitorB = "vis_test_may_b";

    const dateMay06BeforeMidnight = new Date("2026-05-06T18:59:00.000Z");
    const dateMay07AfterMidnight = new Date("2026-05-06T19:01:00.000Z");
    const dateMay07Noon = new Date("2026-05-07T07:00:00.000Z");

    await db().insert(events).values([
      {
        type: "landing_view",
        visitorId: visitorA,
        createdAt: dateMay06BeforeMidnight,
        meta: { utm_source: "fb_ad", utm_campaign: "promo_fb" },
      },
      {
        type: "cta_click",
        visitorId: visitorA,
        createdAt: dateMay06BeforeMidnight,
      },
      {
        type: "landing_view",
        visitorId: visitorB,
        createdAt: dateMay07AfterMidnight,
        meta: { utm_source: "tg_ad", utm_campaign: "promo_tg" },
      },
    ]);

    const baseTelegramId = Math.floor(Math.random() * 10000000) + 1000000;
    const tgId1 = baseTelegramId + 1;
    const tgId2 = baseTelegramId + 2;
    const tgId3 = baseTelegramId + 3;

    const video = await ensureActiveTestVideo();

    const [u1] = await db()
      .insert(users)
      .values({
        telegramId: tgId1,
        videoId: video.id,
        name: "Ali Valiyev",
        phone: "+998901111111",
        username: "ali_valiyev",
        utmSource: "fb_ad",
        utmCampaign: "promo_fb",
        utmContent: "video_ad",
        registeredAt: dateMay06BeforeMidnight,
        completedAt: dateMay06BeforeMidnight,
        channelClickAt: dateMay06BeforeMidnight,
        createdAt: dateMay06BeforeMidnight,
      })
      .returning();

    const [u2] = await db()
      .insert(users)
      .values({
        telegramId: tgId2,
        videoId: video.id,
        name: "Bobur Karimov",
        phone: "+998902222222",
        username: "bobur_k",
        utmSource: "tg_ad",
        utmCampaign: "promo_tg",
        utmContent: "channel_post",
        registeredAt: dateMay07AfterMidnight,
        createdAt: dateMay07AfterMidnight,
      })
      .returning();

    const [u3] = await db()
      .insert(users)
      .values({
        telegramId: tgId3,
        videoId: video.id,
        name: "Charos Rahimova",
        phone: "+998903333333",
        username: "charos_r",
        utmSource: "fb_ad",
        utmCampaign: "promo_fb",
        utmContent: "story_ad",
        registeredAt: dateMay07Noon,
        createdAt: dateMay07Noon,
      })
      .returning();

    await db().insert(watchProgress).values([
      {
        userId: u1.id,
        maxPosition: 900,
        watchedSecs: 900,
        completed: true,
      },
      {
        userId: u2.id,
        maxPosition: 450,
        watchedSecs: 450,
        completed: false,
      },
      {
        userId: u3.id,
        maxPosition: 90,
        watchedSecs: 90,
        completed: false,
      },
    ]);

    await db().insert(events).values([
      { type: "bot_start", userId: u1.id, createdAt: dateMay06BeforeMidnight },
      { type: "registered", userId: u1.id, createdAt: dateMay06BeforeMidnight },
      { type: "video_start", userId: u1.id, createdAt: dateMay06BeforeMidnight },
      { type: "progress_25", userId: u1.id, createdAt: dateMay06BeforeMidnight },
      { type: "progress_50", userId: u1.id, createdAt: dateMay06BeforeMidnight },
      { type: "progress_75", userId: u1.id, createdAt: dateMay06BeforeMidnight },
      { type: "video_complete", userId: u1.id, createdAt: dateMay06BeforeMidnight },
      { type: "channel_click", userId: u1.id, createdAt: dateMay06BeforeMidnight },

      { type: "bot_start", userId: u2.id, createdAt: dateMay07AfterMidnight },
      { type: "registered", userId: u2.id, createdAt: dateMay07AfterMidnight },
      { type: "video_start", userId: u2.id, createdAt: dateMay07AfterMidnight },
      { type: "progress_25", userId: u2.id, createdAt: dateMay07AfterMidnight },
      { type: "progress_50", userId: u2.id, createdAt: dateMay07AfterMidnight },

      { type: "bot_start", userId: u3.id, createdAt: dateMay07Noon },
      { type: "registered", userId: u3.id, createdAt: dateMay07Noon },
    ]);

    await db().insert(leads).values([
      { source: "bot", userId: u1.id, name: "Ali", phone: "", sheetsAttempts: 1 },
      { source: "bot", userId: u2.id, name: "Bobur", phone: "", sheetsAttempts: 2 },
      { source: "bot", userId: u3.id, name: "Charos", phone: "", sheetsAttempts: 11, sheetsError: "Rate limit" },
    ]);

    const statsRes = await app.request(`/admin/stats?from=${fromDate}&to=${toDate}`, {
      method: "GET",
      headers: { cookie: adminSessionCookie },
    });
    expect(statsRes.status).toBe(200);
    const stats = adminStatsResponseSchema.parse(await statsRes.json());

    expect(stats.kpis).toEqual({
      landingViews: 2,
      botStarts: 3,
      registrations: 3,
      completions: 1,
      channelClicks: 1,
      realChats: 0,
      purchases: 0,
      conversionRate: 50,
    });

    const stepCounts = Object.fromEntries(stats.funnel.map((s) => [s.step, s.count]));
    expect(stepCounts).toEqual({
      landing_view: 2,
      cta_click: 1,
      bot_start: 3,
      registered: 3,
      video_start: 2,
      video_complete: 1,
      channel_click: 1,
      admin_chat: 0,
      paid: 0,
    });

    const stepConv = Object.fromEntries(stats.funnel.map((s) => [s.step, s.conversionRate]));
    expect(stepConv.landing_view).toBe(100);
    expect(stepConv.cta_click).toBe(50);
    expect(stepConv.bot_start).toBe(300);
    expect(stepConv.registered).toBe(100);
    expect(stepConv.video_start).toBe(66.7);
    expect(stepConv.video_complete).toBe(50);
    expect(stepConv.channel_click).toBe(100);
    expect(stepConv.admin_chat).toBe(0);
    expect(stepConv.paid).toBe(0);

    const may06Daily = stats.daily.find((d) => d.date === "2026-05-06");
    const may07Daily = stats.daily.find((d) => d.date === "2026-05-07");
    expect(may06Daily).toEqual({ date: "2026-05-06", registrations: 1, completions: 1 });
    expect(may07Daily).toEqual({ date: "2026-05-07", registrations: 2, completions: 0 });

    expect(stats.dropoff.map((d) => d.minute)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(stats.dropoff.find((d) => d.minute === 1)).toEqual({ minute: 1, count: 3, share: 100 });
    expect(stats.dropoff.find((d) => d.minute === 2)).toEqual({ minute: 2, count: 2, share: 66.7 });
    expect(stats.dropoff.find((d) => d.minute === 8)).toEqual({ minute: 8, count: 1, share: 33.3 });
    expect(stats.dropoff.find((d) => d.minute === 15)).toEqual({ minute: 15, count: 1, share: 33.3 });

    expect(stats.campaigns.length).toBe(5);
    const fbCampaign = stats.campaigns.find((c) => c.source === "fb_ad" && c.content === "video_ad");
    expect(fbCampaign).toMatchObject({
      source: "fb_ad",
      campaign: "promo_fb",
      content: "video_ad",
      landingViews: 0,
      botStarts: 1,
      botStartRate: null,
      registrations: 1,
      completions: 1,
      completionRate: 100,
      channelClicks: 1,
      realChats: 0,
      purchases: 0,
    });
    const fbLandingOnly = stats.campaigns.find((c) => c.source === "fb_ad" && c.content === "");
    expect(fbLandingOnly).toEqual({
      source: "fb_ad",
      campaign: "promo_fb",
      content: "",
      landingViews: 1,
      botStarts: 0,
      botStartRate: 0,
      registrations: 0,
      completions: 0,
      completionRate: 0,
      channelClicks: 0,
      realChats: 0,
      purchases: 0,
    });

    expect(stats.health.sheetsBacklog).toBeGreaterThanOrEqual(2);
    expect(stats.health.sheetsFailures).toBeGreaterThanOrEqual(1);
    expect(stats.health.lastBotStartAt).not.toBeNull();
    expect(stats.health.lastEventAt).not.toBeNull();

    const filteredStatsRes = await app.request(
      `/admin/stats?from=${fromDate}&to=${toDate}&source=fb_ad&campaign=promo_fb`,
      {
        method: "GET",
        headers: { cookie: adminSessionCookie },
      },
    );
    expect(filteredStatsRes.status).toBe(200);
    const filteredStats = adminStatsResponseSchema.parse(await filteredStatsRes.json());
    expect(filteredStats.kpis.landingViews).toBe(1);
    const filteredSteps = Object.fromEntries(filteredStats.funnel.map((s) => [s.step, s.count]));
    expect(filteredSteps.cta_click).toBe(1);
    expect(filteredStats.kpis.botStarts).toBe(2);
    expect(filteredStats.kpis.registrations).toBe(2);
    expect(filteredStats.kpis.completions).toBe(1);
    expect(filteredStats.kpis.channelClicks).toBe(1);
  });

  it("handles leads pagination and CSV export formatting", async () => {
    const app = createApp();
    const fromDate = "2026-05-06";
    const toDate = "2026-05-07";

    const leadsRes = await app.request(`/admin/leads?from=${fromDate}&to=${toDate}&page=1`, {
      method: "GET",
      headers: { cookie: adminSessionCookie },
    });
    expect(leadsRes.status).toBe(200);
    const leadsJson = adminLeadsResponseSchema.parse(await leadsRes.json());

    expect(leadsJson.total).toBe(3);
    expect(leadsJson.page).toBe(1);
    expect(leadsJson.leads.length).toBe(3);

    expect(leadsJson.leads[0].name).toBe("Charos Rahimova");
    expect(leadsJson.leads[0].progressPercent).toBe(10);
    expect(leadsJson.leads[0].completed).toBe(false);

    expect(leadsJson.leads[2].name).toBe("Ali Valiyev");
    expect(leadsJson.leads[2].progressPercent).toBe(100);
    expect(leadsJson.leads[2].completed).toBe(true);
    expect(leadsJson.leads[2].channelClicked).toBe(true);
    expect(leadsJson.leads[2].wroteAdmin).toBe(false);
    expect(leadsJson.leads[2].paid).toBe(false);

    const video = await ensureActiveTestVideo();
    const extraUsersBase = Math.floor(Math.random() * 10000000) + 20000000;
    const extraUsers = Array.from({ length: 50 }, (_, i) => ({
      telegramId: extraUsersBase + i,
      videoId: video.id,
      name: `User ${i}`,
      registeredAt: new Date("2026-05-07T08:00:00.000Z"),
      createdAt: new Date("2026-05-07T08:00:00.000Z"),
    }));
    await db().insert(users).values(extraUsers);

    const pagedRes = await app.request(`/admin/leads?from=${fromDate}&to=${toDate}&page=2`, {
      method: "GET",
      headers: { cookie: adminSessionCookie },
    });
    expect(pagedRes.status).toBe(200);
    const pagedJson = adminLeadsResponseSchema.parse(await pagedRes.json());
    expect(pagedJson.total).toBe(53);
    expect(pagedJson.page).toBe(2);
    expect(pagedJson.pageSize).toBe(50);
    expect(pagedJson.totalPages).toBe(2);
    expect(pagedJson.leads.length).toBe(3);

    const csvRes = await app.request(`/admin/leads.csv?from=${fromDate}&to=${toDate}`, {
      method: "GET",
      headers: { cookie: adminSessionCookie },
    });
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    expect(csvRes.headers.get("content-disposition")).toContain("attachment");
    expect(csvRes.headers.get("content-disposition")).toContain(`leads-${fromDate}-${toDate}.csv`);

    const buf = Buffer.from(await csvRes.arrayBuffer());
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);

    const csvText = buf.toString("utf-8");
    const lines = csvText.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      "Ro'yxatdan o'tgan sana,Ism,Telefon,Username,Manba,Kampaniya,Ko'rish foizi,Tugatilgan,Tugma bosgan,Haqiqiy yozgan,Sotib olgan",
    );
    expect(lines.length).toBe(54);

    const aliLine = lines.find((l) => l.includes("Ali Valiyev"));
    expect(aliLine).toBeDefined();
    expect(aliLine).toContain("2026-05-06 23:59:00");
    expect(aliLine).toContain("+998901111111");
    expect(aliLine).toContain("@ali_valiyev");
    expect(aliLine).toContain("100%");
    expect(aliLine).toContain("Ha");
  });

  it("manages campaign links, direct-to-bot attribution, fallback conversionRate, and filterOptions", async () => {
    const app = createApp();

    const autoRes = await app.request("/admin/links", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        utmSource: "tg",
        utmCampaign: "auto_camp",
        utmContent: "post_1",
      }),
    });
    expect(autoRes.status).toBe(201);
    const autoBody = (await autoRes.json()) as { item: unknown };
    const autoItem = campaignLinkItemSchema.parse(autoBody.item);
    expect(autoItem.code).toMatch(/^tg_auto_camp_post_1_[a-z0-9]{5}$/);
    expect(autoItem.botUrl).toBe(`https://t.me/test_bot?start=c_${autoItem.code}`);
    expect(autoItem.landingUrl).toBe(
      "https://example.com/?utm_source=tg&utm_campaign=auto_camp&utm_content=post_1",
    );

    const customRes = await app.request("/admin/links", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        utmSource: "tg",
        utmCampaign: "ramazon_2026",
        utmContent: "video_1",
        code: "tg_ramazon",
      }),
    });
    expect(customRes.status).toBe(201);
    const customBody = (await customRes.json()) as { item: unknown };
    const customItem = campaignLinkItemSchema.parse(customBody.item);
    expect(customItem.code).toBe("tg_ramazon");
    expect(customItem.botUrl).toBe("https://t.me/test_bot?start=c_tg_ramazon");
    expect(customItem.landingUrl).toBe(
      "https://example.com/?utm_source=tg&utm_campaign=ramazon_2026&utm_content=video_1",
    );

    const dupRes = await app.request("/admin/links", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminSessionCookie,
      },
      body: JSON.stringify({
        utmSource: "tg",
        utmCampaign: "ramazon_2026",
        code: "tg_ramazon",
      }),
    });
    expect(dupRes.status).toBe(409);
    expect(await dupRes.json()).toEqual({ error: "code_taken" });

    await ensureActiveTestVideo();
    const may08 = new Date("2026-05-08T10:00:00.000Z");
    const tgBase = Math.floor(Math.random() * 10000000) + 30000000;

    const first = await upsertUser({ id: tgBase + 1, username: "tg_ads_user_1" }, "c_tg_ramazon");
    const second = await upsertUser({ id: tgBase + 2, username: "tg_ads_user_2" }, "c_tg_ramazon");

    await db()
      .update(users)
      .set({ registeredAt: may08, completedAt: may08, channelClickAt: may08, createdAt: may08 })
      .where(eq(users.id, first.user.id));

    await db()
      .update(users)
      .set({ registeredAt: may08, createdAt: may08 })
      .where(eq(users.id, second.user.id));

    await db().insert(events).values([
      { type: "bot_start", userId: first.user.id, createdAt: may08 },
      { type: "registered", userId: first.user.id, createdAt: may08 },
      { type: "video_complete", userId: first.user.id, createdAt: may08 },
      { type: "channel_click", userId: first.user.id, createdAt: may08 },
      { type: "bot_start", userId: second.user.id, createdAt: may08 },
      { type: "registered", userId: second.user.id, createdAt: may08 },
    ]);

    const listRes = await app.request("/admin/links", {
      method: "GET",
      headers: { cookie: adminSessionCookie },
    });
    expect(listRes.status).toBe(200);
    const listBody = campaignLinksResponseSchema.parse(await listRes.json());
    const ramazonLink = listBody.items.find((i) => i.code === "tg_ramazon");
    expect(ramazonLink).toBeDefined();
    expect(ramazonLink?.botStarts).toBe(2);
    expect(ramazonLink?.registrations).toBe(2);

    const statsRes = await app.request(
      "/admin/stats?from=2026-05-08&to=2026-05-08&source=tg&campaign=ramazon_2026",
      {
        method: "GET",
        headers: { cookie: adminSessionCookie },
      },
    );
    expect(statsRes.status).toBe(200);
    const stats = adminStatsResponseSchema.parse(await statsRes.json());
    expect(stats.kpis).toEqual({
      landingViews: 0,
      botStarts: 2,
      registrations: 2,
      completions: 1,
      channelClicks: 1,
      realChats: 0,
      purchases: 0,
      conversionRate: 50,
    });
    expect(stats.campaigns).toEqual([
      {
        source: "tg",
        campaign: "ramazon_2026",
        content: "video_1",
        landingViews: 0,
        botStarts: 2,
        botStartRate: null,
        registrations: 2,
        completions: 1,
        completionRate: 50,
        channelClicks: 1,
        realChats: 0,
        purchases: 0,
      },
    ]);
    expect(stats.filterOptions.sources.slice(0, 3)).toEqual(["tg", "ig", "fb"]);
    expect(stats.filterOptions.campaigns).toContainEqual({
      source: "tg",
      campaign: "ramazon_2026",
    });

    const delRes1 = await app.request(`/admin/links/${autoItem.code}`, {
      method: "DELETE",
      headers: { cookie: adminSessionCookie },
    });
    expect(delRes1.status).toBe(200);
    expect(await delRes1.json()).toEqual({ ok: true });

    const delRes2 = await app.request(`/admin/links/${autoItem.code}`, {
      method: "DELETE",
      headers: { cookie: adminSessionCookie },
    });
    expect(delRes2.status).toBe(404);
    expect(await delRes2.json()).toEqual({ error: "not_found" });
  });

  it("separates channelClicks, realChats, purchases, first/last-touch attribution, and lead flags", async () => {
    const app = createApp();
    const video = await ensureActiveTestVideo();
    const baseTg = Math.floor(Math.random() * 10000000) + 40000000;

    const priorDate = new Date("2026-05-25T10:00:00.000Z");
    const inRangeDay1 = new Date("2026-06-02T10:00:00.000Z");
    const inRangeDay2 = new Date("2026-06-03T10:00:00.000Z");

    const [fbToTgUser] = await db()
      .insert(users)
      .values({
        telegramId: baseTg + 1,
        videoId: video.id,
        name: "FB Then TG",
        phone: "+998901010101",
        username: "fb_tg_user",
        utmSource: "fb",
        utmCampaign: "fb_june",
        utmContent: "reel_1",
        lastUtmSource: "tg",
        lastUtmCampaign: "tg_june",
        lastUtmContent: "post_2",
        lastTouchAt: inRangeDay1,
        registeredAt: inRangeDay1,
        channelClickAt: inRangeDay1,
        wroteAdminAt: inRangeDay1,
        paidAt: inRangeDay2,
        createdAt: inRangeDay1,
      })
      .returning();

    const [igClickOnlyUser] = await db()
      .insert(users)
      .values({
        telegramId: baseTg + 2,
        videoId: video.id,
        name: "IG Click Only",
        phone: "+998902020202",
        utmSource: "insta_ads",
        utmCampaign: "ig_june",
        utmContent: "story_1",
        registeredAt: inRangeDay1,
        channelClickAt: inRangeDay1,
        createdAt: inRangeDay1,
      })
      .returning();

    const [organicEarlierUser] = await db()
      .insert(users)
      .values({
        telegramId: baseTg + 3,
        videoId: video.id,
        name: "Organic Delayed",
        phone: "+998903030303",
        utmSource: null,
        utmCampaign: null,
        registeredAt: priorDate,
        wroteAdminAt: inRangeDay2,
        paidAt: inRangeDay2,
        createdAt: priorDate,
      })
      .returning();

    const [otherSourceUser] = await db()
      .insert(users)
      .values({
        telegramId: baseTg + 4,
        videoId: video.id,
        name: "YouTube Lead",
        phone: "+998904040404",
        utmSource: "youtube",
        utmCampaign: "yt_june",
        registeredAt: inRangeDay2,
        wroteAdminAt: inRangeDay2,
        createdAt: inRangeDay2,
      })
      .returning();

    await db().insert(events).values([
      { type: "bot_start", userId: fbToTgUser.id, createdAt: inRangeDay1 },
      { type: "registered", userId: fbToTgUser.id, createdAt: inRangeDay1 },
      { type: "channel_click", userId: fbToTgUser.id, createdAt: inRangeDay1 },
      { type: "bot_start", userId: igClickOnlyUser.id, createdAt: inRangeDay1 },
      { type: "registered", userId: igClickOnlyUser.id, createdAt: inRangeDay1 },
      { type: "channel_click", userId: igClickOnlyUser.id, createdAt: inRangeDay1 },
      { type: "bot_start", userId: otherSourceUser.id, createdAt: inRangeDay2 },
      { type: "registered", userId: otherSourceUser.id, createdAt: inRangeDay2 },
    ]);

    const statsRes = await app.request("/admin/stats?from=2026-06-01&to=2026-06-05", {
      method: "GET",
      headers: { cookie: adminSessionCookie },
    });
    expect(statsRes.status).toBe(200);
    const stats = adminStatsResponseSchema.parse(await statsRes.json());

    expect(stats.kpis).toEqual({
      landingViews: 0,
      botStarts: 3,
      registrations: 3,
      completions: 0,
      channelClicks: 2,
      realChats: 3,
      purchases: 2,
      conversionRate: 66.7,
    });

    const stepMap = Object.fromEntries(stats.funnel.map((s) => [s.step, s]));
    expect(stepMap.channel_click).toMatchObject({ name: "Adminga tugma bosdi", count: 2 });
    expect(stepMap.admin_chat).toMatchObject({ name: "Haqiqiy yozdi", count: 3, conversionRate: 150 });
    expect(stepMap.paid).toMatchObject({ name: "Sotib oldi", count: 2, conversionRate: 66.7 });

    const organicCampaign = stats.campaigns.find((c) => c.source === "" && c.campaign === "");
    expect(organicCampaign).toEqual({
      source: "",
      campaign: "",
      content: "",
      landingViews: 0,
      botStarts: 0,
      botStartRate: null,
      registrations: 0,
      completions: 0,
      completionRate: 0,
      channelClicks: 0,
      realChats: 1,
      purchases: 1,
    });

    expect(stats.attribution.firstTouch).toEqual([
      { network: "ig", registrations: 1, buttonClicks: 1, realChats: 0, purchases: 0 },
      { network: "fb", registrations: 1, buttonClicks: 1, realChats: 1, purchases: 1 },
      { network: "tg", registrations: 0, buttonClicks: 0, realChats: 0, purchases: 0 },
      { network: "organic", registrations: 0, buttonClicks: 0, realChats: 1, purchases: 1 },
      { network: "other", registrations: 1, buttonClicks: 0, realChats: 1, purchases: 0 },
    ]);

    expect(stats.attribution.lastTouch).toEqual([
      { network: "ig", registrations: 1, buttonClicks: 1, realChats: 0, purchases: 0 },
      { network: "fb", registrations: 0, buttonClicks: 0, realChats: 0, purchases: 0 },
      { network: "tg", registrations: 1, buttonClicks: 1, realChats: 1, purchases: 1 },
      { network: "organic", registrations: 0, buttonClicks: 0, realChats: 1, purchases: 1 },
      { network: "other", registrations: 1, buttonClicks: 0, realChats: 1, purchases: 0 },
    ]);

    const leadsRes = await app.request("/admin/leads?from=2026-06-01&to=2026-06-05", {
      method: "GET",
      headers: { cookie: adminSessionCookie },
    });
    expect(leadsRes.status).toBe(200);
    const leadsJson = adminLeadsResponseSchema.parse(await leadsRes.json());
    const fbLead = leadsJson.leads.find((l) => l.id === fbToTgUser.id);
    const igLead = leadsJson.leads.find((l) => l.id === igClickOnlyUser.id);
    const ytLead = leadsJson.leads.find((l) => l.id === otherSourceUser.id);
    expect(fbLead).toMatchObject({ channelClicked: true, wroteAdmin: true, paid: true });
    expect(igLead).toMatchObject({ channelClicked: true, wroteAdmin: false, paid: false });
    expect(ytLead).toMatchObject({ channelClicked: false, wroteAdmin: true, paid: false });
    expect(leadsJson.leads.find((l) => l.id === organicEarlierUser.id)).toBeUndefined();

    const csvRes = await app.request("/admin/leads.csv?from=2026-06-01&to=2026-06-05", {
      method: "GET",
      headers: { cookie: adminSessionCookie },
    });
    expect(csvRes.status).toBe(200);
    const csvLines = (await csvRes.text()).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    expect(csvLines[0]).toBe(
      "Ro'yxatdan o'tgan sana,Ism,Telefon,Username,Manba,Kampaniya,Ko'rish foizi,Tugatilgan,Tugma bosgan,Haqiqiy yozgan,Sotib olgan",
    );
    const fbCsvLine = csvLines.find((l) => l.includes("FB Then TG"));
    const igCsvLine = csvLines.find((l) => l.includes("IG Click Only"));
    const ytCsvLine = csvLines.find((l) => l.includes("YouTube Lead"));
    expect(fbCsvLine?.endsWith(",Ha,Ha,Ha")).toBe(true);
    expect(igCsvLine?.endsWith(",Ha,Yo'q,Yo'q")).toBe(true);
    expect(ytCsvLine?.endsWith(",Yo'q,Ha,Yo'q")).toBe(true);
  });
});
