import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import type { EventType } from "@funnel/shared";
import { events, users } from "@/db/schema";
import { insertGrant } from "@/links/service";
import { linkTtlHours } from "@/settings/service";
import { resolveAttribution } from "./attribution";

export type TelegramProfile = {
  id: number;
  username?: string;
  first_name?: string;
  language_code?: string;
};

export async function upsertUser(
  profile: TelegramProfile,
  startParam: string | undefined,
) {
  const profileFields = {
    username: profile.username ?? null,
    firstName: profile.first_name ?? null,
    languageCode: profile.language_code ?? null,
  };

  const [existing] = await db()
    .select()
    .from(users)
    .where(eq(users.telegramId, profile.id))
    .limit(1);

  if (existing) {
    let lastTouchFields: {
      lastUtmSource?: string | null;
      lastUtmCampaign?: string | null;
      lastUtmContent?: string | null;
      lastTouchAt?: Date;
    } = {};
    if (startParam) {
      const attribution = await resolveAttribution(startParam);
      if (attribution.utm_source || attribution.utm_campaign || attribution.utm_content) {
        lastTouchFields = {
          lastUtmSource: attribution.utm_source ?? null,
          lastUtmCampaign: attribution.utm_campaign ?? null,
          lastUtmContent: attribution.utm_content ?? null,
          lastTouchAt: new Date(),
        };
      }
    }
    const [updated] = await db()
      .update(users)
      .set({ ...profileFields, ...lastTouchFields })
      .where(eq(users.id, existing.id))
      .returning();
    return { user: updated, isNew: false };
  }

  const attribution = await resolveAttribution(startParam);
  const hasUtm = Boolean(attribution.utm_source || attribution.utm_campaign || attribution.utm_content);
  const lastTouchFields = hasUtm
    ? {
        lastUtmSource: attribution.utm_source ?? null,
        lastUtmCampaign: attribution.utm_campaign ?? null,
        lastUtmContent: attribution.utm_content ?? null,
        lastTouchAt: new Date(),
      }
    : {};
  const [created] = await db()
    .insert(users)
    .values({
      telegramId: profile.id,
      ...profileFields,
      startParam: startParam || null,
      visitorId: attribution.visitorId ?? null,
      utmSource: attribution.utm_source ?? null,
      utmCampaign: attribution.utm_campaign ?? null,
      utmContent: attribution.utm_content ?? null,
      ...lastTouchFields,
      fbclid: attribution.fbclid ?? null,
      videoId: sql`(select id from videos where is_active)`,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: { ...profileFields, ...lastTouchFields },
    })
    .returning();
  return { user: created, isNew: true };
}

export async function markRegistered(
  userId: number,
  fields: { name: string; phone: string | null; phoneVerified: boolean },
) {
  const now = new Date();
  const ttlHours = await linkTtlHours();
  return db().transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ ...fields, registeredAt: now })
      .where(and(eq(users.id, userId), isNull(users.registeredAt)))
      .returning();
    if (!updated) return undefined;
    const grant = await insertGrant(tx, userId, { kind: "initial", offerFirst: false, now, ttlHours, day: 1 });
    return { ...updated, linkId: grant.id, linkGivenAt: grant.givenAt, linkExpiresAt: grant.expiresAt };
  });
}

export async function setBotBlocked(telegramId: number, blocked: boolean) {
  const [updated] = await db()
    .update(users)
    .set({ botBlocked: blocked })
    .where(eq(users.telegramId, telegramId))
    .returning({ id: users.id });
  return updated;
}

export async function findByTelegramId(telegramId: number) {
  const [user] = await db().select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return user;
}

export async function logEvent(
  type: EventType,
  fields: { userId?: number; visitorId?: string | null; meta?: Record<string, unknown> },
) {
  await db().insert(events).values({
    type,
    userId: fields.userId,
    visitorId: fields.visitorId ?? null,
    meta: fields.meta,
  });
}
