-- canned_replies landed in 0110 without RLS — every public table must be
-- locked down (see 0009_rls_sweep_all_tables.sql); the API reaches it
-- through the service role, which bypasses RLS anyway.
ALTER TABLE "canned_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "canned_replies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
