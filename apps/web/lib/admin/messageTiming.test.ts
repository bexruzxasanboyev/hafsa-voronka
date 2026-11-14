import { describe, expect, it } from "vitest";
import { TEMPLATE_DAYS } from "@funnel/shared";
import { defaultMinuteFor, timelineLabel, timingMode, timingSummary } from "./messageTiming";

const reminder = { kind: "reminder", atExpiry: false } as const;

describe("timingMode", () => {
  it("falls back to defaultTimingModeFor when timingMode is omitted", () => {
    expect(timingMode({ ...reminder, segment: "A", day: 1 })).toBe("relative");
    expect(timingMode({ ...reminder, segment: "B", day: 5 })).toBe("relative");
    expect(timingMode({ ...reminder, segment: "C", day: 1 })).toBe("relative");
    expect(timingMode({ ...reminder, segment: "C", day: 2 })).toBe("clock");
    expect(timingMode({ ...reminder, segment: "E", day: 30 })).toBe("clock");
  });

  it("respects explicit timingMode on any day 1..30 for reminders", () => {
    expect(TEMPLATE_DAYS).toBe(30);
    expect(timingMode({ ...reminder, segment: "A", day: 1, timingMode: "clock" })).toBe("clock");
    expect(timingMode({ ...reminder, segment: "B", day: 30, timingMode: "clock" })).toBe("clock");
    expect(timingMode({ ...reminder, segment: "C", day: 15, timingMode: "relative" })).toBe("relative");
    expect(timingMode({ ...reminder, segment: "E", day: 30, timingMode: "relative" })).toBe("relative");
  });

  it("lets a trigger fire at expiry or at a clock time", () => {
    expect(timingMode({ segment: "A", day: 2, kind: "trigger", atExpiry: true })).toBe("expiry");
    expect(timingMode({ segment: "B", day: 30, kind: "trigger", atExpiry: false })).toBe("clock");
  });
});

describe("defaults and labels", () => {
  it("starts relative timings at one hour and clock timings at 10:00", () => {
    expect(defaultMinuteFor({ ...reminder, segment: "A", day: 4 })).toBe(60);
    expect(defaultMinuteFor({ ...reminder, segment: "A", day: 4, timingMode: "clock" })).toBe(600);
    expect(defaultMinuteFor({ ...reminder, segment: "C", day: 4 })).toBe(600);
    expect(defaultMinuteFor({ ...reminder, segment: "C", day: 4, timingMode: "relative" })).toBe(60);
    expect(defaultMinuteFor({ segment: "A", day: 2, kind: "trigger", atExpiry: false })).toBe(600);
  });

  it("labels relative and clock reminders accurately across 30 days", () => {
    expect(timelineLabel({ ...reminder, segment: "B", day: 3, minute: 90, timingMode: "relative" })).toBe("+1 soat 30 daqiqa");
    expect(timelineLabel({ ...reminder, segment: "A", day: 20, minute: 570, timingMode: "clock" })).toBe("09:30");
    expect(timingSummary({ ...reminder, segment: "A", day: 30, minute: 570, timingMode: "clock" })).toBe("30-kun, soat 09:30");
    expect(timingSummary({ ...reminder, segment: "C", day: 10, minute: 120, timingMode: "relative" })).toBe(
      "Narxni ko‘rganidan 2 soat keyin",
    );
  });
});
