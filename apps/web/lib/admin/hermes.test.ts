import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  API_URL: "https://api.example.com",
}));

vi.mock("@/lib/admin/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test-token" }),
}));

import {
  fetchHermesPayments,
  fetchHermesStatus,
  formatHermesRelativeTime,
  hermesConfidenceLabel,
  hermesKindTone,
  resolveHermesPayDate,
} from "./hermes";

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

describe("hermesConfidenceLabel", () => {
  it("maps all known confidence codes to Uzbek labels", () => {
    expect(hermesConfidenceLabel("first")).toBe("Birinchi to‘lov");
    expect(hermesConfidenceLabel("partial")).toBe("Qisman");
    expect(hermesConfidenceLabel("partial_complete")).toBe("Qisman (to‘liq)");
    expect(hermesConfidenceLabel("partial_used")).toBe("Qisman (hisoblangan)");
    expect(hermesConfidenceLabel("admin")).toBe("Admin kiritgan");
    expect(hermesConfidenceLabel("deposit")).toBe("Depozit");
    expect(hermesConfidenceLabel("unclear")).toBe("Aniqlanmagan");
    expect(hermesConfidenceLabel("not_receipt")).toBe("Chek emas");
  });

  it("falls back to raw value for unknown confidence or prototype keys", () => {
    expect(hermesConfidenceLabel("manual_override")).toBe("manual_override");
    expect(hermesConfidenceLabel("toString")).toBe("toString");
  });
});

describe("hermesKindTone", () => {
  it("maps each payment kind to its chip tone", () => {
    expect(hermesKindTone("paid")).toBe("success");
    expect(hermesKindTone("deposit")).toBe("info");
    expect(hermesKindTone("ignored")).toBe("muted");
  });
});

describe("resolveHermesPayDate", () => {
  it("formats payDate when present", () => {
    expect(resolveHermesPayDate("2026-04-15", "2026-04-16T09:30:00.000Z")).toBe("15.04.2026");
  });

  it("falls back to hermesCreatedAt date when payDate is null or empty", () => {
    expect(resolveHermesPayDate(null, "2026-04-16T09:30:00.000Z")).toBe("16.04.2026");
    expect(resolveHermesPayDate("   ", "2026-11-05T23:59:59.000Z")).toBe("05.11.2026");
  });

  it("handles non-ISO or empty strings gracefully", () => {
    expect(resolveHermesPayDate("15/04/2026", "2026-04-16T09:30:00.000Z")).toBe("15/04/2026");
    expect(resolveHermesPayDate(null, "")).toBe("—");
  });
});

describe("formatHermesRelativeTime", () => {
  const now = new Date("2026-11-21T12:00:00.000Z");

  it("returns never label when lastSeenAt is null", () => {
    expect(formatHermesRelativeTime(null, now)).toBe("hali yo‘q");
  });

  it("formats seconds, minutes, hours, and days ago", () => {
    expect(formatHermesRelativeTime("2026-11-21T11:59:30.000Z", now)).toBe("hozirgina");
    expect(formatHermesRelativeTime("2026-11-21T11:55:00.000Z", now)).toBe("5 daqiqa oldin");
    expect(formatHermesRelativeTime("2026-11-21T09:00:00.000Z", now)).toBe("3 soat oldin");
    expect(formatHermesRelativeTime("2026-11-19T12:00:00.000Z", now)).toBe("2 kun oldin");
  });
});

describe("Hermes API wrappers", () => {
  it("fetches and validates status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        configured: true,
        lastSeenAt: "2026-11-21T11:58:00.000Z",
        live: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await fetchHermesStatus();
    expect(status).toEqual({
      configured: true,
      lastSeenAt: "2026-11-21T11:58:00.000Z",
      live: true,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/admin/hermes/status", {
      method: "GET",
      headers: { Authorization: "Bearer test-token" },
      credentials: "include",
    });
  });

  it("fetches payments with optional kind query param and throws on 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [],
          totals: {
            paid: { count: 0, amountUzs: 0 },
            deposit: { count: 0, amountUzs: 0 },
            ignored: { count: 0 },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchHermesPayments({ kind: "deposit", limit: 50 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/admin/hermes/payments?kind=deposit&limit=50",
      {
        method: "GET",
        headers: { Authorization: "Bearer test-token" },
        credentials: "include",
      },
    );

    await expect(fetchHermesPayments()).rejects.toThrow("UNAUTHORIZED");
  });
});
