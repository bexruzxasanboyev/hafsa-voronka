import { z } from "zod";
import { attributionNetworks, type AttributionNetwork } from "./admin";

export const paymentMethods = [
  "click",
  "payme",
  "uzum",
  "card_transfer",
  "bank",
  "cash",
  "other",
] as const;

export type PaymentMethod = (typeof paymentMethods)[number];

export const enrollmentStatuses = ["active", "completed", "cancelled"] as const;

export type EnrollmentStatus = (typeof enrollmentStatuses)[number];

export const debtStatuses = ["paid", "installment", "overdue"] as const;

export type DebtStatus = (typeof debtStatuses)[number];

export const installmentStates = ["paid", "upcoming", "overdue"] as const;

export type InstallmentState = (typeof installmentStates)[number];

export const paymentRecordStatuses = ["verified", "refunded"] as const;

export type PaymentRecordStatus = (typeof paymentRecordStatuses)[number];

export const receiptStatuses = ["pending", "confirmed", "rejected"] as const;

export type ReceiptStatus = (typeof receiptStatuses)[number];

export const receiptMediaTypes = ["photo", "pdf"] as const;

export type ReceiptMediaType = (typeof receiptMediaTypes)[number];

export const receiptSources = ["business_dm", "admin_upload"] as const;

export type ReceiptSource = (typeof receiptSources)[number];

export const receiptOcrStatuses = ["skipped", "ok", "failed"] as const;

export type ReceiptOcrStatus = (typeof receiptOcrStatuses)[number];

export const attributionModels = ["first", "last"] as const;

export type AttributionModel = (typeof attributionModels)[number];

export const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;

export function isValidYmdDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const ymdDateSchema = z.string().refine(isValidYmdDate, {
  message: "invalid_date",
});

function parseYmdParts(ymd: string): { year: number; month: number; day: number } {
  if (!isValidYmdDate(ymd)) {
    throw new Error(`Invalid YYYY-MM-DD date: ${ymd}`);
  }
  const [yearStr, monthStr, dayStr] = ymd.split("-");
  return {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  };
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatYmdParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeAttributionNetwork(
  source: string | null | undefined,
): AttributionNetwork {
  const trimmed = source?.trim() ?? "";
  if (!trimmed) return "organic";
  if (/^(ig|insta)/i.test(trimmed)) return "ig";
  if (/^(fb|facebook|meta)/i.test(trimmed)) return "fb";
  if (/^(tg|telegram)/i.test(trimmed)) return "tg";
  return "other";
}

export function addCalendarMonths(ymd: string, months: number): string {
  if (!Number.isInteger(months)) {
    throw new Error(`months must be an integer, got ${months}`);
  }
  const { year, month, day } = parseYmdParts(ymd);
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (((totalMonths % 12) + 12) % 12) + 1;
  const maxDay = daysInCalendarMonth(targetYear, targetMonth);
  return formatYmdParts(targetYear, targetMonth, Math.min(day, maxDay));
}

export function endOfCalendarMonth(ymd: string): string {
  const { year, month } = parseYmdParts(ymd);
  return formatYmdParts(year, month, daysInCalendarMonth(year, month));
}

export const installmentInputSchema = z.object({
  installmentNo: z.number().int().positive(),
  dueDate: ymdDateSchema,
  amountUzs: z.number().int().nonnegative(),
});

export type InstallmentInput = z.infer<typeof installmentInputSchema>;

export function buildDefaultInstallmentSchedule(
  contractAmountUzs: number,
  installmentMonths: number,
  firstDueDate: string,
): InstallmentInput[] {
  if (!Number.isInteger(contractAmountUzs) || contractAmountUzs < 0) {
    throw new Error(`contractAmountUzs must be a non-negative integer`);
  }
  if (!Number.isInteger(installmentMonths) || installmentMonths < 1) {
    throw new Error(`installmentMonths must be a positive integer`);
  }
  parseYmdParts(firstDueDate);
  const base = Math.floor(contractAmountUzs / installmentMonths);
  const remainder = contractAmountUzs - base * installmentMonths;
  const schedule: InstallmentInput[] = [];
  for (let i = 0; i < installmentMonths; i += 1) {
    schedule.push({
      installmentNo: i + 1,
      dueDate: addCalendarMonths(firstDueDate, i),
      amountUzs: i === 0 ? base + remainder : base,
    });
  }
  return schedule;
}

export const computedInstallmentSchema = z.object({
  id: z.number().int().positive().optional(),
  installmentNo: z.number().int().positive(),
  dueDate: ymdDateSchema,
  amountUzs: z.number().int().nonnegative(),
  paidUzs: z.number().int().nonnegative(),
  remainingUzs: z.number().int().nonnegative(),
  state: z.enum(installmentStates),
});

export type ComputedInstallment = z.infer<typeof computedInstallmentSchema>;

export type ComputeEnrollmentFinancialsInput = {
  contractAmountUzs: number;
  installments: {
    id?: number;
    installmentNo: number;
    dueDate: string;
    amountUzs: number;
  }[];
  verifiedPaidUzs: number;
  todayYmd: string;
};

export type EnrollmentFinancials = {
  installments: ComputedInstallment[];
  totalRemainingUzs: number;
  currentMonthDebtUzs: number;
  currentDueDate: string | null;
  nextDueDate: string | null;
  maturedDueUzs: number;
  maturedPaidUzs: number;
  debtStatus: DebtStatus;
};

export function computeEnrollmentFinancials(
  input: ComputeEnrollmentFinancialsInput,
): EnrollmentFinancials {
  const sorted = [...input.installments].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNo - b.installmentNo,
  );
  let pool = Math.max(0, input.verifiedPaidUzs);
  const computed: ComputedInstallment[] = sorted.map((inst) => {
    const paidUzs = Math.min(inst.amountUzs, Math.max(0, pool));
    pool -= paidUzs;
    const remainingUzs = inst.amountUzs - paidUzs;
    const state: InstallmentState =
      remainingUzs === 0
        ? "paid"
        : inst.dueDate < input.todayYmd
          ? "overdue"
          : "upcoming";
    return {
      ...(inst.id !== undefined ? { id: inst.id } : {}),
      installmentNo: inst.installmentNo,
      dueDate: inst.dueDate,
      amountUzs: inst.amountUzs,
      paidUzs,
      remainingUzs,
      state,
    };
  });

  const totalRemainingUzs = Math.max(0, input.contractAmountUzs - input.verifiedPaidUzs);
  const monthEndYmd = endOfCalendarMonth(input.todayYmd);

  let currentMonthDebtUzs = 0;
  let currentDueDate: string | null = null;
  let nextDueDate: string | null = null;
  let maturedDueUzs = 0;
  let maturedPaidUzs = 0;

  for (const inst of computed) {
    if (inst.dueDate <= monthEndYmd) {
      currentMonthDebtUzs += inst.remainingUzs;
      if (inst.remainingUzs > 0 && currentDueDate === null) {
        currentDueDate = inst.dueDate;
      }
    }
    if (inst.remainingUzs > 0 && nextDueDate === null) {
      nextDueDate = inst.dueDate;
    }
    if (inst.dueDate <= input.todayYmd) {
      maturedDueUzs += inst.amountUzs;
      maturedPaidUzs += inst.paidUzs;
    }
  }

  const debtStatus: DebtStatus =
    totalRemainingUzs === 0
      ? "paid"
      : computed.some((inst) => inst.state === "overdue")
        ? "overdue"
        : "installment";

  return {
    installments: computed,
    totalRemainingUzs,
    currentMonthDebtUzs,
    currentDueDate,
    nextDueDate,
    maturedDueUzs,
    maturedPaidUzs,
    debtStatus,
  };
}

export const groupBreakdownRowSchema = z.object({
  groupId: z.number().int().positive().nullable(),
  groupName: z.string().nullable(),
  courseId: z.number().int().positive().nullable(),
  courseTitle: z.string().nullable(),
  studentsCount: z.number().int().nonnegative(),
  totalContractUzs: z.number().int().nonnegative(),
  totalPaidUzs: z.number().int().nonnegative(),
  currentMonthDebtUzs: z.number().int().nonnegative(),
  totalRemainingUzs: z.number().int().nonnegative(),
  maturedDueUzs: z.number().int().nonnegative(),
  maturedPaidUzs: z.number().int().nonnegative(),
  disciplinePercent: z.number().min(0).max(100),
});

export type GroupBreakdownRow = z.infer<typeof groupBreakdownRowSchema>;

export type AggregateGroupBreakdownsInput = {
  groups: {
    id: number;
    name: string;
    courseId: number | null;
    courseTitle: string | null;
  }[];
  enrollments: {
    studyGroupId: number | null;
    status: EnrollmentStatus;
    contractAmountUzs: number;
    paidAmountUzs: number;
    currentMonthDebtUzs: number;
    totalRemainingUzs: number;
    maturedDueUzs: number;
    maturedPaidUzs: number;
  }[];
};

type GroupAccumulator = {
  groupId: number | null;
  groupName: string | null;
  courseId: number | null;
  courseTitle: string | null;
  studentsCount: number;
  totalContractUzs: number;
  totalPaidUzs: number;
  currentMonthDebtUzs: number;
  totalRemainingUzs: number;
  maturedDueUzs: number;
  maturedPaidUzs: number;
};

function createGroupAccumulator(
  groupId: number | null,
  groupName: string | null,
  courseId: number | null,
  courseTitle: string | null,
): GroupAccumulator {
  return {
    groupId,
    groupName,
    courseId,
    courseTitle,
    studentsCount: 0,
    totalContractUzs: 0,
    totalPaidUzs: 0,
    currentMonthDebtUzs: 0,
    totalRemainingUzs: 0,
    maturedDueUzs: 0,
    maturedPaidUzs: 0,
  };
}

function finalizeGroupAccumulator(acc: GroupAccumulator): GroupBreakdownRow {
  const disciplinePercent =
    acc.maturedDueUzs > 0
      ? Math.round((acc.maturedPaidUzs / acc.maturedDueUzs) * 1000) / 10
      : acc.studentsCount > 0
        ? 100
        : 0;
  return {
    ...acc,
    disciplinePercent,
  };
}

export function aggregateGroupBreakdowns(
  input: AggregateGroupBreakdownsInput,
): GroupBreakdownRow[] {
  const buckets = new Map<number, GroupAccumulator>();
  for (const group of input.groups) {
    buckets.set(
      group.id,
      createGroupAccumulator(group.id, group.name, group.courseId, group.courseTitle),
    );
  }
  const unassigned = createGroupAccumulator(null, null, null, null);

  for (const enrollment of input.enrollments) {
    if (enrollment.status === "cancelled") continue;
    const target =
      enrollment.studyGroupId === null
        ? unassigned
        : buckets.get(enrollment.studyGroupId);
    if (!target) continue;
    target.studentsCount += 1;
    target.totalContractUzs += enrollment.contractAmountUzs;
    target.totalPaidUzs += enrollment.paidAmountUzs;
    target.currentMonthDebtUzs += enrollment.currentMonthDebtUzs;
    target.totalRemainingUzs += enrollment.totalRemainingUzs;
    target.maturedDueUzs += enrollment.maturedDueUzs;
    target.maturedPaidUzs += enrollment.maturedPaidUzs;
  }

  const rows = [...buckets.values()]
    .map(finalizeGroupAccumulator)
    .sort(
      (a, b) =>
        b.studentsCount - a.studentsCount ||
        b.totalContractUzs - a.totalContractUzs ||
        (a.groupName ?? "").localeCompare(b.groupName ?? ""),
    );

  if (unassigned.studentsCount > 0) {
    rows.push(finalizeGroupAccumulator(unassigned));
  }
  return rows;
}

export const courseInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().default(null),
  isActive: z.boolean().default(true),
});

export type CourseInput = z.infer<typeof courseInputSchema>;

export const courseItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type CourseItem = z.infer<typeof courseItemSchema>;

export const tariffInputSchema = z.object({
  courseId: z.number().int().positive(),
  name: z.string().trim().min(1).max(160),
  priceUzs: z.number().int().nonnegative(),
  allowsInstallments: z.boolean().default(true),
  defaultInstallmentMonths: z.number().int().min(1).max(36).default(1),
  isActive: z.boolean().default(true),
});

export type TariffInput = z.infer<typeof tariffInputSchema>;

export const tariffItemSchema = z.object({
  id: z.number().int().positive(),
  courseId: z.number().int().positive(),
  courseTitle: z.string(),
  name: z.string(),
  priceUzs: z.number().int().nonnegative(),
  allowsInstallments: z.boolean(),
  defaultInstallmentMonths: z.number().int().min(1).max(36),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type TariffItem = z.infer<typeof tariffItemSchema>;

export const studyGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  courseId: z.number().int().positive().nullable().default(null),
  startsAt: ymdDateSchema.nullable().default(null),
  capacity: z.number().int().positive().nullable().default(null),
  isActive: z.boolean().default(true),
});

export type StudyGroupInput = z.infer<typeof studyGroupInputSchema>;

export const studyGroupItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  courseId: z.number().int().positive().nullable(),
  courseTitle: z.string().nullable(),
  startsAt: ymdDateSchema.nullable(),
  capacity: z.number().int().positive().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type StudyGroupItem = z.infer<typeof studyGroupItemSchema>;

export const paymentsCatalogResponseSchema = z.object({
  courses: z.array(courseItemSchema),
  tariffs: z.array(tariffItemSchema),
  groups: z.array(studyGroupItemSchema),
});

export type PaymentsCatalogResponse = z.infer<typeof paymentsCatalogResponseSchema>;

export const receiptOcrResultSchema = z.object({
  isReceipt: z.boolean(),
  amountUzs: z.number().int().nonnegative().nullable(),
  paidDate: ymdDateSchema.nullable(),
  paymentMethod: z.enum(paymentMethods).nullable(),
  reference: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export type ReceiptOcrResult = z.infer<typeof receiptOcrResultSchema>;

export const paymentRecordItemSchema = z.object({
  id: z.number().int().positive(),
  enrollmentId: z.number().int().positive(),
  amountUzs: z.number().int().positive(),
  paymentMethod: z.enum(paymentMethods),
  status: z.enum(paymentRecordStatuses),
  paidDate: ymdDateSchema,
  paidAt: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  receiptId: z.number().int().positive().nullable(),
  createdAt: z.string(),
});

export type PaymentRecordItem = z.infer<typeof paymentRecordItemSchema>;

export const paymentRecordCreateSchema = z.object({
  amountUzs: z.number().int().positive(),
  paymentMethod: z.enum(paymentMethods),
  paidDate: ymdDateSchema.optional(),
  reference: z.string().trim().max(160).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type PaymentRecordCreate = z.infer<typeof paymentRecordCreateSchema>;

export const initialPaymentInputSchema = paymentRecordCreateSchema;

export type InitialPaymentInput = z.infer<typeof initialPaymentInputSchema>;

function validateInstallmentPlan(
  installments: InstallmentInput[] | undefined,
  contractAmountUzs: number | undefined,
  ctx: z.RefinementCtx,
) {
  if (!installments) return;
  const seen = new Set<number>();
  let total = 0;
  for (const item of installments) {
    if (seen.has(item.installmentNo)) {
      ctx.addIssue({
        code: "custom",
        message: "duplicate_installment_no",
        path: ["installments"],
      });
      return;
    }
    seen.add(item.installmentNo);
    total += item.amountUzs;
  }
  if (contractAmountUzs !== undefined && total !== contractAmountUzs) {
    ctx.addIssue({
      code: "custom",
      message: "installments_sum_mismatch",
      path: ["installments"],
    });
  }
}

export const enrollmentCreateSchema = z
  .object({
    userId: z.number().int().positive(),
    courseId: z.number().int().positive(),
    tariffId: z.number().int().positive(),
    studyGroupId: z.number().int().positive().nullable().default(null),
    contractAmountUzs: z.number().int().positive(),
    installmentMonths: z.number().int().min(1).max(36).default(1),
    firstDueDate: ymdDateSchema.optional(),
    installments: z.array(installmentInputSchema).min(1).optional(),
    note: z.string().trim().max(1000).nullable().default(null),
    initialPayment: initialPaymentInputSchema.nullable().optional().default(null),
  })
  .superRefine((input, ctx) => {
    validateInstallmentPlan(input.installments, input.contractAmountUzs, ctx);
  });

export type EnrollmentCreate = z.infer<typeof enrollmentCreateSchema>;

export const enrollmentUpdateSchema = z
  .object({
    courseId: z.number().int().positive().optional(),
    tariffId: z.number().int().positive().optional(),
    studyGroupId: z.number().int().positive().nullable().optional(),
    status: z.enum(enrollmentStatuses).optional(),
    contractAmountUzs: z.number().int().positive().optional(),
    installments: z.array(installmentInputSchema).min(1).optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "empty_update",
  })
  .superRefine((input, ctx) => {
    validateInstallmentPlan(input.installments, input.contractAmountUzs, ctx);
  });

export type EnrollmentUpdate = z.infer<typeof enrollmentUpdateSchema>;

export const enrollmentStudentRowSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  telegramId: z.number(),
  name: z.string().nullable(),
  firstName: z.string().nullable(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  courseId: z.number().int().positive(),
  courseTitle: z.string(),
  tariffId: z.number().int().positive(),
  tariffName: z.string(),
  studyGroupId: z.number().int().positive().nullable(),
  studyGroupName: z.string().nullable(),
  status: z.enum(enrollmentStatuses),
  debtStatus: z.enum(debtStatuses),
  contractAmountUzs: z.number().int().nonnegative(),
  paidAmountUzs: z.number().int().nonnegative(),
  currentMonthDebtUzs: z.number().int().nonnegative(),
  totalRemainingUzs: z.number().int().nonnegative(),
  maturedDueUzs: z.number().int().nonnegative(),
  maturedPaidUzs: z.number().int().nonnegative(),
  currentDueDate: ymdDateSchema.nullable(),
  nextDueDate: ymdDateSchema.nullable(),
  installmentMonths: z.number().int().min(1),
  note: z.string().nullable(),
  firstNetwork: z.enum(attributionNetworks),
  firstSource: z.string().nullable(),
  firstCampaign: z.string().nullable(),
  lastNetwork: z.enum(attributionNetworks),
  lastSource: z.string().nullable(),
  lastCampaign: z.string().nullable(),
  attributionNetwork: z.enum(attributionNetworks),
  enrolledAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  installments: z.array(computedInstallmentSchema),
  payments: z.array(paymentRecordItemSchema),
});

export type EnrollmentStudentRow = z.infer<typeof enrollmentStudentRowSchema>;

export const paymentsKpisSchema = z.object({
  totalPayingStudents: z.number().int().nonnegative(),
  totalCollectedUzs: z.number().int().nonnegative(),
  currentMonthExpectedDebtUzs: z.number().int().nonnegative(),
  totalRemainingDebtUzs: z.number().int().nonnegative(),
});

export type PaymentsKpis = z.infer<typeof paymentsKpisSchema>;

export const paymentsOverviewQuerySchema = z.object({
  attributionModel: z.enum(attributionModels).default("last"),
  courseId: z.coerce.number().int().positive().optional(),
  tariffId: z.coerce.number().int().positive().optional(),
  studyGroupId: z
    .union([z.literal("unassigned"), z.coerce.number().int().positive()])
    .optional(),
  debtStatus: z.enum(debtStatuses).optional(),
  status: z.enum(enrollmentStatuses).optional(),
  network: z.enum(attributionNetworks).optional(),
  search: z.string().trim().max(120).optional(),
});

export type PaymentsOverviewQuery = z.infer<typeof paymentsOverviewQuerySchema>;

export const paymentsOverviewResponseSchema = z.object({
  todayYmd: ymdDateSchema,
  attributionModel: z.enum(attributionModels),
  kpis: paymentsKpisSchema,
  students: z.array(enrollmentStudentRowSchema),
  groups: z.array(groupBreakdownRowSchema),
});

export type PaymentsOverviewResponse = z.infer<typeof paymentsOverviewResponseSchema>;

export const paymentReceiptItemSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive().nullable(),
  userName: z.string().nullable(),
  userFirstName: z.string().nullable(),
  userUsername: z.string().nullable(),
  userPhone: z.string().nullable(),
  enrollmentId: z.number().int().positive().nullable(),
  paymentId: z.number().int().positive().nullable(),
  source: z.enum(receiptSources),
  status: z.enum(receiptStatuses),
  mediaType: z.enum(receiptMediaTypes),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number().int().nonnegative().nullable(),
  mediaUrl: z.string().nullable(),
  ocrStatus: z.enum(receiptOcrStatuses),
  ocrResult: receiptOcrResultSchema.nullable(),
  ocrError: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type PaymentReceiptItem = z.infer<typeof paymentReceiptItemSchema>;

export const paymentReceiptsResponseSchema = z.object({
  ocrConfigured: z.boolean(),
  mediaEnabled: z.boolean(),
  items: z.array(paymentReceiptItemSchema),
});

export type PaymentReceiptsResponse = z.infer<typeof paymentReceiptsResponseSchema>;

export const receiptConfirmInputSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("existing"),
      enrollmentId: z.number().int().positive(),
      amountUzs: z.number().int().positive(),
      paymentMethod: z.enum(paymentMethods),
      paidDate: ymdDateSchema.optional(),
      reference: z.string().trim().max(160).nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
    }),
    z.object({
      mode: z.literal("new_enrollment"),
      userId: z.number().int().positive(),
      courseId: z.number().int().positive(),
      tariffId: z.number().int().positive(),
      studyGroupId: z.number().int().positive().nullable().default(null),
      contractAmountUzs: z.number().int().positive(),
      installmentMonths: z.number().int().min(1).max(36).default(1),
      firstDueDate: ymdDateSchema.optional(),
      installments: z.array(installmentInputSchema).min(1).optional(),
      enrollmentNote: z.string().trim().max(1000).nullable().optional(),
      amountUzs: z.number().int().positive(),
      paymentMethod: z.enum(paymentMethods),
      paidDate: ymdDateSchema.optional(),
      reference: z.string().trim().max(160).nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
    }),
  ])
  .superRefine((input, ctx) => {
    if (input.mode === "new_enrollment") {
      validateInstallmentPlan(input.installments, input.contractAmountUzs, ctx);
    }
  });

export type ReceiptConfirmInput = z.infer<typeof receiptConfirmInputSchema>;

export const paymentUserLookupItemSchema = z.object({
  id: z.number().int().positive(),
  telegramId: z.number(),
  name: z.string().nullable(),
  firstName: z.string().nullable(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  wroteAdminAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  activeEnrollmentCount: z.number().int().nonnegative(),
});

export type PaymentUserLookupItem = z.infer<typeof paymentUserLookupItemSchema>;

export const paymentUsersLookupResponseSchema = z.object({
  items: z.array(paymentUserLookupItemSchema),
});

export type PaymentUsersLookupResponse = z.infer<typeof paymentUsersLookupResponseSchema>;
