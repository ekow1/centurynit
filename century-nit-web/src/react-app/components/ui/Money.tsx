import { GHS_RATE } from "century-nit-core";

/**
 * Dual-currency amount - cedi primary, USD secondary.
 *
 * Fees are defined in USD but every branch bills in GHS, so an applicant
 * needs both. Stacked rather than slash-joined ("GH₵1,125 / $75 USD"),
 * which is what `formatDualCurrency` produces for prose - that string is too
 * wide for a stat cell or a ledger column on a phone.
 */
export function Money({
	usd,
	negative,
	prefix,
	className = "",
}: {
	usd: number;
	/** Renders as a credit - used for amounts already paid */
	negative?: boolean;
	/** Short label before the figure, e.g. "Paid" */
	prefix?: string;
	className?: string;
}) {
	const ghs = Math.round(usd * GHS_RATE);
	const sign = negative ? "−" : "";

	return (
		<span className={`money${className ? ` ${className}` : ""}`}>
			<span className="money__primary">
				{prefix ? <span className="money__prefix">{prefix} </span> : null}
				{sign}GH₵{ghs.toLocaleString()}
			</span>
			<span className="money__secondary">
				{sign}${usd.toLocaleString()} USD
			</span>
		</span>
	);
}

/** Inline single-line variant for running prose */
export function MoneyInline({ usd }: { usd: number }) {
	const ghs = Math.round(usd * GHS_RATE);
	return (
		<span className="money-inline">
			GH₵{ghs.toLocaleString()} <span className="money-inline__alt">(${usd.toLocaleString()})</span>
		</span>
	);
}
