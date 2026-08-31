/**
 * Permanently delete all case data from the database.
 *
 * This removes:
 *   - case_comments
 *   - applicants (CASCADE deletes consultations, applications, school_applications)
 *
 * It intentionally leaves alone:
 *   - users (applicant login accounts)
 *   - ops_users / ops_roles (staff)
 *   - bookings (calendar events can be cleaned separately)
 *   - invoices, payments, platform_settings, catalogs
 *
 * Usage:
 *   npx tsx src/scripts/clear-cases.ts --env .env.production
 *   npx tsx src/scripts/clear-cases.ts --env .env.production --force
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql, count } from "drizzle-orm";
import * as schema from "../db/schema.js";

function parseArgs(argv: string[]) {
	let envFile = ".env.production";
	let force = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--env" || arg === "-e") {
			const next = argv[i + 1];
			if (!next) {
				console.error(`${arg} requires a file path`);
				process.exit(2);
			}
			envFile = next;
			i++;
		} else if (arg === "--force" || arg === "-f") {
			force = true;
		} else if (arg === "--help" || arg === "-h") {
			console.log(
				[
					"Usage: npx tsx src/scripts/clear-cases.ts [--env <file>] [--force]",
					"",
					"Options:",
					"  --env <file>   Load environment from this file (default: .env.production)",
					"  --force        Skip the interactive confirmation prompt",
					"",
					"Destroys all case data: applicants, consultations, applications,",
					"school_applications and case_comments. This cannot be undone.",
				].join("\n"),
			);
			process.exit(0);
		}
	}
	return { envFile, force };
}

async function confirm(message: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await new Promise((resolve) => {
			rl.question(message, (answer) => {
				resolve(answer.trim().toLowerCase() === "yes");
			});
		});
	} finally {
		rl.close();
	}
}

async function main() {
	const { envFile, force } = parseArgs(process.argv.slice(2));

	const loaded = config({ path: resolve(envFile) });
	if (loaded.error) {
		console.error(`Failed to load env file ${envFile}:`, loaded.error.message);
		process.exit(2);
	}
	if (!process.env.DATABASE_URL) {
		console.error(`DATABASE_URL is not set in ${envFile}`);
		process.exit(2);
	}

	const url = process.env.DATABASE_URL;
	const isSupabase = /\.supabase\.(co|com)/.test(url);
	if (isSupabase && /:6543(\/|\?|$)/.test(url)) {
		console.error(
			"DATABASE_URL points at Supabase's transaction pooler (port 6543). Use the session pooler (port 5432).",
		);
		process.exit(2);
	}

	const pool = new Pool({
		connectionString: url,
		ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
		max: 2,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
	});

	const {
		caseComments,
		applicants,
		consultations,
		applications,
		schoolApplications,
	} = schema;
	const db = drizzle(pool, { schema });

	const tables = [
		{ name: "case_comments", table: caseComments },
		{ name: "applicants", table: applicants },
		{ name: "consultations", table: consultations },
		{ name: "applications", table: applications },
		{ name: "school_applications", table: schoolApplications },
	];

	async function rowCount(name: string, table: any) {
		try {
			const rows = await db.select({ c: count() }).from(table);
			return rows[0]?.c ?? 0;
		} catch (err) {
			console.error(`  Could not count ${name}:`, err instanceof Error ? err.message : err);
			return "?";
		}
	}

	console.log("Database:", process.env.DATABASE_URL.replace(/:[^:@/]*@/, ":***@"));
	console.log("\nRows before cleanup:");
	for (const { name, table } of tables) {
		console.log(`  ${name}: ${await rowCount(name, table)}`);
	}

	if (!force) {
		const ok = await confirm(
			"\nThis will permanently delete all case data (applicants, consultations, applications, " +
			"school_applications, case_comments).\nType 'yes' to continue: ",
		);
		if (!ok) {
			console.log("Aborted. No rows were deleted.");
			await pool.end();
			process.exit(0);
		}
	}

	console.log("\nDeleting...");
	await db.execute(sql`TRUNCATE TABLE ${caseComments} CASCADE`);
	await db.execute(sql`TRUNCATE TABLE ${applicants} CASCADE`);

	console.log("\nRows after cleanup:");
	for (const { name, table } of tables) {
		console.log(`  ${name}: ${await rowCount(name, table)}`);
	}

	await pool.end();
	console.log("\nDone.");
}

main().catch(async (err) => {
	console.error("\nFailed to clear cases:", err instanceof Error ? err.message : err);
	process.exit(1);
});
