-- Close the second door that appears when this database moves to Supabase.
--
-- On Supabase, tables in the `public` schema can be reachable through the Data
-- API (PostgREST) by the `anon` and `authenticated` roles. Every table in this
-- application lives in `public`, so without this migration a Supabase project
-- exposes bookings, invoices, applicant documents, staff invitations and the
-- Better Auth session table directly over HTTPS to anyone holding the publishable
-- key — bypassing this API and every check in it.
--
-- That matters because all of the authorisation in this system lives in the API:
-- `requireAuth`, `requireStaff`, `requireModule`, the booking ownership checks,
-- the document ownership checks. None of it is expressed as RLS, because none of
-- it needs to be — the API is the only intended client.
--
-- So the posture here is: enable RLS everywhere and write no policies. That
-- denies the Data API completely while leaving this API untouched, because it
-- connects as the database owner (or service role), and both bypass RLS. The
-- API stays the only door in.
--
-- If any table is ever meant to be read directly by a browser through PostgREST,
-- that is the moment to add a policy for it — deliberately, one table at a time,
-- rather than inheriting blanket access by default.
--
-- Harmless on a local Postgres: RLS with no policies still does not apply to the
-- owning role, so docker-compose and the test suite are unaffected.

DO $$
DECLARE
	target text;
	tables text[] := ARRAY[
		-- Better Auth
		'users', 'sessions', 'accounts', 'verifications', 'two_factors',
		-- Staff identity
		'ops_users', 'staff_invitations',
		-- Scheduling
		'bookings', 'booking_events',
		'staff_calendar_accounts', 'staff_working_hours', 'calendar_busy_blocks',
		-- Money
		'invoices', 'invoice_lines', 'invoice_payments', 'invoice_events',
		-- Documents
		'applicant_documents'
	];
BEGIN
	FOREACH target IN ARRAY tables LOOP
		-- Skip anything not present, so this migration stays valid if a table is
		-- renamed or a feature is dropped later.
		IF EXISTS (
			SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = target
		) THEN
			EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
			-- FORCE so the table owner is subject to RLS too. The API connects as a
			-- role that bypasses RLS entirely (service_role / superuser), so this
			-- does not affect it, but it removes the surprise of an owner-privileged
			-- connection quietly reading everything.
			EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target);

			-- Defence in depth: even with RLS on, a table should not be granted to
			-- the Data API roles in the first place. Guarded because these roles do
			-- not exist outside Supabase.
			IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
				EXECUTE format('REVOKE ALL ON public.%I FROM anon', target);
			END IF;
			IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
				EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', target);
			END IF;
		END IF;
	END LOOP;
END $$;
