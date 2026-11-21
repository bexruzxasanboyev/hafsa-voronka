import { describe, expect, it } from "vitest";
import { signHermesPayload, verifyHermesSignature } from "./signature";

const SECRET = "test-hermes-sync-secret-0123456789abcdef";
const NOW_MS = 1_795_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const BODY = JSON.stringify({ adminTelegramId: 12345, events: [] });

describe("Hermes HMAC signature verification", () => {
  it("accepts a valid signature within the skew window", () => {
    const ts = String(NOW_SEC);
    const sig = signHermesPayload(SECRET, ts, BODY);
    expect(
      verifyHermesSignature({
        secret: SECRET,
        timestampHeader: ts,
        signatureHeader: sig,
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toBe(true);

    // Boundary: exactly ±300 seconds is still allowed.
    for (const delta of [-300, 300]) {
      const edgeTs = String(NOW_SEC + delta);
      const edgeSig = signHermesPayload(SECRET, edgeTs, BODY);
      expect(
        verifyHermesSignature({
          secret: SECRET,
          timestampHeader: edgeTs,
          signatureHeader: edgeSig,
          rawBody: BODY,
          nowMs: NOW_MS,
        }),
      ).toBe(true);
    }
  });

  it("rejects a wrong secret", () => {
    const ts = String(NOW_SEC);
    const sig = signHermesPayload("wrong-secret-0123456789abcdef0123456789", ts, BODY);
    expect(
      verifyHermesSignature({
        secret: SECRET,
        timestampHeader: ts,
        signatureHeader: sig,
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  it("rejects a tampered body", () => {
    const ts = String(NOW_SEC);
    const sig = signHermesPayload(SECRET, ts, BODY);
    expect(
      verifyHermesSignature({
        secret: SECRET,
        timestampHeader: ts,
        signatureHeader: sig,
        rawBody: `${BODY} `,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  it("rejects stale or future timestamps beyond ±300 seconds", () => {
    for (const delta of [-301, 301]) {
      const ts = String(NOW_SEC + delta);
      const sig = signHermesPayload(SECRET, ts, BODY);
      expect(
        verifyHermesSignature({
          secret: SECRET,
          timestampHeader: ts,
          signatureHeader: sig,
          rawBody: BODY,
          nowMs: NOW_MS,
        }),
      ).toBe(false);
    }
  });

  it("rejects missing headers, non-integer timestamps, and uppercase hex", () => {
    const ts = String(NOW_SEC);
    const sig = signHermesPayload(SECRET, ts, BODY);

    expect(
      verifyHermesSignature({
        secret: SECRET,
        timestampHeader: undefined,
        signatureHeader: sig,
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toBe(false);

    expect(
      verifyHermesSignature({
        secret: SECRET,
        timestampHeader: ts,
        signatureHeader: undefined,
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toBe(false);

    expect(
      verifyHermesSignature({
        secret: SECRET,
        timestampHeader: `${ts}.5`,
        signatureHeader: signHermesPayload(SECRET, `${ts}.5`, BODY),
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toBe(false);

    expect(
      verifyHermesSignature({
        secret: SECRET,
        timestampHeader: ts,
        signatureHeader: sig.toUpperCase(),
        rawBody: BODY,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });
});
