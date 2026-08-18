import { db } from './src/db/index.js';
import { lookupValues } from './src/db/schema.js';

const lookups = [
	{ category: 'fundingSource', value: 'self', label: 'Self-funded', sortOrder: 1 },
	{ category: 'fundingSource', value: 'family', label: 'Family / Parents', sortOrder: 2 },
	{ category: 'fundingSource', value: 'sponsor', label: 'Sponsor', sortOrder: 3 },
	{ category: 'fundingSource', value: 'loan', label: 'Education loan', sortOrder: 4 },
	{ category: 'fundingSource', value: 'scholarship', label: 'Scholarship / Grant', sortOrder: 5 },

	{ category: 'budgetRange', value: 'under_15k', label: 'Under $15,000', sortOrder: 1 },
	{ category: 'budgetRange', value: '15k_30k', label: '$15,000 - $30,000', sortOrder: 2 },
	{ category: 'budgetRange', value: '30k_50k', label: '$30,000 - $50,000', sortOrder: 3 },
	{ category: 'budgetRange', value: 'over_50k', label: 'Over $50,000', sortOrder: 4 },

	{ category: 'intakePreference', value: 'january', label: 'January / Spring', sortOrder: 1 },
	{ category: 'intakePreference', value: 'may', label: 'May / Summer', sortOrder: 2 },
	{ category: 'intakePreference', value: 'september', label: 'September / Fall', sortOrder: 3 },
];

async function seed() {
	console.log('Seeding lookups...');
	for (const l of lookups) {
		await db.insert(lookupValues).values({ ...l, isActive: true });
	}
	console.log('Done!');
	process.exit(0);
}
seed().catch(console.error);
