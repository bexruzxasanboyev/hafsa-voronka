CREATE TABLE "hermes_payments" (
	"hermes_id" bigint PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"user_id" bigint,
	"pay_date" text,
	"amount_uzs" bigint,
	"month_no" integer,
	"tariff" text,
	"confidence" text NOT NULL,
	"kind" text NOT NULL,
	"source" text,
	"hermes_created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hermes_payments_pay_date_format" CHECK ("hermes_payments"."pay_date" is null or "hermes_payments"."pay_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "hermes_payments_kind_values" CHECK ("hermes_payments"."kind" in ('paid','deposit','ignored'))
);
--> statement-breakpoint
CREATE TABLE "integration_heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hermes_payments" ADD CONSTRAINT "hermes_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hermes_payments_kind_pay_date_idx" ON "hermes_payments" USING btree ("kind","pay_date");--> statement-breakpoint
CREATE INDEX "hermes_payments_user_id_idx" ON "hermes_payments" USING btree ("user_id");