-- Applications chapter: the school's own reference, proof of submission, the
-- offer the client accepted, and invoice lines that know which school they
-- bill so a draft can follow the school list.
ALTER TABLE "school_applications" ADD COLUMN IF NOT EXISTS "institution_reference" text;
ALTER TABLE "school_applications" ADD COLUMN IF NOT EXISTS "submission_proof_url" text;

ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "accepted_school_id" uuid REFERENCES "school_applications"("id") ON DELETE SET NULL;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "offer_accepted_at" timestamptz;

ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "school_application_id" uuid REFERENCES "school_applications"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "invoice_lines_school_idx" ON "invoice_lines" ("school_application_id");

-- Lines the system generated from a school carry a fixed label; tie them back.
UPDATE "invoice_lines" il
SET "school_application_id" = sa."id"
FROM "invoices" i, "school_applications" sa
WHERE il."invoice_id" = i."id"
  AND i."type" = 'application'
  AND i."application_id" IS NOT NULL
  AND sa."application_id" = i."application_id"
  AND il."school_application_id" IS NULL
  AND il."label" = coalesce(sa."university_name", 'University') || ' - ' || coalesce(sa."program_name", 'Programme') || ' Application Fee';
