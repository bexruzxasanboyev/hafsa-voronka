"use client";

import { useState } from "react";
import {
  compareTimeline,
  isSameMoment,
  type FunnelSegment,
  linkBoundSegments,
  type MessageTemplate,
  type SegmentLoops,
  TEMPLATE_DAYS,
  triggerAllowed,
} from "@funnel/shared";
import { MessageCard } from "@/components/admin/messages/MessageCard";
import type { VideoMarks } from "@/components/admin/messages/StopPointPicker";
import { TriggerCard } from "@/components/admin/messages/TriggerCard";
import { Button } from "@/components/admin/ui/Button";
import { Notice } from "@/components/admin/ui/Notice";
import { Switch } from "@/components/admin/ui/Switch";
import { ClockIcon, PlusIcon, RestartIcon } from "@/components/icons";
import { relativeAnchor } from "@/lib/admin/messageTiming";
import { saveSettings } from "@/lib/admin/settings";
import { adminUz } from "@/lib/i18n/admin";

const copy = adminUz.messages;

export function dayCounts(items: MessageTemplate[]): number[] {
  const counts = Array.from({ length: TEMPLATE_DAYS }, () => 0);
  for (const item of items) {
    if (item.isActive && item.day >= 1 && item.day <= TEMPLATE_DAYS) counts[item.day - 1] += 1;
  }
  return counts;
}

function dayNote(segment: FunnelSegment, day: number) {
  if (day > 1 && !linkBoundSegments.includes(segment)) return copy.dayNotes.clock;
  return copy.dayNotes[relativeAnchor(segment, day)];
}

function byActiveFirst(a: MessageTemplate, b: MessageTemplate) {
  return Number(b.isActive) - Number(a.isActive) || a.id - b.id;
}

type DayTimelineProps = {
  segment: FunnelSegment;
  items: MessageTemplate[];
  videoMarks: VideoMarks;
  day: number;
  nightRestrictionEnabled: boolean;
  segmentLoops: SegmentLoops;
  onSegmentLoopsChange: (next: SegmentLoops) => void;
  onDayChange: (day: number) => void;
  onAddReminder: (day: number) => void;
  onAddTrigger: (day: number) => void;
  onEdit: (item: MessageTemplate) => void;
  onToggle: (item: MessageTemplate, isActive: boolean) => void;
  onMove: (group: MessageTemplate[], index: number, direction: -1 | 1) => void;
};

export function DayTimeline({
  segment,
  items,
  videoMarks,
  day,
  nightRestrictionEnabled,
  segmentLoops,
  onSegmentLoopsChange,
  onDayChange,
  onAddReminder,
  onAddTrigger,
  onEdit,
  onToggle,
  onMove,
}: DayTimelineProps) {
  const [loopSaving, setLoopSaving] = useState(false);
  const [loopError, setLoopError] = useState(false);

  const counts = dayCounts(items);
  const dayItems = items.filter((item) => item.segment === segment && item.day === day);
  const reminders = dayItems.filter((item) => item.kind === "reminder").sort(compareTimeline);
  const triggers = dayItems.filter((item) => item.kind === "trigger").sort(byActiveFirst);
  const withTrigger = triggerAllowed(segment, day);
  const loopEnabled = segmentLoops[segment];

  async function toggleLoop(next: boolean) {
    const previous = segmentLoops;
    const optimistic: SegmentLoops = { ...segmentLoops, [segment]: next };
    onSegmentLoopsChange(optimistic);
    setLoopSaving(true);
    setLoopError(false);
    const result = await saveSettings({ segmentLoops: optimistic });
    setLoopSaving(false);
    if (result.ok) {
      onSegmentLoopsChange(result.settings.segmentLoops);
    } else {
      onSegmentLoopsChange(previous);
      setLoopError(true);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-[16px] bg-white p-3.5 sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <RestartIcon className="mt-0.5 h-5 w-5 shrink-0 text-qalam" />
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-siyoh">{copy.loopToggle}</p>
              <p className="m-0 mt-0.5 text-[13px] text-qalam">{copy.loopHint}</p>
            </div>
          </div>
          <Switch
            checked={loopEnabled}
            onChange={(next) => void toggleLoop(next)}
            label={copy.loopToggle}
            disabled={loopSaving}
          />
        </div>
        {loopError && <Notice tone="danger">{copy.loopError}</Notice>}
        {nightRestrictionEnabled && (
          <p className="m-0 flex items-center gap-1.5 rounded-[10px] bg-varaq px-3 py-2 text-[13px] text-qalam">
            <ClockIcon className="h-4 w-4 shrink-0 text-siyoh" />
            <span>{copy.nightActiveNote}</span>
          </p>
        )}
      </div>

      <div
        role="tablist"
        aria-label={copy.dayTabs}
        className="grid grid-cols-5 gap-1.5 rounded-[16px] bg-white p-2 sm:grid-cols-10"
      >
        {counts.map((count, index) => {
          const dayNumber = index + 1;
          const selected = dayNumber === day;
          return (
            <button
              key={dayNumber}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${copy.dayLabel.replace("{n}", String(dayNumber))}, ${copy.count.replace("{n}", String(count))}`}
              onClick={() => onDayChange(dayNumber)}
              className={`flex min-h-12 flex-col items-center justify-center rounded-[10px] px-1.5 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-siyoh ${
                selected
                  ? "bg-siyoh text-varaq"
                  : "bg-varaq/60 text-siyoh hover:bg-varaq"
              }`}
            >
              <span className="text-[13px] font-semibold leading-tight tabular-nums">{dayNumber}</span>
              <span
                className={`mt-0.5 text-[11px] leading-none tabular-nums ${
                  selected ? "text-varaq/80" : count > 0 ? "font-medium text-zumrad" : "text-qalam/60"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {withTrigger && (
        <TriggerCard triggers={triggers} onCreate={() => onAddTrigger(day)} onEdit={onEdit} onToggle={onToggle} />
      )}

      <div className="flex flex-col gap-1">
        {withTrigger && <h2 className="m-0 text-[17px] font-semibold leading-snug text-siyoh">{copy.reminders}</h2>}
        <p className="m-0 text-sm text-qalam">{dayNote(segment, day)}</p>
      </div>

      {reminders.length === 0 ? (
        <p className="m-0 rounded-[16px] bg-white px-4 py-6 text-center text-sm text-qalam">{copy.emptyDay}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-chiziq rounded-[16px] bg-white p-0">
          {reminders.map((item, index) => {
            const sameMoment = (other: MessageTemplate | undefined) => other !== undefined && isSameMoment(other, item);
            return (
              <MessageCard
                key={item.id}
                item={item}
                videoMarks={videoMarks}
                onEdit={() => onEdit(item)}
                onToggle={(isActive) => onToggle(item, isActive)}
                onMoveUp={sameMoment(reminders[index - 1]) ? () => onMove(reminders, index, -1) : undefined}
                onMoveDown={sameMoment(reminders[index + 1]) ? () => onMove(reminders, index, 1) : undefined}
              />
            );
          })}
        </ul>
      )}

      <Button variant="secondary" icon={<PlusIcon className="h-4 w-4" />} onClick={() => onAddReminder(day)}>
        {copy.addForDay.replace("{n}", String(day))}
      </Button>
    </section>
  );
}
