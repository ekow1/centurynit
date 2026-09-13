-- The visa chapter's facts: reference, appointment, biometrics, decision,
-- validity — recorded milestone by milestone by the visa officer.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "visa_details" jsonb NOT NULL DEFAULT '{}'::jsonb;
