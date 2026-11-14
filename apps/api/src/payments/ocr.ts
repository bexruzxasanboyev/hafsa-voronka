import type { Api } from "grammy";
import {
  paymentMethods,
  RECEIPT_MAX_BYTES,
  type ReceiptOcrResult,
  receiptOcrResultSchema,
  type ReceiptOcrStatus,
} from "@funnel/shared";
import { env } from "@/env";
import { openTelegramFile, removeLocalTelegramFile } from "@/telegram/files";

export type ReceiptOcrOutcome = {
  ocrStatus: ReceiptOcrStatus;
  ocrResult: ReceiptOcrResult | null;
  ocrError: string | null;
};

export type AnalyzeReceiptOptions = {
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
};

const OCR_TIMEOUT_MS = 15_000;

const OCR_PROMPT = [
  "Analyze this payment receipt image or PDF.",
  "Return ONLY valid JSON matching this exact shape (no markdown, no explanation):",
  '{"isReceipt": boolean, "amountUzs": integer | null, "paidDate": "YYYY-MM-DD" | null, "paymentMethod": string | null, "reference": string | null, "confidence": number | null}',
  `paymentMethod must be one of: ${paymentMethods.join(", ")}, or null.`,
  "Rules:",
  "- amountUzs must be an integer in Uzbekistani Som (UZS). If the receipt displays .00 tiyin decimals (e.g. 1 500 000.00 UZS or 1500000,00), ignore the .00 fractional digits and return 1500000 without multiplying fractional digits into UZS.",
  "- paidDate must be YYYY-MM-DD or null.",
  "- confidence must be between 0 and 1, or null.",
  "- If the document is not a payment receipt, set isReceipt to false and leave uncertain fields null.",
].join("\n");

export function isOcrConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractCandidateText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = (candidates[0] as { content?: { parts?: unknown[] } })?.content;
  if (!content || !Array.isArray(content.parts)) return null;
  const texts = content.parts
    .map((part) => (part && typeof part === "object" ? (part as { text?: unknown }).text : undefined))
    .filter((value): value is string => typeof value === "string");
  if (texts.length === 0) return null;
  return texts.join("\n");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "ocr_timeout";
    }
    return error.message.slice(0, 300) || "ocr_failed";
  }
  return String(error).slice(0, 300) || "ocr_failed";
}

export async function analyzeReceiptBytes(
  bytes: Uint8Array,
  mimeType: string,
  opts?: AnalyzeReceiptOptions,
): Promise<ReceiptOcrOutcome> {
  const apiKey = opts && "apiKey" in opts ? opts.apiKey : env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ocrStatus: "skipped", ocrResult: null, ocrError: null };
  }

  const model = opts?.model ?? env.GEMINI_OCR_MODEL ?? "gemini-2.5-flash";
  const fetchFn = opts?.fetchFn ?? fetch;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: OCR_PROMPT },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: Buffer.from(bytes).toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ocrStatus: "failed",
        ocrResult: null,
        ocrError: `gemini_http_${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }

    const payload = await response.json();
    const rawText = extractCandidateText(payload);
    if (!rawText) {
      return { ocrStatus: "failed", ocrResult: null, ocrError: "empty_ocr_response" };
    }

    const parsedJson = JSON.parse(stripJsonFences(rawText));
    const validated = receiptOcrResultSchema.safeParse(parsedJson);
    if (!validated.success) {
      return {
        ocrStatus: "failed",
        ocrResult: null,
        ocrError: `invalid_ocr_result: ${validated.error.issues[0]?.message ?? "schema_mismatch"}`,
      };
    }

    return {
      ocrStatus: "ok",
      ocrResult: validated.data,
      ocrError: null,
    };
  } catch (error) {
    return {
      ocrStatus: "failed",
      ocrResult: null,
      ocrError: toErrorMessage(error),
    };
  }
}

export async function analyzeReceiptFromTelegramFile(
  api: Api,
  fileId: string,
  mimeType: string,
  opts?: AnalyzeReceiptOptions,
): Promise<ReceiptOcrOutcome> {
  let localPath: string | undefined;
  try {
    const opened = await openTelegramFile(api, fileId);
    localPath = opened.localPath;
    if (opened.size !== undefined && opened.size > RECEIPT_MAX_BYTES) {
      opened.stream.destroy();
      return { ocrStatus: "failed", ocrResult: null, ocrError: "receipt_too_large" };
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of opened.stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > RECEIPT_MAX_BYTES) {
        opened.stream.destroy();
        return { ocrStatus: "failed", ocrResult: null, ocrError: "receipt_too_large" };
      }
      chunks.push(buf);
    }
    return await analyzeReceiptBytes(Buffer.concat(chunks), mimeType, opts);
  } catch (error) {
    return {
      ocrStatus: "failed",
      ocrResult: null,
      ocrError: toErrorMessage(error),
    };
  } finally {
    await removeLocalTelegramFile(localPath);
  }
}
