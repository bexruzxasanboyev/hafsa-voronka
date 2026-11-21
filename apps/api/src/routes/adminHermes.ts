import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { hermesPaymentsQuerySchema, type HermesPaymentItem, type HermesPaymentsTotals } from "@funnel/shared";
import { requireAdminAuth } from "@/admin/auth";
import { db } from "@/db";
import { hermesPayments, users } from "@/db/schema";
import { env } from "@/env";
import { getHermesHeartbeat } from "@/integrations/hermes/heartbeat";

export const adminHermesRoutes = new Hono();

adminHermesRoutes.use("*", requireAdminAuth);

adminHermesRoutes.get("/status", async (c) => {
  const configured = Boolean(env.HERMES_SYNC_SECRET);
  const heartbeat = await getHermesHeartbeat();
  return c.json({
    configured,
    lastSeenAt: heartbeat.lastSeenAt?.toISOString() ?? null,
    live: heartbeat.live,
  });
});

adminHermesRoutes.get("/payments", async (c) => {
  const query = hermesPaymentsQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: "invalid_query" }, 400);
  }

  const { kind, limit } = query.data;

  const [rows, totalRows] = await Promise.all([
    db()
      .select({
        payment: hermesPayments,
        userName: users.name,
        userFirstName: users.firstName,
        userUsername: users.username,
      })
      .from(hermesPayments)
      .leftJoin(users, eq(users.id, hermesPayments.userId))
      .where(kind ? eq(hermesPayments.kind, kind) : undefined)
      .orderBy(
        sql`coalesce(${hermesPayments.payDate}, (${hermesPayments.hermesCreatedAt})::date::text) desc`,
        desc(hermesPayments.hermesId),
      )
      .limit(limit),
    db()
      .select({
        kind: hermesPayments.kind,
        count: sql<number>`count(*)::int`,
        amountUzs: sql<string>`coalesce(sum(${hermesPayments.amountUzs}), 0)::text`,
      })
      .from(hermesPayments)
      .groupBy(hermesPayments.kind),
  ]);

  const items: HermesPaymentItem[] = rows.map(({ payment, userName, userFirstName, userUsername }) => ({
    hermesId: payment.hermesId,
    telegramId: payment.telegramId,
    userId: payment.userId,
    userName: userName ?? userFirstName ?? userUsername ?? null,
    payDate: payment.payDate,
    amountUzs: payment.amountUzs,
    monthNo: payment.monthNo,
    tariff: payment.tariff,
    confidence: payment.confidence,
    kind: payment.kind,
    hermesCreatedAt: payment.hermesCreatedAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  }));

  const totals: HermesPaymentsTotals = {
    paid: { count: 0, amountUzs: 0 },
    deposit: { count: 0, amountUzs: 0 },
    ignored: { count: 0 },
  };
  for (const row of totalRows) {
    if (row.kind === "paid") {
      totals.paid = { count: Number(row.count), amountUzs: Number(row.amountUzs) };
    } else if (row.kind === "deposit") {
      totals.deposit = { count: Number(row.count), amountUzs: Number(row.amountUzs) };
    } else if (row.kind === "ignored") {
      totals.ignored = { count: Number(row.count) };
    }
  }

  return c.json({ items, totals });
});
