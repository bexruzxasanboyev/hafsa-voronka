import { Readable } from "node:stream";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  courseInputSchema,
  enrollmentCreateSchema,
  enrollmentUpdateSchema,
  paymentRecordCreateSchema,
  paymentsOverviewQuerySchema,
  RECEIPT_MAX_BYTES,
  receiptConfirmInputSchema,
  receiptStatuses,
  type ReceiptStatus,
  studyGroupInputSchema,
  tariffInputSchema,
} from "@funnel/shared";
import { requireAdminAuth } from "@/admin/auth";
import { isOcrConfigured } from "@/payments/ocr";
import {
  confirmReceipt,
  getReceiptMediaForStream,
  listReceipts,
  rejectReceipt,
  retryReceiptOcr,
  uploadAdminReceipt,
} from "@/payments/receipts";
import {
  addPaymentToEnrollment,
  createCourse,
  createEnrollment,
  createStudyGroup,
  createTariff,
  deleteCourse,
  deleteStudyGroup,
  deleteTariff,
  getCatalog,
  getPaymentsOverview,
  refundPayment,
  searchUsersForPayments,
  updateCourse,
  updateEnrollment,
  updateStudyGroup,
  updateTariff,
} from "@/payments/service";
import { bot } from "@/telegram/bot";
import { openTelegramFile, removeLocalTelegramFile } from "@/telegram/files";
import { botMediaChat } from "@/telegram/media";

export const adminPaymentRoutes = new Hono();

adminPaymentRoutes.use("*", requireAdminAuth);

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseOptionalFormId(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") return { ok: false };
  const parsed = parseId(raw.trim());
  if (parsed === null) return { ok: false };
  return { ok: true, value: parsed };
}

adminPaymentRoutes.get("/overview", async (c) => {
  const query = paymentsOverviewQuerySchema.safeParse(c.req.query());
  if (!query.success) return c.json({ error: "invalid_query" }, 400);
  return c.json(await getPaymentsOverview(query.data));
});

adminPaymentRoutes.get("/catalog", async (c) => {
  return c.json(await getCatalog());
});

adminPaymentRoutes.post("/courses", async (c) => {
  const body = courseInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);
  const course = await createCourse(body.data);
  return c.json({ course }, 201);
});

adminPaymentRoutes.put("/courses/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const body = courseInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const course = await updateCourse(id, body.data);
  if (!course) return c.json({ error: "not_found" }, 404);
  return c.json({ course });
});

adminPaymentRoutes.delete("/courses/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const result = await deleteCourse(id);
  if (!result.ok) {
    return c.json({ error: result.code }, result.code === "not_found" ? 404 : 409);
  }
  return c.json({ ok: true });
});

adminPaymentRoutes.post("/tariffs", async (c) => {
  const body = tariffInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const result = await createTariff(body.data);
  if (!result.ok) return c.json({ error: result.code }, 404);
  return c.json({ tariff: result.tariff }, 201);
});

adminPaymentRoutes.put("/tariffs/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const body = tariffInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const result = await updateTariff(id, body.data);
  if (!result.ok) return c.json({ error: result.code }, 404);
  return c.json({ tariff: result.tariff });
});

adminPaymentRoutes.delete("/tariffs/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const result = await deleteTariff(id);
  if (!result.ok) {
    return c.json({ error: result.code }, result.code === "not_found" ? 404 : 409);
  }
  return c.json({ ok: true });
});

adminPaymentRoutes.post("/groups", async (c) => {
  const body = studyGroupInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const result = await createStudyGroup(body.data);
  if (!result.ok) return c.json({ error: result.code }, 404);
  return c.json({ group: result.group }, 201);
});

adminPaymentRoutes.put("/groups/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const body = studyGroupInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const result = await updateStudyGroup(id, body.data);
  if (!result.ok) return c.json({ error: result.code }, 404);
  return c.json({ group: result.group });
});

adminPaymentRoutes.delete("/groups/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const result = await deleteStudyGroup(id);
  if (!result.ok) return c.json({ error: result.code }, 404);
  return c.json({ ok: true });
});

adminPaymentRoutes.get("/users", async (c) => {
  const items = await searchUsersForPayments(c.req.query("q"));
  return c.json({ items });
});

adminPaymentRoutes.post("/enrollments", async (c) => {
  const body = enrollmentCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const result = await createEnrollment(body.data);
  if (!result.ok) {
    const status =
      result.code === "tariff_course_mismatch" || result.code === "invalid_installments" ? 422 : 404;
    return c.json({ error: result.code }, status);
  }
  return c.json({ enrollment: result.enrollment }, 201);
});

adminPaymentRoutes.put("/enrollments/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const body = enrollmentUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const result = await updateEnrollment(id, body.data);
  if (!result.ok) {
    const status =
      result.code === "tariff_course_mismatch" ||
      result.code === "installments_sum_mismatch" ||
      result.code === "installments_required" ||
      result.code === "invalid_installments"
        ? 422
        : 404;
    return c.json({ error: result.code }, status);
  }
  return c.json({ enrollment: result.enrollment });
});

adminPaymentRoutes.post("/enrollments/:id/payments", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const body = paymentRecordCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const result = await addPaymentToEnrollment(id, body.data);
  if (!result.ok) {
    return c.json({ error: result.code }, result.code === "not_found" ? 404 : 409);
  }
  return c.json({ enrollment: result.enrollment, payment: result.payment }, 201);
});

adminPaymentRoutes.post("/records/:paymentId/refund", async (c) => {
  const paymentId = parseId(c.req.param("paymentId"));
  if (paymentId === null) return c.json({ error: "not_found" }, 404);

  const result = await refundPayment(paymentId);
  if (!result.ok) {
    return c.json({ error: result.code }, result.code === "not_found" ? 404 : 409);
  }
  return c.json({ enrollment: result.enrollment });
});

adminPaymentRoutes.get("/receipts", async (c) => {
  const rawStatus = c.req.query("status");
  let status: ReceiptStatus | undefined;
  if (rawStatus !== undefined && rawStatus !== "") {
    if (!receiptStatuses.includes(rawStatus as ReceiptStatus)) {
      return c.json({ error: "invalid_query" }, 400);
    }
    status = rawStatus as ReceiptStatus;
  }

  return c.json({
    ocrConfigured: isOcrConfigured(),
    mediaEnabled: botMediaChat() !== null,
    items: await listReceipts(status),
  });
});

adminPaymentRoutes.post(
  "/receipts/upload",
  bodyLimit({
    maxSize: RECEIPT_MAX_BYTES + 1024 * 1024,
    onError: (c) => c.json({ error: "too_large" }, 413),
  }),
  async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!(file instanceof File)) return c.json({ error: "invalid_request" }, 400);

    const parsedUserId = parseOptionalFormId(form?.userId);
    const parsedEnrollmentId = parseOptionalFormId(form?.enrollmentId);
    if (!parsedUserId.ok || !parsedEnrollmentId.ok) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const result = await uploadAdminReceipt(bot().api, file, {
      userId: parsedUserId.value,
      enrollmentId: parsedEnrollmentId.value,
    });
    if (!result.ok) {
      switch (result.code) {
        case "unsupported_type":
          return c.json({ error: result.code }, 415);
        case "too_large":
          return c.json({ error: result.code }, 413);
        case "invalid_request":
          return c.json({ error: result.code }, 400);
        case "media_not_configured":
        case "media_chat_unavailable":
          return c.json({ error: result.code }, 503);
        case "user_not_found":
        case "enrollment_not_found":
          return c.json({ error: result.code }, 404);
      }
    }
    return c.json({ receipt: result.receipt }, 201);
  },
);

adminPaymentRoutes.get("/receipts/:id/file", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const receipt = await getReceiptMediaForStream(id);
  if (!receipt) return c.json({ error: "not_found" }, 404);

  let opened: Awaited<ReturnType<typeof openTelegramFile>>;
  try {
    opened = await openTelegramFile(bot().api, receipt.fileId);
  } catch {
    return c.json({ error: "not_found" }, 404);
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void removeLocalTelegramFile(opened.localPath);
  };
  opened.stream.once("close", cleanup);
  opened.stream.once("end", cleanup);
  opened.stream.once("error", cleanup);

  const headers: Record<string, string> = {
    "content-type":
      receipt.mimeType || (receipt.mediaType === "pdf" ? "application/pdf" : "image/jpeg"),
    "cache-control": "private, max-age=300",
  };
  if (receipt.fileName) {
    const safeName = receipt.fileName.replace(/["\\\r\n]/g, "_");
    headers["content-disposition"] = `inline; filename="${safeName}"`;
  }

  return new Response(Readable.toWeb(opened.stream) as ReadableStream<Uint8Array>, {
    headers,
  });
});

adminPaymentRoutes.post("/receipts/:id/ocr", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const result = await retryReceiptOcr(id);
  if (!result.ok) return c.json({ error: result.code }, 404);
  return c.json({ receipt: result.receipt });
});

adminPaymentRoutes.post("/receipts/:id/confirm", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const body = receiptConfirmInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const result = await confirmReceipt(id, body.data);
  if (!result.ok) {
    switch (result.code) {
      case "receipt_already_reviewed":
      case "enrollment_cancelled":
        return c.json({ error: result.code }, 409);
      case "tariff_course_mismatch":
      case "invalid_installments":
        return c.json({ error: result.code }, 422);
      default:
        return c.json({ error: result.code }, 404);
    }
  }
  return c.json({ receipt: result.receipt, enrollment: result.enrollment });
});

adminPaymentRoutes.post("/receipts/:id/reject", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const result = await rejectReceipt(id);
  if (!result.ok) {
    return c.json({ error: result.code }, result.code === "not_found" ? 404 : 409);
  }
  return c.json({ receipt: result.receipt });
});
