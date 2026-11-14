import { eq, sql } from "drizzle-orm";
import { Composer } from "grammy";
import type { BusinessConnection, Message } from "grammy/types";
import { db } from "@/db";
import { businessConnections } from "@/db/schema";
import { markWroteAdmin, touchAdminChat } from "@/funnel/channel";
import { findByTelegramId } from "@/funnel/users";
import { isAdminTelegramId } from "@/telegram/admins";

export async function upsertBusinessConnection(conn: BusinessConnection): Promise<void> {
  const now = new Date();
  const adminApproved = isAdminTelegramId(conn.user.id);
  await db()
    .insert(businessConnections)
    .values({
      id: conn.id,
      userTelegramId: conn.user.id,
      userChatId: conn.user_chat_id,
      username: conn.user.username ?? null,
      firstName: conn.user.first_name ?? null,
      lastName: conn.user.last_name ?? null,
      canReply: Boolean(conn.rights?.can_reply),
      isEnabled: conn.is_enabled,
      isApproved: adminApproved,
      connectedAt: new Date(conn.date * 1000),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: businessConnections.id,
      set: {
        userTelegramId: conn.user.id,
        userChatId: conn.user_chat_id,
        username: conn.user.username ?? null,
        firstName: conn.user.first_name ?? null,
        lastName: conn.user.last_name ?? null,
        canReply: Boolean(conn.rights?.can_reply),
        isEnabled: conn.is_enabled,
        isApproved: adminApproved ? true : sql`${businessConnections.isApproved}`,
        updatedAt: now,
      },
    });
}

export async function handleBusinessMessage(msg: Message): Promise<void> {
  const connectionId = msg.business_connection_id;
  if (!connectionId || msg.chat.type !== "private") return;

  const [conn] = await db()
    .select()
    .from(businessConnections)
    .where(eq(businessConnections.id, connectionId))
    .limit(1);
  if (!conn || !conn.isEnabled || !conn.isApproved) return;

  const customerTelegramId = msg.chat.id;
  if (customerTelegramId === conn.userTelegramId) return;

  const user = await findByTelegramId(customerTelegramId);
  if (!user) return;

  const at = new Date(msg.date * 1000);
  const inbound = msg.from?.id === customerTelegramId;
  if (inbound) {
    const marked = await markWroteAdmin(user.id, { id: conn.userTelegramId }, at, {
      via: "business",
      businessConnectionId: conn.id,
    });
    if (!marked) await touchAdminChat(user.id, at);
  } else if (msg.from?.id === conn.userTelegramId) {
    await touchAdminChat(user.id, at);
  }
}

export const businessComposer = new Composer();

businessComposer.on("business_connection", async (ctx) => {
  await upsertBusinessConnection(ctx.businessConnection);
});

businessComposer.on("business_message", async (ctx) => {
  await handleBusinessMessage(ctx.businessMessage);
});
