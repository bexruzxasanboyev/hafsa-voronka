import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { MAX_TEMPLATE_BUTTONS } from "@funnel/shared";
import { db } from "@/db";
import { scheduledBroadcastRecipients, sentMessages, users } from "@/db/schema";
import { recordChannelClick } from "@/funnel/channel";
import { logEvent } from "@/funnel/users";
import { recordMessageClick } from "@/messages/clicks";

const paramsSchema = z.object({
  token: z.uuid(),
  index: z.coerce.number().int().min(0).max(MAX_TEMPLATE_BUTTONS - 1),
});

export const redirectRoutes = new Hono();

redirectRoutes.get("/:token/:index", async (c) => {
  const params = paramsSchema.safeParse({ token: c.req.param("token"), index: c.req.param("index") });
  if (!params.success) return c.json({ error: "not_found" }, 404);

  const [row] = await db().select().from(sentMessages).where(eq(sentMessages.clickToken, params.data.token));
  if (row) {
    const target = row.linkTargets[params.data.index];
    if (!target) return c.json({ error: "not_found" }, 404);

    try {
      const now = new Date();
      const [user] = await db().select().from(users).where(eq(users.id, row.userId));
      await recordMessageClick(row.id, row.userId, "url", { button: params.data.index, kind: target.kind }, now);
      if (user && target.kind === "admin") {
        await recordChannelClick(user, now, { sentMessageId: row.id });
      }
    } catch (error) {
      console.error("Message click tracking failed:", error);
    }
    return c.redirect(target.url, 302);
  }

  const [recipient] = await db()
    .select()
    .from(scheduledBroadcastRecipients)
    .where(eq(scheduledBroadcastRecipients.clickToken, params.data.token));
  const target = recipient?.linkTargets[params.data.index];
  if (!recipient || !target) return c.json({ error: "not_found" }, 404);

  try {
    const now = new Date();
    const [updated] = await db()
      .update(scheduledBroadcastRecipients)
      .set({
        clickedAt: sql`coalesce(${scheduledBroadcastRecipients.clickedAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(eq(scheduledBroadcastRecipients.id, recipient.id))
      .returning();
    if (updated) {
      await logEvent("message_click", {
        userId: recipient.userId,
        meta: {
          broadcastId: recipient.broadcastId,
          broadcastRecipientId: recipient.id,
          via: "url",
          button: params.data.index,
          kind: target.kind,
        },
      });
    }
    const [user] = await db().select().from(users).where(eq(users.id, recipient.userId));
    if (user && target.kind === "admin") {
      await recordChannelClick(user, now, {
        broadcastId: recipient.broadcastId,
        broadcastRecipientId: recipient.id,
      });
    }
  } catch (error) {
    console.error("Broadcast click tracking failed:", error);
  }
  return c.redirect(target.url, 302);
});
