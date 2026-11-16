import { Hono } from "hono";
import { adminChangePasswordRequestSchema, adminCreateUserRequestSchema } from "@funnel/shared";
import {
  changeAdminPassword,
  createAdmin,
  deleteAdmin,
  listAdmins,
  toAdminUser,
} from "@/admin/accounts";
import { type AdminEnv, requireAdminAuth } from "@/admin/auth";
import { consumeRateLimit } from "@/http/rateLimit";

/** Mounted at the admin root, so every route carries its own `requireAdminAuth` (not `use("*")`, which would cover /login). */
export const adminAccountRoutes = new Hono<AdminEnv>();

type Issues = { issues: { path: PropertyKey[] }[] };

/**
 * The first rejected field when every rejected field was sent as a string (a malformed username, a too-short password);
 * undefined when the body is structurally wrong (missing fields, wrong types), which stays `invalid_request`.
 */
function rejectedStringField(body: unknown, error: Issues): string | undefined {
  const fields = error.issues.map((issue) => issue.path[0]);
  const sent = (field: PropertyKey | undefined) =>
    typeof field === "string" && typeof (body as Record<string, unknown> | null)?.[field] === "string";
  return fields.every(sent) ? (fields[0] as string) : undefined;
}

adminAccountRoutes.post("/account/password", requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = adminChangePasswordRequestSchema.safeParse(body);
  if (!parsed.success) {
    const weak = rejectedStringField(body, parsed.error) === "newPassword";
    return c.json({ error: weak ? "weak_password" : "invalid_request" }, 400);
  }

  const admin = c.get("admin");
  if (!(await consumeRateLimit(`password-change:${admin.id}`, 5, 900))) {
    return c.json({ error: "rate_limited" }, 429);
  }

  const result = await changeAdminPassword(
    { id: admin.id, sessionId: c.get("adminSessionId") },
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (result === "wrong_password") return c.json({ error: "wrong_password" }, 401);
  if (result === "same_password") return c.json({ error: "weak_password" }, 400);
  return c.json({ ok: true });
});

adminAccountRoutes.get("/admins", requireAdminAuth, async (c) => {
  return c.json({ admins: await listAdmins(c.get("admin").id) });
});

adminAccountRoutes.post("/admins", requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = adminCreateUserRequestSchema.safeParse(body);
  if (!parsed.success) {
    const field = rejectedStringField(body, parsed.error);
    const error = field === "username" ? "invalid_username" : field === "password" ? "weak_password" : "invalid_request";
    return c.json({ error }, 400);
  }

  const row = await createAdmin(parsed.data.username, parsed.data.password);
  if (!row) return c.json({ error: "username_taken" }, 409);
  return c.json({ admin: toAdminUser(row, c.get("admin").id) }, 201);
});

adminAccountRoutes.delete("/admins/:id", requireAdminAuth, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "not_found" }, 404);
  if (id === c.get("admin").id) return c.json({ error: "cannot_delete_self" }, 400);

  const result = await deleteAdmin(id);
  if (result === "not_found") return c.json({ error: "not_found" }, 404);
  if (result === "last_admin") return c.json({ error: "last_admin" }, 409);
  return c.json({ ok: true });
});
