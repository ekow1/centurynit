-- Turn the "everything is scoped to an application" rule (backfilled by 0071)
-- into something the database refuses to break.
--
-- Requires 0071 to have run: any journey invoice or school track still
-- unlinked after that backfill belongs to an applicant with no application at
-- all and cannot be attributed. Those rows are handled explicitly below rather
-- than silently, so the constraint never fails on stale data.

-- Journey invoices (application / visa / agency / travel) must name their case.
-- An unlinked one that survived the backfill has no case to belong to: it is a
-- one-off charge in all but name, so re-type it as such rather than drop it.
UPDATE invoices
SET type = 'custom'
WHERE application_id IS NULL
  AND type NOT IN ('consultation', 'custom');
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journey_linked"
	CHECK ("type" IN ('consultation', 'custom') OR "application_id" IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_application_idx" ON "invoices" ("application_id", "type");
--> statement-breakpoint

-- A school track without an application is a selection on nothing. After the
-- 0071 backfill the only such rows belong to applicants who never had an
-- application; they can never be locked, invoiced or tracked, so remove them.
DELETE FROM school_track_events
WHERE school_application_id IN (SELECT id FROM school_applications WHERE application_id IS NULL);
--> statement-breakpoint
DELETE FROM school_applications WHERE application_id IS NULL;
--> statement-breakpoint
ALTER TABLE "school_applications" DROP CONSTRAINT "school_applications_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "school_applications" ALTER COLUMN "application_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_application_id_applications_id_fk"
	FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
