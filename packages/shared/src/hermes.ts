import { z } from "zod";

export const hermesPaymentKinds = ["paid", "deposit", "ignored"] as const;
export type HermesPaymentKind = (typeof hermesPaymentKinds)[number];

export const hermesStatusResponseSchema = z.object({
  configured: z.boolean(),
  lastSeenAt: z.string().nullable(),
  live: z.boolean(),
});
export type HermesStatusResponse = z.infer<typeof hermesStatusResponseSchema>;

export const hermesPaymentsQuerySchema = z.object({
  kind: z.enum(hermesPaymentKinds).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type HermesPaymentsQuery = z.infer<typeof hermesPaymentsQuerySchema>;

export const hermesPaymentItemSchema = z.object({
  hermesId: z.number().int(),
  telegramId: z.number().int(),
  userId: z.number().int().nullable(),
  userName: z.string().nullable(),
  payDate: z.string().nullable(),
  amountUzs: z.number().int().nullable(),
  monthNo: z.number().int().nullable(),
  tariff: z.string().nullable(),
  confidence: z.string(),
  kind: z.enum(hermesPaymentKinds),
  hermesCreatedAt: z.string(),
  updatedAt: z.string(),
});
export type HermesPaymentItem = z.infer<typeof hermesPaymentItemSchema>;

export const hermesPaymentsTotalsSchema = z.object({
  paid: z.object({
    count: z.number().int(),
    amountUzs: z.number().int(),
  }),
  deposit: z.object({
    count: z.number().int(),
    amountUzs: z.number().int(),
  }),
  ignored: z.object({
    count: z.number().int(),
  }),
});
export type HermesPaymentsTotals = z.infer<typeof hermesPaymentsTotalsSchema>;

export const hermesPaymentsResponseSchema = z.object({
  items: z.array(hermesPaymentItemSchema),
  totals: hermesPaymentsTotalsSchema,
});
export type HermesPaymentsResponse = z.infer<typeof hermesPaymentsResponseSchema>;
