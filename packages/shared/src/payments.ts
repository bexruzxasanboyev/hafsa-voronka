import { z } from "zod";

export const sourceNetworks = ["ig", "fb", "tg", "organic"] as const;
export type SourceNetwork = (typeof sourceNetworks)[number];

export const debtStatuses = ["paid", "installment", "overdue"] as const;
export type DebtStatus = (typeof debtStatuses)[number];

export function normalizeSourceNetwork(utmSource: string | null | undefined): SourceNetwork {
  const s = utmSource?.trim().toLowerCase() ?? "";
  if (!s) return "organic";
  if (s === "ig" || s.includes("instagram") || s.startsWith("ig_")) return "ig";
  if (s === "fb" || s.includes("facebook") || s.startsWith("fb_")) return "fb";
  if (s === "tg" || s.includes("telegram") || s.startsWith("tg_")) return "tg";
  return "organic";
}

export type CourseItem = {
  id: number;
  name: string;
};

export type TariffItem = {
  id: number;
  courseId: number;
  name: string;
  price: number;
};

export type StudyGroupItem = {
  id: number;
  name: string;
  courseId: number | null;
};

export type PaymentRecordItem = {
  id: number;
  amount: number;
  paidAt: string;
  note: string | null;
};

export type EnrollmentItem = {
  id: number;
  userId: number | null;
  studentName: string;
  phone: string | null;
  telegramId: number | null;
  username: string | null;
  sourceNetwork: SourceNetwork;
  courseId: number | null;
  courseName: string;
  tariffId: number | null;
  tariffName: string;
  groupId: number | null;
  groupName: string | null;
  totalPrice: number;
  paidAmount: number;
  firstPaidAt: string | null;
  currentMonthDue: number;
  dueDate: string | null;
  remainingBalance: number;
  status: DebtStatus;
  notes: string | null;
  payments: PaymentRecordItem[];
  createdAt: string;
};

export type GroupBreakdownItem = {
  groupId: number | null;
  groupName: string;
  studentCount: number;
  totalContract: number;
  totalPaid: number;
  currentMonthDebt: number;
  totalRemainingDebt: number;
  disciplinePercent: number;
};

export type NetworkAttributionItem = {
  network: SourceNetwork;
  studentCount: number;
  totalContract: number;
  totalPaid: number;
};

export type PaymentsSummary = {
  totalPaidStudents: number;
  totalPaidAmount: number;
  totalCurrentMonthDebt: number;
  totalRemainingDebt: number;
};

export type PaymentsDashboardResponse = {
  summary: PaymentsSummary;
  networkAttribution: NetworkAttributionItem[];
  enrollments: EnrollmentItem[];
  groups: GroupBreakdownItem[];
  courses: CourseItem[];
  tariffs: TariffItem[];
  studyGroups: StudyGroupItem[];
};

export const createEnrollmentSchema = z.object({
  userId: z.number().int().positive().nullable().optional(),
  studentName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).nullable().optional(),
  telegramId: z.number().int().positive().nullable().optional(),
  username: z.string().trim().max(100).nullable().optional(),
  sourceNetwork: z.enum(sourceNetworks).optional(),
  courseId: z.number().int().positive().nullable().optional(),
  courseName: z.string().trim().min(1).max(200),
  tariffId: z.number().int().positive().nullable().optional(),
  tariffName: z.string().trim().min(1).max(200),
  groupId: z.number().int().positive().nullable().optional(),
  groupName: z.string().trim().max(100).nullable().optional(),
  totalPrice: z.number().int().min(0),
  initialPaidAmount: z.number().int().min(0).optional(),
  initialPaidAt: z.string().datetime({ offset: true }).optional(),
  currentMonthDue: z.number().int().min(0).default(0),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const updateEnrollmentSchema = createEnrollmentSchema.partial();

export const addPaymentSchema = z.object({
  amount: z.number().int().positive(),
  paidAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

export const createCatalogItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("course"), name: z.string().trim().min(1).max(200) }),
  z.object({
    kind: z.literal("tariff"),
    courseId: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    price: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("group"),
    name: z.string().trim().min(1).max(100),
    courseId: z.number().int().positive().nullable().optional(),
  }),
]);
