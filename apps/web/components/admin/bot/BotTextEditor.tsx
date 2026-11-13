"use client";

import { useRef, useState } from "react";
import {
  BOT_MEDIA_MIME_TYPES,
  type BotButtonKey,
  type BotTextItem,
  botTextLimit,
  botVisibleLength,
  validateBotText,
} from "@funnel/shared";
import { buttonUsage } from "@/components/admin/bot/scenarios";
import { EditBadge, MediaThumb } from "@/components/admin/bot/BotChat";
import { AutoDeletePicker } from "@/components/admin/messages/AutoDeletePicker";
import { RichTextView } from "@/components/admin/messages/MessagePreview";
import { TextEditor } from "@/components/admin/messages/editor/TextEditor";
import type { EditorVariable } from "@/components/admin/messages/editor/variables";
import { Button } from "@/components/admin/ui/Button";
import { ConfirmDialog, Sheet } from "@/components/admin/ui/Dialog";
import { Field, Input } from "@/components/admin/ui/Field";
import { Notice } from "@/components/admin/ui/Notice";
import { Segmented } from "@/components/admin/ui/Segmented";
import { PhotoIcon, PlusIcon, VideoIcon } from "@/components/icons";
import { type BotTextsResult, removeBotMedia, resetBotText, saveBotText, uploadBotMedia } from "@/lib/admin/botTexts";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.botTexts;
const messagesCopy = adminUz.messages.editor;
const acceptedTypes = [...BOT_MEDIA_MIME_TYPES.photo, ...BOT_MEDIA_MIME_TYPES.video].join(",");
const placeholderSamples: Record<string, string> = {
  name: "Aziza",
  soat: "20:00",
  vaqt: "Ertaga 08:00",
  link_tugash_vaqti: "21-oktabr, 10:00",
};
const mediaIcons = { photo: PhotoIcon, video: VideoIcon };

type Busy = "save" | "reset" | "upload" | "remove" | null;

function errorMessage(item: BotTextItem, code: string | undefined) {
  if (code === "unknown_placeholder" && item.placeholders.length === 0) return copy.errors.no_placeholders;
  return copy.errors[code as keyof typeof copy.errors] ?? copy.errors.generic;
}

type BotTextEditorProps = {
  item: BotTextItem;
  mediaEnabled: boolean;
  onItems: (items: BotTextItem[]) => void;
  onClose: () => void;
};

const MONTHS_UZ = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
];

function parseTashkentParts(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() + 5 * 3600 * 1000;
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

function buildTashkentIso(parts: { year: number; month: number; day: number; hour: number; minute: number }): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:00+05:00`;
}

export function BotTextEditor({ item, mediaEnabled, onItems, onClose }: BotTextEditorProps) {
  const current = item.text ?? item.defaultText;
  const isButton = item.kind === "button";
  const [draft, setDraft] = useState(current);
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(item.scheduledAt));
  const [schedParts, setSchedParts] = useState(() => {
    const existing = parseTashkentParts(item.scheduledAt);
    if (existing) return existing;
    const now = parseTashkentParts(new Date().toISOString())!;
    return { ...now, hour: 20, minute: 0 };
  });
  const [autoDeleteMinutes, setAutoDeleteMinutes] = useState<number | null>(item.autoDeleteMinutes ?? null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [resetOpen, setResetOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const nextScheduledAt = !isButton && scheduleEnabled ? buildTashkentIso(schedParts) : null;
  const scheduleDirty =
    !isButton &&
    ((nextScheduledAt ? new Date(nextScheduledAt).getTime() : null) !==
      (item.scheduledAt ? new Date(item.scheduledAt).getTime() : null) ||
      autoDeleteMinutes !== (item.autoDeleteMinutes ?? null));

  const hasMedia = item.media !== null;
  const edited = item.text !== null || hasMedia;
  const limit = botTextLimit(item.key, hasMedia);
  const length = isButton ? draft.length : botVisibleLength(draft);
  const validation = validateBotText(item.key, draft, hasMedia);
  const dirty = draft !== current || scheduleDirty;
  const { label } = copy.items[item.key];
  const fieldError = error ?? (validation && draft.trim() ? errorMessage(item, validation) : null);
  const variables: EditorVariable[] = item.placeholders.map((name) => ({
    name,
    label: (copy.placeholderLabels as Record<string, string>)[name] ?? name,
    sample: placeholderSamples[name] ?? name,
  }));

  async function run(action: Exclude<Busy, null>, request: () => Promise<BotTextsResult>, after?: () => void) {
    setBusy(action);
    setError(null);
    const result = await request();
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(item, result.error));
      return;
    }
    onItems(result.items);
    after?.();
  }

  const save = () =>
    run(
      "save",
      () =>
        saveBotText(
          item.key,
          draft,
          isButton ? undefined : { scheduledAt: nextScheduledAt, autoDeleteMinutes },
        ),
      onClose,
    );

  const reset = async () => {
    await run("reset", () => resetBotText(item.key), onClose);
    setResetOpen(false);
  };

  const counter = (
    <span className={length > limit ? "text-anor" : ""}>
      {length} / {limit}
    </span>
  );

  const MediaIcon = item.media ? mediaIcons[item.media.type] : null;

  const footer = (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {edited ? (
          <Button variant="ghost" disabled={busy !== null} onClick={() => setResetOpen(true)}>
            {copy.reset}
          </Button>
        ) : (
          <span />
        )}
        <Button
          disabled={!dirty || validation !== null || busy !== null}
          loading={busy === "save"}
          loadingLabel={copy.saving}
          onClick={() => void save()}
        >
          {copy.save}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={isButton ? copy.editTitleButton : copy.editTitleMessage}
        size={isButton ? "default" : "wide"}
        footer={footer}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-semibold text-siyoh">{label}</span>
            <EditBadge item={item} />
          </div>
          <p className="m-0 -mt-3 text-[13px] text-qalam">{copy.items[item.key].when}</p>
          {isButton && buttonUsage(item.key as BotButtonKey) > 1 && (
            <p className="m-0 -mt-2 text-[13px] text-qalam">{copy.usedIn(buttonUsage(item.key as BotButtonKey))}</p>
          )}

          {isButton ? (
            <Field label={copy.buttonLabel} error={fieldError} counter={counter}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value.replace(/\n/g, " "));
                    setError(null);
                  }}
                />
              )}
            </Field>
          ) : (
            <>
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
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-8">
                <div className={`${tab === "edit" ? "flex" : "hidden"} flex-col gap-5 lg:flex`}>
                  <TextEditor
                    label={label}
                    value={draft}
                    variables={variables}
                    onChange={(value) => {
                      setDraft(value);
                      setError(null);
                    }}
                    invalid={validation !== null && draft.trim() !== ""}
                    error={fieldError}
                    counter={counter}
                  />

                  <input
                    ref={fileInput}
                    type="file"
                    accept={acceptedTypes}
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void run("upload", () => uploadBotMedia(item.key, file));
                    }}
                  />
                  <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border border-chiziq px-3 py-1">
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold text-siyoh">
                      {MediaIcon && item.media ? (
                        <>
                          <MediaIcon className="h-5 w-5 shrink-0 text-qalam" />
                          <span className="truncate">{adminUz.messages.mediaBadge[item.media.type]}</span>
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
                          onClick={() => void run("remove", () => removeBotMedia(item.key))}
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
                  {mediaEnabled && <p className="m-0 -mt-3 text-[13px] text-qalam">{copy.mediaHint}</p>}

                  <div className="flex flex-col gap-3 rounded-[12px] border border-chiziq p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-siyoh">
                        Belgilangan sana va vaqtda yuborish (Toshkent vaqti)
                      </span>
                      <input
                        type="checkbox"
                        checked={scheduleEnabled}
                        onChange={(e) => setScheduleEnabled(e.target.checked)}
                        className="h-4 w-4 accent-siyoh cursor-pointer"
                      />
                    </div>
                    {item.scheduledSentAt && (
                      <p className="m-0 text-xs text-emerald-700">
                        Oxirgi yuborilgan: {new Date(item.scheduledSentAt).toLocaleString("uz-UZ")}
                      </p>
                    )}
                    {scheduleEnabled && (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <Field label="Yil">
                          {({ id }) => (
                            <select
                              id={id}
                              value={schedParts.year}
                              onChange={(e) => setSchedParts((p) => ({ ...p, year: Number(e.target.value) }))}
                              className="w-full rounded-xl border border-chiziq bg-white px-2.5 py-2 text-sm text-siyoh"
                            >
                              {[2026, 2027, 2028].map((y) => (
                                <option key={y} value={y}>
                                  {y}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                        <Field label="Oy">
                          {({ id }) => (
                            <select
                              id={id}
                              value={schedParts.month}
                              onChange={(e) => setSchedParts((p) => ({ ...p, month: Number(e.target.value) }))}
                              className="w-full rounded-xl border border-chiziq bg-white px-2.5 py-2 text-sm text-siyoh"
                            >
                              {MONTHS_UZ.map((m, idx) => (
                                <option key={m} value={idx + 1}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                        <Field label="Kun">
                          {({ id }) => (
                            <select
                              id={id}
                              value={schedParts.day}
                              onChange={(e) => setSchedParts((p) => ({ ...p, day: Number(e.target.value) }))}
                              className="w-full rounded-xl border border-chiziq bg-white px-2.5 py-2 text-sm text-siyoh"
                            >
                              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                        <Field label="Soat">
                          {({ id }) => (
                            <select
                              id={id}
                              value={schedParts.hour}
                              onChange={(e) => setSchedParts((p) => ({ ...p, hour: Number(e.target.value) }))}
                              className="w-full rounded-xl border border-chiziq bg-white px-2.5 py-2 text-sm text-siyoh"
                            >
                              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                                <option key={h} value={h}>
                                  {String(h).padStart(2, "0")}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                        <Field label="Daqiqa">
                          {({ id }) => (
                            <select
                              id={id}
                              value={schedParts.minute}
                              onChange={(e) => setSchedParts((p) => ({ ...p, minute: Number(e.target.value) }))}
                              className="w-full rounded-xl border border-chiziq bg-white px-2.5 py-2 text-sm text-siyoh"
                            >
                              {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                                <option key={m} value={m}>
                                  {String(m).padStart(2, "0")}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                      </div>
                    )}
                    <AutoDeletePicker value={autoDeleteMinutes} onChange={setAutoDeleteMinutes} />
                  </div>
                </div>

                <div className={`${tab === "preview" ? "flex" : "hidden"} flex-col gap-2 lg:sticky lg:top-0 lg:flex lg:self-start`}>
                  <div className="rounded-[16px] bg-kumush/35 p-3">
                    <div className="max-w-[340px] rounded-[16px] rounded-bl-[4px] bg-white px-3 py-2 text-sm leading-[1.45] text-siyoh">
                      <MediaThumb item={item} />
                      <div className="flex flex-col gap-0.5 whitespace-pre-wrap break-words">
                        <RichTextView text={draft} samples={placeholderSamples} chips />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={resetOpen}
        title={copy.resetConfirmTitle}
        description={copy.resetConfirm}
        confirmLabel={copy.reset}
        busy={busy === "reset"}
        onConfirm={() => void reset()}
        onCancel={() => setResetOpen(false)}
      />
    </>
  );
}
