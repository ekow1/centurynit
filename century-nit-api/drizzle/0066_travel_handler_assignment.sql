-- Travel assistance flow: handler assignment + ticket_paid/cleared statuses
-- New flow: review → invoiced → ticket_paid → booked → cleared

ALTER TYPE "public"."travel_assistance_status" ADD VALUE IF NOT EXISTS 'ticket_paid';
ALTER TYPE "public"."travel_assistance_status" ADD VALUE IF NOT EXISTS 'cleared';

ALTER TABLE "travel_assistance_requests"
	ADD COLUMN "assigned_ops_user_id" uuid REFERENCES "ops_users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "travel_assistance_assigned_ops_idx"
	ON "travel_assistance_requests" ("assigned_ops_user_id");
