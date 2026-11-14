import {
  campaignLinkItemSchema,
  campaignLinksResponseSchema,
  type CampaignLinkCreate,
  type CampaignLinkItem,
} from "@funnel/shared";
import { API_URL } from "@/lib/api";
import { authHeaders } from "@/lib/admin/api";

export async function fetchCampaignLinks(): Promise<CampaignLinkItem[]> {
  const res = await fetch(`${API_URL}/admin/links`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!res.ok) {
    throw new Error(`LINKS_FAILED_${res.status}`);
  }

  const json = await res.json();
  return campaignLinksResponseSchema.parse(json).items;
}

export async function createCampaignLink(
  input: CampaignLinkCreate,
): Promise<{ ok: true; item: CampaignLinkItem } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/links`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      credentials: "include",
    });
  } catch {
    return { ok: false, error: "generic" };
  }

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof json?.error === "string" ? json.error : "";
    if (res.status === 409 || code === "code_taken") {
      return { ok: false, error: "code_taken" };
    }
    if (res.status === 400 || code === "invalid_request") {
      return { ok: false, error: "invalid_request" };
    }
    return { ok: false, error: "generic" };
  }

  return { ok: true, item: campaignLinkItemSchema.parse(json?.item) };
}

export async function deleteCampaignLink(code: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/admin/links/${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: authHeaders(),
    credentials: "include",
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  return res.ok;
}
