"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  autoDeleteMinutesSchema,
  type BroadcastAudience,
  type BroadcastButton,
  type BroadcastButtonKind,
  broadcastButtonKinds,
  type BroadcastInput,
  buttonPresets,
  MAX_TEMPLATE_BUTTONS,
  sanitizeTelegramHtml,
  type ScheduledBroadcast,
  TASHKENT_OFFSET_MS,
  TEMPLATE_MEDIA_MIME_TYPES,
  type TemplateButton,
  templateTextLimit,
  validateBroadcastText,
  visibleLength,
} from "@funnel/shared";
import { AutoDeletePicker } from "@/components/admin/AutoDeletePicker";
import { MessagePreview } from "@/components/admin/messages/MessagePreview";
import { TextEditor } from "@/components/admin/messages/editor/TextEditor";
import { templateEditorVariables } from "@/components/admin/messages/editor/variables";
import { Button } from "@/components/admin/ui/Button";
import { Sheet } from "@/components/admin/ui/Dialog";
import { Field, Input } from "@/components/admin/ui/Field";
import { IconButton } from "@/components/admin/ui/IconButton";
import { Notice } from "@/components/admin/ui/Notice";
import { Segmented } from "@/components/admin/ui/Segmented";
import { Select } from "@/components/admin/ui/Select";
import { CheckIcon, CloseIcon, ClockIcon, PhotoIcon, PlusIcon, VideoIcon, VoiceIcon } from "@/components/icons";
import {
  broadcastMediaUrl,
  type BroadcastsResult,
  createBroadcast,
  previewBroadcast,
  updateBroadcast,
  uploadBroadcastMedia,
} from "@/lib/admin/broadcasts";
import { formatCount } from "@/lib/admin/rollouts";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.broadcasts;
const editorCopy = copy.editor;
const msgEditorCopy = adminUz.messages.editor;
const mediaIcons = { photo: PhotoIcon, video: VideoIcon, voice: VoiceIcon };
const acceptedMedia = Object.values(TEMPLATE_MEDIA_MIME_TYPES).flat().join(",");
const broadcastVariablesList = templateEditorVariables.filter((variable) => variable.name === "ism");
const YEARS = [2026, 2027, 2028] as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);
const PREVIEW_DEBOUNCE_MS = 300;

type SchedulePreset = "now" | "todayEvening" | "tomorrowMorning" | "tomorrowEvening" | "custom";

type ScheduleParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const audienceColumns: { title: string; keys: BroadcastAudience[] }[] = [
  { title: editorCopy.audienceGroups.general, keys: ["all"] },
  { title: editorCopy.audienceGroups.stages, keys: ["A", "B", "C", "E"] },
  { title: editorCopy.audienceGroups.purchase, keys: ["bought", "not_bought"] },
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampYear(rawYear: number): number {
  return (YEARS as readonly number[]).includes(rawYear)
    ? rawYear
    : rawYear < YEARS[0]
      ? YEARS[0]
      : YEARS[YEARS.length - 1];
}

function isoToTashkentParts(iso: string): ScheduleParts {
  const local = new Date(new Date(iso).getTime() + TASHKENT_OFFSET_MS);
  const year = clampYear(local.getUTCFullYear());
  const month = local.getUTCMonth() + 1;
  const maxDay = daysInMonth(year, month);
  return {
    year,
    month,
    day: Math.min(local.getUTCDate(), maxDay),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

function tashkentPresetParts(dayOffset: number, hour: number, minute: number): ScheduleParts {
  const nowLocal = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const target = new Date(
    Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() + dayOffset, hour, minute),
  );
  return {
    year: clampYear(target.getUTCFullYear()),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate(),
    hour: target.getUTCHours(),
    minute: target.getUTCMinutes(),
  };
}

function tashkentPartsToIso(parts: ScheduleParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:00+05:00`;
}

function nowTashkentIso(): string {
  const local = new Date(Date.now() + TASHKENT_OFFSET_MS);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+05:00`;
}

function convertBroadcastButton(button: BroadcastButton, kind: BroadcastButtonKind): BroadcastButton {
  const preset = kind === "resume" ? buttonPresets.resume : "";
  const text = preset || (button.text === buttonPresets.resume ? "" : button.text);
  if (kind === "link") return { kind, text, url: "" };
  if (kind === "admin") return { kind, text, prefill: "" };
  return { kind, text };
}

function errorText(code: string | undefined, variable?: string) {
  const template = copy.errors[code as keyof typeof copy.errors] ?? copy.errors.generic;
  return template.replace("{variable}", variable ?? "");
}

type BroadcastButtonsEditorProps = {
  buttons: BroadcastButton[];
  onChange: (buttons: BroadcastButton[]) => void;
};

function BroadcastButtonsEditor({ buttons, onChange }: BroadcastButtonsEditorProps) {
  const kindOptions = broadcastButtonKinds.map((kind) => ({
    value: kind,
    label: msgEditorCopy.buttonKinds[kind],
  }));

  const update = (index: number, button: BroadcastButton) =>
    onChange(buttons.map((current, i) => (i === index ? button : current)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-chiziq">
        {buttons.map((button, index) => (
          <div key={index} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
              <Field label={msgEditorCopy.buttonKind} hideLabel>
                {({ id }) => (
                  <Select
                    id={id}
                    value={button.kind}
                    onValueChange={(next) => update(index, convertBroadcastButton(button, next as BroadcastButtonKind))}
                    options={kindOptions}
                  />
                )}
              </Field>
              <Field label={msgEditorCopy.buttonText} hideLabel className="order-last col-span-2 sm:order-none sm:col-span-1">
                {({ id }) => (
                  <Input
                    id={id}
                    value={button.text}
                    maxLength={64}
                    placeholder={msgEditorCopy.buttonText}
                    onChange={(e) => update(index, { ...button, text: e.target.value })}
                  />
                )}
              </Field>
              <IconButton
                label={msgEditorCopy.removeButton}
                icon={<CloseIcon className="h-5 w-5" />}
                onClick={() => onChange(buttons.filter((_, i) => i !== index))}
              />
            </div>
            {button.kind === "link" && (
              <Field label={msgEditorCopy.buttonUrlLabel} hideLabel>
                {({ id }) => (
                  <Input
                    id={id}
                    value={button.url}
                    inputMode="url"
                    placeholder={msgEditorCopy.buttonUrl}
                    onChange={(e) => update(index, { ...button, url: e.target.value })}
                  />
                )}
              </Field>
            )}
            {button.kind === "admin" && (
              <Field label={msgEditorCopy.buttonPrefill} hideLabel>
                {({ id }) => (
                  <Input
                    id={id}
                    value={button.prefill ?? ""}
                    maxLength={200}
                    placeholder={msgEditorCopy.buttonPrefill}
                    onChange={(e) => update(index, { ...button, prefill: e.target.value })}
                  />
                )}
              </Field>
            )}
          </div>
        ))}
      </div>

      {buttons.length < MAX_TEMPLATE_BUTTONS && (
        <div>
          <Button
            variant="secondary"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => onChange([...buttons, { kind: "resume", text: buttonPresets.resume }])}
          >
            {msgEditorCopy.addButton}
          </Button>
        </div>
      )}
    </div>
  );
}

type BroadcastEditorProps = {
  item: ScheduledBroadcast | null;
  duplicateFrom?: ScheduledBroadcast | null;
  mediaEnabled: boolean;
  onSaved: (item: ScheduledBroadcast) => void;
  onClose: () => void;
};

export function BroadcastEditor({
  item,
  duplicateFrom = null,
  mediaEnabled,
  onSaved,
  onClose,
}: BroadcastEditorProps) {
  const source = item ?? duplicateFrom;
  const [text, setText] = useState(source?.text ?? "");
  const [media, setMedia] = useState<{ type: "photo" | "video" | "voice"; fileId: string } | null>(
    source?.media?.fileId ? { type: source.media.type, fileId: source.media.fileId } : null,
  );
  const [buttons, setButtons] = useState<BroadcastButton[]>(source?.buttons ?? []);
  const [audiences, setAudiences] = useState<BroadcastAudience[]>(source?.audiences ?? ["all"]);
  const [preset, setPreset] = useState<SchedulePreset>(item ? "custom" : "tomorrowMorning");
  const [schedule, setSchedule] = useState<ScheduleParts>(() =>
    item
      ? isoToTashkentParts(item.scheduledAt)
      : tashkentPresetParts(1, 9, 0),
  );
  const [autoDeleteMinutes, setAutoDeleteMinutes] = useState<number | null>(source?.autoDeleteMinutes ?? null);
  const [busy, setBusy] = useState<"save" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localMedia, setLocalMedia] = useState<{ url: string; type: string } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [preview, setPreview] = useState<{ key: string; count: number | null } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (localMedia) URL.revokeObjectURL(localMedia.url);
    };
  }, [localMedia]);

  const audienceKey = audiences.join(",");

  useEffect(() => {
    if (audiences.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void previewBroadcast(audiences, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setPreview({ key: audienceKey, count: result.ok ? result.data : null });
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [audiences, audienceKey]);

  const hasMedia = media !== null || Boolean(source?.media);
  const sanitized = sanitizeTelegramHtml(text);
  const textError = validateBroadcastText(text, hasMedia);
  const length = sanitized.ok ? visibleLength(sanitized.html) : text.length;
  const limit = templateTextLimit(hasMedia);
  const textMessage = text && textError ? errorText(textError.error, textError.variable) : null;
  const buttonsValid = buttons.every(
    (button) => button.text.trim() && (button.kind !== "link" || button.url.startsWith("https://")),
  );
  const autoDeleteValid = autoDeleteMinutesSchema.safeParse(autoDeleteMinutes).success;
  const audiencesValid = audiences.length > 0;

  const previewLoading = audiencesValid && preview?.key !== audienceKey;
  const previewFailedFetch = audiencesValid && !previewLoading && preview?.count === null;
  const recipientCount = audiencesValid && !previewLoading ? (preview?.count ?? null) : null;

  const yearOptions = useMemo(
    () => YEARS.map((year) => ({ value: String(year), label: String(year) })),
    [],
  );
  const monthOptions = useMemo(
    () => adminUz.pickers.months.map((label, index) => ({ value: String(index + 1), label })),
    [],
  );
  const dayOptions = useMemo(() => {
    const count = daysInMonth(schedule.year, schedule.month);
    return Array.from({ length: count }, (_, index) => {
      const value = index + 1;
      return { value: String(value), label: pad(value) };
    });
  }, [schedule.year, schedule.month]);
  const hourOptions = useMemo(
    () => HOURS.map((hour) => ({ value: String(hour), label: pad(hour) })),
    [],
  );
  const minuteOptions = useMemo(
    () => MINUTES.map((minute) => ({ value: String(minute), label: pad(minute) })),
    [],
  );

  function updateSchedule(patch: Partial<ScheduleParts>) {
    setPreset("custom");
    setError(null);
    setSchedule((current) => {
      const next = { ...current, ...patch };
      const maxDay = daysInMonth(next.year, next.month);
      return { ...next, day: Math.min(next.day, maxDay) };
    });
  }

  function applyPreset(nextPreset: SchedulePreset) {
    setPreset(nextPreset);
    setError(null);
    if (nextPreset === "now") {
      setSchedule(isoToTashkentParts(nowTashkentIso()));
    } else if (nextPreset === "todayEvening") {
      setSchedule(tashkentPresetParts(0, 20, 0));
    } else if (nextPreset === "tomorrowMorning") {
      setSchedule(tashkentPresetParts(1, 9, 0));
    } else if (nextPreset === "tomorrowEvening") {
      setSchedule(tashkentPresetParts(1, 20, 0));
    }
  }

  function toggleAudience(target: BroadcastAudience) {
    setError(null);
    setAudiences((current) => {
      if (target === "all") {
        return current.includes("all") ? [] : ["all"];
      }
      const withoutAll = current.filter((value) => value !== "all");
      return withoutAll.includes(target)
        ? withoutAll.filter((value) => value !== target)
        : [...withoutAll, target];
    });
  }

  async function run<T>(
    action: NonNullable<typeof busy>,
    request: () => Promise<BroadcastsResult<T>>,
    after: (data: T) => void,
  ) {
    setBusy(action);
    setError(null);
    const result = await request();
    setBusy(null);
    if (!result.ok) {
      setError(errorText(result.error, result.variable));
      return;
    }
    after(result.data);
  }

  const upload = (file: File) =>
    run(
      "upload",
      () => uploadBroadcastMedia(file),
      (uploaded) => {
        setPreviewFailed(false);
        setLocalMedia({ url: URL.createObjectURL(file), type: uploaded.type });
        setMedia(uploaded);
      },
    );

  const save = () => {
    const payload: BroadcastInput = {
      text,
      media: media ?? null,
      buttons,
      audiences,
      scheduledAt: preset === "now" ? nowTashkentIso() : tashkentPartsToIso(schedule),
      autoDeleteMinutes,
    };
    return run(
      "save",
      () => (item ? updateBroadcast(item.id, payload) : createBroadcast(payload)),
      (saved) => onSaved(saved),
    );
  };

  const canSubmit =
    textError === null &&
    buttonsValid &&
    autoDeleteValid &&
    audiencesValid &&
    busy === null;

  const previewSrc =
    localMedia?.url ??
    (source?.media && (!media || media.fileId === source.media.fileId)
      ? broadcastMediaUrl(source)
      : null);
  const mediaType = media?.type ?? source?.media?.type;
  const MediaIcon = mediaType ? mediaIcons[mediaType] : null;

  const sheetTitle = item
    ? editorCopy.editTitle
    : duplicateFrom
      ? editorCopy.duplicateTitle
      : editorCopy.newTitle;

  const footer = (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-medium text-siyoh">
          {!audiencesValid ? (
            <span className="text-anor">{editorCopy.audiencesRequired}</span>
          ) : previewLoading ? (
            <span className="text-qalam">{editorCopy.previewLoading}</span>
          ) : previewFailedFetch ? (
            <span className="text-anor">{editorCopy.previewError}</span>
          ) : recipientCount !== null ? (
            recipientCount === 0
              ? editorCopy.previewZero
              : editorCopy.previewCount.replace("{count}", formatCount(recipientCount))
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" disabled={busy !== null} onClick={onClose}>
            {adminUz.confirm.cancel}
          </Button>
          <Button
            disabled={!canSubmit}
            loading={busy === "save"}
            loadingLabel={editorCopy.saving}
            onClick={() => void save()}
          >
            {item ? editorCopy.saveEdit : preset === "now" ? editorCopy.presets.now : editorCopy.save}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Sheet
      open
      onClose={() => {
        if (busy === null) onClose();
      }}
      title={sheetTitle}
      size="wide"
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        <div className="lg:hidden">
          <Segmented
            label={msgEditorCopy.preview}
            role="tablist"
            fill
            value={tab}
            onChange={setTab}
            items={[
              { value: "edit", label: msgEditorCopy.tabEdit },
              { value: "preview", label: msgEditorCopy.tabPreview },
            ]}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-8">
          <div className={`${tab === "edit" ? "flex" : "hidden"} flex-col gap-5 lg:flex`}>
            <TextEditor
              value={text}
              variables={broadcastVariablesList}
              onChange={(next) => {
                setText(next);
                setError(null);
              }}
              invalid={textError !== null && text.trim() !== ""}
              error={textMessage}
              counter={
                <span className={length > limit ? "text-anor" : ""}>
                  {length} / {limit}
                </span>
              }
            />

            <section className="flex flex-col gap-3 rounded-[12px] border border-chiziq p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-siyoh">
                  <ClockIcon className="h-4 w-4 text-qalam" />
                  {editorCopy.scheduleTitle}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: "now", label: editorCopy.presets.now },
                    { id: "todayEvening", label: editorCopy.presets.todayEvening },
                    { id: "tomorrowMorning", label: editorCopy.presets.tomorrowMorning },
                    { id: "tomorrowEvening", label: editorCopy.presets.tomorrowEvening },
                    { id: "custom", label: editorCopy.presets.custom },
                  ] as const
                ).map((opt) => {
                  const active = preset === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => applyPreset(opt.id)}
                      className={`inline-flex min-h-9 items-center rounded-[9px] px-3 py-1 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-siyoh ${
                        active
                          ? "bg-siyoh font-semibold text-varaq"
                          : "bg-varaq font-medium text-siyoh hover:bg-chiziq/70"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Field label={editorCopy.yearLabel}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={String(schedule.year)}
                      onValueChange={(next) => updateSchedule({ year: Number(next) })}
                      options={yearOptions}
                    />
                  )}
                </Field>
                <Field label={editorCopy.monthLabel}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={String(schedule.month)}
                      onValueChange={(next) => updateSchedule({ month: Number(next) })}
                      options={monthOptions}
                    />
                  )}
                </Field>
                <Field label={editorCopy.dayLabel}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={String(schedule.day)}
                      onValueChange={(next) => updateSchedule({ day: Number(next) })}
                      options={dayOptions}
                    />
                  )}
                </Field>
                <Field label={editorCopy.hourLabel}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={String(schedule.hour)}
                      onValueChange={(next) => updateSchedule({ hour: Number(next) })}
                      options={hourOptions}
                    />
                  )}
                </Field>
                <Field label={editorCopy.minuteLabel}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={String(schedule.minute)}
                      onValueChange={(next) => updateSchedule({ minute: Number(next) })}
                      options={minuteOptions}
                    />
                  )}
                </Field>
              </div>

              {preset === "now" && <p className="m-0 text-[13px] text-zumrad">{editorCopy.sendNowHint}</p>}
            </section>

            <section className="flex flex-col gap-3 rounded-[12px] border border-chiziq p-3">
              <span className="text-sm font-medium text-siyoh">{editorCopy.audiencesLabel}</span>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {audienceColumns.map((col) => (
                  <div
                    key={col.title}
                    className="flex flex-col gap-1.5 rounded-[10px] border border-chiziq/60 bg-varaq/35 p-2.5"
                  >
                    <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-qalam">
                      {col.title}
                    </span>
                    {col.keys.map((audience) => {
                      const selected = audiences.includes(audience);
                      return (
                        <button
                          key={audience}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleAudience(audience)}
                          className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-[9px] border px-2.5 py-1.5 text-left text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-siyoh ${
                            selected
                              ? "border-siyoh bg-siyoh font-semibold text-white"
                              : "border-chiziq/70 bg-white font-medium text-siyoh hover:bg-varaq/60"
                          }`}
                        >
                          <span className="min-w-0 truncate">{editorCopy.audiences[audience]}</span>
                          {selected && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>

            <AutoDeletePicker value={autoDeleteMinutes} onChange={setAutoDeleteMinutes} />

            <input
              ref={fileInput}
              type="file"
              accept={acceptedMedia}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border border-chiziq px-3 py-1">
              <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold text-siyoh">
                {MediaIcon && mediaType ? (
                  <>
                    <MediaIcon className="h-5 w-5 shrink-0 text-qalam" />
                    <span className="truncate">{adminUz.messages.mediaBadge[mediaType]}</span>
                  </>
                ) : (
                  msgEditorCopy.media
                )}
              </span>
              {!mediaEnabled ? (
                <span className="text-[13px] text-qalam">{msgEditorCopy.mediaDisabled}</span>
              ) : media ? (
                <span className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    loading={busy === "upload"}
                    loadingLabel={msgEditorCopy.uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {msgEditorCopy.replaceMedia}
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      setLocalMedia(null);
                      setMedia(null);
                    }}
                  >
                    {msgEditorCopy.removeMedia}
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  loading={busy === "upload"}
                  loadingLabel={msgEditorCopy.uploading}
                  icon={<PlusIcon className="h-4 w-4" />}
                  onClick={() => fileInput.current?.click()}
                >
                  {msgEditorCopy.add}
                </Button>
              )}
            </div>

            <section aria-labelledby="broadcast-buttons-title" className="flex flex-col gap-2">
              <h3 id="broadcast-buttons-title" className="m-0 text-sm font-medium text-siyoh">
                {msgEditorCopy.buttonsTitle}
              </h3>
              <BroadcastButtonsEditor buttons={buttons} onChange={setButtons} />
            </section>
          </div>

          <div className={`${tab === "preview" ? "flex" : "hidden"} flex-col gap-2 lg:sticky lg:top-0 lg:flex lg:self-start`}>
            {mediaType && previewSrc && !previewFailed && (
              <div className="overflow-hidden rounded-[12px] bg-varaq">
                {mediaType === "photo" ? (
                  <Image
                    src={previewSrc}
                    alt=""
                    width={800}
                    height={450}
                    unoptimized
                    className="max-h-[220px] w-full object-contain"
                    onError={() => setPreviewFailed(true)}
                  />
                ) : mediaType === "video" ? (
                  <video src={previewSrc} controls preload="metadata" className="max-h-[220px] w-full bg-black" onError={() => setPreviewFailed(true)} />
                ) : (
                  <audio src={previewSrc} controls preload="metadata" className="w-full" onError={() => setPreviewFailed(true)} />
                )}
              </div>
            )}
            {mediaType && (!previewSrc || previewFailed) && (
              <p className="m-0 text-[13px] text-qalam">{msgEditorCopy.mediaPreviewUnavailable}</p>
            )}
            <MessagePreview text={text} buttons={buttons as TemplateButton[]} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
