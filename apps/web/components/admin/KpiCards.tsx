"use client";

import type { KpiStats } from "@funnel/shared";
import { adminUz } from "@/lib/i18n/admin";

function formatNumber(num: number): string {
  return new Intl.NumberFormat("uz-UZ").format(num);
}

export function KpiCards({ kpis }: { kpis: KpiStats }) {
  const directBotOnly = kpis.landingViews === 0 && kpis.botStarts > 0;
  const chatsNote = adminUz.kpis.conversionRealChatsNote
    .replace("{chats}", formatNumber(kpis.realChats))
    .replace("{clicks}", formatNumber(kpis.channelClicks));
  const purchaseSuffix =
    kpis.purchases > 0
      ? ` · ${adminUz.kpis.conversionPurchasesSuffix.replace("{purchases}", formatNumber(kpis.purchases))}`
      : "";
  const conversionTooltip = directBotOnly ? adminUz.kpis.botConversionNote : adminUz.kpis.conversionNote;

  const items: { label: string; value: string; note: string; title?: string }[] = [
    { label: adminUz.kpis.landingViews, value: formatNumber(kpis.landingViews), note: adminUz.kpis.landingNote },
    { label: adminUz.kpis.botStarts, value: formatNumber(kpis.botStarts), note: adminUz.kpis.botNote },
    { label: adminUz.kpis.registrations, value: formatNumber(kpis.registrations), note: adminUz.kpis.registrationNote },
    { label: adminUz.kpis.completions, value: formatNumber(kpis.completions), note: adminUz.kpis.completionNote },
    {
      label: directBotOnly ? adminUz.kpis.botConversionRate : adminUz.kpis.conversionRate,
      value: `${kpis.conversionRate}%`,
      note: `${chatsNote}${purchaseSuffix}`,
      title: `${conversionTooltip} (${kpis.conversionRate}%)`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {items.map((item, index) => (
        <div
          key={item.label}
          title={item.title}
          className={`flex flex-col gap-1 rounded-[16px] bg-white p-4 sm:p-5 ${index === items.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}
        >
          <span className="text-[13px] text-qalam">{item.label}</span>
          <span className="text-[28px] font-bold leading-tight tracking-tight text-siyoh tabular-nums">{item.value}</span>
          <span className="text-xs text-qalam">{item.note}</span>
        </div>
      ))}
    </div>
  );
}
