/**
 * Build a database from scratch — for CI and for a developer's first checkout.
 *
 *   DATABASE_URL=postgres://… npm run db:fresh --workspace=century-nit-api
 *
 * Why not `db:migrate`? The migration chain in `drizzle/` grew by hand and by
 * generator side by side, and its journal timestamps were edited so that
 * Drizzle would apply the right files on the *existing* databases. That worked
 * for them, but the chain no longer replays from zero: generated files
 * re-create objects the hand-written ones already made, and enum values are
 * added and used inside the single transaction Drizzle wraps a run in.
 * Existing databases must keep using `db:migrate`; a new one is built here from
 * `schema.ts`, which is what the code actually expects, plus the three things
 * the schema cannot express.
 *
 * Refuses to run against a database that already has tables.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..", "..");
const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL is required.");
	process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const existing = await client.query<{ n: string }>(
	`SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
	 WHERE n.nspname = 'public' AND c.relkind = 'r'`,
);
if (Number(existing.rows[0]?.n ?? 0) > 0) {
	console.error("db:fresh refuses to run: the public schema already has tables. Use db:migrate on an existing database.");
	await client.end();
	process.exit(1);
}

// 1. Extensions the schema depends on (the exclusion constraint below needs it).
await client.query(`CREATE EXTENSION IF NOT EXISTS "btree_gist"`);

// 2. The schema itself, straight from schema.ts.
const push = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["drizzle-kit", "push", "--force"], {
	cwd: apiRoot,
	stdio: "inherit",
	env: { ...process.env, DATABASE_URL: url },
	shell: process.platform === "win32",
});
if (push.status !== 0) {
	console.error("drizzle-kit push failed");
	await client.end();
	process.exit(push.status ?? 1);
}

// 3. What Drizzle cannot express.
//
// Double-booking prevention (drizzle/0002): one employee, no overlapping live
// bookings. The whole scheduling guarantee rests on this constraint.
await client.query(`
	ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_employee_overlap_excl";
	ALTER TABLE "bookings" ADD CONSTRAINT "bookings_employee_overlap_excl" EXCLUDE USING gist (
		employee_id WITH =,
		tstzrange(starts_at, ends_at, '[)') WITH &&
	) WHERE (
		employee_id IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW')
	);
`);

// Row-level security on every table (drizzle/0009): on Supabase the Data API
// can serve any public table to anon/authenticated, and the API is meant to be
// the only client. rls.test.ts asserts this holds.
await client.query(`
	DO $$
	DECLARE target record;
	BEGIN
		FOR target IN
			SELECT c.relname AS name FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
		LOOP
			EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.name);
			EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target.name);
			IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
				EXECUTE format('REVOKE ALL ON public.%I FROM anon', target.name);
			END IF;
			IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
				EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', target.name);
			END IF;
		END LOOP;
	END $$;
`);

// 4. Database logic that schema.ts cannot express and that lives only in a
// migration. Listed explicitly: each must be safe to run on an empty,
// freshly pushed schema (functions and triggers with CREATE OR REPLACE /
// DROP IF EXISTS).
const LOGIC_MIGRATIONS = ["0073_paid_flags_from_ledger"];
for (const tag of LOGIC_MIGRATIONS) {
	const sqlText = readFileSync(join(apiRoot, "drizzle", `${tag}.sql`), "utf8");
	for (const statement of sqlText.split("--> statement-breakpoint")) {
		if (statement.trim()) await client.query(statement);
	}
}

// 5. Stamp the journal so a later `db:migrate` on this database applies only
// migrations added after today, never the historical chain.
type Journal = { entries: { tag: string; when: number }[] };
const journal = JSON.parse(readFileSync(join(apiRoot, "drizzle", "meta", "_journal.json"), "utf8")) as Journal;
await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
await client.query(`
	CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
		id SERIAL PRIMARY KEY,
		hash text NOT NULL,
		created_at bigint
	)
`);
for (const entry of journal.entries) {
	const sqlText = readFileSync(join(apiRoot, "drizzle", `${entry.tag}.sql`), "utf8");
	const hash = createHash("sha256").update(sqlText).digest("hex");
	await client.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [hash, entry.when]);
}

await client.end();
console.log(`db:fresh done — schema pushed, constraints applied, ${journal.entries.length} migrations stamped.`);
