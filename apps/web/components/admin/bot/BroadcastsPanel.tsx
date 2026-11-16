"use client";

import { useState } from "react";
import {
  type BroadcastStatus,
  plainTextPreview,
  renderPlainText,
  SAMPLE_CONTEXT,
  type ScheduledBroadcast,
  TASHKENT_OFFSET_MS,
  variableValues,
} from "@funnel/shared";
import { AutoDeleteBadge } from "@/components/admin/AutoDeletePicker";
import { Badge, type BadgeTone } from "@/components/admin/ui/Badge";
import { Button } from "@/components/admin/ui/Button";
import { ConfirmDialog } from "@/components/admin/ui/Dialog";
import { Card } from "@/components/admin/ui/Section";
import {
  ButtonsIcon,
  CalendarIcon,
  CopyIcon,
  PencilIcon,
  PhotoIcon,
  PlusIcon,
  VideoIcon,
  VoiceIcon,
} from "@/components/icons";
import { formatCount } from "@/lib/admin/rollouts";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.broadcasts;
const sampleValues = variableValues(SAMPLE_CONTEXT);
const mediaIcons = { photo: PhotoIcon, video: VideoIcon, voice: VoiceIcon };

const statusTones: Record<BroadcastStatus, BadgeTone> = {
  scheduled: "attention",
  running: "success",
  done: "neutral",
  cancelled: "danger",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatTashkentFull(iso: string): string {
  const local = new Date(new Date(iso).getTime() + TASHKENT_OFFSET_MS);
  const date = `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}.${local.getUTCFullYear()}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  return `${date}, ${time}`;
}

function progressSummary(item: ScheduledBroadcast): string | null {
  if (item.status === "scheduled" && item.targetCount === null) return null;
  const parts: string[] = [];
  if (item.targetCount !== null) {
    parts.push(
      copy.progress.ofTarget
        .replace("{sent}", formatCount(item.sentCount))
        .replace("{target}", formatCount(item.targetCount)),
    );
  } else if (item.sentCount > 0) {
    parts.push(copy.progress.sentOnly.replace("{sent}", formatCount(item.sentCount)));
  }
  if (item.blockedCount > 0) {
    parts.push(copy.progress.blocked.replace("{count}", formatCount(item.blockedCount)));
  }
  if (item.failedCount > 0) {
    parts.push(copy.progress.failed.replace("{count}", formatCount(item.failedCount)));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

type BroadcastsPanelProps = {
  broadcasts: ScheduledBroadcast[];
  onCreate: () => void;
  onEdit: (item: ScheduledBroadcast) => void;
  onDuplicate: (item: ScheduledBroadcast) => void;
  onCancel: (id: number) => Promise<void>;
};

export function BroadcastsPanel({
  broadcasts,
  onCreate,
  onEdit,
  onDuplicate,
  onCancel,
}: BroadcastsPanelProps) {
  const [confirmItem, setConfirmItem] = useState<ScheduledBroadcast | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const activeItems = broadcasts.filter((b) => b.status === "running" || b.status === "scheduled");
  const historyItems = broadcasts.filter((b) => b.status === "done" || b.status === "cancelled");

  async function confirmCancel() {
    if (!confirmItem) return;
    setCancelling(true);
    await onCancel(confirmItem.id);
    setCancelling(false);
    setConfirmItem(null);
  }

  function renderCard(item: ScheduledBroadcast) {
    const MediaIcon = item.media ? mediaIcons[item.media.type] : null;
    const progress = progressSummary(item);
    const canCancel = item.status === "scheduled" || item.status === "running";
    const isHistory = item.status === "done" || item.status === "cancelled";
    const pct =
      item.status === "running" && item.targetCount && item.targetCount > 0
        ? Math.min(100, Math.round((item.sentCount / item.targetCount) * 100))
        : null;

    return (
      <Card key={item.id}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={statusTones[item.status]}>{copy.statuses[item.status]}</Badge>
            <Badge>
              <CalendarIcon className="mr-1 h-3 w-3" />
              {formatTashkentFull(item.scheduledAt)}
            </Badge>
            <AutoDeleteBadge minutes={item.autoDeleteMinutes} />
          </div>
          <div className="flex items-center gap-2">
            {item.status === "scheduled" && (
              <Button
                variant="secondary"
                size="sm"
                icon={<PencilIcon className="h-3.5 w-3.5" />}
                onClick={() => onEdit(item)}
              >
                {copy.editButton}
              </Button>
            )}
            {isHistory && (
              <Button
                variant="secondary"
                size="sm"
                icon={<CopyIcon className="h-3.5 w-3.5" />}
                onClick={() => onDuplicate(item)}
              >
                {copy.duplicateButton}
              </Button>
            )}
            {canCancel && (
              <Button variant="dangerGhost" size="sm" onClick={() => setConfirmItem(item)}>
                {copy.cancelButton}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {item.audiences.map((audience) => (
            <Badge key={audience}>{copy.editor.audiences[audience]}</Badge>
          ))}
        </div>

        <p className="m-0 line-clamp-3 whitespace-pre-wrap break-words text-sm text-siyoh">
          {renderPlainText(plainTextPreview(item.text, 200), sampleValues)}
        </p>

        {pct !== null && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-varaq">
            <div className="h-full rounded-full bg-zumrad transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}

        {(item.media || item.buttons.length > 0 || progress) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-chiziq pt-2 text-xs text-qalam">
            <div className="flex flex-wrap items-center gap-3">
              {MediaIcon && item.media && (
                <span className="inline-flex items-center gap-1">
                  <MediaIcon className="h-4 w-4" />
                  <span>{adminUz.messages.mediaBadge[item.media.type]}</span>
                </span>
              )}
              {item.buttons.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <ButtonsIcon className="h-4 w-4" />
                  <span>{item.buttons.map((button) => button.text).join(" · ")}</span>
                </span>
              )}
            </div>
            {progress && <span className="font-medium tabular-nums text-siyoh">{progress}</span>}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-chiziq/50 bg-white p-4">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[17px] font-semibold text-siyoh">{copy.title}</h2>
          <p className="m-0 mt-0.5 text-[13px] text-qalam">{copy.description}</p>
        </div>
        <Button icon={<PlusIcon className="h-4 w-4" />} onClick={onCreate}>
          {copy.createButton}
        </Button>
      </div>

      {broadcasts.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <p className="m-0 text-[15px] font-semibold text-siyoh">{copy.emptyTitle}</p>
          <p className="m-0 text-sm text-qalam">{copy.emptyHint}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2.5">
            <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.04em] text-qalam">
              {copy.activeSectionTitle} ({activeItems.length})
            </h3>
            {activeItems.length === 0 ? (
              <Card className="py-5 text-center text-[13px] text-qalam">{copy.emptyActive}</Card>
            ) : (
              <div className="flex flex-col gap-3">{activeItems.map(renderCard)}</div>
            )}
          </section>

          {historyItems.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.04em] text-qalam">
                {copy.historySectionTitle} ({historyItems.length})
              </h3>
              <div className="flex flex-col gap-3">{historyItems.map(renderCard)}</div>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmItem !== null}
        title={copy.confirmCancelTitle}
        description={
          confirmItem?.status === "running" ? copy.confirmCancelRunning : copy.confirmCancelScheduled
        }
        confirmLabel={copy.cancelButton}
        busy={cancelling}
        onConfirm={() => void confirmCancel()}
        onCancel={() => {
          if (!cancelling) setConfirmItem(null);
        }}
      />
    </div>
  );
}
