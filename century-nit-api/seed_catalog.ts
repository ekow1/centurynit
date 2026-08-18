import { db } from './src/db/index.js';
import { destinations, catalogUniversities, catalogPrograms, catalogScholarships } from './src/db/schema.js';
import { destinations as contentDestinations, universities as contentUniversities, programs as contentPrograms, scholarships as contentScholarships } from 'century-nit-core/content';

async function seed() {
    console.log('Seeding destinations...');
    for (const d of contentDestinations) {
        await db.insert(destinations).values({
            id: d.id,
            name: d.name,
            region: d.region,
            tagline: d.tagline,
            description: d.description,
            highlights: d.highlights,
            universities: d.universities,
            programs: d.programs,
            image: d.image,
            flag: d.flag,
            isActive: true,
        }).onConflictDoNothing();
    }

    console.log('Seeding universities...');
    for (const u of contentUniversities) {
        await db.insert(catalogUniversities).values({
            id: u.id,
            name: u.name,
            destinationId: u.destinationId,
            city: u.city,
            ranking: u.ranking,
            type: u.type,
            acceptance: u.acceptance,
            description: u.description,
            image: u.image,
            tags: u.tags,
            isActive: true,
        }).onConflictDoNothing();
    }

    console.log('Seeding programs...');
    for (const p of contentPrograms) {
        await db.insert(catalogPrograms).values({
            id: p.id,
            name: p.name,
            universityId: p.universityId,
            level: p.level,
            field: p.field,
            duration: p.duration,
            tuition: p.tuition,
            tuitionUsd: p.tuitionUsd,
            intake: p.intake,
            applicationDeadline: p.applicationDeadline,
            description: p.description,
            isActive: true,
        }).onConflictDoNothing();
    }

    console.log('Seeding scholarships...');
    for (const s of contentScholarships) {
        await db.insert(catalogScholarships).values({
            id: s.id,
            name: s.name,
            universityId: s.universityId,
            amount: s.amount,
            type: s.type,
            deadline: s.deadline,
            eligibility: s.eligibility,
            isActive: true,
        }).onConflictDoNothing();
    }

    console.log('Data migration complete!');
    process.exit(0);
}
seed().catch(console.error);
