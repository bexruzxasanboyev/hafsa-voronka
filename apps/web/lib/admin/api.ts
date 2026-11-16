import {
  adminCreateUserResponseSchema,
  adminMeResponseSchema,
  adminStatsResponseSchema,
  adminUsersResponseSchema,
  type AdminIdentity,
  type AdminStatsResponse,
  type AdminUser,
} from "@funnel/shared";
import { API_URL } from "../api";

const TOKEN_KEY = "funnel_admin_token";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function authHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function adminLogin(
  username: string,
  password: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      credentials: "include",
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (data?.token) {
        setAdminToken(data.token);
      }
      return { ok: true, status: res.status };
    }

    return { ok: false, status: res.status, error: data?.error };
  } catch {
    return { ok: false, status: 500, error: "network_error" };
  }
}

export async function adminLogout(): Promise<{ ok: boolean }> {
  try {
    setAdminToken(null);
    const res = await fetch(`${API_URL}/admin/logout`, {
      method: "POST",
      headers: authHeaders(),
      credentials: "include",
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

export type AdminResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; status: number; error?: string };

async function adminRequest<T>(
  path: string,
  parse: (json: unknown) => T,
  init: { method?: string; body?: unknown } = {},
): Promise<AdminResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...authHeaders(),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, error: typeof data?.error === "string" ? data.error : undefined };
    }
    return { ok: true, data: parse(await res.json().catch(() => ({}))) };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

export async function adminMe(): Promise<AdminResult<AdminIdentity>> {
  const result = await adminRequest("/admin/me", (json) => adminMeResponseSchema.parse(json).admin);
  if (!result.ok && result.status === 401) setAdminToken(null);
  return result;
}

export const changeAdminPassword = (currentPassword: string, newPassword: string): Promise<AdminResult> =>
  adminRequest("/admin/account/password", () => undefined, {
    method: "POST",
    body: { currentPassword, newPassword },
  });

export async function listAdmins(): Promise<AdminResult<AdminUser[]>> {
  return adminRequest("/admin/admins", (json) => adminUsersResponseSchema.parse(json).admins);
}

export const createAdmin = (username: string, password: string): Promise<AdminResult<AdminUser>> =>
  adminRequest("/admin/admins", (json) => adminCreateUserResponseSchema.parse(json).admin, {
    method: "POST",
    body: { username: username.trim().toLowerCase(), password },
  });

export const deleteAdmin = (id: number): Promise<AdminResult> =>
  adminRequest(`/admin/admins/${encodeURIComponent(String(id))}`, () => undefined, { method: "DELETE" });

export async function fetchAdminStats(params: {
  from: string;
  to: string;
  source?: string;
  campaign?: string;
}): Promise<AdminStatsResponse> {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.source) query.set("source", params.source);
  if (params.campaign) query.set("campaign", params.campaign);

  const res = await fetch(`${API_URL}/admin/stats?${query.toString()}`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!res.ok) {
    throw new Error(`STATS_FAILED_${res.status}`);
  }

  const json = await res.json();
  return adminStatsResponseSchema.parse(json);
}

export function getLeadsCsvUrl(params: {
  from: string;
  to: string;
  source?: string;
  campaign?: string;
}): string {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.source) query.set("source", params.source);
  if (params.campaign) query.set("campaign", params.campaign);
  const token = getAdminToken();
  if (token) query.set("token", token);

  return `${API_URL}/admin/leads.csv?${query.toString()}`;
}
