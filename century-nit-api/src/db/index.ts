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
 * 3. Pooling mode. See the note on `usesTransactionPooler` below — this is the
 *    one that silently breaks transactions if you get it wrong.
 */

const url = env.DATABASE_URL;

function isSupabase(connectionString: string): boolean {
	return /\.supabase\.(co|com)/.test(connectionString);
}

/**
 * Supabase offers the same database on three ports, and they are not
 * interchangeable:
 *
 *   5432 direct         — full Postgres. Required for migrations (DDL, CREATE
 *                         EXTENSION, advisory locks).
 *   5432 session pooler — one server connection per client connection. Safe for
 *                         everything this API does, including transactions.
 *   6543 transaction    — a server connection per *statement*. Cheap and highly
 *                         concurrent, but a multi-statement transaction can be
 *                         split across different backends, which quietly breaks
 *                         the atomicity this codebase depends on: booking
 *                         creation, invoice writes and `setWorkingHours` are all
 *                         `db.transaction`, and §11's double-booking guard
 *                         assumes the insert and its constraint check are one
 *                         unit.
 *
 * So the transaction pooler is refused rather than tolerated. Failing at startup
 * with an explanation beats a race that appears only under load.
 */
function usesTransactionPooler(connectionString: string): boolean {
	return isSupabase(connectionString) && /:6543(\/|\?|$)/.test(connectionString);
}

if (usesTransactionPooler(url)) {
	console.error(
		"\nDATABASE_URL points at Supabase's transaction pooler (port 6543).\n" +
			"This API runs multi-statement transactions, which that pooler can split\n" +
			"across backends — booking and invoice writes would lose atomicity.\n\n" +
			"Use the session pooler or the direct connection (port 5432) instead.\n",
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
