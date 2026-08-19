import { Pool } from "pg";

const pool = new Pool({
	connectionString:
		"postgresql://postgres.bkajqyhkpxhapvgqxzwp:centurynitPortal26@aws-1-eu-west-3.pooler.supabase.com:5432/postgres",
});

async function main() {
	// Check ops_users roles and active status
	const users = await pool.query(
		`SELECT id, email, name, role, active, branch FROM ops_users ORDER BY name`,
	);
	console.log("=== ops_users ===");
	users.rows.forEach((r) => console.log(`  ${r.name} (${r.email}): role=${r.role} active=${r.active} branch=${r.branch}`));

	// Check ops_roles
	const roles = await pool.query(
		`SELECT id, name, is_system, permissions FROM ops_roles ORDER BY id`,
	);
	console.log("\n=== ops_roles ===");
	roles.rows.forEach((r) => console.log(`  ${r.id} (${r.name}): system=${r.is_system} perms=${JSON.stringify(r.permissions)}`));

	await pool.end();
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
