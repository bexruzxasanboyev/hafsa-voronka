"use client";

import {
  attributionModels,
  attributionNetworks,
  debtStatuses,
  type AttributionModel,
  type CourseItem,
  type EnrollmentStudentRow,
  type StudyGroupItem,
} from "@funnel/shared";
import { Badge } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input } from "@/components/admin/ui/Field";
import { Section } from "@/components/admin/ui/Section";
import { Select } from "@/components/admin/ui/Select";
import { type StatColumn, StatTable } from "@/components/admin/ui/StatTable";
import { formatDate } from "@/lib/admin/dates";
import {
  debtStatusLabel,
  debtStatusTone,
  earliestVerifiedPaidDate,
  FILTER_ALL,
  FILTER_UNASSIGNED,
  formatStudentDisplayName,
  formatUzs,
  networkLabel,
} from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments;

type MasterPaymentsTableProps = {
  students: EnrollmentStudentRow[];
  courses: CourseItem[];
  groups: StudyGroupItem[];
  attributionModel: AttributionModel;
  onAttributionModelChange: (model: AttributionModel) => void;
  search: string;
  onSearchChange: (value: string) => void;
  networkFilter: string;
  onNetworkFilterChange: (value: string) => void;
  courseFilter: string;
  onCourseFilterChange: (value: string) => void;
  groupFilter: string;
  onGroupFilterChange: (value: string) => void;
  debtStatusFilter: string;
  onDebtStatusFilterChange: (value: string) => void;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  onSelectStudent: (student: EnrollmentStudentRow) => void;
};

export function MasterPaymentsTable({
  students,
  courses,
  groups,
  attributionModel,
  onAttributionModelChange,
  search,
  onSearchChange,
  networkFilter,
  onNetworkFilterChange,
  courseFilter,
  onCourseFilterChange,
  groupFilter,
  onGroupFilterChange,
  debtStatusFilter,
  onDebtStatusFilterChange,
  hasActiveFilters,
  onResetFilters,
  onSelectStudent,
}: MasterPaymentsTableProps) {
  const attributionOptions = attributionModels.map((model) => ({
    value: model,
    label:
      model === "first"
        ? copy.filters.attributionFirst
        : copy.filters.attributionLast,
  }));

  const networkOptions = [
    { value: FILTER_ALL, label: copy.filters.all },
    ...attributionNetworks.map((net) => ({
      value: net,
      label: networkLabel(net),
    })),
  ];

  const courseOptions = [
    { value: FILTER_ALL, label: copy.filters.all },
    ...courses.map((course) => ({
      value: String(course.id),
      label: course.title,
    })),
  ];

  const groupOptions = [
    { value: FILTER_ALL, label: copy.filters.all },
    { value: FILTER_UNASSIGNED, label: copy.filters.unassigned },
    ...groups.map((group) => ({
      value: String(group.id),
      label: group.name,
    })),
  ];

  const debtStatusOptions = [
    { value: FILTER_ALL, label: copy.filters.all },
    ...debtStatuses.map((status) => ({
      value: status,
      label: debtStatusLabel(status),
    })),
  ];

  const columns: StatColumn<EnrollmentStudentRow>[] = [
    {
      key: "student",
      label: copy.masterColumns.student,
      mobile: "title",
      render: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-siyoh">
            {formatStudentDisplayName(row)}
          </span>
          <span className="text-xs font-normal text-qalam tabular-nums">
            {row.phone ?? "—"}
          </span>
          <span className="text-xs font-normal text-qalam tabular-nums">
            {row.username ? `@${row.username} · ` : ""}ID {row.telegramId}
          </span>
        </div>
      ),
    },
    {
      key: "source",
      label: copy.masterColumns.source,
      render: (row) => {
        const campaign =
          attributionModel === "first" ? row.firstCampaign : row.lastCampaign;
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge tone="neutral">{networkLabel(row.attributionNetwork)}</Badge>
            {campaign && (
              <span className="max-w-[160px] truncate text-xs text-qalam">
                {campaign}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "courseTariff",
      label: copy.masterColumns.courseTariff,
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-siyoh">{row.courseTitle}</span>
          <span className="text-xs text-qalam">{row.tariffName}</span>
        </div>
      ),
    },
    {
      key: "group",
      label: copy.masterColumns.group,
      render: (row) => (
        <span className="text-siyoh">
          {row.studyGroupName ?? copy.filters.unassigned}
        </span>
      ),
    },
    {
      key: "contractAmount",
      label: copy.masterColumns.contractAmount,
      align: "right",
      render: (row) => (
        <span className="whitespace-nowrap font-medium text-siyoh">
          {formatUzs(row.contractAmountUzs)}
        </span>
      ),
    },
    {
      key: "paidAmount",
      label: copy.masterColumns.paidAmount,
      align: "right",
      render: (row) => {
        const earliestDate = earliestVerifiedPaidDate(row.payments);
        return (
          <div className="flex flex-col items-end">
            <span className="whitespace-nowrap font-semibold text-zumrad">
              {formatUzs(row.paidAmountUzs)}
            </span>
            {earliestDate && (
              <span className="text-xs text-qalam tabular-nums">
                {formatDate(earliestDate)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "currentMonthDebt",
      label: copy.masterColumns.currentMonthDebt,
      align: "right",
      render: (row) => (
        <div className="flex flex-col items-end">
          <span className="whitespace-nowrap font-medium text-siyoh">
            {formatUzs(row.currentMonthDebtUzs)}
          </span>
          {row.currentDueDate && (
            <span className="text-xs text-qalam tabular-nums">
              {formatDate(row.currentDueDate)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "totalRemaining",
      label: copy.masterColumns.totalRemaining,
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
      key: "debtStatus",
      label: copy.masterColumns.debtStatus,
      render: (row) => (
        <Badge tone={debtStatusTone(row.debtStatus)}>
          {debtStatusLabel(row.debtStatus)}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: copy.masterColumns.actions,
      align: "right",
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSelectStudent(row)}
        >
          {copy.actions.details}
        </Button>
      ),
    },
  ];

  return (
    <Section>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label={copy.filters.searchLabel}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={copy.filters.searchPlaceholder}
            />
          )}
        </Field>

        <Field label={copy.filters.attributionLabel}>
          {({ id }) => (
            <Select
              id={id}
              value={attributionModel}
              onValueChange={(value) =>
                onAttributionModelChange(value as AttributionModel)
              }
              options={attributionOptions}
            />
          )}
        </Field>

        <Field label={copy.filters.networkLabel}>
          {({ id }) => (
            <Select
              id={id}
              value={networkFilter}
              onValueChange={onNetworkFilterChange}
              options={networkOptions}
            />
          )}
        </Field>

        <Field label={copy.filters.courseLabel}>
          {({ id }) => (
            <Select
              id={id}
              value={courseFilter}
              onValueChange={onCourseFilterChange}
              options={courseOptions}
            />
          )}
        </Field>

        <Field label={copy.filters.groupLabel}>
          {({ id }) => (
            <Select
              id={id}
              value={groupFilter}
              onValueChange={onGroupFilterChange}
              options={groupOptions}
            />
          )}
        </Field>

        <Field label={copy.filters.debtStatusLabel}>
          {({ id }) => (
            <Select
              id={id}
              value={debtStatusFilter}
              onValueChange={onDebtStatusFilterChange}
              options={debtStatusOptions}
            />
          )}
        </Field>
      </div>

      {hasActiveFilters && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onResetFilters}>
            {copy.actions.resetFilters}
          </Button>
        </div>
      )}

      <StatTable
        columns={columns}
        rows={students}
        rowKey={(row) => row.id}
        empty={copy.masterColumns.empty}
      />
    </Section>
  );
}
