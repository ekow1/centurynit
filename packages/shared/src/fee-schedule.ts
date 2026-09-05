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
	appBase: 13,
	appPerSchool: 7,
	appDocVerify: 7,
	appMatchReview: 7,
	visaBase: 13,
	visaBiometrics: 7,
	visaTranslation: 7,
	consultation: 7,
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
