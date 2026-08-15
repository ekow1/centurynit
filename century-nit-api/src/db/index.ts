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

/**
 * What the connection string says, minus the password.
 *
 * When authentication fails, the useful question is "which user, against which
 * host?" — and that is exactly what nobody can read off a URL held in a
 * deployment platform's secret field.
 */
function describeTarget(connectionString: string): string {
	try {
		const parsed = new URL(connectionString);
		return `${parsed.username || "(no user)"}@${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
	} catch {
		return "(DATABASE_URL is not a valid URL)";
	}
}

/**
 * A description of a connection failure that is never blank.
 *
 * A refused connection reaches us as an AggregateError with an empty `message`
 * and the real detail in `errors`, so the obvious `err.message` renders as
 * nothing at all — the one line meant to explain the failure explaining
 * nothing.
 */
function describeError(err: unknown): string {
	if (err instanceof AggregateError && err.errors.length > 0) {
		const inner = err.errors
			.map((e) => (e instanceof Error ? e.message : String(e)))
			.filter(Boolean);
		if (inner.length > 0) return [...new Set(inner)].join("; ");
	}
	const message = err instanceof Error ? err.message : String(err);
	if (message) return message;
	const code = (err as { code?: string }).code;
	return code ? `connection failed (${code})` : "connection failed";
}

/**
 * Prove the database is reachable before the process starts serving.
 *
 * Without this, a wrong password produces a container that starts cleanly,
 * passes its health check, accepts traffic, and fails on the first request that
 * touches Postgres — surfacing as a 500 with a masked message, which is the
 * least informative thing the stack can say. The credential was wrong the whole
 * time; nothing looked until a person clicked something.
 *
 * Retried a few times because a database can be slower to accept connections
 * than a container is to boot, and a deploy should not fail over a few seconds.
 * An authentication failure is not retried: the password will not become correct
 * on the third attempt, and repeating it only delays the error.
 */
export async function assertDatabaseReachable(attempts = 5): Promise<void> {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const client = await pool.connect();
			client.release();
			return;
		} catch (err) {
			const code = (err as { code?: string }).code;
			const message = describeError(err);
			const fatal = code === "28P01" || code === "28000" || code === "3D000";

			if (!fatal && attempt < attempts) {
				console.warn(
					`[db] not reachable (attempt ${attempt}/${attempts}): ${message} — retrying`,
				);
				await new Promise((resolve) => setTimeout(resolve, 2000));
				continue;
			}

			console.error(
				[
					"",
					"Cannot connect to the database. The server will not start.",
					"",
					`  target: ${describeTarget(url)}`,
					`  error:  ${message}${code ? ` (${code})` : ""}`,
					"",
				].join("\n"),
			);

			if (code === "28P01") {
				console.error(
					[
						"28P01 means Postgres rejected the credentials. On Supabase this is",
						"almost always one of three things:",
						"",
						"  1. The pooler needs a project-qualified username. Against",
						"     *.pooler.supabase.com the user must be `postgres.<project-ref>`,",
						"     not plain `postgres`. Plain `postgres` is only correct for the",
						"     direct db.<project-ref>.supabase.co host.",
						"",
						"  2. The password contains characters that must be percent-encoded",
						"     in a URL: @ : / ? # & all change how the string is parsed.",
						"     A password of `p@ss/word` has to be written `p%40ss%2Fword`.",
						"",
						"  3. The placeholder was never replaced, or the value was pasted",
						"     with surrounding quotes, which become part of the password.",
						"",
						"Reset the database password in the Supabase dashboard and copy the",
						"connection string it gives you rather than assembling one by hand.",
						"",
					].join("\n"),
				);
			}

			process.exit(1);
		}
	}
}

/** Close the pool on shutdown so the worker and API release their connections. */
export async function closeDb(): Promise<void> {
	await pool.end();
}
