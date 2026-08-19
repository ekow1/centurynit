import { Pool } from "pg";

const pool = new Pool({
	connectionString:
		"postgresql://postgres.bkajqyhkpxhapvgqxzwp:centurynitPortal26@aws-1-eu-west-3.pooler.supabase.com:5432/postgres",
});

async function main() {
	// Add "chat" to all roles that don't already have it
	const rows = await pool.query(`SELECT id, permissions FROM ops_roles`);
	for (const row of rows.rows) {
		const perms: string[] = row.permissions || [];
		if (!perms.includes("chat")) {
			perms.push("chat");
			await pool.query(`UPDATE ops_roles SET permissions = $1 WHERE id = $2`, [
				JSON.stringify(perms),
				row.id,
			]);
			console.log(`Updated ${row.id}: added "chat" (${perms.length} total perms)`);
		} else {
			console.log(`${row.id}: already has "chat"`);
		}
	}
	await pool.end();
	console.log("Done.");
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
