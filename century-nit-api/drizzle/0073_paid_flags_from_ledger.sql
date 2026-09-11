-- The paid flags on applications (app_fee_paid, visa_invoice_paid,
-- travel_invoice_paid, deposit_paid, agency_stage_index, agency_settled)
-- duplicate what the invoice ledger already says. Until now they were
-- maintained by hand in recordPayment / voidInvoice and could be patched by
-- ops, so they drifted from the ledger and the journey had to OR the two.
--
-- From here the ledger is the only writer: any change to an invoice, its
-- lines or its payments recomputes the flags for that application. The
-- columns stay (ops screens and the journey read them) but become a cache.

CREATE OR REPLACE FUNCTION sync_application_paid_flags(p_application_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
	v_stage_index int := 0;
	v_total_lines int := 0;
BEGIN
	IF p_application_id IS NULL THEN
		RETURN;
	END IF;

	-- Agency milestones: how many lines of the live agency invoice are fully
	-- covered, in position order. Line 1 is the 10% deposit.
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
		SELECT SUM(l.amount_cents) OVER (ORDER BY l.position) AS cum
		FROM invoice_lines l
		WHERE l.invoice_id = (SELECT id FROM inv)
	)
	SELECT COUNT(*) FILTER (WHERE cum <= (SELECT cents FROM paid)), COUNT(*)
	INTO v_stage_index, v_total_lines
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
		updated_at = now()
	WHERE a.id = p_application_id;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_invoices_sync_paid_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		PERFORM sync_application_paid_flags(OLD.application_id);
		RETURN NULL;
	END IF;
	PERFORM sync_application_paid_flags(NEW.application_id);
	IF TG_OP = 'UPDATE' AND OLD.application_id IS DISTINCT FROM NEW.application_id THEN
		PERFORM sync_application_paid_flags(OLD.application_id);
	END IF;
	RETURN NULL;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_invoice_children_sync_paid_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	v_application_id uuid;
BEGIN
	SELECT application_id INTO v_application_id
	FROM invoices
	WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
	PERFORM sync_application_paid_flags(v_application_id);
	RETURN NULL;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS invoices_sync_paid_flags ON invoices;
--> statement-breakpoint
CREATE TRIGGER invoices_sync_paid_flags
	AFTER INSERT OR DELETE OR UPDATE OF status, type, application_id, credited_cents ON invoices
	FOR EACH ROW EXECUTE FUNCTION trg_invoices_sync_paid_flags();
--> statement-breakpoint
DROP TRIGGER IF EXISTS invoice_payments_sync_paid_flags ON invoice_payments;
--> statement-breakpoint
CREATE TRIGGER invoice_payments_sync_paid_flags
	AFTER INSERT OR UPDATE OR DELETE ON invoice_payments
	FOR EACH ROW EXECUTE FUNCTION trg_invoice_children_sync_paid_flags();
--> statement-breakpoint
DROP TRIGGER IF EXISTS invoice_lines_sync_paid_flags ON invoice_lines;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_sync_paid_flags
	AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
	FOR EACH ROW EXECUTE FUNCTION trg_invoice_children_sync_paid_flags();
--> statement-breakpoint

-- Bring every application in line with its ledger once.
SELECT sync_application_paid_flags(id) FROM applications;
