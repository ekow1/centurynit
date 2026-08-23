import { z } from "zod";

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
	priceCents: z.number().int().nonnegative(),
	currency: z.string().length(3).default("USD"),
	features: z.array(z.string()),
	exclusions: z.array(z.string()),
	includedFeeKeys: z.array(z.string()),
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
});
export type ChoosePackage = z.infer<typeof choosePackageSchema>;
