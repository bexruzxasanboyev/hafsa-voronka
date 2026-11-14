"use client";

import type { GroupBreakdownRow } from "@funnel/shared";
import { Badge, type BadgeTone } from "@/components/admin/ui/Badge";
import { Section } from "@/components/admin/ui/Section";
import { type StatColumn, StatTable } from "@/components/admin/ui/StatTable";
import { formatUzs } from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments;

type GroupBreakdownTableProps = {
  rows: GroupBreakdownRow[];
  onSelectGroup: (groupId: number | null) => void;
};

function disciplineTone(percent: number): BadgeTone {
  if (percent >= 80) return "success";
  if (percent >= 50) return "attention";
  return "danger";
}

export function GroupBreakdownTable({ rows, onSelectGroup }: GroupBreakdownTableProps) {
  const columns: StatColumn<GroupBreakdownRow>[] = [
    {
      key: "groupName",
      label: copy.groupColumns.groupName,
      mobile: "title",
      render: (row) => (
        <button
          type="button"
          onClick={() => onSelectGroup(row.groupId)}
          className="flex cursor-pointer flex-col text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-siyoh"
        >
          <span className="font-semibold text-siyoh underline decoration-chiziq underline-offset-4 hover:decoration-siyoh">
            {row.groupName ?? copy.filters.unassigned}
          </span>
          {row.courseTitle && (
            <span className="text-xs font-normal text-qalam">{row.courseTitle}</span>
          )}
        </button>
      ),
    },
    {
      key: "studentsCount",
      label: copy.groupColumns.studentsCount,
      align: "right",
      render: (row) => row.studentsCount,
    },
    {
      key: "totalContractUzs",
      label: copy.groupColumns.contractAmount,
      align: "right",
      render: (row) => (
        <span className="whitespace-nowrap">{formatUzs(row.totalContractUzs)}</span>
      ),
    },
    {
      key: "totalPaidUzs",
      label: copy.groupColumns.paidAmount,
      align: "right",
      render: (row) => (
        <span className="whitespace-nowrap font-semibold text-zumrad">
          {formatUzs(row.totalPaidUzs)}
        </span>
      ),
    },
    {
      key: "currentMonthDebtUzs",
      label: copy.groupColumns.currentMonthDebt,
      align: "right",
      render: (row) => (
        <span className="whitespace-nowrap">{formatUzs(row.currentMonthDebtUzs)}</span>
      ),
    },
    {
      key: "totalRemainingUzs",
      label: copy.groupColumns.totalRemaining,
      align: "right",
      render: (row) => (
        <span
          className={`whitespace-nowrap font-semibold ${row.totalRemainingUzs > 0 ? "text-anor" : "text-siyoh"}`}
        >
          {formatUzs(row.totalRemainingUzs)}
        </span>
      ),
    },
    {
      key: "disciplinePercent",
      label: copy.groupColumns.disciplinePercent,
      align: "right",
      render: (row) => (
        <Badge tone={disciplineTone(row.disciplinePercent)}>
          {row.disciplinePercent}%
        </Badge>
      ),
    },
  ];

  return (
    <Section>
      <StatTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.groupId ?? "unassigned"}
        empty={copy.groupColumns.empty}
      />
    </Section>
  );
}
