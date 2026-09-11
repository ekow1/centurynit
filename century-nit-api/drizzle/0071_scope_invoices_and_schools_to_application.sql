-- Every journey signal is now scoped to the applicant's current application
-- (invoices and school tracks are read by application_id, never by applicant
-- or client user). Link the rows that predate that rule to the client's
-- newest application so they keep appearing on the case they were raised for.
--
-- Consultation invoices are deliberately left unlinked: they predate any
-- application and the portal lists them alongside the current case.

WITH latest_app AS (
	SELECT DISTINCT ON (a.applicant_id) a.applicant_id, a.id AS application_id, app.user_id
	FROM applications a
	JOIN applicants app ON app.id = a.applicant_id
	ORDER BY a.applicant_id, a.created_at DESC
)
UPDATE invoices i
SET application_id = la.application_id
FROM latest_app la
WHERE i.application_id IS NULL
  AND i.client_user_id IS NOT NULL
  AND i.client_user_id = la.user_id
  AND i.type <> 'consultation';

WITH latest_app AS (
	SELECT DISTINCT ON (applicant_id) applicant_id, id AS application_id
	FROM applications
	ORDER BY applicant_id, created_at DESC
)
UPDATE school_applications s
SET application_id = la.application_id
FROM latest_app la
WHERE s.application_id IS NULL
  AND s.applicant_id = la.applicant_id;
