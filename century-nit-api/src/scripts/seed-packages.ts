import { db } from "../db/index.js";
import { servicePackages } from "../db/schema.js";
import { sql } from "drizzle-orm";

const seed = [
	{
		code: "non_scholarship" as const,
		name: "Non-Scholarship Pathway",
		tagline: "Streamlined admission & visa support for self-funded students.",
		priceCents: 150_000,
		currency: "USD",
		features: [
			"Document review & credential verification",
			"University and program matching",
			"Application submission support",
			"Visa document preparation",
			"Embassy interview coaching",
			"Travel & accommodation coordination",
			"Pre-departure briefing",
		],
		exclusions: [
			"School / university direct application fees",
			"Embassy / government visa and biometrics fees",
			"Initial advisory consultation fee",
		],
		includedFeeKeys: ["APP_INVOICE_BASE", "APP_INVOICE_PER_SCHOOL", "APP_DOC_VERIFY_FEE", "APP_MATCH_REVIEW_FEE", "VISA_INVOICE_AMOUNT", "VISA_BIOMETRICS_FEE", "VISA_TRANSLATION_FEE", "TRAVEL_COORDINATION_FEE_CENTS", "HOUSING_ASSISTANCE_FEE_CENTS", "PRE_DEPARTURE_BRIEFING_FEE_CENTS"],
		maxSchools: 3,
		sortOrder: 1,
	},
	{
		code: "hybrid" as const,
		name: "Hybrid Pathway",
		tagline: "Start non-scholarship; upgrade to scholarship search after consultation.",
		priceCents: 200_000,
		currency: "USD",
		features: [
			"Everything in Non-Scholarship",
			"Scholarship eligibility audit",
			"Limited scholarship matching",
			"Priority school selection guidance",
		],
		exclusions: [
			"School / university direct application fees",
			"Embassy / government visa and biometrics fees",
			"Initial advisory consultation fee",
		],
		includedFeeKeys: ["APP_INVOICE_BASE", "APP_INVOICE_PER_SCHOOL", "APP_DOC_VERIFY_FEE", "APP_MATCH_REVIEW_FEE", "VISA_INVOICE_AMOUNT", "VISA_BIOMETRICS_FEE", "VISA_TRANSLATION_FEE", "TRAVEL_COORDINATION_FEE_CENTS", "HOUSING_ASSISTANCE_FEE_CENTS", "PRE_DEPARTURE_BRIEFING_FEE_CENTS"],
		maxSchools: 4,
		sortOrder: 2,
	},
	{
		code: "scholarship" as const,
		name: "Scholarship Pathway",
		tagline: "Full scholarship search, application, and negotiation support.",
		priceCents: 250_000,
		currency: "USD",
		features: [
			"Comprehensive document review, notarization & credential evaluation",
			"Priority multi-institution scholarship matching",
			"End-to-end visa filing support",
			"1-on-1 mock embassy visa interview coaching",
			"Travel, housing & airport pickup coordination",
			"Pre-departure orientation & arrival transition",
			"Continuous dedicated senior advisor support",
		],
		exclusions: [
			"School / university direct application fees",
			"Embassy / government visa and biometrics fees",
			"Initial advisory consultation fee",
		],
		includedFeeKeys: ["APP_INVOICE_BASE", "APP_INVOICE_PER_SCHOOL", "APP_DOC_VERIFY_FEE", "APP_MATCH_REVIEW_FEE", "VISA_INVOICE_AMOUNT", "VISA_BIOMETRICS_FEE", "VISA_TRANSLATION_FEE", "TRAVEL_COORDINATION_FEE_CENTS", "HOUSING_ASSISTANCE_FEE_CENTS", "PRE_DEPARTURE_BRIEFING_FEE_CENTS"],
		maxSchools: 5,
		sortOrder: 3,
	},
];

async function main() {
	for (const pkg of seed) {
		const [existing] = await db
			.select({ id: servicePackages.id })
			.from(servicePackages)
			.where(sql`${servicePackages.code} = ${pkg.code}`)
			.limit(1);
		if (existing) continue;
		await db.insert(servicePackages).values({
			code: pkg.code as unknown as any,
			name: pkg.name,
			tagline: pkg.tagline,
			priceCents: pkg.priceCents,
			currency: pkg.currency,
			features: pkg.features,
			exclusions: pkg.exclusions,
			includedFeeKeys: pkg.includedFeeKeys,
			maxSchools: pkg.maxSchools,
			sortOrder: pkg.sortOrder,
			active: true,
		} as any);
		console.log(`Seeded package: ${pkg.code}`);
	}
	console.log("Package seed complete.");
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
