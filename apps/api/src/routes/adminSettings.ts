import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import {
  type AdminSettingsUpdate,
  adminSettingsUpdateSchema,
  businessConnectionApprovalSchema,
  type BusinessConnectionItem,
} from "@funnel/shared";
import { requireAdminAuth } from "@/admin/auth";
import { db } from "@/db";
import { businessConnections, type BusinessConnectionRow } from "@/db/schema";
import { env } from "@/env";
import { kickMessageDispatcher } from "@/messages/dispatch";
import { getAdminSettings, updateAdminSettings } from "@/settings/service";

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

adminSettingsRoutes.get("/", async (c) => {
  return c.json(await getAdminSettings());
});

adminSettingsRoutes.put("/", async (c) => {
  const raw: unknown = await c.req.json().catch(() => null);
  const body = adminSettingsUpdateSchema.safeParse(raw);
  if (!body.success || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const update: AdminSettingsUpdate = {
    ...(Object.hasOwn(raw, "linkTtlHours") ? { linkTtlHours: body.data.linkTtlHours } : {}),
    ...(Object.hasOwn(raw, "messageCaps") ? { messageCaps: body.data.messageCaps } : {}),
    ...(Object.hasOwn(raw, "chatCleanupHours") ? { chatCleanupHours: body.data.chatCleanupHours } : {}),
    ...(Object.hasOwn(raw, "nightRestrictionEnabled")
      ? { nightRestrictionEnabled: body.data.nightRestrictionEnabled }
      : {}),
    ...(Object.hasOwn(raw, "segmentLoops") ? { segmentLoops: body.data.segmentLoops } : {}),
  };
  if (Object.values(update).every((value) => value === undefined)) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const before = await getAdminSettings();
  const updated = await updateAdminSettings(update);
  const scheduleChanged =
    before.nightRestrictionEnabled !== updated.nightRestrictionEnabled ||
    (["A", "B", "C", "E"] as const).some((segment) => before.segmentLoops[segment] !== updated.segmentLoops[segment]);
  if (scheduleChanged) kickMessageDispatcher();

  return c.json(updated);
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
