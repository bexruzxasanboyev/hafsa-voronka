import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import {
  adminSettingsUpdateSchema,
  businessConnectionApprovalSchema,
  type AdminSettings,
  type BusinessConnectionItem,
} from "@funnel/shared";
import { requireAdminAuth } from "@/admin/auth";
import { db } from "@/db";
import { businessConnections, settings, type BusinessConnectionRow } from "@/db/schema";
import { env } from "@/env";
import { chatCleanupHours, invalidateSettings, linkTtlHours, messageCaps } from "@/settings/service";

export const adminSettingsRoutes = new Hono();

adminSettingsRoutes.use("*", requireAdminAuth);

function formatBusinessConnection(row: BusinessConnectionRow): BusinessConnectionItem {
  return {
    id: row.id,
    userTelegramId: row.userTelegramId,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    canReply: row.canReply,
    isEnabled: row.isEnabled,
    isApproved: row.isApproved,
    connectedAt: row.connectedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function currentSettings(): Promise<AdminSettings> {
  return {
    linkTtlHours: await linkTtlHours(),
    messageCaps: await messageCaps(),
    chatCleanupHours: await chatCleanupHours(),
  };
}

adminSettingsRoutes.get("/", async (c) => {
  return c.json(await currentSettings());
});

adminSettingsRoutes.put("/", async (c) => {
  const body = adminSettingsUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const values = [
    ...(body.data.linkTtlHours === undefined ? [] : [{ key: "LINK_TTL_HOURS", value: String(body.data.linkTtlHours) }]),
    ...(body.data.messageCaps === undefined ? [] : [{ key: "MESSAGE_CAPS", value: JSON.stringify(body.data.messageCaps) }]),
    ...(body.data.chatCleanupHours === undefined ? [] : [{ key: "CHAT_CLEANUP_HOURS", value: String(body.data.chatCleanupHours) }]),
  ];
  await db().transaction(async (tx) => {
    for (const row of values) {
      await tx
        .insert(settings)
        .values(row)
        .onConflictDoUpdate({ target: settings.key, set: { value: row.value, updatedAt: new Date() } });
    }
  });
  invalidateSettings();

  return c.json(await currentSettings());
});

adminSettingsRoutes.get("/business-connections", async (c) => {
  const rows = await db()
    .select()
    .from(businessConnections)
    .orderBy(desc(businessConnections.connectedAt));
  return c.json({
    items: rows.map(formatBusinessConnection),
    botUsername: env.BOT_USERNAME,
  });
});

adminSettingsRoutes.patch("/business-connections/:id", async (c) => {
  const body = businessConnectionApprovalSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);

  const id = c.req.param("id");
  const [updated] = await db()
    .update(businessConnections)
    .set({ isApproved: body.data.isApproved, updatedAt: new Date() })
    .where(eq(businessConnections.id, id))
    .returning();

  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ item: formatBusinessConnection(updated) });
});
