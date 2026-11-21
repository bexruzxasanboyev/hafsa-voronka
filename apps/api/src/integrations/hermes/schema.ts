import { z } from "zod";

export const hermesMessageEventSchema = z.object({
  type: z.literal("message"),
  chatId: z.number().int().positive(),
  messageId: z.number().int().positive(),
  direction: z.enum(["in", "out"]),
  at: z.iso.datetime({ offset: true }),
});

export const hermesPaymentEventSchema = z.object({
  type: z.literal("payment"),
  hermesId: z.number().int().positive(),
  telegramId: z.number().int().positive(),
  payDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  amountUzs: z.number().int().nonnegative().nullable(),
  monthNo: z.number().int().nullable(),
  tariff: z.string().max(64).nullable(),
  confidence: z.string().min(1).max(64),
  source: z.string().max(64).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const hermesHeartbeatEventSchema = z.object({
  type: z.literal("heartbeat"),
  at: z.iso.datetime({ offset: true }),
});

export const hermesEventSchema = z.discriminatedUnion("type", [
  hermesMessageEventSchema,
  hermesPaymentEventSchema,
  hermesHeartbeatEventSchema,
]);

export const hermesIngestBodySchema = z.object({
  adminTelegramId: z.number().int().positive(),
  events: z.array(hermesEventSchema).max(500),
});

export type HermesEvent = z.infer<typeof hermesEventSchema>;
export type HermesMessageEvent = z.infer<typeof hermesMessageEventSchema>;
export type HermesPaymentEvent = z.infer<typeof hermesPaymentEventSchema>;
export type HermesHeartbeatEvent = z.infer<typeof hermesHeartbeatEventSchema>;
export type HermesIngestBody = z.infer<typeof hermesIngestBodySchema>;
