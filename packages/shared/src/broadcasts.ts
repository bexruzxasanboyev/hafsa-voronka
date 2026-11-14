import { z } from "zod";
import {
  autoDeleteMinutesSchema,
  MAX_TEMPLATE_BUTTONS,
  sanitizeTelegramHtml,
  TEMPLATE_TEXT_LIMITS,
  templateMediaSchema,
  templateMediaTypes,
  templateTextLimit,
  visibleLength,
  type SanitizeError,
} from "./messages";

export const broadcastAudiences = ["all", "A", "B", "C", "E", "bought", "not_bought"] as const;

export type BroadcastAudience = (typeof broadcastAudiences)[number];

export const broadcastStatuses = ["scheduled", "running", "done", "cancelled"] as const;

export type BroadcastStatus = (typeof broadcastStatuses)[number];

export const broadcastVariables = ["ism", "name"] as const;

export type BroadcastVariable = (typeof broadcastVariables)[number];

export const broadcastButtonKinds = ["admin", "link", "resume"] as const;

export type BroadcastButtonKind = (typeof broadcastButtonKinds)[number];

const broadcastButtonText = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !/[\r\n{]/.test(value));

const broadcastHttpsUrl = z
  .url()
  .max(512)
  .refine((value) => value.startsWith("https://"));

export const broadcastButtonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resume"), text: broadcastButtonText }),
  z.object({ kind: z.literal("admin"), text: broadcastButtonText, prefill: z.string().max(200).optional() }),
  z.object({ kind: z.literal("link"), text: broadcastButtonText, url: broadcastHttpsUrl }),
]);

export type BroadcastButton = z.infer<typeof broadcastButtonSchema>;

export type BroadcastTextError = {
  error: "empty" | "too_long" | SanitizeError | "unknown_variable";
  variable?: string;
};

export function validateBroadcastText(text: string, hasMedia: boolean): BroadcastTextError | null {
  if (!text.trim()) return { error: "empty" };
  for (const match of text.matchAll(/\{([A-Za-z_]+)\}/g)) {
    if (!(broadcastVariables as readonly string[]).includes(match[1])) {
      return { error: "unknown_variable", variable: match[1] };
    }
  }
  const sanitized = sanitizeTelegramHtml(text);
  if (!sanitized.ok) return { error: sanitized.error };
  if (visibleLength(sanitized.html) > templateTextLimit(hasMedia)) return { error: "too_long" };
  return null;
}

const broadcastAudiencesField = z
  .array(z.enum(broadcastAudiences))
  .min(1)
  .max(broadcastAudiences.length)
  .transform((items) => [...new Set(items)]);

export const broadcastBaseSchema = z.object({
  text: z.string().max(TEMPLATE_TEXT_LIMITS.message * 3),
  media: templateMediaSchema.nullable().default(null),
  buttons: z.array(broadcastButtonSchema).max(MAX_TEMPLATE_BUTTONS).default([]),
  audiences: broadcastAudiencesField,
  scheduledAt: z.string().datetime({ offset: true }),
  autoDeleteMinutes: autoDeleteMinutesSchema.default(null),
});

export type BroadcastInput = z.infer<typeof broadcastBaseSchema>;

export const broadcastInputSchema = broadcastBaseSchema.superRefine((input, ctx) => {
  const issue = validateBroadcastText(input.text, input.media !== null);
  if (issue) {
    ctx.addIssue({
      code: "custom",
      message: issue.error,
      path: ["text"],
    });
  }
  const scheduledMs = Date.parse(input.scheduledAt);
  if (Number.isNaN(scheduledMs)) {
    ctx.addIssue({
      code: "custom",
      message: "invalid_schedule",
      path: ["scheduledAt"],
    });
  }
});

export const broadcastPreviewSchema = z.object({
  audiences: broadcastAudiencesField,
});

export type BroadcastPreviewRequest = z.infer<typeof broadcastPreviewSchema>;

export const broadcastPreviewResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});

export type BroadcastPreviewResponse = z.infer<typeof broadcastPreviewResponseSchema>;

export const scheduledBroadcastSchema = z.object({
  id: z.number().int().positive(),
  text: z.string(),
  media: z.object({ type: z.enum(templateMediaTypes), fileId: z.string().optional() }).nullable(),
  buttons: z.array(broadcastButtonSchema),
  audiences: z.array(z.enum(broadcastAudiences)),
  scheduledAt: z.string(),
  autoDeleteMinutes: autoDeleteMinutesSchema,
  status: z.enum(broadcastStatuses),
  targetCount: z.number().int().nonnegative().nullable(),
  sentCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export type ScheduledBroadcast = z.infer<typeof scheduledBroadcastSchema>;

export const broadcastsResponseSchema = z.object({
  mediaEnabled: z.boolean(),
  broadcasts: z.array(scheduledBroadcastSchema),
});

export type BroadcastsResponse = z.infer<typeof broadcastsResponseSchema>;
