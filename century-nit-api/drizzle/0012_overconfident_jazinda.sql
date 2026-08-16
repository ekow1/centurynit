CREATE TYPE "public"."lead_stage" AS ENUM('New Lead', 'Contacted', 'Consultation Booked', 'Assessment Complete', 'Enrolled', 'Lost');--> statement-breakpoint
CREATE TYPE "public"."payment_gateway" AS ENUM('paystack', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'success', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."school_track_status" AS ENUM('Draft', 'Preparing Application', 'Documents under review', 'Submitted to University', 'Conditional Offer Received', 'Unconditional Offer', 'Offer Accepted', 'Offer Declined', 'Application Rejected', 'Waitlisted', 'Withdrawn');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_sender_type" AS ENUM('applicant', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'pending', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(40),
	"source" varchar(64) DEFAULT 'Web Inquiry' NOT NULL,
	"stage" "lead_stage" DEFAULT 'New Lead' NOT NULL,
	"target_country" varchar(80),
	"assigned_staff_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"client_user_id" text,
	"reference" varchar(128) NOT NULL,
	"gateway" "payment_gateway" DEFAULT 'paystack' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(16) DEFAULT 'USD' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"raw_webhook_payload" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transactions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "school_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"application_id" uuid,
	"destination_id" varchar(64) NOT NULL,
	"university_id" text NOT NULL,
	"program_id" text NOT NULL,
	"intake" varchar(64) NOT NULL,
	"status" "school_track_status" DEFAULT 'Draft' NOT NULL,
	"handler_note" text,
	"financial_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_track_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_application_id" uuid NOT NULL,
	"status" "school_track_status" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"financial_note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"sender_type" "ticket_sender_type" DEFAULT 'applicant' NOT NULL,
	"sender_id" text,
	"sender_name" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_user_id" text NOT NULL,
	"applicant_id" uuid,
	"applicant_name" text NOT NULL,
	"subject" varchar(255) NOT NULL,
	"category" varchar(64) DEFAULT 'General Inquiry' NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'medium' NOT NULL,
	"assigned_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_staff_id_ops_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_track_events" ADD CONSTRAINT "school_track_events_school_application_id_school_applications_id_fk" FOREIGN KEY ("school_application_id") REFERENCES "public"."school_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_staff_id_ops_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage","created_at");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_staff_idx" ON "leads" USING btree ("assigned_staff_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_invoice_idx" ON "payment_transactions" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_ref_idx" ON "payment_transactions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "school_applications_applicant_idx" ON "school_applications" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "school_applications_application_idx" ON "school_applications" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "school_applications_status_idx" ON "school_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "school_track_events_school_idx" ON "school_track_events" USING btree ("school_application_id","at");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_client_idx" ON "tickets" USING btree ("client_user_id","status");--> statement-breakpoint
CREATE INDEX "tickets_staff_idx" ON "tickets" USING btree ("assigned_staff_id","status");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status","created_at");