import { describe, expect, it } from "vitest";
import type { FunnelStatus } from "@funnel/shared";
import {
  capReached,
  chainAnchor,
  clockSendInWindow,
  cycleForRun,
  DAILY_CAP,
  GRACE_MS,
  isWatchingNow,
  isNightAt,
  linkExpiryFor,
  nextPendingDue,
  pickNext,
  planChain,
  type ScheduleTemplate,
  shiftOutOfNight,
  funnelDayAt,
  type SendUsage,
  tashkentDayStart,
  templatesForStatus,
} from "./plan";

const local = (value: string) => new Date(`${value}+05:00`);
const T = (value: string) => local(value.replace(" ", "T"));
const MINUTE = 60_000;

let nextId = 1;

function template(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return { id: nextId++, day: 1, position: 0, timingValue: 60, kind: "reminder", atExpiry: false, ...overrides };
}

const unused: SendUsage = { today: 0, runToday: 0, runTotal: 0 };
const none = new Set<number>();

function localTime(date: Date) {
  return new Date(date.getTime() + 5 * 60 * MINUTE).toISOString().slice(0, 16);
}

function planFor(
  templates: ScheduleTemplate[],
  run: {
    segment?: "A" | "B" | "C" | "E";
    entered: string;
    lastBeatAt?: string;
    day?: number;
    expires?: string;
    nightRestriction?: boolean;
    loop?: boolean;
    now?: string;
  },
) {
  return planChain(templates, {
    segment: run.segment ?? "A",
    enteredAt: T(run.entered),
    watch: run.lastBeatAt ? { lastBeatAt: T(run.lastBeatAt), playing: false } : null,
    grant: { day: run.day ?? 1, expiresAt: run.expires ? T(run.expires) : null },
    nightRestriction: run.nightRestriction,
    loop: run.loop,
    now: run.now ? T(run.now) : T(run.entered),
  });
}

describe("tashkentDayStart", () => {
  it("keeps the local calendar day at the edges", () => {
    expect(tashkentDayStart(local("2026-10-19T23:59:59"))).toEqual(local("2026-10-19T00:00:00"));
    expect(tashkentDayStart(local("2026-10-20T00:00:00"))).toEqual(local("2026-10-20T00:00:00"));
  });
});

describe("isNightAt", () => {
  it("covers 23:00 to 07:00 local", () => {
    expect(isNightAt(local("2026-10-19T22:59:59"))).toBe(false);
    expect(isNightAt(local("2026-10-19T23:00:00"))).toBe(true);
    expect(isNightAt(local("2026-10-20T06:59:59"))).toBe(true);
    expect(isNightAt(local("2026-10-20T07:00:00"))).toBe(false);
  });
});

describe("linkExpiryFor", () => {
  it("keeps an expiry that falls in the day", () => {
    expect(linkExpiryFor(local("2026-10-19T10:00"), 24)).toEqual(local("2026-10-20T10:00"));
    expect(linkExpiryFor(local("2026-10-19T22:59"), 24)).toEqual(local("2026-10-20T22:59"));
    expect(linkExpiryFor(local("2026-10-19T07:00"), 24)).toEqual(local("2026-10-20T07:00"));
  });

  it("extends an expiry from 23:00 to 09:00 of the next morning", () => {
    expect(linkExpiryFor(local("2026-10-19T23:00"), 24)).toEqual(local("2026-10-21T09:00"));
    expect(linkExpiryFor(local("2026-10-19T23:30"), 24)).toEqual(local("2026-10-21T09:00"));
  });

  it("extends an early morning expiry to 09:00 of the same day", () => {
    expect(linkExpiryFor(local("2026-10-19T02:00"), 24)).toEqual(local("2026-10-20T09:00"));
    expect(linkExpiryFor(local("2026-10-19T06:59"), 24)).toEqual(local("2026-10-20T09:00"));
  });

  it("works for any link length", () => {
    expect(linkExpiryFor(local("2026-10-19T10:00"), 15)).toEqual(local("2026-10-20T09:00"));
    expect(linkExpiryFor(local("2026-10-19T10:00"), 72)).toEqual(local("2026-10-22T10:00"));
  });
});

describe("planChain: reminders", () => {
  it("times reminders from the stage entry", () => {
    const plan = planFor([template({ day: 1, timingValue: 60 })], { entered: "2026-10-20 10:00" });
    expect(plan.map((item) => item.sendAt)).toEqual([T("2026-10-20 11:00")]);
  });

  it("times B reminders from the last pause", () => {
    const plan = planFor([template({ day: 1, timingValue: 30 })], {
      segment: "B",
      entered: "2026-10-20 10:00",
      lastBeatAt: "2026-10-20 12:00",
    });
    expect(plan.map((item) => item.sendAt)).toEqual([T("2026-10-20 12:30")]);
  });

  it("sends only the reminders of the grant's day, relative to the anchor", () => {
    const dayOne = template({ day: 1, timingValue: 30 });
    const dayThree = template({ day: 3, timingValue: 30 });
    const plan = planFor([dayOne, dayThree], { entered: "2026-10-22 15:00", day: 3 });
    expect(plan.map((item) => [item.template, localTime(item.sendAt)])).toEqual([[dayThree, "2026-10-22T15:30"]]);
  });

  it("drops A/B reminders at or after the link expiry", () => {
    const before = template({ timingValue: 1439 });
    const at = template({ timingValue: 1440 });
    const plan = planFor([before, at], { entered: "2026-10-20 09:00", expires: "2026-10-21 09:00" });
    expect(plan.map((item) => item.template)).toEqual([before]);
  });

  it("puts C day N at the clock time of the Nth Tashkent day from entry", () => {
    const plan = planFor([template({ day: 3, timingValue: 600 })], { segment: "C", entered: "2026-10-20 15:00" });
    expect(plan.map((item) => item.sendAt)).toEqual([T("2026-10-22 10:00")]);
  });

  it("orders same-time reminders by position, then id", () => {
    const late = template({ id: 5003, timingValue: 600, position: 1 });
    const second = template({ id: 5002, timingValue: 600, position: 0 });
    const first = template({ id: 5001, timingValue: 600, position: 0 });
    const plan = planFor([late, second, first], { entered: "2026-10-20 10:00" });
    expect(plan.map((item) => item.template.id)).toEqual([5001, 5002, 5003]);
  });
});

describe("funnelDayAt", () => {
  const grant = { day: 2, expiresAt: T("2026-10-21 09:00") };

  it("keeps the grant day while the link is open", () => {
    expect(funnelDayAt(grant, T("2026-10-21 08:59"))).toBe(2);
    expect(funnelDayAt({ day: 4, expiresAt: null }, T("2026-11-30 10:00"))).toBe(4);
  });

  it("moves one day per 24 hours after the expiry", () => {
    expect(funnelDayAt(grant, T("2026-10-21 09:00"))).toBe(3);
    expect(funnelDayAt(grant, T("2026-10-22 08:59"))).toBe(3);
    expect(funnelDayAt(grant, T("2026-10-22 09:00"))).toBe(4);
    expect(funnelDayAt(grant, T("2026-10-28 09:00"))).toBe(10);
  });
});

describe("planChain: triggers after the expiry", () => {
  const trigger = (day: number, overrides: Partial<ScheduleTemplate> = {}) =>
    template({ day, kind: "trigger", timingValue: 600, ...overrides });

  it("sends an at-expiry trigger at the start of its day window", () => {
    const three = trigger(3, { atExpiry: true });
    const four = trigger(4, { atExpiry: true });
    const plan = planFor([three, four], { entered: "2026-10-20 09:00", day: 2, expires: "2026-10-21 09:00" });
    expect(plan.map((item) => [item.template, localTime(item.sendAt)])).toEqual([
      [three, "2026-10-21T09:00"],
      [four, "2026-10-22T09:00"],
    ]);
  });

  it("sends a clock trigger at the first occurrence of its time in the window", () => {
    const morning = trigger(2, { timingValue: 600 });
    const early = trigger(3, { timingValue: 480 });
    const plan = planFor([morning, early], { entered: "2026-10-20 09:00", expires: "2026-10-21 09:00" });
    expect(plan.map((item) => [item.template, localTime(item.sendAt)])).toEqual([
      [morning, "2026-10-21T10:00"],
      [early, "2026-10-23T08:00"],
    ]);
  });

  it("keeps a clock time that matches the window start", () => {
    const exact = trigger(2, { timingValue: 540 });
    const plan = planFor([exact], { entered: "2026-10-20 09:00", expires: "2026-10-21 09:00" });
    expect(plan.map((item) => localTime(item.sendAt))).toEqual(["2026-10-21T09:00"]);
  });

  it("skips triggers of the current and earlier days and sends nothing past day 30", () => {
    const plan = planFor([trigger(2), trigger(3), trigger(30)], {
      entered: "2026-10-20 09:00",
      day: 3,
      expires: "2026-10-21 09:00",
    });
    expect(plan.map((item) => item.template.day)).toEqual([30]);
    expect(planFor([trigger(30)], { entered: "2026-10-20 09:00", day: 31, expires: "2026-10-21 09:00" })).toEqual([]);
  });

  it("sends no triggers before the link has an expiry", () => {
    expect(planFor([trigger(2)], { entered: "2026-10-20 09:00" })).toEqual([]);
  });
});

describe("pickNext and nextPendingDue", () => {
  const first = template({ day: 1, timingValue: 60 });
  const second = template({ day: 1, timingValue: 1440 });
  const plan = planFor([first, second], { entered: "2026-10-20 10:00" });

  it("returns the item that is due", () => {
    expect(pickNext(plan, none, T("2026-10-20 11:00"), unused)).toBe(plan[0]);
    expect(pickNext(plan, none, T("2026-10-20 10:59"), unused)).toBeNull();
  });

  it("pickNext gives up after the grace period", () => {
    expect(pickNext(plan, none, new Date(plan[0].sendAt.getTime() + GRACE_MS), unused)).toBe(plan[0]);
    expect(pickNext(plan, none, T("2026-10-20 12:01"), unused)).toBeNull();
  });

  it("stops at the daily cap", () => {
    expect(pickNext(plan, none, T("2026-10-20 11:00"), { ...unused, today: DAILY_CAP })).toBeNull();
  });

  it("skips sent ids", () => {
    const sent = new Set([first.id]);
    expect(pickNext(plan, sent, T("2026-10-20 11:00"), unused)).toBeNull();
    expect(pickNext(plan, sent, T("2026-10-21 10:00"), unused)).toBe(plan[1]);
  });

  it("finds the next pending send", () => {
    expect(nextPendingDue(plan, none, T("2026-10-20 10:00"))).toEqual(T("2026-10-20 11:00"));
    expect(nextPendingDue(plan, new Set([first.id]), T("2026-10-20 10:00"))).toEqual(T("2026-10-21 10:00"));
    expect(nextPendingDue(plan, new Set([first.id, second.id]), T("2026-10-20 10:00"))).toBeNull();
  });
});

describe("segment B: anchor at the stop", () => {
  const entered = local("2026-10-19T10:00");
  const run = { segment: "B" as const, enteredAt: entered };

  it("anchors B runs to the last beat and other segments to the entry", () => {
    const beat = local("2026-10-19T10:40");
    expect(chainAnchor(run, { lastBeatAt: beat, playing: false })).toEqual(beat);
    expect(chainAnchor(run, { lastBeatAt: local("2026-10-19T09:00"), playing: false })).toEqual(entered);
    expect(chainAnchor(run, { lastBeatAt: null, playing: false })).toEqual(entered);
    expect(chainAnchor(run, null)).toEqual(entered);
    expect(chainAnchor({ segment: "A", enteredAt: entered }, { lastBeatAt: beat, playing: false })).toEqual(entered);
    expect(chainAnchor({ segment: "C", enteredAt: entered }, { lastBeatAt: beat, playing: false })).toEqual(entered);
  });

  it("treats only a fresh playing beat as watching", () => {
    const now = local("2026-10-19T12:00");
    expect(isWatchingNow({ lastBeatAt: new Date(now.getTime() - 119_000), playing: true }, now)).toBe(true);
    expect(isWatchingNow({ lastBeatAt: new Date(now.getTime() - 120_000), playing: true }, now)).toBe(false);
    expect(isWatchingNow({ lastBeatAt: new Date(now.getTime() - 10_000), playing: false }, now)).toBe(false);
    expect(isWatchingNow({ lastBeatAt: null, playing: true }, now)).toBe(false);
    expect(isWatchingNow(null, now)).toBe(false);
  });

  it("keeps a +30m item waiting while beats keep coming and sends it 30 minutes after the last one", () => {
    const thirty = template({ timingValue: 30 });
    const planAt = (beat: Date) => planChain([thirty], { ...run, watch: { lastBeatAt: beat, playing: true } });
    for (let minute = 0; minute <= 40; minute += 1) {
      const now = new Date(entered.getTime() + minute * MINUTE);
      expect(pickNext(planAt(now), new Set(), now, unused)).toBeNull();
    }
    const stoppedAt = local("2026-10-19T10:40");
    const plan = planAt(stoppedAt);
    expect(plan.map((item) => localTime(item.sendAt))).toEqual(["2026-10-19T11:10"]);
    expect(pickNext(plan, new Set(), local("2026-10-19T11:09"), unused)).toBeNull();
    expect(pickNext(plan, new Set(), local("2026-10-19T11:10"), unused)).toBe(plan[0]);
  });

  it("re-anchors unsent items to a new stop and keeps sent ones sent", () => {
    const thirty = template({ timingValue: 30 });
    const three = template({ timingValue: 180, position: 1 });
    const planAt = (beat: Date) => planChain([thirty, three], { ...run, watch: { lastBeatAt: beat, playing: false } });
    const first = planAt(local("2026-10-19T10:10"));
    expect(first.map((item) => localTime(item.sendAt))).toEqual(["2026-10-19T10:40", "2026-10-19T13:10"]);
    const sent = new Set([first[0].template.id]);
    const second = planAt(local("2026-10-19T12:00"));
    expect(second.map((item) => localTime(item.sendAt))).toEqual(["2026-10-19T12:30", "2026-10-19T15:00"]);
    expect(pickNext(second, sent, local("2026-10-19T12:30"), unused)).toBeNull();
    expect(pickNext(second, sent, local("2026-10-19T15:00"), unused)?.template).toBe(three);
  });

});

describe("segment B: status variants", () => {
  const early = template({ id: 9001, statuses: ["korishni_boshladi"] });
  const middle = template({ id: 9002, statuses: ["dars_yarmida"] });
  const sales = template({ id: 9003, statuses: ["sotuvda_toxtadi"] });
  const everyone = template({ id: 9004, timingValue: 180, statuses: null });
  const all = [early, middle, sales, everyone];

  it("keeps templates without a filter and those matching the status", () => {
    expect(templatesForStatus(all, "korishni_boshladi")).toEqual([early, everyone]);
    expect(templatesForStatus(all, "dars_yarmida")).toEqual([middle, everyone]);
    expect(templatesForStatus(all, "sotuvda_toxtadi")).toEqual([sales, everyone]);
    expect(templatesForStatus(all, null)).toEqual([everyone]);
  });

  it("switches the variant of unsent items when the status changes", () => {
    const run = { segment: "B" as const, enteredAt: local("2026-10-19T10:00") };
    const planFor = (status: "korishni_boshladi" | "sotuvda_toxtadi", beat: string) =>
      planChain(all, { ...run, status, watch: { lastBeatAt: local(beat), playing: false } });
    const first = planFor("korishni_boshladi", "2026-10-19T10:03");
    expect(first.map((item) => item.template.id)).toEqual([9001, 9004]);
    const sent = new Set([first[0].template.id]);
    const later = planFor("sotuvda_toxtadi", "2026-10-19T10:20");
    expect(later.map((item) => item.template.id)).toEqual([9003, 9004]);
    expect(pickNext(later, sent, local("2026-10-19T11:20"), unused)?.template.id).toBe(9003);
  });

  it("does not filter when no status is given", () => {
    const plan = planChain(all, { segment: "B", enteredAt: local("2026-10-19T10:00") });
    expect(plan).toHaveLength(all.length);
  });
});

describe("caps", () => {
  const bCap = { daily: 4, total: 7 };
  const plan = planFor([template({ timingValue: 60 })], { entered: "2026-10-19 10:00" });
  const now = local("2026-10-19T11:00");

  it("blocks the fifth send of the day and the eighth of the run in B", () => {
    expect(capReached({ today: 3, runToday: 3, runTotal: 6 }, bCap)).toBe(false);
    expect(capReached({ today: 4, runToday: 4, runTotal: 4 }, bCap)).toBe(true);
    expect(capReached({ today: 1, runToday: 1, runTotal: 7 }, bCap)).toBe(true);
    expect(pickNext(plan, new Set(), now, { today: 4, runToday: 4, runTotal: 4 }, bCap)).toBeNull();
    expect(pickNext(plan, new Set(), now, { today: 0, runToday: 0, runTotal: 7 }, bCap)).toBeNull();
    expect(pickNext(plan, new Set(), now, { today: 3, runToday: 3, runTotal: 6 }, bCap)).toBe(plan[0]);
  });

  it("always applies the global ten per day", () => {
    const loose = { daily: 50, total: null };
    expect(capReached({ today: DAILY_CAP, runToday: 0, runTotal: 0 }, loose)).toBe(true);
    expect(capReached({ today: DAILY_CAP - 1, runToday: 9, runTotal: 100 }, loose)).toBe(false);
  });
});

describe("clockSendInWindow and shiftOutOfNight", () => {
  it("finds the first Tashkent clock occurrence at or after afterAt", () => {
    expect(clockSendInWindow(9 * 60, T("2026-10-20 09:00"))).toEqual(T("2026-10-20 09:00"));
    expect(clockSendInWindow(10 * 60, T("2026-10-20 09:00"))).toEqual(T("2026-10-20 10:00"));
    expect(clockSendInWindow(8 * 60, T("2026-10-20 09:00"))).toEqual(T("2026-10-21 08:00"));
    expect(clockSendInWindow(9 * 60, local("2026-10-20T09:00:30"))).toEqual(T("2026-10-21 09:00"));
  });

  it("shifts 23:00..06:59 Tashkent to 07:00 and leaves daytime untouched", () => {
    expect(shiftOutOfNight(local("2026-10-20T22:59:59"))).toEqual(local("2026-10-20T22:59:59"));
    expect(shiftOutOfNight(local("2026-10-20T23:00:00"))).toEqual(local("2026-10-21T07:00:00"));
    expect(shiftOutOfNight(local("2026-10-21T02:30:00"))).toEqual(local("2026-10-21T07:00:00"));
    expect(shiftOutOfNight(local("2026-10-21T06:59:59"))).toEqual(local("2026-10-21T07:00:00"));
    expect(shiftOutOfNight(local("2026-10-21T07:00:00"))).toEqual(local("2026-10-21T07:00:00"));
  });
});

describe("timingMode and nightRestriction", () => {
  it("supports explicit clock mode on day-1 link-bound reminders and relative mode on day-3 C reminders", () => {
    const aClock = template({ day: 1, timingMode: "clock", timingValue: 18 * 60 });
    const aPlan = planFor([aClock], { entered: "2026-10-20 15:00", expires: "2026-10-21 15:00" });
    expect(aPlan.map((item) => localTime(item.sendAt))).toEqual(["2026-10-20T18:00"]);

    const cRelative = template({ day: 3, timingMode: "relative", timingValue: 90 });
    const cPlan = planFor([cRelative], { segment: "C", entered: "2026-10-20 15:00" });
    expect(cPlan.map((item) => localTime(item.sendAt))).toEqual(["2026-10-22T16:30"]);

    const eClock = template({ day: 1, timingMode: "clock", timingValue: 10 * 60 });
    const ePlan = planFor([eClock], { segment: "E", entered: "2026-10-20 15:00" });
    expect(ePlan.map((item) => localTime(item.sendAt))).toEqual(["2026-10-21T10:00"]);
  });

  it("shifts night items to 07:00 only when nightRestriction is enabled and keeps cross-midnight items in pickNext", () => {
    const nightReminder = template({ day: 1, timingMode: "relative", timingValue: 30 });
    const nightTrigger = template({ day: 2, kind: "trigger", timingMode: "clock", timingValue: 2 * 60 });

    const offPlan = planFor([nightReminder, nightTrigger], {
      entered: "2026-10-20 23:00",
      expires: "2026-10-22 09:00",
      nightRestriction: false,
    });
    expect(offPlan.map((item) => localTime(item.sendAt))).toEqual(["2026-10-20T23:30", "2026-10-23T02:00"]);

    const onPlan = planFor([nightReminder, nightTrigger], {
      entered: "2026-10-20 23:00",
      expires: "2026-10-22 09:00",
      nightRestriction: true,
    });
    expect(onPlan.map((item) => localTime(item.sendAt))).toEqual(["2026-10-21T07:00", "2026-10-23T07:00"]);
    expect(pickNext(onPlan, none, T("2026-10-21 07:00"), unused)?.template).toBe(nightReminder);

    const cNight = template({ day: 3, timingMode: "clock", timingValue: 23 * 60 + 30 });
    const cPlan = planFor([cNight], {
      segment: "C",
      entered: "2026-10-20 10:00",
      nightRestriction: true,
      now: "2026-10-23 07:00",
    });
    expect(cPlan.map((item) => localTime(item.sendAt))).toEqual(["2026-10-23T07:00"]);
    expect(pickNext(cPlan, none, T("2026-10-23 07:00"), unused)?.template).toBe(cNight);
  });
});

describe("30-day grid and perpetual cycle wrap", () => {
  it("wraps non-link segments from Day 30 to Day 1 with slot 1 when loop is enabled", () => {
    const day1 = template({ id: 101, day: 1, timingMode: "relative", timingValue: 60 });
    const day30 = template({ id: 130, day: 30, timingMode: "clock", timingValue: 10 * 60 });

    const cycle0 = planFor([day1, day30], {
      segment: "C",
      entered: "2026-10-20 15:00",
      loop: true,
      now: "2026-11-18 10:00",
    });
    expect(cycle0.map((item) => [item.template.id, item.slot, localTime(item.sendAt)])).toEqual([
      [101, "", "2026-10-20T16:00"],
      [130, "", "2026-11-18T10:00"],
    ]);

    const cycle1 = planFor([day1, day30], {
      segment: "C",
      entered: "2026-10-20 15:00",
      loop: true,
      now: "2026-11-19 01:00",
    });
    expect(cycle1.map((item) => [item.template.id, item.slot, localTime(item.sendAt)])).toEqual([
      [101, "1", "2026-11-19T16:00"],
      [130, "1", "2026-12-18T10:00"],
    ]);
    expect(pickNext(cycle1, none, T("2026-11-19 01:00"), unused)).toBeNull();
    expect(pickNext(cycle1, none, T("2026-11-19 16:00"), unused)?.slot).toBe("1");

    const cycle2 = cycleForRun({ segment: "E", enteredAt: T("2026-10-20 15:00") }, T("2026-12-19 00:00"), true);
    expect(cycle2).toEqual({ cycleIndex: 2, slot: "2" });

    const disabled = planFor([day1, day30], {
      segment: "C",
      entered: "2026-10-20 15:00",
      loop: false,
      now: "2026-11-19 01:00",
    });
    expect(disabled.every((item) => item.slot === "")).toBe(true);
    expect(pickNext(disabled, none, T("2026-11-19 01:00"), unused)).toBeNull();
  });

  it("anchors looped C/E cycles to the entry time of day, not midnight", () => {
    const relative = template({ id: 301, day: 1, timingMode: "relative", timingValue: 60 });
    const relativeDay3 = template({ id: 303, day: 3, timingMode: "relative", timingValue: 30 });
    const clockDay1 = template({ id: 311, day: 1, timingMode: "clock", timingValue: 9 * 60 });

    const cycle0 = planChain([relative, relativeDay3, clockDay1], {
      segment: "E",
      enteredAt: T("2026-10-20 15:00"),
      lastAdminChatAt: T("2026-10-20 18:00"),
      loop: true,
      now: T("2026-10-20 18:00"),
    });
    expect(cycle0.map((item) => [item.template.id, localTime(item.sendAt)])).toEqual([
      [301, "2026-10-20T19:00"],
      [311, "2026-10-21T09:00"],
      [303, "2026-10-22T18:30"],
    ]);

    for (const k of [1, 2]) {
      const cycleDay1 = new Date(T("2026-10-20 15:00").getTime() + k * 30 * 24 * 60 * MINUTE);
      const cycle = planChain([relative, relativeDay3, clockDay1], {
        segment: "E",
        enteredAt: T("2026-10-20 15:00"),
        lastAdminChatAt: T("2026-10-20 18:00"),
        loop: true,
        now: cycleDay1,
      });
      const day1Local = localTime(cycleDay1).slice(0, 10);
      const day3Local = localTime(new Date(cycleDay1.getTime() + 2 * 24 * 60 * MINUTE)).slice(0, 10);
      expect(cycle.map((item) => [item.template.id, item.slot, localTime(item.sendAt)])).toEqual([
        [311, String(k), `${day1Local}T09:00`],
        [301, String(k), `${day1Local}T16:00`],
        [303, String(k), `${day3Local}T15:30`],
      ]);
    }
  });

  it("wraps link-bound segments after Day 30 into synthetic Day 1..30 cycle with slot 1", () => {
    const day1Reminder = template({ id: 201, day: 1, timingMode: "relative", timingValue: 60 });
    const day2Trigger = template({ id: 202, day: 2, kind: "trigger", timingMode: "clock", timingValue: 10 * 60 });
    const day30Trigger = template({ id: 230, day: 30, kind: "trigger", timingMode: "clock", timingValue: 10 * 60 });

    const day30 = planFor([day1Reminder, day2Trigger, day30Trigger], {
      segment: "A",
      entered: "2026-10-20 09:00",
      day: 1,
      expires: "2026-10-21 09:00",
      loop: true,
      now: "2026-11-19 08:59",
    });
    expect(day30.map((item) => [item.template.id, item.slot, localTime(item.sendAt)])).toEqual([
      [201, "", "2026-10-20T10:00"],
      [202, "", "2026-10-21T10:00"],
      [230, "", "2026-11-18T10:00"],
    ]);

    const day31 = planFor([day1Reminder, day2Trigger, day30Trigger], {
      segment: "A",
      entered: "2026-10-20 09:00",
      day: 1,
      expires: "2026-10-21 09:00",
      loop: true,
      now: "2026-11-19 10:00",
    });
    expect(day31.map((item) => [item.template.id, item.slot, localTime(item.sendAt)])).toEqual([
      [201, "1", "2026-11-19T10:00"],
      [202, "1", "2026-11-20T10:00"],
      [230, "1", "2026-12-18T10:00"],
    ]);
    expect(pickNext(day31, none, T("2026-11-19 10:00"), unused)).toMatchObject({ template: day1Reminder, slot: "1" });
    expect(pickNext(day31, new Set([201]), T("2026-11-20 10:00"), unused)).toMatchObject({
      template: day2Trigger,
      slot: "1",
    });
  });

  it("wraps link-bound segments accurately when initial grant started on day > 1", () => {
    const day1Reminder = template({ id: 301, day: 1, timingMode: "relative", timingValue: 60 });
    const day2Trigger = template({ id: 302, day: 2, kind: "trigger", timingMode: "clock", timingValue: 10 * 60 });

    const stillCycle0 = planFor([day1Reminder, day2Trigger], {
      segment: "B",
      entered: "2026-10-20 09:00",
      day: 3,
      expires: "2026-10-21 09:00",
      loop: true,
      now: "2026-11-17 08:59",
    });
    expect(stillCycle0).toEqual([]);

    const wrapped = planFor([day1Reminder, day2Trigger], {
      segment: "B",
      entered: "2026-10-20 09:00",
      day: 3,
      expires: "2026-10-21 09:00",
      loop: true,
      now: "2026-11-17 09:00",
    });
    expect(wrapped.map((item) => [item.template.id, item.slot, localTime(item.sendAt)])).toEqual([
      [301, "1", "2026-11-17T10:00"],
      [302, "1", "2026-11-18T10:00"],
    ]);
  });
});
