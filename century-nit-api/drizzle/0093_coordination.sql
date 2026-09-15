-- Coordination at three scopes: a case is stamped with its coordinator at
-- creation (consultations.coordinator_id stays the source of truth), and
-- coordinated_via records which scope put it there — an explicit case
-- handover, the applicant's journey coordinator, or the branch's duty
-- coordinator for the day.
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "coordinator_id" uuid;--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_coordinator_id_ops_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "coordinated_via" varchar(16);--> statement-breakpoint
UPDATE "consultations" SET "coordinated_via" = 'case' WHERE "coordinator_id" IS NOT NULL AND "coordinated_via" IS NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coordinator_duty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch" varchar(64) NOT NULL,
	"duty_date" date NOT NULL,
	"coordinator_id" uuid NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "coordinator_duty" ADD CONSTRAINT "coordinator_duty_coordinator_id_ops_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_duty" ADD CONSTRAINT "coordinator_duty_set_by_ops_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coordinator_duty_branch_date_idx" ON "coordinator_duty" ("branch", "duty_date");
