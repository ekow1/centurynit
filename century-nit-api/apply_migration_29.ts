import fs from 'fs';
import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function run() {
    console.log('--- Applying 0029_communication_system.sql ---');
    const m29 = fs.readFileSync('drizzle/0029_communication_system.sql', 'utf8');
    const q29 = m29.split('--> statement-breakpoint');
    for (const q of q29) {
        const trimmed = q.trim();
        if (!trimmed) continue;
        try {
            await db.execute(sql.raw(trimmed));
            console.log('SUCCESS:', trimmed.slice(0, 60).replace(/\s+/g, ' '));
        } catch (e: any) {
            console.log('SKIP/WARN:', trimmed.slice(0, 60).replace(/\s+/g, ' '), '->', e.message);
        }
    }

    console.log('\n--- Applying 0030_push_subscriptions.sql ---');
    const m30 = fs.readFileSync('drizzle/0030_push_subscriptions.sql', 'utf8');
    const q30 = m30.split(';');
    for (const q of q30) {
        const trimmed = q.trim();
        if (!trimmed) continue;
        try {
            await db.execute(sql.raw(trimmed));
            console.log('SUCCESS:', trimmed.slice(0, 60).replace(/\s+/g, ' '));
        } catch (e: any) {
            console.log('SKIP/WARN:', trimmed.slice(0, 60).replace(/\s+/g, ' '), '->', e.message);
        }
    }

    console.log('Migration execution finished!');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal migration error:', err);
    process.exit(1);
});
