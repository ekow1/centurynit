import { z } from "zod";
import { serviceStageSchema, stagePricesSchema } from "../stages.js";

/**
 * Package taxonomy.
 *
 * One canonical vocabulary for the recommendation, the applicant selection,
 * and the database. `undecided` is the escape hatch for the assessment before
 * a package is locked.
 */
export const packageCodeSchema = z.enum([
	"non_scholarship",
	"scholarship",
	"hybrid",
	"undecided",
]);
export type PackageCode = z.infer<typeof packageCodeSchema>;

export const PACKAGE_CODE_LABELS: Record<PackageCode, string> = {
	non_scholarship: "Non-Scholarship",
	scholarship: "Scholarship",
	hybrid: "Hybrid",
	undecided: "Undecided",
};

export const servicePackageSchema = z.object({
	id: z.string().uuid(),
	code: packageCodeSchema,
	name: z.string().min(1).max(120),
	tagline: z.string().max(500).nullable(),
	/** The full-journey bundle — all three stages together. */
	priceCents: z.number().int().nonnegative(),
	/** What each stage costs on its own; null on a row finance has not priced yet. */
	stagePrices: stagePricesSchema.nullable().default(null),
	currency: z.string().length(3).default("USD"),
	features: z.array(z.string()),
	exclusions: z.array(z.string()),
	includedFeeKeys: z.array(z.string()),
	/** Document type ids the client must have verified before applications start. */
	requiredDocuments: z.array(z.string().min(1).max(64)).default([]),
	maxSchools: z.number().int().nonnegative().default(0),
	sortOrder: z.number().int().default(0),
	active: z.boolean().default(true),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type ServicePackage = z.infer<typeof servicePackageSchema>;

export const createServicePackageSchema = servicePackageSchema
	.omit({ id: true, createdAt: true, updatedAt: true })
	.partial({
		active: true,
		sortOrder: true,
		maxSchools: true,
		currency: true,
		includedFeeKeys: true,
		requiredDocuments: true,
		stagePrices: true,
		features: true,
		exclusions: true,
		tagline: true,
	});
export type CreateServicePackage = z.infer<typeof createServicePackageSchema>;

export const updateServicePackageSchema = createServicePackageSchema.partial();
export type UpdateServicePackage = z.infer<typeof updateServicePackageSchema>;

export const choosePackageSchema = z.object({
	packageCode: packageCodeSchema,
	degreeLevel: z.string().min(1).max(64),
	targetSchoolCount: z.number().int().min(1).max(10).optional(),
	/** The stages on the plan. Omitted means the full journey. Admissions is always in. */
	stages: z.array(serviceStageSchema).min(1).max(3).optional(),
	/** Ops choosing on the client's behalf says why — it goes on the case. */
	reason: z.string().max(500).optional(),
});
export type ChoosePackage = z.infer<typeof choosePackageSchema>;

