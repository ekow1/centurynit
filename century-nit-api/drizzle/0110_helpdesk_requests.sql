-- The helpdesk grows a request layer: a support thread is no longer one
-- endless scroll per client but one row per request, with a subject, a
-- category, whose move it is, and first-response / resolution timestamps so
-- the desk can tell "breaching" from "waiting". `audience` lets staff file
-- internal tickets that never reach the portal; `raisedByOpsUserId` marks a
-- request the office logged on a client's behalf.

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "subject" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "category" varchar(24);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "priority" varchar(16) NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "waiting_on" varchar(8);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "audience" varchar(16) NOT NULL DEFAULT 'client';
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "raised_by_ops_user_id" uuid REFERENCES "ops_users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "first_response_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reopened_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "csat_score" integer;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "csat_note" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "conversations_queue_idx" ON "conversations" ("type", "status", "waiting_on", "category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_user_open_idx" ON "conversations" ("user_id", "status") WHERE "audience" = 'client';
--> statement-breakpoint

-- Canned replies: managed in the desk, variable-interpolated at send time
-- ({{client.firstName}}, {{case.ref}} …), scoped to all / branch / stage.
CREATE TABLE IF NOT EXISTS "canned_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"label" text NOT NULL,
	"body" text NOT NULL,
	"scope" varchar(16) NOT NULL DEFAULT 'all',
	"scope_value" varchar(80),
	"created_by" uuid REFERENCES "ops_users"("id") ON DELETE SET NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now()
);
