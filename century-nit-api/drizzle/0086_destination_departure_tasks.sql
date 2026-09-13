-- Per-country pre-departure items (collect the BRP, SEVIS check-in…) live on
-- the destination; the global template lives in settings. A case is seeded
-- from both when Departure opens.
ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "departure_tasks" jsonb NOT NULL DEFAULT '[]'::jsonb;
