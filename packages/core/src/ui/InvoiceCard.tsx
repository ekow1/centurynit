import type { ApiInvoice } from "century-nit-shared";
import { INVOICE_PROFORMA_HINT } from "century-nit-shared";
import { Money, type MoneyDisplay } from "./Money.js";
import { InvoiceStatusPill } from "./StatusPill.js";

/**
 * An invoice, the same on every screen: number and status, the lines, the
 * three figures (total, paid, balance), the due date, and one slot for what
 * the viewer can do about it. Ops puts "Issue" / "Void" in the slot; the
 * applicant sees "Pay". Nothing else about the card changes between them.
 */
export function InvoiceCard({
	invoice,
	title,
	display = "both",
	actions,
	hint,
	compact = false,
}: {
	invoice: Pick<ApiInvoice, "invoiceNumber" | "status" | "type" | "lines" | "subtotalCents" | "paidCents" | "balanceCents" | "dueAt" | "note"> & {
		creditedCents?: number;
		/** The trail — shown when present: raised by X, approved by Y. */
		raisedByName?: string | null;
		raisedAt?: string | null;
		issuedByName?: string | null;
		reviewedAt?: string | null;
	};
	/** Heading — "Application invoice", "Visa invoice", "Ticket invoice"… */
	title: string;
	display?: MoneyDisplay;
	/** Buttons for this viewer. */
	actions?: React.ReactNode;
	/** One line under the actions; defaults to the proforma hint while awaiting approval. */
	hint?: React.ReactNode;
	/** Hide the line items (list rows, tight cards). */
	compact?: boolean;
}) {
	const isProforma = invoice.status === "proforma";
	const due = invoice.dueAt ? new Date(invoice.dueAt) : null;
	const showCredit = (invoice.creditedCents ?? 0) > 0;

	return (
		<div className="cn-invoice">
			<div className="cn-invoice__head">
				<div className="cn-invoice__title">
					<span className="eyebrow">{title}</span>
					<span className="cn-invoice__number">{invoice.invoiceNumber}</span>
				</div>
				<InvoiceStatusPill status={invoice.status} />
			</div>

			{!compact && invoice.lines.length > 0 && (
				<ul className="cn-invoice__lines">
					{invoice.lines.map((l) => (
						<li key={l.id} className="cn-invoice__line">
							<span>
								{l.label}
								{l.detail && <span className="cn-invoice__line-detail">{l.detail}</span>}
							</span>
							<Money cents={l.amountCents} display={display} />
						</li>
					))}
				</ul>
			)}

			<dl className="cn-invoice__totals">
				<dt>Total</dt>
				<dd><Money cents={invoice.subtotalCents} display={display} /></dd>
				{showCredit && (
					<>
						<dt>Credited</dt>
						<dd><Money cents={-(invoice.creditedCents ?? 0)} display={display} /></dd>
					</>
				)}
				{invoice.paidCents > 0 && (
					<>
						<dt>Paid</dt>
						<dd><Money cents={invoice.paidCents} display={display} /></dd>
					</>
				)}
				<dt className="cn-invoice__balance">Balance</dt>
				<dd className="cn-invoice__balance"><Money cents={invoice.balanceCents} display={display} /></dd>
			</dl>

			{(due || invoice.note) && (
				<p className="cn-invoice__meta">
					{due && <>Due {due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</>}
					{due && invoice.note && " · "}
					{invoice.note}
				</p>
			)}
			{invoice.raisedByName && (
				<p className="cn-invoice__meta">
					Raised by {invoice.raisedByName}
					{invoice.raisedAt && ` · ${new Date(invoice.raisedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
					{!isProforma && invoice.status !== "void" && invoice.issuedByName && (
						<>
							{" · "}Approved by {invoice.issuedByName}
							{invoice.reviewedAt && ` · ${new Date(invoice.reviewedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
						</>
					)}
				</p>
			)}

			{(actions || hint || isProforma) && (
				<div className="cn-invoice__actions">
					{actions}
					{(hint ?? (isProforma ? INVOICE_PROFORMA_HINT : null)) && (
						<p className="cn-invoice__hint">{hint ?? INVOICE_PROFORMA_HINT}</p>
					)}
				</div>
			)}
		</div>
	);
}
