import { and, desc, eq, inArray } from "drizzle-orm";
import type { Api } from "grammy";
import type { BroadcastAudience, BroadcastInput, ScheduledBroadcast, TemplateMediaType } from "@funnel/shared";
import { db } from "@/db";
import { type ScheduledBroadcastRow, scheduledBroadcasts } from "@/db/schema";
import { kickMessageDispatcher } from "@/messages/dispatch";
import { uploadToMediaChat } from "@/telegram/media";
import { countBroadcastAudience } from "./audience";

const IMMEDIATE_DISPATCH_WINDOW_MS = 60_000;

export type BroadcastFailure =
  | { ok: false; code: "not_found" }
  | { ok: false; code: "not_editable" }
  | { ok: false; code: "already_finished" };

export type BroadcastResult = { ok: true; broadcast: ScheduledBroadcast } | BroadcastFailure;

export function broadcastResponse(row: ScheduledBroadcastRow): ScheduledBroadcast {
  return {
    id: row.id,
    text: row.text,
    media: row.mediaType && row.mediaFileId ? { type: row.mediaType, fileId: row.mediaFileId } : null,
    buttons: row.buttons,
    audiences: row.audiences,
    scheduledAt: row.scheduledAt.toISOString(),
    autoDeleteMinutes: row.autoDeleteMinutes,
    status: row.status,
    targetCount: row.targetCount,
    sentCount: row.sentCount,
    blockedCount: row.blockedCount,
    failedCount: row.failedCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function kickIfDueSoon(scheduledAt: Date, now: Date) {
  if (scheduledAt.getTime() <= now.getTime() + IMMEDIATE_DISPATCH_WINDOW_MS) {
    kickMessageDispatcher();
  }
}

export async function listBroadcasts(): Promise<ScheduledBroadcast[]> {
  const rows = await db()
    .select()
    .from(scheduledBroadcasts)
    .orderBy(desc(scheduledBroadcasts.createdAt), desc(scheduledBroadcasts.id));
  return rows.map(broadcastResponse);
}

export async function previewBroadcastAudience(
  audiences: BroadcastAudience[],
  now = new Date(),
): Promise<number> {
  return countBroadcastAudience(db(), audiences, now);
}

export async function uploadBroadcastMedia(
  api: Api,
  type: TemplateMediaType,
  file: File,
): Promise<{ type: TemplateMediaType; fileId: string }> {
  const fileId = await uploadToMediaChat(api, type, file);
  return { type, fileId };
}

export async function findBroadcastMedia(
  id: number,
): Promise<{ type: TemplateMediaType; fileId: string } | null> {
  const [row] = await db()
    .select({ mediaType: scheduledBroadcasts.mediaType, mediaFileId: scheduledBroadcasts.mediaFileId })
    .from(scheduledBroadcasts)
    .where(eq(scheduledBroadcasts.id, id))
    .limit(1);
  if (!row?.mediaType || !row.mediaFileId) return null;
  return { type: row.mediaType, fileId: row.mediaFileId };
}

export async function createBroadcast(input: BroadcastInput, now = new Date()): Promise<ScheduledBroadcast> {
  const scheduledAt = new Date(input.scheduledAt);
  const [row] = await db()
    .insert(scheduledBroadcasts)
    .values({
      text: input.text,
      mediaType: input.media?.type ?? null,
      mediaFileId: input.media?.fileId ?? null,
      buttons: input.buttons,
      audiences: input.audiences,
      scheduledAt,
      autoDeleteMinutes: input.autoDeleteMinutes,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  kickIfDueSoon(scheduledAt, now);
  return broadcastResponse(row);
}

export async function updateBroadcast(
  id: number,
  input: BroadcastInput,
  now = new Date(),
): Promise<BroadcastResult> {
  const scheduledAt = new Date(input.scheduledAt);
  const [updated] = await db()
    .update(scheduledBroadcasts)
    .set({
      text: input.text,
      mediaType: input.media?.type ?? null,
      mediaFileId: input.media?.fileId ?? null,
      buttons: input.buttons,
      audiences: input.audiences,
      scheduledAt,
      autoDeleteMinutes: input.autoDeleteMinutes,
      updatedAt: now,
    })
    .where(and(eq(scheduledBroadcasts.id, id), eq(scheduledBroadcasts.status, "scheduled")))
    .returning();
  if (!updated) {
    const [existing] = await db()
      .select({ id: scheduledBroadcasts.id })
      .from(scheduledBroadcasts)
      .where(eq(scheduledBroadcasts.id, id))
      .limit(1);
    return { ok: false, code: existing ? "not_editable" : "not_found" };
  }
  kickIfDueSoon(scheduledAt, now);
  return { ok: true, broadcast: broadcastResponse(updated) };
}

export async function cancelBroadcast(id: number, now = new Date()): Promise<BroadcastResult> {
  const [cancelled] = await db()
    .update(scheduledBroadcasts)
    .set({ status: "cancelled", finishedAt: now, updatedAt: now })
    .where(and(eq(scheduledBroadcasts.id, id), inArray(scheduledBroadcasts.status, ["scheduled", "running"])))
    .returning();
  if (!cancelled) {
    const [existing] = await db()
      .select({ id: scheduledBroadcasts.id })
      .from(scheduledBroadcasts)
      .where(eq(scheduledBroadcasts.id, id))
      .limit(1);
    return { ok: false, code: existing ? "already_finished" : "not_found" };
  }
  return { ok: true, broadcast: broadcastResponse(cancelled) };
}
