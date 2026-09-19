-- Staffing context: handoff escalation + seat release.
-- A handoff parked too long (age or defer count) gets stamped once by the
-- sweep so the queue can flag it and managers get a single escalation nudge.
-- `released` marks a stage seat returned to the queue without a replacement.
ALTER TYPE "stage_assignment_status" ADD VALUE IF NOT EXISTS 'released';
ALTER TABLE "stage_handoffs" ADD COLUMN IF NOT EXISTS "escalated_at" timestamptz;

