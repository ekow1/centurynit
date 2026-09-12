-- Visa tracking was opened ("pending" = case opened) as a side effect of
-- accepting the application, before the applicant had consented, paid the
-- visa invoice or been assigned a specialist. Put those cases back to
-- "locked"; the real path (payment -> awaiting_handler -> pending) reopens
-- them when it actually happens. Cases with a paid visa invoice or a visa
-- specialist are genuinely open and are left alone.
UPDATE "applications" a
SET "visa_stage" = 'locked', "updated_at" = now()
WHERE a."visa_stage" = 'pending'
  AND a."visa_invoice_paid" = false
  AND NOT EXISTS (SELECT 1 FROM "stage_assignments" s WHERE s."application_id" = a."id" AND s."stage" = 'visa_processing')
  AND NOT EXISTS (SELECT 1 FROM "invoices" i WHERE i."application_id" = a."id" AND i."type" = 'visa' AND i."status" = 'paid');
