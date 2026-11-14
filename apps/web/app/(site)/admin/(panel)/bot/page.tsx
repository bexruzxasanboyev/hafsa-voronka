"use client";

import { useCallback, useEffect, useState } from "react";
import type { BotTextItem, BotTextKey, ScheduledBroadcast } from "@funnel/shared";
import { BotChat } from "@/components/admin/bot/BotChat";
import { BotTextEditor } from "@/components/admin/bot/BotTextEditor";
import { BroadcastEditor } from "@/components/admin/bot/BroadcastEditor";
import { BroadcastsPanel } from "@/components/admin/bot/BroadcastsPanel";
import { type ScenarioId, scenarioOrder } from "@/components/admin/bot/scenarios";
import { Notice } from "@/components/admin/ui/Notice";
import { Page, PageHeader } from "@/components/admin/ui/Page";
import { Segmented } from "@/components/admin/ui/Segmented";
import { ErrorState, LoadingState } from "@/components/admin/ui/States";
import { fetchBotTexts } from "@/lib/admin/botTexts";
import { cancelBroadcast, fetchBroadcasts } from "@/lib/admin/broadcasts";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.botTexts;
const broadcastsCopy = adminUz.broadcasts;

type SectionTab = "auto" | "broadcasts";

export default function AdminBotTextsPage() {
  const [section, setSection] = useState<SectionTab>("auto");
  const [items, setItems] = useState<BotTextItem[] | null>(null);
  const [mediaEnabled, setMediaEnabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [scenario, setScenario] = useState<ScenarioId>("newUser");
  const [editing, setEditing] = useState<BotTextKey | null>(null);

  const [broadcasts, setBroadcasts] = useState<ScheduledBroadcast[] | null>(null);
  const [broadcastMediaEnabled, setBroadcastMediaEnabled] = useState(false);
  const [broadcastsFailed, setBroadcastsFailed] = useState(false);
  const [broadcastsAttempt, setBroadcastsAttempt] = useState(0);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [editingBroadcast, setEditingBroadcast] = useState<{ item: ScheduledBroadcast | null } | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBotTexts().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setItems(result.items);
      setMediaEnabled(Boolean(result.mediaEnabled));
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const loadBroadcasts = useCallback(async () => {
    const result = await fetchBroadcasts();
    if (!result.ok) {
      setBroadcastsFailed(true);
      return;
    }
    setBroadcastsFailed(false);
    setBroadcasts(result.data.broadcasts);
    setBroadcastMediaEnabled(result.data.mediaEnabled);
  }, []);

  useEffect(() => {
    if (section !== "broadcasts") return;
    let active = true;
    void fetchBroadcasts().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setBroadcastsFailed(true);
        return;
      }
      setBroadcastsFailed(false);
      setBroadcasts(result.data.broadcasts);
      setBroadcastMediaEnabled(result.data.mediaEnabled);
    });
    return () => {
      active = false;
    };
  }, [section, broadcastsAttempt]);

  const hasRunningBroadcast = Boolean(broadcasts?.some((item) => item.status === "running" || item.status === "scheduled"));

  useEffect(() => {
    if (section !== "broadcasts" || !hasRunningBroadcast) return;
    const timer = setInterval(() => {
      void loadBroadcasts();
    }, 5000);
    return () => clearInterval(timer);
  }, [section, hasRunningBroadcast, loadBroadcasts]);

  const editingItem = items?.find((item) => item.key === editing) ?? null;

  const retry = () => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  const retryBroadcasts = () => {
    setBroadcastsFailed(false);
    setBroadcastsAttempt((value) => value + 1);
  };

  function handleBroadcastSaved(saved: ScheduledBroadcast) {
    setBroadcasts((current) => {
      if (!current) return [saved];
      const exists = current.some((entry) => entry.id === saved.id);
      return exists
        ? current.map((entry) => (entry.id === saved.id ? saved : entry))
        : [saved, ...current];
    });
    setEditingBroadcast(null);
  }

  async function handleBroadcastCancel(id: number) {
    setBroadcastError(null);
    const result = await cancelBroadcast(id);
    if (!result.ok) {
      const code = result.error as keyof typeof broadcastsCopy.errors | undefined;
      setBroadcastError((code && broadcastsCopy.errors[code]) ?? broadcastsCopy.errors.generic);
      return;
    }
    setBroadcasts((current) =>
      current ? current.map((entry) => (entry.id === id ? result.data : entry)) : current,
    );
  }

  return (
    <Page width="narrow">
      <PageHeader title={adminUz.pages.botTexts.title} description={adminUz.pages.botTexts.description} />

      <div className="mx-auto w-full max-w-[640px]">
        <Segmented
          label={broadcastsCopy.pageTabsLabel}
          role="tablist"
          fill
          value={section}
          onChange={setSection}
          items={[
            { value: "auto", label: broadcastsCopy.pageTabs.auto },
            { value: "broadcasts", label: broadcastsCopy.pageTabs.broadcasts },
          ]}
        />
      </div>

      {section === "auto" && (
        <>
          {items && !mediaEnabled && <Notice tone="info">{copy.mediaDisabled}</Notice>}

          {failed && <ErrorState onRetry={retry} />}
          {!items && !failed && <LoadingState variant="list" rows={3} />}

          {items && (
            <div className="flex flex-col gap-4">
              <div className="mx-auto w-full max-w-[640px]">
                <Segmented
                  label={copy.tabsLabel}
                  role="tablist"
                  fill
                  value={scenario}
                  onChange={setScenario}
                  items={scenarioOrder.map((id) => ({ value: id, label: copy.tabs[id] }))}
                />
              </div>
              <BotChat
                key={scenario}
                scenario={scenario}
                items={items}
                onEditMessage={setEditing}
                onEditButton={setEditing}
              />
            </div>
          )}

          {editingItem && (
            <BotTextEditor
              key={editingItem.key}
              item={editingItem}
              mediaEnabled={mediaEnabled}
              onItems={setItems}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      )}

      {section === "broadcasts" && (
        <>
          {broadcasts && !broadcastMediaEnabled && <Notice tone="info">{copy.mediaDisabled}</Notice>}
          {broadcastError && (
            <Notice tone="danger" onDismiss={() => setBroadcastError(null)}>
              {broadcastError}
            </Notice>
          )}
          {broadcastsFailed && <ErrorState onRetry={retryBroadcasts} />}
          {!broadcasts && !broadcastsFailed && <LoadingState variant="list" rows={3} />}
          {broadcasts && (
            <BroadcastsPanel
              broadcasts={broadcasts}
              onCreate={() => setEditingBroadcast({ item: null })}
              onEdit={(item) => setEditingBroadcast({ item })}
              onCancel={handleBroadcastCancel}
            />
          )}
          {editingBroadcast && (
            <BroadcastEditor
              key={editingBroadcast.item?.id ?? "new-broadcast"}
              item={editingBroadcast.item}
              mediaEnabled={broadcastMediaEnabled}
              onSaved={handleBroadcastSaved}
              onClose={() => setEditingBroadcast(null)}
            />
          )}
        </>
      )}
    </Page>
  );
}
