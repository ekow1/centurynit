CREATE TYPE "public"."case_assignment_end_reason" AS ENUM('reassigned', 'completed', 'cancelled', 'offboarded', 'unassigned');--> statement-breakpoint
CREATE TYPE "public"."case_assignment_role" AS ENUM('primary', 'secondary', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."case_assignment_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."case_assignment_type" AS ENUM('consultation', 'application', 'booking');--> statement-breakpoint
CREATE TYPE "public"."school_outcome" AS ENUM('Admitted', 'Waitlisted', 'Application Rejected', 'Withdrawn');--> statement-breakpoint
CREATE TYPE "public"."stage_handoff_decision" AS ENUM('keep', 'assign');--> statement-breakpoint
CREATE TYPE "public"."stage_handoff_status" AS ENUM('pending', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."travel_assistance_status" AS ENUM('decision_pending', 'review', 'quote_prepared', 'quote_approved', 'invoiced', 'booked', 'declined', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."travel_decision" AS ENUM('yes', 'hold', 'no');--> statement-breakpoint
ALTER TYPE "public"."visa_stage" ADD VALUE 'awaiting_handler' BEFORE 'pending';--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "case_assignment_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"role" "case_assignment_role" DEFAULT 'primary' NOT NULL,
	"status" "case_assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" "case_assignment_end_reason",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"stage" varchar(80) NOT NULL,
	"from_ops_user_id" uuid,
	"source" varchar(40) DEFAULT 'stage_transition' NOT NULL,
	"status" "stage_handoff_status" DEFAULT 'pending' NOT NULL,
	"decision" "stage_handoff_decision",
	"resolved_ops_user_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"deferred_by" uuid,
	"deferred_at" timestamp with time zone,
	"defer_count" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_assistance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"decision" "travel_decision",
	"status" "travel_assistance_status" DEFAULT 'decision_pending' NOT NULL,
	"quote" jsonb,
	"ticket_amount_cents" integer,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"invoice_id" uuid,
	"booking_confirmation" jsonb,
	"ops_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applicant_note" text,
	"ops_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tickets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ticket_messages" CASCADE;--> statement-breakpoint
DROP TABLE "tickets" CASCADE;--> statement-breakpoint
DROP INDEX "leads_email_idx";--> statement-breakpoint
ALTER TABLE "school_applications" ALTER COLUMN "status" SET DEFAULT 'Preparing Application';--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "proceed_status" varchar(16) DEFAULT 'invited' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "proceeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "declined_reason" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "target_school_count" integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "university_name" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "program_name" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "country_name" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "tuition_usd" integer;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_tuition_usd" integer;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_tuition_label" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_deposit_usd" integer;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_deposit_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_deposit_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "offer_letter_url" text;--> statement-breakpoint
ALTER TABLE "school_applications" ADD COLUMN "outcome" "school_outcome";--> statement-breakpoint
ALTER TABLE "school_track_events" ADD COLUMN "outcome" "school_outcome";--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_mailing_list_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."mailing_list_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_assigned_by_ops_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_ended_by_ops_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_from_ops_user_id_ops_users_id_fk" FOREIGN KEY ("from_ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_resolved_ops_user_id_ops_users_id_fk" FOREIGN KEY ("resolved_ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_decided_by_ops_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_handoffs" ADD CONSTRAINT "stage_handoffs_deferred_by_ops_users_id_fk" FOREIGN KEY ("deferred_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_assistance_requests" ADD CONSTRAINT "travel_assistance_requests_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_assistance_requests" ADD CONSTRAINT "travel_assistance_requests_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_assistance_requests" ADD CONSTRAINT "travel_assistance_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_idx" ON "campaign_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_status_idx" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "case_assignments_target_idx" ON "case_assignments" USING btree ("target_type","target_id","status");--> statement-breakpoint
CREATE INDEX "case_assignments_officer_idx" ON "case_assignments" USING btree ("ops_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "case_assignments_unique_active" ON "case_assignments" USING btree ("target_type","target_id","role") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "stage_handoffs_application_idx" ON "stage_handoffs" USING btree ("application_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_handoffs_open_uniq" ON "stage_handoffs" USING btree ("application_id","stage") WHERE "stage_handoffs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "stage_handoffs_ops_user_idx" ON "stage_handoffs" USING btree ("from_ops_user_id");--> statement-breakpoint
CREATE INDEX "travel_assistance_applicant_idx" ON "travel_assistance_requests" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "travel_assistance_application_idx" ON "travel_assistance_requests" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "travel_assistance_status_idx" ON "travel_assistance_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_email_uniq" ON "leads" USING btree ("email");--> statement-breakpoint
ALTER TABLE "public"."school_applications" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "public"."school_track_events" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."school_track_status";--> statement-breakpoint
CREATE TYPE "public"."school_track_status" AS ENUM('Preparing Application', 'Submitted', 'Decision Reached');--> statement-breakpoint
ALTER TABLE "public"."school_applications" ALTER COLUMN "status" SET DATA TYPE "public"."school_track_status" USING "status"::"public"."school_track_status";--> statement-breakpoint
ALTER TABLE "public"."school_track_events" ALTER COLUMN "status" SET DATA TYPE "public"."school_track_status" USING "status"::"public"."school_track_status";--> statement-breakpoint
DROP TYPE "public"."ticket_priority";--> statement-breakpoint
DROP TYPE "public"."ticket_sender_type";--> statement-breakpoint
DROP TYPE "public"."ticket_status";