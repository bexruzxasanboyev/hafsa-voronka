"use client";

import { useCallback, useEffect, useState } from "react";
import type { BotTextItem, ScheduledBroadcast } from "@funnel/shared";
import { BotWorkspace } from "@/components/admin/bot/BotWorkspace";
import { BroadcastEditor } from "@/components/admin/bot/BroadcastEditor";
import { BroadcastsPanel } from "@/components/admin/bot/BroadcastsPanel";
import { botMessageGroups } from "@/components/admin/bot/scenarios";
import { Notice } from "@/components/admin/ui/Notice";
import { Page, PageHeader } from "@/components/admin/ui/Page";
import { ErrorState, LoadingState } from "@/components/admin/ui/States";
import { fetchBotTexts } from "@/lib/admin/botTexts";
import { cancelBroadcast, fetchBroadcasts } from "@/lib/admin/broadcasts";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.botTexts;
const broadcastsCopy = adminUz.broadcasts;

type SectionTab = "auto" | "broadcasts";
type BroadcastEditorState = {
  item: ScheduledBroadcast | null;
  duplicateFrom?: ScheduledBroadcast | null;
} | null;

export default function AdminBotTextsPage() {
  const [section, setSection] = useState<SectionTab>("auto");
  const [items, setItems] = useState<BotTextItem[] | null>(null);
  const [mediaEnabled, setMediaEnabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [broadcasts, setBroadcasts] = useState<ScheduledBroadcast[] | null>(null);
  const [broadcastMediaEnabled, setBroadcastMediaEnabled] = useState(false);
  const [broadcastsFailed, setBroadcastsFailed] = useState(false);
  const [broadcastsAttempt, setBroadcastsAttempt] = useState(0);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [editingBroadcast, setEditingBroadcast] = useState<BroadcastEditorState>(null);

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

  const hasRunningBroadcast = Boolean(
    broadcasts?.some((item) => item.status === "running" || item.status === "scheduled"),
  );

  useEffect(() => {
    if (section !== "broadcasts" || !hasRunningBroadcast) return;
    const timer = setInterval(() => {
      void loadBroadcasts();
    }, 5000);
    return () => clearInterval(timer);
  }, [section, hasRunningBroadcast, loadBroadcasts]);

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

  const autoCount = botMessageGroups.length;
  const broadcastCount = broadcasts?.length ?? null;

  return (
    <Page width="wide">
      <PageHeader title={adminUz.pages.botTexts.title} description={adminUz.pages.botTexts.description} />

      <div
        role="tablist"
        aria-label={broadcastsCopy.pageTabsLabel}
        className="flex items-center gap-1 border-b border-chiziq"
      >
        {(
          [
            { id: "auto", label: broadcastsCopy.pageTabs.auto, count: autoCount },
            { id: "broadcasts", label: broadcastsCopy.pageTabs.broadcasts, count: broadcastCount },
          ] as const
        ).map((tabItem) => {
          const active = section === tabItem.id;
          return (
            <button
              key={tabItem.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(tabItem.id)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-siyoh ${
                active
                  ? "border-siyoh font-semibold text-siyoh"
                  : "border-transparent font-medium text-qalam hover:text-siyoh"
              }`}
            >
              <span>{tabItem.label}</span>
              {tabItem.count !== null && (
                <span
                  className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums ${
                    active ? "bg-siyoh text-white" : "bg-varaq text-qalam"
                  }`}
                >
                  {tabItem.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {section === "auto" && (
        <>
          {items && !mediaEnabled && <Notice tone="info">{copy.mediaDisabled}</Notice>}
          {failed && <ErrorState onRetry={retry} />}
          {!items && !failed && <LoadingState variant="list" rows={3} />}
          {items && <BotWorkspace items={items} mediaEnabled={mediaEnabled} onItems={setItems} />}
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
              onDuplicate={(item) => setEditingBroadcast({ item: null, duplicateFrom: item })}
              onCancel={handleBroadcastCancel}
            />
          )}
          {editingBroadcast && (
            <BroadcastEditor
              key={
                editingBroadcast.item?.id ??
                (editingBroadcast.duplicateFrom
                  ? `dup-${editingBroadcast.duplicateFrom.id}`
                  : "new-broadcast")
              }
              item={editingBroadcast.item}
              duplicateFrom={editingBroadcast.duplicateFrom ?? null}
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
