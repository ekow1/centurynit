import { Pool } from "pg";

const pool = new Pool({
	connectionString:
		"postgresql://postgres.bkajqyhkpxhapvgqxzwp:centurynitPortal26@aws-1-eu-west-3.pooler.supabase.com:5432/postgres",
});

async function main() {
	const r = await pool.query(
		`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
	);
	r.rows.forEach((row) => console.log(row.table_name));
	await pool.end();
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
