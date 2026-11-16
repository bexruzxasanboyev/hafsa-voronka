import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { AdminUser } from "@funnel/shared";
import { db } from "@/db";
import { adminSessions, adminUsers, type AdminUserRow } from "@/db/schema";
import { env } from "@/env";
import { hashPassword, isValidPasswordHash, verifyPassword } from "@/admin/password";

type Database = ReturnType<typeof db>;

const BOOTSTRAP_LOCK_KEY = 7_204_312;

/**
 * Creates the first admin from a legacy `ADMIN_PASSWORD_HASH` when the table is empty.
 * Serialized with an advisory lock so concurrently booting processes insert at most one row.
 * Returns whether any admin exists afterwards.
 */
export async function bootstrapAdmin(
  seed: { username: string; passwordHash: string | undefined },
  database: Database = db(),
): Promise<boolean> {
  const created = await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);
    const [existing] = await tx.select({ id: adminUsers.id }).from(adminUsers).limit(1);
    if (existing) return null;
    if (!seed.passwordHash || !isValidPasswordHash(seed.passwordHash)) return undefined;
    const [row] = await tx
      .insert(adminUsers)
      .values({ username: seed.username, passwordHash: seed.passwordHash })
      .onConflictDoNothing()
      .returning({ username: adminUsers.username });
    return row ?? null;
  });
  if (created) {
    console.log(`Admin bootstrap: created admin "${created.username}" from ADMIN_PASSWORD_HASH`);
  } else if (created === undefined && seed.passwordHash) {
    console.warn("Admin bootstrap skipped: ADMIN_PASSWORD_HASH is not a valid scrypt hash");
  }
  return created !== undefined;
}

export function ensureAdminAccounts(): Promise<boolean> {
  return bootstrapAdmin({ username: env.ADMIN_USERNAME, passwordHash: env.ADMIN_PASSWORD_HASH });
}

export function toAdminUser(row: AdminUserRow, selfId: number): AdminUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    isSelf: row.id === selfId,
  };
}

export function findAdminByUsername(username: string) {
  return db().query.adminUsers.findFirst({ where: eq(adminUsers.username, username) });
}

export async function recordLogin(adminUserId: number) {
  await db().update(adminUsers).set({ lastLoginAt: sql`now()` }).where(eq(adminUsers.id, adminUserId));
}

export async function listAdmins(selfId: number): Promise<AdminUser[]> {
  const rows = await db().select().from(adminUsers).orderBy(asc(adminUsers.createdAt), asc(adminUsers.id));
  return rows.map((row) => toAdminUser(row, selfId));
}

export async function createAdmin(username: string, password: string): Promise<AdminUserRow | null> {
  const passwordHash = await hashPassword(password);
  const [row] = await db().insert(adminUsers).values({ username, passwordHash }).onConflictDoNothing().returning();
  return row ?? null;
}

export async function deleteAdmin(
  id: number,
): Promise<"deleted" | "not_found" | "last_admin"> {
  return db().transaction(async (tx) => {
    // Locking every admin row serializes concurrent deletes, so two of them can never both pass the count check.
    const rows = await tx.select({ id: adminUsers.id }).from(adminUsers).for("update");
    if (!rows.some((row) => row.id === id)) return "not_found";
    if (rows.length <= 1) return "last_admin";
    await tx.delete(adminUsers).where(eq(adminUsers.id, id));
    return "deleted";
  });
}

export async function changeAdminPassword(
  admin: { id: number; sessionId: number },
  currentPassword: string,
  newPassword: string,
): Promise<"changed" | "wrong_password" | "same_password"> {
  const row = await db().query.adminUsers.findFirst({ where: eq(adminUsers.id, admin.id) });
  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) return "wrong_password";
  if (newPassword === currentPassword) return "same_password";
  const passwordHash = await hashPassword(newPassword);
  await db().transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({ passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(adminUsers.id, admin.id));
    await tx
      .update(adminSessions)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(adminSessions.adminUserId, admin.id),
          ne(adminSessions.id, admin.sessionId),
          isNull(adminSessions.revokedAt),
        ),
      );
  });
  return "changed";
}

/** Recovery path behind `admin:reset-password`: upserts the admin and signs out all of their sessions. */
export async function resetAdminPassword(
  database: Database,
  username: string,
  password: string,
): Promise<{ username: string; created: boolean; revokedSessions: number }> {
  const passwordHash = await hashPassword(password);
  return database.transaction(async (tx) => {
    const [row] = await tx
      .insert(adminUsers)
      .values({ username, passwordHash })
      .onConflictDoUpdate({
        target: adminUsers.username,
        set: { passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` },
      })
      .returning({ id: adminUsers.id, created: sql<boolean>`(xmax = 0)` });
    const revoked = await tx
      .update(adminSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(adminSessions.adminUserId, row.id), isNull(adminSessions.revokedAt)))
      .returning({ id: adminSessions.id });
    return { username, created: row.created, revokedSessions: revoked.length };
  });
}
