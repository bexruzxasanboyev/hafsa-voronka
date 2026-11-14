import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  broadcastBaseSchema,
  type BroadcastInput,
  broadcastPreviewSchema,
  TEMPLATE_MEDIA_LIMITS,
  templateMediaTypeFor,
  validateBroadcastText,
} from "@funnel/shared";
import { requireAdminAuth } from "@/admin/auth";
import {
  cancelBroadcast,
  createBroadcast,
  findBroadcastMedia,
  listBroadcasts,
  previewBroadcastAudience,
  updateBroadcast,
  uploadBroadcastMedia,
} from "@/broadcasts/service";
import { bot } from "@/telegram/bot";
import { botMediaChat, downloadBotMedia, MediaChatUnavailableError } from "@/telegram/media";

export const adminBroadcastRoutes = new Hono();

adminBroadcastRoutes.use("*", requireAdminAuth);

const mediaContentTypes = { photo: "image/jpeg", video: "video/mp4", voice: "audio/ogg" } as const;
const MAX_UPLOAD_BYTES = Math.max(...Object.values(TEMPLATE_MEDIA_LIMITS)) + 1024 * 1024;

function parseId(raw: string) {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validateInput(input: BroadcastInput) {
  const textIssue = validateBroadcastText(input.text, input.media !== null);
  if (textIssue) {
    return textIssue.variable ? { error: textIssue.error, variable: textIssue.variable } : { error: textIssue.error };
  }
  if (Number.isNaN(Date.parse(input.scheduledAt))) {
    return { error: "invalid_schedule" };
  }
  return null;
}

adminBroadcastRoutes.get("/", async (c) => {
  return c.json({
    mediaEnabled: botMediaChat() !== null,
    broadcasts: await listBroadcasts(),
  });
});

adminBroadcastRoutes.post("/preview", async (c) => {
  const body = broadcastPreviewSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);
  return c.json({ count: await previewBroadcastAudience(body.data.audiences) });
});

adminBroadcastRoutes.post(
  "/media",
  bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ error: "too_large" }, 413) }),
  async (c) => {
    if (!botMediaChat()) return c.json({ error: "media_not_configured" }, 503);

    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!(file instanceof File)) return c.json({ error: "invalid_request" }, 400);

    const type = templateMediaTypeFor(file.type);
    if (!type) return c.json({ error: "unsupported_type" }, 415);
    if (file.size > TEMPLATE_MEDIA_LIMITS[type]) return c.json({ error: "too_large" }, 413);

    try {
      return c.json(await uploadBroadcastMedia(bot().api, type, file));
    } catch (error) {
      if (error instanceof MediaChatUnavailableError) return c.json({ error: "media_chat_unavailable" }, 503);
      throw error;
    }
  },
);

adminBroadcastRoutes.get("/:id{[0-9]+}/media", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const media = await findBroadcastMedia(id);
  if (!media) return c.json({ error: "not_found" }, 404);

  const upstream = await downloadBotMedia(bot().api, media.fileId).catch(() => null);
  if (!upstream?.ok || !upstream.body) return c.json({ error: "not_found" }, 404);

  return new Response(upstream.body, {
    headers: {
      "content-type": mediaContentTypes[media.type],
      "cache-control": "private, max-age=300",
    },
  });
});

adminBroadcastRoutes.post("/", async (c) => {
  const body = broadcastBaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const invalid = validateInput(body.data);
  if (invalid) return c.json(invalid, 422);

  const broadcast = await createBroadcast(body.data);
  return c.json({ broadcast }, 201);
});

adminBroadcastRoutes.put("/:id{[0-9]+}", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const body = broadcastBaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const invalid = validateInput(body.data);
  if (invalid) return c.json(invalid, 422);

  const result = await updateBroadcast(id, body.data);
  if (!result.ok) {
    return c.json({ error: result.code }, result.code === "not_found" ? 404 : 409);
  }
  return c.json({ broadcast: result.broadcast });
});

adminBroadcastRoutes.post("/:id{[0-9]+}/cancel", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const result = await cancelBroadcast(id);
  if (!result.ok) {
    return c.json({ error: result.code }, result.code === "not_found" ? 404 : 409);
  }
  return c.json({ broadcast: result.broadcast });
});
