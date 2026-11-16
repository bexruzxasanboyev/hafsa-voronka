import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, ne, notInArray, sql } from "drizzle-orm";
import {
  adminCreateUserResponseSchema,
  adminLoginResponseSchema,
  adminMeResponseSchema,
  adminUsersResponseSchema,
} from "@funnel/shared";
import { closeDb, db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { adminSessions, adminUsers, rateLimits } from "@/db/schema";
import { setTestEnv } from "@/test/env";
import { isolatedDatabase } from "@/test/isolatedDb";
import { bootstrapAdmin, deleteAdmin, resetAdminPassword } from "./accounts";
import { hashSessionToken } from "./auth";
import { hashPassword } from "./password";

const isolatedDb = isolatedDatabase("vf_admin_accounts");
const BOOT_PASSWORD = "bootstrap-password-2026";

describe.skipIf(!isolatedDb.url)("Admin accounts and sessions", () => {
  let app: ReturnType<typeof import("@/app").createApp>;
  let ipSeq = 0;
  const nextIp = () => `203.0.113.${++ipSeq}`;

  async function call(path: string, init: { method?: string; token?: string; body?: unknown; ip?: string } = {}) {
    const res = await app.request(path, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": init.ip ?? nextIp(),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { res, status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> };
  }

  const login = (username: string, password: string, ip?: string) =>
    call("/admin/login", { method: "POST", body: { username, password }, ip });

  async function loginToken(username: string, password: string) {
    const { status, json } = await login(username, password);
    expect(status).toBe(200);
    return json.token as string;
  }

  const meStatus = async (token: string) => (await call("/admin/me", { token })).status;

  beforeAll(async () => {
    await isolatedDb.create();
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_USERNAME;
    setTestEnv({ DATABASE_URL: isolatedDb.url! });
    await runMigrations(isolatedDb.url!);
    app = (await import("@/app")).createApp();
  });

  beforeEach(async () => {
    await db().delete(rateLimits);
  });

  afterAll(async () => {
    await closeDb();
    await isolatedDb.drop();
  });

  describe("bootstrap", () => {
    it("reports admin_disabled while there are no admins and no hash to bootstrap", async () => {
      expect(await bootstrapAdmin({ username: "admin", passwordHash: undefined })).toBe(false);
      expect(await bootstrapAdmin({ username: "admin", passwordHash: "not-a-hash" })).toBe(false);
      const { status, json } = await login("admin", BOOT_PASSWORD);
      expect(status).toBe(503);
      expect(json).toEqual({ error: "admin_disabled" });
      expect(await db().select().from(adminUsers)).toHaveLength(0);
    });

    it("creates exactly one admin from the legacy hash, even when processes race", async () => {
      const hash = await hashPassword(BOOT_PASSWORD);
      const results = await Promise.all([
        bootstrapAdmin({ username: "admin", passwordHash: hash }),
        bootstrapAdmin({ username: "admin", passwordHash: hash }),
        bootstrapAdmin({ username: "other", passwordHash: hash }),
      ]);
      expect(results).toEqual([true, true, true]);
      const rows = await db().select().from(adminUsers);
      expect(rows).toHaveLength(1);

      // Once an admin exists the env hash is ignored.
      expect(await bootstrapAdmin({ username: "admin", passwordHash: await hashPassword("ignored-password-1") })).toBe(true);
      const after = await db().select().from(adminUsers);
      expect(after).toEqual(rows);

      expect((await login("admin", BOOT_PASSWORD)).status).toBe(200);
    });
  });

  describe("login, me, logout", () => {
    it("logs in, sets the session cookie and records last_login_at", async () => {
      const { res, status, json } = await login("ADMIN", BOOT_PASSWORD);
      expect(status).toBe(200);
      const body = adminLoginResponseSchema.parse(json);
      expect(body.admin.username).toBe("admin");
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const cookie = res.headers.get("set-cookie")!;
      expect(cookie).toContain(`admin_session=${body.token}`);
      for (const flag of ["HttpOnly", "SameSite=None", "Secure", "Path=/", "Max-Age=604800"]) {
        expect(cookie).toContain(flag);
      }

      const [session] = await db()
        .select()
        .from(adminSessions)
        .where(eq(adminSessions.tokenHash, hashSessionToken(body.token)));
      expect(session.adminUserId).toBe(body.admin.id);
      expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
      const [admin] = await db().select().from(adminUsers).where(eq(adminUsers.id, body.admin.id));
      expect(admin.lastLoginAt).not.toBeNull();
    });

    it("rejects wrong passwords, unknown users and malformed bodies", async () => {
      expect(await login("admin", "wrong-password")).toMatchObject({ status: 401, json: { error: "invalid_credentials" } });
      expect(await login("nobody", BOOT_PASSWORD)).toMatchObject({ status: 401, json: { error: "invalid_credentials" } });
      const legacy = await call("/admin/login", { method: "POST", body: { password: BOOT_PASSWORD } });
      expect(legacy).toMatchObject({ status: 400, json: { error: "invalid_request" } });
    });

    it("rate limits per IP and per username", async () => {
      const ip = nextIp();
      for (let i = 0; i < 5; i++) expect((await login("admin", "wrong-password", ip)).status).toBe(401);
      expect(await login("admin", BOOT_PASSWORD, ip)).toMatchObject({ status: 429, json: { error: "rate_limited" } });

      for (let i = 0; i < 10; i++) expect((await login("target-user", "wrong-password")).status).toBe(401);
      expect(await login("target-user", "wrong-password")).toMatchObject({ status: 429, json: { error: "rate_limited" } });
    });

    it("serves /me over Bearer, query token and cookie, but not the dropped x-admin-session header", async () => {
      const { res, json } = await login("admin", BOOT_PASSWORD);
      const token = json.token as string;
      const me = await call("/admin/me", { token });
      expect(me.status).toBe(200);
      expect(adminMeResponseSchema.parse(me.json).admin.username).toBe("admin");

      expect((await app.request(`/admin/me?token=${token}`)).status).toBe(200);
      const cookie = res.headers.get("set-cookie")!.split(";")[0];
      expect((await app.request("/admin/me", { headers: { cookie } })).status).toBe(200);
      expect((await app.request("/admin/me", { headers: { "x-admin-session": token } })).status).toBe(401);
      expect(await call("/admin/me")).toMatchObject({ status: 401, json: { error: "unauthorized" } });
      expect(await meStatus("garbage")).toBe(401);
    });

    it("logout revokes the presented session and clears the cookie", async () => {
      const token = await loginToken("admin", BOOT_PASSWORD);
      const other = await loginToken("admin", BOOT_PASSWORD);
      const logout = await call("/admin/logout", { method: "POST", token });
      expect(logout).toMatchObject({ status: 200, json: { ok: true } });
      expect(logout.res.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(await meStatus(token)).toBe(401);
      expect((await call("/admin/admins", { token })).status).toBe(401);
      expect(await meStatus(other)).toBe(200);

      expect(await call("/admin/logout", { method: "POST" })).toMatchObject({ status: 200, json: { ok: true } });
    });

    it("rejects expired and revoked sessions", async () => {
      const expired = await loginToken("admin", BOOT_PASSWORD);
      const revoked = await loginToken("admin", BOOT_PASSWORD);
      await db()
        .update(adminSessions)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(adminSessions.tokenHash, hashSessionToken(expired)));
      await db()
        .update(adminSessions)
        .set({ revokedAt: sql`now()` })
        .where(eq(adminSessions.tokenHash, hashSessionToken(revoked)));
      expect(await meStatus(expired)).toBe(401);
      expect(await meStatus(revoked)).toBe(401);
    });

    it("touches last_seen_at at most every few minutes", async () => {
      const token = await loginToken("admin", BOOT_PASSWORD);
      const byToken = eq(adminSessions.tokenHash, hashSessionToken(token));
      const lastSeen = async () => (await db().select().from(adminSessions).where(byToken))[0].lastSeenAt.getTime();

      const fresh = await lastSeen();
      await meStatus(token);
      expect(await lastSeen()).toBe(fresh);

      await db().update(adminSessions).set({ lastSeenAt: sql`now() - interval '10 minutes'` }).where(byToken);
      const stale = await lastSeen();
      await meStatus(token);
      expect(await lastSeen()).toBeGreaterThan(stale + 9 * 60 * 1000);
    });
  });

  describe("change password", () => {
    const PASSWORD = "change-me-password-1";
    const NEXT = "changed-password-2026";

    it("validates, verifies the current password, and revokes other sessions only", async () => {
      await resetAdminPassword(db(), "changer", PASSWORD);
      const current = await loginToken("changer", PASSWORD);
      const other = await loginToken("changer", PASSWORD);
      const change = (body: unknown) => call("/admin/account/password", { method: "POST", token: current, body });

      expect(await change({ currentPassword: PASSWORD })).toMatchObject({ status: 400, json: { error: "invalid_request" } });
      expect(await change({ currentPassword: PASSWORD, newPassword: "short" })).toMatchObject({
        status: 400,
        json: { error: "weak_password" },
      });
      expect(await change({ currentPassword: PASSWORD, newPassword: PASSWORD })).toMatchObject({
        status: 400,
        json: { error: "weak_password" },
      });
      expect(await change({ currentPassword: "not-the-password", newPassword: NEXT })).toMatchObject({
        status: 401,
        json: { error: "wrong_password" },
      });
      expect(await meStatus(other)).toBe(200);

      expect(await change({ currentPassword: PASSWORD, newPassword: NEXT })).toMatchObject({ status: 200, json: { ok: true } });
      expect(await meStatus(current)).toBe(200);
      expect(await meStatus(other)).toBe(401);
      expect((await login("changer", PASSWORD)).status).toBe(401);
      expect((await login("changer", NEXT)).status).toBe(200);

      const [row] = await db().select().from(adminUsers).where(eq(adminUsers.username, "changer"));
      expect(row.passwordChangedAt.getTime()).toBeGreaterThan(row.createdAt.getTime());
    });

    it("rate limits password attempts per admin", async () => {
      await resetAdminPassword(db(), "guesser", PASSWORD);
      const token = await loginToken("guesser", PASSWORD);
      for (let i = 0; i < 5; i++) {
        const { status } = await call("/admin/account/password", {
          method: "POST",
          token,
          body: { currentPassword: `guess-${i}`, newPassword: NEXT },
        });
        expect(status).toBe(401);
      }
      expect(
        await call("/admin/account/password", { method: "POST", token, body: { currentPassword: PASSWORD, newPassword: NEXT } }),
      ).toMatchObject({ status: 429, json: { error: "rate_limited" } });
    });
  });

  describe("admins management", () => {
    let token: string;
    beforeAll(async () => {
      token = await loginToken("admin", BOOT_PASSWORD);
    });

    it("lists admins oldest first with isSelf", async () => {
      const { status, json } = await call("/admin/admins", { token });
      expect(status).toBe(200);
      const { admins } = adminUsersResponseSchema.parse(json);
      expect(admins[0]).toMatchObject({ username: "admin", isSelf: true });
      expect(admins.filter((admin) => admin.isSelf)).toHaveLength(1);
      expect(new Date(admins[0].createdAt).toISOString()).toBe(admins[0].createdAt);
      expect(admins[0].lastLoginAt).not.toBeNull();
      const created = admins.map((admin) => admin.createdAt);
      expect([...created].sort()).toEqual(created);
    });

    it("creates admins and maps validation errors to specific codes", async () => {
      const create = (body: unknown) => call("/admin/admins", { method: "POST", token, body });

      const created = await create({ username: "  New.User ", password: "new-user-password" });
      expect(created.status).toBe(201);
      const { admin } = adminCreateUserResponseSchema.parse(created.json);
      expect(admin).toMatchObject({ username: "new.user", isSelf: false, lastLoginAt: null });
      expect((await login("new.user", "new-user-password")).status).toBe(200);

      expect(await create({ username: "NEW.USER", password: "another-password" })).toMatchObject({
        status: 409,
        json: { error: "username_taken" },
      });
      expect(await create({ username: "ab", password: "valid-password-1" })).toMatchObject({
        status: 400,
        json: { error: "invalid_username" },
      });
      expect(await create({ username: "has space", password: "valid-password-1" })).toMatchObject({
        status: 400,
        json: { error: "invalid_username" },
      });
      expect(await create({ username: "weakling", password: "short" })).toMatchObject({
        status: 400,
        json: { error: "weak_password" },
      });
      expect(await create({ username: "ab", password: "short" })).toMatchObject({
        status: 400,
        json: { error: "invalid_username" },
      });
      expect(await create({ username: "solo" })).toMatchObject({ status: 400, json: { error: "invalid_request" } });
      expect(await create(null)).toMatchObject({ status: 400, json: { error: "invalid_request" } });
      expect((await call("/admin/admins", { method: "POST", body: { username: "anon", password: "x".repeat(12) } })).status).toBe(401);
    });

    it("deletes other admins and their sessions, but never self or a missing admin", async () => {
      const [self] = await db().select().from(adminUsers).where(eq(adminUsers.username, "admin"));
      expect(await call(`/admin/admins/${self.id}`, { method: "DELETE", token })).toMatchObject({
        status: 400,
        json: { error: "cannot_delete_self" },
      });
      expect(await call("/admin/admins/999999", { method: "DELETE", token })).toMatchObject({
        status: 404,
        json: { error: "not_found" },
      });
      expect((await call("/admin/admins/abc", { method: "DELETE", token })).status).toBe(404);

      await resetAdminPassword(db(), "victim", "victim-password-1");
      const victimToken = await loginToken("victim", "victim-password-1");
      const [victim] = await db().select().from(adminUsers).where(eq(adminUsers.username, "victim"));
      expect(await call(`/admin/admins/${victim.id}`, { method: "DELETE", token })).toMatchObject({
        status: 200,
        json: { ok: true },
      });
      expect(await meStatus(victimToken)).toBe(401);
      expect(await db().select().from(adminSessions).where(eq(adminSessions.adminUserId, victim.id))).toHaveLength(0);
    });

    it("keeps the last admin even when two admins delete each other concurrently", async () => {
      await resetAdminPassword(db(), "rival", "rival-password-1");
      await db().delete(adminUsers).where(notInArray(adminUsers.username, ["admin", "rival"]));
      const rivalToken = await loginToken("rival", "rival-password-1");
      const ids = Object.fromEntries((await db().select().from(adminUsers)).map((row) => [row.username, row.id]));

      const results = await Promise.all([
        call(`/admin/admins/${ids.rival}`, { method: "DELETE", token }),
        call(`/admin/admins/${ids.admin}`, { method: "DELETE", token: rivalToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.json).toEqual({ error: "last_admin" });

      const remaining = await db().select().from(adminUsers);
      expect(remaining).toHaveLength(1);
      expect(await deleteAdmin(remaining[0].id)).toBe("last_admin");
    });
  });

  describe("reset-password CLI core", () => {
    it("creates a missing admin, then resets the password and revokes every session", async () => {
      const first = await resetAdminPassword(db(), "rescue", "rescue-password-1");
      expect(first).toEqual({ username: "rescue", created: true, revokedSessions: 0 });

      const a = await loginToken("rescue", "rescue-password-1");
      const b = await loginToken("rescue", "rescue-password-1");
      const second = await resetAdminPassword(db(), "rescue", "rescue-password-2");
      expect(second).toEqual({ username: "rescue", created: false, revokedSessions: 2 });

      expect(await meStatus(a)).toBe(401);
      expect(await meStatus(b)).toBe(401);
      expect((await login("rescue", "rescue-password-1")).status).toBe(401);
      expect((await login("rescue", "rescue-password-2")).status).toBe(200);
      const others = await db().select().from(adminUsers).where(ne(adminUsers.username, "rescue"));
      expect(others.length).toBeGreaterThan(0);
    });
  });
});
