import type { z } from "zod";
import {
  type BroadcastAudience,
  type BroadcastInput,
  broadcastPreviewResponseSchema,
  type BroadcastsResponse,
  broadcastsResponseSchema,
  type ScheduledBroadcast,
  scheduledBroadcastSchema,
  templateMediaUploadSchema,
} from "@funnel/shared";
import { API_URL } from "@/lib/api";
import { authHeaders } from "@/lib/admin/api";

export type BroadcastsResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error?: string; variable?: string };

async function call<T>(
  path: string,
  parse: (json: unknown) => T,
  init: RequestInit = {},
): Promise<BroadcastsResult<T>> {
  try {
    const res = await fetch(`${API_URL}/admin/broadcasts${path}`, {
      ...init,
      headers: {
        ...authHeaders(),
        ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string>),
      },
      credentials: "include",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: json?.error, variable: json?.variable };
    return { ok: true, data: parse(json) };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

function parseSingleBroadcast(json: unknown): ScheduledBroadcast {
  const payload =
    json && typeof json === "object" && "broadcast" in json ? (json as { broadcast: unknown }).broadcast : json;
  return scheduledBroadcastSchema.parse(payload);
}

export function fetchBroadcasts() {
  return call("", (json): BroadcastsResponse => broadcastsResponseSchema.parse(json));
}

export function previewBroadcast(audiences: BroadcastAudience[], signal?: AbortSignal) {
  return call(
    "/preview",
    (json) => broadcastPreviewResponseSchema.parse(json).count,
    { method: "POST", body: JSON.stringify({ audiences }), signal },
  );
}

export function uploadBroadcastMedia(file: File) {
  const form = new FormData();
  form.append("file", file);
  return call(
    "/media",
    (json): z.infer<typeof templateMediaUploadSchema> => templateMediaUploadSchema.parse(json),
    { method: "POST", body: form },
  );
}

export function createBroadcast(input: BroadcastInput) {
  return call("", parseSingleBroadcast, { method: "POST", body: JSON.stringify(input) });
}

export function updateBroadcast(id: number, input: BroadcastInput) {
  return call(`/${id}`, parseSingleBroadcast, { method: "PUT", body: JSON.stringify(input) });
}

export function cancelBroadcast(id: number) {
  return call(`/${id}/cancel`, parseSingleBroadcast, { method: "POST" });
}

export function broadcastMediaUrl(item: Pick<ScheduledBroadcast, "id" | "updatedAt">) {
  return `${API_URL}/admin/broadcasts/${item.id}/media?v=${encodeURIComponent(item.updatedAt)}`;
}
