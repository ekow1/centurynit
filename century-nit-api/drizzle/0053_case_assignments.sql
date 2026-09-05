-- Case assignments history table.
-- Append-only record of every staff assignment on a case (consultation,
-- application, or booking). Reassignment ends the old row and inserts a new
-- one; nothing is ever deleted or overwritten. `status = 'active'` is the
-- single source of truth for who currently owns a case.

CREATE TYPE "case_assignment_type" AS ENUM('consultation', 'application', 'booking');--> statement-breakpoint
CREATE TYPE "case_assignment_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "case_assignment_role" AS ENUM('primary', 'secondary', 'reviewer');--> statement-breakpoint
CREATE TYPE "case_assignment_end_reason" AS ENUM('reassigned', 'completed', 'cancelled', 'offboarded', 'unassigned');--> statement-breakpoint

CREATE TABLE "case_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "case_assignment_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"role" "case_assignment_role" DEFAULT 'primary' NOT NULL,
	"status" "case_assignment_status" DEFAULT 'active' NOT NULL,
	"assigned_at" timestamptz DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"ended_at" timestamptz,
	"ended_by" uuid,
	"end_reason" "case_assignment_end_reason",
	"note" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_ops_user_id_ops_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."ops_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_assigned_by_ops_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_ended_by_ops_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."ops_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "case_assignments_target_idx" ON "case_assignments" ("target_type","target_id","status");--> statement-breakpoint
CREATE INDEX "case_assignments_officer_idx" ON "case_assignments" ("ops_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "case_assignments_unique_active" ON "case_assignments" ("target_type","target_id","role") WHERE status = 'active';--> statement-breakpoint

-- Backfill active assignments from existing denormalized columns.
-- Only rows that are not in a closed state are backfilled as 'active';
-- closed consultations/applications/bookings are left without an active
-- assignment row, which is the new correct behavior.
INSERT INTO "case_assignments" ("target_type", "target_id", "ops_user_id", "role", "status", "assigned_at", "assigned_by")
SELECT 'consultation', c.id, c.assigned_officer_id, 'primary', 'active', COALESCE(c.assigned_at, now()), c.assigned_by
FROM consultations c
WHERE c.assigned_officer_id IS NOT NULL
  AND c.status NOT IN ('COMPLETED', 'CANCELLED')
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "case_assignments" ("target_type", "target_id", "ops_user_id", "role", "status", "assigned_at")
SELECT 'application', a.id, a.assigned_staff_id, 'primary', 'active', now()
FROM applications a
WHERE a.assigned_staff_id IS NOT NULL
  AND a.status NOT IN ('REJECTED')
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "case_assignments" ("target_type", "target_id", "ops_user_id", "role", "status", "assigned_at", "assigned_by")
SELECT 'booking', b.id, b.employee_id, 'primary', 'active', COALESCE(b.assigned_at, now()), b.assigned_by
FROM bookings b
WHERE b.employee_id IS NOT NULL
  AND b.status NOT IN ('CANCELLED', 'COMPLETED')
ON CONFLICT DO NOTHING;--> statement-breakpoint
