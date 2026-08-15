import type { ReactNode } from "react";
import type { InvoiceLine, StageInvoice } from "../context/AppState";
import { formatDualCurrency, GHS_RATE, sumInvoiceLines } from "century-nit-core";
import { Button } from "./ui/Button";

function LineList({ lines }: { lines: InvoiceLine[] }) {
	const total = sumInvoiceLines(lines);
	return (
		<ul className="invoice-lines">
			{lines.map((l) => (
				<li key={l.id} className="invoice-line">
					<span className="invoice-line__main">
						<strong>{l.label}</strong>
						<span className="muted">{l.detail}</span>
					</span>
					<span className="invoice-line__amount mono">{formatDualCurrency(l.amount)}</span>
				</li>
			))}
			<li className="invoice-line invoice-line--total">
				<span className="invoice-line__main">
					<strong>Total</strong>
				</span>
				<span className="invoice-line__amount mono">{formatDualCurrency(total)}</span>
			</li>
		</ul>
	);
}

const STATUS_LABEL: Record<StageInvoice["status"], string> = {
	none: "Not raised",
	estimated: "Estimated",
	raised: "Outstanding",
	paid: "Paid",
};

type Props = {
	invoice: StageInvoice;
	title: string;
	meta?: ReactNode;
	onPay?: () => void;
	paying?: boolean;
	payCta?: string;
};

/** Shows the estimated vs actual invoice with itemized line details. */
export function StageInvoiceCard({ invoice, title, meta, onPay, paying, payCta }: Props) {
	const { status } = invoice;
	const payable = invoice.actualAmount ?? invoice.amount;
	const hasActual = invoice.actualAmount != null;
	const isPaid = status === "paid";

	// Ensure we always have displayable lines, especially for paid receipts
	const displayActualLines: InvoiceLine[] =
		invoice.actualLines.length > 0
			? invoice.actualLines
			: hasActual
				? [{ id: "actual-total", label: "Amount due", detail: "Confirmed invoice", amount: invoice.actualAmount ?? 0 }]
				: [];

	const displayEstimateLines: InvoiceLine[] =
		invoice.estimateLines.length > 0
			? invoice.estimateLines
			: [{ id: "estimate-total", label: "Estimated amount", detail: "Pending confirmation", amount: invoice.estimatedAmount ?? invoice.amount }];

	// For paid state, prefer actual lines; fall back to estimate lines; final fallback to a single paid line
	const receiptLines: InvoiceLine[] =
		displayActualLines.length > 0
			? displayActualLines
			: displayEstimateLines.length > 0
				? displayEstimateLines
				: [{ id: "paid-total", label: "Amount paid", detail: invoice.description || "Invoice settled", amount: payable }];

	function downloadReceipt() {
		const total = sumInvoiceLines(receiptLines);
		const lineText = receiptLines
			.map((l) => `  ${l.label} - ${l.detail}: $${l.amount}`)
			.join("\n");
		const receipt = [
			"CENTURY-NIT EDUCATIONAL CONSULTANTS",
			"====================================",
			"",
			`Invoice ref: ${invoice.id ?? "N/A"}`,
			`Title: ${title}`,
			`Status: ${STATUS_LABEL[status].toUpperCase()}`,
			`Date: ${invoice.paidAt ? new Date(invoice.paidAt).toLocaleString() : new Date().toLocaleString()}`,
			"",
			"Line items:",
			lineText,
			"",
			`Total: $${total.toLocaleString()} USD`,
			`GHS equivalent: GH\u20b5${Math.round(total * GHS_RATE).toLocaleString()}`,
			"",
			invoice.consultantNote ? `Note: ${invoice.consultantNote}` : "",
			"",
			"This is a system-generated receipt for your records.",
			"Keep this for your financial records.",
		].join("\n");
		const blob = new Blob([receipt], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `receipt-${invoice.id ?? "invoice"}.txt`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	return (
		<section className="invoice-card card card--pad mb-4">
			<div className="invoice-card__head">
				<div className="invoice-card__head-main">
					<p className="eyebrow">{title}</p>
					{status === "none" ? (
						<p className="display mt-1" style={{ fontSize: "2rem", opacity: 0.45 }}>
							Not raised yet
						</p>
					) : (
						<p className="display mt-1" style={{ fontSize: "2rem" }}>
							${payable.toLocaleString()}
							<span style={{ fontSize: "1rem", fontFamily: "var(--font-mono)" }}>
								{" "}
								GH₵{Math.round(payable * GHS_RATE).toLocaleString()} / USD
							</span>
						</p>
					)}
					<p className="muted mt-1">{invoice.description}</p>
					{invoice.id ? <p className="mono muted mt-2">{invoice.id}</p> : null}
					{meta ? <div className="mt-3">{meta}</div> : null}
				</div>
				<div className="invoice-card__head-aside">
					<span className="portal-pill portal-pill--submitted">{STATUS_LABEL[status]}</span>
					{status === "raised" ? (
						<div className="invoice-card__actions">
							<p className="mono muted mb-2">Pay to unlock the next stage</p>
							<Button type="button" onClick={onPay} arrow disabled={paying}>
								{paying ? "Processing…" : payCta ?? `Simulate Paystack · ${formatDualCurrency(payable)}`}
							</Button>
						</div>
					) : null}
				</div>
			</div>

			{status === "estimated" ? (
				<div className="invoice-card__note">
					<p className="mono">
						This is an <strong>estimate</strong> - no payment yet
					</p>
					<p className="muted mt-1">
						Your consultant is confirming the final figures. Once the actual invoice is issued you
						can pay and unlock the next stage.
					</p>
				</div>
			) : null}

			{isPaid ? (
				<div className="invoice-card__section">
					<p className="eyebrow mb-2">
						{hasActual ? "Paid invoice · actual" : "Paid invoice · settled"}
						{status === "paid" ? " · paid" : ""}
					</p>
					<LineList lines={receiptLines} />
					{invoice.consultantNote ? <p className="muted mt-2">{invoice.consultantNote}</p> : null}
				</div>
			) : (
				<>
					{status !== "none" ? (
						<div className="invoice-card__section">
							<p className="eyebrow mb-2">Estimated invoice · what it entails</p>
							<LineList lines={displayEstimateLines} />
						</div>
					) : null}

					{hasActual && displayActualLines.length ? (
						<div className="invoice-card__section">
							<p className="eyebrow mb-2">
								Actual invoice · issued by your consultant
							</p>
							<LineList lines={displayActualLines} />
							{invoice.consultantNote ? <p className="muted mt-2">{invoice.consultantNote}</p> : null}
						</div>
					) : null}
				</>
			)}

			{isPaid && invoice.paidAt ? (
				<div
					className="invoice-card__foot"
					style={{
						borderTop: "1px solid var(--border-light)",
						paddingTop: "1rem",
						marginTop: "1rem",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							flexWrap: "wrap",
							gap: "0.75rem",
						}}
					>
						<div>
							<p className="eyebrow">Payment receipt</p>
							<p className="mono muted mt-1">Paid {new Date(invoice.paidAt).toLocaleString()}</p>
							<p className="mono muted" style={{ fontSize: "0.75rem" }}>
								Receipt ref: {invoice.id}
							</p>
						</div>
						<Button type="button" variant="secondary" onClick={downloadReceipt}>
							Download receipt
						</Button>
					</div>
				</div>
			) : null}
		</section>
	);
}
