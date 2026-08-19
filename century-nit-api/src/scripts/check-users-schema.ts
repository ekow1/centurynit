import { Pool } from "pg";

const pool = new Pool({
	connectionString:
		"postgresql://postgres.bkajqyhkpxhapvgqxzwp:centurynitPortal26@aws-1-eu-west-3.pooler.supabase.com:5432/postgres",
});

async function main() {
	const cols = await pool.query(
		`SELECT column_name, data_type, is_nullable
		 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = 'users'
		 ORDER BY ordinal_position`,
	);
	console.log("=== users columns ===");
	cols.rows.forEach((c) =>
		console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable === "YES" ? "NULL" : "NOT NULL"}`),
	);

	const opsCols = await pool.query(
		`SELECT column_name, data_type, is_nullable
		 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = 'ops_users'
		 ORDER BY ordinal_position`,
	);
	console.log("\n=== ops_users columns ===");
	opsCols.rows.forEach((c) =>
		console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable === "YES" ? "NULL" : "NOT NULL"}`),
	);

	await pool.end();
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
