-- Stage-priced packages. A package (the track) prices each service stage
-- on its own and the three together as the bundle (`price_cents`). A case
-- carries the stages on its plan; an agency invoice line carries the case
-- event that makes it due.
ALTER TABLE "service_packages" ADD COLUMN IF NOT EXISTS "stage_prices" jsonb;
--> statement-breakpoint
-- Legacy rows priced the whole journey as one number: seed à la carte a
-- little above the bundle so the bundle means something. Finance edits from here.
UPDATE "service_packages" SET "stage_prices" = jsonb_build_object(
	'admissions', round("price_cents" * 0.47),
	'visa',       round("price_cents" * 0.47),
	'departure',  round("price_cents" * 0.20)
) WHERE "stage_prices" IS NULL AND "price_cents" > 0;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "scope_stages" jsonb;
--> statement-breakpoint
-- Every case with a package today bought the full journey.
UPDATE "applications" SET "scope_stages" = '["admissions","visa","departure"]'::jsonb
WHERE "scope_stages" IS NULL AND "package_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "due_on" text;
--> statement-breakpoint
-- Existing agency milestones, by position: deposit · pre-departure · post-arrival.
UPDATE "invoice_lines" l SET "due_on" = CASE l."position" WHEN 0 THEN 'acceptance' WHEN 1 THEN 'visa_approved' ELSE 'arrival' END
FROM "invoices" i
WHERE i."id" = l."invoice_id" AND i."type" = 'agency' AND l."due_on" IS NULL AND l."due_at" IS NULL;
--> statement-breakpoint
UPDATE "invoice_lines" l SET "due_on" = 'scheduled'
FROM "invoices" i
WHERE i."id" = l."invoice_id" AND i."type" = 'agency' AND l."due_on" IS NULL AND l."due_at" IS NOT NULL;
