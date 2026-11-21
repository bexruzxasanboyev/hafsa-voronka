import {
  hermesPaymentsResponseSchema,
  hermesStatusResponseSchema,
  type HermesPaymentKind,
  type HermesPaymentsResponse,
  type HermesStatusResponse,
} from "@funnel/shared";
import { authHeaders } from "@/lib/admin/api";
import { API_URL } from "@/lib/api";
import { formatDate } from "./dates";
import { adminUz } from "../i18n/admin";

export type HermesKindTone = "success" | "info" | "muted";

const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

export function hermesConfidenceLabel(confidence: string): string {
  const map = adminUz.payments.hermes.confidence;
  if (Object.prototype.hasOwnProperty.call(map, confidence)) {
    return map[confidence];
  }
  return confidence;
}

export function hermesKindTone(kind: HermesPaymentKind): HermesKindTone {
  if (kind === "paid") return "success";
  if (kind === "deposit") return "info";
  return "muted";
}

export function resolveHermesPayDate(payDate: string | null, hermesCreatedAt: string): string {
  const raw = payDate?.trim() || hermesCreatedAt.trim();
  if (!raw) return "—";
  const match = ISO_DATE_PREFIX.exec(raw);
  if (match) {
    return formatDate(match[1]);
  }
  return raw;
}

export function formatHermesRelativeTime(lastSeenAt: string | null, now: Date = new Date()): string {
  const copy = adminUz.payments.hermes.status;
  if (!lastSeenAt) return copy.never;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return lastSeenAt;

  const diffSeconds = Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
  if (diffSeconds < 60) return copy.justNow;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return copy.minutesAgo.replace("{n}", String(diffMinutes));
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return copy.hoursAgo.replace("{n}", String(diffHours));
  }

  const diffDays = Math.floor(diffHours / 24);
  return copy.daysAgo.replace("{n}", String(diffDays));
}

async function requestHermesJson(path: string): Promise<unknown> {
  const res = await fetch(`${API_URL}/admin/hermes${path}`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!res.ok) {
    throw new Error(`HERMES_REQUEST_FAILED_${res.status}`);
  }

  return res.json();
}

export async function fetchHermesStatus(): Promise<HermesStatusResponse> {
  const json = await requestHermesJson("/status");
  return hermesStatusResponseSchema.parse(json);
}

export async function fetchHermesPayments(params?: {
  kind?: HermesPaymentKind;
  limit?: number;
}): Promise<HermesPaymentsResponse> {
  const query = new URLSearchParams();
  if (params?.kind) query.set("kind", params.kind);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  const qs = query.toString();
  const json = await requestHermesJson(`/payments${qs ? `?${qs}` : ""}`);
  return hermesPaymentsResponseSchema.parse(json);
}
