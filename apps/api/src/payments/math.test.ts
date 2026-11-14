import { describe, expect, it } from "vitest";
import {
  addCalendarMonths,
  aggregateGroupBreakdowns,
  buildDefaultInstallmentSchedule,
  computeEnrollmentFinancials,
  courseInputSchema,
  endOfCalendarMonth,
  enrollmentCreateSchema,
  enrollmentUpdateSchema,
  normalizeAttributionNetwork,
  paymentsCatalogResponseSchema,
  paymentsOverviewQuerySchema,
  paymentsOverviewResponseSchema,
  paymentReceiptsResponseSchema,
  paymentUsersLookupResponseSchema,
  receiptConfirmInputSchema,
  receiptOcrResultSchema,
  RECEIPT_MAX_BYTES,
  studyGroupInputSchema,
  tariffInputSchema,
  ymdDateSchema,
} from "@funnel/shared";

describe("normalizeAttributionNetwork", () => {
  it("maps empty and nullish sources to organic", () => {
    expect(normalizeAttributionNetwork(null)).toBe("organic");
    expect(normalizeAttributionNetwork(undefined)).toBe("organic");
    expect(normalizeAttributionNetwork("   ")).toBe("organic");
  });

  it("maps canonical network prefixes case-insensitively", () => {
    expect(normalizeAttributionNetwork("ig")).toBe("ig");
    expect(normalizeAttributionNetwork(" Instagram_Reels ")).toBe("ig");
    expect(normalizeAttributionNetwork("fb")).toBe("fb");
    expect(normalizeAttributionNetwork("Facebook")).toBe("fb");
    expect(normalizeAttributionNetwork("meta_ads")).toBe("fb");
    expect(normalizeAttributionNetwork("tg")).toBe("tg");
    expect(normalizeAttributionNetwork("TelegramAds")).toBe("tg");
  });

  it("maps unknown sources to other", () => {
    expect(normalizeAttributionNetwork("youtube")).toBe("other");
    expect(normalizeAttributionNetwork("tiktok")).toBe("other");
  });
});

describe("calendar date helpers", () => {
  it("validates real calendar dates in ymdDateSchema", () => {
    expect(ymdDateSchema.safeParse("2026-11-14").success).toBe(true);
    expect(ymdDateSchema.safeParse("2024-02-29").success).toBe(true);
    expect(ymdDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(ymdDateSchema.safeParse("2026-04-31").success).toBe(false);
    expect(ymdDateSchema.safeParse("2026-13-01").success).toBe(false);
    expect(ymdDateSchema.safeParse("2026-11-1").success).toBe(false);
  });

  it("adds calendar months with leap-year day clamping", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addCalendarMonths("2026-11-14", 2)).toBe("2027-01-14");
    expect(addCalendarMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-05-15", 0)).toBe("2026-05-15");
    expect(() => addCalendarMonths("2026-02-29", 1)).toThrow();
  });

  it("computes end of calendar month", () => {
    expect(endOfCalendarMonth("2026-11-14")).toBe("2026-11-30");
    expect(endOfCalendarMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfCalendarMonth("2024-02-01")).toBe("2024-02-29");
    expect(endOfCalendarMonth("2026-12-01")).toBe("2026-12-31");
  });
});

describe("buildDefaultInstallmentSchedule", () => {
  it("puts division remainder onto installment 1 and clamps due dates", () => {
    expect(buildDefaultInstallmentSchedule(1_000_000, 3, "2026-01-31")).toEqual([
      { installmentNo: 1, dueDate: "2026-01-31", amountUzs: 333_334 },
      { installmentNo: 2, dueDate: "2026-02-28", amountUzs: 333_333 },
      { installmentNo: 3, dueDate: "2026-03-31", amountUzs: 333_333 },
    ]);
  });

  it("handles even division and single-month contracts", () => {
    expect(buildDefaultInstallmentSchedule(4_500_000, 1, "2026-11-14")).toEqual([
      { installmentNo: 1, dueDate: "2026-11-14", amountUzs: 4_500_000 },
    ]);
  });

  it("rejects invalid contract or month counts", () => {
    expect(() => buildDefaultInstallmentSchedule(1_000_000, 0, "2026-11-14")).toThrow();
    expect(() => buildDefaultInstallmentSchedule(-100, 2, "2026-11-14")).toThrow();
  });
});

describe("computeEnrollmentFinancials", () => {
  it("sorts installments and allocates verified payments oldest-first", () => {
    const result = computeEnrollmentFinancials({
      contractAmountUzs: 3_000_000,
      installments: [
        { id: 12, installmentNo: 2, dueDate: "2026-11-14", amountUzs: 1_000_000 },
        { id: 13, installmentNo: 3, dueDate: "2026-12-10", amountUzs: 1_000_000 },
        { id: 11, installmentNo: 1, dueDate: "2026-10-10", amountUzs: 1_000_000 },
      ],
      verifiedPaidUzs: 1_400_000,
      todayYmd: "2026-11-14",
    });

    expect(result.installments).toEqual([
      {
        id: 11,
        installmentNo: 1,
        dueDate: "2026-10-10",
        amountUzs: 1_000_000,
        paidUzs: 1_000_000,
        remainingUzs: 0,
        state: "paid",
      },
      {
        id: 12,
        installmentNo: 2,
        dueDate: "2026-11-14",
        amountUzs: 1_000_000,
        paidUzs: 400_000,
        remainingUzs: 600_000,
        state: "upcoming",
      },
      {
        id: 13,
        installmentNo: 3,
        dueDate: "2026-12-10",
        amountUzs: 1_000_000,
        paidUzs: 0,
        remainingUzs: 1_000_000,
        state: "upcoming",
      },
    ]);
    expect(result.totalRemainingUzs).toBe(1_600_000);
    expect(result.currentMonthDebtUzs).toBe(600_000);
    expect(result.currentDueDate).toBe("2026-11-14");
    expect(result.nextDueDate).toBe("2026-11-14");
    expect(result.maturedDueUzs).toBe(2_000_000);
    expect(result.maturedPaidUzs).toBe(1_400_000);
    expect(result.debtStatus).toBe("installment");
  });

  it("marks overdue installments and handles future-only remaining debt", () => {
    const overdue = computeEnrollmentFinancials({
      contractAmountUzs: 2_000_000,
      installments: [
        { installmentNo: 1, dueDate: "2026-11-01", amountUzs: 1_000_000 },
        { installmentNo: 2, dueDate: "2026-12-01", amountUzs: 1_000_000 },
      ],
      verifiedPaidUzs: 500_000,
      todayYmd: "2026-11-14",
    });
    expect(overdue.debtStatus).toBe("overdue");
    expect(overdue.installments[0]?.state).toBe("overdue");
    expect(overdue.currentMonthDebtUzs).toBe(500_000);
    expect(overdue.currentDueDate).toBe("2026-11-01");
    expect(overdue.nextDueDate).toBe("2026-11-01");

    const upcomingOnly = computeEnrollmentFinancials({
      contractAmountUzs: 2_000_000,
      installments: [
        { installmentNo: 1, dueDate: "2026-11-01", amountUzs: 1_000_000 },
        { installmentNo: 2, dueDate: "2026-12-01", amountUzs: 1_000_000 },
      ],
      verifiedPaidUzs: 1_000_000,
      todayYmd: "2026-11-14",
    });
    expect(upcomingOnly.debtStatus).toBe("installment");
    expect(upcomingOnly.currentMonthDebtUzs).toBe(0);
    expect(upcomingOnly.currentDueDate).toBeNull();
    expect(upcomingOnly.nextDueDate).toBe("2026-12-01");
  });

  it("marks paid when verified payments cover or exceed contract amount", () => {
    const paid = computeEnrollmentFinancials({
      contractAmountUzs: 1_000_000,
      installments: [{ installmentNo: 1, dueDate: "2026-11-01", amountUzs: 1_000_000 }],
      verifiedPaidUzs: 1_250_000,
      todayYmd: "2026-11-14",
    });
    expect(paid.totalRemainingUzs).toBe(0);
    expect(paid.debtStatus).toBe("paid");
    expect(paid.installments[0]?.paidUzs).toBe(1_000_000);
    expect(paid.installments[0]?.remainingUzs).toBe(0);
    expect(paid.currentDueDate).toBeNull();
    expect(paid.nextDueDate).toBeNull();
  });
});

describe("aggregateGroupBreakdowns", () => {
  const groups = [
    { id: 1, name: "Beta", courseId: 10, courseTitle: "Pro" },
    { id: 2, name: "Alpha", courseId: 10, courseTitle: "Pro" },
    { id: 3, name: "Empty", courseId: null, courseTitle: null },
  ];

  it("ignores cancelled enrollments, computes discipline, sorts groups, and hides empty unassigned bucket", () => {
    const result = aggregateGroupBreakdowns({
      groups,
      enrollments: [
        {
          studyGroupId: 1,
          status: "active",
          contractAmountUzs: 3_000_000,
          paidAmountUzs: 2_000_000,
          currentMonthDebtUzs: 500_000,
          totalRemainingUzs: 1_000_000,
          maturedDueUzs: 3_000_000,
          maturedPaidUzs: 2_000_000,
        },
        {
          studyGroupId: 2,
          status: "completed",
          contractAmountUzs: 3_000_000,
          paidAmountUzs: 3_000_000,
          currentMonthDebtUzs: 0,
          totalRemainingUzs: 0,
          maturedDueUzs: 0,
          maturedPaidUzs: 0,
        },
        {
          studyGroupId: null,
          status: "cancelled",
          contractAmountUzs: 2_000_000,
          paidAmountUzs: 0,
          currentMonthDebtUzs: 2_000_000,
          totalRemainingUzs: 2_000_000,
          maturedDueUzs: 2_000_000,
          maturedPaidUzs: 0,
        },
      ],
    });

    expect(result.map((row) => row.groupName)).toEqual(["Alpha", "Beta", "Empty"]);
    expect(result[0]?.disciplinePercent).toBe(100);
    expect(result[1]?.disciplinePercent).toBe(66.7);
    expect(result[2]?.studentsCount).toBe(0);
    expect(result[2]?.disciplinePercent).toBe(0);
  });

  it("appends unassigned bucket last when active enrollments have studyGroupId null", () => {
    const result = aggregateGroupBreakdowns({
      groups,
      enrollments: [
        {
          studyGroupId: null,
          status: "active",
          contractAmountUzs: 5_000_000,
          paidAmountUzs: 2_500_000,
          currentMonthDebtUzs: 0,
          totalRemainingUzs: 2_500_000,
          maturedDueUzs: 2_500_000,
          maturedPaidUzs: 2_500_000,
        },
        {
          studyGroupId: 1,
          status: "active",
          contractAmountUzs: 1_000_000,
          paidAmountUzs: 500_000,
          currentMonthDebtUzs: 500_000,
          totalRemainingUzs: 500_000,
          maturedDueUzs: 1_000_000,
          maturedPaidUzs: 500_000,
        },
      ],
    });

    expect(result).toHaveLength(4);
    expect(result[3]).toMatchObject({
      groupId: null,
      groupName: null,
      studentsCount: 1,
      totalContractUzs: 5_000_000,
      disciplinePercent: 100,
    });
  });
});

describe("payments Zod schemas", () => {
  it("exports RECEIPT_MAX_BYTES as 15 MiB", () => {
    expect(RECEIPT_MAX_BYTES).toBe(15 * 1024 * 1024);
  });

  it("validates catalog inputs and responses", () => {
    expect(courseInputSchema.parse({ title: "  SMM Pro " })).toEqual({
      title: "SMM Pro",
      description: null,
      isActive: true,
    });
    expect(tariffInputSchema.parse({ courseId: 1, name: "VIP", priceUzs: 4_000_000 })).toEqual({
      courseId: 1,
      name: "VIP",
      priceUzs: 4_000_000,
      allowsInstallments: true,
      defaultInstallmentMonths: 1,
      isActive: true,
    });
    expect(studyGroupInputSchema.parse({ name: "Guruh #1" })).toEqual({
      name: "Guruh #1",
      courseId: null,
      startsAt: null,
      capacity: null,
      isActive: true,
    });
    expect(
      paymentsCatalogResponseSchema.safeParse({
        courses: [
          {
            id: 1,
            title: "SMM Pro",
            description: null,
            isActive: true,
            createdAt: "2026-11-14T10:00:00.000Z",
          },
        ],
        tariffs: [
          {
            id: 1,
            courseId: 1,
            courseTitle: "SMM Pro",
            name: "VIP",
            priceUzs: 4_000_000,
            allowsInstallments: true,
            defaultInstallmentMonths: 3,
            isActive: true,
            createdAt: "2026-11-14T10:00:00.000Z",
          },
        ],
        groups: [
          {
            id: 1,
            name: "Guruh #1",
            courseId: 1,
            courseTitle: "SMM Pro",
            startsAt: "2026-11-20",
            capacity: 25,
            isActive: true,
            createdAt: "2026-11-14T10:00:00.000Z",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("validates enrollments, installments consistency, and updates", () => {
    const validCreate = enrollmentCreateSchema.safeParse({
      userId: 5,
      courseId: 1,
      tariffId: 2,
      contractAmountUzs: 2_000_000,
      installmentMonths: 2,
      firstDueDate: "2026-11-14",
      installments: [
        { installmentNo: 1, dueDate: "2026-11-14", amountUzs: 1_000_000 },
        { installmentNo: 2, dueDate: "2026-12-14", amountUzs: 1_000_000 },
      ],
      initialPayment: {
        amountUzs: 500_000,
        paymentMethod: "click",
      },
    });
    expect(validCreate.success).toBe(true);

    const mismatchedSum = enrollmentCreateSchema.safeParse({
      userId: 5,
      courseId: 1,
      tariffId: 2,
      contractAmountUzs: 2_000_000,
      installments: [{ installmentNo: 1, dueDate: "2026-11-14", amountUzs: 1_000_000 }],
    });
    expect(mismatchedSum.success ? null : mismatchedSum.error.issues[0]).toMatchObject({
      message: "installments_sum_mismatch",
      path: ["installments"],
    });

    const duplicateNo = enrollmentCreateSchema.safeParse({
      userId: 5,
      courseId: 1,
      tariffId: 2,
      contractAmountUzs: 2_000_000,
      installments: [
        { installmentNo: 1, dueDate: "2026-11-14", amountUzs: 1_000_000 },
        { installmentNo: 1, dueDate: "2026-12-14", amountUzs: 1_000_000 },
      ],
    });
    expect(duplicateNo.success ? null : duplicateNo.error.issues[0]).toMatchObject({
      message: "duplicate_installment_no",
      path: ["installments"],
    });

    expect(enrollmentUpdateSchema.safeParse({}).success).toBe(false);
    expect(enrollmentUpdateSchema.safeParse({ studyGroupId: null }).success).toBe(true);
  });

  it("validates receipt OCR, confirm discriminated union, overview, and user lookup", () => {
    expect(
      receiptOcrResultSchema.safeParse({
        isReceipt: true,
        amountUzs: 1_500_000,
        paidDate: "2026-11-14",
        paymentMethod: "payme",
        reference: "TX-123",
        confidence: 0.94,
      }).success,
    ).toBe(true);

    expect(
      receiptConfirmInputSchema.safeParse({
        mode: "existing",
        enrollmentId: 10,
        amountUzs: 1_000_000,
        paymentMethod: "click",
      }).success,
    ).toBe(true);

    expect(
      receiptConfirmInputSchema.safeParse({
        mode: "new_enrollment",
        userId: 7,
        courseId: 1,
        tariffId: 2,
        contractAmountUzs: 3_000_000,
        amountUzs: 1_000_000,
        paymentMethod: "card_transfer",
      }).success,
    ).toBe(true);

    expect(
      receiptConfirmInputSchema.safeParse({
        mode: "new_enrollment",
        userId: 7,
        courseId: 1,
        tariffId: 2,
        contractAmountUzs: 3_000_000,
        installments: [{ installmentNo: 1, dueDate: "2026-11-14", amountUzs: 1_000_000 }],
        amountUzs: 1_000_000,
        paymentMethod: "card_transfer",
      }).success,
    ).toBe(false);

    expect(paymentsOverviewQuerySchema.parse({ courseId: "2", studyGroupId: "unassigned" })).toEqual({
      attributionModel: "last",
      courseId: 2,
      studyGroupId: "unassigned",
    });

    expect(
      paymentsOverviewResponseSchema.safeParse({
        todayYmd: "2026-11-14",
        attributionModel: "first",
        kpis: {
          totalPayingStudents: 1,
          totalCollectedUzs: 1_000_000,
          currentMonthExpectedDebtUzs: 500_000,
          totalRemainingDebtUzs: 2_000_000,
        },
        students: [
          {
            id: 1,
            userId: 10,
            telegramId: 123456789,
            name: "Ali",
            firstName: "Ali",
            username: "ali",
            phone: "+998901234567",
            courseId: 1,
            courseTitle: "SMM",
            tariffId: 1,
            tariffName: "Standard",
            studyGroupId: null,
            studyGroupName: null,
            status: "active",
            debtStatus: "installment",
            contractAmountUzs: 3_000_000,
            paidAmountUzs: 1_000_000,
            currentMonthDebtUzs: 500_000,
            totalRemainingUzs: 2_000_000,
            maturedDueUzs: 1_500_000,
            maturedPaidUzs: 1_000_000,
            currentDueDate: "2026-11-20",
            nextDueDate: "2026-11-20",
            installmentMonths: 2,
            note: null,
            firstNetwork: "ig",
            firstSource: "ig_reels",
            firstCampaign: "nov",
            lastNetwork: "tg",
            lastSource: "tg",
            lastCampaign: "ads",
            attributionNetwork: "ig",
            enrolledAt: "2026-11-14T10:00:00.000Z",
            createdAt: "2026-11-14T10:00:00.000Z",
            updatedAt: "2026-11-14T10:00:00.000Z",
            installments: [],
            payments: [],
          },
        ],
        groups: [],
      }).success,
    ).toBe(true);

    expect(
      paymentReceiptsResponseSchema.safeParse({
        ocrConfigured: true,
        mediaEnabled: true,
        items: [],
      }).success,
    ).toBe(true);

    expect(
      paymentUsersLookupResponseSchema.safeParse({
        items: [
          {
            id: 10,
            telegramId: 123456789,
            name: "Ali",
            firstName: "Ali",
            username: null,
            phone: "+998901234567",
            wroteAdminAt: null,
            paidAt: null,
            activeEnrollmentCount: 0,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
