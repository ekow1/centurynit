-- The admin tier seats itself: System Administrator gains the case modules
-- and the four chapter-ownership capabilities (plus assign_work) so a
-- sysadmin can take or be assigned a case like a manager can.
UPDATE "ops_roles"
SET "permissions" = (
	SELECT jsonb_agg(p ORDER BY p)
	FROM (
		SELECT DISTINCT p
		FROM (
			SELECT jsonb_array_elements_text(r2."permissions") AS p
			FROM "ops_roles" r2
			WHERE r2."id" = 'admin'
			UNION ALL
			SELECT p FROM (VALUES
				('applicants'),
				('applications'),
				('appointments'),
				('consultations'),
				('crm'),
				('dashboard'),
				('documents'),
				('travel'),
				('visa'),
				('assign_work'),
				('own:consult'),
				('own:apply'),
				('own:visa'),
				('own:depart')
			) AS new_perms(p)
		) all_perms
	) deduped
),
"updated_at" = now()
WHERE "id" = 'admin';
