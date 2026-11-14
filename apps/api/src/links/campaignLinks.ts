import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { CampaignLinkCreate, CampaignLinkItem, Utm } from "@funnel/shared";
import { db } from "@/db";
import { campaignLinks } from "@/db/schema";
import { env } from "@/env";
import { notAdminTelegramId } from "@/telegram/admins";

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function buildBotUrl(code: string): string {
  return `https://t.me/${env.BOT_USERNAME}?start=c_${code}`;
}

function buildLandingUrl(
  utmSource: string | undefined,
  utmCampaign: string | undefined,
  utmContent: string | null | undefined,
): string {
  const url = new URL(env.WEB_URL);
  if (utmSource) url.searchParams.set("utm_source", utmSource);
  if (utmCampaign) url.searchParams.set("utm_campaign", utmCampaign);
  if (utmContent) url.searchParams.set("utm_content", utmContent);
  return url.toString();
}

function randomSuffix(length = 5): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function toLinkItem(code: string, utm: Utm, createdAt: Date): CampaignLinkItem {
  return {
    code,
    utmSource: utm.utm_source ?? "",
    utmCampaign: utm.utm_campaign ?? "",
    utmContent: utm.utm_content ?? null,
    botUrl: buildBotUrl(code),
    landingUrl: buildLandingUrl(utm.utm_source, utm.utm_campaign, utm.utm_content),
    botStarts: 0,
    registrations: 0,
    createdAt: createdAt.toISOString(),
  };
}

export async function listCampaignLinks(): Promise<CampaignLinkItem[]> {
  const rows = await db().execute<{
    code: string;
    utm_source: string;
    utm_campaign: string;
    utm_content: string | null;
    bot_starts: string | number;
    registrations: string | number;
    created_at: string;
  }>(sql`
    SELECT
      cl.code,
      coalesce(cl.utm->>'utm_source', '') AS utm_source,
      coalesce(cl.utm->>'utm_campaign', '') AS utm_campaign,
      nullif(cl.utm->>'utm_content', '') AS utm_content,
      count(DISTINCT u.id)::int AS bot_starts,
      count(DISTINCT CASE WHEN u.registered_at IS NOT NULL THEN u.id END)::int AS registrations,
      to_char(cl.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM campaign_links cl
    LEFT JOIN users u ON (
      ${notAdminTelegramId(sql`u.telegram_id`)}
      AND (
        u.start_param = ('c_' || cl.code)
        OR (
          left(coalesce(u.start_param, ''), 2) <> 'c_'
          AND u.utm_source = (cl.utm->>'utm_source')
          AND u.utm_campaign = (cl.utm->>'utm_campaign')
          AND coalesce(u.utm_content, '') = coalesce(cl.utm->>'utm_content', '')
        )
      )
    )
    GROUP BY cl.code, cl.utm, cl.created_at
    ORDER BY cl.created_at DESC, cl.code ASC
  `);

  return rows.map((row) => ({
    code: row.code,
    utmSource: row.utm_source,
    utmCampaign: row.utm_campaign,
    utmContent: row.utm_content ?? null,
    botUrl: buildBotUrl(row.code),
    landingUrl: buildLandingUrl(row.utm_source, row.utm_campaign, row.utm_content),
    botStarts: Number(row.bot_starts) || 0,
    registrations: Number(row.registrations) || 0,
    createdAt: row.created_at,
  }));
}

export async function createCampaignLink(
  input: CampaignLinkCreate,
): Promise<{ ok: true; item: CampaignLinkItem } | { ok: false; error: "code_taken" }> {
  const utmContent = input.utmContent || undefined;
  const utm: Utm = {
    utm_source: input.utmSource,
    utm_campaign: input.utmCampaign,
    ...(utmContent ? { utm_content: utmContent } : {}),
  };

  if (input.code) {
    const [inserted] = await db()
      .insert(campaignLinks)
      .values({ code: input.code, utm })
      .onConflictDoNothing({ target: campaignLinks.code })
      .returning();
    if (!inserted) {
      return { ok: false, error: "code_taken" };
    }
    return { ok: true, item: toLinkItem(inserted.code, utm, inserted.createdAt) };
  }

  const base =
    [input.utmSource, input.utmCampaign, utmContent]
      .filter(Boolean)
      .join("_")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "link";

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${base}_${randomSuffix(5)}`;
    const [inserted] = await db()
      .insert(campaignLinks)
      .values({ code, utm })
      .onConflictDoNothing({ target: campaignLinks.code })
      .returning();
    if (inserted) {
      return { ok: true, item: toLinkItem(inserted.code, utm, inserted.createdAt) };
    }
  }

  return { ok: false, error: "code_taken" };
}

export async function deleteCampaignLink(code: string): Promise<boolean> {
  const rows = await db()
    .delete(campaignLinks)
    .where(eq(campaignLinks.code, code))
    .returning({ code: campaignLinks.code });
  return rows.length > 0;
}
