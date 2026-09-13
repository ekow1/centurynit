-- Every invoice records who raised it, separately from who approved
-- (issued) it, so the trail reads "raised by X · approved by Y" even when
-- X = Y. Automatic births (consultation, agency, the visa proforma on
-- consent) say "System".
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "raised_by" uuid REFERENCES "ops_users"("id") ON DELETE SET NULL;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "raised_by_name" text;

-- Backfill from what was recorded: the issuer name is the raiser unless it
-- is a system label or the same person who later approved it (then the
-- raiser is unknown and the honest answer is "System").
UPDATE "invoices"
SET "raised_by_name" = CASE
		WHEN "issued_by_name" IN ('System Estimate', 'Century NIT', 'System') THEN 'System'
		WHEN "reviewed_by_name" IS NOT NULL AND "reviewed_by_name" = "issued_by_name" THEN 'System'
		ELSE "issued_by_name"
	END,
	"raised_by" = CASE
		WHEN "issued_by_name" IN ('System Estimate', 'Century NIT', 'System') THEN NULL
		WHEN "reviewed_by_name" IS NOT NULL AND "reviewed_by_name" = "issued_by_name" THEN NULL
		ELSE "issued_by"
	END
WHERE "raised_by_name" IS NULL;
