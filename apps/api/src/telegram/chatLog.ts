import { and, asc, eq, exists, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Api, GrammyError } from "grammy";
import { db } from "@/db";
import { type ChatMessage, chatMessages } from "@/db/schema";
import { chatCleanupHours } from "@/settings/service";
import { isBlockedError } from "@/telegram/blocked";

const HOUR_MS = 3_600_000;
const DELETE_LIMIT_MS = 48 * HOUR_MS;
const KEEP_ROWS_MS = 72 * HOUR_MS;
const CLEANUP_BATCH_SIZE = 500;
const MESSAGE_NOT_FOUND = "message to delete not found";

type Pace = () => Promise<void>;

export async function logChatMessage(chatId: number, messageId: number, fromBot: boolean, now = new Date()) {
  await db()
    .insert(chatMessages)
    .values({ chatId, messageId, fromBot, sentAt: now })
    .onConflictDoNothing();
}

const undeleted = and(isNull(chatMessages.deletedAt), isNull(chatMessages.deleteError));

// Cleanup must never empty a chat: the newest bot message that is still visible stays until a newer
// one replaces it, so the user always has a working lesson button.
const newerBot = alias(chatMessages, "newer_bot");
const notNewestBotMessage = () =>
  or(
    eq(chatMessages.fromBot, false),
    exists(
      db()
        .select({ one: sql`1` })
        .from(newerBot)
        .where(
          and(
            eq(newerBot.chatId, chatMessages.chatId),
            eq(newerBot.fromBot, true),
            gt(newerBot.id, chatMessages.id),
            isNull(newerBot.deletedAt),
          ),
        ),
    ),
  );

async function deleteLogged(api: Api, row: ChatMessage, now: Date) {
  const mark = (values: { deletedAt: Date } | { deleteError: string }) =>
    db().update(chatMessages).set(values).where(eq(chatMessages.id, row.id));

  if (now.getTime() - row.sentAt.getTime() >= DELETE_LIMIT_MS) {
    await mark({ deleteError: "too_old" });
    return;
  }
  try {
    await api.deleteMessage(row.chatId, row.messageId);
    await mark({ deletedAt: now });
  } catch (error) {
    if (error instanceof GrammyError && error.error_code === 429) throw error;
    if (isBlockedError(error) || (error instanceof GrammyError && error.description.includes(MESSAGE_NOT_FOUND))) {
      await mark({ deletedAt: now });
    } else {
      await mark({ deleteError: error instanceof Error ? error.message : String(error) });
    }
  }
}

export async function replaceBotReply(api: Api, chatId: number, send: () => Promise<{ message_id: number }>) {
  const now = new Date();
  const previous = await db()
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.chatId, chatId),
        eq(chatMessages.fromBot, true),
        isNull(chatMessages.deleteAt),
        eq(chatMessages.keepForever, false),
        gt(chatMessages.sentAt, new Date(now.getTime() - DELETE_LIMIT_MS)),
        undeleted,
      ),
    )
    .orderBy(asc(chatMessages.id));
  for (const row of previous) {
    await deleteLogged(api, row, now).catch((error) => console.error("Chat message delete failed:", error));
  }
  const message = await send();
  await logChatMessage(chatId, message.message_id, true);
  return message;
}

export async function cleanupChatMessages(api: Api, now: Date, pace: Pace) {
  await db().delete(chatMessages).where(lte(chatMessages.sentAt, new Date(now.getTime() - KEEP_ROWS_MS)));
  await db()
    .update(chatMessages)
    .set({ deleteError: "too_old" })
    .where(
      and(
        lte(chatMessages.sentAt, new Date(now.getTime() - DELETE_LIMIT_MS)),
        eq(chatMessages.keepForever, false),
        undeleted,
      ),
    );

  const cleanupAgeMs = (await chatCleanupHours()) * HOUR_MS;
  const rows = await db()
    .select()
    .from(chatMessages)
    .where(
      and(
        gt(chatMessages.sentAt, new Date(now.getTime() - DELETE_LIMIT_MS)),
        eq(chatMessages.keepForever, false),
        undeleted,
        notNewestBotMessage(),
        or(
          and(isNotNull(chatMessages.deleteAt), lte(chatMessages.deleteAt, now)),
          and(isNull(chatMessages.deleteAt), lte(chatMessages.sentAt, new Date(now.getTime() - cleanupAgeMs))),
        ),
      ),
    )
    .orderBy(asc(chatMessages.sentAt))
    .limit(CLEANUP_BATCH_SIZE);
  for (const row of rows) {
    await pace();
    await deleteLogged(api, row, now);
  }
}
