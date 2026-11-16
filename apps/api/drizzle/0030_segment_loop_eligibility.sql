-- Runs that already exist were opened before 30-day loops shipped: adding the column with DEFAULT false
-- marks them ineligible without a table rewrite, then new runs default to eligible.
ALTER TABLE "segment_runs" ADD COLUMN "loop_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "segment_runs" ALTER COLUMN "loop_eligible" SET DEFAULT true;--> statement-breakpoint
CREATE INDEX "segment_runs_open_entered_idx" ON "segment_runs" USING btree ("entered_at") WHERE "segment_runs"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "segment_runs_open_loop_idx" ON "segment_runs" USING btree ("segment") WHERE "segment_runs"."ended_at" is null and "segment_runs"."loop_eligible";--> statement-breakpoint
-- Messages sent before per-message delete_at existed were removed by the old 47h sweep (and earlier, at link
-- expiry, for A/B runs). Give the still-deletable ones an explicit delete_at reproducing that schedule.
UPDATE "sent_messages" s
SET "delete_at" = least(
  s."sent_at" + interval '47 hours',
  (
    SELECT g."expires_at"
    FROM "link_grants" g
    JOIN "segment_runs" r ON r."id" = s."segment_run_id"
    WHERE g."id" = s."link_id" AND r."segment" IN ('A', 'B') AND g."expires_at" > s."sent_at"
  )
)
WHERE s."sent_at" > now() - interval '48 hours'
  AND s."telegram_message_id" IS NOT NULL
  AND s."delete_at" IS NULL
  AND s."deleted_at" IS NULL
  AND s."delete_error" IS NULL
  AND (
    (s."template_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "message_templates" t WHERE t."id" = s."template_id" AND t."is_permanent"
    ))
    OR (s."bot_text_key" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "bot_texts" b WHERE b."key" = s."bot_text_key" AND b."keep_forever"
    ))
  );
