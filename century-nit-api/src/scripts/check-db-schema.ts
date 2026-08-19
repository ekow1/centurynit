import { Pool } from "pg";

const pool = new Pool({
	connectionString:
		"postgresql://postgres.bkajqyhkpxhapvgqxzwp:centurynitPortal26@aws-1-eu-west-3.pooler.supabase.com:5432/postgres",
});

async function main() {
	// List all enum types
	const enums = await pool.query(
		`SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) as values
		 FROM pg_type t
		 JOIN pg_enum e ON t.oid = e.enumtypid
		 WHERE t.typtype = 'e'
		 GROUP BY t.typname
		 ORDER BY t.typname`,
	);
	console.log("=== ENUMS ===");
	enums.rows.forEach((r) => console.log(`  ${r.typname}: ${JSON.stringify(r.values)}`));

	// Check columns on key tables
	const tables = [
		"conversations",
		"messages",
		"conversation_participants",
		"communication_events",
		"staff_presence",
		"stage_assignments",
		"notification_preferences",
	];
	for (const t of tables) {
		const cols = await pool.query(
			`SELECT column_name, data_type, is_nullable
			 FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = $1
			 ORDER BY ordinal_position`,
			[t],
		);
		console.log(`\n=== ${t} (${cols.rows.length} cols) ===`);
		cols.rows.forEach((c) =>
			console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable === "YES" ? "NULL" : "NOT NULL"}`),
		);
	}

	await pool.end();
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
