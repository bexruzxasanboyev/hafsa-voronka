import {
  adminStatsResponseSchema,
  type AdminStatsResponse,
  type CampaignLinkItem,
  type PaymentsDashboardResponse,
  type SourceNetwork,
} from "@funnel/shared";
import { API_URL } from "@/lib/api";

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

export async function adminLogin(password: string): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
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

export async function adminMe(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/admin/me`, {
      method: "GET",
      headers: authHeaders(),
      credentials: "include",
    });
    if (res.status === 401) {
      setAdminToken(null);
    }
    return res.status === 200;
  } catch {
    return false;
  }
}

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

export async function fetchCampaignLinks(): Promise<CampaignLinkItem[]> {
  const res = await fetch(`${API_URL}/admin/campaign-links`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`CAMPAIGN_LINKS_${res.status}`);
  const json = await res.json();
  return (json.items ?? []) as CampaignLinkItem[];
}

export async function createCampaignLink(input: {
  code?: string;
  utm_source: string;
  utm_campaign?: string;
  utm_content?: string;
}): Promise<CampaignLinkItem> {
  const res = await fetch(`${API_URL}/admin/campaign-links`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `CREATE_LINK_${res.status}`);
  }
  return (await res.json()) as CampaignLinkItem;
}

export async function deleteCampaignLink(code: string): Promise<void> {
  const res = await fetch(`${API_URL}/admin/campaign-links/${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: authHeaders(),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
}

export async function fetchPaymentsDashboard(): Promise<PaymentsDashboardResponse> {
  const res = await fetch(`${API_URL}/admin/payments`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`PAYMENTS_${res.status}`);
  return (await res.json()) as PaymentsDashboardResponse;
}

export type LookupUserItem = {
  userId: number;
  telegramId: number;
  username: string | null;
  studentName: string;
  phone: string | null;
  sourceNetwork: SourceNetwork;
};

export async function lookupPaymentUsers(q: string): Promise<LookupUserItem[]> {
  const res = await fetch(`${API_URL}/admin/payments/lookup-user?q=${encodeURIComponent(q)}`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.items ?? []) as LookupUserItem[];
}

export async function createEnrollment(input: Record<string, unknown>): Promise<{ id: number }> {
  const res = await fetch(`${API_URL}/admin/payments/enrollments`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`CREATE_ENROLLMENT_${res.status}`);
  return (await res.json()) as { id: number };
}

export async function updateEnrollment(id: number, input: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_URL}/admin/payments/enrollments/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`UPDATE_ENROLLMENT_${res.status}`);
}

export async function deleteEnrollment(id: number): Promise<void> {
  const res = await fetch(`${API_URL}/admin/payments/enrollments/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
}

export async function addEnrollmentPayment(
  enrollmentId: number,
  input: { amount: number; paidAt?: string; note?: string | null },
): Promise<void> {
  const res = await fetch(`${API_URL}/admin/payments/enrollments/${enrollmentId}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`ADD_PAYMENT_${res.status}`);
}

export async function createPaymentCatalogItem(input: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_URL}/admin/payments/catalog`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`CATALOG_${res.status}`);
}
