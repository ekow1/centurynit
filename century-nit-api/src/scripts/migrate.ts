/**
 * Run Drizzle migrations against the Supabase session pooler.
 *
 * Why this script exists:
 *   - `drizzle.config.ts` reads `process.env.DATABASE_URL` at load time.
 *   - The credential lives in `.env.supabase` (gitignored), not in the shell.
 *   - We must refuse the transaction pooler (:6543) for the same reason the
 *     runtime does: drizzle-kit's migrator takes a session-scoped
 *     `pg_advisory_lock`, which the transaction pooler drops between
 *     transactions. Session mode (:5432 on the pooler) holds one backend per
 *     client connection, so the lock survives.
 *
 * Usage:
 *   npx tsx src/scripts/migrate.ts
 *   npx tsx src/scripts/migrate.ts --env .env.production
 *
 * Reads DATABASE_URL_MIGRATIONS (preferred) or DATABASE_URL from the env file
 * and/or process.env. A separate migrations URL lets the runtime use the
 * session pooler while migrations use the direct connection, or just keeps
 * the two concerns from sharing one variable.
 *
 * Exits non-zero if no URL is found or it points at :6543, so this is safe
 * to wire into CI or a deploy hook.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Args = { envFile: string };

function parseArgs(argv: string[]): Args {
	const args: Args = { envFile: ".env.supabase" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--env" || a === "-e") {
			const next = argv[i + 1];
			if (!next) {
				console.error(`${a} requires a file path`);
				process.exit(2);
			}
			args.envFile = next;
			i++;
		} else if (a === "--help" || a === "-h") {
			console.log(
				[
					"Usage: npx tsx src/scripts/migrate.ts [--env <file>]",
					"",
					"Loads DATABASE_URL from the given .env file (default .env.supabase) and",
					"runs drizzle-kit migrate. Refuses the transaction pooler (:6543).",
				].join("\n"),
			);
			process.exit(0);
		} else {
			console.error(`Unknown argument: ${a}`);
			process.exit(2);
		}
	}
	return args;
}

/** Minimal .env parser — enough for KEY=value lines and # comments. */
function loadEnvFile(path: string): Record<string, string> {
	const abs = resolve(process.cwd(), path);
	if (!existsSync(abs)) {
		console.error(`[migrate] env file not found: ${abs}`);
		process.exit(2);
	}
	const out: Record<string, string> = {};
	for (const line of readFileSync(abs, "utf8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		// Strip surrounding quotes if present.
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

function assertSessionPooler(url: string): void {
	const isSupabase = /\.supabase\.(co|com)/.test(url);
	const isTxPooler = isSupabase && /:6543(\/|\?|$)/.test(url);
	if (isTxPooler) {
		console.error(
			[
				"",
				"[migrate] DATABASE_URL points at Supabase's transaction pooler (port 6543).",
				"",
				"drizzle-kit migrate takes a session-scoped pg_advisory_lock to serialise",
				"concurrent deploys. The transaction pooler drops session state between",
				"transactions, so the lock cannot survive — migrations are unreliable.",
				"",
				"Use the session pooler. Same host, port 5432:",
				"  ...pooler.supabase.com:6543  ->  ...pooler.supabase.com:5432",
				"",
			].join("\n"),
		);
		process.exit(1);
	}
}

const args = parseArgs(process.argv.slice(2));
const env = loadEnvFile(args.envFile);

const dbUrl = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL ?? env.DATABASE_URL_MIGRATIONS ?? env.DATABASE_URL;
if (!dbUrl) {
	console.error(
		`[migrate] No database URL found. Checked process.env.DATABASE_URL_MIGRATIONS, ` +
			`process.env.DATABASE_URL, and ${args.envFile} for DATABASE_URL_MIGRATIONS / DATABASE_URL.`,
	);
	process.exit(1);
}

assertSessionPooler(dbUrl);

// Hand the URL to drizzle-kit via the environment so drizzle.config.ts picks it up.
process.env.DATABASE_URL = dbUrl;

console.log(`[migrate] running drizzle-kit migrate (env: ${args.envFile})`);
const result = spawnSync("npx", ["drizzle-kit", "migrate"], {
	stdio: "inherit",
	shell: process.platform === "win32",
	env: process.env,
});

if (result.status !== 0) {
	console.error(`[migrate] drizzle-kit exited with status ${result.status}`);
	process.exit(result.status ?? 1);
}
console.log("[migrate] done");
