import { sql } from "drizzle-orm";
import type {
  AdminLeadsResponse,
  AdminStatsResponse,
  AttributionNetwork,
  CampaignStat,
  DailyStat,
  DropoffStat,
  FunnelStep,
  LeadItem,
  NetworkAttribution,
  NetworkAttributionRow,
  StatsFilterOptions,
} from "@funnel/shared";
import { attributionNetworks } from "@funnel/shared";
import { db } from "@/db";
import { watchedPercent } from "@/leads/card";
import { notAdminTelegramId } from "@/telegram/admins";
import { formatTashkentDate, listDaysInRange } from "./dates";

const FUNNEL_STEP_NAMES: Record<string, string> = {
  landing_view: "Saytga kirdi",
  cta_click: "Tugmani bosdi",
  bot_start: "Botga o‘tdi",
  registered: "Ro‘yxatdan o‘tdi",
  video_start: "Videoni boshladi",
  video_complete: "Darsni ko‘rdi (70%)",
  channel_click: "Adminga tugma bosdi",
  admin_chat: "Haqiqiy yozdi",
  paid: "Sotib oldi",
};

const ORDERED_FUNNEL_STEPS = [
  "landing_view",
  "cta_click",
  "bot_start",
  "registered",
  "video_start",
  "video_complete",
  "channel_click",
  "admin_chat",
  "paid",
] as const;

const leadUser = () => notAdminTelegramId(sql`u.telegram_id`);

export type QueryFilters = {
  from: string;
  to: string;
  source?: string;
  campaign?: string;
};

export async function getFunnelAndKpis(filters: QueryFilters): Promise<{
  funnel: FunnelStep[];
  kpis: AdminStatsResponse["kpis"];
}> {
  const [result, [milestoneRow]] = await Promise.all([
    db().execute<{ type: string; count: string | number }>(sql`
      SELECT
        type,
        CASE
          WHEN type IN ('landing_view', 'cta_click') THEN count(DISTINCT visitor_id)
          ELSE count(DISTINCT user_id)
        END AS count
      FROM (
        SELECT
          e.type,
          e.visitor_id,
          e.user_id
        FROM events e
        LEFT JOIN users u ON u.id = e.user_id
        WHERE
          ${leadUser()}
          AND (e.created_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
          AND (e.created_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
          AND e.type IN ('landing_view', 'cta_click', 'bot_start', 'registered', 'video_start', 'video_complete', 'channel_click')
          AND (
            (e.type IN ('landing_view', 'cta_click')
             AND (
               (${filters.source ?? null}::text IS NULL AND ${filters.campaign ?? null}::text IS NULL)
               OR e.visitor_id IN (
                 SELECT lv.visitor_id
                 FROM events lv
                 WHERE lv.type = 'landing_view'
                   AND (${filters.source ?? null}::text IS NULL OR lv.meta->>'utm_source' = ${filters.source ?? null})
                   AND (${filters.campaign ?? null}::text IS NULL OR lv.meta->>'utm_campaign' = ${filters.campaign ?? null})
               )
             ))
            OR
            (e.type NOT IN ('landing_view', 'cta_click')
             AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
             AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null}))
          )
      ) sub
      GROUP BY type
    `),
    db().execute<{ real_chats: string | number; purchases: string | number }>(sql`
      SELECT
        count(*) FILTER (
          WHERE u.wrote_admin_at IS NOT NULL
            AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
            AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
        ) AS real_chats,
        count(*) FILTER (
          WHERE u.paid_at IS NOT NULL
            AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
            AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
        ) AS purchases
      FROM users u
      WHERE
        ${leadUser()}
        AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
        AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null})
        AND (
          (u.wrote_admin_at IS NOT NULL
            AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
            AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date)
          OR
          (u.paid_at IS NOT NULL
            AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
            AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date)
        )
    `),
  ]);

  const countMap = new Map<string, number>();
  for (const row of result) {
    countMap.set(row.type, Number(row.count) || 0);
  }
  const realChats = Number(milestoneRow?.real_chats) || 0;
  const purchases = Number(milestoneRow?.purchases) || 0;
  countMap.set("admin_chat", realChats);
  countMap.set("paid", purchases);

  const funnel: FunnelStep[] = [];
  for (let i = 0; i < ORDERED_FUNNEL_STEPS.length; i++) {
    const step = ORDERED_FUNNEL_STEPS[i];
    const count = countMap.get(step) ?? 0;
    let conversionRate = 100;
    if (i > 0) {
      const prevCount = funnel[i - 1].count;
      conversionRate = prevCount > 0 ? Math.round((count / prevCount) * 1000) / 10 : 0;
    }
    funnel.push({
      step,
      name: FUNNEL_STEP_NAMES[step] ?? step,
      count,
      conversionRate,
    });
  }

  const landingViews = countMap.get("landing_view") ?? 0;
  const botStarts = countMap.get("bot_start") ?? 0;
  const registrations = countMap.get("registered") ?? 0;
  const completions = countMap.get("video_complete") ?? 0;
  const channelClicks = countMap.get("channel_click") ?? 0;
  const conversionBase = landingViews > 0 ? landingViews : botStarts;
  const conversionRate = conversionBase > 0 ? Math.round((channelClicks / conversionBase) * 1000) / 10 : 0;

  return {
    funnel,
    kpis: {
      landingViews,
      botStarts,
      registrations,
      completions,
      channelClicks,
      realChats,
      purchases,
      conversionRate,
    },
  };
}

export async function getDailySeries(filters: QueryFilters): Promise<DailyStat[]> {
  const result = await db().execute<{
    date: string;
    registrations: string | number;
    completions: string | number;
  }>(sql`
    SELECT
      to_char(e.created_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS date,
      count(DISTINCT CASE WHEN e.type = 'registered' THEN e.user_id END) AS registrations,
      count(DISTINCT CASE WHEN e.type = 'video_complete' THEN e.user_id END) AS completions
    FROM events e
    JOIN users u ON u.id = e.user_id
    WHERE
      ${leadUser()}
      AND e.type IN ('registered', 'video_complete')
      AND (e.created_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
      AND (e.created_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
      AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
      AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null})
    GROUP BY to_char(e.created_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD')
    ORDER BY date ASC
  `);

  const dataMap = new Map<string, { registrations: number; completions: number }>();
  for (const row of result) {
    dataMap.set(row.date, {
      registrations: Number(row.registrations) || 0,
      completions: Number(row.completions) || 0,
    });
  }

  const allDays = listDaysInRange(filters.from, filters.to);
  return allDays.map((date) => {
    const item = dataMap.get(date);
    return {
      date,
      registrations: item?.registrations ?? 0,
      completions: item?.completions ?? 0,
    };
  });
}

export async function getCampaignStats(filters: QueryFilters): Promise<CampaignStat[]> {
  const result = await db().execute<{
    source: string;
    campaign: string;
    content: string;
    bot_starts: string | number;
    registrations: string | number;
    completions: string | number;
    channel_clicks: string | number;
    real_chats: string | number;
    purchases: string | number;
  }>(sql`
    WITH event_agg AS (
      SELECT
        coalesce(u.utm_source, '') AS source,
        coalesce(u.utm_campaign, '') AS campaign,
        coalesce(u.utm_content, '') AS content,
        count(DISTINCT CASE WHEN e.type = 'bot_start' THEN e.user_id END) AS bot_starts,
        count(DISTINCT CASE WHEN e.type = 'registered' THEN e.user_id END) AS registrations,
        count(DISTINCT CASE WHEN e.type = 'video_complete' THEN e.user_id END) AS completions,
        count(DISTINCT CASE WHEN e.type = 'channel_click' THEN e.user_id END) AS channel_clicks,
        0::bigint AS real_chats,
        0::bigint AS purchases
      FROM events e
      JOIN users u ON u.id = e.user_id
      WHERE
        ${leadUser()}
        AND (e.created_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
        AND (e.created_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
        AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
        AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null})
      GROUP BY coalesce(u.utm_source, ''), coalesce(u.utm_campaign, ''), coalesce(u.utm_content, '')
    ),
    milestone_agg AS (
      SELECT
        coalesce(u.utm_source, '') AS source,
        coalesce(u.utm_campaign, '') AS campaign,
        coalesce(u.utm_content, '') AS content,
        0::bigint AS bot_starts,
        0::bigint AS registrations,
        0::bigint AS completions,
        0::bigint AS channel_clicks,
        count(DISTINCT CASE
          WHEN u.wrote_admin_at IS NOT NULL
            AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
            AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
          THEN u.id
        END) AS real_chats,
        count(DISTINCT CASE
          WHEN u.paid_at IS NOT NULL
            AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
            AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
          THEN u.id
        END) AS purchases
      FROM users u
      WHERE
        ${leadUser()}
        AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
        AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null})
        AND (
          (u.wrote_admin_at IS NOT NULL
            AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
            AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date)
          OR
          (u.paid_at IS NOT NULL
            AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
            AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date)
        )
      GROUP BY coalesce(u.utm_source, ''), coalesce(u.utm_campaign, ''), coalesce(u.utm_content, '')
    )
    SELECT
      source,
      campaign,
      content,
      sum(bot_starts) AS bot_starts,
      sum(registrations) AS registrations,
      sum(completions) AS completions,
      sum(channel_clicks) AS channel_clicks,
      sum(real_chats) AS real_chats,
      sum(purchases) AS purchases
    FROM (
      SELECT * FROM event_agg
      UNION ALL
      SELECT * FROM milestone_agg
    ) combined
    GROUP BY source, campaign, content
    ORDER BY registrations DESC, bot_starts DESC, real_chats DESC, purchases DESC
  `);

  return result.map((row) => {
    const botStarts = Number(row.bot_starts) || 0;
    const registrations = Number(row.registrations) || 0;
    const completions = Number(row.completions) || 0;
    const channelClicks = Number(row.channel_clicks) || 0;
    const realChats = Number(row.real_chats) || 0;
    const purchases = Number(row.purchases) || 0;
    const completionRate = registrations > 0 ? Math.round((completions / registrations) * 1000) / 10 : 0;
    return {
      source: row.source,
      campaign: row.campaign,
      content: row.content,
      botStarts,
      registrations,
      completions,
      completionRate,
      channelClicks,
      realChats,
      purchases,
    };
  });
}

const CANONICAL_ATTRIBUTION_NETWORKS = attributionNetworks.filter(
  (network): network is Exclude<AttributionNetwork, "other"> => network !== "other",
);

function networkBucketExpr(srcExpr: ReturnType<typeof sql>) {
  return sql`
    CASE
      WHEN ${srcExpr} IS NULL OR btrim(${srcExpr}) = '' THEN 'organic'
      WHEN lower(btrim(${srcExpr})) ~ '^(ig|insta)' THEN 'ig'
      WHEN lower(btrim(${srcExpr})) ~ '^(fb|facebook|meta)' THEN 'fb'
      WHEN lower(btrim(${srcExpr})) ~ '^(tg|telegram)' THEN 'tg'
      ELSE 'other'
    END
  `;
}

async function queryAttributionTouch(
  filters: QueryFilters,
  srcExpr: ReturnType<typeof sql>,
  campaignExpr: ReturnType<typeof sql>,
): Promise<NetworkAttributionRow[]> {
  const bucketExpr = networkBucketExpr(srcExpr);
  const rows = await db().execute<{
    network: AttributionNetwork;
    registrations: string | number;
    button_clicks: string | number;
    real_chats: string | number;
    purchases: string | number;
  }>(sql`
    WITH cc_users AS (
      SELECT DISTINCT e.user_id
      FROM events e
      WHERE e.type = 'channel_click'
        AND e.user_id IS NOT NULL
        AND (e.created_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
        AND (e.created_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
    )
    SELECT
      ${bucketExpr} AS network,
      count(*) FILTER (
        WHERE u.registered_at IS NOT NULL
          AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
          AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
      ) AS registrations,
      count(*) FILTER (WHERE cc.user_id IS NOT NULL) AS button_clicks,
      count(*) FILTER (
        WHERE u.wrote_admin_at IS NOT NULL
          AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
          AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
      ) AS real_chats,
      count(*) FILTER (
        WHERE u.paid_at IS NOT NULL
          AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
          AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
      ) AS purchases
    FROM users u
    LEFT JOIN cc_users cc ON cc.user_id = u.id
    WHERE
      ${leadUser()}
      AND (${filters.source ?? null}::text IS NULL OR ${srcExpr} = ${filters.source ?? null})
      AND (${filters.campaign ?? null}::text IS NULL OR ${campaignExpr} = ${filters.campaign ?? null})
      AND (
        (u.registered_at IS NOT NULL
          AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
          AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date)
        OR cc.user_id IS NOT NULL
        OR (u.wrote_admin_at IS NOT NULL
          AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
          AND (u.wrote_admin_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date)
        OR (u.paid_at IS NOT NULL
          AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
          AND (u.paid_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date)
      )
    GROUP BY ${bucketExpr}
  `);

  const byNetwork = new Map<AttributionNetwork, NetworkAttributionRow>();
  for (const row of rows) {
    byNetwork.set(row.network, {
      network: row.network,
      registrations: Number(row.registrations) || 0,
      buttonClicks: Number(row.button_clicks) || 0,
      realChats: Number(row.real_chats) || 0,
      purchases: Number(row.purchases) || 0,
    });
  }

  const result: NetworkAttributionRow[] = CANONICAL_ATTRIBUTION_NETWORKS.map(
    (network) =>
      byNetwork.get(network) ?? {
        network,
        registrations: 0,
        buttonClicks: 0,
        realChats: 0,
        purchases: 0,
      },
  );

  const other = byNetwork.get("other");
  if (
    other &&
    (other.registrations > 0 || other.buttonClicks > 0 || other.realChats > 0 || other.purchases > 0)
  ) {
    result.push(other);
  }

  return result;
}

export async function getNetworkAttribution(filters: QueryFilters): Promise<NetworkAttribution> {
  const [firstTouch, lastTouch] = await Promise.all([
    queryAttributionTouch(filters, sql`u.utm_source`, sql`u.utm_campaign`),
    queryAttributionTouch(
      filters,
      sql`coalesce(u.last_utm_source, u.utm_source)`,
      sql`coalesce(u.last_utm_campaign, u.utm_campaign)`,
    ),
  ]);
  return { firstTouch, lastTouch };
}

export async function getWatchDropoff(filters: QueryFilters): Promise<DropoffStat[]> {
  const rows = await db().execute<{
    minute: number;
    count: string | number;
    total_registered: string | number;
  }>(sql`
    WITH viewers AS (
      SELECT
        coalesce(wp.max_position, 0) AS max_position,
        v.duration
      FROM users u
      LEFT JOIN watch_progress wp ON wp.user_id = u.id
      LEFT JOIN videos v ON v.id = u.video_id
      WHERE
        u.registered_at IS NOT NULL
        AND ${leadUser()}
        AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
        AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
        AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
        AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null})
    )
    SELECT
      m.minute,
      count(*) FILTER (WHERE viewers.max_position >= m.minute * 60) AS count,
      count(*) AS total_registered
    FROM generate_series(1, (SELECT coalesce(max(duration), 0) / 60 FROM viewers)) AS m(minute)
    CROSS JOIN viewers
    GROUP BY m.minute
    ORDER BY m.minute
  `);

  return rows.map((row) => {
    const count = Number(row.count) || 0;
    const totalRegistered = Number(row.total_registered) || 0;
    return {
      minute: Number(row.minute),
      count,
      share: totalRegistered > 0 ? Math.round((count / totalRegistered) * 1000) / 10 : 0,
    };
  });
}

export async function getHealthStats(): Promise<AdminStatsResponse["health"]> {
  const [row] = await db().execute<{
    sheets_backlog: string | number;
    sheets_failures: string | number;
    last_bot_start_at: string | null;
    last_event_at: string | null;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM leads l LEFT JOIN users u ON u.id = l.user_id WHERE l.notify_version > l.sheets_synced_version AND l.sheets_attempts < 10 AND ${leadUser()}) AS sheets_backlog,
      (SELECT count(*)::int FROM leads l LEFT JOIN users u ON u.id = l.user_id WHERE l.notify_version > l.sheets_synced_version AND l.sheets_attempts >= 10 AND ${leadUser()}) AS sheets_failures,
      (SELECT to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM events WHERE type = 'bot_start') AS last_bot_start_at,
      (SELECT to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM events) AS last_event_at
  `);

  return {
    sheetsBacklog: Number(row?.sheets_backlog) || 0,
    sheetsFailures: Number(row?.sheets_failures) || 0,
    lastBotStartAt: row?.last_bot_start_at ?? null,
    lastEventAt: row?.last_event_at ?? null,
  };
}

const CANONICAL_SOURCES = ["tg", "ig", "fb"];

export async function getFilterOptions(): Promise<StatsFilterOptions> {
  const [sourceRows, campaignRows] = await Promise.all([
    db().execute<{ source: string }>(sql`
      SELECT DISTINCT source
      FROM (
        SELECT u.utm_source AS source
        FROM users u
        WHERE ${leadUser()} AND coalesce(u.utm_source, '') <> ''
        UNION
        SELECT cl.utm->>'utm_source' AS source
        FROM campaign_links cl
        WHERE coalesce(cl.utm->>'utm_source', '') <> ''
        UNION
        SELECT e.meta->>'utm_source' AS source
        FROM events e
        WHERE e.type = 'landing_view' AND coalesce(e.meta->>'utm_source', '') <> ''
      ) s
    `),
    db().execute<{ source: string; campaign: string }>(sql`
      SELECT source, campaign
      FROM (
        SELECT coalesce(u.utm_source, '') AS source, u.utm_campaign AS campaign
        FROM users u
        WHERE ${leadUser()} AND coalesce(u.utm_campaign, '') <> ''
        UNION
        SELECT coalesce(cl.utm->>'utm_source', '') AS source, cl.utm->>'utm_campaign' AS campaign
        FROM campaign_links cl
        WHERE coalesce(cl.utm->>'utm_campaign', '') <> ''
        UNION
        SELECT coalesce(e.meta->>'utm_source', '') AS source, e.meta->>'utm_campaign' AS campaign
        FROM events e
        WHERE e.type = 'landing_view' AND coalesce(e.meta->>'utm_campaign', '') <> ''
      ) c
      WHERE campaign <> ''
      ORDER BY campaign ASC, source ASC
    `),
  ]);

  const canonicalSet = new Set(CANONICAL_SOURCES);
  const otherSources = sourceRows
    .map((r) => r.source)
    .filter((s) => s && !canonicalSet.has(s))
    .sort((a, b) => a.localeCompare(b));

  return {
    sources: [...CANONICAL_SOURCES, ...otherSources],
    campaigns: campaignRows.map((r) => ({
      source: r.source,
      campaign: r.campaign,
    })),
  };
}

export async function getLeads(
  filters: QueryFilters,
  page = 1,
  pageSize = 50,
): Promise<AdminLeadsResponse> {
  const offset = (page - 1) * pageSize;

  const [countRow] = await db().execute<{ total: string | number }>(sql`
    SELECT count(u.id) AS total
    FROM users u
    WHERE
      u.registered_at IS NOT NULL
      AND ${leadUser()}
      AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
      AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
      AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
      AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null})
  `);
  const total = Number(countRow?.total) || 0;

  const rows = await db().execute<{
    id: number;
    registered_at: string;
    name: string | null;
    phone: string | null;
    username: string | null;
    source: string | null;
    campaign: string | null;
    max_position: string | number;
    duration: number | null;
    completed: boolean;
    channel_clicked: boolean;
    wrote_admin: boolean;
    paid: boolean;
  }>(sql`
    SELECT
      u.id,
      to_char(u.registered_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS registered_at,
      u.name,
      u.phone,
      u.username,
      u.utm_source AS source,
      u.utm_campaign AS campaign,
      coalesce(wp.max_position, 0) AS max_position,
      v.duration AS duration,
      coalesce(u.completed_at IS NOT NULL OR wp.completed IS TRUE, false) AS completed,
      (u.channel_click_at IS NOT NULL) AS channel_clicked,
      (u.wrote_admin_at IS NOT NULL) AS wrote_admin,
      (u.paid_at IS NOT NULL) AS paid
    FROM users u
    LEFT JOIN watch_progress wp ON wp.user_id = u.id
    LEFT JOIN videos v ON v.id = u.video_id
    WHERE
      u.registered_at IS NOT NULL
      AND ${leadUser()}
      AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
      AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
      AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
      AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null})
    ORDER BY u.registered_at DESC, u.id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  const leads: LeadItem[] = rows.map((r) => {
    const maxPos = Number(r.max_position) || 0;
    const progressPercent = watchedPercent(maxPos, r.duration ?? 0);
    return {
      id: Number(r.id),
      registeredAt: r.registered_at,
      name: r.name,
      phone: r.phone,
      username: r.username,
      source: r.source,
      campaign: r.campaign,
      progressPercent,
      completed: Boolean(r.completed),
      channelClicked: Boolean(r.channel_clicked),
      wroteAdmin: Boolean(r.wrote_admin),
      paid: Boolean(r.paid),
    };
  });

  return {
    leads,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function getLeadsCsv(filters: QueryFilters): Promise<string> {
  const rows = await db().execute<{
    id: number;
    registered_at: string;
    name: string | null;
    phone: string | null;
    username: string | null;
    source: string | null;
    campaign: string | null;
    max_position: string | number;
    duration: number | null;
    completed: boolean;
    channel_clicked: boolean;
    wrote_admin: boolean;
    paid: boolean;
  }>(sql`
    SELECT
      u.id,
      to_char(u.registered_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS registered_at,
      u.name,
      u.phone,
      u.username,
      u.utm_source AS source,
      u.utm_campaign AS campaign,
      coalesce(wp.max_position, 0) AS max_position,
      v.duration AS duration,
      coalesce(u.completed_at IS NOT NULL OR wp.completed IS TRUE, false) AS completed,
      (u.channel_click_at IS NOT NULL) AS channel_clicked,
      (u.wrote_admin_at IS NOT NULL) AS wrote_admin,
      (u.paid_at IS NOT NULL) AS paid
    FROM users u
    LEFT JOIN watch_progress wp ON wp.user_id = u.id
    LEFT JOIN videos v ON v.id = u.video_id
    WHERE
      u.registered_at IS NOT NULL
      AND ${leadUser()}
      AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date >= ${filters.from}::date
      AND (u.registered_at AT TIME ZONE 'Asia/Tashkent')::date <= ${filters.to}::date
      AND (${filters.source ?? null}::text IS NULL OR u.utm_source = ${filters.source ?? null})
      AND (${filters.campaign ?? null}::text IS NULL OR u.utm_campaign = ${filters.campaign ?? null})
    ORDER BY u.registered_at DESC, u.id DESC
  `);

  const headers = [
    "Ro'yxatdan o'tgan sana",
    "Ism",
    "Telefon",
    "Username",
    "Manba",
    "Kampaniya",
    "Ko'rish foizi",
    "Tugatilgan",
    "Tugma bosgan",
    "Haqiqiy yozgan",
    "Sotib olgan",
  ];

  const lines: string[] = [headers.map(escapeCsvCell).join(",")];

  for (const r of rows) {
    const maxPos = Number(r.max_position) || 0;
    const progressPercent = watchedPercent(maxPos, r.duration ?? 0);
    const line = [
      formatTashkentDate(r.registered_at),
      r.name ?? "",
      r.phone ?? "",
      r.username ? `@${r.username.replace(/^@/, "")}` : "",
      r.source ?? "",
      r.campaign ?? "",
      `${progressPercent}%`,
      r.completed ? "Ha" : "Yo'q",
      r.channel_clicked ? "Ha" : "Yo'q",
      r.wrote_admin ? "Ha" : "Yo'q",
      r.paid ? "Ha" : "Yo'q",
    ].map(escapeCsvCell).join(",");
    lines.push(line);
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
