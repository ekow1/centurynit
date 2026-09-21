-- The pre-departure fee milestone was read as "agency line index >= 2 on an
-- instalment plan" — a position rule from the three-line split (deposit,
-- pre-departure, post-arrival). A stage-priced plan lines the invoice by
-- stage (Admissions · on acceptance, Admissions · on offer, Visa, Departure)
-- so index 2 was the second Admissions line: paying it released the papers.
--
-- The milestone is plan-aware from here: every line that falls due before
-- arrival (due_on not arrival/scheduled) is covered. The ledger trigger
-- caches it beside the other paid flags.

ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "pre_departure_fee_paid" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION sync_application_paid_flags(p_application_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
	v_stage_index int := 0;
	v_total_lines int := 0;
	v_pre_departure boolean := false;
BEGIN
	IF p_application_id IS NULL THEN
		RETURN;
	END IF;

	-- Agency milestones: how many lines of the live agency invoice are fully
	-- covered, in position order. Line 1 is the entry milestone.
	WITH inv AS (
		SELECT i.id FROM invoices i
		WHERE i.application_id = p_application_id AND i.type = 'agency' AND i.status <> 'void'
		ORDER BY i.created_at DESC
		LIMIT 1
	),
	paid AS (
		SELECT COALESCE(SUM(p.amount_cents), 0) AS cents
		FROM invoice_payments p
		WHERE p.invoice_id = (SELECT id FROM inv)
	),
	lines AS (
		SELECT l.due_on, SUM(l.amount_cents) OVER (ORDER BY l.position) AS cum
		FROM invoice_lines l
		WHERE l.invoice_id = (SELECT id FROM inv)
	)
	SELECT
		COUNT(*) FILTER (WHERE cum <= (SELECT cents FROM paid)),
		COUNT(*),
		-- The pre-departure milestone: every pre-arrival line covered.
		COUNT(*) FILTER (WHERE due_on IS DISTINCT FROM 'arrival' AND due_on IS DISTINCT FROM 'scheduled') > 0
			AND COUNT(*) FILTER (WHERE due_on IS DISTINCT FROM 'arrival' AND due_on IS DISTINCT FROM 'scheduled' AND cum > (SELECT cents FROM paid)) = 0
	INTO v_stage_index, v_total_lines, v_pre_departure
	FROM lines;

	UPDATE applications a SET
		app_fee_paid = EXISTS (
			SELECT 1 FROM invoices i WHERE i.application_id = a.id AND i.type = 'application' AND i.status = 'paid'
		),
		visa_invoice_paid = EXISTS (
			SELECT 1 FROM invoices i WHERE i.application_id = a.id AND i.type = 'visa' AND i.status = 'paid'
		),
		travel_invoice_paid = EXISTS (
			SELECT 1 FROM invoices i WHERE i.application_id = a.id AND i.type = 'travel' AND i.status = 'paid'
		),
		agency_stage_index = v_stage_index,
		deposit_paid = v_stage_index >= 1,
		agency_settled = v_total_lines > 0 AND v_stage_index >= v_total_lines,
		pre_departure_fee_paid = COALESCE(v_pre_departure, false),
		updated_at = now()
	WHERE a.id = p_application_id;
END $$;
--> statement-breakpoint

-- Backfill every case that has an agency invoice.
DO $$
DECLARE r record;
BEGIN
	FOR r IN SELECT DISTINCT application_id FROM invoices WHERE type = 'agency' AND application_id IS NOT NULL LOOP
		PERFORM sync_application_paid_flags(r.application_id);
	END LOOP;
END $$;
