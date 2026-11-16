import { describe, expect, it } from "vitest";
import { funnelStatuses, type FunnelStatus } from "@funnel/shared";
import { endReasonFor, isLessonClosed, lifecycleSegmentFor, segmentFor, statusFor } from "./status";

type Marks = { duration: number; introEndSec: number | null; courseStartSec: number | null; priceSec: number | null };

const registered = {
  registeredAt: new Date(1),
  wroteAdminAt: null as Date | null,
  offerWatchedAt: null as Date | null,
  paidAt: null as Date | null,
};
const fullMarks: Marks = { duration: 1000, introEndSec: 100, courseStartSec: 700, priceSec: 900 };
const noMarks: Marks = { duration: 1000, introEndSec: null, courseStartSec: null, priceSec: null };

function progress(maxPosition: number, started = true) {
  return { maxPosition, startedAt: started ? new Date(2) : null };
}

describe("statusFor", () => {
  it("is null for an unregistered user", () => {
    expect(statusFor(progress(500), fullMarks, { ...registered, registeredAt: null })).toBeNull();
  });

  it("is sotib_oldi once paidAt is set, taking precedence over adminga_yozdi and price mark", () => {
    const paidUser = { ...registered, wroteAdminAt: new Date(3), paidAt: new Date(6) };
    expect(statusFor(progress(950), fullMarks, paidUser)).toBe("sotib_oldi");
    expect(statusFor(undefined, fullMarks, { ...registered, paidAt: new Date(6) })).toBe("sotib_oldi");
    expect(statusFor(progress(950), fullMarks, { ...paidUser, registeredAt: null })).toBeNull();
  });

  it("is adminga_yozdi once the user wrote to admin, even past the price mark", () => {
    const user = { ...registered, wroteAdminAt: new Date(3) };
    expect(statusFor(progress(950), fullMarks, user)).toBe("adminga_yozdi");
    expect(statusFor(undefined, fullMarks, user)).toBe("adminga_yozdi");
  });

  it("is narxni_kurdi once the short course video was watched, without any main video progress", () => {
    const user = { ...registered, offerWatchedAt: new Date(4) };
    expect(statusFor(undefined, fullMarks, user)).toBe("narxni_kurdi");
    expect(statusFor(progress(10), fullMarks, user)).toBe("narxni_kurdi");
    expect(statusFor(progress(10), fullMarks, { ...user, wroteAdminAt: new Date(5) })).toBe("adminga_yozdi");
  });

  it("is link_berildi without progress or before any play", () => {
    expect(statusFor(undefined, fullMarks, registered)).toBe("link_berildi");
    expect(statusFor(progress(0, false), fullMarks, registered)).toBe("link_berildi");
  });

  it("is korishni_boshladi once played, even at position 0", () => {
    expect(statusFor(progress(0), fullMarks, registered)).toBe("korishni_boshladi");
  });

  it("splits korishni_boshladi and dars_yarmida exactly at the lesson start mark", () => {
    expect(statusFor(progress(99), fullMarks, registered)).toBe("korishni_boshladi");
    expect(statusFor(progress(100), fullMarks, registered)).toBe("dars_yarmida");
    expect(statusFor(progress(699), fullMarks, registered)).toBe("dars_yarmida");
  });

  it("uses each video's own marks for the TZ 5:00, 15:00 and 18:22 boundaries", () => {
    const tz: Marks = { duration: 1500, introEndSec: 300, courseStartSec: 900, priceSec: 1102 };
    expect(statusFor(progress(299), tz, registered)).toBe("korishni_boshladi");
    expect(statusFor(progress(300), tz, registered)).toBe("dars_yarmida");
    expect(statusFor(progress(899), tz, registered)).toBe("dars_yarmida");
    expect(statusFor(progress(900), tz, registered)).toBe("sotuvda_toxtadi");
    expect(statusFor(progress(1101), tz, registered)).toBe("sotuvda_toxtadi");
    expect(statusFor(progress(1102), tz, registered)).toBe("narxni_kurdi");
  });

  it("switches to sotuvda_toxtadi exactly at the course start mark", () => {
    expect(statusFor(progress(700), fullMarks, registered)).toBe("sotuvda_toxtadi");
    expect(statusFor(progress(899), fullMarks, registered)).toBe("sotuvda_toxtadi");
  });

  it("switches to narxni_kurdi exactly at the price mark", () => {
    expect(statusFor(progress(900), fullMarks, registered)).toBe("narxni_kurdi");
    expect(statusFor(progress(1000), fullMarks, registered)).toBe("narxni_kurdi");
  });

  it("stays in dars_yarmida when no marks are set", () => {
    expect(statusFor(progress(500), noMarks, registered)).toBe("dars_yarmida");
    expect(statusFor(progress(1000), noMarks, registered)).toBe("dars_yarmida");
    expect(statusFor(progress(499), noMarks, registered)).toBe("korishni_boshladi");
  });

  it("uses the price mark as lesson end when only the price is set", () => {
    const marks = { ...noMarks, priceSec: 600 };
    expect(statusFor(progress(299), marks, registered)).toBe("korishni_boshladi");
    expect(statusFor(progress(300), marks, registered)).toBe("dars_yarmida");
    expect(statusFor(progress(599), marks, registered)).toBe("dars_yarmida");
    expect(statusFor(progress(600), marks, registered)).toBe("narxni_kurdi");
  });

  it("uses the lesson start mark even when the course start is missing", () => {
    const marks = { ...noMarks, introEndSec: 200, priceSec: 800 };
    expect(statusFor(progress(199), marks, registered)).toBe("korishni_boshladi");
    expect(statusFor(progress(200), marks, registered)).toBe("dars_yarmida");
  });
});

describe("isLessonClosed", () => {
  it("stays open for narxni_kurdi, adminga_yozdi, and sotib_oldi", () => {
    const expired = { registeredAt: new Date(1), linkExpiresAt: new Date(10), completedAt: null, channelClickAt: null };
    const now = new Date(20);
    expect(isLessonClosed(expired, "link_berildi", now, true)).toBe(true);
    expect(isLessonClosed(expired, "narxni_kurdi", now, true)).toBe(false);
    expect(isLessonClosed(expired, "adminga_yozdi", now, true)).toBe(false);
    expect(isLessonClosed(expired, "sotib_oldi", now, true)).toBe(false);
  });

  it("keeps the lesson open after an admin-button click only while clicks count", () => {
    const clicked = { registeredAt: new Date(1), linkExpiresAt: new Date(10), completedAt: null, channelClickAt: new Date(5) };
    expect(isLessonClosed(clicked, "link_berildi", new Date(20), true)).toBe(false);
    expect(isLessonClosed(clicked, "link_berildi", new Date(20), false)).toBe(true);
  });
});

describe("lifecycleSegmentFor", () => {
  const none = { wroteAdminAt: null, channelClickAt: null };
  const clicked = { wroteAdminAt: null, channelClickAt: new Date(1) };

  it("moves an admin-button click to E without Business, and only a real chat with Business", () => {
    expect(lifecycleSegmentFor("narxni_kurdi", none, true)).toBe("C");
    expect(lifecycleSegmentFor("narxni_kurdi", clicked, true)).toBe("E");
    expect(lifecycleSegmentFor("link_berildi", clicked, true)).toBe("E");
    expect(lifecycleSegmentFor("narxni_kurdi", clicked, false)).toBe("C");
    expect(lifecycleSegmentFor("adminga_yozdi", none, false)).toBe("E");
    expect(lifecycleSegmentFor("sotib_oldi", clicked, true)).toBeNull();
    expect(lifecycleSegmentFor(null, clicked, true)).toBeNull();
  });
});

describe("segmentFor", () => {
  it("maps every status", () => {
    const expected: Record<FunnelStatus, "A" | "B" | "C" | "E" | null> = {
      link_berildi: "A",
      korishni_boshladi: "B",
      dars_yarmida: "B",
      sotuvda_toxtadi: "B",
      narxni_kurdi: "C",
      adminga_yozdi: "E",
      sotib_oldi: null,
    };
    for (const status of funnelStatuses) expect(segmentFor(status)).toBe(expected[status]);
    expect(segmentFor(null)).toBeNull();
  });
});

describe("endReasonFor", () => {
  const user = { botBlocked: false, wroteAdmin: false };

  it("names each transition", () => {
    expect(endReasonFor("A", "B", user)).toBe("advanced");
    expect(endReasonFor("C", "E", { botBlocked: false, wroteAdmin: true })).toBe("advanced");
    expect(endReasonFor("A", "A", user)).toBe("relinked");
    expect(endReasonFor("B", null, { botBlocked: false, wroteAdmin: true })).toBe("wrote_admin");
    expect(endReasonFor("E", null, { botBlocked: false, wroteAdmin: true, paid: true })).toBe("bought");
    expect(endReasonFor("A", null, { botBlocked: true, wroteAdmin: true, paid: true })).toBe("bot_blocked");
  });
});
