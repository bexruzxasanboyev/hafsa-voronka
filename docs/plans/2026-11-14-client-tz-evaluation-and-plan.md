# Client TZ Evaluation, Architecture Mapping & Implementation Plan

**Date:** 2026-11-14  
**Target Repository:** `/home/estoyse/work/video-funnel` (working branch: `feat/tg-ads-links`)  
**Status:** Architectural evaluation & milestone implementation plan for the 4-section Uzbek client TZ (`1-BO‘LIM` – `4-BO‘LIM`).

This document evaluates the client's 4-section technical specification against the deployed TypeScript monorepo (`@funnel/api`, `@funnel/web`, `@funnel/shared`), maps generic framework assumptions onto the existing production stack, resolves architectural ambiguities, and breaks delivery into four milestones.

> **Historical Context:** Prior specifications ([2026-10-27-tz-7-kunlik-voronka.md](../plans/2026-10-27-tz-7-kunlik-voronka.md) and [2026-10-26-reminder-timeline-redesign-design.md](../superpowers/specs/2026-10-26-reminder-timeline-redesign-design.md)) were implemented through migrations `0025_reminder_timeline.sql` and `0026_funnel_day_triggers.sql`. Those changes retired Segment D («Qayta imkon»), removed forced `23:00–07:00` night quiet hours in `Eslatmalar`, unified reminders on a 1–7 day timeline, and introduced per-day `trigger` templates with `is_permanent` protection. The new 4-section client TZ builds directly on top of that foundation.

---

## 1. Executive Summary & Stack Adaptation

### 1.1 Mapping Client TZ Assumptions to the Deployed TypeScript Monorepo

The client TZ describes features using generic Python/Celery/BullMQ/MTProto terminology. Rewriting the system in Python or adding Redis/Celery/BullMQ queues is unnecessary and would jeopardize production stability. All four TZ sections map cleanly onto the existing TypeScript monorepo:

| Client TZ Assumption | Deployed Production Stack | Exact Repo Locations & Adaptation |
|---|---|---|
| FastAPI / Django / Flask backend | **Hono v4** HTTP API + **grammY v1.46** Telegram bot (`@funnel/api`) | `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/routes/*`, `apps/api/src/telegram/bot.ts` |
| Celery / Redis / BullMQ workers | **PostgreSQL 17 advisory-locked in-process `setInterval` workers** | `apps/api/src/messages/dispatch.ts` (`startMessageDispatchLoop` / `dispatchMessages` using `pg_try_advisory_lock`), `apps/api/src/leads/notifier.ts` (`startLeadNotifyLoop`), `apps/api/src/videos/rollout/run.ts` (scheduled rollouts processed inside `dispatch.ts`), bootstrapped in `apps/api/src/index.ts`; new scheduled broadcast ticks extend this pattern (or a dedicated scheduler module) without adding Redis |
| SQLAlchemy / Alembic | **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) + **PostgreSQL 17** | `apps/api/src/db/schema.ts`, `apps/api/drizzle/*.sql` (latest: `0026_funnel_day_triggers.sql`) |
| Telethon / Pyrogram MTProto userbot | **Telegram Business Bot API** native in `grammy@^1.46.0` | `apps/api/src/telegram/bot.ts` + `apps/api/scripts/set-webhook.ts` (`business_connection`, `business_message` updates) |
| Custom admin templates / Jinja | **Next.js 16 (App Router) + React 19 + Tailwind v4** | `apps/web/app/(site)/admin/(panel)/*`, `apps/web/components/admin/*` |
| Ad-hoc form inputs & rich editor | **Radix UI (`Select`, `Popover`) + TipTap v3** | `apps/web/components/admin/ui/Select.tsx`, `@radix-ui/react-popover`, `apps/web/components/admin/messages/editor/TextEditor.tsx` |
| Duplicated API validation | **Shared Zod schemas & TS contracts (`@funnel/shared`)** | `packages/shared/src/*.ts` (`admin.ts`, `adminSettings.ts`, `botTexts.ts`, `funnel.ts`, `messages.ts`, etc.) |

### 1.2 Why Implementing Inside This Architecture Preserves Production

1. **Zero Infrastructure Expansion in `deploy/docker-compose.prod.yml`:** Production runs four core services (`postgres:17-alpine`, `telegram-bot-api:10.3` local Bot API server, the `api` Hono/Node container, and optional `caddy:2.10-alpine`). Extending Drizzle schemas and `setInterval` workers keeps the single-node deployment footprint intact without introducing Redis, Celery workers, or stateful MTProto session volumes.
2. **Existing Funnel Guarantees Stay Intact:** Advisory locking (`DISPATCH_LOCK_KEY` in `apps/api/src/messages/dispatch.ts`), idempotent `sent_messages` reservations (`sent_messages_run_template_slot_idx`), 48-hour Telegram `deleteMessage` guards (`DELETE_LIMIT_MS`), Meta CAPI (`apps/api/src/capi.ts`), Google Sheets lead sync (`apps/api/src/leads/sheet.ts`), and Telegram group lead cards (`apps/api/src/leads/notifier.ts`) remain untouched and battle-tested.
3. **End-to-End Type Safety:** Updating contracts once in `packages/shared/src/` enforces compile-time consistency across Drizzle queries, Hono route handlers, and Next.js 16 admin components.

---

## 2. Milestone 1 (`1-BO‘LIM` — Telegram Ads Links & Admin Panel Statistics)

**Goal:** Enable tracking of direct-to-bot Telegram Ads links (`/start c_<code>`) alongside landing-page UTMs, provide admin link generation/management, fix dashboard filter UX, and correct direct-to-bot funnel conversion math.

### 2.1 Zero-Migration Attribution & Link Reuse

No database migration is required for Milestone 1 because the attribution storage and `/start` parser already exist in production:

- **`campaign_links` table** (`apps/api/src/db/schema.ts`):
  - `code text PRIMARY KEY`
  - `utm jsonb` typed as `Utm` (`utm_source`, `utm_campaign`, `utm_content`, `fbclid`)
  - `created_at timestamptz DEFAULT now() NOT NULL`
- **`parseStartParam` & `resolveAttribution`** (`apps/api/src/funnel/attribution.ts`):
  - `/start c_<code>` resolves `campaignLinks.utm` directly when `upsertUser` (`apps/api/src/funnel/users.ts`) creates a new user.
  - Landing-page visitors hitting `<WEB_URL>?utm_source=tg&utm_campaign=...&utm_content=...` are tracked via `apps/web/landing/js/main.js` (`utmParams()` → `POST /track` with `type: "landing_view"` and 10-char `visitor_id`), then forwarded via `/start v_<vid>`, which `resolveAttribution` resolves from the earliest `landing_view` event in `events`.

### 2.2 Backend API: `/admin/links` & Filter Options

1. **Shared Contracts (`packages/shared/src/admin.ts`):**
   - `statsFilterOptionsSchema` (`sources: string[]`, `campaigns: { source: string; campaign: string }[]`) added to `adminStatsResponseSchema` (`filterOptions`).
   - `campaignLinkCreateSchema` (`utmSource`, `utmCampaign`, optional `utmContent`, optional `code` matching `/^[A-Za-z0-9_-]{1,62}$/` so `c_${code}` stays within Telegram's 64-char `start` limit).
   - `campaignLinkItemSchema` (`code`, `utmSource`, `utmCampaign`, `utmContent`, `botUrl`, `landingUrl`, `botStarts`, `registrations`, `createdAt`) and `campaignLinksResponseSchema`.
2. **Campaign Links Service & Routes (new Milestone 1 files):**
   - `apps/api/src/links/campaignLinks.ts`: generates/validates short `code`, builds both URLs:
     - `botUrl`: `https://t.me/<BOT_USERNAME>?start=c_<code>`
     - `landingUrl`: `<WEB_URL>?utm_source=...&utm_campaign=...&utm_content=...`
     - Aggregates live `botStarts` (`count(DISTINCT u.id)`) and `registrations` (`count(DISTINCT CASE WHEN u.registered_at IS NOT NULL THEN u.id END)`) from `users` matched via `u.start_param = 'c_' || cl.code` or non-`c_` landing UTM match (`utm_source`, `utm_campaign`, `utm_content`).
   - `apps/api/src/routes/adminLinks.ts` mounted under `adminRoutes` in `apps/api/src/routes/admin.ts`:
     - `GET /admin/links` — list links with URLs and live counts.
     - `POST /admin/links` — create/upsert campaign link.
     - `DELETE /admin/links/:code` — delete campaign link.
3. **Admin Stats & Funnel Math (`apps/api/src/admin/queries.ts` & `apps/api/src/routes/admin.ts`):**
   - Wire `getFilterOptions()` into `GET /admin/stats` (`apps/api/src/routes/admin.ts`):
     - Canonical sources `['tg', 'ig', 'fb']` (`CANONICAL_SOURCES`) merged with any observed non-empty `utm_source` across `users`, `campaign_links`, and `events` (`landing_view`).
     - Campaign options paired with `source` so the UI scopes campaigns by selected source.
   - **Direct-to-Bot Funnel Math Fix:** Currently `getFunnelAndKpis` computes `conversionRate = landingViews > 0 ? ... : 0`, which reports `0%` for direct `/start c_<code>` Telegram Ads traffic (`landingViews === 0`). Milestone 1 updates:
     - `conversionBase = landingViews > 0 ? landingViews : botStarts` in `getFunnelAndKpis` for KPI `conversionRate` (`channelClicks / conversionBase`).

### 2.3 Admin Web UI (`apps/web`)

- **`Havolalar` Drawer (`CampaignLinksSheet` in `apps/web/components/admin/`):**
  - Accessible from the `/admin` dashboard header/actions (`apps/web/app/(site)/admin/(panel)/page.tsx`).
  - Create form (`Manba`, `Kampaniya`, `Kontent`, optional custom `Kod`) and table/cards displaying one-click copy buttons for both `botUrl` and `landingUrl`, live `botStarts` / `registrations`, and delete action.
- **Filter Dropdowns on `/admin` (`apps/web/app/(site)/admin/(panel)/page.tsx`):**
  - Replace free-text `<Input>` fields for `Manba` (`source`) and `Kampaniya` (`campaign`) with `<Select>` (`apps/web/components/admin/ui/Select.tsx`, backed by `@radix-ui/react-select`).
  - Populated from `stats.filterOptions` (`tg`, `ig`, `fb` + custom sources; `Kampaniya` dynamically filtered by selected `source`).
  - **Radix Select Sentinel Rule:** Because `@radix-ui/react-select` throws if `<Select.Item value="">` is rendered, use a `"__all__"` sentinel value for the "Barchasi" option and translate `"__all__" ↔ ""` at the filter state boundary.
- **`CampaignTable` (`apps/web/components/admin/CampaignTable.tsx`):**
  - Add the **`Tugatgan`** (`completions`, `row.completions`) column alongside `botStarts`, `registrations`, `completionRate`, and `channelClicks`.
- **`KpiCards` (`apps/web/components/admin/KpiCards.tsx`):**
  - Switches the 5th KPI card label/note to `"Botdan adminga yozishgacha"` (`botConversionRate` / `botConversionNote`) when `landingViews === 0 && botStarts > 0`.
- **`FlowFunnel` (`apps/web/components/admin/FlowFunnel.tsx`):**
  - Fix `fromFirst` denominator so instead of blindly dividing by `stages[0].count` (`landing_view`), it uses the **first non-zero stage count** (`stages.find((s) => s.count > 0)?.count ?? 0`) when earlier landing stages are `0` for direct-to-bot traffic.

---

## 3. Milestone 2 (`2-BO‘LIM §2.1 & §2.2` — Telegram Business Bot API, Lifecycle State Machine & Sales Attribution)

**Goal:** Distinguish button-click intent from real Telegram admin DMs, promote "wrote to admin" and "bought" into first-class funnel stages, never interrupt active human sales chats, and track both First-Touch and Last-Touch attribution across ad networks.

### 3.1 Architecture Decision (§2.1): Telegram Business Bot API vs MTProto

The client TZ proposes monitoring admin private chats via MTProto (`Telethon` / `Pyrogram`). We reject MTProto in favor of the **Telegram Business Bot API** (`business_connection` + `business_message`), which is natively supported in `grammy@^1.46.0`:

| Criterion | MTProto Userbot (Telethon/Pyrogram) | Telegram Business Bot API (grammY) |
|---|---|---|
| Account Ban Risk | High (unofficial session automation on personal sales accounts) | **Zero** (official Bot API feature for Telegram Business accounts) |
| Session & Auth Ops | Phone/OTP/QR login, encrypted `.session` file persistence, reconnect daemons | **Zero session files** — admin connects bot once inside Telegram Business Settings |
| Webhook Delivery | Requires dedicated long-running polling worker | **Native webhook POST `/bot`** into existing `apps/api` Hono server |
| Privacy & Scope | Full account access to unrelated personal chats | Scoped strictly to Business-connected chats via `business_connection` |

#### Critical Deployment Requirement (`apps/api/scripts/set-webhook.ts`)

Currently `apps/api/scripts/set-webhook.ts` registers:

```ts
allowed_updates: ["message", "my_chat_member", "callback_query"]
```

**Milestone 2 MUST update `allowed_updates`** to include `"business_connection"` and `"business_message"` (and re-run `pnpm --filter @funnel/api set-webhook` in production):

```ts
allowed_updates: [
  "message",
  "my_chat_member",
  "callback_query",
  "business_connection",
  "business_message",
]
```

Without this change, Telegram silently withholds Business DM updates even after the admin connects the bot in Telegram Settings.

### 3.2 First-Class Funnel Lifecycle State Machine (`A → B → C → E → sotib_oldi`)

#### Problem in Current Code

Today, `apps/api/src/funnel/channel.ts` couples two separate actions inside `recordChannelClick`:
1. Clicking an `admin` button on `/r/:token/:index` (`apps/api/src/routes/redirect.ts`) or `CHANNEL_URL` sets `users.channelClickAt` **and immediately calls `markWroteAdmin`**, setting `users.wroteAdminAt` and closing the open `segment_runs` row with `endReason = 'wrote_admin'` (`apps/api/src/funnel/status.ts`, `apps/api/src/funnel/segments.ts`).
2. Anyone who clicks the button ("Tugmani bosdi") without actually sending a DM to the admin is falsely treated as having contacted sales, halting all automated follow-up immediately.

#### New Decoupled Model

1. **`channelClickAt` (Intent / Analytics Only):**
   - Clicking an `admin` CTA sets `users.channelClickAt` and logs `channel_click` in `events`, **without** setting `wroteAdminAt`.
   - Automated Stage C reminders continue until a real DM is detected or manually marked.
2. **`wroteAdminAt` & `lastAdminChatAt` (Verified Real Chat):**
   - Set when a `business_message` update arrives in either direction (customer → business account OR business account → customer) matched by customer `telegram_id` (`users.telegram_id`).
   - Every subsequent `business_message` in that conversation updates `users.lastAdminChatAt = now` (both inbound and outbound).
   - Manual lead-card override (`lead:wrote:<id>` in `apps/api/src/leads/actions.ts` / `markWroteAdmin`) is preserved as fallback.
3. **Stage `E` — "Adminga yozdi, sotib olmadi" (Why `'E'`, skipping `'D'`):**
   - Production `segment_runs` and soft-deleted `message_templates` from `0025_reminder_timeline.sql` still retain historical `'D'` rows for the retired "Qayta imkon" stage. Reusing `'D'` would pollute historical reports and collide with legacy constraints.
   - Therefore, the new post-inquiry sales follow-up stage is **`'E'`**:
     - **Entry:** When `wroteAdminAt` becomes non-null (and `paidAt === null`), `syncSegment` closes any open `A`/`B`/`C` `segment_runs` row with `endReason = 'advanced'` (immediately stopping "write to admin" nudges) and opens a new `segment_runs` row with `segment = 'E'`.
     - **Active-Chat Quiet Anchor (`lastAdminChatAt`):** Symmetric to Stage B's `watchProgress.lastBeatAt` / `isWatchingNow` (`WATCHING_FRESH_MS` in `apps/api/src/messages/plan.ts`), Stage E uses `lastAdminChatAt` so automated Stage E follow-ups never interrupt an active human sales chat (quiet cooldown window e.g. configurable or fresh-chat guard + anchor reset on `lastAdminChatAt` for Day 1 relative messages).
     - **Safe Default Rollout:** Stage E ships with **0 active templates** in `message_templates` until the sales/marketing team authors and activates Stage E follow-ups in `/admin/messages`.
4. **Terminal `sotib_oldi` (`users.paid_at IS NOT NULL`):**
   - `paid_at timestamptz` on `users` marks a confirmed purchase (`sotib_oldi`).
   - `syncSegment` treats `paid_at !== null` (and `bot_blocked === true`) as terminal: closes any open `segment_runs` row (`A`/`B`/`C`/`E`) with `endReason = 'bought'` (adding `'bought'` to `segmentEndReasons` in `packages/shared/src/funnel.ts`).
   - **Lead Card Bridge:** When an admin clicks `won` (`lead:won:<id>`) in `apps/api/src/leads/actions.ts`, it sets `leads.outcome = 'won'` **and** sets `users.paidAt = now` (bridging sales CRM marking into the funnel terminal state today, and later plugged cleanly into Milestone 4's `payments` / `enrollments` confirmation).

### 3.3 Admin Metrics Separation

In `packages/shared/src/admin.ts`, `apps/api/src/admin/queries.ts`, and `/admin` UI (`KpiCards`, `FlowFunnel`, `CampaignTable`):
- Split the ambiguous "Adminga yozdi" metric into two distinct, truthful metrics:
  1. **`channelClicks` ("Tugma bosganlar"):** `users.channelClickAt IS NOT NULL` / `channel_click` events.
  2. **`realChats` ("Haqiqiy yozganlar"):** `users.wroteAdminAt IS NOT NULL` (verified Business DM or manual `wrote` mark).
  3. (Plus `bought` count from `users.paidAt IS NOT NULL` for end-to-end conversion reporting.)

### 3.4 End-to-End Attribution (§2.2 — First-Touch & Last-Touch)

- **Preserve First-Touch:** Existing `users.utmSource`, `users.utmCampaign`, `users.utmContent`, `users.fbclid` remain immutable once set at initial `/start` (`upsertUser` in `apps/api/src/funnel/users.ts`).
- **Add Last-Touch Columns on `users`:**
  - `last_utm_source text`
  - `last_utm_campaign text`
  - `last_utm_content text`
  - `last_touch_at timestamptz`
- **Update Rule:** Whenever an existing user returns via `/start c_<code>` or `/start v_<vid>` and `resolveAttribution` yields non-empty UTM data, update `last_utm_*` and `last_touch_at = now` (without overwriting First-Touch `utm_*`).
- **Network Attribution Reporting:** Normalize and break down leads, real admin chats, and purchases across `ig`, `fb`, `tg`, and `organic` (`utm_source IS NULL` or empty) for both First-Touch and Last-Touch views.

---

## 4. Milestone 3 (`3-BO‘LIM & 4-BO‘LIM` — Eslatmalar Overhaul & Bot Matnlari Scheduled Broadcasts + Auto-Delete)

**Goal:** Give admins explicit control over night sending, flexible per-message timing modes, independent per-message auto-delete timers (respecting Telegram's 48h limit), a 30-day looping reminder grid, and scheduled rich broadcasts inside `/admin/bot`.

### 4.1 Night Quiet Hours Toggle (`3-BO‘LIM §3.1`)

- **Current State:** Forced `23:00–07:00` quiet-hours suppression for `Eslatmalar` reminders was already removed in `0025_reminder_timeline.sql` (only `linkExpiryFor` in `apps/api/src/messages/plan.ts` retains night extension for 24h link expiration).
- **Milestone 3 Addition:** Add an explicit admin-controllable setting in `Sozlamalar` (`/admin/settings`, `apps/api/src/routes/adminSettings.ts`, `apps/api/src/settings/service.ts`, `packages/shared/src/adminSettings.ts`):
  - `settings` key: `NIGHT_RESTRICTION_ENABLED`
  - Schema field: `nightRestrictionEnabled: boolean` (default `false` — **O‘chiq**, preserving current 24/7 delivery).
  - When enabled (`true`), `apps/api/src/messages/dispatch.ts` holds scheduled reminders falling within `23:00–07:00` (`NIGHT` in `packages/shared/src/messages.ts`, `Asia/Tashkent`) until `07:00`.

### 4.2 Explicit Timing Modes & Independent Per-Message Auto-Delete (`3-BO‘LIM §3.2`)

1. **Explicit `timingMode: 'relative' | 'clock'` Toggle:**
   - Currently `planChain` (`apps/api/src/messages/plan.ts`) hardcodes Day 1 as relative offset (`anchorAt + timingValue`) and Days 2–7 as `Asia/Tashkent` clock time (`firstDay + (day - 1) * DAY_MS + timingValue`), with no explicit mode column on `message_templates`.
   - Milestone 3 adds `timing_mode` (`'relative' | 'clock'`) to `message_templates` and exposes an explicit mode toggle in `MessageEditor` (`apps/web/components/admin/messages/MessageEditor.tsx`) and `TimingPicker` so admins can configure either relative delays (`+X daqiqa/soat` from stage anchor) or exact `Asia/Tashkent` `HH:MM` clock times on any day (defaulting Day 1 → `'relative'`, Day 2+ → `'clock'`).
2. **Per-Message `autoDeleteMinutes` (Replacing Global Overwrite Deletion):**
   - Currently `deletePrevious()` (`apps/api/src/messages/dispatch.ts`) deletes all prior `replaceable` (`isPermanent = false`) `sent_messages` for a user right before sending a new message.
   - Milestone 3 introduces `auto_delete_minutes integer NULL` on `message_templates` and `delete_at timestamptz NULL` computed on `sent_messages` when delivered (`sentAt + autoDeleteMinutes * 60_000`):
     - UI presets in `MessageEditor`: **`1 soat` (`60`), `3 soat` (`180`), `6 soat` (`360`), `12 soat` (`720`), `24 soat` (`1440`)**, custom input capped at **`2870` minutes (`47h 50m`)**, or **`NULL` ("O‘chirilmasin")**.
     - **Why capped at `2870` min (`47h 50m`):** Telegram Bot API enforces a hard **48-hour** limit on `deleteMessage` (`DELETE_LIMIT_MS` in `dispatch.ts`). Capping at `47h 50m` gives the 60-second dispatcher tick a safe 10-minute margin before Telegram rejects deletion with `message can't be deleted`.
     - **Independent Lifecycle:** Each sent message lives until its own `delete_at` expires. Sending a newer short-lived reminder **no longer deletes** an earlier permanent (`NULL`) or longer-lived message. Existing `isPermanent` rows migrate cleanly to `autoDeleteMinutes = NULL` (and `isPermanent = false` rows map to the configured cleanup window or explicit timer).

### 4.3 30-Day Grid & Perpetual Loop (`3-BO‘LIM §3.3`)

- **Expand Timeline to 30 Days:**
  - Raise `TEMPLATE_DAYS` (`MAX_REMINDER_DAY`) from `7` to `30` in `packages/shared/src/messages.ts`, update `message_templates_day_range` check constraint (`between 1 and 30`), and render a compact **3×10 day grid** in `DayTimeline` (`apps/web/components/admin/messages/DayTimeline.tsx`) instead of a single long horizontal scroll strip.
  - Extend `CHAIN_MS` / candidate loading horizon in `apps/api/src/messages/dispatch.ts` & `plan.ts` beyond 7 days.
- **Per-Segment `loopRestart` Boolean Flag:**
  - Store `loop_restart` per segment (`A`, `B`, `C`, `E`) in settings/segment config (default **`true`**).
  - When a user finishes day `30` without `users.paid_at IS NOT NULL` and without advancing to a later stage, if `loopRestart === true`, the dispatcher wraps the user's timeline (`day = 30 → 1`) by resetting/advancing the run cycle so long-tail leads continue receiving scheduled follow-ups (respecting `MESSAGE_CAPS` and `autoDeleteMinutes`).

### 4.4 "Bot matnlari" Auto-Delete & Scheduled Broadcasts (`4-BO‘LIM §4.1 & §4.2`)

1. **Reactive `bot_texts` Auto-Delete (§4.1):**
   - Keep all **16** existing reactive `botMessageKeys` in `packages/shared/src/botTexts.ts` (`welcome`, `welcomeBack`, `watchPrompt`, `completion`, `fallback`, `laterAck`, `laterAsk`, `laterPickDay`, `laterPickHour`, `laterConfirmed`, `laterTooLate`, `reopenPreReminder`, `reopenNow`, `remindNow`, `offerClosed`, `rolloutPrompt`) and all 11 `botButtonKeys` intact.
   - Add `auto_delete_minutes integer NULL` (same `1h / 3h / 6h / 12h / 24h / <48h / NULL` options) to `bot_texts` (`apps/api/src/db/schema.ts`, `BotTextEditor.tsx`), recording `delete_at` on delivered messages so reactive bot replies honor per-template auto-delete timers.
2. **New "Rejalashtirilgan xabarlar" Broadcasts Tab (§4.2):**
   - Add a second top-level tab inside `/admin/bot` (`apps/web/app/(site)/admin/(panel)/bot/page.tsx`) alongside existing scenario texts.
   - **New Table `scheduled_broadcasts` (and recipient log `scheduled_broadcast_recipients`):**
     - `id`, `title`/`text` (rich Telegram HTML via TipTap), `media_type` + `media_file_id`, `buttons jsonb` (`TemplateButton[]` / inline URL & callback buttons), `audience` selector (`all_users`, stage `A`/`B`/`C`/`E`, `bought`, `not_bought`, `registered`, etc.), `scheduled_at timestamptz` (selected in UI with full **`Yil / Oy / Kun / Soat / Daqiqa`** in `Asia/Tashkent` UTC+5), `auto_delete_minutes integer NULL`, `status` (`scheduled | running | done | cancelled`), delivery counters (`target_count`, `sent_count`, `blocked_count`, `failed_count`), `created_at`, `finished_at`.
   - **Dispatcher Integration:** Executed by the advisory-locked dispatch loop (`apps/api/src/messages/dispatch.ts`) using the existing `API_GAP_MS` (`35ms`) rate pacer and `429 Retry-After` backoff (`pauseFor`), writing `delete_at` per recipient message when `auto_delete_minutes` is set.

---

## 5. Deferred Milestone 4 (`2-BO‘LIM §2.3` — Payments, Courses, Tariffs, Study Groups, Installments & AI Receipt OCR)

**Status:** Deferred pending client operational decisions. Milestone 2 establishes the exact integration boundary (`users.paid_at` + First/Last-Touch attribution) so Milestone 4 plugs in without refactoring Milestones 1–3.

### 5.1 Proposed Normalized Schema

1. **`courses`**:
   - `id`, `slug`, `title`, `description`, `is_active`, `created_at`.
2. **`tariffs`**:
   - `id`, `course_id -> courses.id`, `name` (e.g. Standard / VIP / Individual), `total_price_uzs bigint`, `duration_days integer`, `allows_installments boolean`, `is_active`.
3. **`study_groups`**:
   - `id`, `course_id -> courses.id`, `name` (cohort / stream), `starts_at`, `capacity`, `telegram_group_url`, `curator_telegram_id`.
4. **`enrollments`**:
   - `id`, `user_id -> users.id`, `course_id -> courses.id`, `tariff_id -> tariffs.id`, `study_group_id -> study_groups.id NULL`, `lead_id -> leads.id NULL`, `status` (`pending | active | paused | completed | cancelled`), `total_due_uzs bigint`, `paid_uzs bigint`, `enrolled_at`, `expires_at`.
   - **Milestone 2 Hook:** Creating/activating a paid enrollment sets `users.paid_at = COALESCE(users.paid_at, now)` and triggers `syncSegment(userId)` → closes any open funnel stage (`A`/`B`/`C`/`E`) with `endReason = 'bought'`. Attribution (`utm_*` First-Touch and `last_utm_*` Last-Touch) is snapshotted or joined from `users` for ROAS reporting by course/tariff/cohort.
5. **`payments`** (supports full upfront payments and multi-part installments):
   - `id`, `enrollment_id -> enrollments.id`, `user_id -> users.id`, `amount_uzs bigint`, `currency`, `payment_method` (`click | payme | uzum | card_transfer | cash`), `installment_no smallint NULL`, `due_date date NULL`, `status` (`pending_review | verified | rejected | refunded`), `receipt_file_id text NULL`, `ocr_payload jsonb NULL`, `verified_by_telegram_id bigint NULL`, `paid_at timestamptz NULL`, `created_at`.

### 5.2 Open Client Business Questions (Parked Before Implementation)

Milestone 4 implementation is blocked on client confirmation of the following business rules:

1. **Installment (`bo‘lib to‘lash`) Schedule Rules:**
   - Fixed preset splits (e.g., 50%/50% or 3/6 equal parts) vs custom admin-entered per-student schedules?
   - What happens on overdue installments: automated Telegram reminders only, or automatic temporary access suspension?
2. **Due-Date Calendar Semantics:**
   - Fixed calendar day of month (e.g. always the 5th of every month) vs rolling 30-day intervals from `enrolled_at`?
3. **Partial Payments & Overpayment Allocation:**
   - Can a student send two smaller transfers toward one installment? If they overpay, does the surplus credit the next installment automatically?
4. **AI Receipt OCR Provider & Verification Workflow:**
   - Which Uzbek P2P/bank receipt formats must be parsed (Click, Payme, Uzum, Humo/Uzcard screenshots, PDFs)?
   - Which vision/OCR provider will be funded (`OpenAI` vs `Gemini` vs dedicated OCR) and what is the human-in-the-loop rule: auto-approve above a confidence + card-last-4 + amount match threshold, or always require one-click admin confirmation in Telegram?
5. **Refunds / Transfers:**
   - Does a full refund or tariff downgrade revert `users.paid_at` or simply mark the `enrollment` as `refunded`/`cancelled` while keeping historical attribution audit logs?

---

## 6. Milestone Delivery Summary

| Milestone | Scope | DB Migration Needed? | Key Verification Gate |
|---|---|---|---|
| **M1** | `1-BO‘LIM`: `/admin/links`, `Havolalar` drawer, Radix `<Select>` filters, `Tugatgan` column, direct-to-bot funnel math | No (reuses `campaign_links`) | `pnpm typecheck`, `pnpm lint`, `pnpm test`, live `/start c_<code>` + `/admin` filter verification |
| **M2** | `2-BO‘LIM §2.1–2.2`: Business Bot API webhook, `A → B → C → E → sotib_oldi`, `channelClicks` vs `realChats`, Last-Touch UTMs | Yes (`users` + `segment_runs` + `segmentEndReasons`) | Updated `set-webhook.ts` deployed, Business DM tests, stage `E` + `bought` integration tests |
| **M3** | `3-BO‘LIM & 4-BO‘LIM`: Night toggle, `timingMode`, per-message `autoDeleteMinutes` (`≤ 2870m`), 30-day grid + `loopRestart`, `scheduled_broadcasts` | Yes (`message_templates`, `sent_messages`, `bot_texts`, `scheduled_broadcasts`) | Planner/dispatcher tests for 30-day wrap, 48h delete cap, broadcast pacing |
| **M4** | `2-BO‘LIM §2.3`: Courses, tariffs, study groups, enrollments, installments, AI receipt OCR | Yes (5 new tables) | Deferred until §5.2 client questions are answered |
