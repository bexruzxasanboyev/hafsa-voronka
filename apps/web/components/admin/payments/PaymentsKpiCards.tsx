"use client";

import type { PaymentsKpis } from "@funnel/shared";
import { formatUzs } from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.kpis;

function formatCount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function PaymentsKpiCards({ kpis }: { kpis: PaymentsKpis }) {
  const items: { label: string; value: string; note: string; tone?: string }[] = [
    {
      label: copy.totalPayingStudents,
      value: formatCount(kpis.totalPayingStudents),
      note: copy.totalPayingStudentsNote,
    },
    {
      label: copy.totalCollectedUzs,
      value: formatUzs(kpis.totalCollectedUzs),
      note: copy.totalCollectedNote,
      tone: "text-zumrad",
    },
    {
      label: copy.currentMonthExpectedDebtUzs,
      value: formatUzs(kpis.currentMonthExpectedDebtUzs),
      note: copy.currentMonthExpectedDebtNote,
    },
    {
      label: copy.totalRemainingDebtUzs,
      value: formatUzs(kpis.totalRemainingDebtUzs),
      note: copy.totalRemainingDebtNote,
      tone: kpis.totalRemainingDebtUzs > 0 ? "text-anor" : "text-siyoh",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 rounded-[16px] bg-white p-4 sm:p-5">
          <span className="text-[13px] text-qalam">{item.label}</span>
          <span className={`text-[24px] font-bold leading-tight tracking-tight tabular-nums sm:text-[26px] ${item.tone ?? "text-siyoh"}`}>
            {item.value}
          </span>
          <span className="text-xs text-qalam">{item.note}</span>
        </div>
      ))}
    </div>
  );
}
