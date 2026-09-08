import { Client } from 'pg';
import fs from 'fs';

async function run() {
	const client = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL });
	await client.connect();
	
	console.log('Running 0059...');
	const sql59 = fs.readFileSync('drizzle/0059_three_stage_tracking.sql', 'utf-8');
	const statements59 = sql59.split('--> statement-breakpoint').map(s => s.trim()).filter(s => s);
	for (const stmt of statements59) {
		try {
			await client.query(stmt);
		} catch (err) {
			console.log('Error in 59 stmt (might be expected if already exists):', err.message);
		}
	}
	
	console.log('Running 0060...');
	const sql60 = fs.readFileSync('drizzle/0060_three_stage_tracking_update.sql', 'utf-8');
	const statements60 = sql60.split('--> statement-breakpoint').map(s => s.trim()).filter(s => s);
	for (const stmt of statements60) {
		try {
			await client.query(stmt);
		} catch (err) {
			console.log('Error in 60 stmt:', err.message);
		}
	}
	
	// Record in drizzle journal table to prevent drizzle from complaining later
	// The table is "drizzle"."__drizzle_migrations"
	try {
		await client.query(`
			INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
			VALUES ('three_stage_tracking', extract(epoch from now()) * 1000)
			ON CONFLICT DO NOTHING;
		`);
	} catch(err) {
		console.log('Could not update metadata:', err.message);
	}

	console.log('Done!');
	await client.end();
}
run().catch(console.error);
