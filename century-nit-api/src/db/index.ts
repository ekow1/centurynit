import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";
import { env } from "../env.js";

/**
 * Database connection.
 *
 * Works against a local Postgres (docker-compose) and against Supabase, which
 * is Postgres too — the schema, migrations and Drizzle code are unchanged. Only
 * three things differ, and all three are handled here:
 *
 * 1. TLS. Supabase requires it. The certificate is issued to the pooler host
 *    rather than the project host, so verification is relaxed — this protects
 *    the connection in transit without pretending to pin an identity that does
 *    not match. Anything not obviously Supabase keeps whatever the URL asked for.
 *
 * 2. Pool size. Supabase caps connections per project, and the cap is small on
 *    the lower tiers. Two processes connect (the API and the worker), so each
 *    takes a modest slice rather than the driver's default of 10.
 *
 * 3. Pooling mode. See the note on `usesTransactionPooler` below — session mode
 *    is required because migrations rely on a session-scoped advisory lock.
 */

const url = env.DATABASE_URL;

function isSupabase(connectionString: string): boolean {
	return /\.supabase\.(co|com)/.test(connectionString);
}

/**
 * Supabase serves the same database three ways, and they are not equivalent:
 *
 *   :5432 direct        — full Postgres, but IPv6-only without the paid add-on.
 *   :5432 session pool  — IPv4. One server connection per client connection.
 *   :6543 transaction   — IPv4. One server connection per *transaction*.
 *
 * Transaction mode does hold a transaction on a single backend, so BEGIN…COMMIT
 * stays atomic and ordinary reads and writes here would work. What it drops is
 * session-scoped state, and that is what makes it wrong for this process:
 *
 *   - `drizzle-kit migrate` takes a session-scoped `pg_advisory_lock` to
 *     serialise concurrent deploys. That lock cannot outlive a transaction under
 *     transaction pooling, so migrations are unreliable against :6543 —
 *     and 0001 also runs CREATE EXTENSION btree_gist.
 *   - Named prepared statements are per-backend, the long-standing footgun of
 *     transaction pooling.
 *
 * Supabase's own guidance says the same: transaction mode for serverless and
 * short-lived clients, session mode for persistent servers. This is a persistent
 * server holding a connection pool, so it wants session mode — equally IPv4,
 * differing only in the port.
 */
function usesTransactionPooler(connectionString: string): boolean {
	return isSupabase(connectionString) && /:6543(\/|\?|$)/.test(connectionString);
}

if (usesTransactionPooler(url)) {
	console.error(
		[
			"",
			"DATABASE_URL points at Supabase's transaction pooler (port 6543).",
			"",
			"That mode drops session-scoped state, which this process needs:",
			"drizzle-kit's migration advisory lock cannot survive it, and named",
			"prepared statements are per-backend. Supabase recommends transaction",
			"mode for serverless clients and session mode for persistent servers —",
			"this is a persistent server with a connection pool.",
			"",
			"Use the session pooler. It is equally IPv4; only the port differs:",
			"  ...pooler.supabase.com:6543  ->  ...pooler.supabase.com:5432",
			"",
		].join("\n"),
	);
	process.exit(1);
}

const pool = new Pool({
	connectionString: url,
	/*
	 * `rejectUnauthorized: false` encrypts the connection but does not verify the
	 * certificate chain, because Supabase's pooler presents a certificate for its
	 * own hostname. To verify properly, download the project CA certificate and
	 * pass it as `ssl: { ca }` — worth doing for production if the CA is to hand.
	 */
	ssl: isSupabase(url) ? { rejectUnauthorized: false } : undefined,
	max: isSupabase(url) ? 5 : 10,
	// Return a connection to the pool rather than holding it open indefinitely;
	// Supabase counts idle connections against the project limit.
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 10_000,
});

// A pool error with no listener is an unhandled 'error' event, which takes the
// process down. Supabase closes idle connections, so this is routine, not fatal.
pool.on("error", (err) => {
	console.error("[db] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });

/** Close the pool on shutdown so the worker and API release their connections. */
export async function closeDb(): Promise<void> {
	await pool.end();
}
