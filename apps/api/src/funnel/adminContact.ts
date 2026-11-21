import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessConnections, integrationHeartbeats } from "@/db/schema";
import {
  HERMES_HEARTBEAT_NAME,
  HERMES_HEARTBEAT_TTL_MS,
} from "@/integrations/hermes/heartbeat";

export { HERMES_HEARTBEAT_TTL_MS };

type Reader = Pick<ReturnType<typeof db>, "select">;

/**
 * Whether an admin-button click (users.channelClickAt) counts as "contacted admin" for the funnel:
 * it stops A/B/C reminders and moves the person to E. That holds only while no real chat source is
 * live — i.e. no approved, enabled Telegram Business connection exists AND no Hermes heartbeat was
 * seen within the last HERMES_HEARTBEAT_TTL_MS (10 minutes). Once either source is live, only
 * wroteAdminAt (a real chat or a manual «Yozdi»/won mark) counts.
 *
 * The rule applies to decisions made from then on. People who only clicked and already moved to E stay
 * there (syncSegment keeps E sticky), and ended A/B/C runs are not reopened retroactively.
 * Evaluate once per dispatch tick or request and pass the result down.
 */
export async function clickCountsAsAdminContact(executor: Reader = db()): Promise<boolean> {
  const [liveBusiness] = await executor
    .select({ one: sql<number>`1` })
    .from(businessConnections)
    .where(and(eq(businessConnections.isApproved, true), eq(businessConnections.isEnabled, true)))
    .limit(1);
  if (liveBusiness !== undefined) return false;

  const ttlSec = Math.floor(HERMES_HEARTBEAT_TTL_MS / 1000);
  const [liveHermes] = await executor
    .select({ one: sql<number>`1` })
    .from(integrationHeartbeats)
    .where(
      and(
        eq(integrationHeartbeats.name, HERMES_HEARTBEAT_NAME),
        sql`${integrationHeartbeats.lastSeenAt} >= now() - (${ttlSec}::int * interval '1 second')`,
      ),
    )
    .limit(1);
  return liveHermes === undefined;
}
