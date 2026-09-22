import pg from "pg";
import { readFileSync } from "fs";

const env = Object.fromEntries(
	readFileSync(".env.production", "utf8").split("\n")
		.filter(l => l.includes("=") && !l.startsWith("#"))
		.map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const client = new pg.Client({ connectionString: env.DATABASE_URL || env.DATABASE_URL_MIGRATIONS });
await client.connect();

const { rows } = await client.query(`
	SELECT v.identifier, v.value, v.expires_at, v.created_at, u.email
	FROM verifications v
	LEFT JOIN users u ON v.identifier LIKE 'mfa-verify:%' AND v.identifier = 'mfa-verify:' || u.id
	WHERE v.identifier LIKE 'mfa-verify:%' OR v.identifier LIKE 'mfa-pending:%' OR v.identifier LIKE 'mfa-ok:%'
	ORDER BY v.created_at DESC NULLS LAST
	LIMIT 15
`);
for (const r of rows) console.log(JSON.stringify(r));

console.log("--- recent sessions ---");
const { rows: s } = await client.query(`
	SELECT s.token, s.created_at, u.email FROM sessions s
	JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 5
`);
for (const r of s) console.log(r.email, r.token.slice(0, 12), r.created_at);
await client.end();
