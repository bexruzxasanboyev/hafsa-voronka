CREATE TABLE "courses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"student_name" text NOT NULL,
	"phone" text,
	"telegram_id" bigint,
	"username" text,
	"source_network" text DEFAULT 'organic' NOT NULL,
	"course_id" bigint,
	"course_name" text NOT NULL,
	"tariff_id" bigint,
	"tariff_name" text NOT NULL,
	"group_id" bigint,
	"group_name" text,
	"total_price" integer NOT NULL,
	"current_month_due" integer DEFAULT 0 NOT NULL,
	"due_date" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"enrollment_id" bigint NOT NULL,
	"amount" integer NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"course_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tariffs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"course_id" bigint NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_day_range";--> statement-breakpoint
ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_kind_shape";--> statement-breakpoint
ALTER TABLE "bot_texts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_texts" ADD COLUMN "scheduled_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_texts" ADD COLUMN "auto_delete_minutes" integer;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "timing_mode" text DEFAULT 'interval' NOT NULL;--> statement-breakpoint
ALTER TABLE "message_templates" ADD COLUMN "auto_delete_minutes" integer;--> statement-breakpoint
ALTER TABLE "sent_messages" ADD COLUMN "delete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tariff_id_tariffs_id_fk" FOREIGN KEY ("tariff_id") REFERENCES "public"."tariffs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_group_id_study_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."study_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_groups" ADD CONSTRAINT "study_groups_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollments_user_id_idx" ON "enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "enrollments_group_id_idx" ON "enrollments" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "enrollments_source_network_idx" ON "enrollments" USING btree ("source_network");--> statement-breakpoint
CREATE INDEX "payments_enrollment_id_idx" ON "payments" USING btree ("enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tariffs_course_name_idx" ON "tariffs" USING btree ("course_id","name");--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_day_range" CHECK ("message_templates"."day" between 1 and 30);--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_kind_shape" CHECK (("message_templates"."kind" = 'reminder' and not "message_templates"."at_expiry") or ("message_templates"."kind" = 'trigger' and "message_templates"."segment" in ('A', 'B') and "message_templates"."day" between 2 and 30));