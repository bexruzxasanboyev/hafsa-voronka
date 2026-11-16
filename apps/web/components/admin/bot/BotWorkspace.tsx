"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import {
  autoDeleteMinutesSchema,
  BOT_MEDIA_MIME_TYPES,
  type BotButtonKey,
  type BotMessageKey,
  type BotTextItem,
  botTextLimit,
  botVisibleLength,
  validateBotText,
} from "@funnel/shared";
import { AutoDeleteBadge, AutoDeletePicker } from "@/components/admin/AutoDeletePicker";
import {
  type BotMessageGroupId,
  botMessageGroups,
  buttonUsage,
  type ChatTrigger,
  scenarioCardFor,
} from "@/components/admin/bot/scenarios";
import { RichTextView } from "@/components/admin/messages/MessagePreview";
import { TextEditor } from "@/components/admin/messages/editor/TextEditor";
import type { EditorVariable } from "@/components/admin/messages/editor/variables";
import { Badge } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { ConfirmDialog } from "@/components/admin/ui/Dialog";
import { Field, Input } from "@/components/admin/ui/Field";
import { IconButton } from "@/components/admin/ui/IconButton";
import { Notice } from "@/components/admin/ui/Notice";
import { Card } from "@/components/admin/ui/Section";
import { Segmented } from "@/components/admin/ui/Segmented";
import {
  ButtonsIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PhotoIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  VideoIcon,
} from "@/components/icons";
import {
  botMediaUrl,
  type BotTextsResult,
  removeBotMedia,
  resetBotText,
  saveBotText,
  uploadBotMedia,
} from "@/lib/admin/botTexts";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.botTexts;
const wsCopy = copy.workspace;
const messagesCopy = adminUz.messages.editor;
const acceptedTypes = [...BOT_MEDIA_MIME_TYPES.photo, ...BOT_MEDIA_MIME_TYPES.video].join(",");
const placeholderSamples: Record<string, string> = {
  name: "Aziza",
  soat: "20:00",
  vaqt: "Ertaga 08:00",
  link_tugash_vaqti: "21-oktabr, 10:00",
};
const mediaIcons = { photo: PhotoIcon, video: VideoIcon };

type FilterMode = "all" | "core" | "edited";
type Busy = "save" | "reset" | "upload" | "remove" | null;
type PendingNav = { type: "list" } | { type: "select"; key: BotMessageKey } | null;

function isEdited(item: BotTextItem) {
  return item.text !== null || item.media !== null || item.autoDeleteMinutes !== null || item.keepForever;
}

function errorMessage(item: BotTextItem, code: string | undefined) {
  if (code === "unknown_placeholder" && item.placeholders.length === 0) return copy.errors.no_placeholders;
  return copy.errors[code as keyof typeof copy.errors] ?? copy.errors.generic;
}

function plainSnippet(raw: string): string {
  const replaced = raw.replace(/\{([a-z_]+)\}/g, (_, key: string) => placeholderSamples[key] ?? key);
  return replaced.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function TriggerBubble({ trigger }: { trigger: ChatTrigger }) {
  if (trigger.kind === "note") {
    return (
      <p className="m-0 self-center rounded-full bg-siyoh/15 px-3 py-1 text-center text-[11.5px] font-medium text-siyoh">
        {copy.notes[trigger.note ?? "buttonReady"]}
      </p>
    );
  }
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-0.5 self-end">
      <div className="rounded-[13px] rounded-br-[3px] bg-[#e3f6c9] px-3 py-1.5 text-[12.5px] text-siyoh shadow-[0_1px_1px_rgba(18,59,51,0.12)]">
        {copy.user[trigger.text]}
      </div>
      {trigger.context && (
        <span className="pr-1 text-[11px] text-qalam">{copy.userContext[trigger.context]}</span>
      )}
    </div>
  );
}

function MediaThumb({ item }: { item: BotTextItem }) {
  const [failed, setFailed] = useState(false);
  if (!item.media || failed) return null;

  return (
    <div className="relative -mx-3 -mt-2 mb-2 overflow-hidden rounded-t-[14px] bg-siyoh/90">
      {item.media.type === "photo" ? (
        <Image
          src={botMediaUrl(item)}
          alt=""
          width={600}
          height={340}
          unoptimized
          className="max-h-[180px] w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <video
            src={botMediaUrl(item)}
            preload="metadata"
            muted
            playsInline
            className="max-h-[180px] w-full object-cover"
            onError={() => setFailed(true)}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-siyoh/60 text-white">
              <PlayIcon className="h-5 w-5" />
            </span>
          </span>
        </>
      )}
    </div>
  );
}

type PreviewButton = {
  key: BotButtonKey;
  value: string;
  defaultText: string;
};

type TelegramPreviewProps = {
  item: BotTextItem;
  draft: string;
  autoDeleteMinutes: number | null;
  keepForever: boolean;
  trigger: ChatTrigger | undefined;
  inlineButtons: PreviewButton[];
  replyButtons: PreviewButton[];
};

function TelegramPreview({
  item,
  draft,
  autoDeleteMinutes,
  keepForever,
  trigger,
  inlineButtons,
  replyButtons,
}: TelegramPreviewProps) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-chiziq/60 bg-kumush/35 p-3.5">
      <div className="flex items-center justify-between border-b border-chiziq/60 pb-2">
        <span className="text-[12px] font-semibold text-siyoh">{copy.previewTitle}</span>
        <AutoDeleteBadge minutes={autoDeleteMinutes} keepForever={keepForever} />
      </div>

      <div className="flex flex-col gap-2.5 py-1">
        {trigger && <TriggerBubble trigger={trigger} />}

        <div className="flex w-fit min-w-[70%] max-w-[95%] flex-col gap-1 self-start">
          <div className="relative rounded-[14px] rounded-bl-[3px] bg-white px-3 pb-1.5 pt-2 text-[13.5px] leading-[1.45] text-siyoh shadow-[0_1px_2px_rgba(18,59,51,0.14)]">
            <MediaThumb item={item} />
            <div className="flex flex-col gap-0.5 whitespace-pre-wrap break-words">
              <RichTextView text={draft} samples={placeholderSamples} chips />
            </div>
            <p className="m-0 mt-1 text-right text-[10.5px] leading-none text-qalam">
              {copy.messageTime}
            </p>
          </div>

          {inlineButtons.length > 0 && (
            <div className="flex flex-col gap-1">
              {inlineButtons.map((btn) => (
                <div
                  key={btn.key}
                  className="rounded-[9px] bg-siyoh/65 px-3 py-2 text-center text-[13px] font-medium text-white"
                >
                  {btn.value || btn.defaultText}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {replyButtons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-[10px] bg-white/75 p-1.5">
          {replyButtons.map((btn) => (
            <div
              key={btn.key}
              className="flex-1 rounded-[7px] bg-white px-2.5 py-1.5 text-center text-[13px] font-medium text-siyoh shadow-[0_1px_0_rgba(18,59,51,0.2)]"
            >
              {btn.value || btn.defaultText}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type BotWorkspaceProps = {
  items: BotTextItem[];
  mediaEnabled: boolean;
  onItems: (items: BotTextItem[]) => void;
};

export function BotWorkspace({ items, mediaEnabled, onItems }: BotWorkspaceProps) {
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);

  const [selectedKey, setSelectedKey] = useState<BotMessageKey | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  const [draft, setDraft] = useState("");
  const [autoDeleteMinutes, setAutoDeleteMinutes] = useState<number | null>(null);
  const [keepForever, setKeepForever] = useState(false);
  const [buttonDrafts, setButtonDrafts] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingNav>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function openMessage(nextKey: BotMessageKey) {
    const nextItem = byKey.get(nextKey);
    if (!nextItem) return;
    const nextCard = scenarioCardFor(nextKey);
    const nextBtns: Record<string, string> = {};
    for (const btn of nextCard?.buttons ?? []) {
      const btnItem = byKey.get(btn.key);
      if (btnItem) nextBtns[btn.key] = btnItem.text ?? btnItem.defaultText;
    }
    setSelectedKey(nextKey);
    setDraft(nextItem.text ?? nextItem.defaultText);
    setAutoDeleteMinutes(nextItem.autoDeleteMinutes);
    setKeepForever(nextItem.keepForever);
    setButtonDrafts(nextBtns);
    setError(null);
    setSavedNotice(false);
    setTab("edit");
  }

  const editedCount = useMemo(
    () =>
      botMessageGroups.filter((entry) => {
        const item = byKey.get(entry.key);
        return item ? isEdited(item) : false;
      }).length,
    [byKey],
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const entries = botMessageGroups.filter((entry) => {
      const item = byKey.get(entry.key);
      if (!item) return false;
      if (filter === "core" && entry.group !== "core") return false;
      if (filter === "edited" && !isEdited(item)) return false;
      if (!q) return true;
      const info = copy.items[entry.key];
      const itemText = (item.text ?? item.defaultText).toLowerCase();
      const entryCard = scenarioCardFor(entry.key);
      const btnMatch = (entryCard?.buttons ?? []).some((b) => {
        const bItem = byKey.get(b.key);
        const bLabel = copy.items[b.key].label.toLowerCase();
        const bText = (bItem ? bItem.text ?? bItem.defaultText : "").toLowerCase();
        return bLabel.includes(q) || bText.includes(q);
      });
      return (
        info.label.toLowerCase().includes(q) ||
        info.when.toLowerCase().includes(q) ||
        itemText.includes(q) ||
        btnMatch
      );
    });

    const groupIds: BotMessageGroupId[] = ["core", "later", "system"];
    return groupIds
      .map((id) => ({
        id,
        title: wsCopy.groups[id],
        entries: entries.filter((entry) => entry.group === id),
      }))
      .filter((group) => group.entries.length > 0);
  }, [byKey, filter, search]);

  const selectedItem = selectedKey ? byKey.get(selectedKey) ?? null : null;
  const card = selectedKey ? scenarioCardFor(selectedKey) : undefined;
  const selectedIndex = selectedKey ? botMessageGroups.findIndex((entry) => entry.key === selectedKey) : -1;
  const prevEntry = selectedIndex > 0 ? botMessageGroups[selectedIndex - 1] : null;
  const nextEntry =
    selectedIndex >= 0 && selectedIndex < botMessageGroups.length - 1
      ? botMessageGroups[selectedIndex + 1]
      : null;

  const attachedButtons = useMemo(() => {
    if (!selectedItem || !card) return [];
    return card.buttons
      .map((btn) => {
        const btnItem = byKey.get(btn.key);
        if (!btnItem) return null;
        const value = buttonDrafts[btn.key] ?? btnItem.text ?? btnItem.defaultText;
        const original = btnItem.text ?? btnItem.defaultText;
        const btnErr = validateBotText(btn.key, value, false);
        return {
          placement: btn.placement,
          item: btnItem,
          key: btn.key as BotButtonKey,
          value,
          dirty: value !== original,
          error: btnErr,
          usage: buttonUsage(btn.key as BotButtonKey),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [byKey, buttonDrafts, card, selectedItem]);

  const currentMsgText = selectedItem ? selectedItem.text ?? selectedItem.defaultText : "";
  const hasMedia = selectedItem ? selectedItem.media !== null : false;
  const edited = selectedItem ? isEdited(selectedItem) : false;
  const msgDirty = selectedItem
    ? draft !== currentMsgText ||
      autoDeleteMinutes !== selectedItem.autoDeleteMinutes ||
      keepForever !== selectedItem.keepForever
    : false;
  const anyButtonsDirty = attachedButtons.some((b) => b.dirty);
  const dirty = msgDirty || anyButtonsDirty;

  function requestNavigate(target: Exclude<PendingNav, null>) {
    if (dirty) {
      setPendingNav(target);
      return;
    }
    if (target.type === "list") {
      setSelectedKey(null);
      setError(null);
      setSavedNotice(false);
    } else {
      openMessage(target.key);
    }
  }

  function confirmDiscard() {
    if (!pendingNav) return;
    const target = pendingNav;
    setPendingNav(null);
    if (target.type === "list") {
      setSelectedKey(null);
      setError(null);
      setSavedNotice(false);
    } else {
      openMessage(target.key);
    }
  }

  if (!selectedItem) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex w-full items-center sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute left-3 h-4 w-4 text-qalam" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={wsCopy.searchPlaceholder}
              aria-label={wsCopy.searchPlaceholder}
              className="w-full rounded-[10px] border border-chiziq bg-white py-2 pl-9 pr-3 text-[13.5px] text-siyoh placeholder:text-qalam/60 focus:border-siyoh focus:outline-none"
            />
          </div>

          <Segmented
            label={wsCopy.filters.all}
            value={filter}
            onChange={setFilter}
            items={[
              { value: "all", label: `${wsCopy.filters.all} (${botMessageGroups.length})` },
              { value: "core", label: `${wsCopy.filters.core} (5)` },
              {
                value: "edited",
                label: editedCount > 0 ? `${wsCopy.filters.edited} (${editedCount})` : wsCopy.filters.edited,
              },
            ]}
          />
        </div>

        {filteredGroups.length === 0 ? (
          <Card className="py-10 text-center">
            <p className="m-0 text-sm text-qalam">{wsCopy.emptySearch}</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-5">
            {filteredGroups.map((group) => (
              <section key={group.id} className="flex flex-col gap-2">
                <h2 className="m-0 px-1 text-[12px] font-bold uppercase tracking-[0.06em] text-qalam">
                  {group.title} ({group.entries.length})
                </h2>

                <Card className="gap-0 overflow-hidden p-0">
                  <div className="divide-y divide-chiziq/60">
                    {group.entries.map((entry) => {
                      const item = byKey.get(entry.key);
                      if (!item) return null;
                      const info = copy.items[entry.key];
                      const itemEdited = isEdited(item);
                      const entryCard = scenarioCardFor(entry.key);
                      const btnCount = entryCard?.buttons.length ?? 0;
                      const EntryMediaIcon = item.media ? mediaIcons[item.media.type] : null;
                      const snippet = plainSnippet(item.text ?? item.defaultText);

                      return (
                        <button
                          key={entry.key}
                          type="button"
                          onClick={() => openMessage(entry.key)}
                          className="group flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-varaq/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-siyoh sm:px-5"
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            {entry.step !== undefined && (
                              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-varaq text-[12px] font-bold text-siyoh">
                                {entry.step}
                              </span>
                            )}
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[15px] font-semibold text-siyoh">
                                  {info.label}
                                </span>
                                {itemEdited && <Badge tone="attention">{copy.edited}</Badge>}
                              </div>
                              <p className="m-0 text-[13px] text-qalam">{info.when}</p>
                              <p className="m-0 truncate text-[13px] text-siyoh/75">{snippet}</p>
                            </div>
                          </div>

                          <div className="hidden shrink-0 items-center gap-2 sm:flex">
                            {EntryMediaIcon && item.media && (
                              <Badge>
                                <EntryMediaIcon className="mr-1 h-3.5 w-3.5" />
                                {adminUz.messages.mediaBadge[item.media.type]}
                              </Badge>
                            )}
                            {btnCount > 0 && (
                              <Badge>
                                <ButtonsIcon className="mr-1 h-3.5 w-3.5" />
                                {wsCopy.buttonCount.replace("{count}", String(btnCount))}
                              </Badge>
                            )}
                            <AutoDeleteBadge minutes={item.autoDeleteMinutes} keepForever={item.keepForever} />
                            <ChevronRightIcon className="ml-1 h-4 w-4 text-qalam transition-transform group-hover:translate-x-0.5 group-hover:text-siyoh" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  const limit = botTextLimit(selectedItem.key, hasMedia);
  const length = botVisibleLength(draft);
  const validation = validateBotText(selectedItem.key, draft, hasMedia);
  const autoDeleteValid = autoDeleteMinutesSchema.safeParse(autoDeleteMinutes).success;
  const anyButtonsInvalid = attachedButtons.some((b) => b.error !== null);
  const canSave = dirty && validation === null && autoDeleteValid && !anyButtonsInvalid && busy === null;

  const { label, when } = copy.items[selectedItem.key as BotMessageKey];
  const fieldError = error ?? (validation && draft.trim() ? errorMessage(selectedItem, validation) : null);
  const variables: EditorVariable[] = selectedItem.placeholders.map((name) => ({
    name,
    label: (copy.placeholderLabels as Record<string, string>)[name] ?? name,
    sample: placeholderSamples[name] ?? name,
  }));

  async function runSingle(action: Exclude<Busy, null>, request: () => Promise<BotTextsResult>) {
    if (!selectedItem) return;
    setBusy(action);
    setError(null);
    setSavedNotice(false);
    const result = await request();
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(selectedItem, result.error));
      return;
    }
    onItems(result.items);
    if (action === "reset") {
      const fresh = result.items.find((i) => i.key === selectedItem.key);
      if (fresh) {
        setDraft(fresh.text ?? fresh.defaultText);
        setAutoDeleteMinutes(fresh.autoDeleteMinutes);
        setKeepForever(fresh.keepForever);
      }
    }
    setSavedNotice(true);
  }

  async function saveAll() {
    if (!selectedItem) return;
    setBusy("save");
    setError(null);
    setSavedNotice(false);
    let latestItems = items;

    if (msgDirty) {
      const res = await saveBotText(selectedItem.key, {
        text: draft,
        autoDeleteMinutes,
        keepForever,
      });
      if (!res.ok) {
        setBusy(null);
        setError(errorMessage(selectedItem, res.error));
        return;
      }
      latestItems = res.items;
    }

    for (const btn of attachedButtons) {
      if (!btn.dirty) continue;
      const res = await saveBotText(btn.key, { text: btn.value });
      if (!res.ok) {
        onItems(latestItems);
        setBusy(null);
        setError(errorMessage(btn.item, res.error));
        return;
      }
      latestItems = res.items;
    }

    onItems(latestItems);
    setBusy(null);
    setSavedNotice(true);
  }

  const counter = (
    <span className={length > limit ? "text-anor" : ""}>
      {length} / {limit}
    </span>
  );

  const MediaIcon = selectedItem.media ? mediaIcons[selectedItem.media.type] : null;
  const inlineButtons: PreviewButton[] = attachedButtons
    .filter((b) => b.placement === "inline")
    .map((b) => ({ key: b.key, value: b.value, defaultText: b.item.defaultText }));
  const replyButtons: PreviewButton[] = attachedButtons
    .filter((b) => b.placement === "reply")
    .map((b) => ({ key: b.key, value: b.value, defaultText: b.item.defaultText }));

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronLeftIcon className="h-4 w-4" />}
            onClick={() => requestNavigate({ type: "list" })}
          >
            {wsCopy.backToList}
          </Button>

          <div className="flex items-center gap-1.5">
            <IconButton
              label={wsCopy.previousMessage}
              icon={<ChevronLeftIcon className="h-4 w-4" />}
              disabled={!prevEntry}
              onClick={() => prevEntry && requestNavigate({ type: "select", key: prevEntry.key })}
            />
            <span className="min-w-[48px] text-center text-[13px] font-medium tabular-nums text-qalam">
              {selectedIndex + 1} / {botMessageGroups.length}
            </span>
            <IconButton
              label={wsCopy.nextMessage}
              icon={<ChevronRightIcon className="h-4 w-4" />}
              disabled={!nextEntry}
              onClick={() => nextEntry && requestNavigate({ type: "select", key: nextEntry.key })}
            />
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="gap-5 p-5 sm:p-6">
            <div className="flex flex-col gap-1 border-b border-chiziq/60 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 text-[19px] font-bold leading-snug text-siyoh">{label}</h2>
                <div className="flex items-center gap-2">
                  {edited ? <Badge tone="attention">{copy.edited}</Badge> : <Badge>{copy.default}</Badge>}
                  {savedNotice && (
                    <Badge tone="success">
                      <CheckIcon className="mr-1 h-3 w-3" />
                      {copy.saved}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="m-0 text-[13.5px] text-qalam">{when}</p>
            </div>

            <div className="lg:hidden">
              <Segmented
                label={copy.previewTitle}
                role="tablist"
                fill
                value={tab}
                onChange={setTab}
                items={[
                  { value: "edit", label: messagesCopy.tabEdit },
                  { value: "preview", label: messagesCopy.tabPreview },
                ]}
              />
            </div>

            <div className={`${tab === "edit" ? "flex" : "hidden"} flex-col gap-5 lg:flex`}>
              <TextEditor
                key={selectedItem.key}
                value={draft}
                variables={variables}
                onChange={(value) => {
                  setDraft(value);
                  setError(null);
                  setSavedNotice(false);
                }}
                invalid={validation !== null && draft.trim() !== ""}
                error={fieldError}
                counter={counter}
              />

              {attachedButtons.length > 0 && (
                <section className="flex flex-col gap-3 border-t border-chiziq/60 pt-5">
                  <h3 className="m-0 text-sm font-semibold text-siyoh">
                    {wsCopy.buttonsSectionTitle} ({attachedButtons.length})
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {attachedButtons.map((btn) => {
                      const btnLabel = copy.items[btn.key].label;
                      const btnErrText = btn.error ? errorMessage(btn.item, btn.error) : null;
                      return (
                        <div key={btn.key} className="flex flex-col gap-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-siyoh">{btnLabel}</span>
                            {btn.usage > 1 && (
                              <Badge tone="attention">
                                {wsCopy.buttonShared.replace("{count}", String(btn.usage))}
                              </Badge>
                            )}
                          </div>
                          <Field
                            label={btnLabel}
                            hideLabel
                            error={btnErrText}
                            hint={
                              btn.item.placeholders.length > 0
                                ? `${wsCopy.placeholderListPrefix} ${btn.item.placeholders.map((p) => `{${p}}`).join(", ")}`
                                : undefined
                            }
                            counter={
                              <span className={btn.value.length > 64 ? "text-anor" : ""}>
                                {btn.value.length} / 64
                              </span>
                            }
                          >
                            {({ id, describedBy, invalid }) => (
                              <Input
                                id={id}
                                aria-describedby={describedBy}
                                invalid={invalid}
                                value={btn.value}
                                onChange={(e) => {
                                  const cleaned = e.target.value.replace(/\n/g, " ");
                                  setButtonDrafts((prev) => ({ ...prev, [btn.key]: cleaned }));
                                  setError(null);
                                  setSavedNotice(false);
                                }}
                              />
                            )}
                          </Field>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="flex flex-col gap-3 border-t border-chiziq/60 pt-5">
                <h3 className="m-0 text-sm font-semibold text-siyoh">{wsCopy.settingsTitle}</h3>

                <AutoDeletePicker
                  value={autoDeleteMinutes}
                  defaultOption={{
                    active: autoDeleteMinutes === null && !keepForever,
                    onSelect: () => {
                      setAutoDeleteMinutes(null);
                      setKeepForever(false);
                      setError(null);
                      setSavedNotice(false);
                    },
                    onNever: () => {
                      setAutoDeleteMinutes(null);
                      setKeepForever(true);
                      setError(null);
                      setSavedNotice(false);
                    },
                  }}
                  onChange={(next) => {
                    setAutoDeleteMinutes(next);
                    setKeepForever(false);
                    setError(null);
                    setSavedNotice(false);
                  }}
                />

                <input
                  ref={fileInput}
                  type="file"
                  accept={acceptedTypes}
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void runSingle("upload", () => uploadBotMedia(selectedItem.key, file));
                  }}
                />

                <div className="flex flex-col gap-1.5 rounded-[12px] border border-chiziq p-3">
                  <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-siyoh">
                      {MediaIcon && selectedItem.media ? (
                        <>
                          <MediaIcon className="h-4 w-4 shrink-0 text-qalam" />
                          <span className="truncate">{adminUz.messages.mediaBadge[selectedItem.media.type]}</span>
                        </>
                      ) : (
                        messagesCopy.media
                      )}
                    </span>
                    {!mediaEnabled ? (
                      <span className="text-[13px] text-qalam">{messagesCopy.mediaDisabled}</span>
                    ) : hasMedia ? (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy !== null}
                          loading={busy === "upload"}
                          loadingLabel={copy.uploading}
                          onClick={() => fileInput.current?.click()}
                        >
                          {copy.replaceMedia}
                        </Button>
                        <Button
                          variant="dangerGhost"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void runSingle("remove", () => removeBotMedia(selectedItem.key))}
                        >
                          {copy.removeMedia}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        loading={busy === "upload"}
                        loadingLabel={copy.uploading}
                        icon={<PlusIcon className="h-4 w-4" />}
                        onClick={() => fileInput.current?.click()}
                      >
                        {messagesCopy.add}
                      </Button>
                    )}
                  </div>
                  {mediaEnabled && <p className="m-0 text-[13px] text-qalam/80">{copy.mediaHint}</p>}
                </div>
              </section>

              {error && <Notice tone="danger">{error}</Notice>}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-chiziq/70 pt-4">
                {edited ? (
                  <Button variant="ghost" disabled={busy !== null} onClick={() => setResetOpen(true)}>
                    {copy.reset}
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  disabled={!canSave}
                  loading={busy === "save"}
                  loadingLabel={copy.saving}
                  icon={<CheckIcon className="h-4 w-4" />}
                  onClick={() => void saveAll()}
                >
                  {copy.save}
                </Button>
              </div>
            </div>

            {tab === "preview" && (
              <div className="lg:hidden">
                <TelegramPreview
                  item={selectedItem}
                  draft={draft}
                  autoDeleteMinutes={autoDeleteMinutes}
                  keepForever={keepForever}
                  trigger={card?.trigger}
                  inlineButtons={inlineButtons}
                  replyButtons={replyButtons}
                />
              </div>
            )}
          </Card>

          <div className="hidden lg:sticky lg:top-4 lg:block">
            <TelegramPreview
              item={selectedItem}
              draft={draft}
              autoDeleteMinutes={autoDeleteMinutes}
              keepForever={keepForever}
              trigger={card?.trigger}
              inlineButtons={inlineButtons}
              replyButtons={replyButtons}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title={copy.resetConfirmTitle}
        description={copy.resetConfirm}
        confirmLabel={copy.reset}
        busy={busy === "reset"}
        onConfirm={() => {
          void runSingle("reset", () => resetBotText(selectedItem.key)).then(() => setResetOpen(false));
        }}
        onCancel={() => setResetOpen(false)}
      />

      <ConfirmDialog
        open={pendingNav !== null}
        title={wsCopy.discardTitle}
        description={wsCopy.discardDescription}
        confirmLabel={wsCopy.discardConfirm}
        onConfirm={confirmDiscard}
        onCancel={() => setPendingNav(null)}
      />
    </>
  );
}
