import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  adminLeadsQuerySchema,
  adminLoginRequestSchema,
  adminStatsQuerySchema,
  campaignLinkCreateSchema,
} from "@funnel/shared";
import { db } from "@/db";
import { campaignLinks } from "@/db/schema";
import {
  clearAdminSessionCookie,
  getAdminPasswordHash,
  requireAdminAuth,
  requireAdminConfig,
  setAdminSessionCookie,
  verifyAdminSession,
  verifyPassword,
} from "@/admin/auth";
import { resolveDateRange } from "@/admin/dates";
import {
  getCampaignStats,
  getDailySeries,
  getFunnelAndKpis,
  getHealthStats,
  getLeads,
  getLeadsCsv,
  getWatchDropoff,
} from "@/admin/queries";
import { clientIp } from "@/http/clientIp";
import { consumeRateLimit } from "@/http/rateLimit";
import { adminBotTextRoutes } from "@/routes/adminBotTexts";
import { adminVideoRoutes } from "@/routes/adminVideos";
import { adminMessageRoutes } from "@/routes/adminMessages";
import { adminReportRoutes } from "@/routes/adminReports";
import { adminSettingsRoutes } from "@/routes/adminSettings";
import { adminPaymentRoutes } from "@/routes/adminPayments";

export const adminRoutes = new Hono();

adminRoutes.use("*", requireAdminConfig);

adminRoutes.route("/bot-texts", adminBotTextRoutes);
adminRoutes.route("/videos", adminVideoRoutes);
adminRoutes.route("/messages", adminMessageRoutes);
adminRoutes.route("/reports", adminReportRoutes);
adminRoutes.route("/settings", adminSettingsRoutes);
adminRoutes.route("/payments", adminPaymentRoutes);

adminRoutes.post("/login", async (c) => {
  const ip = clientIp(c);
  const allowed = await consumeRateLimit(`login:${ip}`, 5, 900);
  if (!allowed) {
    return c.json({ error: "rate_limited" }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = adminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const hash = getAdminPasswordHash();
  const valid = await verifyPassword(parsed.data.password, hash!);
  if (!valid) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const token = await setAdminSessionCookie(c);
  return c.json({ ok: true, token });
});

adminRoutes.post("/logout", (c) => {
  clearAdminSessionCookie(c);
  return c.json({ ok: true });
});

adminRoutes.get("/me", async (c) => {
  const valid = await verifyAdminSession(c);
  if (!valid) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json({ ok: true });
});

adminRoutes.get("/stats", requireAdminAuth, async (c) => {
  const query = adminStatsQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: "invalid_query" }, 400);
  }

  const { from, to } = resolveDateRange(query.data.from, query.data.to);
  const filters = {
    from,
    to,
    source: query.data.source || undefined,
    campaign: query.data.campaign || undefined,
  };

  const [funnelAndKpis, daily, campaigns, dropoff, health] = await Promise.all([
    getFunnelAndKpis(filters),
    getDailySeries(filters),
    getCampaignStats(filters),
    getWatchDropoff(filters),
    getHealthStats(),
  ]);

  return c.json({
    from,
    to,
    kpis: funnelAndKpis.kpis,
    funnel: funnelAndKpis.funnel,
    daily,
    campaigns,
    dropoff,
    health,
  });
});

adminRoutes.get("/leads", requireAdminAuth, async (c) => {
  const query = adminLeadsQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: "invalid_query" }, 400);
  }

  const { from, to } = resolveDateRange(query.data.from, query.data.to);
  const filters = {
    from,
    to,
    source: query.data.source || undefined,
    campaign: query.data.campaign || undefined,
  };

  const result = await getLeads(filters, query.data.page, 50);
  return c.json(result);
});

adminRoutes.get("/campaign-links", requireAdminAuth, async (c) => {
  const rows = await db().select().from(campaignLinks).orderBy(desc(campaignLinks.createdAt));
  return c.json({
    items: rows.map((r) => ({
      code: r.code,
      utmSource: r.utm?.utm_source ?? null,
      utmCampaign: r.utm?.utm_campaign ?? null,
      utmContent: r.utm?.utm_content ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

adminRoutes.post("/campaign-links", requireAdminAuth, async (c) => {
  const body = campaignLinkCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const code =
    body.data.code ||
    `${body.data.utm_source.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "ad"}_${crypto.randomBytes(3).toString("hex")}`;

  const [row] = await db()
    .insert(campaignLinks)
    .values({
      code,
      utm: {
        utm_source: body.data.utm_source,
        utm_campaign: body.data.utm_campaign || undefined,
        utm_content: body.data.utm_content || undefined,
      },
    })
    .onConflictDoNothing()
    .returning();

  if (!row) return c.json({ error: "code_exists" }, 409);

  return c.json(
    {
      code: row.code,
      utmSource: row.utm?.utm_source ?? null,
      utmCampaign: row.utm?.utm_campaign ?? null,
      utmContent: row.utm?.utm_content ?? null,
      createdAt: row.createdAt.toISOString(),
    },
    201,
  );
});

adminRoutes.delete("/campaign-links/:code", requireAdminAuth, async (c) => {
  const code = c.req.param("code");
  await db().delete(campaignLinks).where(eq(campaignLinks.code, code));
  return c.json({ ok: true });
});

adminRoutes.get("/leads.csv", requireAdminAuth, async (c) => {
  const query = adminStatsQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: "invalid_query" }, 400);
  }

  const { from, to } = resolveDateRange(query.data.from, query.data.to);
  const filters = {
    from,
    to,
    source: query.data.source || undefined,
    campaign: query.data.campaign || undefined,
  };

  const csv = await getLeadsCsv(filters);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${from}-${to}.csv"`,
      "cache-control": "no-store",
    },
  });
});
