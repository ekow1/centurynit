-- A visa decision can be a refusal. Until now the visa stepper could only
-- move forward to "complete" (approved); a refused visa had nowhere to go.
-- The stage stays at "decision" and the outcome is recorded here, so the
-- case can be reopened for a reapplication without losing the history.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "visa_outcome" varchar(16);
--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "applications_visa_outcome_check";
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_visa_outcome_check"
	CHECK ("visa_outcome" IS NULL OR "visa_outcome" IN ('approved', 'refused'));
--> statement-breakpoint
UPDATE "applications" SET "visa_outcome" = 'approved' WHERE "visa_stage" = 'complete' AND "visa_outcome" IS NULL;
