import { sql } from "drizzle-orm";
import type { HermesPaymentKind } from "@funnel/shared";
import { db } from "@/db";
import { hermesPayments } from "@/db/schema";
import { markWroteAdmin, touchAdminChat } from "@/funnel/channel";
import { findByTelegramId } from "@/funnel/users";
import { recordUserPurchaseSideEffects } from "@/payments/service";
import { touchHermesHeartbeat } from "./heartbeat";
import type { HermesEvent, HermesIngestBody } from "./schema";

const PAID_CONFIDENCES = new Set([
  "first",
  "partial",
  "partial_complete",
  "partial_used",
  "admin",
]);

export function deriveHermesPaymentKind(confidence: string): HermesPaymentKind {
  if (PAID_CONFIDENCES.has(confidence)) return "paid";
  if (confidence === "deposit") return "deposit";
  return "ignored";
}

export type HermesIngestResult = {
  applied: {
    messages: number;
    payments: number;
    heartbeats: number;
  };
  skipped: number;
};

async function applyEvent(
  event: HermesEvent,
  adminTelegramId: number,
  counts: HermesIngestResult,
): Promise<void> {
  if (event.type === "heartbeat") {
    await touchHermesHeartbeat();
    counts.applied.heartbeats += 1;
    return;
  }

  if (event.type === "message") {
    if (event.chatId === adminTelegramId) {
      counts.skipped += 1;
      return;
    }

    const user = await findByTelegramId(event.chatId);
    if (!user) {
      counts.skipped += 1;
      return;
    }

    const at = new Date(event.at);
    if (event.direction === "in") {
      const marked = await markWroteAdmin(user.id, { id: adminTelegramId }, at, {
        via: "hermes",
      });
      if (!marked) {
        await touchAdminChat(user.id, at);
      }
    } else {
      await touchAdminChat(user.id, at);
    }
    counts.applied.messages += 1;
    return;
  }

  const kind = deriveHermesPaymentKind(event.confidence);
  const user = await findByTelegramId(event.telegramId);
  const userId = user?.id ?? null;
  const hermesCreatedAt = new Date(event.createdAt);

  await db()
    .insert(hermesPayments)
    .values({
      hermesId: event.hermesId,
      telegramId: event.telegramId,
      userId,
      payDate: event.payDate,
      amountUzs: event.amountUzs,
      monthNo: event.monthNo,
      tariff: event.tariff,
      confidence: event.confidence,
      kind,
      source: event.source,
      hermesCreatedAt,
    })
    .onConflictDoUpdate({
      target: hermesPayments.hermesId,
      set: {
        telegramId: event.telegramId,
        userId,
        payDate: event.payDate,
        amountUzs: event.amountUzs,
        monthNo: event.monthNo,
        tariff: event.tariff,
        confidence: event.confidence,
        kind,
        source: event.source,
        hermesCreatedAt,
        updatedAt: sql`now()`,
      },
    });

  if (kind === "paid" && user) {
    // Funnel purchase side effects are intentionally one-way: a later confidence downgrade
    // (e.g. paid -> deposit or ignored) does NOT un-win the lead or clear users.paid_at.
    const paidAt = event.payDate
      ? new Date(`${event.payDate}T12:00:00+05:00`)
      : hermesCreatedAt;
    await recordUserPurchaseSideEffects(user.id, paidAt);
  }

  counts.applied.payments += 1;
}

export async function ingestHermesEvents(body: HermesIngestBody): Promise<HermesIngestResult> {
  await touchHermesHeartbeat();

  const counts: HermesIngestResult = {
    applied: {
      messages: 0,
      payments: 0,
      heartbeats: 0,
    },
    skipped: 0,
  };

  for (const event of body.events) {
    try {
      await applyEvent(event, body.adminTelegramId, counts);
    } catch (error) {
      counts.skipped += 1;
      console.error("Failed to apply Hermes event:", event, error);
    }
  }

  return counts;
}
