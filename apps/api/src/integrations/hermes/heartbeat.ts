import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { integrationHeartbeats } from "@/db/schema";

export const HERMES_HEARTBEAT_NAME = "hermes";
export const HERMES_HEARTBEAT_TTL_MS = 10 * 60_000;

type Reader = Pick<ReturnType<typeof db>, "select">;
type Writer = Pick<ReturnType<typeof db>, "insert">;

export async function touchHermesHeartbeat(executor: Writer = db()): Promise<Date> {
  const [row] = await executor
    .insert(integrationHeartbeats)
    .values({
      name: HERMES_HEARTBEAT_NAME,
      lastSeenAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: integrationHeartbeats.name,
      set: {
        lastSeenAt: sql`greatest(${integrationHeartbeats.lastSeenAt}, now())`,
      },
    })
    .returning({ lastSeenAt: integrationHeartbeats.lastSeenAt });
  return row.lastSeenAt;
}

export async function getHermesHeartbeat(
  executor: Reader = db(),
): Promise<{ lastSeenAt: Date | null; live: boolean }> {
  const ttlSec = Math.floor(HERMES_HEARTBEAT_TTL_MS / 1000);
  const [row] = await executor
    .select({
      lastSeenAt: integrationHeartbeats.lastSeenAt,
      live: sql<boolean>`${integrationHeartbeats.lastSeenAt} >= now() - (${ttlSec}::int * interval '1 second')`,
    })
    .from(integrationHeartbeats)
    .where(eq(integrationHeartbeats.name, HERMES_HEARTBEAT_NAME))
    .limit(1);

  if (!row) {
    return { lastSeenAt: null, live: false };
  }
  return {
    lastSeenAt: row.lastSeenAt,
    live: Boolean(row.live),
  };
}
