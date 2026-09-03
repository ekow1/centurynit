-- Normalize any stray display-string values to enum-style values before
-- the type change (0028_journey_stage_enum.sql did the bulk of this, but
-- guard against rows inserted since with old display strings).
UPDATE applications SET stage = 'document_verification' WHERE stage = 'Document Verification' OR stage = 'Document verification';
UPDATE applications SET stage = 'school_submission' WHERE stage = 'School Submission';
UPDATE applications SET stage = 'offer_letter_review' WHERE stage = 'Offer Letter Review';
UPDATE applications SET stage = 'visa_processing' WHERE stage = 'Visa Processing';
UPDATE applications SET stage = 'payment_execution' WHERE stage = 'Payment Plan' OR stage = 'Payment Execution';
UPDATE applications SET stage = 'travel_assistance' WHERE stage = 'Travel Assistance';
UPDATE applications SET stage = 'completed' WHERE stage = 'Completed';
UPDATE applications SET stage = 'document_verification' WHERE stage IS NULL OR stage = '';
--> statement-breakpoint

CREATE TYPE "public"."journey_stage" AS ENUM('document_verification', 'school_submission', 'offer_letter_review', 'visa_processing', 'payment_execution', 'travel_assistance', 'completed');--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "stage" SET DATA TYPE journey_stage USING stage::journey_stage;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "stage" SET DEFAULT 'document_verification';