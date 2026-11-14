import { z } from "zod";

export const adminLoginRequestSchema = z.object({
  password: z.string().min(1),
});

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const adminStatsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.string().optional(),
  campaign: z.string().optional(),
});

export type AdminStatsQuery = z.infer<typeof adminStatsQuerySchema>;

export const kpiStatsSchema = z.object({
  landingViews: z.number(),
  botStarts: z.number(),
  registrations: z.number(),
  completions: z.number(),
  channelClicks: z.number(),
  conversionRate: z.number(),
});

export type KpiStats = z.infer<typeof kpiStatsSchema>;

export const funnelStepSchema = z.object({
  step: z.string(),
  name: z.string(),
  count: z.number(),
  conversionRate: z.number(),
});

export type FunnelStep = z.infer<typeof funnelStepSchema>;

export const dailyStatSchema = z.object({
  date: z.string(),
  registrations: z.number(),
  completions: z.number(),
});

export type DailyStat = z.infer<typeof dailyStatSchema>;

export const campaignStatSchema = z.object({
  source: z.string(),
  campaign: z.string(),
  content: z.string(),
  botStarts: z.number(),
  registrations: z.number(),
  completions: z.number(),
  completionRate: z.number(),
  channelClicks: z.number(),
});

export type CampaignStat = z.infer<typeof campaignStatSchema>;

export const dropoffStatSchema = z.object({
  minute: z.number(),
  count: z.number(),
  share: z.number(),
});

export type DropoffStat = z.infer<typeof dropoffStatSchema>;

export const healthStatSchema = z.object({
  sheetsBacklog: z.number(),
  sheetsFailures: z.number(),
  lastBotStartAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
});

export type HealthStat = z.infer<typeof healthStatSchema>;

export const statsFilterOptionsSchema = z.object({
  sources: z.array(z.string()),
  campaigns: z.array(
    z.object({
      source: z.string(),
      campaign: z.string(),
    }),
  ),
});

export type StatsFilterOptions = z.infer<typeof statsFilterOptionsSchema>;

export const adminStatsResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  kpis: kpiStatsSchema,
  funnel: z.array(funnelStepSchema),
  daily: z.array(dailyStatSchema),
  campaigns: z.array(campaignStatSchema),
  dropoff: z.array(dropoffStatSchema),
  health: healthStatSchema,
  filterOptions: statsFilterOptionsSchema,
});

export type AdminStatsResponse = z.infer<typeof adminStatsResponseSchema>;

export const adminLeadsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.string().optional(),
  campaign: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type AdminLeadsQuery = z.infer<typeof adminLeadsQuerySchema>;

export const leadItemSchema = z.object({
  id: z.number(),
  registeredAt: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  username: z.string().nullable(),
  source: z.string().nullable(),
  campaign: z.string().nullable(),
  progressPercent: z.number(),
  completed: z.boolean(),
  channelClicked: z.boolean(),
});

export type LeadItem = z.infer<typeof leadItemSchema>;

export const adminLeadsResponseSchema = z.object({
  leads: z.array(leadItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export type AdminLeadsResponse = z.infer<typeof adminLeadsResponseSchema>;

export const campaignLinkCreateSchema = z.object({
  utmSource: z.string().trim().min(1).max(100),
  utmCampaign: z.string().trim().min(1).max(100),
  utmContent: z.string().trim().max(100).optional(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,62}$/)
    .optional(),
});

export type CampaignLinkCreate = z.infer<typeof campaignLinkCreateSchema>;

export const campaignLinkItemSchema = z.object({
  code: z.string(),
  utmSource: z.string(),
  utmCampaign: z.string(),
  utmContent: z.string().nullable(),
  botUrl: z.string(),
  landingUrl: z.string(),
  botStarts: z.number(),
  registrations: z.number(),
  createdAt: z.string(),
});

export type CampaignLinkItem = z.infer<typeof campaignLinkItemSchema>;

export const campaignLinksResponseSchema = z.object({
  items: z.array(campaignLinkItemSchema),
});

export type CampaignLinksResponse = z.infer<typeof campaignLinksResponseSchema>;
