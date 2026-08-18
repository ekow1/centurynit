import fs from 'fs';
import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function run() {
    const migration = fs.readFileSync('drizzle/0023_curved_lilith.sql', 'utf8');
    // Split by statement-breakpoint
    const queries = migration.split('--> statement-breakpoint');
    for (const q of queries) {
        if (q.trim()) {
            await db.execute(sql.raw(q));
            console.log('Executed:', q.slice(0, 50).trim() + '...');
        }
    }
    console.log('Done!');
    process.exit(0);
}
run().catch(console.error);
