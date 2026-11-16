import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  aggregateGroupBreakdowns,
  type AttributionModel,
  buildDefaultInstallmentSchedule,
  computeEnrollmentFinancials,
  type CourseInput,
  type CourseItem,
  type EnrollmentCreate,
  type EnrollmentStatus,
  type EnrollmentStudentRow,
  type EnrollmentUpdate,
  normalizeAttributionNetwork,
  type PaymentRecordCreate,
  type PaymentRecordItem,
  type PaymentsCatalogResponse,
  type PaymentsOverviewQuery,
  type PaymentsOverviewResponse,
  type PaymentUserLookupItem,
  type StudyGroupInput,
  type StudyGroupItem,
  type TariffInput,
  type TariffItem,
} from "@funnel/shared";
import { getTashkentToday } from "@/admin/dates";
import { db } from "@/db";
import {
  courses,
  enrollmentInstallments,
  enrollments,
  leads,
  payments,
  studyGroups,
  tariffs,
  users,
} from "@/db/schema";
import { markPaid } from "@/funnel/channel";
import { bumpLeadVersion, kickLeadNotifier } from "@/leads/notifier";

type DbExecutor = Pick<ReturnType<typeof db>, "select" | "insert" | "update" | "delete">;

function isPgForeignKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const direct = (error as { code?: unknown }).code;
  if (direct === "23503") return true;
  const cause = (error as { cause?: unknown }).cause;
  return Boolean(cause && typeof cause === "object" && (cause as { code?: unknown }).code === "23503");
}

export function resolvePaidAt(
  paidDate?: string,
  todayYmd = getTashkentToday(),
): { paidDate: string; paidAt: Date } {
  const resolvedDate = paidDate ?? todayYmd;
  const paidAt =
    resolvedDate === todayYmd ? new Date() : new Date(`${resolvedDate}T12:00:00+05:00`);
  return { paidDate: resolvedDate, paidAt };
}

export async function recordUserPurchaseSideEffects(userId: number, paidAt: Date): Promise<void> {
  await db()
    .update(leads)
    .set({ outcome: "won", outcomeAt: paidAt, ...bumpLeadVersion })
    .where(and(eq(leads.userId, userId), isNull(leads.outcome)));

  await markPaid(userId, null, paidAt);
  kickLeadNotifier();
}

function mapCourseItem(row: typeof courses.$inferSelect): CourseItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapPaymentRecordItem(row: typeof payments.$inferSelect): PaymentRecordItem {
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    amountUzs: row.amountUzs,
    paymentMethod: row.paymentMethod,
    status: row.status,
    paidDate: row.paidDate,
    paidAt: row.paidAt.toISOString(),
    reference: row.reference,
    note: row.note,
    receiptId: row.receiptId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getCatalog(): Promise<PaymentsCatalogResponse> {
  const [courseRows, tariffRows, groupRows] = await Promise.all([
    db().select().from(courses).orderBy(desc(courses.isActive), asc(courses.id)),
    db()
      .select({
        tariff: tariffs,
        courseTitle: courses.title,
      })
      .from(tariffs)
      .innerJoin(courses, eq(courses.id, tariffs.courseId))
      .orderBy(asc(tariffs.courseId), asc(tariffs.id)),
    db()
      .select({
        group: studyGroups,
        courseTitle: courses.title,
      })
      .from(studyGroups)
      .leftJoin(courses, eq(courses.id, studyGroups.courseId))
      .orderBy(desc(studyGroups.isActive), asc(studyGroups.id)),
  ]);

  return {
    courses: courseRows.map(mapCourseItem),
    tariffs: tariffRows.map(({ tariff, courseTitle }) => ({
      id: tariff.id,
      courseId: tariff.courseId,
      courseTitle,
      name: tariff.name,
      priceUzs: tariff.priceUzs,
      allowsInstallments: tariff.allowsInstallments,
      defaultInstallmentMonths: tariff.defaultInstallmentMonths,
      isActive: tariff.isActive,
      createdAt: tariff.createdAt.toISOString(),
    })),
    groups: groupRows.map(({ group, courseTitle }) => ({
      id: group.id,
      name: group.name,
      courseId: group.courseId,
      courseTitle: courseTitle ?? null,
      startsAt: group.startsAt,
      capacity: group.capacity,
      isActive: group.isActive,
      createdAt: group.createdAt.toISOString(),
    })),
  };
}

export async function createCourse(input: CourseInput): Promise<CourseItem> {
  const [created] = await db()
    .insert(courses)
    .values({
      title: input.title,
      description: input.description,
      isActive: input.isActive,
    })
    .returning();
  return mapCourseItem(created);
}

export async function updateCourse(id: number, input: CourseInput): Promise<CourseItem | null> {
  const [updated] = await db()
    .update(courses)
    .set({
      title: input.title,
      description: input.description,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(eq(courses.id, id))
    .returning();
  return updated ? mapCourseItem(updated) : null;
}

export async function deleteCourse(
  id: number,
): Promise<{ ok: true } | { ok: false; code: "not_found" | "course_in_use" }> {
  try {
    const deleted = await db().delete(courses).where(eq(courses.id, id)).returning({ id: courses.id });
    if (deleted.length === 0) return { ok: false, code: "not_found" };
    return { ok: true };
  } catch (error) {
    if (isPgForeignKeyError(error)) return { ok: false, code: "course_in_use" };
    throw error;
  }
}

export async function createTariff(
  input: TariffInput,
): Promise<{ ok: true; tariff: TariffItem } | { ok: false; code: "course_not_found" }> {
  const [course] = await db()
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(eq(courses.id, input.courseId))
    .limit(1);
  if (!course) return { ok: false, code: "course_not_found" };

  const [created] = await db()
    .insert(tariffs)
    .values({
      courseId: input.courseId,
      name: input.name,
      priceUzs: input.priceUzs,
      allowsInstallments: input.allowsInstallments,
      defaultInstallmentMonths: input.defaultInstallmentMonths,
      isActive: input.isActive,
    })
    .returning();

  return {
    ok: true,
    tariff: {
      id: created.id,
      courseId: created.courseId,
      courseTitle: course.title,
      name: created.name,
      priceUzs: created.priceUzs,
      allowsInstallments: created.allowsInstallments,
      defaultInstallmentMonths: created.defaultInstallmentMonths,
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
    },
  };
}

export async function updateTariff(
  id: number,
  input: TariffInput,
): Promise<{ ok: true; tariff: TariffItem } | { ok: false; code: "not_found" | "course_not_found" }> {
  const [course] = await db()
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(eq(courses.id, input.courseId))
    .limit(1);
  if (!course) return { ok: false, code: "course_not_found" };

  const [updated] = await db()
    .update(tariffs)
    .set({
      courseId: input.courseId,
      name: input.name,
      priceUzs: input.priceUzs,
      allowsInstallments: input.allowsInstallments,
      defaultInstallmentMonths: input.defaultInstallmentMonths,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(eq(tariffs.id, id))
    .returning();
  if (!updated) return { ok: false, code: "not_found" };

  return {
    ok: true,
    tariff: {
      id: updated.id,
      courseId: updated.courseId,
      courseTitle: course.title,
      name: updated.name,
      priceUzs: updated.priceUzs,
      allowsInstallments: updated.allowsInstallments,
      defaultInstallmentMonths: updated.defaultInstallmentMonths,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
    },
  };
}

export async function deleteTariff(
  id: number,
): Promise<{ ok: true } | { ok: false; code: "not_found" | "tariff_in_use" }> {
  try {
    const deleted = await db().delete(tariffs).where(eq(tariffs.id, id)).returning({ id: tariffs.id });
    if (deleted.length === 0) return { ok: false, code: "not_found" };
    return { ok: true };
  } catch (error) {
    if (isPgForeignKeyError(error)) return { ok: false, code: "tariff_in_use" };
    throw error;
  }
}

export async function createStudyGroup(
  input: StudyGroupInput,
): Promise<{ ok: true; group: StudyGroupItem } | { ok: false; code: "course_not_found" }> {
  let courseTitle: string | null = null;
  if (input.courseId !== null) {
    const [course] = await db()
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .limit(1);
    if (!course) return { ok: false, code: "course_not_found" };
    courseTitle = course.title;
  }

  const [created] = await db()
    .insert(studyGroups)
    .values({
      name: input.name,
      courseId: input.courseId,
      startsAt: input.startsAt,
      capacity: input.capacity,
      isActive: input.isActive,
    })
    .returning();

  return {
    ok: true,
    group: {
      id: created.id,
      name: created.name,
      courseId: created.courseId,
      courseTitle,
      startsAt: created.startsAt,
      capacity: created.capacity,
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
    },
  };
}

export async function updateStudyGroup(
  id: number,
  input: StudyGroupInput,
): Promise<{ ok: true; group: StudyGroupItem } | { ok: false; code: "not_found" | "course_not_found" }> {
  let courseTitle: string | null = null;
  if (input.courseId !== null) {
    const [course] = await db()
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .limit(1);
    if (!course) return { ok: false, code: "course_not_found" };
    courseTitle = course.title;
  }

  const [updated] = await db()
    .update(studyGroups)
    .set({
      name: input.name,
      courseId: input.courseId,
      startsAt: input.startsAt,
      capacity: input.capacity,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(eq(studyGroups.id, id))
    .returning();
  if (!updated) return { ok: false, code: "not_found" };

  return {
    ok: true,
    group: {
      id: updated.id,
      name: updated.name,
      courseId: updated.courseId,
      courseTitle,
      startsAt: updated.startsAt,
      capacity: updated.capacity,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
    },
  };
}

export async function deleteStudyGroup(
  id: number,
): Promise<{ ok: true } | { ok: false; code: "not_found" }> {
  const deleted = await db().delete(studyGroups).where(eq(studyGroups.id, id)).returning({ id: studyGroups.id });
  if (deleted.length === 0) return { ok: false, code: "not_found" };
  return { ok: true };
}

export async function searchUsersForPayments(q?: string): Promise<PaymentUserLookupItem[]> {
  const trimmed = q?.trim() ?? "";
  let whereClause;
  if (trimmed.length > 0) {
    const escaped = trimmed.replace(/[%_\\]/g, "\\$&");
    const pattern = `%${escaped}%`;
    const conditions = [
      ilike(users.name, pattern),
      ilike(users.firstName, pattern),
      ilike(users.username, pattern),
      ilike(users.phone, pattern),
    ];
    if (trimmed.startsWith("@") && trimmed.length > 1) {
      const handlePattern = `%${trimmed.slice(1).replace(/[%_\\]/g, "\\$&")}%`;
      conditions.push(ilike(users.username, handlePattern));
    }
    if (/^\d+$/.test(trimmed)) {
      const numericId = Number(trimmed);
      if (Number.isSafeInteger(numericId)) {
        conditions.push(eq(users.telegramId, numericId));
      }
    }
    whereClause = or(...conditions);
  }

  const activeCountExpr = sql<number>`(
    select count(*)::int
    from ${enrollments}
    where ${enrollments.userId} = ${users.id} and ${enrollments.status} = 'active'
  )`;

  const rows = await db()
    .select({
      id: users.id,
      telegramId: users.telegramId,
      name: users.name,
      firstName: users.firstName,
      username: users.username,
      phone: users.phone,
      wroteAdminAt: users.wroteAdminAt,
      paidAt: users.paidAt,
      activeEnrollmentCount: activeCountExpr,
    })
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.lastAdminChatAt), desc(users.registeredAt), desc(users.id))
    .limit(30);

  return rows.map((row) => ({
    id: row.id,
    telegramId: row.telegramId,
    name: row.name,
    firstName: row.firstName,
    username: row.username,
    phone: row.phone,
    wroteAdminAt: row.wroteAdminAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    activeEnrollmentCount: Number(row.activeEnrollmentCount ?? 0),
  }));
}

async function loadEnrollmentRows(
  executor: DbExecutor,
  opts?: { enrollmentId?: number; attributionModel?: AttributionModel; todayYmd?: string },
): Promise<EnrollmentStudentRow[]> {
  const attributionModel = opts?.attributionModel ?? "last";
  const todayYmd = opts?.todayYmd ?? getTashkentToday();

  const joined = await executor
    .select({
      enrollment: enrollments,
      user: users,
      courseTitle: courses.title,
      tariffName: tariffs.name,
      studyGroupName: studyGroups.name,
    })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(tariffs, eq(tariffs.id, enrollments.tariffId))
    .leftJoin(studyGroups, eq(studyGroups.id, enrollments.studyGroupId))
    .where(opts?.enrollmentId !== undefined ? eq(enrollments.id, opts.enrollmentId) : undefined)
    .orderBy(desc(enrollments.enrolledAt), desc(enrollments.id));

  if (joined.length === 0) return [];

  const enrollmentIds = joined.map((row) => row.enrollment.id);
  const [installmentRows, paymentRows] = await Promise.all([
    executor
      .select()
      .from(enrollmentInstallments)
      .where(inArray(enrollmentInstallments.enrollmentId, enrollmentIds))
      .orderBy(asc(enrollmentInstallments.dueDate), asc(enrollmentInstallments.installmentNo)),
    executor
      .select()
      .from(payments)
      .where(inArray(payments.enrollmentId, enrollmentIds))
      .orderBy(desc(payments.paidAt), desc(payments.id)),
  ]);

  const installmentsByEnrollment = new Map<number, (typeof enrollmentInstallments.$inferSelect)[]>();
  for (const inst of installmentRows) {
    const list = installmentsByEnrollment.get(inst.enrollmentId) ?? [];
    list.push(inst);
    installmentsByEnrollment.set(inst.enrollmentId, list);
  }

  const paymentsByEnrollment = new Map<number, (typeof payments.$inferSelect)[]>();
  for (const payment of paymentRows) {
    const list = paymentsByEnrollment.get(payment.enrollmentId) ?? [];
    list.push(payment);
    paymentsByEnrollment.set(payment.enrollmentId, list);
  }

  return joined.map(({ enrollment, user, courseTitle, tariffName, studyGroupName }) => {
    const insts = installmentsByEnrollment.get(enrollment.id) ?? [];
    const recs = paymentsByEnrollment.get(enrollment.id) ?? [];
    const verifiedPaidUzs = recs.reduce(
      (sum, rec) => (rec.status === "verified" ? sum + rec.amountUzs : sum),
      0,
    );
    const financials = computeEnrollmentFinancials({
      contractAmountUzs: enrollment.contractAmountUzs,
      installments: insts.map((inst) => ({
        id: inst.id,
        installmentNo: inst.installmentNo,
        dueDate: inst.dueDate,
        amountUzs: inst.amountUzs,
      })),
      verifiedPaidUzs,
      todayYmd,
    });

    const firstSource = user.utmSource ?? null;
    const firstCampaign = user.utmCampaign ?? null;
    const lastSource = user.lastUtmSource ?? user.utmSource ?? null;
    const lastCampaign = user.lastUtmCampaign ?? user.utmCampaign ?? null;
    const firstNetwork = normalizeAttributionNetwork(firstSource);
    const lastNetwork = normalizeAttributionNetwork(lastSource);
    const attributionNetwork = attributionModel === "first" ? firstNetwork : lastNetwork;

    return {
      id: enrollment.id,
      userId: enrollment.userId,
      telegramId: user.telegramId,
      name: user.name,
      firstName: user.firstName,
      username: user.username,
      phone: user.phone,
      courseId: enrollment.courseId,
      courseTitle,
      tariffId: enrollment.tariffId,
      tariffName,
      studyGroupId: enrollment.studyGroupId,
      studyGroupName: studyGroupName ?? null,
      status: enrollment.status,
      debtStatus: financials.debtStatus,
      contractAmountUzs: enrollment.contractAmountUzs,
      paidAmountUzs: verifiedPaidUzs,
      currentMonthDebtUzs: financials.currentMonthDebtUzs,
      totalRemainingUzs: financials.totalRemainingUzs,
      maturedDueUzs: financials.maturedDueUzs,
      maturedPaidUzs: financials.maturedPaidUzs,
      currentDueDate: financials.currentDueDate,
      nextDueDate: financials.nextDueDate,
      installmentMonths: enrollment.installmentMonths,
      note: enrollment.note,
      firstNetwork,
      firstSource,
      firstCampaign,
      lastNetwork,
      lastSource,
      lastCampaign,
      attributionNetwork,
      enrolledAt: enrollment.enrolledAt.toISOString(),
      createdAt: enrollment.createdAt.toISOString(),
      updatedAt: enrollment.updatedAt.toISOString(),
      installments: financials.installments,
      payments: recs.map(mapPaymentRecordItem),
    };
  });
}

export async function getEnrollmentRowById(
  id: number,
  attributionModel: AttributionModel = "last",
): Promise<EnrollmentStudentRow | null> {
  const rows = await loadEnrollmentRows(db(), { enrollmentId: id, attributionModel });
  return rows[0] ?? null;
}

export async function createEnrollment(input: EnrollmentCreate): Promise<
  | { ok: true; enrollment: EnrollmentStudentRow }
  | {
      ok: false;
      code:
        | "user_not_found"
        | "course_not_found"
        | "tariff_not_found"
        | "group_not_found"
        | "tariff_course_mismatch"
        | "invalid_installments";
    }
> {
  const todayYmd = getTashkentToday();
  const installmentsPlan =
    input.installments ??
    buildDefaultInstallmentSchedule(
      input.contractAmountUzs,
      input.installmentMonths,
      input.firstDueDate ?? todayYmd,
    );
  if (installmentsPlan.length < 1 || installmentsPlan.length > 36) {
    return { ok: false, code: "invalid_installments" };
  }

  let paidAtForSideEffects: Date | null = null;
  let createdEnrollmentId = 0;

  const txResult = await db().transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) return { ok: false as const, code: "user_not_found" as const };

    const [course] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .limit(1);
    if (!course) return { ok: false as const, code: "course_not_found" as const };

    const [tariff] = await tx
      .select({ id: tariffs.id, courseId: tariffs.courseId })
      .from(tariffs)
      .where(eq(tariffs.id, input.tariffId))
      .limit(1);
    if (!tariff) return { ok: false as const, code: "tariff_not_found" as const };
    if (tariff.courseId !== course.id) return { ok: false as const, code: "tariff_course_mismatch" as const };

    if (input.studyGroupId !== null) {
      const [group] = await tx
        .select({ id: studyGroups.id })
        .from(studyGroups)
        .where(eq(studyGroups.id, input.studyGroupId))
        .limit(1);
      if (!group) return { ok: false as const, code: "group_not_found" as const };
    }

    const initialPaidAmount = input.initialPayment ? input.initialPayment.amountUzs : 0;
    const status: EnrollmentStatus =
      initialPaidAmount >= input.contractAmountUzs ? "completed" : "active";

    const [created] = await tx
      .insert(enrollments)
      .values({
        userId: input.userId,
        courseId: input.courseId,
        tariffId: input.tariffId,
        studyGroupId: input.studyGroupId,
        status,
        contractAmountUzs: input.contractAmountUzs,
        installmentMonths: installmentsPlan.length,
        note: input.note,
      })
      .returning({ id: enrollments.id });

    await tx.insert(enrollmentInstallments).values(
      installmentsPlan.map((inst) => ({
        enrollmentId: created.id,
        installmentNo: inst.installmentNo,
        dueDate: inst.dueDate,
        amountUzs: inst.amountUzs,
      })),
    );

    if (input.initialPayment) {
      const { paidDate, paidAt } = resolvePaidAt(input.initialPayment.paidDate, todayYmd);
      paidAtForSideEffects = paidAt;
      await tx.insert(payments).values({
        enrollmentId: created.id,
        userId: input.userId,
        receiptId: null,
        amountUzs: input.initialPayment.amountUzs,
        paymentMethod: input.initialPayment.paymentMethod,
        status: "verified",
        paidDate,
        paidAt,
        reference: input.initialPayment.reference ?? null,
        note: input.initialPayment.note ?? null,
      });
    }

    createdEnrollmentId = created.id;
    return { ok: true as const };
  });

  if (!txResult.ok) return txResult;

  if (paidAtForSideEffects) {
    await recordUserPurchaseSideEffects(input.userId, paidAtForSideEffects);
  }

  const hydrated = await getEnrollmentRowById(createdEnrollmentId);
  return { ok: true, enrollment: hydrated! };
}

export async function updateEnrollment(
  id: number,
  input: EnrollmentUpdate,
): Promise<
  | { ok: true; enrollment: EnrollmentStudentRow }
  | {
      ok: false;
      code:
        | "not_found"
        | "course_not_found"
        | "tariff_not_found"
        | "group_not_found"
        | "tariff_course_mismatch"
        | "installments_sum_mismatch"
        | "installments_required"
        | "invalid_installments";
    }
> {
  const txResult = await db().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, id))
      .for("update")
      .limit(1);
    if (!existing) return { ok: false as const, code: "not_found" as const };

    const nextCourseId = input.courseId ?? existing.courseId;
    const nextTariffId = input.tariffId ?? existing.tariffId;

    if (input.courseId !== undefined || input.tariffId !== undefined) {
      const [course] = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.id, nextCourseId))
        .limit(1);
      if (!course) return { ok: false as const, code: "course_not_found" as const };

      const [tariff] = await tx
        .select({ id: tariffs.id, courseId: tariffs.courseId })
        .from(tariffs)
        .where(eq(tariffs.id, nextTariffId))
        .limit(1);
      if (!tariff) return { ok: false as const, code: "tariff_not_found" as const };
      if (tariff.courseId !== course.id) {
        return { ok: false as const, code: "tariff_course_mismatch" as const };
      }
    }

    if (input.studyGroupId !== undefined && input.studyGroupId !== null) {
      const [group] = await tx
        .select({ id: studyGroups.id })
        .from(studyGroups)
        .where(eq(studyGroups.id, input.studyGroupId))
        .limit(1);
      if (!group) return { ok: false as const, code: "group_not_found" as const };
    }

    const nextContractAmountUzs = input.contractAmountUzs ?? existing.contractAmountUzs;
    let nextInstallmentMonths = existing.installmentMonths;

    if (
      input.contractAmountUzs !== undefined &&
      input.contractAmountUzs !== existing.contractAmountUzs &&
      !input.installments
    ) {
      return { ok: false as const, code: "installments_required" as const };
    }

    if (input.installments) {
      if (input.installments.length < 1 || input.installments.length > 36) {
        return { ok: false as const, code: "invalid_installments" as const };
      }
      const sum = input.installments.reduce((acc, item) => acc + item.amountUzs, 0);
      if (sum !== nextContractAmountUzs) {
        return { ok: false as const, code: "installments_sum_mismatch" as const };
      }
      nextInstallmentMonths = input.installments.length;
      await tx.delete(enrollmentInstallments).where(eq(enrollmentInstallments.enrollmentId, id));
      await tx.insert(enrollmentInstallments).values(
        input.installments.map((inst) => ({
          enrollmentId: id,
          installmentNo: inst.installmentNo,
          dueDate: inst.dueDate,
          amountUzs: inst.amountUzs,
        })),
      );
    }

    const [paidRow] = await tx
      .select({
        total: sql<string>`coalesce(sum(${payments.amountUzs}), 0)::text`,
      })
      .from(payments)
      .where(and(eq(payments.enrollmentId, id), eq(payments.status, "verified")));
    const verifiedPaidUzs = Number(paidRow?.total ?? 0);

    let nextStatus: EnrollmentStatus;
    if (input.status === "cancelled" || (input.status === undefined && existing.status === "cancelled")) {
      nextStatus = "cancelled";
    } else {
      nextStatus = verifiedPaidUzs >= nextContractAmountUzs ? "completed" : "active";
    }

    await tx
      .update(enrollments)
      .set({
        courseId: nextCourseId,
        tariffId: nextTariffId,
        studyGroupId: input.studyGroupId !== undefined ? input.studyGroupId : existing.studyGroupId,
        status: nextStatus,
        contractAmountUzs: nextContractAmountUzs,
        installmentMonths: nextInstallmentMonths,
        note: input.note !== undefined ? input.note : existing.note,
        updatedAt: new Date(),
      })
      .where(eq(enrollments.id, id));

    return { ok: true as const };
  });

  if (!txResult.ok) return txResult;
  const hydrated = await getEnrollmentRowById(id);
  return { ok: true, enrollment: hydrated! };
}

export async function addPaymentToEnrollment(
  enrollmentId: number,
  input: PaymentRecordCreate,
  receiptId?: number | null,
): Promise<
  | { ok: true; enrollment: EnrollmentStudentRow; payment: PaymentRecordItem }
  | { ok: false; code: "not_found" | "enrollment_cancelled" }
> {
  const todayYmd = getTashkentToday();
  const { paidDate, paidAt } = resolvePaidAt(input.paidDate, todayYmd);

  const txResult = await db().transaction(async (tx) => {
    const [enrollment] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId))
      .for("update")
      .limit(1);
    if (!enrollment) return { ok: false as const, code: "not_found" as const };
    if (enrollment.status === "cancelled") {
      return { ok: false as const, code: "enrollment_cancelled" as const };
    }

    const [createdPayment] = await tx
      .insert(payments)
      .values({
        enrollmentId,
        userId: enrollment.userId,
        receiptId: receiptId ?? null,
        amountUzs: input.amountUzs,
        paymentMethod: input.paymentMethod,
        status: "verified",
        paidDate,
        paidAt,
        reference: input.reference ?? null,
        note: input.note ?? null,
      })
      .returning();

    const [paidRow] = await tx
      .select({
        total: sql<string>`coalesce(sum(${payments.amountUzs}), 0)::text`,
      })
      .from(payments)
      .where(and(eq(payments.enrollmentId, enrollmentId), eq(payments.status, "verified")));
    const verifiedPaidUzs = Number(paidRow?.total ?? 0);

    const nextStatus: EnrollmentStatus =
      verifiedPaidUzs >= enrollment.contractAmountUzs ? "completed" : "active";

    await tx
      .update(enrollments)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(enrollments.id, enrollmentId));

    return {
      ok: true as const,
      userId: enrollment.userId,
      payment: mapPaymentRecordItem(createdPayment),
    };
  });

  if (!txResult.ok) return txResult;

  await recordUserPurchaseSideEffects(txResult.userId, paidAt);
  const hydrated = await getEnrollmentRowById(enrollmentId);
  return { ok: true, enrollment: hydrated!, payment: txResult.payment };
}

export async function refundPayment(
  paymentId: number,
): Promise<
  | { ok: true; enrollment: EnrollmentStudentRow }
  | { ok: false; code: "not_found" | "already_refunded" }
> {
  const txResult = await db().transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update")
      .limit(1);
    if (!payment) return { ok: false as const, code: "not_found" as const };
    if (payment.status === "refunded") return { ok: false as const, code: "already_refunded" as const };

    await tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, paymentId));

    const [enrollment] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, payment.enrollmentId))
      .for("update")
      .limit(1);

    if (enrollment && enrollment.status !== "cancelled") {
      const [paidRow] = await tx
        .select({
          total: sql<string>`coalesce(sum(${payments.amountUzs}), 0)::text`,
        })
        .from(payments)
        .where(and(eq(payments.enrollmentId, enrollment.id), eq(payments.status, "verified")));
      const verifiedPaidUzs = Number(paidRow?.total ?? 0);
      const nextStatus: EnrollmentStatus =
        verifiedPaidUzs >= enrollment.contractAmountUzs ? "completed" : "active";
      await tx
        .update(enrollments)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(enrollments.id, enrollment.id));
    }

    return { ok: true as const, enrollmentId: payment.enrollmentId };
  });

  if (!txResult.ok) return txResult;
  const hydrated = await getEnrollmentRowById(txResult.enrollmentId);
  return { ok: true, enrollment: hydrated! };
}

export async function getPaymentsOverview(
  query: PaymentsOverviewQuery,
): Promise<PaymentsOverviewResponse> {
  const todayYmd = getTashkentToday();
  const [activeGroups, allStudents] = await Promise.all([
    db()
      .select({
        id: studyGroups.id,
        name: studyGroups.name,
        courseId: studyGroups.courseId,
        courseTitle: courses.title,
      })
      .from(studyGroups)
      .leftJoin(courses, eq(courses.id, studyGroups.courseId))
      .where(eq(studyGroups.isActive, true))
      .orderBy(asc(studyGroups.id)),
    loadEnrollmentRows(db(), { attributionModel: query.attributionModel, todayYmd }),
  ]);

  const searchTerm = query.search?.trim().toLowerCase() ?? "";
  const filteredStudents = allStudents.filter((student) => {
    if (query.courseId !== undefined && student.courseId !== query.courseId) return false;
    if (query.tariffId !== undefined && student.tariffId !== query.tariffId) return false;
    if (query.studyGroupId === "unassigned" && student.studyGroupId !== null) return false;
    if (typeof query.studyGroupId === "number" && student.studyGroupId !== query.studyGroupId) {
      return false;
    }
    if (query.debtStatus !== undefined && student.debtStatus !== query.debtStatus) return false;
    if (query.status !== undefined && student.status !== query.status) return false;
    if (query.network !== undefined && student.attributionNetwork !== query.network) return false;
    if (searchTerm) {
      const haystack = [
        student.name,
        student.firstName,
        student.username,
        student.phone,
        String(student.telegramId),
        student.courseTitle,
        student.tariffName,
        student.studyGroupName,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  });

  const nonCancelledMatching = filteredStudents.filter((student) => student.status !== "cancelled");
  const payingUserIds = new Set(nonCancelledMatching.map((student) => student.userId));
  const kpis = {
    totalPayingStudents: payingUserIds.size,
    totalCollectedUzs: nonCancelledMatching.reduce((sum, s) => sum + s.paidAmountUzs, 0),
    currentMonthExpectedDebtUzs: nonCancelledMatching.reduce(
      (sum, s) => sum + s.currentMonthDebtUzs,
      0,
    ),
    totalRemainingDebtUzs: nonCancelledMatching.reduce((sum, s) => sum + s.totalRemainingUzs, 0),
  };

  const groupEnrollments = allStudents.filter((student) => {
    if (student.status === "cancelled") return false;
    if (query.courseId !== undefined && student.courseId !== query.courseId) return false;
    if (query.network !== undefined && student.attributionNetwork !== query.network) return false;
    return true;
  });

  const matchedGroupIds = new Set(
    groupEnrollments
      .map((student) => student.studyGroupId)
      .filter((id): id is number => id !== null),
  );
  const filteredGroups = activeGroups.filter((group) => {
    if (query.courseId === undefined) return true;
    return group.courseId === query.courseId || matchedGroupIds.has(group.id);
  });

  const groups = aggregateGroupBreakdowns({
    groups: filteredGroups.map((group) => ({
      id: group.id,
      name: group.name,
      courseId: group.courseId,
      courseTitle: group.courseTitle ?? null,
    })),
    enrollments: groupEnrollments.map((student) => ({
      studyGroupId: student.studyGroupId,
      status: student.status,
      contractAmountUzs: student.contractAmountUzs,
      paidAmountUzs: student.paidAmountUzs,
      currentMonthDebtUzs: student.currentMonthDebtUzs,
      totalRemainingUzs: student.totalRemainingUzs,
      maturedDueUzs: student.maturedDueUzs,
      maturedPaidUzs: student.maturedPaidUzs,
    })),
  });

  return {
    todayYmd,
    attributionModel: query.attributionModel,
    kpis,
    students: filteredStudents,
    groups,
  };
}
