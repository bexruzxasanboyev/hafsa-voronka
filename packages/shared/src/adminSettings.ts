import { z } from "zod";

export const LINK_TTL_HOURS_MIN = 1;
export const LINK_TTL_HOURS_MAX = 720;
export const MESSAGE_DAILY_CEILING = 10;
export const MESSAGE_TOTAL_MAX = 100;
export const CHAT_CLEANUP_HOURS_OPTIONS = [1, 3, 6, 12, 24] as const;
export const DEFAULT_CHAT_CLEANUP_HOURS = 24;

export const chatCleanupHoursSchema = z
  .number()
  .int()
  .refine((hours) => (CHAT_CLEANUP_HOURS_OPTIONS as readonly number[]).includes(hours));

export const segmentCapSchema = z.object({
  daily: z.number().int().min(1).max(MESSAGE_DAILY_CEILING),
  total: z.number().int().min(1).max(MESSAGE_TOTAL_MAX).nullable(),
});

export type SegmentCap = z.infer<typeof segmentCapSchema>;

export const DEFAULT_SEGMENT_E_CAP = { daily: 2, total: 5 } as const;
export const DEFAULT_NIGHT_RESTRICTION_ENABLED = false;

export const segmentLoopsSchema = z.object({
  A: z.boolean(),
  B: z.boolean(),
  C: z.boolean(),
  E: z.boolean(),
});

export type SegmentLoops = z.infer<typeof segmentLoopsSchema>;

export const DEFAULT_SEGMENT_LOOPS: SegmentLoops = {
  A: true,
  B: true,
  C: true,
  E: true,
};

export const messageCapsSchema = z.object({
  A: segmentCapSchema,
  B: segmentCapSchema,
  C: segmentCapSchema,
  E: segmentCapSchema.default(DEFAULT_SEGMENT_E_CAP),
});

export type MessageCaps = z.infer<typeof messageCapsSchema>;

export const DEFAULT_MESSAGE_CAPS: MessageCaps = {
  A: { daily: MESSAGE_DAILY_CEILING, total: null },
  B: { daily: 4, total: null },
  C: { daily: MESSAGE_DAILY_CEILING, total: null },
  E: { ...DEFAULT_SEGMENT_E_CAP },
};

export const adminSettingsSchema = z.object({
  linkTtlHours: z.number().int().min(LINK_TTL_HOURS_MIN).max(LINK_TTL_HOURS_MAX),
  messageCaps: messageCapsSchema,
  chatCleanupHours: chatCleanupHoursSchema,
  nightRestrictionEnabled: z.boolean().default(DEFAULT_NIGHT_RESTRICTION_ENABLED),
  segmentLoops: segmentLoopsSchema.default(DEFAULT_SEGMENT_LOOPS),
});

export const adminSettingsUpdateSchema = adminSettingsSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export type AdminSettingsUpdate = z.infer<typeof adminSettingsUpdateSchema>;

export const businessConnectionItemSchema = z.object({
  id: z.string(),
  userTelegramId: z.number(),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  canReply: z.boolean(),
  isEnabled: z.boolean(),
  isApproved: z.boolean(),
  connectedAt: z.string(),
  updatedAt: z.string(),
});

export type BusinessConnectionItem = z.infer<typeof businessConnectionItemSchema>;

export const businessConnectionsResponseSchema = z.object({
  items: z.array(businessConnectionItemSchema),
  botUsername: z.string(),
});

export type BusinessConnectionsResponse = z.infer<typeof businessConnectionsResponseSchema>;

export const businessConnectionApprovalSchema = z.object({
  isApproved: z.boolean(),
});

export type BusinessConnectionApproval = z.infer<typeof businessConnectionApprovalSchema>;
