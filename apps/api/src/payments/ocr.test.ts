import { describe, expect, it } from "vitest";
import { setTestEnv } from "@/test/env";
import { analyzeReceiptBytes, isOcrConfigured } from "./ocr";

describe("payments OCR", () => {
  it("reports isOcrConfigured based on GEMINI_API_KEY and skips when key is missing", async () => {
    setTestEnv();
    expect(isOcrConfigured()).toBe(false);

    let called = false;
    const result = await analyzeReceiptBytes(new Uint8Array([1, 2, 3]), "image/jpeg", {
      apiKey: undefined,
      fetchFn: (async () => {
        called = true;
        throw new Error("should_not_fetch");
      }) as typeof fetch,
    });

    expect(called).toBe(false);
    expect(result).toEqual({
      ocrStatus: "skipped",
      ocrResult: null,
      ocrError: null,
    });
  });

  it("extracts valid UZS receipt data from mocked Gemini response", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    let capturedUrl = "";
    let capturedBody = "";

    const result = await analyzeReceiptBytes(bytes, "image/jpeg", {
      apiKey: "test-gemini-key",
      model: "gemini-2.5-flash",
      fetchFn: (async (input, init) => {
        capturedUrl = String(input);
        capturedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        isReceipt: true,
                        amountUzs: 1_500_000,
                        paidDate: "2026-11-14",
                        paymentMethod: "click",
                        reference: "CLK-998877",
                        confidence: 0.97,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-gemini-key",
    );
    const parsedRequest = JSON.parse(capturedBody) as {
      contents: { parts: { inline_data?: { mime_type: string; data: string } }[] }[];
    };
    expect(parsedRequest.contents[0]?.parts[1]?.inline_data).toEqual({
      mime_type: "image/jpeg",
      data: Buffer.from(bytes).toString("base64"),
    });
    expect(result).toEqual({
      ocrStatus: "ok",
      ocrResult: {
        isReceipt: true,
        amountUzs: 1_500_000,
        paidDate: "2026-11-14",
        paymentMethod: "click",
        reference: "CLK-998877",
        confidence: 0.97,
      },
      ocrError: null,
    });
  });

  it("strips markdown JSON fences from Gemini response", async () => {
    const fencedJson = [
      "```json",
      JSON.stringify({
        isReceipt: true,
        amountUzs: 750_000,
        paidDate: "2026-11-13",
        paymentMethod: "payme",
        reference: null,
        confidence: 0.88,
      }),
      "```",
    ].join("\n");

    const result = await analyzeReceiptBytes(new Uint8Array([1, 2, 3]), "application/pdf", {
      apiKey: "test-gemini-key",
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: fencedJson }] } }],
          }),
          { status: 200 },
        )) as typeof fetch,
    });

    expect(result).toEqual({
      ocrStatus: "ok",
      ocrResult: {
        isReceipt: true,
        amountUzs: 750_000,
        paidDate: "2026-11-13",
        paymentMethod: "payme",
        reference: null,
        confidence: 0.88,
      },
      ocrError: null,
    });
  });

  it("returns failed status on HTTP errors, invalid payloads, and timeouts", async () => {
    const httpErr = await analyzeReceiptBytes(new Uint8Array([1]), "image/png", {
      apiKey: "test-key",
      fetchFn: (async () => new Response("rate limit", { status: 429 })) as typeof fetch,
    });
    expect(httpErr.ocrStatus).toBe("failed");
    expect(httpErr.ocrResult).toBeNull();
    expect(httpErr.ocrError).toContain("gemini_http_429");

    const invalidSchema = await analyzeReceiptBytes(new Uint8Array([1]), "image/png", {
      apiKey: "test-key",
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ isReceipt: true, amountUzs: -10 }) }],
                },
              },
            ],
          }),
          { status: 200 },
        )) as typeof fetch,
    });
    expect(invalidSchema.ocrStatus).toBe("failed");
    expect(invalidSchema.ocrResult).toBeNull();
    expect(invalidSchema.ocrError).toContain("invalid_ocr_result");

    const timeoutErr = await analyzeReceiptBytes(new Uint8Array([1]), "image/png", {
      apiKey: "test-key",
      fetchFn: (async () => {
        const err = new Error("Aborted");
        err.name = "TimeoutError";
        throw err;
      }) as typeof fetch,
    });
    expect(timeoutErr).toEqual({
      ocrStatus: "failed",
      ocrResult: null,
      ocrError: "ocr_timeout",
    });
  });
});
