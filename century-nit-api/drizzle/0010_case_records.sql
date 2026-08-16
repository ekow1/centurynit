CREATE TYPE "public"."consultation_status" AS ENUM('UNDER_REVIEW', 'ASSIGNED', 'IN_ASSESSMENT', 'COMPLETED', 'CANCELLED');
--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('UNDER_REVIEW', 'ACCEPTED', 'ACTION_REQUIRED', 'REJECTED');
--> statement-breakpoint
CREATE TYPE "public"."visa_stage" AS ENUM('locked', 'pending', 'biometrics', 'decision', 'complete');
--> statement-breakpoint
CREATE TYPE "public"."case_comment_kind" AS ENUM('comment', 'recommendation', 'document_request', 'status', 'assignment');
--> statement-breakpoint
CREATE TYPE "public"."case_target" AS ENUM('consultation', 'application');
--> statement-breakpoint
CREATE TABLE "applicants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"email" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"phone" varchar(40),
	"branch" varchar(64) NOT NULL,
	"target_country" varchar(80),
	"assigned_officer_id" uuid,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicants_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "applicants_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(32) NOT NULL,
	"booking_id" uuid,
	"applicant_id" uuid NOT NULL,
	"branch" varchar(64) NOT NULL,
	"type" varchar(32) DEFAULT 'online' NOT NULL,
	"target_country" varchar(80),
	"status" "consultation_status" DEFAULT 'UNDER_REVIEW' NOT NULL,
	"assigned_officer_id" uuid,
	"assigned_at" timestamp with time zone,
	"assigned_by" uuid,
	"slot_confirmed" boolean DEFAULT false NOT NULL,
	"assessment_result" jsonb,
	"requested_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultations_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_number" varchar(32) NOT NULL,
	"applicant_id" uuid NOT NULL,
	"consultation_id" uuid,
	"university" text NOT NULL,
	"program" text NOT NULL,
	"country" varchar(80) NOT NULL,
	"degree_level" varchar(64) DEFAULT 'Master''s' NOT NULL,
	"assigned_staff_id" uuid,
	"stage" varchar(80) DEFAULT 'Document Verification' NOT NULL,
	"status" "application_status" DEFAULT 'UNDER_REVIEW' NOT NULL,
	"funding_track" text,
	"notes" text,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visa_stage" "visa_stage" DEFAULT 'locked' NOT NULL,
	"visa_invoice_paid" boolean DEFAULT false NOT NULL,
	"visa_counselor_note" text,
	"payment_plan_id" varchar(32),
	"agency_stage_index" integer DEFAULT 0 NOT NULL,
	"agency_settled" boolean DEFAULT false NOT NULL,
	"travel_clearance" varchar(16) DEFAULT 'pending' NOT NULL,
	"requested_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_app_number_unique" UNIQUE("app_number")
);
--> statement-breakpoint
CREATE TABLE "case_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "case_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" "case_comment_kind" DEFAULT 'comment' NOT NULL,
	"text" text NOT NULL,
	"author_name" text NOT NULL,
	"author_ops_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_assigned_officer_id_ops_users_id_fk" FOREIGN KEY ("assigned_officer_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_assigned_officer_id_ops_users_id_fk" FOREIGN KEY ("assigned_officer_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_assigned_by_ops_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_assigned_staff_id_ops_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "case_comments" ADD CONSTRAINT "case_comments_author_ops_user_id_ops_users_id_fk" FOREIGN KEY ("author_ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "applicants_officer_idx" ON "applicants" USING btree ("assigned_officer_id");
--> statement-breakpoint
CREATE INDEX "applicants_branch_idx" ON "applicants" USING btree ("branch");
--> statement-breakpoint
CREATE INDEX "consultations_applicant_idx" ON "consultations" USING btree ("applicant_id");
--> statement-breakpoint
CREATE INDEX "consultations_officer_idx" ON "consultations" USING btree ("assigned_officer_id","status");
--> statement-breakpoint
CREATE INDEX "consultations_status_idx" ON "consultations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "applications_applicant_idx" ON "applications" USING btree ("applicant_id");
--> statement-breakpoint
CREATE INDEX "applications_staff_idx" ON "applications" USING btree ("assigned_staff_id","status");
--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status","stage");
--> statement-breakpoint
CREATE INDEX "case_comments_target_idx" ON "case_comments" USING btree ("target_type","target_id","at");
--> statement-breakpoint
ALTER TABLE "applicants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "applicants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "consultations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "consultations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "case_comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "case_comments" FORCE ROW LEVEL SECURITY;
