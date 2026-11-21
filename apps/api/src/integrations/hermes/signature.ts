import { createHmac, timingSafeEqual } from "node:crypto";

export const HERMES_SIGNATURE_MAX_SKEW_SEC = 300;

export function signHermesPayload(
  secret: string,
  timestamp: string | number,
  rawBody: string,
): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyHermesSignature(params: {
  secret: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  rawBody: string;
  nowMs?: number;
}): boolean {
  const { secret, timestampHeader, signatureHeader, rawBody, nowMs = Date.now() } = params;
  if (!timestampHeader || !signatureHeader) return false;
  if (!/^\d+$/.test(timestampHeader)) return false;

  const ts = Number(timestampHeader);
  if (!Number.isSafeInteger(ts)) return false;

  const nowSec = Math.floor(nowMs / 1000);
  if (Math.abs(nowSec - ts) > HERMES_SIGNATURE_MAX_SKEW_SEC) return false;

  const expected = signHermesPayload(secret, timestampHeader, rawBody);
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");
  return expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf);
}
