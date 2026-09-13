import { getGhsPerUsd } from "century-nit-core/ui";

/**
 * Dual-currency helpers - everything is stored canonically in USD and rendered
 * as both Ghanaian cedi (GHS) and its USD equivalent.
 *
 * The rate is the fee schedule's (GET /api/v1/fees), set on the shared money
 * module when the console loads — the same rate the client is charged at.
 */
export function ghsPerUsd(): number {
	return getGhsPerUsd();
}

export function toGhs(usd: number): number {
	return Math.round(usd * getGhsPerUsd());
}

export function fmtUsd(usd: number): string {
	return `$${usd.toLocaleString()}`;
}

export function fmtGhs(usd: number): string {
	return `GH₵ ${toGhs(usd).toLocaleString()}`;
}

/** "GH₵ 45,000 · $3,000" - the GHS figure followed by its USD equivalent. */
export function fmtBoth(usd: number): string {
	return `${fmtGhs(usd)} · ${fmtUsd(usd)}`;
}

/**
 * Parse a stored USD currency string ("$3,000") back into a number.
 *
 * Reads the USD figure specifically rather than stripping every non-digit:
 * a naive strip turns an accidentally-stored dual string like
 * "GH₵45,000 / $3,000" into 450003000, and that silently multiplies every
 * downstream total by five orders of magnitude.
 */
export function money(s: string): number {
	const str = String(s);

	// Prefer an explicit USD figure when one is present
	const usd = str.match(/\$\s*([\d,]+(?:\.\d+)?)/);
	if (usd) return toNumber(usd[1]);

	// A GHS-only figure is converted back to the canonical USD
	const ghs = str.match(/(?:GH₵|GHS|₵)\s*([\d,]+(?:\.\d+)?)/i);
	if (ghs) return toNumber(ghs[1]) / getGhsPerUsd();

	// Bare number - take the first run of digits, not all of them
	const bare = str.match(/[\d,]+(?:\.\d+)?/);
	return bare ? toNumber(bare[0]) : 0;
}

function toNumber(s: string): number {
	const n = Number(s.replace(/,/g, ""));
	return Number.isFinite(n) ? n : 0;
}

/** Dual-currency display for a stored currency string. */
export function fmtFin(s: string): string {
	return fmtBoth(money(s));
}
