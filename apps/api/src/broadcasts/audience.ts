import { and, count, eq, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import type { BroadcastAudience } from "@funnel/shared";
import { db } from "@/db";
import { leads, scheduledBroadcastRecipients, segmentRuns, users } from "@/db/schema";
import { notAdminTelegramId } from "@/telegram/admins";

type Executor = Pick<ReturnType<typeof db>, "select" | "execute">;

const wonLeadExists = sql`exists (select 1 from ${leads} where ${leads.userId} = ${users.id} and ${leads.outcome} = 'won')`;

function audiencePredicate(audience: BroadcastAudience): SQL {
  if (audience === "all") return sql`true`;
  if (audience === "bought") return or(isNotNull(users.paidAt), wonLeadExists)!;
  if (audience === "not_bought") return and(isNull(users.paidAt), sql`not (${wonLeadExists})`)!;
  return sql`exists (select 1 from ${segmentRuns} where ${segmentRuns.userId} = ${users.id} and ${segmentRuns.segment} = ${audience} and ${segmentRuns.endedAt} is null)`;
}

export function broadcastAudienceWhere(audiences: readonly BroadcastAudience[], _now = new Date()): SQL {
  const predicates = audiences.map(audiencePredicate);
  return and(
    eq(users.botBlocked, false),
    notAdminTelegramId(users.telegramId),
    predicates.length > 0 ? or(...predicates) : sql`false`,
  )!;
}

export async function countBroadcastAudience(
  executor: Executor,
  audiences: readonly BroadcastAudience[],
  now = new Date(),
): Promise<number> {
  if (audiences.length === 0) return 0;
  const [row] = await executor
    .select({ value: count() })
    .from(users)
    .where(broadcastAudienceWhere(audiences, now));
  return row?.value ?? 0;
}

export async function snapshotBroadcastRecipients(
  executor: Executor,
  broadcastId: number,
  audiences: readonly BroadcastAudience[],
  now = new Date(),
): Promise<number> {
  if (audiences.length === 0) return 0;
  const inserted = await executor.execute<{ id: string }>(sql`
    insert into ${scheduledBroadcastRecipients} (broadcast_id, user_id, updated_at)
    select ${broadcastId}, ${users.id}, ${now.toISOString()}::timestamptz
    from ${users}
    where ${broadcastAudienceWhere(audiences, now)}
    on conflict (broadcast_id, user_id) do nothing
    returning id
  `);
  return inserted.length;
}
