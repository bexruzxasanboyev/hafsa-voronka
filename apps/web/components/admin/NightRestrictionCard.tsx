"use client";

import { useEffect, useState } from "react";
import { DEFAULT_NIGHT_RESTRICTION_ENABLED } from "@funnel/shared";
import { Badge } from "@/components/admin/ui/Badge";
import { Notice } from "@/components/admin/ui/Notice";
import { SaveStatus } from "@/components/admin/ui/SaveStatus";
import { Section } from "@/components/admin/ui/Section";
import { Switch } from "@/components/admin/ui/Switch";
import { fetchSettings, saveSettings } from "@/lib/admin/settings";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.settings.nightRestriction;

type Phase = "idle" | "saving" | "saved" | "error";

export function NightRestrictionCard() {
  const [enabled, setEnabled] = useState(DEFAULT_NIGHT_RESTRICTION_ENABLED);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    let active = true;
    void fetchSettings().then((result) => {
      if (!active) return;
      if (result.ok) setEnabled(result.settings.nightRestrictionEnabled);
      setLoaded(result.ok);
      if (!result.ok) setPhase("error");
    });
    return () => {
      active = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setPhase("saving");
    const result = await saveSettings({ nightRestrictionEnabled: next });
    if (result.ok) {
      setEnabled(result.settings.nightRestrictionEnabled);
      setPhase("saved");
    } else {
      setEnabled(previous);
      setPhase("error");
    }
  };

  return (
    <Section
      title={copy.title}
      actions={
        loaded && (
          <div className="flex items-center gap-2">
            <SaveStatus state={phase === "saved" ? "saved" : "idle"} />
            <Badge tone={enabled ? "attention" : "neutral"}>{enabled ? copy.on : copy.off}</Badge>
          </div>
        )
      }
    >
      <div className="flex items-center justify-between gap-4">
        <p className="m-0 text-sm text-qalam">{copy.description}</p>
        <Switch
          checked={enabled}
          onChange={(next) => void toggle(next)}
          label={copy.label}
          disabled={!loaded || phase === "saving"}
        />
      </div>

      {phase === "error" && <Notice tone="danger">{adminUz.settings.error}</Notice>}
    </Section>
  );
}
