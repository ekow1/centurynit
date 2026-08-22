/**
 * Check whether Google Calendar credentials are stored in the DB and
 * readable by the API. Run: npx tsx src/scripts/check-calendar-config.ts --env .env.supabase
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

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

try { loadEnv(envFile); } catch { console.error(`Could not load env: ${envFile}`); process.exit(1); }

const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!url) { console.error("No DB URL"); process.exit(1); }

const pool = new pg.Pool({ connectionString: url });

async function main() {
	const client = await pool.connect();
	try {
		const res = await client.query(
			`SELECT key, value FROM platform_settings WHERE key IN ($1, $2, $3)`,
			["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
		);

		console.log("=== Google Calendar Settings in DB ===\n");
		for (const row of res.rows) {
			const display = row.key === "GOOGLE_CLIENT_SECRET"
				? row.value ? `${row.value.slice(0, 4)}****${row.value.slice(-4)} (${row.value.length} chars)` : "(empty)"
				: row.value;
			console.log(`  ${row.key}: ${display}`);
		}

		const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]
			.filter(k => !res.rows.find(r => r.key === k));
		if (missing.length > 0) {
			console.log(`\n  MISSING: ${missing.join(", ")}`);
		}

		console.log(`\ngoogleConfigured() would return: ${
			res.rows.length === 3 && res.rows.every(r => r.value) ? "true" : "false"
		}`);

		const redirect = res.rows.find(r => r.key === "GOOGLE_REDIRECT_URI");
		if (redirect) {
			console.log(`\nRedirect URI: ${redirect.value}`);
			console.log(`  Expected:   https://api.softclicksolutions.com/api/v1/calendar/callback`);
			console.log(`  Match: ${redirect.value === "https://api.softclicksolutions.com/api/v1/calendar/callback" ? "YES" : "NO"}`);
		}
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch(err => { console.error(err); process.exit(1); });
