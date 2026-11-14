import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentRecordItem } from "@funnel/shared";

vi.mock("@/lib/api", () => ({
  API_URL: "https://api.example.com",
}));

vi.mock("@/lib/admin/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test-token" }),
}));

import {
  buildOverviewQuery,
  debtStatusLabel,
  debtStatusTone,
  deleteCourse,
  earliestVerifiedPaidDate,
  FILTER_ALL,
  FILTER_NONE,
  FILTER_UNASSIGNED,
  fetchPaymentsOverview,
  fetchReceiptFileBlobUrl,
  formatStudentDisplayName,
  formatUzs,
  networkLabel,
  normalizeSentinel,
  parseUzsInput,
  paymentErrorMessage,
  paymentMethodLabel,
} from "./payments";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("formatUzs & parseUzsInput", () => {
  it("formats UZS deterministically with space separators", () => {
    expect(formatUzs(0)).toBe("0 so‘m");
    expect(formatUzs(950)).toBe("950 so‘m");
    expect(formatUzs(1191000)).toBe("1 191 000 so‘m");
    expect(formatUzs(24500000)).toBe("24 500 000 so‘m");
    expect(formatUzs(-150000)).toBe("-150 000 so‘m");
    expect(formatUzs(1234.6)).toBe("1 235 so‘m");
  });

  it("parses spaced or formatted UZS input strings", () => {
    expect(parseUzsInput("1 191 000")).toBe(1191000);
    expect(parseUzsInput("0")).toBe(0);
    expect(parseUzsInput("")).toBeNull();
    expect(parseUzsInput("abc")).toBeNull();
  });
});

describe("sentinel normalization & buildOverviewQuery", () => {
  it("maps sentinels to undefined or unassigned", () => {
    expect(normalizeSentinel(undefined)).toBeUndefined();
    expect(normalizeSentinel("")).toBeUndefined();
    expect(normalizeSentinel(FILTER_ALL)).toBeUndefined();
    expect(normalizeSentinel(FILTER_NONE)).toBeUndefined();
    expect(normalizeSentinel(FILTER_UNASSIGNED)).toBe("unassigned");
    expect(normalizeSentinel(" 42 ")).toBe("42");
  });

  it("serializes overview query params cleanly", () => {
    const qs = buildOverviewQuery({
      attributionModel: "first",
      courseId: FILTER_ALL,
      tariffId: "5",
      studyGroupId: FILTER_UNASSIGNED,
      debtStatus: "overdue",
      network: "ig",
      search: "  Madina  ",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("attributionModel")).toBe("first");
    expect(params.has("courseId")).toBe(false);
    expect(params.get("tariffId")).toBe("5");
    expect(params.get("studyGroupId")).toBe("unassigned");
    expect(params.get("debtStatus")).toBe("overdue");
    expect(params.get("network")).toBe("ig");
    expect(params.get("search")).toBe("Madina");
  });

  it("omits empty search and all sentinels", () => {
    expect(
      buildOverviewQuery({
        attributionModel: "last",
        courseId: FILTER_ALL,
        studyGroupId: FILTER_ALL,
        debtStatus: FILTER_ALL,
        network: FILTER_ALL,
        search: "   ",
      }),
    ).toBe("attributionModel=last");
  });
});

describe("labels, tones & earliestVerifiedPaidDate", () => {
  it("maps network, payment method, and debt status labels", () => {
    expect(networkLabel("ig")).toBe("Instagram (ig)");
    expect(networkLabel("fb")).toBe("Facebook (fb)");
    expect(networkLabel("tg")).toBe("Telegram (tg)");
    expect(networkLabel("organic")).toBe("Organik");
    expect(networkLabel("other")).toBe("Boshqa");

    expect(paymentMethodLabel("click")).toBe("Click");
    expect(paymentMethodLabel("card_transfer")).toBe("Karta o‘tkazma");

    expect(debtStatusLabel("paid")).toBe("To‘liq to‘langan");
    expect(debtStatusTone("paid")).toBe("success");
    expect(debtStatusLabel("installment")).toBe("Bo‘lib to‘lash");
    expect(debtStatusTone("installment")).toBe("attention");
    expect(debtStatusLabel("overdue")).toBe("Muddati o‘tgan");
    expect(debtStatusTone("overdue")).toBe("danger");
  });

  it("finds earliest verified paidDate while ignoring refunded payments", () => {
    const records: PaymentRecordItem[] = [
      {
        id: 1,
        enrollmentId: 10,
        amountUzs: 500000,
        paymentMethod: "click",
        status: "refunded",
        paidDate: "2026-09-01",
        paidAt: "2026-09-01T10:00:00.000Z",
        reference: null,
        note: null,
        receiptId: null,
        createdAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: 2,
        enrollmentId: 10,
        amountUzs: 600000,
        paymentMethod: "payme",
        status: "verified",
        paidDate: "2026-10-15",
        paidAt: "2026-10-15T10:00:00.000Z",
        reference: null,
        note: null,
        receiptId: null,
        createdAt: "2026-10-15T10:00:00.000Z",
      },
      {
        id: 3,
        enrollmentId: 10,
        amountUzs: 600000,
        paymentMethod: "cash",
        status: "verified",
        paidDate: "2026-10-05",
        paidAt: "2026-10-05T10:00:00.000Z",
        reference: null,
        note: null,
        receiptId: null,
        createdAt: "2026-10-05T10:00:00.000Z",
      },
    ];

    expect(earliestVerifiedPaidDate(records)).toBe("2026-10-05");
    expect(earliestVerifiedPaidDate([records[0]])).toBeNull();
    expect(earliestVerifiedPaidDate([])).toBeNull();
  });

  it("formats display names and error codes", () => {
    expect(formatStudentDisplayName({ name: "Aziza", firstName: "Azi" })).toBe("Aziza");
    expect(formatStudentDisplayName({ name: null, firstName: null, username: "aziza_uz" })).toBe("@aziza_uz");
    expect(formatStudentDisplayName({ name: null, firstName: null, username: null, telegramId: 777 })).toBe("ID 777");
    expect(paymentErrorMessage("course_in_use")).toContain("kursga");
    expect(paymentErrorMessage("receipt_already_reviewed")).toContain("chek");
    expect(paymentErrorMessage("already_refunded")).toContain("qaytarilgan");
    expect(paymentErrorMessage("tariff_course_mismatch")).toContain("tarif");
    expect(paymentErrorMessage("invalid_installments")).toContain("jadval");
    expect(paymentErrorMessage("invalid_query")).toContain("Filtr");
    expect(paymentErrorMessage("user_not_found")).toContain("foydalanuvchi");
    expect(paymentErrorMessage("course_not_found")).toContain("kurs");
    expect(paymentErrorMessage("tariff_not_found")).toContain("tarif");
    expect(paymentErrorMessage("group_not_found")).toContain("guruh");
    expect(paymentErrorMessage("enrollment_not_found")).toContain("Yozilish");
    expect(paymentErrorMessage("unknown_code")).toContain("Xatolik");
  });
});

describe("API wrappers", () => {
  it("fetches receipt file blob URL with auth headers and revokes cleanly", async () => {
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:https://app.test/receipt-1");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReceiptFileBlobUrl(12);
    expect(result.url).toBe("blob:https://app.test/receipt-1");
    expect(result.mimeType).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/admin/payments/receipts/12/file", {
      method: "GET",
      headers: { Authorization: "Bearer test-token" },
      credentials: "include",
      signal: undefined,
    });
    expect(createSpy).toHaveBeenCalledTimes(1);

    result.revoke();
    expect(revokeSpy).toHaveBeenCalledWith("blob:https://app.test/receipt-1");
  });

  it("throws UNAUTHORIZED when overview returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthorized" })));
    await expect(fetchPaymentsOverview()).rejects.toThrow("UNAUTHORIZED");
  });

  it("maps 409 course_in_use on deleteCourse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { error: "course_in_use" })));
    const res = await deleteCourse(4);
    expect(res).toEqual({ ok: false, status: 409, error: "course_in_use" });
  });
});
