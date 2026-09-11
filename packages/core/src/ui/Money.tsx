/**
 * One way to show an amount.
 *
 * Amounts are stored in USD cents. The settlement currency shown to people in
 * Ghana is GHS, so the default rendering is the cedi figure with the USD it
 * was priced in as a secondary — the same on an ops table and the applicant's
 * invoice. The rate here is a display approximation; the API converts at
 * the live rate when it takes a payment.
 */
export const GHS_PER_USD = 15;

export type MoneyDisplay = "ghs" | "usd" | "both";

export function formatUsd(cents: number): string {
	const usd = cents / 100;
	return `$${usd.toLocaleString("en-US", { minimumFractionDigits: usd % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function formatGhs(cents: number): string {
	return `GH₵ ${Math.round((cents / 100) * GHS_PER_USD).toLocaleString("en-US")}`;
}

export function formatMoney(cents: number, display: MoneyDisplay = "both"): string {
	if (display === "usd") return formatUsd(cents);
	if (display === "ghs") return formatGhs(cents);
	return `${formatGhs(cents)} · ${formatUsd(cents)}`;
}

export function Money({ cents, display = "both", className }: { cents: number; display?: MoneyDisplay; className?: string }) {
	if (display === "both") {
		return (
			<span className={`cn-money${className ? ` ${className}` : ""}`}>
				{formatGhs(cents)}
				<span className="cn-money__secondary">{formatUsd(cents)}</span>
			</span>
		);
	}
	return <span className={`cn-money${className ? ` ${className}` : ""}`}>{formatMoney(cents, display)}</span>;
}
