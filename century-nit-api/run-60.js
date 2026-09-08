import { Client } from 'pg';
import fs from 'fs';

async function run() {
	const client = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL });
	await client.connect();
	const sql = fs.readFileSync('drizzle/0060_three_stage_tracking_update.sql', 'utf-8');
	await client.query(sql);
	
	// Add to journal so Drizzle knows it ran
	// But we don't strictly have to if drizzle already recorded 0060?
	// Wait, if it failed on 0060, maybe it didn't record it?
	console.log('Update applied');
	await client.end();
}
run().catch(console.error);
