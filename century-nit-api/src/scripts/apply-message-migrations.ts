/**
 * One-off script to apply migrations 0034 and 0035 directly and record
 * them in the Drizzle journal. The journal is out of sync with the DB
 * (older migrations were applied manually), so `drizzle-kit migrate`
 * fails trying to re-create tables that already exist.
 *
 * Usage: npx tsx src/scripts/apply-message-migrations.ts --env .env.supabase
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path: string) {
	const content = readFileSync(resolve(process.cwd(), path), "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
	}
}

const envFile = process.argv.includes("--env")
	? process.argv[process.argv.indexOf("--env") + 1]
	: ".env";

try {
	loadEnv(envFile);
} catch {
	console.error(`Could not load env file: ${envFile}`);
	process.exit(1);
}

const url =
	process.env.DATABASE_URL_MIGRATIONS ||
	process.env.DATABASE_URL ||
	process.env.DIRECT_URL;

if (!url) {
	console.error("No DATABASE_URL_MIGRATIONS or DATABASE_URL found in env");
	process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

const MIGRATION_0034 = readFileSync(
	resolve(__dirname, "../../drizzle/0034_cloudy_wasp.sql"),
	"utf-8",
);
const MIGRATION_0035 = readFileSync(
	resolve(__dirname, "../../drizzle/0035_sour_jane_foster.sql"),
	"utf-8",
);

/** Split on `--> statement-breakpoint` so each statement runs separately. */
function splitStatements(sql: string): string[] {
	return sql
		.split("--> statement-breakpoint")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

async function columnExists(client: pg.PoolClient, table: string, column: string): Promise<boolean> {
	const res = await client.query(
		`SELECT 1 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
		[table, column],
	);
	return res.rows.length > 0;
}

async function tableExists(client: pg.PoolClient, table: string): Promise<boolean> {
	const res = await client.query(
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_name = $1`,
		[table],
	);
	return res.rows.length > 0;
}

async function recordMigration(client: pg.PoolClient, tag: string, when: number) {
	await client.query(
		`INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
		 VALUES ($1, $2)`,
		[tag, when],
	);
}

async function migrationRecorded(client: pg.PoolClient, tag: string): Promise<boolean> {
	const res = await client.query(
		`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1`,
		[tag],
	);
	return res.rows.length > 0;
}

async function main() {
	const client = await pool.connect();
	try {
		// Ensure the journal table and schema exist
		await client.query(`
			CREATE SCHEMA IF NOT EXISTS drizzle;
			CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
				id SERIAL PRIMARY KEY,
				hash TEXT NOT NULL,
				created_at BIGINT NOT NULL
			);
		`);

		// ── First, backfill journal entries for already-applied migrations ──
		// The DB has all tables through 0033, but the journal may be missing entries.
		// We check each one and record it if the schema object exists.

		const journalText = readFileSync(
			resolve(__dirname, "../../drizzle/meta/_journal.json"),
			"utf-8",
		);
		const journal = JSON.parse(journalText);

		const JOURNAL_ENTRIES: { tag: string; when: number }[] = journal.entries.map(
			(e: { tag: string; when: number }) => ({ tag: e.tag, when: e.when }),
		);

		// We only need to backfill entries up to 0033 (0034+ we'll apply ourselves).
		// For each entry, if the hash is not in the journal table, check if the
		// migration's effects are present and record it.
		let backfilled = 0;
		for (const entry of JOURNAL_ENTRIES) {
			if (entry.tag >= "0034") continue; // skip, we'll handle these below

			const already = await migrationRecorded(client, entry.tag);
			if (already) continue;

			// Just record it — we know these tables exist (the error was on 0021
			// "already exists", proving the DB has these tables).
			await recordMigration(client, entry.tag, entry.when);
			backfilled++;
			console.log(`  backfilled: ${entry.tag}`);
		}
		if (backfilled > 0) console.log(`Backfilled ${backfilled} missing journal entries`);

		// ── Apply 0034 ──
		const hasForwardedFromId = await columnExists(client, "messages", "forwarded_from_id");
		if (!hasForwardedFromId) {
			console.log("Applying 0034_cloudy_wasp...");
			for (const stmt of splitStatements(MIGRATION_0034)) {
				await client.query(stmt);
			}
			console.log("  0034 applied successfully");
		} else {
			console.log("0034 already applied (forwarded_from_id column exists)");
		}

		if (!(await migrationRecorded(client, "0034_cloudy_wasp"))) {
			await recordMigration(client, "0034_cloudy_wasp", 1787223255463);
		}

		// ── Apply 0035 ──
		const hasUploadedByOpsUserId = await columnExists(client, "message_attachments", "uploaded_by_ops_user_id");
		if (!hasUploadedByOpsUserId) {
			console.log("Applying 0035_sour_jane_foster...");
			for (const stmt of splitStatements(MIGRATION_0035)) {
				await client.query(stmt);
			}
			console.log("  0035 applied successfully");
		} else {
			console.log("0035 already applied (uploaded_by_ops_user_id column exists)");
		}

		if (!(await migrationRecorded(client, "0035_sour_jane_foster"))) {
			await recordMigration(client, "0035_sour_jane_foster", 1787224667803);
		}

		console.log("\nDone. Message feature migrations are now applied.");
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
