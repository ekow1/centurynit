-- Context-Aware Case Communication & Assignment System (§5–§13, §28)
--
-- Extends the existing chat schema with stage-scoped assignments, live staff
-- presence, notification preferences, a communication audit trail, and the
-- conversation columns needed to route a customer to the officer currently
-- responsible for their case stage. See services/communication.ts.

-- 1. Extend the conversation_type enum with the new context-aware types.
ALTER TYPE "conversation_type" ADD VALUE 'support';
--> statement-breakpoint
ALTER TYPE "conversation_type" ADD VALUE 'case';
--> statement-breakpoint
ALTER TYPE "conversation_type" ADD VALUE 'stage';
--> statement-breakpoint
ALTER TYPE "conversation_type" ADD VALUE 'internal';
--> statement-breakpoint
ALTER TYPE "conversation_type" ADD VALUE 'escalation';
--> statement-breakpoint

-- 2. Extend conversation_role with `former` (for officers who leave a case but
--    retain read access to the historical thread for a window).
ALTER TYPE "conversation_role" ADD VALUE 'former';
--> statement-breakpoint

-- 3. New enums.
CREATE TYPE "conversation_status" AS ENUM('open', 'closed', 'archived');
--> statement-breakpoint
CREATE TYPE "staff_presence_status" AS ENUM('available', 'busy', 'on_leave', 'offline');
--> statement-breakpoint
CREATE TYPE "stage_assignment_status" AS ENUM('active', 'reassigned', 'on_leave', 'completed');
--> statement-breakpoint

-- 4. Extend `conversations` with stage / email-threading / escalation / status.
ALTER TABLE "conversations" ADD COLUMN "stage_key" varchar(80);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "email_inbox_token" varchar(64);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "escalated_by_ops_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_escalated_by_ops_user_id_ops_users_id_fk" FOREIGN KEY ("escalated_by_ops_user_id") REFERENCES "ops_users"("id") ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "escalation_reason" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_message_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "status" "conversation_status" NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "closed_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_email_inbox_token_idx" ON "conversations" USING btree ("email_inbox_token");
--> statement-breakpoint
CREATE INDEX "conversations_stage_idx" ON "conversations" USING btree ("linked_entity_type", "linked_entity_id", "stage_key");
--> statement-breakpoint

-- 5. Make `conversation_participants` symmetric so applicants can be real
--    participants (with read receipts / unread counts) and add a proper PK.
ALTER TABLE "conversation_participants" ALTER COLUMN "ops_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "participant_user_id" text;
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_participant_user_id_users_id_fk" FOREIGN KEY ("participant_user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
-- Backfill: any existing applicant conversation rows use the `conversations.user_id`
-- column, not a participant row, so there is nothing to migrate here. The
-- communication service treats both representations as participants at read time.
--> statement-breakpoint
-- Drop the old non-unique index and replace with a real composite primary key.
DROP INDEX IF EXISTS "conversation_participants_pk";
--> statement-breakpoint
-- A composite PK with nullable columns needs a workaround: enforce exactly-one
-- participant via a CHECK constraint and use a surrogate unique index. Postgres
-- allows unique indexes with NULLs (treated as distinct by default), so we add a
-- generated coalesce key for uniqueness.
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_one_participant_chk"
  CHECK (("ops_user_id" IS NOT NULL)::int + ("participant_user_id" IS NOT NULL)::int = 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_pk" ON "conversation_participants" USING btree ("conversation_id", COALESCE("ops_user_id", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("participant_user_id", ''));
--> statement-breakpoint
CREATE INDEX "conversation_participants_part_user_idx" ON "conversation_participants" USING btree ("participant_user_id");
--> statement-breakpoint

-- 6. Stage assignments — who is handling which stage of which case right now.
CREATE TABLE "stage_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" uuid NOT NULL,
  "stage" varchar(80) NOT NULL,
  "ops_user_id" uuid NOT NULL,
  "status" "stage_assignment_status" NOT NULL DEFAULT 'active',
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
  "assigned_by" uuid,
  "ended_at" timestamp with time zone,
  "ended_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "ops_users"("id") ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_assigned_by_ops_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "ops_users"("id") ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "stage_assignments_application_idx" ON "stage_assignments" USING btree ("application_id", "stage");
--> statement-breakpoint
CREATE INDEX "stage_assignments_ops_user_idx" ON "stage_assignments" USING btree ("ops_user_id", "status");
--> statement-breakpoint
-- Only one active assignment per (case, stage).
CREATE UNIQUE INDEX "stage_assignments_active_unique_idx" ON "stage_assignments" USING btree ("application_id", "stage") WHERE "status" = 'active';
--> statement-breakpoint

-- 7. Staff presence.
CREATE TABLE "staff_presence" (
  "ops_user_id" uuid PRIMARY KEY,
  "status" "staff_presence_status" NOT NULL DEFAULT 'offline',
  "last_seen_at" timestamp with time zone,
  "status_set_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "staff_presence" ADD CONSTRAINT "staff_presence_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "ops_users"("id") ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint

-- 8. Notification preferences.
CREATE TABLE "notification_preferences" (
  "user_id" text PRIMARY KEY,
  "channel_flags" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "quiet_hours" jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint

-- 9. Communication audit trail.
CREATE TABLE "communication_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" text,
  "actor_ops_user_id" uuid,
  "action" varchar(64) NOT NULL,
  "conversation_id" uuid,
  "application_id" uuid,
  "stage_key" varchar(80),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_actor_ops_user_id_ops_users_id_fk" FOREIGN KEY ("actor_ops_user_id") REFERENCES "ops_users"("id") ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "communication_events_conversation_idx" ON "communication_events" USING btree ("conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX "communication_events_application_idx" ON "communication_events" USING btree ("application_id", "created_at");
--> statement-breakpoint
CREATE INDEX "communication_events_action_idx" ON "communication_events" USING btree ("action", "created_at");
--> statement-breakpoint

-- 10. Backfill: any existing `applicant` conversations remain valid; the
--     communication service also writes a `participant_user_id` row going
--     forward so applicants get read receipts. No data migration required.
--> statement-breakpoint

-- 11. `conversations.created_by` was NOT NULL, but a customer-initiated
--     support conversation has no staff creator. Make it nullable so the
--     service can create SUPPORT conversations without a synthetic staff ID.
ALTER TABLE "conversations" ALTER COLUMN "created_by" DROP NOT NULL;
