-- Capabilities: what a role may do, alongside the modules that say what it
-- sees, in the same permissions list. Each built-in role gets the
-- capabilities its hard-coded checks used to grant, so nothing changes on
-- day one; from here on the role editor governs them. Rank orders roles
-- for who may invite or change whom.
ALTER TABLE "ops_roles" ADD COLUMN IF NOT EXISTS "rank" integer DEFAULT 30 NOT NULL;
UPDATE "ops_roles" SET "rank" = 100 WHERE "id" = 'super_admin';
UPDATE "ops_roles" SET "rank" = 90 WHERE "id" = 'admin';
UPDATE "ops_roles" SET "rank" = 70 WHERE "id" = 'manager';
UPDATE "ops_roles" SET "rank" = 50 WHERE "id" = 'coordinator';
UPDATE "ops_roles" SET "rank" = 40 WHERE "id" = 'customer_service';
UPDATE "ops_roles" SET "rank" = 30 WHERE "id" IN ('consultant', 'finance');

CREATE OR REPLACE FUNCTION pg_temp.grant_caps(role_id text, caps jsonb) RETURNS void AS $$
	UPDATE "ops_roles"
	SET "permissions" = (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements("permissions" || caps) AS x),
		"updated_at" = now()
	WHERE "id" = role_id;
$$ LANGUAGE sql;
SELECT pg_temp.grant_caps('super_admin', '["assign_work","see_all_cases","see_all_branches","invite_staff","manage_roles","manage_settings","manage_clients","edit_packages","edit_universities","issue_invoices","own:consult","own:apply","own:visa","own:depart"]');
SELECT pg_temp.grant_caps('manager', '["assign_work","see_all_cases","see_all_branches","invite_staff","manage_clients","edit_packages","edit_universities","issue_invoices","own:consult","own:apply","own:visa","own:depart"]');
SELECT pg_temp.grant_caps('coordinator', '["assign_work","see_all_cases","see_all_branches","own:consult","own:apply","own:visa","own:depart"]');
SELECT pg_temp.grant_caps('customer_service', '["assign_work","see_all_branches"]');
SELECT pg_temp.grant_caps('consultant', '["own:consult","own:apply","own:visa","own:depart"]');
SELECT pg_temp.grant_caps('finance', '["see_all_branches","edit_packages","issue_invoices"]');
SELECT pg_temp.grant_caps('admin', '["see_all_cases","see_all_branches","invite_staff","manage_roles","manage_clients","manage_settings"]');
