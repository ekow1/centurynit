-- The Departure chapter's facts: the school's report-by date, orientation,
-- the briefing, the airport pickup, the accommodation, the emergency contact
-- abroad, the day they arrived — recorded by the departure officer, read by
-- the client.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "departure_details" jsonb NOT NULL DEFAULT '{}'::jsonb;
