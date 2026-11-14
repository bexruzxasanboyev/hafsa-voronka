ALTER TABLE "users" ADD COLUMN "last_admin_chat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paid_by" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_utm_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_utm_campaign" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_utm_content" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_touch_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "business_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_telegram_id" bigint NOT NULL,
	"user_chat_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"can_reply" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "business_connections_user_telegram_id_idx" ON "business_connections" USING btree ("user_telegram_id");--> statement-breakpoint
CREATE INDEX "users_wrote_admin_at_idx" ON "users" USING btree ("wrote_admin_at");--> statement-breakpoint
CREATE INDEX "users_paid_at_idx" ON "users" USING btree ("paid_at");--> statement-breakpoint
UPDATE "users" SET "last_admin_chat_at" = "wrote_admin_at" WHERE "wrote_admin_at" IS NOT NULL AND "last_admin_chat_at" IS NULL;--> statement-breakpoint
UPDATE "users" SET "last_utm_source" = "utm_source", "last_utm_campaign" = "utm_campaign", "last_utm_content" = "utm_content", "last_touch_at" = "created_at" WHERE ("utm_source" IS NOT NULL OR "utm_campaign" IS NOT NULL OR "utm_content" IS NOT NULL) AND "last_touch_at" IS NULL;--> statement-breakpoint
UPDATE "users" "u" SET "paid_at" = coalesce("l"."outcome_at", now()), "paid_by" = "l"."assignee_telegram_id" FROM "leads" "l" WHERE "l"."user_id" = "u"."id" AND "l"."outcome" = 'won' AND "u"."paid_at" IS NULL;--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_segment_values";--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_segment_values" CHECK ("message_templates"."segment" in ('A', 'B', 'C', 'E') or "message_templates"."deleted_at" is not null);--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_statuses_values";--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_statuses_values" CHECK ("message_templates"."statuses" is null or (cardinality("message_templates"."statuses") > 0 and "message_templates"."statuses" <@ array['link_berildi', 'korishni_boshladi', 'dars_yarmida', 'sotuvda_toxtadi', 'narxni_kurdi', 'adminga_yozdi', 'sotib_oldi']::text[]));