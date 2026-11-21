"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  HermesPaymentKind,
  HermesPaymentsResponse,
  HermesStatusResponse,
} from "@funnel/shared";
import { Notice } from "@/components/admin/ui/Notice";
import { Section } from "@/components/admin/ui/Section";
import { Segmented } from "@/components/admin/ui/Segmented";
import { ErrorState, LoadingState } from "@/components/admin/ui/States";
import {
  fetchHermesPayments,
  fetchHermesStatus,
  formatHermesRelativeTime,
  hermesConfidenceLabel,
  hermesKindTone,
  resolveHermesPayDate,
  type HermesKindTone,
} from "@/lib/admin/hermes";
import { formatUzs } from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.hermes;

type KindFilter = "all" | HermesPaymentKind;

const chipToneClass: Record<HermesKindTone, string> = {
  success: "bg-zumrad/12 text-zumrad",
  info: "bg-telegram/12 text-siyoh",
  muted: "bg-chiziq text-qalam",
};

function formatCount(value: number): string {
  const formatted = String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return copy.totals.count.replace("{n}", formatted);
}

export function HermesPaymentsSection() {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [status, setStatus] = useState<HermesStatusResponse | null>(null);
  const [data, setData] = useState<HermesPaymentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const kind = kindFilter === "all" ? undefined : kindFilter;

    Promise.all([fetchHermesStatus(), fetchHermesPayments({ kind })])
      .then(([nextStatus, nextData]) => {
        if (!active) return;
        setStatus(nextStatus);
        setData(nextData);
        setError(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          router.replace("/admin/login");
          return;
        }
        setError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [kindFilter, attempt, router]);

  const handleRetry = () => {
    setLoading(true);
    setError(false);
    setAttempt((v) => v + 1);
  };

  if (loading && !status && !error) {
    return <LoadingState variant="section" />;
  }

  if (error) {
    return <ErrorState onRetry={handleRetry} />;
  }

  if (!status) {
    return null;
  }

  if (!status.configured) {
    return (
      <Section title={copy.title} description={copy.caption}>
        <Notice tone="info">
          <span className="text-qalam">{copy.notConfigured}</span>
        </Notice>
      </Section>
    );
  }

  const relativeTime = formatHermesRelativeTime(status.lastSeenAt);
  const statusText = (status.live ? copy.status.live : copy.status.offline).replace(
    "{time}",
    relativeTime,
  );

  const totals = data?.totals ?? {
    paid: { count: 0, amountUzs: 0 },
    deposit: { count: 0, amountUzs: 0 },
    ignored: { count: 0 },
  };
  const items = data?.items ?? [];

  const filterItems: { value: KindFilter; label: string }[] = [
    { value: "all", label: copy.filters.all },
    { value: "paid", label: copy.filters.paid },
    { value: "deposit", label: copy.filters.deposit },
    { value: "ignored", label: copy.filters.ignored },
  ];

  return (
    <Section title={copy.title} description={copy.caption} className="min-w-0">
      <div className="flex items-center gap-2 text-[13px] text-qalam">
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.live ? "bg-zumrad" : "bg-oltin"}`}
        />
        <span>{statusText}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-[14px] border border-chiziq bg-varaq/50 p-3.5 sm:p-4">
          <span className="text-[13px] text-qalam">{copy.totals.paid}</span>
          <span className="text-[20px] font-bold leading-tight tracking-tight text-zumrad tabular-nums sm:text-[22px]">
            {formatUzs(totals.paid.amountUzs)}
          </span>
          <span className="text-xs text-qalam tabular-nums">
            {formatCount(totals.paid.count)}
          </span>
        </div>

        <div className="flex flex-col gap-1 rounded-[14px] border border-chiziq bg-varaq/50 p-3.5 sm:p-4">
          <span className="text-[13px] text-qalam">{copy.totals.deposit}</span>
          <span className="text-[20px] font-bold leading-tight tracking-tight text-siyoh tabular-nums sm:text-[22px]">
            {formatUzs(totals.deposit.amountUzs)}
          </span>
          <span className="text-xs text-qalam tabular-nums">
            {formatCount(totals.deposit.count)}
          </span>
        </div>

        <div className="flex flex-col gap-1 rounded-[14px] border border-chiziq bg-varaq/50 p-3.5 sm:p-4">
          <span className="text-[13px] text-qalam">{copy.totals.ignored}</span>
          <span className="text-[20px] font-bold leading-tight tracking-tight text-qalam tabular-nums sm:text-[22px]">
            {formatCount(totals.ignored.count)}
          </span>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto">
        <Segmented
          label={copy.filters.label}
          role="tablist"
          scroll
          value={kindFilter}
          onChange={(next) => {
            setLoading(true);
            setKindFilter(next);
          }}
          items={filterItems}
        />
      </div>

      {loading && !data ? (
        <LoadingState variant="list" rows={2} />
      ) : items.length === 0 ? (
        <p className="m-0 py-6 text-center text-sm text-qalam">{copy.empty}</p>
      ) : (
        <div className={`w-full overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-chiziq text-[13px] text-qalam">
                <th scope="col" className="py-2.5 pr-3 font-normal">
                  {copy.columns.date}
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  {copy.columns.student}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">
                  {copy.columns.amount}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">
                  {copy.columns.month}
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  {copy.columns.tariff}
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  {copy.columns.status}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-chiziq text-sm text-siyoh">
              {items.map((item) => {
                const studentLabel = item.userName?.trim() || `ID ${item.telegramId}`;
                const tone = hermesKindTone(item.kind);
                return (
                  <tr key={item.hermesId}>
                    <th scope="row" className="whitespace-nowrap py-2.5 pr-3 text-left font-medium tabular-nums">
                      {resolveHermesPayDate(item.payDate, item.hermesCreatedAt)}
                    </th>
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-0 flex-col">
                        <span className="font-medium text-siyoh">{studentLabel}</span>
                        {item.userId === null && (
                          <span className="text-xs text-qalam">{copy.notInFunnel}</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">
                      {item.amountUzs !== null ? formatUzs(item.amountUzs) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {item.monthNo !== null ? item.monthNo : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {item.tariff?.trim() || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${chipToneClass[tone]}`}
                      >
                        {hermesConfidenceLabel(item.confidence)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
