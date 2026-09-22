import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function cols(t: string) {
	const r = await pool.query(
		`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
		[t],
	);
	return r.rows.map((x) => x.column_name);
}

async function main() {
	const sc = await cols("sessions");
	const uc = await cols("users");
	const oc = await cols("ops_users");
	console.log("sessions cols:", sc.join(","));
	console.log("\nusers cols:", uc.join(","));
	console.log("\nops_users cols:", oc.join(","));

	const sessCols = await pool.query(
		`SELECT s.id, s.user_id, s.created_at, s.expires_at,
		        u.email, u.two_factor_enabled, u.mfa_enrolled, u.mfa_method, u.banned
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 ORDER BY s.created_at DESC LIMIT 12`,
	);
	console.log("\n=== latest sessions ===");
	for (const s of sessCols.rows) {
		console.log(
			`  ${s.created_at?.toISOString?.() ?? s.created_at} user=${s.user_id.slice(0, 10)}… email=${s.email} ` +
			`totp=${s.two_factor_enabled} mfaEnrolled=${s.mfa_enrolled} mfaMethod=${s.mfa_method} banned=${s.banned} ` +
			`expired=${new Date(s.expires_at) < new Date()}`,
		);
	}

	const ops = await pool.query(
		`SELECT o.id, o.user_id, o.email, o.name, o.role, o.active FROM ops_users o ORDER BY o.created_at`,
	);
	console.log("\n=== ops_users ===");
	for (const o of ops.rows) {
		console.log(`  ${o.email} role=${o.role} active=${o.active} user_id=${o.user_id ?? "NULL"}`);
	}

	const refCol = await pool.query(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema='public' AND table_name='conversations' AND column_name='reference'`,
	);
	console.log(`\n=== conversations.reference exists: ${refCol.rowCount ? "YES" : "NO"} ===`);

	const live = await pool.query(`SELECT count(*)::int AS n FROM sessions WHERE expires_at > now()`);
	console.log(`=== live sessions: ${live.rows[0].n} ===`);

	await pool.end();
}

main().catch((e) => {
	console.error(e.message ?? e);
	process.exit(1);
});
