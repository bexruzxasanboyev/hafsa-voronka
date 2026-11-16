import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { Bot } from "grammy";
import {
  addCalendarMonths,
  paymentsCatalogResponseSchema,
  paymentsOverviewResponseSchema,
  paymentReceiptsResponseSchema,
  paymentUsersLookupResponseSchema,
} from "@funnel/shared";
import { hashPassword } from "@/admin/password";
import { getTashkentToday } from "@/admin/dates";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import {
  courses,
  enrollmentInstallments,
  enrollments,
  events,
  leads,
  paymentReceipts,
  payments,
  segmentRuns,
  studyGroups,
  tariffs,
  users,
} from "@/db/schema";
import { setTestEnv } from "@/test/env";
import { isolatedDatabase } from "@/test/isolatedDb";
import { ensureActiveTestVideo } from "@/test/videos";

const isolatedDb = isolatedDatabase("vf_payments");
const TEST_PASSWORD = "payments-admin-password-2026";
const LEADS_CHAT_ID = "-1001234567890";

vi.mock("@/leads/notifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/leads/notifier")>()),
  kickLeadNotifier: () => {},
}));

describe.skipIf(!isolatedDb.url)("Payments, debts, receipts, and courses API", () => {
  let app: ReturnType<typeof import("@/app").createApp>;
  let testBot: Bot;
  let cookie: string;
  let messageSeq = 5000;
  let telegramSeq = 800_000;
  let tempDir: string;
  let mockFilePath = "";

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "vf-payments-test-"));
    await isolatedDb.create();
    setTestEnv({
      DATABASE_URL: isolatedDb.url!,
      ADMIN_PASSWORD_HASH: await hashPassword(TEST_PASSWORD),
      LEADS_CHAT_ID,
    });
    await runMigrations(isolatedDb.url!);
    await ensureActiveTestVideo();

    testBot = (await import("@/telegram/bot")).bot();
    testBot.api.config.use(async (_prev, method) => {
      if (method === "sendPhoto") {
        return {
          ok: true,
          result: {
            message_id: ++messageSeq,
            photo: [{ file_id: `photo-file-${messageSeq}`, file_unique_id: `u-${messageSeq}`, width: 100, height: 100 }],
          },
        } as never;
      }
      if (method === "sendDocument") {
        return {
          ok: true,
          result: {
            message_id: ++messageSeq,
            document: { file_id: `doc-file-${messageSeq}`, file_unique_id: `u-${messageSeq}` },
          },
        } as never;
      }
      if (method === "getFile") {
        return {
          ok: true,
          result: {
            file_id: "mock-file",
            file_unique_id: "mock-unique",
            file_size: 16,
            file_path: mockFilePath,
          },
        } as never;
      }
      if (method.startsWith("send")) {
        return { ok: true, result: { message_id: ++messageSeq } } as never;
      }
      return { ok: true, result: true } as never;
    });

    app = (await import("@/app")).createApp();

    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.99" },
      body: JSON.stringify({ username: "admin", password: TEST_PASSWORD }),
    });
    expect(login.status).toBe(200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
  });

  beforeEach(async () => {
    await db().delete(payments);
    await db().delete(paymentReceipts);
    await db().delete(enrollmentInstallments);
    await db().delete(enrollments);
    await db().delete(studyGroups);
    await db().delete(tariffs);
    await db().delete(courses);
    await db().delete(leads);
    await db().delete(events);
    await db().delete(segmentRuns);
    await db().delete(users);
  });

  afterAll(async () => {
    await closeDb();
    await isolatedDb.drop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    if (init.body && typeof init.body === "string" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return app.request(`/admin/payments${path}`, { ...init, headers });
  }

  async function seedUser(overrides: Partial<typeof users.$inferInsert> = {}) {
    const tgId = ++telegramSeq;
    const [row] = await db()
      .insert(users)
      .values({
        telegramId: tgId,
        name: "Ali Valiyev",
        firstName: "Ali",
        username: `user_${tgId}`,
        phone: "+998901112233",
        registeredAt: new Date("2026-11-01T10:00:00Z"),
        ...overrides,
      })
      .returning();
    return row;
  }

  it("manages courses, tariffs, and study groups with 409 in-use guards", async () => {
    const cRes = await api("/courses", {
      method: "POST",
      body: JSON.stringify({ title: "SMM Pro", description: "Full course", isActive: true }),
    });
    expect(cRes.status).toBe(201);
    const { course } = (await cRes.json()) as { course: { id: number; title: string } };

    const tRes = await api("/tariffs", {
      method: "POST",
      body: JSON.stringify({
        courseId: course.id,
        name: "VIP",
        priceUzs: 4_500_000,
        allowsInstallments: true,
        defaultInstallmentMonths: 3,
      }),
    });
    expect(tRes.status).toBe(201);
    const { tariff } = (await tRes.json()) as { tariff: { id: number } };

    const gRes = await api("/groups", {
      method: "POST",
      body: JSON.stringify({
        name: "Kuz-1",
        courseId: course.id,
        startsAt: "2026-11-20",
        capacity: 25,
      }),
    });
    expect(gRes.status).toBe(201);
    const { group } = (await gRes.json()) as { group: { id: number } };

    const user = await seedUser();
    const eRes = await api("/enrollments", {
      method: "POST",
      body: JSON.stringify({
        userId: user.id,
        courseId: course.id,
        tariffId: tariff.id,
        studyGroupId: group.id,
        contractAmountUzs: 4_500_000,
        installmentMonths: 3,
      }),
    });
    expect(eRes.status).toBe(201);

    const delCourseInUse = await api(`/courses/${course.id}`, { method: "DELETE" });
    expect(delCourseInUse.status).toBe(409);
    expect(await delCourseInUse.json()).toEqual({ error: "course_in_use" });

    const delTariffInUse = await api(`/tariffs/${tariff.id}`, { method: "DELETE" });
    expect(delTariffInUse.status).toBe(409);
    expect(await delTariffInUse.json()).toEqual({ error: "tariff_in_use" });

    const unusedCourseRes = await api("/courses", {
      method: "POST",
      body: JSON.stringify({ title: "Temp Course" }),
    });
    const { course: unusedCourse } = (await unusedCourseRes.json()) as { course: { id: number } };
    const delUnused = await api(`/courses/${unusedCourse.id}`, { method: "DELETE" });
    expect(delUnused.status).toBe(200);

    const catRes = await api("/catalog");
    expect(catRes.status).toBe(200);
    const catalog = paymentsCatalogResponseSchema.parse(await catRes.json());
    expect(catalog.courses).toHaveLength(1);
    expect(catalog.tariffs).toHaveLength(1);
    expect(catalog.groups).toHaveLength(1);
  });

  it("handles enrollment schedules, oldest-first payments, lead win, segment bought, and refunds", async () => {
    const today = getTashkentToday();
    const lastMonth = addCalendarMonths(today, -1);
    const nextMonth = addCalendarMonths(today, 1);

    const user = await seedUser({
      name: "Dilshod",
      username: "dilshod_tg",
      phone: "+998909876543",
      utmSource: "ig_reels",
      utmCampaign: "camp_1",
      lastUtmSource: "tg_ads",
      lastUtmCampaign: "camp_2",
    });

    const [lead] = await db()
      .insert(leads)
      .values({
        source: "bot",
        userId: user.id,
        name: "Dilshod",
        phone: "+998909876543",
      })
      .returning();

    await db().insert(segmentRuns).values({
      userId: user.id,
      segment: "E",
      enteredAt: new Date("2026-11-10T10:00:00Z"),
    });

    const [course] = await db().insert(courses).values({ title: "Target" }).returning();
    const [otherCourse] = await db().insert(courses).values({ title: "Other" }).returning();
    const [tariff] = await db()
      .insert(tariffs)
      .values({ courseId: course.id, name: "Standard", priceUzs: 3_000_000 })
      .returning();
    const [otherTariff] = await db()
      .insert(tariffs)
      .values({ courseId: otherCourse.id, name: "OtherTariff", priceUzs: 1_000_000 })
      .returning();
    const [group] = await db()
      .insert(studyGroups)
      .values({ name: "G-1", courseId: course.id })
      .returning();

    const mismatchTariffRes = await api("/enrollments", {
      method: "POST",
      body: JSON.stringify({
        userId: user.id,
        courseId: course.id,
        tariffId: otherTariff.id,
        contractAmountUzs: 3_000_000,
      }),
    });
    expect(mismatchTariffRes.status).toBe(422);

    const mismatchSumRes = await api("/enrollments", {
      method: "POST",
      body: JSON.stringify({
        userId: user.id,
        courseId: course.id,
        tariffId: tariff.id,
        contractAmountUzs: 3_000_000,
        installments: [{ installmentNo: 1, dueDate: today, amountUzs: 1_000_000 }],
      }),
    });
    expect(mismatchSumRes.status).toBe(400);

    const createRes = await api("/enrollments", {
      method: "POST",
      body: JSON.stringify({
        userId: user.id,
        courseId: course.id,
        tariffId: tariff.id,
        studyGroupId: group.id,
        contractAmountUzs: 3_000_000,
        installments: [
          { installmentNo: 1, dueDate: lastMonth, amountUzs: 1_000_000 },
          { installmentNo: 2, dueDate: today, amountUzs: 1_000_000 },
          { installmentNo: 3, dueDate: nextMonth, amountUzs: 1_000_000 },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const { enrollment: created } = (await createRes.json()) as {
      enrollment: { id: number; debtStatus: string; status: string };
    };
    expect(created.debtStatus).toBe("overdue");
    expect(created.status).toBe("active");

    const lookupRes = await api("/users?q=dilshod_tg");
    expect(lookupRes.status).toBe(200);
    const lookup = paymentUsersLookupResponseSchema.parse(await lookupRes.json());
    expect(lookup.items).toHaveLength(1);
    expect(lookup.items[0]?.activeEnrollmentCount).toBe(1);

    const pay1Res = await api(`/enrollments/${created.id}/payments`, {
      method: "POST",
      body: JSON.stringify({
        amountUzs: 1_500_000,
        paymentMethod: "click",
        reference: "TX-1",
      }),
    });
    expect(pay1Res.status).toBe(201);
    const pay1Body = (await pay1Res.json()) as {
      enrollment: {
        status: string;
        debtStatus: string;
        paidAmountUzs: number;
        installments: { installmentNo: number; paidUzs: number; remainingUzs: number; state: string }[];
      };
      payment: { id: number };
    };
    expect(pay1Body.enrollment.status).toBe("active");
    expect(pay1Body.enrollment.debtStatus).toBe("installment");
    expect(pay1Body.enrollment.paidAmountUzs).toBe(1_500_000);
    expect(pay1Body.enrollment.installments[0]).toMatchObject({
      installmentNo: 1,
      paidUzs: 1_000_000,
      remainingUzs: 0,
      state: "paid",
    });
    expect(pay1Body.enrollment.installments[1]).toMatchObject({
      installmentNo: 2,
      paidUzs: 500_000,
      remainingUzs: 500_000,
      state: "upcoming",
    });

    const [updatedUser] = await db().select().from(users).where(eq(users.id, user.id));
    expect(updatedUser.paidAt).not.toBeNull();
    expect(updatedUser.wroteAdminAt).not.toBeNull();

    const [updatedLead] = await db().select().from(leads).where(eq(leads.id, lead.id));
    expect(updatedLead.outcome).toBe("won");
    expect(updatedLead.outcomeAt).not.toBeNull();

    const runs = await db()
      .select()
      .from(segmentRuns)
      .where(eq(segmentRuns.userId, user.id))
      .orderBy(asc(segmentRuns.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.endReason).toBe("bought");

    const pay2Res = await api(`/enrollments/${created.id}/payments`, {
      method: "POST",
      body: JSON.stringify({
        amountUzs: 1_500_000,
        paymentMethod: "payme",
        reference: "TX-2",
      }),
    });
    expect(pay2Res.status).toBe(201);
    const pay2Body = (await pay2Res.json()) as {
      enrollment: { status: string; debtStatus: string; totalRemainingUzs: number };
      payment: { id: number };
    };
    expect(pay2Body.enrollment.status).toBe("completed");
    expect(pay2Body.enrollment.debtStatus).toBe("paid");
    expect(pay2Body.enrollment.totalRemainingUzs).toBe(0);

    const refundRes = await api(`/records/${pay2Body.payment.id}/refund`, { method: "POST" });
    expect(refundRes.status).toBe(200);
    const refundBody = (await refundRes.json()) as {
      enrollment: { status: string; paidAmountUzs: number; totalRemainingUzs: number };
    };
    expect(refundBody.enrollment.status).toBe("active");
    expect(refundBody.enrollment.paidAmountUzs).toBe(1_500_000);
    expect(refundBody.enrollment.totalRemainingUzs).toBe(1_500_000);

    const doubleRefund = await api(`/records/${pay2Body.payment.id}/refund`, { method: "POST" });
    expect(doubleRefund.status).toBe(409);

    const amountOnlyRes = await api(`/enrollments/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({ contractAmountUzs: 2_500_000 }),
    });
    expect(amountOnlyRes.status).toBe(422);
    expect(((await amountOnlyRes.json()) as { error: string }).error).toBe("installments_required");

    const editRes = await api(`/enrollments/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({
        contractAmountUzs: 2_500_000,
        installments: [
          { installmentNo: 1, dueDate: lastMonth, amountUzs: 1_500_000 },
          { installmentNo: 2, dueDate: nextMonth, amountUzs: 1_000_000 },
        ],
        note: "Discounted",
      }),
    });
    expect(editRes.status).toBe(200);
    const editBody = (await editRes.json()) as {
      enrollment: { contractAmountUzs: number; totalRemainingUzs: number; note: string };
    };
    expect(editBody.enrollment.contractAmountUzs).toBe(2_500_000);
    expect(editBody.enrollment.totalRemainingUzs).toBe(1_000_000);
    expect(editBody.enrollment.note).toBe("Discounted");
  });

  it("uploads, streams, retries OCR, confirms (existing & new_enrollment), and rejects receipts", async () => {
    const user1 = await seedUser({ name: "Madina" });
    const user2 = await seedUser({ name: "Sardor" });
    const [course] = await db().insert(courses).values({ title: "Design" }).returning();
    const [tariff] = await db()
      .insert(tariffs)
      .values({ courseId: course.id, name: "Base", priceUzs: 2_000_000 })
      .returning();
    const [enrollment1] = await db()
      .insert(enrollments)
      .values({
        userId: user1.id,
        courseId: course.id,
        tariffId: tariff.id,
        contractAmountUzs: 2_000_000,
      })
      .returning();
    await db().insert(enrollmentInstallments).values({
      enrollmentId: enrollment1.id,
      installmentNo: 1,
      dueDate: getTashkentToday(),
      amountUzs: 2_000_000,
    });

    const form = new FormData();
    form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "receipt1.jpg", { type: "image/jpeg" }));
    form.append("userId", String(user1.id));

    const uploadRes = await api("/receipts/upload", { method: "POST", body: form });
    expect(uploadRes.status).toBe(201);
    const { receipt: r1 } = (await uploadRes.json()) as {
      receipt: { id: number; enrollmentId: number; status: string; ocrStatus: string };
    };
    expect(r1.enrollmentId).toBe(enrollment1.id);
    expect(r1.status).toBe("pending");
    expect(r1.ocrStatus).toBe("skipped");

    mockFilePath = join(tempDir, "streamed-receipt.jpg");
    writeFileSync(mockFilePath, Buffer.from("receipt-image-bytes"));

    const fileRes = await api(`/receipts/${r1.id}/file`);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("content-type")).toBe("image/jpeg");
    const streamedBytes = Buffer.from(await fileRes.arrayBuffer()).toString("utf8");
    expect(streamedBytes).toBe("receipt-image-bytes");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(existsSync(mockFilePath)).toBe(false);

    const ocrRetryRes = await api(`/receipts/${r1.id}/ocr`, { method: "POST" });
    expect(ocrRetryRes.status).toBe(200);

    const confirmExistingRes = await api(`/receipts/${r1.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        mode: "existing",
        enrollmentId: enrollment1.id,
        amountUzs: 2_000_000,
        paymentMethod: "uzum",
        reference: "UZ-101",
      }),
    });
    expect(confirmExistingRes.status).toBe(200);
    const confirmExistingBody = (await confirmExistingRes.json()) as {
      receipt: { status: string; paymentId: number; enrollmentId: number };
      enrollment: { status: string; paidAmountUzs: number };
    };
    expect(confirmExistingBody.receipt.status).toBe("confirmed");
    expect(confirmExistingBody.receipt.paymentId).toBeGreaterThan(0);
    expect(confirmExistingBody.enrollment.status).toBe("completed");
    expect(confirmExistingBody.enrollment.paidAmountUzs).toBe(2_000_000);

    const doubleConfirm = await api(`/receipts/${r1.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        mode: "existing",
        enrollmentId: enrollment1.id,
        amountUzs: 100_000,
        paymentMethod: "cash",
      }),
    });
    expect(doubleConfirm.status).toBe(409);

    const form2 = new FormData();
    form2.append("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "chek.pdf", { type: "application/pdf" }));
    const upload2Res = await api("/receipts/upload", { method: "POST", body: form2 });
    expect(upload2Res.status).toBe(201);
    const { receipt: r2 } = (await upload2Res.json()) as { receipt: { id: number } };

    const confirmNewRes = await api(`/receipts/${r2.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        mode: "new_enrollment",
        userId: user2.id,
        courseId: course.id,
        tariffId: tariff.id,
        contractAmountUzs: 2_000_000,
        installmentMonths: 2,
        amountUzs: 1_000_000,
        paymentMethod: "card_transfer",
      }),
    });
    expect(confirmNewRes.status).toBe(200);
    const confirmNewBody = (await confirmNewRes.json()) as {
      receipt: { status: string; userId: number; enrollmentId: number; paymentId: number };
      enrollment: { userId: number; status: string; paidAmountUzs: number; totalRemainingUzs: number };
    };
    expect(confirmNewBody.receipt.status).toBe("confirmed");
    expect(confirmNewBody.receipt.userId).toBe(user2.id);
    expect(confirmNewBody.enrollment.status).toBe("active");
    expect(confirmNewBody.enrollment.paidAmountUzs).toBe(1_000_000);
    expect(confirmNewBody.enrollment.totalRemainingUzs).toBe(1_000_000);

    const form3 = new FormData();
    form3.append("file", new File([new Uint8Array([1, 2, 3])], "bad.png", { type: "image/png" }));
    const upload3Res = await api("/receipts/upload", { method: "POST", body: form3 });
    expect(upload3Res.status).toBe(201);
    const { receipt: r3 } = (await upload3Res.json()) as { receipt: { id: number } };

    const rejectRes = await api(`/receipts/${r3.id}/reject`, { method: "POST" });
    expect(rejectRes.status).toBe(200);
    const rejectBody = (await rejectRes.json()) as { receipt: { status: string; reviewedAt: string } };
    expect(rejectBody.receipt.status).toBe("rejected");
    expect(rejectBody.receipt.reviewedAt).not.toBeNull();

    const listConfirmed = await api("/receipts?status=confirmed");
    expect(listConfirmed.status).toBe(200);
    const parsedList = paymentReceiptsResponseSchema.parse(await listConfirmed.json());
    expect(parsedList.mediaEnabled).toBe(true);
    expect(parsedList.items).toHaveLength(2);
  });

  it("computes overview KPIs, attribution models, filters, and Tab 2 group discipline", async () => {
    const today = getTashkentToday();
    const pastMonth = addCalendarMonths(today, -1);

    const igToTgUser = await seedUser({
      name: "Aziza",
      utmSource: "instagram",
      utmCampaign: "ig_1",
      lastUtmSource: "telegram",
      lastUtmCampaign: "tg_1",
    });
    const fbUser = await seedUser({
      name: "Bekzod",
      utmSource: "facebook",
      utmCampaign: "fb_1",
      lastUtmSource: "facebook",
      lastUtmCampaign: "fb_1",
    });

    const [course] = await db().insert(courses).values({ title: "English" }).returning();
    const [tariff] = await db()
      .insert(tariffs)
      .values({ courseId: course.id, name: "Full", priceUzs: 3_000_000 })
      .returning();
    const [groupA] = await db()
      .insert(studyGroups)
      .values({ name: "G-A", courseId: course.id, isActive: true })
      .returning();

    await api("/enrollments", {
      method: "POST",
      body: JSON.stringify({
        userId: igToTgUser.id,
        courseId: course.id,
        tariffId: tariff.id,
        studyGroupId: groupA.id,
        contractAmountUzs: 3_000_000,
        installments: [
          { installmentNo: 1, dueDate: pastMonth, amountUzs: 1_000_000 },
          { installmentNo: 2, dueDate: today, amountUzs: 2_000_000 },
        ],
        initialPayment: { amountUzs: 1_500_000, paymentMethod: "click" },
      }),
    });

    await api("/enrollments", {
      method: "POST",
      body: JSON.stringify({
        userId: fbUser.id,
        courseId: course.id,
        tariffId: tariff.id,
        studyGroupId: null,
        contractAmountUzs: 2_000_000,
        installments: [{ installmentNo: 1, dueDate: pastMonth, amountUzs: 2_000_000 }],
        initialPayment: { amountUzs: 2_000_000, paymentMethod: "payme" },
      }),
    });

    const lastTouchRes = await api("/overview?attributionModel=last");
    expect(lastTouchRes.status).toBe(200);
    const lastOverview = paymentsOverviewResponseSchema.parse(await lastTouchRes.json());
    expect(lastOverview.kpis).toEqual({
      totalPayingStudents: 2,
      totalCollectedUzs: 3_500_000,
      currentMonthExpectedDebtUzs: 1_500_000,
      totalRemainingDebtUzs: 1_500_000,
    });
    expect(lastOverview.groups).toHaveLength(2);
    expect(lastOverview.groups[0]).toMatchObject({
      groupId: groupA.id,
      groupName: "G-A",
      studentsCount: 1,
      maturedDueUzs: 3_000_000,
      maturedPaidUzs: 1_500_000,
      disciplinePercent: 50,
    });
    expect(lastOverview.groups[1]).toMatchObject({
      groupId: null,
      groupName: null,
      studentsCount: 1,
      disciplinePercent: 100,
    });

    const tgFilterRes = await api("/overview?attributionModel=last&network=tg");
    const tgOverview = paymentsOverviewResponseSchema.parse(await tgFilterRes.json());
    expect(tgOverview.students).toHaveLength(1);
    expect(tgOverview.students[0]?.userId).toBe(igToTgUser.id);
    expect(tgOverview.students[0]?.attributionNetwork).toBe("tg");

    const igFirstRes = await api("/overview?attributionModel=first&network=ig");
    const igOverview = paymentsOverviewResponseSchema.parse(await igFirstRes.json());
    expect(igOverview.students).toHaveLength(1);
    expect(igOverview.students[0]?.userId).toBe(igToTgUser.id);
    expect(igOverview.students[0]?.attributionNetwork).toBe("ig");

    const unassignedRes = await api("/overview?studyGroupId=unassigned");
    const unassignedOverview = paymentsOverviewResponseSchema.parse(await unassignedRes.json());
    expect(unassignedOverview.students).toHaveLength(1);
    expect(unassignedOverview.students[0]?.userId).toBe(fbUser.id);
    expect(unassignedOverview.kpis.totalCollectedUzs).toBe(2_000_000);
  });
});
