-- Backfill applicationId on existing application invoices that are missing it.
-- Links invoices to applications via the applicant's userId.
UPDATE invoices
SET application_id = sub.application_id
FROM (
	SELECT i.id AS invoice_id, a.id AS application_id
	FROM invoices i
	JOIN applicants app ON i.client_user_id = app.user_id
	JOIN applications a ON a.applicant_id = app.id
	WHERE i.type = 'application'
	  AND i.application_id IS NULL
	  AND i.client_user_id IS NOT NULL
) sub
WHERE invoices.id = sub.invoice_id;
