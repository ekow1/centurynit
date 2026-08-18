import { config } from 'dotenv';
config({ path: 'd:/projects/century-nit-suite/century-nit-api/.env.supabase' });
import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';
import { schoolApplications, schoolTrackEvents } from './src/db/schema.js';

async function main() {
    console.log('Running manual migration...');
    try {
        await db.delete(schoolTrackEvents);
        await db.delete(schoolApplications);
        console.log('Cleared existing school applications');
    } catch(e) { console.error('DELETE ERROR:', e); }

    try {
        await db.execute(sql`ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action`);
        console.log('Added FK for destination_id');
    } catch(e) { console.error('DESTINATION FK ERROR:', e); }
    
    try {
        await db.execute(sql`ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_university_id_catalog_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."catalog_universities"("id") ON DELETE no action ON UPDATE no action`);
        console.log('Added FK for university_id');
    } catch(e) { console.error('UNIVERSITY FK ERROR:', e); }
    
    try {
        await db.execute(sql`ALTER TABLE "school_applications" ADD CONSTRAINT "school_applications_program_id_catalog_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."catalog_programs"("id") ON DELETE no action ON UPDATE no action`);
        console.log('Added FK for program_id');
    } catch(e) { console.error('PROGRAM FK ERROR:', e); }

    console.log('Done!');
    process.exit(0);
}
main();
