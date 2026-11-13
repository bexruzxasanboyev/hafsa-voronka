"use client";

import { useState } from "react";
import { AUTO_DELETE_MINUTES_OPTIONS } from "@funnel/shared";
import { Field, Input } from "@/components/admin/ui/Field";
import { Select } from "@/components/admin/ui/Select";

type AutoDeletePickerProps = {
  value: number | null;
  onChange: (minutes: number | null) => void;
};

export function AutoDeletePicker({ value, onChange }: AutoDeletePickerProps) {
  const isPreset = value !== null && (AUTO_DELETE_MINUTES_OPTIONS as readonly number[]).includes(value);
  const [customOpen, setCustomOpen] = useState(value !== null && !isPreset);

  const selectValue = value === null ? "never" : customOpen || !isPreset ? "custom" : String(value);

  const options = [
    { value: "never", label: "O‘chirilmasin (doimiy saqlansin)" },
    { value: "60", label: "1 soat" },
    { value: "180", label: "3 soat" },
    { value: "360", label: "6 soat" },
    { value: "720", label: "12 soat" },
    { value: "1440", label: "24 soat" },
    { value: "custom", label: "Ixtiyoriy vaqt (daqiqa)" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <Field label="Avtomatik o‘chish vaqti (chatdan)">
        {({ id }) => (
          <Select
            id={id}
            value={selectValue}
            options={options}
            onValueChange={(next) => {
              if (next === "never") {
                setCustomOpen(false);
                onChange(null);
              } else if (next === "custom") {
                setCustomOpen(true);
                if (value === null) onChange(30);
              } else {
                setCustomOpen(false);
                onChange(Number(next));
              }
            }}
          />
        )}
      </Field>

      {(customOpen || (value !== null && !isPreset)) && (
        <Field label="Daqiqalar soni (1 – 10080)" suffix="daqiqa" className="w-48">
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={10080}
              value={value ?? 30}
              onChange={(e) => {
                const n = Math.max(1, Math.min(10080, Math.floor(Number(e.target.value) || 1)));
                onChange(n);
              }}
            />
          )}
        </Field>
      )}
    </div>
  );
}
