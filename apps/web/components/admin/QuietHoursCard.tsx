"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/admin/ui/Notice";
import { SaveStatus } from "@/components/admin/ui/SaveStatus";
import { Section } from "@/components/admin/ui/Section";
import { Switch } from "@/components/admin/ui/Switch";
import { fetchSettings, saveSettings } from "@/lib/admin/settings";

type Phase = "idle" | "saving" | "saved" | "error";

export function QuietHoursCard() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    let active = true;
    void fetchSettings().then((result) => {
      if (!active) return;
      if (result.ok) setEnabled(result.settings.quietHoursEnabled);
      setLoaded(result.ok);
      if (!result.ok) setPhase("error");
    });
    return () => {
      active = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    setPhase("saving");
    const result = await saveSettings({ quietHoursEnabled: next });
    if (result.ok) setEnabled(result.settings.quietHoursEnabled);
    setPhase(result.ok ? "saved" : "error");
  };

  return (
    <Section title="Tungi cheklov (23:00–07:00)">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-medium text-siyoh">23:00 dan 07:00 gacha eslatmalarni to‘xtatish</div>
          <p className="m-0 text-xs text-qalam">
            O‘chiq holatda eslatmalar sutka davomida (bomdod va tungi vaqtlarda ham) belgilangan vaqtda yuboriladi.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <SaveStatus state={phase === "saved" ? "saved" : "idle"} />
          <Switch
            checked={enabled}
            label="Tungi cheklov (23:00–07:00)"
            disabled={!loaded || phase === "saving"}
            onChange={(next) => void toggle(next)}
          />
        </div>
      </div>
      {phase === "error" && <Notice tone="danger">Saqlashda xatolik yuz berdi</Notice>}
    </Section>
  );
}
