import {
  defaultTimingModeFor,
  EXTENDED_EXPIRY_MINUTE,
  type FunnelSegment,
  type FunnelStatus,
  isNightMinute,
  linkBoundSegments,
  MESSAGE_DAILY_CEILING,
  MINUTES_PER_DAY,
  NIGHT,
  type SegmentCap,
  TASHKENT_OFFSET_MS,
  TEMPLATE_DAYS,
  type TemplateKind,
  type TemplateTimingMode,
} from "@funnel/shared";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 86_400_000;
export const CHAIN_MS = TEMPLATE_DAYS * DAY_MS;
export const GRACE_MS = 60 * MINUTE_MS;
export const DAILY_CAP = MESSAGE_DAILY_CEILING;
export const WATCHING_FRESH_MS = 2 * MINUTE_MS;
export const ADMIN_CHAT_QUIET_MS = 30 * MINUTE_MS;
const UNCAPPED: SegmentCap = { daily: DAILY_CAP, total: null };

export type ScheduleTemplate = {
  id: number;
  day: number;
  position: number;
  timingMode?: TemplateTimingMode;
  timingValue: number;
  kind: TemplateKind;
  atExpiry: boolean;
  statuses?: readonly FunnelStatus[] | null;
};

export type FunnelGrant = { day: number; expiresAt: Date | null };

export type WatchSnapshot = { lastBeatAt: Date | null; playing: boolean };

export type SendUsage = { today: number; runToday: number; runTotal: number };

export type PlanItem<T extends ScheduleTemplate = ScheduleTemplate> = {
  template: T;
  sendAt: Date;
  slot: string;
};

export type PlannedSend<T extends ScheduleTemplate = ScheduleTemplate> = PlanItem<T>;

export function tashkentDayStart(date: Date): Date {
  const local = date.getTime() + TASHKENT_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - TASHKENT_OFFSET_MS);
}

export function tashkentMinuteOfDay(date: Date): number {
  const local = date.getTime() + TASHKENT_OFFSET_MS;
  return Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS);
}

export function isNightAt(date: Date): boolean {
  return isNightMinute(tashkentMinuteOfDay(date));
}

function nightMorningOf(date: Date): number | null {
  const minute = tashkentMinuteOfDay(date);
  if (minute >= NIGHT.start) return tashkentDayStart(date).getTime() + DAY_MS;
  if (minute < NIGHT.end) return tashkentDayStart(date).getTime();
  return null;
}

export function shiftOutOfNight(date: Date): Date {
  const morning = nightMorningOf(date);
  return morning === null ? date : new Date(morning + NIGHT.end * MINUTE_MS);
}

export function linkExpiryFor(givenAt: Date, ttlHours: number): Date {
  const raw = new Date(givenAt.getTime() + ttlHours * HOUR_MS);
  const morning = nightMorningOf(raw);
  return morning === null ? raw : new Date(morning + EXTENDED_EXPIRY_MINUTE * MINUTE_MS);
}

export function funnelDayAt(grant: FunnelGrant, now: Date): number {
  if (!grant.expiresAt || now.getTime() < grant.expiresAt.getTime()) return grant.day;
  return grant.day + 1 + Math.floor((now.getTime() - grant.expiresAt.getTime()) / DAY_MS);
}

function compareItems<T extends ScheduleTemplate>(a: PlanItem<T>, b: PlanItem<T>): number {
  return (
    a.sendAt.getTime() - b.sendAt.getTime() ||
    a.template.day - b.template.day ||
    a.template.position - b.template.position ||
    a.template.id - b.template.id
  );
}

export function clockSendInWindow(minuteOfDay: number, afterAt: Date): Date {
  const start = afterAt.getTime();
  const minuteStart = start - (((start % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);
  const ahead = (minuteOfDay - tashkentMinuteOfDay(afterAt) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const candidate = minuteStart + ahead * MINUTE_MS;
  return new Date(candidate < start ? candidate + DAY_MS : candidate);
}

export function triggerSendAt(template: ScheduleTemplate, windowStart: Date): Date {
  return template.atExpiry ? windowStart : clockSendInWindow(template.timingValue, windowStart);
}

export function cycleForRun(
  run: { segment: FunnelSegment; enteredAt: Date; grant?: FunnelGrant | null },
  now: Date,
  loop: boolean,
): { cycleIndex: number; slot: string } {
  if (!loop) return { cycleIndex: 0, slot: "" };
  if (linkBoundSegments.includes(run.segment)) {
    const grant = run.grant ?? null;
    if (!grant?.expiresAt || now.getTime() < grant.expiresAt.getTime()) return { cycleIndex: 0, slot: "" };
    const rawDay = funnelDayAt(grant, now);
    if (rawDay <= TEMPLATE_DAYS) return { cycleIndex: 0, slot: "" };
    const cycleIndex = Math.floor((rawDay - 1) / TEMPLATE_DAYS);
    return { cycleIndex, slot: String(cycleIndex) };
  }
  const firstDay = tashkentDayStart(run.enteredAt);
  const elapsedDays = Math.floor((tashkentDayStart(now).getTime() - firstDay.getTime()) / DAY_MS);
  const cycleIndex = elapsedDays >= TEMPLATE_DAYS ? Math.floor(elapsedDays / TEMPLATE_DAYS) : 0;
  return { cycleIndex, slot: cycleIndex === 0 ? "" : String(cycleIndex) };
}

function linkChain<T extends ScheduleTemplate>(
  segment: FunnelSegment,
  templates: T[],
  anchorAt: Date,
  grant: FunnelGrant | null,
  now: Date,
  nightRestriction: boolean,
  loop: boolean,
): PlanItem<T>[] {
  const applyNight = (date: Date) => (nightRestriction ? shiftOutOfNight(date) : date);
  const { cycleIndex, slot } = cycleForRun({ segment, enteredAt: anchorAt, grant }, now, loop);
  if (cycleIndex >= 1 && grant?.expiresAt) {
    const cycleDay1Start = new Date(grant.expiresAt.getTime() + (cycleIndex * TEMPLATE_DAYS - grant.day) * DAY_MS);
    const cycleDay1End = new Date(cycleDay1Start.getTime() + DAY_MS);
    const reminders = templates
      .filter((template) => template.kind === "reminder" && template.day === 1)
      .map((template) => {
        const mode = template.timingMode ?? defaultTimingModeFor(segment, template.day, template.kind);
        const rawSendAt =
          mode === "clock"
            ? clockSendInWindow(template.timingValue, cycleDay1Start)
            : new Date(cycleDay1Start.getTime() + template.timingValue * MINUTE_MS);
        return { template, sendAt: applyNight(rawSendAt), slot };
      })
      .filter((item) => item.sendAt.getTime() < cycleDay1End.getTime());
    const triggers = templates
      .filter((template) => template.kind === "trigger" && template.day > 1 && template.day <= TEMPLATE_DAYS)
      .map((template) => ({
        template,
        sendAt: applyNight(triggerSendAt(template, new Date(cycleDay1End.getTime() + (template.day - 2) * DAY_MS))),
        slot,
      }));
    return [...reminders, ...triggers];
  }

  const day = grant?.day ?? 1;
  const expiresAt = grant?.expiresAt ?? null;
  const reminders = templates
    .filter((template) => template.kind === "reminder" && template.day === day)
    .map((template) => {
      const mode = template.timingMode ?? defaultTimingModeFor(segment, template.day, template.kind);
      const rawSendAt =
        mode === "clock"
          ? clockSendInWindow(template.timingValue, anchorAt)
          : new Date(anchorAt.getTime() + template.timingValue * MINUTE_MS);
      return { template, sendAt: applyNight(rawSendAt), slot: "" };
    })
    .filter((item) => !expiresAt || item.sendAt.getTime() < expiresAt.getTime());
  if (!expiresAt) return reminders;
  const triggers = templates
    .filter((template) => template.kind === "trigger" && template.day > day && template.day <= TEMPLATE_DAYS)
    .map((template) => ({
      template,
      sendAt: applyNight(triggerSendAt(template, new Date(expiresAt.getTime() + (template.day - day - 1) * DAY_MS))),
      slot: "",
    }));
  return [...reminders, ...triggers];
}

function trackChain<T extends ScheduleTemplate>(
  segment: FunnelSegment,
  templates: T[],
  enteredAt: Date,
  anchorAt: Date,
  now: Date,
  nightRestriction: boolean,
  loop: boolean,
): PlanItem<T>[] {
  const applyNight = (date: Date) => (nightRestriction ? shiftOutOfNight(date) : date);
  const { cycleIndex, slot } = cycleForRun({ segment, enteredAt }, now, loop);
  const cycleShiftMs = cycleIndex * TEMPLATE_DAYS * DAY_MS;
  const cycleFirstDay = new Date(tashkentDayStart(enteredAt).getTime() + cycleShiftMs);
  // Looped cycles replay cycle 0 shifted by 30·k days: relative offsets keep entry's time of day,
  // while a day-1 clock template may fire any time on the cycle's first day.
  const relativeAnchorAt = cycleIndex === 0 ? anchorAt : new Date(enteredAt.getTime() + cycleShiftMs);
  const clockDay1From = cycleIndex === 0 ? anchorAt : cycleFirstDay;
  return templates.map((template) => {
    const mode = template.timingMode ?? defaultTimingModeFor(segment, template.day, template.kind);
    const rawSendAt =
      mode === "relative"
        ? new Date(relativeAnchorAt.getTime() + (template.day - 1) * DAY_MS + template.timingValue * MINUTE_MS)
        : template.day <= 1
          ? clockSendInWindow(template.timingValue, clockDay1From)
          : new Date(cycleFirstDay.getTime() + (template.day - 1) * DAY_MS + template.timingValue * MINUTE_MS);
    return { template, sendAt: applyNight(rawSendAt), slot };
  });
}

export type ChainRun = {
  segment: FunnelSegment;
  enteredAt: Date;
  status?: FunnelStatus | null;
  watch?: WatchSnapshot | null;
  grant?: FunnelGrant | null;
  lastAdminChatAt?: Date | null;
  nightRestriction?: boolean;
  loop?: boolean;
  now?: Date;
};

export function planChain<T extends ScheduleTemplate>(
  templates: T[],
  run: ChainRun,
  now = run.now ?? new Date(),
): PlanItem<T>[] {
  const eligible = run.status === undefined ? templates : templatesForStatus(templates, run.status);
  const anchorAt = chainAnchor(run, run.watch ?? null);
  const nightRestriction = run.nightRestriction ?? false;
  const loop = run.loop ?? false;
  const items = linkBoundSegments.includes(run.segment)
    ? linkChain(run.segment, eligible, anchorAt, run.grant ?? null, now, nightRestriction, loop)
    : trackChain(run.segment, eligible, run.enteredAt, anchorAt, now, nightRestriction, loop);
  return items.sort(compareItems);
}

export function chainAnchor(
  run: { segment: FunnelSegment; enteredAt: Date; lastAdminChatAt?: Date | null },
  watch: WatchSnapshot | null,
): Date {
  if (run.segment === "B") {
    const stoppedAt = watch?.lastBeatAt ?? null;
    if (stoppedAt === null) return run.enteredAt;
    return stoppedAt.getTime() > run.enteredAt.getTime() ? stoppedAt : run.enteredAt;
  }
  if (run.segment === "E") {
    const chattedAt = run.lastAdminChatAt ?? null;
    if (chattedAt === null) return run.enteredAt;
    return chattedAt.getTime() > run.enteredAt.getTime() ? chattedAt : run.enteredAt;
  }
  return run.enteredAt;
}

export function isWatchingNow(watch: WatchSnapshot | null, now: Date): boolean {
  if (!watch?.playing || watch.lastBeatAt === null) return false;
  return now.getTime() - watch.lastBeatAt.getTime() < WATCHING_FRESH_MS;
}

export function isChattingWithAdminNow(lastAdminChatAt: Date | null | undefined, now: Date): boolean {
  return Boolean(lastAdminChatAt && now.getTime() - lastAdminChatAt.getTime() < ADMIN_CHAT_QUIET_MS);
}

export function templatesForStatus<T extends Pick<ScheduleTemplate, "statuses">>(
  templates: T[],
  status: FunnelStatus | null,
): T[] {
  return templates.filter(
    (template) => !template.statuses || (status !== null && template.statuses.includes(status)),
  );
}

export function capReached(usage: SendUsage, cap: SegmentCap): boolean {
  return (
    usage.today >= DAILY_CAP ||
    usage.runToday >= cap.daily ||
    (cap.total !== null && usage.runTotal >= cap.total)
  );
}

export function pickNext<T extends ScheduleTemplate>(
  plan: PlanItem<T>[],
  sent: ReadonlySet<number>,
  now: Date,
  usage: SendUsage,
  cap: SegmentCap = UNCAPPED,
): PlanItem<T> | null {
  if (capReached(usage, cap)) return null;
  const nowMs = now.getTime();
  const found = plan.find(
    (item) => !sent.has(item.template.id) && item.sendAt.getTime() <= nowMs && nowMs - item.sendAt.getTime() <= GRACE_MS,
  );
  return found ?? null;
}

export function nextPendingDue<T extends ScheduleTemplate>(
  plan: PlanItem<T>[],
  sent: ReadonlySet<number>,
  now: Date,
): Date | null {
  const nowMs = now.getTime();
  const found = plan.find((item) => !sent.has(item.template.id) && nowMs - item.sendAt.getTime() <= GRACE_MS);
  return found?.sendAt ?? null;
}
