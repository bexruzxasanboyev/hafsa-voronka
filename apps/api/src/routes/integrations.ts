import { Hono } from "hono";
import { env } from "@/env";
import { ingestHermesEvents } from "@/integrations/hermes/ingest";
import { hermesIngestBodySchema } from "@/integrations/hermes/schema";
import { verifyHermesSignature } from "@/integrations/hermes/signature";

const MAX_BODY_BYTES = 1024 * 1024;

export const integrationRoutes = new Hono();

integrationRoutes.post("/hermes/events", async (c) => {
  const secret = env.HERMES_SYNC_SECRET;
  if (!secret) {
    return c.json({ error: "not_found" }, 404);
  }

  const contentLength = c.req.header("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
    return c.json({ error: "payload_too_large" }, 413);
  }

  const rawBody = await c.req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return c.json({ error: "payload_too_large" }, 413);
  }

  const valid = verifyHermesSignature({
    secret,
    timestampHeader: c.req.header("x-hermes-timestamp"),
    signatureHeader: c.req.header("x-hermes-signature"),
    rawBody,
  });
  if (!valid) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  const parsed = hermesIngestBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const result = await ingestHermesEvents(parsed.data);
  return c.json({ ok: true, ...result });
});
