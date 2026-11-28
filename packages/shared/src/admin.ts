import { z } from "zod";

export const ADMIN_PASSWORD_MIN_LENGTH = 10;
export const ADMIN_PASSWORD_MAX_LENGTH = 200;

/** Lowercase letters, digits, dot, underscore, dash; 3-32 chars. Inputs are trimmed and lowercased. */
export const adminUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

export const adminNewPasswordSchema = z
  .string()
  .min(ADMIN_PASSWORD_MIN_LENGTH)
  .max(ADMIN_PASSWORD_MAX_LENGTH);

export const adminLoginRequestSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(ADMIN_PASSWORD_MAX_LENGTH),
});

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const adminIdentitySchema = z.object({
  id: z.number().int(),
  username: z.string(),
});

export type AdminIdentity = z.infer<typeof adminIdentitySchema>;

/** POST /admin/login 200 */
export const adminLoginResponseSchema = z.object({
  ok: z.literal(true),
  token: z.string(),
  admin: adminIdentitySchema,
});

/** GET /admin/me 200 */
export const adminMeResponseSchema = z.object({
  ok: z.literal(true),
  admin: adminIdentitySchema,
});

/** POST /admin/account/password */
export const adminChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(ADMIN_PASSWORD_MAX_LENGTH),
  newPassword: adminNewPasswordSchema,
});

export type AdminChangePasswordRequest = z.infer<typeof adminChangePasswordRequestSchema>;

export const adminUserSchema = adminIdentitySchema.extend({
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
  isSelf: z.boolean(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

/** GET /admin/admins 200 */
export const adminUsersResponseSchema = z.object({
  admins: z.array(adminUserSchema),
});

/** POST /admin/admins */
export const adminCreateUserRequestSchema = z.object({
  username: adminUsernameSchema,
  password: adminNewPasswordSchema,
});

export type AdminCreateUserRequest = z.infer<typeof adminCreateUserRequestSchema>;

/** POST /admin/admins 201 */
export const adminCreateUserResponseSchema = z.object({
  admin: adminUserSchema,
});

/**
 * Error codes (JSON `{ error }`) of the admin account endpoints:
 * - POST /admin/login: 400 invalid_request, 401 invalid_credentials, 429 rate_limited
 * - POST /admin/account/password: 400 invalid_request | weak_password, 401 wrong_password, 429 rate_limited
 * - POST /admin/admins: 400 invalid_request | invalid_username | weak_password, 409 username_taken
 * - DELETE /admin/admins/:id: 400 cannot_delete_self, 404 not_found, 409 last_admin
 * - any authenticated route: 401 unauthorized
 */
export type AdminAccountErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "rate_limited"
  | "weak_password"
  | "wrong_password"
  | "invalid_username"
  | "username_taken"
  | "cannot_delete_self"
  | "not_found"
  | "last_admin"
  | "unauthorized";

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
  realChats: z.number(),
  purchases: z.number(),
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
  landingViews: z.number(),
  botStarts: z.number(),
  botStartRate: z.number().nullable(),
  registrations: z.number(),
  completions: z.number(),
  completionRate: z.number(),
  channelClicks: z.number(),
  realChats: z.number(),
  purchases: z.number(),
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

export const attributionNetworks = ["ig", "fb", "tg", "organic", "other"] as const;

export type AttributionNetwork = (typeof attributionNetworks)[number];

export const networkAttributionRowSchema = z.object({
  network: z.enum(attributionNetworks),
  registrations: z.number(),
  buttonClicks: z.number(),
  realChats: z.number(),
  purchases: z.number(),
});

export type NetworkAttributionRow = z.infer<typeof networkAttributionRowSchema>;

export const networkAttributionSchema = z.object({
  firstTouch: z.array(networkAttributionRowSchema),
  lastTouch: z.array(networkAttributionRowSchema),
});

export type NetworkAttribution = z.infer<typeof networkAttributionSchema>;

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
  attribution: networkAttributionSchema,
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
  wroteAdmin: z.boolean(),
  paid: z.boolean(),
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
