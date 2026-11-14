"use client";

import { useId, useState } from "react";
import { AUTO_DELETE_PRESETS, MAX_AUTO_DELETE_MINUTES } from "@funnel/shared";
import { Badge } from "@/components/admin/ui/Badge";
import { Field, Input } from "@/components/admin/ui/Field";
import { ClockIcon, PinIcon } from "@/components/icons";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.messages.autoDelete;

function isPresetValue(value: number | null): boolean {
  return value === null || (AUTO_DELETE_PRESETS as readonly number[]).includes(value);
}

function clamp(raw: string, max: number): number {
  return Math.min(max, Math.max(0, Math.floor(Number(raw) || 0)));
}

export function formatAutoDelete(minutes: number | null): string {
  if (minutes === null) return copy.never;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return copy.badgeHoursMinutes.replace("{h}", String(h)).replace("{m}", String(m));
  if (h > 0) return copy.badgeHours.replace("{h}", String(h));
  return copy.badgeMinutes.replace("{m}", String(m));
}

export function AutoDeleteBadge({ minutes }: { minutes: number | null }) {
  return (
    <Badge>
      {minutes === null ? <PinIcon className="mr-1 h-3 w-3" /> : <ClockIcon className="mr-1 h-3 w-3" />}
      {formatAutoDelete(minutes)}
    </Badge>
  );
}

type AutoDeletePickerProps = {
  value: number | null;
  onChange: (minutes: number | null) => void;
  id?: string;
  error?: string | null;
  label?: string;
};

export function AutoDeletePicker({ value, onChange, id, error, label = copy.label }: AutoDeletePickerProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const [customOpen, setCustomOpen] = useState(() => !isPresetValue(value));
  const showCustom = customOpen || !isPresetValue(value);

  const hours = value !== null ? Math.floor(value / 60) : 0;
  const minutes = value !== null ? value % 60 : 0;
  const rangeInvalid = showCustom && (value === null || value < 1 || value > MAX_AUTO_DELETE_MINUTES);
  const activeError = error ?? (rangeInvalid ? copy.rangeError : null);

  const options: { key: string; label: string; active: boolean; onClick: () => void }[] = [
    {
      key: "never",
      label: copy.never,
      active: !showCustom && value === null,
      onClick: () => {
        setCustomOpen(false);
        onChange(null);
      },
    },
    ...AUTO_DELETE_PRESETS.map((preset) => ({
      key: String(preset),
      label: copy.hourOption.replace("{n}", String(preset / 60)),
      active: !showCustom && value === preset,
      onClick: () => {
        setCustomOpen(false);
        onChange(preset);
      },
    })),
    {
      key: "custom",
      label: copy.custom,
      active: showCustom,
      onClick: () => {
        setCustomOpen(true);
        if (value === null) onChange(60);
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-chiziq p-3">
      <label id={`${groupId}-label`} className="text-sm font-medium text-siyoh">
        {label}
      </label>

      <div role="group" aria-labelledby={`${groupId}-label`} className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={option.active}
            onClick={option.onClick}
            className={`inline-flex min-h-10 items-center justify-center rounded-[10px] px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-siyoh ${
              option.active
                ? "bg-siyoh font-semibold text-varaq"
                : "bg-varaq font-medium text-siyoh hover:bg-chiziq/70"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-start gap-3 pt-1">
          <Field label={copy.hoursLabel} suffix={adminUz.messages.editor.hours} className="w-32">
            {({ id: fieldId }) => (
              <Input
                id={fieldId}
                type="number"
                inputMode="numeric"
                min={0}
                max={47}
                value={hours}
                invalid={Boolean(activeError)}
                onChange={(e) => onChange(clamp(e.target.value, 47) * 60 + minutes)}
              />
            )}
          </Field>
          <Field label={copy.minutesLabel} suffix={adminUz.messages.editor.minutes} className="w-36">
            {({ id: fieldId }) => (
              <Input
                id={fieldId}
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={minutes}
                invalid={Boolean(activeError)}
                onChange={(e) => onChange(hours * 60 + clamp(e.target.value, 59))}
              />
            )}
          </Field>
        </div>
      )}

      <p className="m-0 text-[13px] text-qalam/80">{copy.hint}</p>

      {activeError && (
        <p role="alert" className="m-0 text-[13px] text-anor">
          {activeError}
        </p>
      )}
    </div>
  );
}
