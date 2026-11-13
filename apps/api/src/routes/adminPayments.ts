import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  addPaymentSchema,
  createCatalogItemSchema,
  createEnrollmentSchema,
  type DebtStatus,
  type EnrollmentItem,
  type GroupBreakdownItem,
  type NetworkAttributionItem,
  normalizeSourceNetwork,
  type PaymentsDashboardResponse,
  type SourceNetwork,
  sourceNetworks,
  TASHKENT_OFFSET_MS,
  updateEnrollmentSchema,
} from "@funnel/shared";
import { requireAdminAuth } from "@/admin/auth";
import { db } from "@/db";
import { courses, enrollments, payments, studyGroups, tariffs, users } from "@/db/schema";

export const adminPaymentRoutes = new Hono();

adminPaymentRoutes.use("*", requireAdminAuth);

function tashkentTodayIso(): string {
  const local = new Date(Date.now() + TASHKENT_OFFSET_MS);
  return local.toISOString().slice(0, 10);
}

function computeStatus(
  totalPrice: number,
  paidAmount: number,
  currentMonthDue: number,
  dueDate: string | null,
  today: string,
): DebtStatus {
  if (paidAmount >= totalPrice && totalPrice > 0) return "paid";
  if (totalPrice === 0) return "paid";
  if (currentMonthDue > 0 && dueDate && dueDate < today) return "overdue";
  return "installment";
}

adminPaymentRoutes.get("/", async (c) => {
  const [enrollmentRows, paymentRows, courseRows, tariffRows, groupRows] = await Promise.all([
    db().select().from(enrollments).orderBy(desc(enrollments.createdAt), desc(enrollments.id)),
    db().select().from(payments).orderBy(desc(payments.paidAt), desc(payments.id)),
    db().select().from(courses).orderBy(courses.name),
    db().select().from(tariffs).orderBy(tariffs.price),
    db().select().from(studyGroups).orderBy(studyGroups.name),
  ]);

  const paymentsByEnrollment = new Map<number, typeof paymentRows>();
  for (const p of paymentRows) {
    const list = paymentsByEnrollment.get(p.enrollmentId) ?? [];
    list.push(p);
    paymentsByEnrollment.set(p.enrollmentId, list);
  }

  const today = tashkentTodayIso();

  const items: EnrollmentItem[] = enrollmentRows.map((row) => {
    const rowPayments = paymentsByEnrollment.get(row.id) ?? [];
    const paidAmount = rowPayments.reduce((sum, p) => sum + p.amount, 0);
    const remainingBalance = Math.max(0, row.totalPrice - paidAmount);
    const firstPaidAt =
      rowPayments.length > 0
        ? rowPayments[rowPayments.length - 1]!.paidAt.toISOString()
        : null;
    const status = computeStatus(row.totalPrice, paidAmount, row.currentMonthDue, row.dueDate, today);

    return {
      id: row.id,
      userId: row.userId,
      studentName: row.studentName,
      phone: row.phone,
      telegramId: row.telegramId,
      username: row.username,
      sourceNetwork: row.sourceNetwork as SourceNetwork,
      courseId: row.courseId,
      courseName: row.courseName,
      tariffId: row.tariffId,
      tariffName: row.tariffName,
      groupId: row.groupId,
      groupName: row.groupName,
      totalPrice: row.totalPrice,
      paidAmount,
      firstPaidAt,
      currentMonthDue: row.currentMonthDue,
      dueDate: row.dueDate,
      remainingBalance,
      status,
      notes: row.notes,
      payments: rowPayments.map((p) => ({
        id: p.id,
        amount: p.amount,
        paidAt: p.paidAt.toISOString(),
        note: p.note,
      })),
      createdAt: row.createdAt.toISOString(),
    };
  });

  const summary = {
    totalPaidStudents: items.filter((i) => i.paidAmount > 0).length,
    totalPaidAmount: items.reduce((sum, i) => sum + i.paidAmount, 0),
    totalCurrentMonthDebt: items.reduce((sum, i) => sum + Math.min(i.currentMonthDue, i.remainingBalance), 0),
    totalRemainingDebt: items.reduce((sum, i) => sum + i.remainingBalance, 0),
  };

  const netMap = new Map<SourceNetwork, NetworkAttributionItem>();
  for (const net of sourceNetworks) {
    netMap.set(net, { network: net, studentCount: 0, totalContract: 0, totalPaid: 0 });
  }
  for (const item of items) {
    const entry = netMap.get(item.sourceNetwork) ?? netMap.get("organic")!;
    entry.studentCount += 1;
    entry.totalContract += item.totalPrice;
    entry.totalPaid += item.paidAmount;
  }

  const groupMap = new Map<string, GroupBreakdownItem>();
  for (const item of items) {
    const key = item.groupName?.trim() || "Guruhsiz";
    const existing = groupMap.get(key) ?? {
      groupId: item.groupId,
      groupName: key,
      studentCount: 0,
      totalContract: 0,
      totalPaid: 0,
      currentMonthDebt: 0,
      totalRemainingDebt: 0,
      disciplinePercent: 100,
    };
    existing.studentCount += 1;
    existing.totalContract += item.totalPrice;
    existing.totalPaid += item.paidAmount;
    existing.currentMonthDebt += Math.min(item.currentMonthDue, item.remainingBalance);
    existing.totalRemainingDebt += item.remainingBalance;
    groupMap.set(key, existing);
  }
  const groups = [...groupMap.values()].map((g) => ({
    ...g,
    disciplinePercent: g.totalContract > 0 ? Math.min(100, Math.round((g.totalPaid / g.totalContract) * 100)) : 100,
  }));

  const response: PaymentsDashboardResponse = {
    summary,
    networkAttribution: sourceNetworks.map((n) => netMap.get(n)!),
    enrollments: items,
    groups,
    courses: courseRows.map((r) => ({ id: r.id, name: r.name })),
    tariffs: tariffRows.map((r) => ({ id: r.id, courseId: r.courseId, name: r.name, price: r.price })),
    studyGroups: groupRows.map((r) => ({ id: r.id, name: r.name, courseId: r.courseId })),
  };

  return c.json(response);
});

adminPaymentRoutes.get("/lookup-user", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q) return c.json({ items: [] });

  const numericId = /^\d+$/.test(q) ? Number(q) : null;
  const pattern = `%${q}%`;
  const rows = await db()
    .select({
      id: users.id,
      telegramId: users.telegramId,
      username: users.username,
      name: users.name,
      firstName: users.firstName,
      phone: users.phone,
      utmSource: users.utmSource,
    })
    .from(users)
    .where(
      or(
        numericId ? eq(users.telegramId, numericId) : undefined,
        ilike(users.name, pattern),
        ilike(users.firstName, pattern),
        ilike(users.username, pattern),
        ilike(users.phone, pattern),
      ),
    )
    .limit(10);

  return c.json({
    items: rows.map((r) => ({
      userId: r.id,
      telegramId: r.telegramId,
      username: r.username,
      studentName: r.name || r.firstName || r.username || String(r.telegramId),
      phone: r.phone,
      sourceNetwork: normalizeSourceNetwork(r.utmSource),
    })),
  });
});

adminPaymentRoutes.post("/enrollments", async (c) => {
  const body = createEnrollmentSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const data = body.data;
  let matchedUser: { id: number; telegramId: number; username: string | null; phone: string | null; utmSource: string | null } | undefined;

  if (data.userId) {
    [matchedUser] = await db()
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        phone: users.phone,
        utmSource: users.utmSource,
      })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);
  } else if (data.telegramId) {
    [matchedUser] = await db()
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        phone: users.phone,
        utmSource: users.utmSource,
      })
      .from(users)
      .where(eq(users.telegramId, data.telegramId))
      .limit(1);
  } else if (data.phone) {
    [matchedUser] = await db()
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        phone: users.phone,
        utmSource: users.utmSource,
      })
      .from(users)
      .where(eq(users.phone, data.phone))
      .limit(1);
  }

  const resolvedNetwork = data.sourceNetwork ?? normalizeSourceNetwork(matchedUser?.utmSource);

  const created = await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(enrollments)
      .values({
        userId: matchedUser?.id ?? data.userId ?? null,
        studentName: data.studentName,
        phone: data.phone ?? matchedUser?.phone ?? null,
        telegramId: data.telegramId ?? matchedUser?.telegramId ?? null,
        username: data.username ?? matchedUser?.username ?? null,
        sourceNetwork: resolvedNetwork,
        courseId: data.courseId ?? null,
        courseName: data.courseName,
        tariffId: data.tariffId ?? null,
        tariffName: data.tariffName,
        groupId: data.groupId ?? null,
        groupName: data.groupName ?? null,
        totalPrice: data.totalPrice,
        currentMonthDue: data.currentMonthDue ?? 0,
        dueDate: data.dueDate ?? null,
        notes: data.notes ?? null,
      })
      .returning();

    if (data.initialPaidAmount && data.initialPaidAmount > 0) {
      await tx.insert(payments).values({
        enrollmentId: row.id,
        amount: data.initialPaidAmount,
        paidAt: data.initialPaidAt ? new Date(data.initialPaidAt) : new Date(),
        note: "1-to‘lov",
      });
    }

    return row;
  });

  return c.json({ id: created.id }, 201);
});

adminPaymentRoutes.patch("/enrollments/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);

  const body = updateEnrollmentSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const data = body.data;
  const [updated] = await db()
    .update(enrollments)
    .set({
      ...(data.studentName !== undefined ? { studentName: data.studentName } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.telegramId !== undefined ? { telegramId: data.telegramId } : {}),
      ...(data.username !== undefined ? { username: data.username } : {}),
      ...(data.sourceNetwork !== undefined ? { sourceNetwork: data.sourceNetwork } : {}),
      ...(data.courseId !== undefined ? { courseId: data.courseId } : {}),
      ...(data.courseName !== undefined ? { courseName: data.courseName } : {}),
      ...(data.tariffId !== undefined ? { tariffId: data.tariffId } : {}),
      ...(data.tariffName !== undefined ? { tariffName: data.tariffName } : {}),
      ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
      ...(data.groupName !== undefined ? { groupName: data.groupName } : {}),
      ...(data.totalPrice !== undefined ? { totalPrice: data.totalPrice } : {}),
      ...(data.currentMonthDue !== undefined ? { currentMonthDue: data.currentMonthDue } : {}),
      ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(enrollments.id, id))
    .returning();

  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

adminPaymentRoutes.delete("/enrollments/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  const deleted = await db().delete(enrollments).where(eq(enrollments.id, id)).returning({ id: enrollments.id });
  if (deleted.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

adminPaymentRoutes.post("/enrollments/:id/payments", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);

  const body = addPaymentSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const [exists] = await db().select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.id, id)).limit(1);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const [created] = await db()
    .insert(payments)
    .values({
      enrollmentId: id,
      amount: body.data.amount,
      paidAt: body.data.paidAt ? new Date(body.data.paidAt) : new Date(),
      note: body.data.note ?? null,
    })
    .returning();

  await db()
    .update(enrollments)
    .set({
      currentMonthDue: sql`GREATEST(0, ${enrollments.currentMonthDue} - ${body.data.amount})`,
      updatedAt: new Date(),
    })
    .where(eq(enrollments.id, id));

  return c.json({ id: created.id }, 201);
});

adminPaymentRoutes.post("/catalog", async (c) => {
  const body = createCatalogItemSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const data = body.data;
  if (data.kind === "course") {
    const [row] = await db().insert(courses).values({ name: data.name }).onConflictDoNothing().returning();
    return c.json({ ok: true, id: row?.id ?? null }, 201);
  }
  if (data.kind === "tariff") {
    const [row] = await db()
      .insert(tariffs)
      .values({ courseId: data.courseId, name: data.name, price: data.price })
      .onConflictDoNothing()
      .returning();
    return c.json({ ok: true, id: row?.id ?? null }, 201);
  }
  const [row] = await db()
    .insert(studyGroups)
    .values({ name: data.name, courseId: data.courseId ?? null })
    .onConflictDoNothing()
    .returning();
  return c.json({ ok: true, id: row?.id ?? null }, 201);
});
