CREATE TYPE "public"."booking_status" AS ENUM('UNASSIGNED', 'ASSIGNED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."booking_type" AS ENUM('online', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."calendar_sync_status" AS ENUM('NOT_REQUIRED', 'PENDING', 'SYNCED', 'FAILED');--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" varchar(48) NOT NULL,
	"actor" text,
	"payload" jsonb,
	"idempotency_key" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(32) NOT NULL,
	"client_user_id" text NOT NULL,
	"client_name" text NOT NULL,
	"client_email" varchar(255) NOT NULL,
	"client_phone" varchar(40),
	"service_id" varchar(64) NOT NULL,
	"service_name" text NOT NULL,
	"branch_id" varchar(64) NOT NULL,
	"type" "booking_type" DEFAULT 'online' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"status" "booking_status" DEFAULT 'UNASSIGNED' NOT NULL,
	"employee_id" uuid,
	"assigned_at" timestamp with time zone,
	"assigned_by" uuid,
	"meeting_url" text,
	"calendar_event_id" text,
	"calendar_id" text,
	"calendar_sync_status" "calendar_sync_status" DEFAULT 'NOT_REQUIRED' NOT NULL,
	"calendar_sync_error" text,
	"calendar_sync_attempts" integer DEFAULT 0 NOT NULL,
	"rescheduled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancellation_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_employee_overlap_excl" EXCLUDE USING gist (
	employee_id WITH =,
	tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (
	employee_id IS NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_busy_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"summary" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_calendar_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"provider" varchar(32) DEFAULT 'google' NOT NULL,
	"google_account_email" varchar(255),
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"access_token_expires_at" timestamp with time zone,
	"scope" text,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"sync_token" text,
	"channel_id" text,
	"channel_resource_id" text,
	"channel_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_calendar_accounts_ops_user_id_unique" UNIQUE("ops_user_id")
);
--> statement-breakpoint
CREATE TABLE "staff_working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"timezone" varchar(64) DEFAULT 'Africa/Accra' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops_users" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_employee_id_ops_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assigned_by_ops_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_busy_blocks" ADD CONSTRAINT "calendar_busy_blocks_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_calendar_accounts" ADD CONSTRAINT "staff_calendar_accounts_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_working_hours" ADD CONSTRAINT "staff_working_hours_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("booking_id","at");--> statement-breakpoint
CREATE INDEX "bookings_client_idx" ON "bookings" USING btree ("client_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_employee_idx" ON "bookings" USING btree ("employee_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_branch_idx" ON "bookings" USING btree ("branch_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_branch_slot_unique" ON "bookings" USING btree ("branch_id","starts_at") WHERE status NOT IN ('CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_busy_unique" ON "calendar_busy_blocks" USING btree ("ops_user_id","external_event_id");--> statement-breakpoint
CREATE INDEX "calendar_busy_window_idx" ON "calendar_busy_blocks" USING btree ("ops_user_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_working_hours_unique" ON "staff_working_hours" USING btree ("ops_user_id","day_of_week");--> statement-breakpoint
ALTER TABLE "ops_users" ADD CONSTRAINT "ops_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_users" ADD CONSTRAINT "ops_users_user_id_unique" UNIQUE("user_id");