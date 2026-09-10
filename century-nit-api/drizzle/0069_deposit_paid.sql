-- Add depositPaid flag to applications.
-- True once the applicant has paid the 10% deposit (first agency milestone).
-- Backfill existing applications that already have a paid first milestone.
ALTER TABLE "applications" ADD COLUMN "deposit_paid" boolean NOT NULL DEFAULT false;

-- Backfill: any application where the first agency milestone is already paid
-- (agencyStageIndex >= 1) or the app fee is already paid should have depositPaid = true.
UPDATE "applications" SET "deposit_paid" = true WHERE "agency_stage_index" >= 1 OR "app_fee_paid" = true;
