import { and, desc, eq, ne, sql } from "drizzle-orm";
import { type Api, GrammyError, InputFile } from "grammy";
import type { Message } from "grammy/types";
import {
  buildDefaultInstallmentSchedule,
  type EnrollmentStatus,
  type EnrollmentStudentRow,
  type PaymentReceiptItem,
  RECEIPT_MAX_BYTES,
  type ReceiptConfirmInput,
  type ReceiptMediaType,
  type ReceiptStatus,
} from "@funnel/shared";
import { getTashkentToday } from "@/admin/dates";
import { db } from "@/db";
import {
  courses,
  enrollmentInstallments,
  enrollments,
  paymentReceipts,
  payments,
  studyGroups,
  tariffs,
  users,
} from "@/db/schema";
import { findByTelegramId } from "@/funnel/users";
import { analyzeReceiptFromTelegramFile, isOcrConfigured } from "@/payments/ocr";
import {
  getEnrollmentRowById,
  recordUserPurchaseSideEffects,
  resolvePaidAt,
} from "@/payments/service";
import { bot } from "@/telegram/bot";
import { botMediaChat } from "@/telegram/media";

export type ExtractedReceiptAttachment = {
  mediaType: ReceiptMediaType;
  fileId: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
};

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isMediaChatUnreachable(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false;
  return (
    error.error_code === 403 ||
    /chat not found|not enough rights|have no rights|chat_write_forbidden/i.test(error.description)
  );
}

export function extractReceiptAttachment(msg: Message): ExtractedReceiptAttachment | null {
  if (msg.photo && msg.photo.length > 0) {
    const largest = [...msg.photo].sort(
      (a, b) => (a.file_size ?? a.width * a.height) - (b.file_size ?? b.width * b.height),
    )[msg.photo.length - 1];
    if (!largest) return null;
    if (largest.file_size !== undefined && largest.file_size > RECEIPT_MAX_BYTES) return null;
    return {
      mediaType: "photo",
      fileId: largest.file_id,
      fileName: null,
      mimeType: "image/jpeg",
      fileSize: largest.file_size ?? null,
    };
  }

  if (msg.document) {
    const mime = msg.document.mime_type?.toLowerCase() ?? null;
    let mediaType: ReceiptMediaType | null = null;
    if (mime === "application/pdf") {
      mediaType = "pdf";
    } else if (mime?.startsWith("image/")) {
      mediaType = "photo";
    }
    if (!mediaType) return null;
    if (msg.document.file_size !== undefined && msg.document.file_size > RECEIPT_MAX_BYTES) {
      return null;
    }
    return {
      mediaType,
      fileId: msg.document.file_id,
      fileName: msg.document.file_name ?? null,
      mimeType: msg.document.mime_type ?? null,
      fileSize: msg.document.file_size ?? null,
    };
  }

  return null;
}

function mapReceiptItem(
  receipt: typeof paymentReceipts.$inferSelect,
  user: typeof users.$inferSelect | null,
): PaymentReceiptItem {
  return {
    id: receipt.id,
    userId: receipt.userId,
    userName: user?.name ?? receipt.senderName ?? null,
    userFirstName: user?.firstName ?? null,
    userUsername: user?.username ?? receipt.senderUsername ?? null,
    userPhone: user?.phone ?? null,
    enrollmentId: receipt.enrollmentId,
    paymentId: receipt.paymentId,
    source: receipt.source,
    status: receipt.status,
    mediaType: receipt.mediaType,
    fileName: receipt.fileName,
    mimeType: receipt.mimeType,
    fileSize: receipt.fileSize,
    mediaUrl: receipt.fileId ? `/admin/payments/receipts/${receipt.id}/file` : null,
    ocrStatus: receipt.ocrStatus,
    ocrResult: receipt.ocrResult ?? null,
    ocrError: receipt.ocrError,
    reviewedAt: receipt.reviewedAt?.toISOString() ?? null,
    createdAt: receipt.createdAt.toISOString(),
  };
}

export async function getReceiptItemById(id: number): Promise<PaymentReceiptItem | null> {
  const [row] = await db()
    .select({
      receipt: paymentReceipts,
      user: users,
    })
    .from(paymentReceipts)
    .leftJoin(users, eq(users.id, paymentReceipts.userId))
    .where(eq(paymentReceipts.id, id))
    .limit(1);
  if (!row) return null;
  return mapReceiptItem(row.receipt, row.user);
}

async function resolveDefaultEnrollmentId(userId: number): Promise<number | null> {
  const [active] = await db()
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.status, "active")))
    .orderBy(desc(enrollments.id))
    .limit(1);
  if (active) return active.id;

  const [latest] = await db()
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), ne(enrollments.status, "cancelled")))
    .orderBy(desc(enrollments.id))
    .limit(1);
  return latest?.id ?? null;
}

export async function runReceiptOcr(
  receiptId: number,
  api: Api = bot().api,
): Promise<PaymentReceiptItem | null> {
  const [receipt] = await db()
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.id, receiptId))
    .limit(1);
  if (!receipt) return null;

  if (!isOcrConfigured()) {
    await db()
      .update(paymentReceipts)
      .set({ ocrStatus: "skipped", ocrResult: null, ocrError: null })
      .where(eq(paymentReceipts.id, receiptId));
    return getReceiptItemById(receiptId);
  }

  const mimeType =
    receipt.mimeType || (receipt.mediaType === "pdf" ? "application/pdf" : "image/jpeg");
  const outcome = await analyzeReceiptFromTelegramFile(api, receipt.fileId, mimeType);
  await db()
    .update(paymentReceipts)
    .set({
      ocrStatus: outcome.ocrStatus,
      ocrResult: outcome.ocrResult,
      ocrError: outcome.ocrError,
    })
    .where(eq(paymentReceipts.id, receiptId));

  return getReceiptItemById(receiptId);
}

export async function captureBusinessReceipt(params: {
  userId?: number | null;
  attachment: ExtractedReceiptAttachment;
  businessConnectionId: string;
  telegramMessageId: number;
  senderTelegramId: number;
  senderUsername: string | null;
  senderName: string | null;
  caption: string | null;
}): Promise<number | null> {
  const userId =
    params.userId !== undefined
      ? params.userId
      : ((await findByTelegramId(params.senderTelegramId))?.id ?? null);
  const enrollmentId = userId !== null ? await resolveDefaultEnrollmentId(userId) : null;

  const [inserted] = await db()
    .insert(paymentReceipts)
    .values({
      userId,
      enrollmentId,
      source: "business_dm",
      status: "pending",
      mediaType: params.attachment.mediaType,
      fileId: params.attachment.fileId,
      fileName: params.attachment.fileName,
      mimeType: params.attachment.mimeType,
      fileSize: params.attachment.fileSize,
      businessConnectionId: params.businessConnectionId,
      telegramMessageId: params.telegramMessageId,
      senderTelegramId: params.senderTelegramId,
      senderUsername: params.senderUsername,
      senderName: params.senderName,
      caption: params.caption,
      ocrStatus: "skipped",
    })
    .onConflictDoNothing()
    .returning({ id: paymentReceipts.id });

  if (!inserted) return null;

  if (isOcrConfigured()) {
    void runReceiptOcr(inserted.id).catch((error) =>
      console.error("Background receipt OCR failed:", error),
    );
  }

  return inserted.id;
}

export async function uploadAdminReceipt(
  api: Api,
  file: File,
  opts?: { userId?: number | null; enrollmentId?: number | null },
): Promise<
  | { ok: true; receipt: PaymentReceiptItem }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "unsupported_type"
        | "too_large"
        | "media_not_configured"
        | "media_chat_unavailable"
        | "user_not_found"
        | "enrollment_not_found";
    }
> {
  const mime = file.type.toLowerCase();
  let mediaType: ReceiptMediaType | null = null;
  if (ALLOWED_IMAGE_MIMES.has(mime)) {
    mediaType = "photo";
  } else if (mime === "application/pdf") {
    mediaType = "pdf";
  }
  if (!mediaType) return { ok: false, code: "unsupported_type" };
  if (file.size <= 0) return { ok: false, code: "invalid_request" };
  if (file.size > RECEIPT_MAX_BYTES) return { ok: false, code: "too_large" };

  const target = botMediaChat();
  if (!target) return { ok: false, code: "media_not_configured" };

  let resolvedUserId: number | null = opts?.userId ?? null;
  let resolvedEnrollmentId: number | null = opts?.enrollmentId ?? null;

  if (resolvedEnrollmentId !== null) {
    const [enrollment] = await db()
      .select({ id: enrollments.id, userId: enrollments.userId })
      .from(enrollments)
      .where(eq(enrollments.id, resolvedEnrollmentId))
      .limit(1);
    if (!enrollment) return { ok: false, code: "enrollment_not_found" };
    resolvedUserId ??= enrollment.userId;
  }

  if (resolvedUserId !== null) {
    const [user] = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, resolvedUserId))
      .limit(1);
    if (!user) return { ok: false, code: "user_not_found" };
    if (resolvedEnrollmentId === null) {
      resolvedEnrollmentId = await resolveDefaultEnrollmentId(resolvedUserId);
    }
  }

  const input = new InputFile(
    new Uint8Array(await file.arrayBuffer()),
    file.name || (mediaType === "pdf" ? "receipt.pdf" : "receipt.jpg"),
  );
  const options = { message_thread_id: target.threadId, disable_notification: true };

  let fileId: string;
  let messageId: number;
  try {
    if (mediaType === "photo") {
      const sent = await api.sendPhoto(target.chatId, input, options);
      fileId = sent.photo[sent.photo.length - 1].file_id;
      messageId = sent.message_id;
    } else {
      const sent = await api.sendDocument(target.chatId, input, options);
      fileId = sent.document.file_id;
      messageId = sent.message_id;
    }
  } catch (error) {
    if (isMediaChatUnreachable(error)) return { ok: false, code: "media_chat_unavailable" };
    throw error;
  }

  await api
    .deleteMessage(target.chatId, messageId)
    .catch((error) => console.error("Receipt upload cleanup failed:", error));

  const [created] = await db()
    .insert(paymentReceipts)
    .values({
      userId: resolvedUserId,
      enrollmentId: resolvedEnrollmentId,
      source: "admin_upload",
      status: "pending",
      mediaType,
      fileId,
      fileName: file.name || null,
      mimeType: mime,
      fileSize: file.size,
      ocrStatus: "skipped",
    })
    .returning({ id: paymentReceipts.id });

  const hydrated = await runReceiptOcr(created.id, api);
  return { ok: true, receipt: hydrated! };
}

export async function listReceipts(status?: ReceiptStatus): Promise<PaymentReceiptItem[]> {
  const rows = await db()
    .select({
      receipt: paymentReceipts,
      user: users,
    })
    .from(paymentReceipts)
    .leftJoin(users, eq(users.id, paymentReceipts.userId))
    .where(status ? eq(paymentReceipts.status, status) : undefined)
    .orderBy(desc(paymentReceipts.createdAt), desc(paymentReceipts.id))
    .limit(200);

  return rows.map(({ receipt, user }) => mapReceiptItem(receipt, user));
}

export async function getReceiptMediaForStream(id: number): Promise<{
  id: number;
  fileId: string;
  mediaType: ReceiptMediaType;
  mimeType: string | null;
  fileName: string | null;
} | null> {
  const [row] = await db()
    .select({
      id: paymentReceipts.id,
      fileId: paymentReceipts.fileId,
      mediaType: paymentReceipts.mediaType,
      mimeType: paymentReceipts.mimeType,
      fileName: paymentReceipts.fileName,
    })
    .from(paymentReceipts)
    .where(eq(paymentReceipts.id, id))
    .limit(1);
  return row ?? null;
}

export async function retryReceiptOcr(
  id: number,
): Promise<{ ok: true; receipt: PaymentReceiptItem } | { ok: false; code: "not_found" }> {
  const updated = await runReceiptOcr(id);
  if (!updated) return { ok: false, code: "not_found" };
  return { ok: true, receipt: updated };
}

export async function confirmReceipt(
  id: number,
  input: ReceiptConfirmInput,
): Promise<
  | { ok: true; receipt: PaymentReceiptItem; enrollment: EnrollmentStudentRow }
  | {
      ok: false;
      code:
        | "not_found"
        | "receipt_already_reviewed"
        | "user_not_found"
        | "course_not_found"
        | "tariff_not_found"
        | "group_not_found"
        | "enrollment_not_found"
        | "enrollment_cancelled"
        | "tariff_course_mismatch"
        | "invalid_installments";
    }
> {
  const todayYmd = getTashkentToday();
  const { paidDate, paidAt } = resolvePaidAt(input.paidDate, todayYmd);
  const now = new Date();

  const txResult = await db().transaction(async (tx) => {
    const [receipt] = await tx
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.id, id))
      .for("update")
      .limit(1);
    if (!receipt) return { ok: false as const, code: "not_found" as const };
    if (receipt.status !== "pending") {
      return { ok: false as const, code: "receipt_already_reviewed" as const };
    }

    if (input.mode === "existing") {
      const [enrollment] = await tx
        .select()
        .from(enrollments)
        .where(eq(enrollments.id, input.enrollmentId))
        .for("update")
        .limit(1);
      if (!enrollment) return { ok: false as const, code: "enrollment_not_found" as const };
      if (enrollment.status === "cancelled") {
        return { ok: false as const, code: "enrollment_cancelled" as const };
      }

      const [payment] = await tx
        .insert(payments)
        .values({
          enrollmentId: enrollment.id,
          userId: enrollment.userId,
          receiptId: receipt.id,
          amountUzs: input.amountUzs,
          paymentMethod: input.paymentMethod,
          status: "verified",
          paidDate,
          paidAt,
          reference: input.reference ?? null,
          note: input.note ?? null,
        })
        .returning({ id: payments.id });

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
        .set({ status: nextStatus, updatedAt: now })
        .where(eq(enrollments.id, enrollment.id));

      await tx
        .update(paymentReceipts)
        .set({
          status: "confirmed",
          userId: enrollment.userId,
          enrollmentId: enrollment.id,
          paymentId: payment.id,
          reviewedAt: now,
        })
        .where(eq(paymentReceipts.id, receipt.id));

      return { ok: true as const, userId: enrollment.userId, enrollmentId: enrollment.id };
    }

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
    if (tariff.courseId !== course.id) {
      return { ok: false as const, code: "tariff_course_mismatch" as const };
    }

    if (input.studyGroupId !== null) {
      const [group] = await tx
        .select({ id: studyGroups.id })
        .from(studyGroups)
        .where(eq(studyGroups.id, input.studyGroupId))
        .limit(1);
      if (!group) return { ok: false as const, code: "group_not_found" as const };
    }

    const installmentsPlan =
      input.installments ??
      buildDefaultInstallmentSchedule(
        input.contractAmountUzs,
        input.installmentMonths,
        input.firstDueDate ?? todayYmd,
      );
    if (installmentsPlan.length < 1 || installmentsPlan.length > 36) {
      return { ok: false as const, code: "invalid_installments" as const };
    }

    const status: EnrollmentStatus =
      input.amountUzs >= input.contractAmountUzs ? "completed" : "active";

    const [createdEnrollment] = await tx
      .insert(enrollments)
      .values({
        userId: input.userId,
        courseId: input.courseId,
        tariffId: input.tariffId,
        studyGroupId: input.studyGroupId,
        status,
        contractAmountUzs: input.contractAmountUzs,
        installmentMonths: installmentsPlan.length,
        note: input.enrollmentNote ?? null,
      })
      .returning({ id: enrollments.id });

    await tx.insert(enrollmentInstallments).values(
      installmentsPlan.map((inst) => ({
        enrollmentId: createdEnrollment.id,
        installmentNo: inst.installmentNo,
        dueDate: inst.dueDate,
        amountUzs: inst.amountUzs,
      })),
    );

    const [createdPayment] = await tx
      .insert(payments)
      .values({
        enrollmentId: createdEnrollment.id,
        userId: input.userId,
        receiptId: receipt.id,
        amountUzs: input.amountUzs,
        paymentMethod: input.paymentMethod,
        status: "verified",
        paidDate,
        paidAt,
        reference: input.reference ?? null,
        note: input.note ?? null,
      })
      .returning({ id: payments.id });

    await tx
      .update(paymentReceipts)
      .set({
        status: "confirmed",
        userId: input.userId,
        enrollmentId: createdEnrollment.id,
        paymentId: createdPayment.id,
        reviewedAt: now,
      })
      .where(eq(paymentReceipts.id, receipt.id));

    return { ok: true as const, userId: input.userId, enrollmentId: createdEnrollment.id };
  });

  if (!txResult.ok) return txResult;

  await recordUserPurchaseSideEffects(txResult.userId, paidAt);

  const [receipt, enrollment] = await Promise.all([
    getReceiptItemById(id),
    getEnrollmentRowById(txResult.enrollmentId),
  ]);
  return { ok: true, receipt: receipt!, enrollment: enrollment! };
}

export async function rejectReceipt(
  id: number,
): Promise<
  { ok: true; receipt: PaymentReceiptItem } | { ok: false; code: "not_found" | "receipt_already_reviewed" }
> {
  const txResult = await db().transaction(async (tx) => {
    const [receipt] = await tx
      .select({ id: paymentReceipts.id, status: paymentReceipts.status })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.id, id))
      .for("update")
      .limit(1);
    if (!receipt) return { ok: false as const, code: "not_found" as const };
    if (receipt.status !== "pending") {
      return { ok: false as const, code: "receipt_already_reviewed" as const };
    }

    await tx
      .update(paymentReceipts)
      .set({ status: "rejected", reviewedAt: new Date() })
      .where(eq(paymentReceipts.id, id));
    return { ok: true as const };
  });

  if (!txResult.ok) return txResult;
  const receipt = await getReceiptItemById(id);
  return { ok: true, receipt: receipt! };
}
