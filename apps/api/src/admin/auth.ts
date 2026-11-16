import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AdminIdentity } from "@funnel/shared";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { env } from "@/env";
import { ensureAdminAccounts } from "@/admin/accounts";

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;
export const COOKIE_NAME = "admin_session";

export type AdminEnv = {
  Variables: {
    admin: AdminIdentity;
    adminSessionId: number;
  };
};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAdminSession(adminUserId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db()
    .insert(adminSessions)
    .values({
      adminUserId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    });
  return token;
}

/** Tokens the client presented, in priority order: Bearer header, `?token=` (file downloads), cookie. */
function presentedTokens(c: Context): string[] {
  const tokens: string[] = [];
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) tokens.push(authHeader.slice(7).trim());
  const queryToken = c.req.query("token");
  if (queryToken) tokens.push(queryToken.trim());
  const cookie = getCookie(c, COOKIE_NAME);
  if (cookie) tokens.push(cookie);
  return [...new Set(tokens.filter(Boolean))];
}

async function findSession(token: string) {
  const [row] = await db()
    .select({
      sessionId: adminSessions.id,
      lastSeenAt: adminSessions.lastSeenAt,
      id: adminUsers.id,
      username: adminUsers.username,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(
      and(
        eq(adminSessions.tokenHash, hashSessionToken(token)),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return row;
}

export async function resolveAdminSession(
  c: Context,
): Promise<{ admin: AdminIdentity; sessionId: number } | null> {
  for (const token of presentedTokens(c)) {
    const row = await findSession(token);
    if (!row) continue;
    if (Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      await db()
        .update(adminSessions)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(adminSessions.id, row.sessionId));
    }
    return { admin: { id: row.id, username: row.username }, sessionId: row.sessionId };
  }
  return null;
}

/** Revokes every session whose token the request presented. */
export async function revokePresentedSessions(c: Context): Promise<void> {
  const hashes = presentedTokens(c).map(hashSessionToken);
  if (hashes.length === 0) return;
  await db()
    .update(adminSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(inArray(adminSessions.tokenHash, hashes), isNull(adminSessions.revokedAt)));
}

let adminsExist = false;

/**
 * 503 `admin_disabled` while no admin account exists (and none can be bootstrapped from env).
 * Once an admin is seen the result is cached: the last admin can never be deleted through the API.
 */
export const requireAdminConfig = createMiddleware(async (c, next) => {
  if (!adminsExist) {
    adminsExist = await ensureAdminAccounts();
    if (!adminsExist) return c.json({ error: "admin_disabled" }, 503);
  }
  return next();
});

export const requireAdminAuth = createMiddleware<AdminEnv>(async (c, next) => {
  const session = await resolveAdminSession(c);
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("admin", session.admin);
  c.set("adminSessionId", session.sessionId);
  return next();
});

function cookieFlags() {
  const isHttps = env.API_URL.startsWith("https");
  return { path: "/", secure: isHttps, sameSite: isHttps ? "None" : "Lax" } as const;
}

export function setAdminSessionCookie(c: Context, token: string): void {
  setCookie(c, COOKIE_NAME, token, { ...cookieFlags(), httpOnly: true, maxAge: SESSION_MAX_AGE_SECONDS });
}

export function clearAdminSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, cookieFlags());
}
