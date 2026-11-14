import { z } from "zod";
import {
  type AdminSettings,
  adminSettingsSchema,
  type AdminSettingsUpdate,
  type BusinessConnectionItem,
  businessConnectionItemSchema,
  type BusinessConnectionsResponse,
  businessConnectionsResponseSchema,
} from "@funnel/shared";
import { API_URL } from "@/lib/api";
import { authHeaders } from "@/lib/admin/api";

export type SettingsResult = { ok: true; settings: AdminSettings } | { ok: false; status: number };

export type BusinessConnectionsResult =
  | { ok: true; data: BusinessConnectionsResponse }
  | { ok: false; status: number };

export type BusinessConnectionUpdateResult =
  | { ok: true; item: BusinessConnectionItem }
  | { ok: false; status: number };

const businessConnectionResponseSchema = z.object({
  item: businessConnectionItemSchema,
});

async function requestJson<T>(
  path: string,
  parse: (json: unknown) => T,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...authHeaders(),
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      credentials: "include",
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: parse(await res.json()) };
  } catch {
    return { ok: false, status: 0 };
  }
}

export const fetchSettings = async (): Promise<SettingsResult> => {
  const result = await requestJson("/admin/settings", (json) => adminSettingsSchema.parse(json));
  return result.ok ? { ok: true, settings: result.data } : result;
};

export const saveSettings = async (input: AdminSettingsUpdate): Promise<SettingsResult> => {
  const result = await requestJson("/admin/settings", (json) => adminSettingsSchema.parse(json), {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return result.ok ? { ok: true, settings: result.data } : result;
};

export const fetchBusinessConnections = (): Promise<BusinessConnectionsResult> =>
  requestJson("/admin/settings/business-connections", (json) => businessConnectionsResponseSchema.parse(json));

export const setBusinessConnectionApproval = async (
  id: string,
  isApproved: boolean,
): Promise<BusinessConnectionUpdateResult> => {
  const result = await requestJson(
    `/admin/settings/business-connections/${encodeURIComponent(id)}`,
    (json) => businessConnectionResponseSchema.parse(json).item,
    {
      method: "PATCH",
      body: JSON.stringify({ isApproved }),
    },
  );
  return result.ok ? { ok: true, item: result.data } : result;
};
