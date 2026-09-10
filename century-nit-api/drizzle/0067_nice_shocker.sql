-- Enforce idempotency of invoice payments: one reference per payment record.
-- Keep the earliest row for any legacy duplicates before the index binds.
DELETE FROM "invoice_payments" a
USING "invoice_payments" b
WHERE a.reference IS NOT NULL
	AND b.reference IS NOT NULL
	AND a.reference = b.reference
	AND a.id > b.id;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_reference_key" ON "invoice_payments" USING btree ("reference");