import { Hono } from "hono";
import {
  adminLeadsQuerySchema,
  adminLoginRequestSchema,
  adminStatsQuerySchema,
} from "@funnel/shared";
import {
  findAdminByUsername,
  recordLogin,
} from "@/admin/accounts";
import {
  type AdminEnv,
  clearAdminSessionCookie,
  createAdminSession,
  requireAdminAuth,
  requireAdminConfig,
  resolveAdminSession,
  revokePresentedSessions,
  setAdminSessionCookie,
} from "@/admin/auth";
import { verifyAgainstDummy, verifyPassword } from "@/admin/password";
import { resolveDateRange } from "@/admin/dates";
import {
  getCampaignStats,
  getDailySeries,
  getFilterOptions,
  getFunnelAndKpis,
  getHealthStats,
  getLeads,
  getLeadsCsv,
  getNetworkAttribution,
  getWatchDropoff,
} from "@/admin/queries";
import { clientIp } from "@/http/clientIp";
import { consumeRateLimit } from "@/http/rateLimit";
import { adminAccountRoutes } from "@/routes/adminAccounts";
import { adminBotTextRoutes } from "@/routes/adminBotTexts";
import { adminBroadcastRoutes } from "@/routes/adminBroadcasts";
import { adminHermesRoutes } from "@/routes/adminHermes";
import { adminLinkRoutes } from "@/routes/adminLinks";
import { adminVideoRoutes } from "@/routes/adminVideos";
import { adminMessageRoutes } from "@/routes/adminMessages";
import { adminPaymentRoutes } from "@/routes/adminPayments";
import { adminReportRoutes } from "@/routes/adminReports";
import { adminSettingsRoutes } from "@/routes/adminSettings";

export const adminRoutes = new Hono<AdminEnv>();

adminRoutes.use("*", requireAdminConfig);

adminRoutes.route("/", adminAccountRoutes);
adminRoutes.route("/bot-texts", adminBotTextRoutes);
adminRoutes.route("/broadcasts", adminBroadcastRoutes);
adminRoutes.route("/hermes", adminHermesRoutes);
adminRoutes.route("/links", adminLinkRoutes);
adminRoutes.route("/videos", adminVideoRoutes);
adminRoutes.route("/messages", adminMessageRoutes);
adminRoutes.route("/payments", adminPaymentRoutes);
adminRoutes.route("/reports", adminReportRoutes);
adminRoutes.route("/settings", adminSettingsRoutes);

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

  const { username, password } = parsed.data;
  if (!(await consumeRateLimit(`login-user:${username}`, 10, 900))) {
    return c.json({ error: "rate_limited" }, 429);
  }

  const admin = await findAdminByUsername(username);
  const valid = admin ? await verifyPassword(password, admin.passwordHash) : await verifyAgainstDummy(password);
  if (!admin || !valid) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  const token = await createAdminSession(admin.id);
  await recordLogin(admin.id);
  setAdminSessionCookie(c, token);
  return c.json({ ok: true, token, admin: { id: admin.id, username: admin.username } });
});

adminRoutes.post("/logout", async (c) => {
  await revokePresentedSessions(c);
  clearAdminSessionCookie(c);
  return c.json({ ok: true });
});

adminRoutes.get("/me", async (c) => {
  const session = await resolveAdminSession(c);
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json({ ok: true, admin: session.admin });
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

  const [funnelAndKpis, daily, campaigns, dropoff, health, filterOptions, attribution] = await Promise.all([
    getFunnelAndKpis(filters),
    getDailySeries(filters),
    getCampaignStats(filters),
    getWatchDropoff(filters),
    getHealthStats(),
    getFilterOptions(),
    getNetworkAttribution(filters),
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
    filterOptions,
    attribution,
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
