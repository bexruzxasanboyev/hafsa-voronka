"use client";

import { buildDefaultInstallmentSchedule, type InstallmentInput } from "@funnel/shared";
import { Button } from "@/components/admin/ui/Button";
import { DatePicker } from "@/components/admin/ui/DatePicker";
import { Field, Input } from "@/components/admin/ui/Field";
import { formatUzs, parseUzsInput } from "@/lib/admin/payments";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.payments.enrollment;

type InstallmentScheduleEditorProps = {
  contractAmountUzs: number;
  installmentMonths: number;
  onInstallmentMonthsChange: (months: number) => void;
  firstDueDate: string;
  onFirstDueDateChange: (date: string) => void;
  installments: InstallmentInput[];
  onInstallmentsChange: (next: InstallmentInput[]) => void;
  allowsInstallments?: boolean;
};

export function InstallmentScheduleEditor({
  contractAmountUzs,
  installmentMonths,
  onInstallmentMonthsChange,
  firstDueDate,
  onFirstDueDateChange,
  installments,
  onInstallmentsChange,
  allowsInstallments = true,
}: InstallmentScheduleEditorProps) {
  const sum = installments.reduce((acc, item) => acc + item.amountUzs, 0);
  const sumMatches = sum === contractAmountUzs;

  function handleRebuild(nextMonths = installmentMonths, nextFirstDue = firstDueDate) {
    const safeMonths = Math.max(1, Math.min(36, Math.round(nextMonths || 1)));
    const safeContract = Math.max(0, Math.round(contractAmountUzs || 0));
    onInstallmentsChange(buildDefaultInstallmentSchedule(safeContract, safeMonths, nextFirstDue));
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-chiziq bg-varaq/60 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-end">
        <Field label={copy.installmentMonthsLabel}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="number"
              min={1}
              max={allowsInstallments ? 36 : 1}
              disabled={!allowsInstallments}
              value={String(installmentMonths)}
              onChange={(event) => {
                const raw = Number(event.target.value);
                const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(36, Math.round(raw))) : 1;
                onInstallmentMonthsChange(clamped);
                handleRebuild(clamped, firstDueDate);
              }}
            />
          )}
        </Field>

        <Field label={copy.firstDueDateLabel}>
          {({ id }) => (
            <DatePicker
              id={id}
              value={firstDueDate}
              onChange={(nextDate) => {
                onFirstDueDateChange(nextDate);
                handleRebuild(installmentMonths, nextDate);
              }}
            />
          )}
        </Field>

        <Button
          variant="secondary"
          size="md"
          onClick={() => handleRebuild(installmentMonths, firstDueDate)}
        >
          {copy.rebuildSchedule}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-siyoh">{copy.scheduleTitle}</span>
          <span className={`text-xs font-semibold tabular-nums ${sumMatches ? "text-zumrad" : "text-anor"}`}>
            {sumMatches
              ? copy.scheduleSumMatch.replace("{sum}", formatUzs(sum))
              : copy.scheduleSumMismatch
                  .replace("{sum}", formatUzs(sum))
                  .replace("{contract}", formatUzs(contractAmountUzs))}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {installments.map((item, idx) => (
            <div
              key={item.installmentNo}
              className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 rounded-[10px] bg-white p-2"
            >
              <span className="text-xs font-semibold text-qalam">
                {copy.scheduleMonthRow.replace("{n}", String(item.installmentNo))}
              </span>
              <DatePicker
                aria-label={`${copy.scheduleMonthRow.replace("{n}", String(item.installmentNo))} ${adminUz.payments.detail.installmentDueDate}`}
                value={item.dueDate}
                onChange={(nextDate) => {
                  const next = installments.map((row, rowIdx) =>
                    rowIdx === idx ? { ...row, dueDate: nextDate } : row,
                  );
                  onInstallmentsChange(next);
                }}
              />
              <Input
                aria-label={`${copy.scheduleMonthRow.replace("{n}", String(item.installmentNo))} ${copy.amountLabel}`}
                inputMode="numeric"
                value={String(item.amountUzs)}
                onChange={(event) => {
                  const parsed = parseUzsInput(event.target.value) ?? 0;
                  const next = installments.map((row, rowIdx) =>
                    rowIdx === idx ? { ...row, amountUzs: parsed } : row,
                  );
                  onInstallmentsChange(next);
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
