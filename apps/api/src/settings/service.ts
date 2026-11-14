import {
  type AdminSettings,
  type AdminSettingsUpdate,
  chatCleanupHoursSchema,
  DEFAULT_CHAT_CLEANUP_HOURS,
  DEFAULT_MESSAGE_CAPS,
  DEFAULT_NIGHT_RESTRICTION_ENABLED,
  DEFAULT_SEGMENT_LOOPS,
  type MessageCaps,
  messageCapsSchema,
  type SegmentLoops,
  segmentLoopsSchema,
} from "@funnel/shared";
import { db } from "@/db";
import { settings } from "@/db/schema";

const DEFAULT_LINK_TTL_HOURS = 24;

export const SETTINGS_KEYS = {
  linkTtlHours: "LINK_TTL_HOURS",
  messageCaps: "MESSAGE_CAPS",
  chatCleanupHours: "CHAT_CLEANUP_HOURS",
  nightRestrictionEnabled: "NIGHT_RESTRICTION_ENABLED",
  segmentLoops: "SEGMENT_LOOPS",
} as const;

let cache: Map<string, string> | undefined;

async function allSettings() {
  cache ??= new Map((await db().select().from(settings)).map((row) => [row.key, row.value]));
  return cache;
}

export function invalidateSettings() {
  cache = undefined;
}

export async function linkTtlHours(): Promise<number> {
  const raw = (await allSettings()).get(SETTINGS_KEYS.linkTtlHours);
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_LINK_TTL_HOURS;
  const hours = Number(raw);
  return Number.isSafeInteger(hours) && hours > 0 ? hours : DEFAULT_LINK_TTL_HOURS;
}

export async function messageCaps(): Promise<MessageCaps> {
  const raw = (await allSettings()).get(SETTINGS_KEYS.messageCaps);
  if (raw === undefined) return DEFAULT_MESSAGE_CAPS;
  try {
    const parsed = messageCapsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_MESSAGE_CAPS;
  } catch {
    return DEFAULT_MESSAGE_CAPS;
  }
}

export async function chatCleanupHours(): Promise<number> {
  const raw = (await allSettings()).get(SETTINGS_KEYS.chatCleanupHours);
  const parsed = chatCleanupHoursSchema.safeParse(Number(raw));
  return raw !== undefined && parsed.success ? parsed.data : DEFAULT_CHAT_CLEANUP_HOURS;
}

export async function nightRestrictionEnabled(): Promise<boolean> {
  const raw = (await allSettings()).get(SETTINGS_KEYS.nightRestrictionEnabled);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return DEFAULT_NIGHT_RESTRICTION_ENABLED;
}

export async function segmentLoops(): Promise<SegmentLoops> {
  const raw = (await allSettings()).get(SETTINGS_KEYS.segmentLoops);
  if (raw === undefined) return DEFAULT_SEGMENT_LOOPS;
  try {
    const parsed = segmentLoopsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_SEGMENT_LOOPS;
  } catch {
    return DEFAULT_SEGMENT_LOOPS;
  }
}

export async function getAdminSettings(): Promise<AdminSettings> {
  return {
    linkTtlHours: await linkTtlHours(),
    messageCaps: await messageCaps(),
    chatCleanupHours: await chatCleanupHours(),
    nightRestrictionEnabled: await nightRestrictionEnabled(),
    segmentLoops: await segmentLoops(),
  };
}

export async function updateAdminSettings(input: AdminSettingsUpdate): Promise<AdminSettings> {
  const values = [
    ...(input.linkTtlHours === undefined ? [] : [{ key: SETTINGS_KEYS.linkTtlHours, value: String(input.linkTtlHours) }]),
    ...(input.messageCaps === undefined ? [] : [{ key: SETTINGS_KEYS.messageCaps, value: JSON.stringify(input.messageCaps) }]),
    ...(input.chatCleanupHours === undefined ? [] : [{ key: SETTINGS_KEYS.chatCleanupHours, value: String(input.chatCleanupHours) }]),
    ...(input.nightRestrictionEnabled === undefined
      ? []
      : [{ key: SETTINGS_KEYS.nightRestrictionEnabled, value: String(input.nightRestrictionEnabled) }]),
    ...(input.segmentLoops === undefined ? [] : [{ key: SETTINGS_KEYS.segmentLoops, value: JSON.stringify(input.segmentLoops) }]),
  ];
  if (values.length > 0) {
    await db().transaction(async (tx) => {
      for (const row of values) {
        await tx
          .insert(settings)
          .values(row)
          .onConflictDoUpdate({ target: settings.key, set: { value: row.value, updatedAt: new Date() } });
      }
    });
    invalidateSettings();
  }
  return getAdminSettings();
}
