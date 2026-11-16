# Release notes: Telegram Ads, payments and debts, 30-day reminders (November 2026)

Covers branch `feat/payments-and-debts` (commits 8f30443, b245f79, 0eb8bba, d86a620 and the follow-up fixes). Migrations 0027-0030 run automatically when the API starts.

## For admins

### Telegram Ads (TZ 1)
- Statistika → «Havolalar» has a `tg` preset. It builds a bot link and a landing link with `utm_source=tg`, a campaign and a content tag.
- Choose «Telegram (tg)» in the Manba filter. Every block works the same as for ig and fb: the 5 cards, the user path, minute retention, daily chart and the sources table.

### Admin chats and sales by network (TZ 2.1, 2.2)
- Connect the bot to the sales account through Telegram Business. Everyone who actually writes to that account is then matched to their lead by Telegram ID.
- Statistika shows two separate numbers: «Tugma bosdi» (clicked the button) and «Haqiqiy yozdi» (really wrote).
- Reminders and the button click:
  - Before Business is connected, a click still stops sales reminders, as before.
  - After it is connected, only a real chat or «Yozdi»/"won" stops them. People who clicked and never wrote keep getting follow-ups.
- «Tarmoqlar bo‘yicha sotuv va natijalar» shows registrations, clicks, real chats and purchases for ig, fb, tg and organic. You can switch between first and last touch.

### To'lovlar va qarzdorlik (TZ 2.3)
- New section. Set up courses, tariffs and study groups in «Katalog va guruhlar».
- Receipts arrive in «Cheklar qutisi», either from Business chats or uploaded by hand. If a Gemini key is set, the AI reads the amount and date. You confirm with one click.
- Each student shows:
  - contract amount, amount paid and payment dates
  - this month's due amount and due date
  - remaining balance
  - status: fully paid, installment not yet due, or overdue
- Two tabs:
  - «Umumiy yig‘ma jadval», with 4 totals
  - «Guruhlar kesimida», with payment discipline % per group
- To change a contract amount, edit the installment schedule along with it. An amount change without a matching schedule is rejected.

### Eslatmalar (TZ 3)
- The night restriction (23:00-07:00) is now a switch in Sozlamalar, off by default.
- Each reminder is sent one of two ways:
  - **Interval:** a set time after the person entered the stage.
  - **Aniq soatda:** at a fixed HH:MM, Tashkent time, on a chosen day.
- Each reminder has its own auto-delete: 1, 3, 6, 12 or 24 hours, a custom time, or «O‘chirilmasin». Telegram allows deletion only within 48 hours, so the maximum is 47h 50m.
- The day grid now runs to 30 days. Each stage has a loop switch, on by default: after day 30 the person starts again at day 1.
  - Only people who enter a stage after this release loop.
  - People already in the funnel keep the old behaviour.
- Moving to the next stage restarts at that stage's day 1. A purchase stops all sales reminders.
- Write texts for days 8-30 and for stage E («Adminga yozdi, sotib olmadi»). Nothing is sent for those days until you do.

### Bot matnlari (TZ 4)
- The page is redesigned: automatic replies are grouped by scenario, with search and a live preview.
- Each automatic reply has its own auto-delete choice:
  - «Standart» (the usual cleanup)
  - a timer
  - «O‘chirilmasin»
- «Ommaviy xabarlar»: schedule a message for an exact year, month, day, hour and minute (Tashkent time), or use a quick preset. Pick the audience by stage or purchase status, and set an auto-delete timer.
- All existing automatic scenarios work as before: link not opened, stopped watching, returning users, after the lesson, and day reminders.

## Deploy notes
See "Release Checklist: Payments, Telegram Ads, 30-day Reminders" in `docs/DEPLOY.md`. In short:
1. Back up the database.
2. Deploy.
3. Re-run `set-webhook.ts`.
4. Connect Telegram Business.
5. Optionally set `GEMINI_API_KEY`.
