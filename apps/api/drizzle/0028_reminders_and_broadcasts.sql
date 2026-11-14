ALTER TABLE "message_templates" ADD COLUMN "timing_mode" text DEFAULT 'relative' NOT NULL;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "auto_delete_minutes" integer;--> statement-breakpoint
UPDATE "message_templates"
SET "timing_mode" = CASE
  WHEN "kind" = 'trigger' OR ("segment" IN ('C', 'E') AND "day" >= 2) THEN 'clock'
  ELSE 'relative'
END,
"auto_delete_minutes" = CASE
  WHEN "is_permanent" THEN NULL
  ELSE 1440
END;--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_day_range";--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_day_range" CHECK ("message_templates"."day" between 1 and 30);--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_kind_shape";--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_kind_shape" CHECK (("message_templates"."kind" = 'reminder' and not "message_templates"."at_expiry") or ("message_templates"."kind" = 'trigger' and "message_templates"."segment" in ('A', 'B') and "message_templates"."day" between 2 and 30));--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_timing_mode_values" CHECK ("message_templates"."timing_mode" in ('relative', 'clock'));--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_auto_delete_range" CHECK ("message_templates"."auto_delete_minutes" is null or ("message_templates"."auto_delete_minutes" between 1 and 2870));--> statement-breakpoint
ALTER TABLE "sent_messages" ADD COLUMN "delete_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sent_messages_delete_due_idx" ON "sent_messages" USING btree ("delete_at") WHERE "sent_messages"."sent_at" is not null and "sent_messages"."deleted_at" is null and "sent_messages"."delete_error" is null and "sent_messages"."delete_at" is not null;--> statement-breakpoint
ALTER TABLE "bot_texts" ADD COLUMN "auto_delete_minutes" integer;--> statement-breakpoint
ALTER TABLE "bot_texts" ADD COLUMN "keep_forever" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_texts" ADD CONSTRAINT "bot_texts_auto_delete_range" CHECK ("bot_texts"."auto_delete_minutes" is null or ("bot_texts"."auto_delete_minutes" between 1 and 2870));--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "delete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "keep_forever" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_messages_delete_due_idx" ON "chat_messages" USING btree ("delete_at") WHERE "chat_messages"."deleted_at" is null and "chat_messages"."delete_error" is null and "chat_messages"."delete_at" is not null;--> statement-breakpoint
CREATE TABLE "scheduled_broadcasts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"media_type" text,
	"media_file_id" text,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audiences" text[] NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"auto_delete_minutes" integer,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"target_count" integer,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "scheduled_broadcasts_status_values" CHECK ("scheduled_broadcasts"."status" in ('scheduled', 'running', 'done', 'cancelled')),
	CONSTRAINT "scheduled_broadcasts_media_pair" CHECK (("scheduled_broadcasts"."media_type" is null) = ("scheduled_broadcasts"."media_file_id" is null)),
	CONSTRAINT "scheduled_broadcasts_media_type_values" CHECK ("scheduled_broadcasts"."media_type" is null or "scheduled_broadcasts"."media_type" in ('photo', 'video', 'voice')),
	CONSTRAINT "scheduled_broadcasts_auto_delete_range" CHECK ("scheduled_broadcasts"."auto_delete_minutes" is null or ("scheduled_broadcasts"."auto_delete_minutes" between 1 and 2870)),
	CONSTRAINT "scheduled_broadcasts_audiences_values" CHECK (cardinality("scheduled_broadcasts"."audiences") > 0 and "scheduled_broadcasts"."audiences" <@ array['all', 'A', 'B', 'C', 'E', 'bought', 'not_bought']::text[])
);
--> statement-breakpoint
CREATE INDEX "scheduled_broadcasts_status_scheduled_idx" ON "scheduled_broadcasts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE TABLE "scheduled_broadcast_recipients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"broadcast_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"click_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"link_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"telegram_message_id" bigint,
	"sent_at" timestamp with time zone,
	"send_error" text,
	"delete_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"delete_error" text,
	"clicked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_broadcast_recipients_click_token_unique" UNIQUE("click_token"),
	CONSTRAINT "scheduled_broadcast_recipients_state_values" CHECK ("scheduled_broadcast_recipients"."state" in ('pending', 'sent', 'blocked', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "scheduled_broadcast_recipients" ADD CONSTRAINT "scheduled_broadcast_recipients_broadcast_id_scheduled_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."scheduled_broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_broadcast_recipients" ADD CONSTRAINT "scheduled_broadcast_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_broadcast_recipients_uidx" ON "scheduled_broadcast_recipients" USING btree ("broadcast_id","user_id");--> statement-breakpoint
CREATE INDEX "scheduled_broadcast_recipients_open_idx" ON "scheduled_broadcast_recipients" USING btree ("broadcast_id","state","id");--> statement-breakpoint
CREATE INDEX "scheduled_broadcast_recipients_delete_due_idx" ON "scheduled_broadcast_recipients" USING btree ("delete_at") WHERE "scheduled_broadcast_recipients"."sent_at" is not null and "scheduled_broadcast_recipients"."deleted_at" is null and "scheduled_broadcast_recipients"."delete_error" is null and "scheduled_broadcast_recipients"."delete_at" is not null;
