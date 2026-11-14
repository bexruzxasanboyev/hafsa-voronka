"use client";

import { useState } from "react";
import type { NetworkAttribution, NetworkAttributionRow } from "@funnel/shared";
import { Section } from "@/components/admin/ui/Section";
import { Segmented } from "@/components/admin/ui/Segmented";
import { type StatColumn, StatTable } from "@/components/admin/ui/StatTable";
import { adminUz } from "@/lib/i18n/admin";

type AttributionMode = keyof NetworkAttribution;

const copy = adminUz.attribution;

const modeItems: { value: AttributionMode; label: string }[] = [
  { value: "firstTouch", label: copy.modes.firstTouch },
  { value: "lastTouch", label: copy.modes.lastTouch },
];

const columns: StatColumn<NetworkAttributionRow>[] = [
  {
    key: "network",
    label: copy.columns.network,
    mobile: "title",
    render: (row) => <span className="font-semibold">{copy.networks[row.network]}</span>,
  },
  { key: "registrations", label: copy.columns.registrations, align: "right", render: (row) => row.registrations },
  { key: "buttonClicks", label: copy.columns.buttonClicks, align: "right", render: (row) => row.buttonClicks },
  { key: "realChats", label: copy.columns.realChats, align: "right", render: (row) => row.realChats },
  {
    key: "purchases",
    label: copy.columns.purchases,
    align: "right",
    render: (row) => <span className="font-semibold text-zumrad">{row.purchases}</span>,
  },
];

export function NetworkAttributionCard({ attribution }: { attribution: NetworkAttribution }) {
  const [mode, setMode] = useState<AttributionMode>("firstTouch");

  return (
    <Section title={copy.title} description={copy.description}>
      <div className="sm:hidden">
        <Segmented label={copy.modes.label} items={modeItems} value={mode} onChange={setMode} fill />
      </div>
      <div className="hidden sm:block">
        <Segmented label={copy.modes.label} items={modeItems} value={mode} onChange={setMode} />
      </div>
      <StatTable
        columns={columns}
        rows={attribution[mode]}
        rowKey={(row) => row.network}
        empty={adminUz.common.noData}
      />
    </Section>
  );
}
