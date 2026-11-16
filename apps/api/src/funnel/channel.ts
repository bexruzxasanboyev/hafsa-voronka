import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { syncSegment } from "@/funnel/segments";
import { logEvent } from "@/funnel/users";
import { refreshUserLeadCards } from "@/leads/service";

export type WroteAdminMeta = {
  via?: "manual" | "business" | "won";
  businessConnectionId?: string;
};

export async function markWroteAdmin(
  userId: number,
  actor: { id: number } | null,
  now = new Date(),
  meta?: WroteAdminMeta,
): Promise<boolean> {
  const [marked] = await db()
    .update(users)
    .set({
      wroteAdminAt: now,
      wroteAdminBy: actor?.id ?? null,
      lastAdminChatAt: sql`greatest(coalesce(${users.lastAdminChatAt}, ${now.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz)`,
    })
    .where(and(eq(users.id, userId), isNull(users.wroteAdminAt)))
    .returning({ id: users.id, visitorId: users.visitorId });
  if (!marked) return false;

  await logEvent("admin_chat", {
    userId,
    visitorId: marked.visitorId,
    meta: {
      via: meta?.via ?? "manual",
      by: actor?.id ?? null,
      ...(meta?.businessConnectionId ? { businessConnectionId: meta.businessConnectionId } : {}),
    },
  });
  await syncSegment(userId, now).catch((error) => console.error("Segment sync failed:", error));
  await refreshUserLeadCards(userId).catch((error) =>
    console.error("Lead card refresh failed:", error),
  );
  return true;
}

export async function touchAdminChat(userId: number, at: Date): Promise<void> {
  await db()
    .update(users)
    .set({
      lastAdminChatAt: sql`greatest(coalesce(${users.lastAdminChatAt}, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz)`,
    })
    .where(eq(users.id, userId));
}

export async function markPaid(
  userId: number,
  actor: { id: number } | null,
  now = new Date(),
): Promise<boolean> {
  const [wroteMarked] = await db()
    .update(users)
    .set({
      wroteAdminAt: now,
      wroteAdminBy: actor?.id ?? null,
      lastAdminChatAt: sql`greatest(coalesce(${users.lastAdminChatAt}, ${now.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz)`,
    })
    .where(and(eq(users.id, userId), isNull(users.wroteAdminAt)))
    .returning({ id: users.id, visitorId: users.visitorId });

  const [paidMarked] = await db()
    .update(users)
    .set({ paidAt: now, paidBy: actor?.id ?? null })
    .where(and(eq(users.id, userId), isNull(users.paidAt)))
    .returning({ id: users.id, visitorId: users.visitorId });

  if (wroteMarked) {
    await logEvent("admin_chat", {
      userId,
      visitorId: wroteMarked.visitorId,
      meta: { via: "won", by: actor?.id ?? null },
    });
  }
  if (!paidMarked) return false;

  await logEvent("purchase_recorded", {
    userId,
    visitorId: paidMarked.visitorId,
    meta: { by: actor?.id ?? null },
  });
  await syncSegment(userId, now).catch((error) => console.error("Segment sync failed:", error));
  await refreshUserLeadCards(userId).catch((error) =>
    console.error("Lead card refresh failed:", error),
  );
  return true;
}

export async function recordChannelClick(
  user: { id: number; visitorId: string | null },
  now = new Date(),
  meta?: Record<string, unknown>,
): Promise<void> {
  await logEvent("channel_click", { userId: user.id, visitorId: user.visitorId, meta });
  await db()
    .update(users)
    .set({ channelClickAt: now })
    .where(and(eq(users.id, user.id), isNull(users.channelClickAt)));
  // Analytics keep a click apart from a real chat (wroteAdminAt stays null), but for the funnel a click
  // means the person went to sales: A/B/C reminders stop and the run moves to E, as on main.
  await syncSegment(user.id, now).catch((error) => console.error("Segment sync failed:", error));
  await refreshUserLeadCards(user.id).catch((error) => console.error("Lead card refresh failed:", error));
}
