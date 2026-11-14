import {
  courseItemSchema,
  enrollmentStudentRowSchema,
  paymentReceiptItemSchema,
  paymentReceiptsResponseSchema,
  paymentsCatalogResponseSchema,
  paymentsOverviewResponseSchema,
  paymentUsersLookupResponseSchema,
  studyGroupItemSchema,
  tariffItemSchema,
  type AttributionModel,
  type AttributionNetwork,
  type CourseInput,
  type CourseItem,
  type DebtStatus,
  type EnrollmentCreate,
  type EnrollmentStatus,
  type EnrollmentStudentRow,
  type EnrollmentUpdate,
  type InstallmentState,
  type PaymentMethod,
  type PaymentReceiptItem,
  type PaymentReceiptsResponse,
  type PaymentRecordCreate,
  type PaymentRecordItem,
  type PaymentsCatalogResponse,
  type PaymentsOverviewResponse,
  type PaymentUserLookupItem,
  type ReceiptConfirmInput,
  type ReceiptStatus,
  type StudyGroupInput,
  type StudyGroupItem,
  type TariffInput,
  type TariffItem,
} from "@funnel/shared";
import type { BadgeTone } from "@/components/admin/ui/Badge";
import { authHeaders } from "@/lib/admin/api";
import { API_URL } from "@/lib/api";
import { adminUz } from "../i18n/admin";

export const FILTER_ALL = "__all__";
export const FILTER_UNASSIGNED = "__unassigned__";
export const FILTER_NONE = "__none__";

export type PaymentsOverviewFilterInput = {
  attributionModel?: AttributionModel;
  courseId?: string;
  tariffId?: string;
  studyGroupId?: string;
  debtStatus?: string;
  status?: string;
  network?: string;
  search?: string;
};

export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export function normalizeSentinel(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === FILTER_ALL || trimmed === FILTER_NONE) return undefined;
  if (trimmed === FILTER_UNASSIGNED) return "unassigned";
  return trimmed;
}

export function buildOverviewQuery(filters: PaymentsOverviewFilterInput): string {
  const params = new URLSearchParams();
  if (filters.attributionModel) {
    params.set("attributionModel", filters.attributionModel);
  }
  const courseId = normalizeSentinel(filters.courseId);
  if (courseId) params.set("courseId", courseId);
  const tariffId = normalizeSentinel(filters.tariffId);
  if (tariffId) params.set("tariffId", tariffId);
  const studyGroupId = normalizeSentinel(filters.studyGroupId);
  if (studyGroupId) params.set("studyGroupId", studyGroupId);
  const debtStatus = normalizeSentinel(filters.debtStatus);
  if (debtStatus) params.set("debtStatus", debtStatus);
  const status = normalizeSentinel(filters.status);
  if (status) params.set("status", status);
  const network = normalizeSentinel(filters.network);
  if (network) params.set("network", network);
  const search = filters.search?.trim();
  if (search) params.set("search", search);
  return params.toString();
}

export function formatUzs(amount: number): string {
  const rounded = Math.round(Number.isFinite(amount) ? amount : 0);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${digits} so‘m`;
}

export function parseUzsInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function networkLabel(network: AttributionNetwork): string {
  return adminUz.payments.networks[network];
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return adminUz.payments.methods[method];
}

export function debtStatusLabel(status: DebtStatus): string {
  return adminUz.payments.debtStatuses[status];
}

export function debtStatusTone(status: DebtStatus): BadgeTone {
  if (status === "paid") return "success";
  if (status === "overdue") return "danger";
  return "attention";
}

export function enrollmentStatusLabel(status: EnrollmentStatus): string {
  return adminUz.payments.enrollmentStatuses[status];
}

export function installmentStateLabel(state: InstallmentState): string {
  return adminUz.payments.installmentStates[state];
}

export function installmentStateTone(state: InstallmentState): BadgeTone {
  if (state === "paid") return "success";
  if (state === "overdue") return "danger";
  return "attention";
}

export function earliestVerifiedPaidDate(payments: PaymentRecordItem[]): string | null {
  let earliest: string | null = null;
  for (const payment of payments) {
    if (payment.status !== "verified") continue;
    if (earliest === null || payment.paidDate < earliest) {
      earliest = payment.paidDate;
    }
  }
  return earliest;
}

export function formatStudentDisplayName(student: {
  name?: string | null;
  firstName?: string | null;
  username?: string | null;
  telegramId?: number | null;
}): string {
  if (student.name?.trim()) return student.name.trim();
  if (student.firstName?.trim()) return student.firstName.trim();
  if (student.username?.trim()) return `@${student.username.trim()}`;
  if (student.telegramId !== undefined && student.telegramId !== null) return `ID ${student.telegramId}`;
  return adminUz.payments.receipts.unknownSender;
}

export function paymentErrorMessage(code: string | undefined): string {
  if (!code) return adminUz.payments.errors.generic;
  const dict = adminUz.payments.errors as Record<string, string>;
  return dict[code] ?? adminUz.payments.errors.generic;
}

function pickEntity(json: unknown, key: string): unknown {
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (key in obj) return obj[key];
    if ("item" in obj) return obj.item;
  }
  return json;
}

async function requestJson(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_URL}/admin/payments${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    credentials: "include",
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  return res;
}

async function mutate<T>(
  path: string,
  init: RequestInit,
  parse: (json: unknown) => T,
): Promise<MutationResult<T>> {
  let res: Response;
  try {
    res = await requestJson(path, init);
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") throw err;
    return { ok: false, status: 0, error: "generic" };
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code =
      json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : "generic";
    return { ok: false, status: res.status, error: code };
  }

  return { ok: true, data: parse(json) };
}

export async function fetchPaymentsOverview(
  filters: PaymentsOverviewFilterInput = {},
): Promise<PaymentsOverviewResponse> {
  const qs = buildOverviewQuery(filters);
  const res = await requestJson(`/overview${qs ? `?${qs}` : ""}`, { method: "GET" });
  if (!res.ok) {
    throw new Error(`PAYMENTS_OVERVIEW_FAILED_${res.status}`);
  }
  const json = await res.json();
  return paymentsOverviewResponseSchema.parse(json);
}

export async function fetchPaymentsCatalog(): Promise<PaymentsCatalogResponse> {
  const res = await requestJson("/catalog", { method: "GET" });
  if (!res.ok) {
    throw new Error(`PAYMENTS_CATALOG_FAILED_${res.status}`);
  }
  const json = await res.json();
  return paymentsCatalogResponseSchema.parse(json);
}

export function createCourse(input: CourseInput): Promise<MutationResult<CourseItem>> {
  return mutate(
    "/courses",
    { method: "POST", body: JSON.stringify(input) },
    (json) => courseItemSchema.parse(pickEntity(json, "course")),
  );
}

export function updateCourse(id: number, input: CourseInput): Promise<MutationResult<CourseItem>> {
  return mutate(
    `/courses/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    (json) => courseItemSchema.parse(pickEntity(json, "course")),
  );
}

export function deleteCourse(id: number): Promise<MutationResult<true>> {
  return mutate(`/courses/${id}`, { method: "DELETE" }, () => true);
}

export function createTariff(input: TariffInput): Promise<MutationResult<TariffItem>> {
  return mutate(
    "/tariffs",
    { method: "POST", body: JSON.stringify(input) },
    (json) => tariffItemSchema.parse(pickEntity(json, "tariff")),
  );
}

export function updateTariff(id: number, input: TariffInput): Promise<MutationResult<TariffItem>> {
  return mutate(
    `/tariffs/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    (json) => tariffItemSchema.parse(pickEntity(json, "tariff")),
  );
}

export function deleteTariff(id: number): Promise<MutationResult<true>> {
  return mutate(`/tariffs/${id}`, { method: "DELETE" }, () => true);
}

export function createStudyGroup(input: StudyGroupInput): Promise<MutationResult<StudyGroupItem>> {
  return mutate(
    "/groups",
    { method: "POST", body: JSON.stringify(input) },
    (json) => studyGroupItemSchema.parse(pickEntity(json, "group")),
  );
}

export function updateStudyGroup(
  id: number,
  input: StudyGroupInput,
): Promise<MutationResult<StudyGroupItem>> {
  return mutate(
    `/groups/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    (json) => studyGroupItemSchema.parse(pickEntity(json, "group")),
  );
}

export function deleteStudyGroup(id: number): Promise<MutationResult<true>> {
  return mutate(`/groups/${id}`, { method: "DELETE" }, () => true);
}

export async function searchPaymentUsers(
  q: string,
  signal?: AbortSignal,
): Promise<PaymentUserLookupItem[]> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  const res = await requestJson(`/users${qs}`, { method: "GET", signal });
  if (!res.ok) {
    throw new Error(`PAYMENTS_USERS_FAILED_${res.status}`);
  }
  const json = await res.json();
  return paymentUsersLookupResponseSchema.parse(json).items;
}

export function createEnrollment(input: EnrollmentCreate): Promise<MutationResult<EnrollmentStudentRow>> {
  return mutate(
    "/enrollments",
    { method: "POST", body: JSON.stringify(input) },
    (json) => enrollmentStudentRowSchema.parse(pickEntity(json, "enrollment")),
  );
}

export function updateEnrollment(
  id: number,
  input: EnrollmentUpdate,
): Promise<MutationResult<EnrollmentStudentRow>> {
  return mutate(
    `/enrollments/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    (json) => enrollmentStudentRowSchema.parse(pickEntity(json, "enrollment")),
  );
}

export function addEnrollmentPayment(
  enrollmentId: number,
  input: PaymentRecordCreate,
): Promise<MutationResult<EnrollmentStudentRow>> {
  return mutate(
    `/enrollments/${enrollmentId}/payments`,
    { method: "POST", body: JSON.stringify(input) },
    (json) => enrollmentStudentRowSchema.parse(pickEntity(json, "enrollment")),
  );
}

export function refundPaymentRecord(paymentId: number): Promise<MutationResult<EnrollmentStudentRow>> {
  return mutate(
    `/records/${paymentId}/refund`,
    { method: "POST" },
    (json) => enrollmentStudentRowSchema.parse(pickEntity(json, "enrollment")),
  );
}

export async function fetchPaymentReceipts(
  status?: ReceiptStatus | "all",
): Promise<PaymentReceiptsResponse> {
  const qs = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  const res = await requestJson(`/receipts${qs}`, { method: "GET" });
  if (!res.ok) {
    throw new Error(`PAYMENTS_RECEIPTS_FAILED_${res.status}`);
  }
  const json = await res.json();
  return paymentReceiptsResponseSchema.parse(json);
}

export function uploadPaymentReceipt(
  file: File,
  opts?: { userId?: number | null; enrollmentId?: number | null },
): Promise<MutationResult<PaymentReceiptItem>> {
  const form = new FormData();
  form.append("file", file);
  if (opts?.userId) form.append("userId", String(opts.userId));
  if (opts?.enrollmentId) form.append("enrollmentId", String(opts.enrollmentId));

  return mutate(
    "/receipts/upload",
    { method: "POST", body: form },
    (json) => paymentReceiptItemSchema.parse(pickEntity(json, "receipt")),
  );
}

export async function fetchReceiptFileBlobUrl(
  receiptId: number,
  signal?: AbortSignal,
): Promise<{ url: string; mimeType: string; revoke: () => void }> {
  const res = await fetch(`${API_URL}/admin/payments/receipts/${receiptId}/file`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
    signal,
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!res.ok) {
    throw new Error(`RECEIPT_FILE_FAILED_${res.status}`);
  }

  const blob = await res.blob();
  const mimeType = res.headers.get("content-type") || blob.type || "application/octet-stream";
  const url = URL.createObjectURL(blob);
  return {
    url,
    mimeType,
    revoke: () => URL.revokeObjectURL(url),
  };
}

export function retryReceiptOcr(receiptId: number): Promise<MutationResult<PaymentReceiptItem>> {
  return mutate(
    `/receipts/${receiptId}/ocr`,
    { method: "POST" },
    (json) => paymentReceiptItemSchema.parse(pickEntity(json, "receipt")),
  );
}

export function confirmPaymentReceipt(
  receiptId: number,
  input: ReceiptConfirmInput,
): Promise<MutationResult<{ receipt: PaymentReceiptItem; enrollment: EnrollmentStudentRow | null }>> {
  return mutate(
    `/receipts/${receiptId}/confirm`,
    { method: "POST", body: JSON.stringify(input) },
    (json) => {
      const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
      return {
        receipt: paymentReceiptItemSchema.parse(obj.receipt),
        enrollment: obj.enrollment ? enrollmentStudentRowSchema.parse(obj.enrollment) : null,
      };
    },
  );
}

export function rejectPaymentReceipt(receiptId: number): Promise<MutationResult<PaymentReceiptItem>> {
  return mutate(
    `/receipts/${receiptId}/reject`,
    { method: "POST" },
    (json) => paymentReceiptItemSchema.parse(pickEntity(json, "receipt")),
  );
}
