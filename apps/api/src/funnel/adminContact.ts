import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessConnections } from "@/db/schema";

type Reader = Pick<ReturnType<typeof db>, "select">;

/**
 * Whether an admin-button click (users.channelClickAt) counts as "contacted admin" for the funnel:
 * it stops A/B/C reminders and moves the person to E. That holds only while no approved, enabled
 * Telegram Business connection exists, because without one a click is the only contact signal we get.
 * Once Business is live, only wroteAdminAt (a real business chat or a manual «Yozdi»/won mark) counts.
 *
 * The rule applies to decisions made from then on. People who only clicked and already moved to E stay
 * there (syncSegment keeps E sticky), and ended A/B/C runs are not reopened retroactively.
 * Evaluate once per dispatch tick or request and pass the result down.
 */
export async function clickCountsAsAdminContact(executor: Reader = db()): Promise<boolean> {
  const [live] = await executor
    .select({ one: sql<number>`1` })
    .from(businessConnections)
    .where(and(eq(businessConnections.isApproved, true), eq(businessConnections.isEnabled, true)))
    .limit(1);
  return live === undefined;
}
