-- Idempotent version: the `notifications` table, `applicants.portal_state`, and
-- the notifications index/FK are all created by 0024_portal_state_notifications.
-- This migration originally re-created them (a botched snapshot), which collided.
-- What is unique to this migration is the set of FK constraints on
-- school_applications. We add them guarded so re-running is a no-op on any DB
-- state (production safety): a partial prior run may have created some.
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_applications_destination_id_destinations_id_fk'
  ) THEN
    ALTER TABLE "school_applications"
      ADD CONSTRAINT "school_applications_destination_id_destinations_id_fk"
      FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_applications_university_id_catalog_universities_id_fk'
  ) THEN
    ALTER TABLE "school_applications"
      ADD CONSTRAINT "school_applications_university_id_catalog_universities_id_fk"
      FOREIGN KEY ("university_id") REFERENCES "public"."catalog_universities"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_applications_program_id_catalog_programs_id_fk'
  ) THEN
    ALTER TABLE "school_applications"
      ADD CONSTRAINT "school_applications_program_id_catalog_programs_id_fk"
      FOREIGN KEY ("program_id") REFERENCES "public"."catalog_programs"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
