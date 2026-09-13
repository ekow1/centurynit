/**
 * Legacy fee shape, kept for the portal's offline fallback only.
 *
 * The API prices nothing from these numbers any more: Century's fee is the
 * package's service fee plus the fee catalogue's items (GET /api/v1/fees),
 * and the universities' application fees and destinations' visa costs are
 * third-party tariffs on the catalogue rows, paid on the client's behalf at
 * cost. `feesApi.schedule()` fills this shape from the catalogue, with the
 * charges that are no longer Century's at zero.
 */

export const DEFAULT_FEE_CENTS = {
	appBase: 25_000,
	appPerSchool: 7_000,
	appDocVerify: 5_000,
	appMatchReview: 5_000,
	visaBase: 35_000,
	visaBiometrics: 10_000,
	visaTranslation: 5_000,
	consultation: 15_000,
} as const;

export type FeeSchedule = {
	appBaseCents: number;
	appPerSchoolCents: number;
	appDocVerifyCents: number;
	appMatchReviewCents: number;
	visaBaseCents: number;
	visaBiometricsCents: number;
	visaTranslationCents: number;
	consultationCents: number;
};

export function usdFromCents(cents: number): number {
	return cents / 100;
}

/**
 * Base Century NIT consultancy service fees by degree level (integer USD cents).
 * Covers document verification, portal account setup, credential evaluation,
 * and case manager assignment.
 */
export const DEFAULT_SERVICE_FEE_CENTS_BY_LEVEL: Record<string, number> = {
	bachelor: 120_000,   // $1,200
	masters: 150_000,    // $1,500
	phd: 220_000,        // $2,200
	diploma: 100_000,    // $1,000
	professional: 130_000, // $1,300
};

/**
 * Additional track-specific advisory adjustments (integer USD cents).
 */
export const DEFAULT_TRACK_ADVISORY_CENTS: Record<string, number> = {
	scholarship: 30_000,     // +$300 for scholarship research & essay strategy
	non_scholarship: 0,      // standard
	hybrid: 20_000,          // +$200 for blended targeting
};

/**
 * Per-school incremental advisory fee beyond base threshold (integer USD cents).
 */
export const DEFAULT_PER_SCHOOL_ADVISORY_CENTS = 10_000; // $100 per additional school

