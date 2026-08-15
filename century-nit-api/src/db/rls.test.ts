import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./index.js";

/**
 * Every table in `public` must have row-level security enabled.
 *
 * This is not a stylistic rule. On Supabase, tables in `public` can be served
 * directly over HTTPS by the Data API (PostgREST) to the `anon` and
 * `authenticated` roles. All of this application's authorisation — session
 * checks, staff roles, booking and document ownership — lives in the API. None
 * of it is expressed as RLS policies, because the API is the only intended
 * client. A table without RLS is therefore a second door into the data that
 * bypasses every check in the codebase.
 *
 * It has already happened once: `platform_settings` was added after the
 * table-by-table lockdown migration and arrived unprotected, holding the
 * encrypted Resend API key and Supabase service-role key. A migration fixed that
 * instance; this test is what stops the next one, because it fails the moment a
 * new table appears without RLS rather than waiting for a security review.
 *
 * If a table genuinely should be readable through the Data API, enable RLS and
 * write a policy for it — deliberately — then add it to `INTENTIONALLY_PUBLIC`
 * with the reason.
 */

/** Tables deliberately exposed to the Data API. Empty by design. */
const INTENTIONALLY_PUBLIC: string[] = [];

const dbAvailable = await (async () => {
	try {
		await db.execute(sql`SELECT 1`);
		return true;
	} catch {
		console.warn("\n[rls] Postgres not reachable — skipping.\n");
		return false;
	}
})();

const maybe = () => (dbAvailable ? it : it.skip);

describe("row-level security", () => {
	maybe()("is enabled on every table in the public schema", async () => {
		const result = await db.execute<{ tablename: string }>(sql`
			SELECT c.relname AS tablename
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public'
			  AND c.relkind = 'r'
			  AND NOT c.relrowsecurity
			ORDER BY c.relname
		`);

		const unprotected = result.rows
			.map((r) => r.tablename)
			.filter((name) => !INTENTIONALLY_PUBLIC.includes(name));

		expect(
			unprotected,
			unprotected.length
				? `These tables have no row-level security, so on Supabase they are reachable ` +
					`through the Data API and bypass every check in this API:\n` +
					unprotected.map((t) => `  - ${t}`).join("\n") +
					`\n\nAdd a migration enabling RLS (see drizzle/0009_rls_sweep_all_tables.sql).`
				: "",
		).toEqual([]);
	});

	maybe()("does not grant the Data API roles access to application tables", async () => {
		// anon/authenticated only exist on Supabase; locally this is a no-op that
		// still documents the intent.
		const result = await db.execute<{ tablename: string; grantee: string }>(sql`
			SELECT table_name AS tablename, grantee
			FROM information_schema.role_table_grants
			WHERE table_schema = 'public'
			  AND grantee IN ('anon', 'authenticated')
			ORDER BY table_name, grantee
		`);

		expect(result.rows.map((r) => `${r.grantee} -> ${r.tablename}`)).toEqual([]);
	});
});
