-- Enable RLS on every public table that is missing it.
--
-- 0007 locked down the tables that existed at the time, by name. 0008 then added
-- `platform_settings` — which stores the encrypted Resend API key and Supabase
-- service-role key — and it arrived without RLS, because a migration written
-- against a fixed list cannot know about tables added after it.
--
-- That is the failure mode worth designing against, not the one table: on
-- Supabase, any table in `public` can be reachable through the Data API, so a
-- table added without RLS is exposed by default rather than protected by
-- default. The credentials table is simply the worst possible example.
--
-- So this sweep is generic — it covers whatever exists — and `rls.test.ts`
-- asserts the invariant continuously, which is what actually stops the next
-- table from slipping through. A migration fixes today; the test fixes the habit.

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
