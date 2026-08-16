/**
 * Published Century NIT fee schedule — integer USD cents.
 *
 * Portal previews, proforma generation and the ops review modal all read these
 * defaults. Live deployments may override them via the non-secret Fee Schedule
 * keys in platform settings; the numbers here are what a clean install uses.
 *
 * Never store these as formatted currency strings.
 */

export const DEFAULT_FEE_CENTS = {
	appBase: 35_000,
	appPerSchool: 10_000,
	appDocVerify: 4_000,
	appMatchReview: 3_000,
	visaBase: 35_000,
	visaBiometrics: 4_000,
	visaTranslation: 3_000,
	consultation: 7_500,
} as const;

export function usdFromCents(cents: number): number {
	return cents / 100;
}
