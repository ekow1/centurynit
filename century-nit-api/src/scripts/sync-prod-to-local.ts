/**
 * Copy every row in the prod `public` schema into the local dev database.
 *
 *   npx tsx src/scripts/sync-prod-to-local.ts
 *
 * Reads DATABASE_URL from .env.production (prod, source) and writes to
 * postgres://century:century@localhost:5433/century_nit (target). Local schema
 * must already exist — run `npm run db:fresh` first. All local rows in public
 * tables are wiped first (local data is disposable per README).
 *
 * Foreign keys are bypassed during the copy via session_replication_role
 * (the `century` user is the DB superuser), so table order doesn't matter.
 * Serial sequences are re-seeded to max(id) afterwards.
 */

import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.production" });

const PROD = process.env.DATABASE_URL;
const LOCAL = "postgres://century:century@localhost:5433/century_nit";
if (!PROD || PROD.includes("[")) {
	console.error("DATABASE_URL in .env.production is missing or a placeholder.");
	process.exit(1);
}

const BATCH = 500;

async function main() {
	const prod = new Client({ connectionString: PROD, ssl: { rejectUnauthorized: false } });
	const local = new Client({ connectionString: LOCAL });
	await prod.connect();
	await local.connect();
	console.log("connected — prod:", new URL(PROD).host, "→ local:", new URL(LOCAL).host);

	const { rows: tables } = await prod.query<{ tablename: string }>(
		`select tablename from pg_tables where schemaname = 'public' order by tablename`,
	);
	const { rows: localTables } = await local.query<{ tablename: string }>(
		`select tablename from pg_tables where schemaname = 'public'`,
	);
	const localSet = new Set(localTables.map((t) => t.tablename));
	const skipped = tables.map((t) => t.tablename).filter((n) => !localSet.has(n));
	if (skipped.length) console.log(`skipping ${skipped.length} prod-only tables: ${skipped.join(", ")}`);
	const names = tables.map((t) => t.tablename).filter((n) => localSet.has(n));
	console.log(`${names.length} tables to copy`);

	// Wipe + disable FK triggers for the duration of the copy.
	await local.query("set session_replication_role = 'replica'");
	await local.query(
		`truncate table ${names.map((n) => `"public"."${n}"`).join(", ")} restart identity cascade`,
	);

	for (const t of names) {
		const { rows: cols } = await prod.query<{ column_name: string; data_type: string }>(
			`select column_name, data_type from information_schema.columns
			 where table_schema = 'public' and table_name = $1 order by ordinal_position`,
			[t],
		);
		const colNames = cols.map((c) => c.column_name);
		const colList = colNames.map((c) => `"${c}"`).join(", ");
		const { rows } = await prod.query(`select ${colList} from "public"."${t}"`);
		if (rows.length === 0) continue;

		for (let i = 0; i < rows.length; i += BATCH) {
			const chunk = rows.slice(i, i + BATCH);
			const values: unknown[] = [];
			const tuples = chunk.map((row, r) => {
				const ph = cols
					.map((col, cIdx) => {
						const p = `$${r * cols.length + cIdx + 1}`;
						return col.data_type === "json" || col.data_type === "jsonb" ? `${p}::${col.data_type}` : p;
					})
					.join(", ");
				for (const col of cols) {
					const v = row[col.column_name];
					values.push(
						(col.data_type === "json" || col.data_type === "jsonb") && v != null
							? JSON.stringify(v)
							: v,
					);
				}
				return `(${ph})`;
			});
			await local.query(`insert into "public"."${t}" (${colList}) values ${tuples.join(", ")}`, values);
		}
		console.log(`  ${t}: ${rows.length} rows`);
	}

	// Re-seed serial sequences to max(id) so future inserts don't collide.
	const { rows: seqs } = await local.query<{ seq: string; tbl: string; col: string }>(
		`select pg_get_serial_sequence(format('%I.%I', t.table_schema, t.table_name), t.column_name) as seq,
		        t.table_name as tbl, t.column_name as col
		   from information_schema.columns t
		  where t.table_schema = 'public' and t.column_default like 'nextval%'`,
	);
	for (const s of seqs) {
		if (!s.seq) continue;
		await local.query(
			`select setval('${s.seq}', coalesce((select max("${s.col}") from "public"."${s.tbl}"), 0) + 1, false)`,
		);
	}
	if (seqs.length) console.log(`re-seeded ${seqs.length} sequences`);

	await local.query("set session_replication_role = 'origin'");
	await prod.end();
	await local.end();
	console.log("Done — local DB now mirrors prod public schema.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
