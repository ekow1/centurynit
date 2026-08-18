import { config } from 'dotenv';
config({ path: 'd:/projects/century-nit-suite/century-nit-api/.env.supabase' });
import pg from 'pg';
const { Client } = pg;

let url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL || '';
if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
if (url.startsWith("'") && url.endsWith("'")) url = url.slice(1, -1);

const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    console.log('Connecting to:', url.replace(/:[^:@]+@/, ':***@'));
    await client.connect();
    
    console.log('Clearing old records...');
    try {
        await client.query(`DELETE FROM "school_track_events"`);
        await client.query(`DELETE FROM "school_applications"`);
    } catch(e) { console.log('Delete error:', e.message); }

    console.log('Adding constraints...');
    try {
        await client.query(`ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action`);
        console.log('Added FK for destination_id');
    } catch(e) { console.log('FK1 error:', e.message); }
    
    try {
        await client.query(`ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_university_id_catalog_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."catalog_universities"("id") ON DELETE no action ON UPDATE no action`);
        console.log('Added FK for university_id');
    } catch(e) { console.log('FK2 error:', e.message); }
    
    try {
        await client.query(`ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_program_id_catalog_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."catalog_programs"("id") ON DELETE no action ON UPDATE no action`);
        console.log('Added FK for program_id');
    } catch(e) { console.log('FK3 error:', e.message); }

    console.log('Done!');
    await client.end();
    process.exit(0);
}
main();
