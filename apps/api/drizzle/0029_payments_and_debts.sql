CREATE TABLE "courses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariffs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"course_id" bigint NOT NULL,
	"name" text NOT NULL,
	"price_uzs" bigint NOT NULL,
	"allows_installments" boolean DEFAULT true NOT NULL,
	"default_installment_months" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tariffs_price_nonnegative" CHECK ("tariffs"."price_uzs" >= 0),
	CONSTRAINT "tariffs_default_installment_months_range" CHECK ("tariffs"."default_installment_months" between 1 and 36)
);
--> statement-breakpoint
CREATE TABLE "study_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"course_id" bigint,
	"starts_at" text,
	"capacity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_groups_starts_at_format" CHECK ("study_groups"."starts_at" is null or "study_groups"."starts_at" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "study_groups_capacity_positive" CHECK ("study_groups"."capacity" is null or "study_groups"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"course_id" bigint NOT NULL,
	"tariff_id" bigint NOT NULL,
	"study_group_id" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"contract_amount_uzs" bigint NOT NULL,
	"installment_months" smallint DEFAULT 1 NOT NULL,
	"note" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_status_values" CHECK ("enrollments"."status" in ('active','completed','cancelled')),
	CONSTRAINT "enrollments_contract_positive" CHECK ("enrollments"."contract_amount_uzs" > 0),
	CONSTRAINT "enrollments_installment_months_range" CHECK ("enrollments"."installment_months" between 1 and 36)
);
--> statement-breakpoint
CREATE TABLE "enrollment_installments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"enrollment_id" bigint NOT NULL,
	"installment_no" smallint NOT NULL,
	"due_date" text NOT NULL,
	"amount_uzs" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_installments_no_positive" CHECK ("enrollment_installments"."installment_no" >= 1),
	CONSTRAINT "enrollment_installments_due_date_format" CHECK ("enrollment_installments"."due_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "enrollment_installments_amount_nonnegative" CHECK ("enrollment_installments"."amount_uzs" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"enrollment_id" bigint,
	"payment_id" bigint,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"media_type" text NOT NULL,
	"file_id" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"file_size" bigint,
	"business_connection_id" text,
	"telegram_message_id" bigint,
	"sender_telegram_id" bigint,
	"sender_username" text,
	"sender_name" text,
	"caption" text,
	"ocr_status" text DEFAULT 'skipped' NOT NULL,
	"ocr_result" jsonb,
	"ocr_error" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_receipts_source_values" CHECK ("payment_receipts"."source" in ('business_dm','admin_upload')),
	CONSTRAINT "payment_receipts_status_values" CHECK ("payment_receipts"."status" in ('pending','confirmed','rejected')),
	CONSTRAINT "payment_receipts_media_type_values" CHECK ("payment_receipts"."media_type" in ('photo','pdf')),
	CONSTRAINT "payment_receipts_ocr_status_values" CHECK ("payment_receipts"."ocr_status" in ('skipped','ok','failed'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"enrollment_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"receipt_id" bigint,
	"amount_uzs" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"status" text DEFAULT 'verified' NOT NULL,
	"paid_date" text NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reference" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_uzs" > 0),
	CONSTRAINT "payments_method_values" CHECK ("payments"."payment_method" in ('click','payme','uzum','card_transfer','bank','cash','other')),
	CONSTRAINT "payments_status_values" CHECK ("payments"."status" in ('verified','refunded')),
	CONSTRAINT "payments_paid_date_format" CHECK ("payments"."paid_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_groups" ADD CONSTRAINT "study_groups_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tariff_id_tariffs_id_fk" FOREIGN KEY ("tariff_id") REFERENCES "public"."tariffs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_study_group_id_study_groups_id_fk" FOREIGN KEY ("study_group_id") REFERENCES "public"."study_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_installments" ADD CONSTRAINT "enrollment_installments_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_id_payment_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."payment_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollments_user_id_idx" ON "enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "enrollments_study_group_id_idx" ON "enrollments" USING btree ("study_group_id");--> statement-breakpoint
CREATE INDEX "enrollments_course_id_idx" ON "enrollments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "enrollments_status_idx" ON "enrollments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_installments_enrollment_no_uidx" ON "enrollment_installments" USING btree ("enrollment_id","installment_no");--> statement-breakpoint
CREATE INDEX "enrollment_installments_enrollment_due_idx" ON "enrollment_installments" USING btree ("enrollment_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_receipts_business_msg_uidx" ON "payment_receipts" USING btree ("business_connection_id","telegram_message_id") WHERE "payment_receipts"."business_connection_id" is not null and "payment_receipts"."telegram_message_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_receipts_status_created_idx" ON "payment_receipts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payments_enrollment_status_paid_idx" ON "payments" USING btree ("enrollment_id","status","paid_at");--> statement-breakpoint
CREATE INDEX "payments_receipt_id_idx" ON "payments" USING btree ("receipt_id");