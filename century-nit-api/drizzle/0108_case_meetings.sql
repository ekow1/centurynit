-- Case check-ins: a handler schedules a meeting on an active case — online
-- (Meet link generated) or in person — without touching the consultation
-- intake path. `kind` separates them from paid consultations; application_id
-- ties the booking to the case it belongs to.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "application_id" uuid REFERENCES "applications"("id") ON DELETE set null;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'consultation';
CREATE INDEX IF NOT EXISTS "bookings_application_idx" ON "bookings" ("application_id") WHERE "application_id" IS NOT NULL;
