import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/telegram", () => ({ readMessageRef: () => null, readStartMode: () => null }));

import { adminUz } from "../i18n/admin";
import {
  adminCreateFormError,
  adminsErrorMessage,
  formatAdminDate,
  formatAdminDateTime,
  loginErrorMessage,
  passwordChangeErrorMessage,
  validatePasswordChange,
} from "./accounts";
import { adminLogin, adminMe, changeAdminPassword, createAdmin, deleteAdmin, listAdmins } from "./api";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account helpers", () => {
  it("maps login errors", () => {
    expect(loginErrorMessage({ status: 401, error: "invalid_credentials" })).toBe(adminUz.login.errors.wrongCredentials);
    expect(loginErrorMessage({ status: 429, error: "rate_limited" })).toBe(adminUz.login.errors.rateLimited);
    expect(loginErrorMessage({ status: 500, error: "network_error" })).toBe(adminUz.login.errors.generic);
  });

  it("validates password changes", () => {
    expect(validatePasswordChange("old", "short", "short")).toBe("tooShort");
    expect(validatePasswordChange("old", "longenough1", "different11")).toBe("mismatch");
    expect(validatePasswordChange("longenough1", "longenough1", "longenough1")).toBe("same");
    expect(validatePasswordChange("old", "longenough1", "longenough1")).toBeNull();
  });

  it("maps server error codes", () => {
    expect(passwordChangeErrorMessage("wrong_password")).toBe(adminUz.settings.account.errors.wrong_password);
    expect(passwordChangeErrorMessage("boom")).toBe(adminUz.settings.account.errors.generic);
    expect(adminsErrorMessage("username_taken")).toBe(adminUz.settings.admins.errors.username_taken);
    expect(adminsErrorMessage("last_admin")).toBe(adminUz.settings.admins.errors.last_admin);
    expect(adminsErrorMessage(undefined)).toBe(adminUz.settings.admins.errors.generic);
    expect(adminsErrorMessage("weak_password")).not.toContain("{min}");
  });

  it("validates new admin form", () => {
    expect(adminCreateFormError("ab", "longenough1")).not.toBeNull();
    expect(adminCreateFormError("Bad Name", "longenough1")).not.toBeNull();
    expect(adminCreateFormError("Good.Name", "short")).not.toBeNull();
    expect(adminCreateFormError("Good.Name", "longenough1")).toBeNull();
  });

  it("formats dates in Tashkent time", () => {
    expect(formatAdminDate("2026-10-24T20:30:00.000Z")).toBe("25.10.2026");
    expect(formatAdminDateTime("2026-10-24T20:30:00.000Z")).toBe("25.10.2026 01:30");
  });
});

describe("admin api client", () => {
  it("adminLogin sends lowercased username and stores the token", async () => {
    const fn = mockFetch(200, { ok: true, token: "tok", admin: { id: 1, username: "ali" } });
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("localStorage", storage);
    const result = await adminLogin(" Ali ", "pw");
    expect(result.ok).toBe(true);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/admin\/login$/);
    expect(JSON.parse(init.body as string)).toEqual({ username: "ali", password: "pw" });
    expect(store.get("funnel_admin_token")).toBe("tok");
  });

  it("adminLogin surfaces error codes", async () => {
    mockFetch(401, { error: "invalid_credentials" });
    expect(await adminLogin("a", "b")).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
  });

  it("adminMe parses the identity", async () => {
    mockFetch(200, { ok: true, admin: { id: 2, username: "bob" } });
    expect(await adminMe()).toEqual({ ok: true, data: { id: 2, username: "bob" } });
  });

  it("adminMe reports 401", async () => {
    mockFetch(401, { error: "unauthorized" });
    expect(await adminMe()).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("changeAdminPassword posts both passwords", async () => {
    const fn = mockFetch(200, { ok: true });
    expect((await changeAdminPassword("old", "newpassword1")).ok).toBe(true);
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ currentPassword: "old", newPassword: "newpassword1" });
  });

  it("changeAdminPassword surfaces wrong_password", async () => {
    mockFetch(401, { error: "wrong_password" });
    expect(await changeAdminPassword("x", "newpassword1")).toEqual({ ok: false, status: 401, error: "wrong_password" });
  });

  it("listAdmins parses the list", async () => {
    const admin = { id: 1, username: "ali", createdAt: "2026-01-01T00:00:00Z", lastLoginAt: null, isSelf: true };
    mockFetch(200, { admins: [admin] });
    expect(await listAdmins()).toEqual({ ok: true, data: [admin] });
  });

  it("createAdmin posts and parses, surfacing 409", async () => {
    const admin = { id: 3, username: "new", createdAt: "2026-01-01T00:00:00Z", lastLoginAt: null, isSelf: false };
    const fn = mockFetch(201, { admin });
    expect(await createAdmin("New", "longenough1")).toEqual({ ok: true, data: admin });
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ username: "new", password: "longenough1" });
    mockFetch(409, { error: "username_taken" });
    expect(await createAdmin("new", "longenough1")).toEqual({ ok: false, status: 409, error: "username_taken" });
  });

  it("deleteAdmin uses DELETE and surfaces codes", async () => {
    const fn = mockFetch(200, { ok: true });
    expect((await deleteAdmin(5)).ok).toBe(true);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/admin\/admins\/5$/);
    expect(init.method).toBe("DELETE");
    mockFetch(409, { error: "last_admin" });
    expect(await deleteAdmin(5)).toEqual({ ok: false, status: 409, error: "last_admin" });
  });

  it("network failures map to network_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await listAdmins()).toEqual({ ok: false, status: 0, error: "network_error" });
  });
});
