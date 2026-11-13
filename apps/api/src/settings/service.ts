import {
  chatCleanupHoursSchema,
  DEFAULT_CHAT_CLEANUP_HOURS,
  DEFAULT_MESSAGE_CAPS,
  DEFAULT_QUIET_HOURS_ENABLED,
  DEFAULT_SEGMENT_LOOPS,
  type MessageCaps,
  messageCapsSchema,
  type SegmentLoops,
  segmentLoopsSchema,
} from "@funnel/shared";
import { db } from "@/db";
import { settings } from "@/db/schema";

const DEFAULT_LINK_TTL_HOURS = 24;

let cache: Map<string, string> | undefined;

async function allSettings() {
  cache ??= new Map((await db().select().from(settings)).map((row) => [row.key, row.value]));
  return cache;
}

export function invalidateSettings() {
  cache = undefined;
}

export async function linkTtlHours(): Promise<number> {
  const raw = (await allSettings()).get("LINK_TTL_HOURS");
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_LINK_TTL_HOURS;
  const hours = Number(raw);
  return Number.isSafeInteger(hours) && hours > 0 ? hours : DEFAULT_LINK_TTL_HOURS;
}

export async function messageCaps(): Promise<MessageCaps> {
  const raw = (await allSettings()).get("MESSAGE_CAPS");
  if (raw === undefined) return DEFAULT_MESSAGE_CAPS;
  try {
    const parsed = messageCapsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_MESSAGE_CAPS;
  } catch {
    return DEFAULT_MESSAGE_CAPS;
  }
}

export async function chatCleanupHours(): Promise<number> {
  const raw = (await allSettings()).get("CHAT_CLEANUP_HOURS");
  const parsed = chatCleanupHoursSchema.safeParse(Number(raw));
  return raw !== undefined && parsed.success ? parsed.data : DEFAULT_CHAT_CLEANUP_HOURS;
}

export async function quietHoursEnabled(): Promise<boolean> {
  const raw = (await allSettings()).get("QUIET_HOURS_ENABLED");
  if (raw === "true") return true;
  if (raw === "false") return false;
  return DEFAULT_QUIET_HOURS_ENABLED;
}

export async function segmentLoops(): Promise<SegmentLoops> {
  const raw = (await allSettings()).get("SEGMENT_LOOPS");
  if (raw === undefined) return DEFAULT_SEGMENT_LOOPS;
  try {
    const parsed = segmentLoopsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_SEGMENT_LOOPS;
  } catch {
    return DEFAULT_SEGMENT_LOOPS;
  }
}
