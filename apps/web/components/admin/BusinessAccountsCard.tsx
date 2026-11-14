"use client";

import { useEffect, useState } from "react";
import type { BusinessConnectionItem } from "@funnel/shared";
import { Badge, type BadgeTone } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { Notice } from "@/components/admin/ui/Notice";
import { Section } from "@/components/admin/ui/Section";
import { fetchBusinessConnections, setBusinessConnectionApproval } from "@/lib/admin/settings";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.settings.business;

function accountName(item: BusinessConnectionItem): string {
  const full = [item.firstName, item.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (item.username) return `@${item.username}`;
  return `ID ${item.userTelegramId}`;
}

function accountStatus(item: BusinessConnectionItem): { label: string; tone: BadgeTone } {
  if (!item.isEnabled) return { label: copy.status.disabled, tone: "danger" };
  if (item.isApproved) return { label: copy.status.approved, tone: "success" };
  return { label: copy.status.pending, tone: "attention" };
}

export function BusinessAccountsCard() {
  const [items, setItems] = useState<BusinessConnectionItem[] | null>(null);
  const [botUsername, setBotUsername] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBusinessConnections().then((result) => {
      if (!active) return;
      if (result.ok) {
        setItems(result.data.items);
        setBotUsername(result.data.botUsername);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function toggleApproval(id: string, isApproved: boolean) {
    setSavingId(id);
    setUpdateError(false);
    const result = await setBusinessConnectionApproval(id, isApproved);
    setSavingId(null);
    if (result.ok) {
      setItems((current) =>
        current ? current.map((entry) => (entry.id === id ? result.item : entry)) : current,
      );
    } else {
      setUpdateError(true);
    }
  }

  return (
    <Section title={copy.title} description={copy.description}>
      <div className="flex flex-col gap-2 rounded-[12px] bg-varaq p-3">
        <h3 className="m-0 text-sm font-semibold text-siyoh">{copy.setupTitle}</h3>
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-qalam">
          {copy.setupSteps.map((step) => (
            <li key={step}>{step.replace("{bot}", botUsername || "...")}</li>
          ))}
        </ol>
      </div>

      {loadError && <Notice tone="danger">{copy.loadError}</Notice>}
      {updateError && <Notice tone="danger">{copy.updateError}</Notice>}

      {items !== null && items.length === 0 && !loadError && (
        <p className="m-0 rounded-[12px] bg-varaq px-3.5 py-4 text-center text-sm text-qalam">{copy.empty}</p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {items.map((item) => {
            const status = accountStatus(item);
            const metaParts = [
              item.username ? `@${item.username}` : null,
              `ID ${item.userTelegramId}`,
              item.canReply ? copy.canReply : copy.readOnly,
            ].filter(Boolean);

            return (
              <li
                key={item.id}
                className="flex flex-col gap-3 rounded-[12px] bg-varaq p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-siyoh">{accountName(item)}</span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <span className="text-xs text-qalam">{metaParts.join(" · ")}</span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {item.isApproved ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={savingId !== null}
                      loading={savingId === item.id}
                      onClick={() => void toggleApproval(item.id, false)}
                    >
                      {copy.actions.revoke}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!item.isEnabled || savingId !== null}
                      loading={savingId === item.id}
                      onClick={() => void toggleApproval(item.id, true)}
                    >
                      {copy.actions.approve}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
