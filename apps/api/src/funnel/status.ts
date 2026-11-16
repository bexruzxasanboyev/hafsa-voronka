import type { FunnelSegment, FunnelStatus, SegmentEndReason } from "@funnel/shared";
import type { User, Video } from "@/db/schema";

export type StatusProgress = { maxPosition: number; startedAt: Date | null };

export const NO_VIDEO_MARKS = { duration: 1, introEndSec: null, courseStartSec: null, priceSec: null };

type VideoMarks = Pick<Video, "duration" | "introEndSec" | "courseStartSec" | "priceSec">;

export function lessonStartSec(video: VideoMarks): number {
  return video.introEndSec ?? (video.courseStartSec ?? video.priceSec ?? video.duration) / 2;
}

export function statusFor(
  progress: StatusProgress | undefined,
  video: VideoMarks,
  user: Pick<User, "registeredAt" | "wroteAdminAt" | "offerWatchedAt"> & { paidAt?: Date | null },
): FunnelStatus | null {
  if (user.registeredAt === null) return null;
  if ((user.paidAt ?? null) !== null) return "sotib_oldi";
  if (user.wroteAdminAt !== null) return "adminga_yozdi";
  if (user.offerWatchedAt !== null) return "narxni_kurdi";
  if (!progress || (progress.startedAt === null && progress.maxPosition === 0)) return "link_berildi";

  const position = progress.maxPosition;
  if (video.priceSec !== null && position >= video.priceSec) return "narxni_kurdi";
  if (video.courseStartSec !== null && position >= video.courseStartSec) return "sotuvda_toxtadi";

  return position >= lessonStartSec(video) ? "dars_yarmida" : "korishni_boshladi";
}

type AdminContact = Pick<User, "wroteAdminAt" | "channelClickAt">;

/**
 * Funnel lifecycle notion of "contacted sales": a verified chat (wroteAdminAt), or an admin-button click
 * (channelClickAt) when `clickCounts` (see clickCountsAsAdminContact). Stats always keep the two apart.
 */
export function contactedAdmin(user: AdminContact, clickCounts: boolean): boolean {
  return user.wroteAdminAt !== null || (clickCounts && user.channelClickAt !== null);
}

export function isLessonClosed(
  user: Pick<User, "registeredAt" | "linkExpiresAt" | "completedAt" | "channelClickAt">,
  status: FunnelStatus | null,
  now: Date,
  clickCounts: boolean,
): boolean {
  return (
    user.registeredAt !== null &&
    !(clickCounts && user.channelClickAt !== null) &&
    user.linkExpiresAt !== null &&
    now >= user.linkExpiresAt &&
    user.completedAt === null &&
    status !== "narxni_kurdi" &&
    status !== "adminga_yozdi" &&
    status !== "sotib_oldi"
  );
}

export function segmentFor(status: FunnelStatus | null): FunnelSegment | null {
  switch (status) {
    case "link_berildi":
      return "A";
    case "korishni_boshladi":
    case "dars_yarmida":
    case "sotuvda_toxtadi":
      return "B";
    case "narxni_kurdi":
      return "C";
    case "adminga_yozdi":
      return "E";
    default:
      return null;
  }
}

export function lifecycleSegmentFor(
  status: FunnelStatus | null,
  user: AdminContact,
  clickCounts: boolean,
): FunnelSegment | null {
  if (status !== null && status !== "sotib_oldi" && contactedAdmin(user, clickCounts)) return "E";
  return segmentFor(status);
}

export function endReasonFor(
  open: FunnelSegment,
  target: FunnelSegment | null,
  user: { botBlocked: boolean; wroteAdmin: boolean; paid?: boolean },
): SegmentEndReason {
  if (target === null) return user.botBlocked ? "bot_blocked" : user.paid ? "bought" : "wrote_admin";
  return open === target ? "relinked" : "advanced";
}
