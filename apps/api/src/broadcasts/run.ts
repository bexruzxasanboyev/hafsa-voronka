import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { type Api, GrammyError, HttpError } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import {
  type BroadcastButton,
  escapeHtml,
  renderText,
  sanitizeTelegramHtml,
  TEMPLATE_VARIABLE_MAX_LENGTH,
} from "@funnel/shared";
import { db } from "@/db";
import {
  type ScheduledBroadcastRecipientRow,
  scheduledBroadcastRecipients,
  type ScheduledBroadcastRow,
  scheduledBroadcasts,
  type SentLinkTarget,
  type User,
  users,
} from "@/db/schema";
import { env } from "@/env";
import { uz } from "@/i18n/uz";
import { adminChatUrl, type RenderedMessage } from "@/messages/render";
import { sendRendered } from "@/messages/send";
import { isBlockedError, markBlocked } from "@/telegram/blocked";
import { watchAppUrl } from "@/telegram/watchUrl";
import { snapshotBroadcastRecipients } from "./audience";

type Pace = () => Promise<void>;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DELETE_LIMIT_MS = 48 * HOUR_MS;
const DELETE_BATCH_SIZE = 500;
const DELIVERY_BATCH_SIZE = 200;
const DEFAULT_RETRY_AFTER_SEC = 30;
const MESSAGE_NOT_FOUND = "message to delete not found";

let pausedUntil = 0;

function pauseFor(error: GrammyError, now: Date) {
  const retryAfter = error.parameters.retry_after ?? DEFAULT_RETRY_AFTER_SEC;
  pausedUntil = now.getTime() + retryAfter * 1000;
}

export function resetBroadcastPause() {
  pausedUntil = 0;
}

async function sweepBroadcastDeletes(api: Api, now: Date, pace: Pace): Promise<"ok" | "abort"> {
  if (now.getTime() < pausedUntil) return "abort";

  await db()
    .update(scheduledBroadcastRecipients)
    .set({ deleteError: "too_old", updatedAt: now })
    .where(
      and(
        isNotNull(scheduledBroadcastRecipients.sentAt),
        isNull(scheduledBroadcastRecipients.deletedAt),
        isNull(scheduledBroadcastRecipients.deleteError),
        isNotNull(scheduledBroadcastRecipients.deleteAt),
        lte(scheduledBroadcastRecipients.sentAt, new Date(now.getTime() - DELETE_LIMIT_MS)),
      ),
    );

  const due = await db()
    .select({
      id: scheduledBroadcastRecipients.id,
      telegramMessageId: scheduledBroadcastRecipients.telegramMessageId,
      sentAt: scheduledBroadcastRecipients.sentAt,
      telegramId: users.telegramId,
    })
    .from(scheduledBroadcastRecipients)
    .innerJoin(users, eq(users.id, scheduledBroadcastRecipients.userId))
    .where(
      and(
        isNotNull(scheduledBroadcastRecipients.sentAt),
        isNotNull(scheduledBroadcastRecipients.telegramMessageId),
        isNull(scheduledBroadcastRecipients.deletedAt),
        isNull(scheduledBroadcastRecipients.deleteError),
        isNotNull(scheduledBroadcastRecipients.deleteAt),
        lte(scheduledBroadcastRecipients.deleteAt, now),
        gt(scheduledBroadcastRecipients.sentAt, new Date(now.getTime() - DELETE_LIMIT_MS)),
      ),
    )
    .orderBy(asc(scheduledBroadcastRecipients.deleteAt), asc(scheduledBroadcastRecipients.id))
    .limit(DELETE_BATCH_SIZE);

  for (const row of due) {
    if (now.getTime() < pausedUntil) return "abort";
    const mark = (values: { deletedAt: Date } | { deleteError: string }) =>
      db()
        .update(scheduledBroadcastRecipients)
        .set({ ...values, updatedAt: now })
        .where(eq(scheduledBroadcastRecipients.id, row.id));
    try {
      await pace();
      await api.deleteMessage(row.telegramId, row.telegramMessageId!);
      await mark({ deletedAt: now });
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 429) {
        pauseFor(error, now);
        return "abort";
      }
      if (isBlockedError(error) || (error instanceof GrammyError && error.description.includes(MESSAGE_NOT_FOUND))) {
        await mark({ deletedAt: now });
      } else {
        await mark({ deleteError: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return "ok";
}

async function dueBroadcast(now: Date): Promise<ScheduledBroadcastRow | undefined> {
  const [row] = await db()
    .select()
    .from(scheduledBroadcasts)
    .where(
      or(
        eq(scheduledBroadcasts.status, "running"),
        and(eq(scheduledBroadcasts.status, "scheduled"), lte(scheduledBroadcasts.scheduledAt, now)),
      ),
    )
    .orderBy(
      sql`${scheduledBroadcasts.status} = 'scheduled'`,
      asc(scheduledBroadcasts.scheduledAt),
      asc(scheduledBroadcasts.id),
    )
    .limit(1);
  return row;
}

async function startBroadcast(broadcast: ScheduledBroadcastRow, now: Date): Promise<ScheduledBroadcastRow | undefined> {
  return db().transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(scheduledBroadcasts)
      .where(eq(scheduledBroadcasts.id, broadcast.id))
      .for("update");
    if (!locked) return undefined;
    if (locked.status === "running") return locked;
    if (locked.status !== "scheduled") return undefined;

    await snapshotBroadcastRecipients(tx, locked.id, locked.audiences, now);
    const [{ value }] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(scheduledBroadcastRecipients)
      .where(eq(scheduledBroadcastRecipients.broadcastId, locked.id));
    const [running] = await tx
      .update(scheduledBroadcasts)
      .set({ status: "running", targetCount: value, updatedAt: now })
      .where(eq(scheduledBroadcasts.id, locked.id))
      .returning();
    return running;
  });
}

function buildBroadcastMessage(
  broadcast: ScheduledBroadcastRow,
  recipient: ScheduledBroadcastRecipientRow,
  user: User,
): { rendered: RenderedMessage; targets: SentLinkTarget[] } {
  const displayName = (user.name?.trim() || user.firstName?.trim() || uz.bot.defaultName).slice(
    0,
    TEMPLATE_VARIABLE_MAX_LENGTH.ism,
  );
  const values = { ism: displayName, name: displayName };
  const sanitized = sanitizeTelegramHtml(broadcast.text);
  const text = renderText(sanitized.ok ? sanitized.html : escapeHtml(broadcast.text), values);
  const targets: SentLinkTarget[] = broadcast.buttons.map(() => null);
  const inlineKeyboard: InlineKeyboardButton[][] = broadcast.buttons.map((button: BroadcastButton, index: number) => {
    if (button.kind === "resume") {
      return [{ text: button.text, web_app: { url: watchAppUrl("resume") } }];
    }
    const url = button.kind === "admin" ? adminChatUrl(button.prefill, values) : button.url;
    targets[index] = { kind: button.kind, url };
    return [{ text: button.text, url: `${env.API_URL}/r/${recipient.clickToken}/${index}` }];
  });

  const rendered: RenderedMessage = {
    text,
    parse_mode: "HTML",
    media: broadcast.mediaType && broadcast.mediaFileId ? { type: broadcast.mediaType, fileId: broadcast.mediaFileId } : null,
    ...(inlineKeyboard.length > 0 ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
  };
  return { rendered, targets };
}

async function deliverRecipient(
  api: Api,
  broadcast: ScheduledBroadcastRow,
  recipient: ScheduledBroadcastRecipientRow,
  user: User,
  now: Date,
  pace: Pace,
): Promise<"ok" | "abort"> {
  if (user.botBlocked) {
    await db()
      .update(scheduledBroadcastRecipients)
      .set({ state: "blocked", sendError: "bot_blocked", updatedAt: now })
      .where(eq(scheduledBroadcastRecipients.id, recipient.id));
    return "ok";
  }

  const { rendered, targets } = buildBroadcastMessage(broadcast, recipient, user);
  if (targets.some((target) => target !== null)) {
    await db()
      .update(scheduledBroadcastRecipients)
      .set({ linkTargets: targets, updatedAt: now })
      .where(eq(scheduledBroadcastRecipients.id, recipient.id));
  }

  try {
    await pace();
    const sent = await sendRendered(api, user.telegramId, rendered);
    const deleteAt =
      broadcast.autoDeleteMinutes !== null
        ? new Date(now.getTime() + broadcast.autoDeleteMinutes * MINUTE_MS)
        : null;
    await db()
      .update(scheduledBroadcastRecipients)
      .set({
        state: "sent",
        telegramMessageId: sent.message_id,
        sentAt: now,
        deleteAt,
        updatedAt: now,
      })
      .where(eq(scheduledBroadcastRecipients.id, recipient.id));
    return "ok";
  } catch (error) {
    if (isBlockedError(error)) {
      await db()
        .update(scheduledBroadcastRecipients)
        .set({ state: "blocked", sendError: (error as GrammyError).description, updatedAt: now })
        .where(eq(scheduledBroadcastRecipients.id, recipient.id));
      await markBlocked(user.id);
      return "ok";
    }
    if (error instanceof GrammyError && error.error_code === 429) {
      pauseFor(error, now);
      return "abort";
    }
    if (error instanceof HttpError || (error instanceof GrammyError && error.error_code >= 500)) {
      return "ok";
    }
    await db()
      .update(scheduledBroadcastRecipients)
      .set({
        state: "failed",
        sendError: error instanceof Error ? error.message : String(error),
        updatedAt: now,
      })
      .where(eq(scheduledBroadcastRecipients.id, recipient.id));
    return "ok";
  }
}

async function refreshBroadcastProgress(broadcastId: number, now: Date) {
  const [counts] = await db()
    .select({
      sent: sql<number>`(count(*) filter (where ${scheduledBroadcastRecipients.state} = 'sent'))::int`,
      blocked: sql<number>`(count(*) filter (where ${scheduledBroadcastRecipients.state} = 'blocked'))::int`,
      failed: sql<number>`(count(*) filter (where ${scheduledBroadcastRecipients.state} = 'failed'))::int`,
      pending: sql<number>`(count(*) filter (where ${scheduledBroadcastRecipients.state} = 'pending'))::int`,
    })
    .from(scheduledBroadcastRecipients)
    .where(eq(scheduledBroadcastRecipients.broadcastId, broadcastId));
  await db()
    .update(scheduledBroadcasts)
    .set({
      sentCount: counts.sent,
      blockedCount: counts.blocked,
      failedCount: counts.failed,
      updatedAt: now,
    })
    .where(eq(scheduledBroadcasts.id, broadcastId));
  if (counts.pending === 0) {
    await db()
      .update(scheduledBroadcasts)
      .set({ status: "done", finishedAt: now, updatedAt: now })
      .where(and(eq(scheduledBroadcasts.id, broadcastId), eq(scheduledBroadcasts.status, "running")));
  }
}

export async function processBroadcasts(api: Api, now: Date, pace: Pace): Promise<void> {
  if ((await sweepBroadcastDeletes(api, now, pace)) === "abort") return;
  if (now.getTime() < pausedUntil) return;

  const due = await dueBroadcast(now);
  if (!due) return;

  const running = await startBroadcast(due, now);
  if (!running) return;

  try {
    const batch = await db()
      .select({ recipient: scheduledBroadcastRecipients, user: users })
      .from(scheduledBroadcastRecipients)
      .innerJoin(users, eq(users.id, scheduledBroadcastRecipients.userId))
      .where(
        and(
          eq(scheduledBroadcastRecipients.broadcastId, running.id),
          eq(scheduledBroadcastRecipients.state, "pending"),
        ),
      )
      .orderBy(asc(scheduledBroadcastRecipients.id))
      .limit(DELIVERY_BATCH_SIZE);

    for (const item of batch) {
      if (now.getTime() < pausedUntil) return;
      const [current] = await db()
        .select({ status: scheduledBroadcasts.status })
        .from(scheduledBroadcasts)
        .where(eq(scheduledBroadcasts.id, running.id))
        .limit(1);
      if (current?.status !== "running") return;
      if ((await deliverRecipient(api, running, item.recipient, item.user, now, pace)) === "abort") return;
    }
  } finally {
    await refreshBroadcastProgress(running.id, now);
  }
}
