import { describe, expect, it } from "vitest";
import {
  autoDeleteMinutesSchema,
  compareTimeline,
  defaultMinute,
  defaultTimingModeFor,
  isNightMinute,
  isSameMoment,
  MAX_AUTO_DELETE_MINUTES,
  TEMPLATE_DAYS,
  validateTiming,
} from "@funnel/shared";

describe("validateTiming", () => {
  it("accepts any minute of the day on every day up to 30", () => {
    expect(validateTiming(1, 0)).toBeNull();
    expect(validateTiming(1, 1439)).toBeNull();
    expect(validateTiming(3, 30)).toBeNull();
    expect(validateTiming(TEMPLATE_DAYS, 1439)).toBeNull();
  });

  it("rejects days and minutes outside range and fractions", () => {
    expect(validateTiming(0, 0)).toBe("out_of_range");
    expect(validateTiming(31, 0)).toBe("out_of_range");
    expect(validateTiming(1, 1440)).toBe("out_of_range");
    expect(validateTiming(2, -1)).toBe("out_of_range");
    expect(validateTiming(2, 1.5)).toBe("out_of_range");
  });

  it("reports night minutes", () => {
    expect(isNightMinute(419)).toBe(true);
    expect(isNightMinute(420)).toBe(false);
    expect(isNightMinute(1379)).toBe(false);
    expect(isNightMinute(1380)).toBe(true);
  });
});

describe("timeline helpers", () => {
  it("defaults day 1 to an hour after entry and other days to 10:00", () => {
    expect(defaultMinute(1)).toBe(60);
    expect(defaultMinute(4)).toBe(600);
  });

  it("computes default timing modes", () => {
    expect(defaultTimingModeFor("A", 1, "reminder")).toBe("relative");
    expect(defaultTimingModeFor("B", 5, "reminder")).toBe("relative");
    expect(defaultTimingModeFor("B", 5, "trigger")).toBe("clock");
    expect(defaultTimingModeFor("C", 1, "reminder")).toBe("relative");
    expect(defaultTimingModeFor("C", 2, "reminder")).toBe("clock");
    expect(defaultTimingModeFor("E", 1, "reminder")).toBe("relative");
    expect(defaultTimingModeFor("E", 3, "reminder")).toBe("clock");
  });

  it("sorts by day, minute, position and id", () => {
    const items = [
      { day: 2, minute: 600, position: 1, id: 9 },
      { day: 1, minute: 900, position: 0, id: 3 },
      { day: 2, minute: 600, position: 0, id: 12 },
    ];
    expect([...items].sort(compareTimeline).map((item) => item.id)).toEqual([3, 12, 9]);
  });

  it("treats the same timing mode, day and minute as the same moment", () => {
    expect(isSameMoment({ day: 2, minute: 600 }, { day: 2, minute: 600 })).toBe(true);
    expect(isSameMoment({ day: 2, minute: 600, timingMode: "clock" }, { day: 2, minute: 600, timingMode: "relative" })).toBe(
      false,
    );
    expect(isSameMoment({ day: 2, minute: 600 }, { day: 3, minute: 600 })).toBe(false);
    expect(isSameMoment({ day: 2, minute: 600 }, { day: 2, minute: 601 })).toBe(false);
  });

  it("validates auto-delete minutes", () => {
    expect(autoDeleteMinutesSchema.safeParse(null).success).toBe(true);
    expect(autoDeleteMinutesSchema.safeParse(1).success).toBe(true);
    expect(autoDeleteMinutesSchema.safeParse(MAX_AUTO_DELETE_MINUTES).success).toBe(true);
    expect(autoDeleteMinutesSchema.safeParse(0).success).toBe(false);
    expect(autoDeleteMinutesSchema.safeParse(MAX_AUTO_DELETE_MINUTES + 1).success).toBe(false);
    expect(autoDeleteMinutesSchema.safeParse(1.5).success).toBe(false);
  });
});
