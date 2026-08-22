import { and, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { lookupValues } from "../db/schema.js";

/**
 * Seed the global lookup_values table used by portal assessment dropdowns.
 *
 * The portal's Assessment form reads options from /api/v1/lookups for these
 * categories. A clean install has an empty table, so every select shows only
 * "Select" with nothing to pick. This script idempotently inserts a sensible
 * starting set so the form is usable out of the box.
 *
 *   npm run seed:lookups --workspace=century-nit-api
 *
 * Re-running is safe — existing (category, value) pairs are skipped.
 */

type Seed = { category: string; value: string; label: string; sortOrder: number };

const SEED: Seed[] = [
	// Gender
	{ category: "gender", value: "male", label: "Male", sortOrder: 1 },
	{ category: "gender", value: "female", label: "Female", sortOrder: 2 },
	{ category: "gender", value: "other", label: "Other / Prefer not to say", sortOrder: 3 },

	// Highest education
	{ category: "highestEducation", value: "high_school", label: "High School / WASSCE", sortOrder: 1 },
	{ category: "highestEducation", value: "diploma", label: "Diploma / HND", sortOrder: 2 },
	{ category: "highestEducation", value: "bachelors", label: "Bachelor's Degree", sortOrder: 3 },
	{ category: "highestEducation", value: "masters", label: "Master's Degree", sortOrder: 4 },
	{ category: "highestEducation", value: "phd", label: "Doctorate (PhD)", sortOrder: 5 },
	{ category: "highestEducation", value: "other", label: "Other", sortOrder: 6 },

	// Employment status
	{ category: "employmentStatus", value: "employed", label: "Employed", sortOrder: 1 },
	{ category: "employmentStatus", value: "self_employed", label: "Self-employed", sortOrder: 2 },
	{ category: "employmentStatus", value: "student", label: "Student", sortOrder: 3 },
	{ category: "employmentStatus", value: "unemployed", label: "Unemployed", sortOrder: 4 },

	// English test
	{ category: "englishTest", value: "ielts", label: "IELTS", sortOrder: 1 },
	{ category: "englishTest", value: "toefl", label: "TOEFL", sortOrder: 2 },
	{ category: "englishTest", value: "duolingo", label: "Duolingo English Test", sortOrder: 3 },
	{ category: "englishTest", value: "pte", label: "PTE Academic", sortOrder: 4 },
	{ category: "englishTest", value: "none", label: "Not taken yet", sortOrder: 5 },

	// Preferred level
	{ category: "preferredLevel", value: "foundation", label: "Foundation / Pathway", sortOrder: 1 },
	{ category: "preferredLevel", value: "diploma", label: "Diploma", sortOrder: 2 },
	{ category: "preferredLevel", value: "bachelors", label: "Bachelor's Degree", sortOrder: 3 },
	{ category: "preferredLevel", value: "masters", label: "Master's Degree", sortOrder: 4 },
	{ category: "preferredLevel", value: "phd", label: "Doctorate (PhD)", sortOrder: 5 },

	// Funding source
	{ category: "fundingSource", value: "self", label: "Self-funded", sortOrder: 1 },
	{ category: "fundingSource", value: "family", label: "Family / Sponsor", sortOrder: 2 },
	{ category: "fundingSource", value: "loan", label: "Education Loan", sortOrder: 3 },
	{ category: "fundingSource", value: "scholarship", label: "Scholarship / Grant", sortOrder: 4 },
	{ category: "fundingSource", value: "employer", label: "Employer Sponsorship", sortOrder: 5 },

	// Budget range (USD per year)
	{ category: "budgetRange", value: "under_10k", label: "Under $10,000", sortOrder: 1 },
	{ category: "budgetRange", value: "10k_20k", label: "$10,000 – $20,000", sortOrder: 2 },
	{ category: "budgetRange", value: "20k_30k", label: "$20,000 – $30,000", sortOrder: 3 },
	{ category: "budgetRange", value: "30k_50k", label: "$30,000 – $50,000", sortOrder: 4 },
	{ category: "budgetRange", value: "over_50k", label: "Over $50,000", sortOrder: 5 },
];

async function main() {
	let inserted = 0;
	let skipped = 0;

	for (const s of SEED) {
		const existing = await db
			.select({ id: lookupValues.id })
			.from(lookupValues)
			.where(and(eq(lookupValues.category, s.category), eq(lookupValues.value, s.value)))
			.limit(1);

		if (existing.length > 0) {
			skipped++;
			continue;
		}

		await db.insert(lookupValues).values({
			category: s.category,
			value: s.value,
			label: s.label,
			sortOrder: s.sortOrder,
			isActive: true,
		});
		inserted++;
	}

	console.log(`[seed:lookups] inserted ${inserted}, skipped ${skipped} (already present)`);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("[seed:lookups] failed:", err);
		process.exit(1);
	});
