-- Travel assistance, one path: decide -> review -> invoiced -> ticket paid
-- -> booked (or declined / on hold). The manager-approval status and the
-- "cleared by choosing a payment plan" status are gone: whether the ticket
-- invoice is a proforma or issued is the invoice's own status, and the
-- payment plan is chosen in Payment Execution, where the money is.
UPDATE "travel_assistance_requests" SET "status" = 'invoiced', "updated_at" = now()
	WHERE "status" IN ('quote_prepared', 'quote_approved');
UPDATE "travel_assistance_requests" SET "status" = 'booked', "updated_at" = now()
	WHERE "status" = 'cleared';

-- The "quote" was the flight on the invoice; it keeps its data under its
-- real name. The fare lives on the invoice, so its copy here goes; the
-- ops-only checklist never had a screen.
ALTER TABLE "travel_assistance_requests" RENAME COLUMN "quote" TO "flight";
UPDATE "travel_assistance_requests" SET "flight" = jsonb_strip_nulls(jsonb_build_object(
	'carrier', "flight"->'carrier',
	'flightNumber', "flight"->'flightNumber',
	'from', "flight"->'departure'->'from',
	'to', "flight"->'arrival'->'to',
	'departAt', "flight"->'departure'->'at',
	'arriveAt', "flight"->'arrival'->'at',
	'notes', "flight"->'notes'
)) WHERE "flight" IS NOT NULL;
ALTER TABLE "travel_assistance_requests" DROP COLUMN IF EXISTS "ticket_amount_cents";
ALTER TABLE "travel_assistance_requests" DROP COLUMN IF EXISTS "ops_checklist";

-- "Cleared to travel" is derived (flight booked + pre-departure checklist
-- done), not a button; the flag it used to be is retired.
ALTER TABLE "applications" DROP COLUMN IF EXISTS "travel_clearance";
