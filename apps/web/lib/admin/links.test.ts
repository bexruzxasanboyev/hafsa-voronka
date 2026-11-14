import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  API_URL: "https://api.example.com",
}));

vi.mock("@/lib/admin/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test-token" }),
}));

import { createCampaignLink, deleteCampaignLink, fetchCampaignLinks } from "./links";

const sampleItem = {
  code: "tg_ramazon",
  utmSource: "tg",
  utmCampaign: "ramazon",
  utmContent: "post_1",
  botUrl: "https://t.me/test_bot?start=c_tg_ramazon",
  landingUrl: "https://example.com?utm_source=tg&utm_campaign=ramazon&utm_content=post_1",
  botStarts: 12,
  registrations: 5,
  createdAt: "2026-11-14T10:00:00.000Z",
};

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchCampaignLinks", () => {
  it("parses { items: [...] }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { items: [sampleItem] }));
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchCampaignLinks();

    expect(items).toEqual([sampleItem]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws UNAUTHORIZED on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(401, { error: "unauthorized" })));

    await expect(fetchCampaignLinks()).rejects.toThrow("UNAUTHORIZED");
  });
});

describe("createCampaignLink", () => {
  it("parses 201 { item: { ... } }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(201, { item: sampleItem })));

    const res = await createCampaignLink({
      utmSource: "tg",
      utmCampaign: "ramazon",
      utmContent: "post_1",
      code: "tg_ramazon",
    });

    expect(res).toEqual({ ok: true, item: sampleItem });
  });

  it("maps 409 to code_taken", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(409, { error: "code_taken" })));

    const res = await createCampaignLink({ utmSource: "tg", utmCampaign: "ramazon", code: "tg_ramazon" });

    expect(res).toEqual({ ok: false, error: "code_taken" });
  });

  it("maps 400 to invalid_request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(400, { error: "invalid_request" })));

    const res = await createCampaignLink({ utmSource: "tg", utmCampaign: "ramazon", code: "bad code" });

    expect(res).toEqual({ ok: false, error: "invalid_request" });
  });

  it("throws UNAUTHORIZED on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(401, { error: "unauthorized" })));

    await expect(createCampaignLink({ utmSource: "tg", utmCampaign: "ramazon" })).rejects.toThrow("UNAUTHORIZED");
  });
});

describe("deleteCampaignLink", () => {
  it("returns true on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { ok: true })));

    await expect(deleteCampaignLink("tg_ramazon")).resolves.toBe(true);
  });

  it("returns false on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(404, { error: "not_found" })));

    await expect(deleteCampaignLink("missing")).resolves.toBe(false);
  });

  it("throws UNAUTHORIZED on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(401, { error: "unauthorized" })));

    await expect(deleteCampaignLink("tg_ramazon")).rejects.toThrow("UNAUTHORIZED");
  });
});
