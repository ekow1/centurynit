-- Enable RLS on every public table that is missing it.
--
-- The same sweep as 0009 and 0098, run again: 0099 added payment_authorizations
-- and autopay_attempts without it, which rls.test.ts flags. A migration fixes
-- today; the test is what keeps the next table from slipping through.

DO $$
DECLARE
	target record;
BEGIN
	FOR target IN
		SELECT c.relname AS name
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND c.relkind = 'r'
		  AND NOT c.relrowsecurity
		  -- Drizzle's own bookkeeping lives in its own schema, but guard anyway.
		  AND c.relname <> '__drizzle_migrations'
	LOOP
		EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.name);
		EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target.name);

		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
			EXECUTE format('REVOKE ALL ON public.%I FROM anon', target.name);
		END IF;
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
			EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', target.name);
		END IF;

		RAISE NOTICE 'RLS enabled on public.%', target.name;
	END LOOP;
END $$;
