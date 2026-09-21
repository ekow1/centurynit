-- Stage continuation: a completed client asks for the stage beyond their
-- plan's exit; ops approves and the plan extends. Also the record of where
-- a mid-plan completion stopped, and the intake answers a continued stage
-- collected after the fact.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "completed_at_stage" varchar(32);
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "completion_note" text;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "stage_intake" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "stage_continuation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL REFERENCES "applications"("id") ON DELETE cascade,
	"stage" varchar(32) NOT NULL,
	"note" text,
	"status" varchar(16) NOT NULL DEFAULT 'pending',
	"decision_note" text,
	"decided_by_ops_user_id" uuid REFERENCES "ops_users"("id") ON DELETE set null,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "stage_continuation_application_idx" ON "stage_continuation_requests" ("application_id", "status");

-- One live request per case at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "stage_continuation_pending_uniq"
	ON "stage_continuation_requests" ("application_id") WHERE "status" = 'pending';

-- Same RLS contract as every application table (rls.test.ts sweeps for it).
ALTER TABLE "stage_continuation_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stage_continuation_requests" FORCE ROW LEVEL SECURITY;
