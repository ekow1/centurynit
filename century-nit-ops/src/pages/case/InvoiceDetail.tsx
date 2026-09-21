import { useState } from "react";
import { Link } from "react-router-dom";
import { INVOICE_STATUS_LABELS, invoicePaid, type Invoice, type InvoiceStatus } from "century-nit-core/ops";
import { fmtBoth, fmtGhs, money } from "../currency";
import { coveredLines, lineDue } from "../../lib/invoiceLines";

/**
 * One invoice as a document — lines with their milestone state, totals,
 * and the money actions: approve (a draft with no case), record a
 * payment, credit, void, resend. The Invoices page renders it for the
 * ledger-wide view; the case's Billing tab renders the same component, so
 * money on a case is acted on in the case.
 */

const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

export function InvoiceDetail({
	row,
	account,
	by,
	onApprove,
	onPay,
	onVoid,
	onCredit,
	onResend,
}: {
	row: { inv: Invoice; derived: InvoiceStatus; age: number | null; balance: number };
	account: { balance: number; overdue: number; count: number; toApprove: number; nextDue: string | null } | null;
	by: string;
	/** Approve here — only for a draft with no case to approve it on. */
	onApprove: () => Promise<void>;
	onPay: (amount: number, method: string, reference: string) => void;
	onVoid: (reason: string) => void;
	onCredit: (amount: number, reason: string) => void;
	onResend: () => void;
}) {
	const { inv, derived, balance } = row;
	const [panel, setPanel] = useState<"none" | "pay" | "void" | "credit">("none");
	const [amount, setAmount] = useState("");
	const [method, setMethod] = useState("Bank Transfer");
	const [reference, setReference] = useState("");
	const [reason, setReason] = useState("");

	const isProforma = inv.status === "proforma";
	const paid = invoicePaid(inv);
	const closed = inv.status === "void" || balance === 0;

	function reset() {
		setPanel("none");
		setAmount("");
		setReference("");
		setReason("");
	}

	return (
		<div className="inv-doc">
			{isProforma ? (
				<div style={{ border: "1px solid var(--foreground)", borderLeftWidth: "4px", padding: "0.85rem 1rem", marginBottom: "1.25rem" }}>
					<strong>Awaiting approval</strong>
					<p className="muted mt-1" style={{ fontSize: "var(--text-xs)" }}>
						Raised by {inv.issuedBy || "—"}. The client cannot see or pay it until it is approved and issued
						{inv.applicationId ? " — on the case." : "."}
					</p>
				</div>
			) : null}

			<header className="inv-doc__head">
				<div>
					<p className="inv-doc__num mono">{inv.invoiceNumber}</p>
					<p className="inv-doc__who display">{inv.applicantName}</p>
					<p className="mono muted inv-doc__meta">
						{inv.type} · {isProforma ? `raised ${new Date(inv.issuedAt).toLocaleDateString()}` : `issued ${new Date(inv.issuedAt).toLocaleDateString()} by ${inv.issuedBy}`}
						{inv.dueAt ? ` · due ${new Date(inv.dueAt).toLocaleDateString()}` : ""}
					</p>
				</div>
				<span className={`inv-status inv-status--${derived}`}>{INVOICE_STATUS_LABELS[derived]}</span>
			</header>

			<div className="inv-doc__lines">
				{coveredLines(inv.lines, paid).map(({ line: l, covered }) => {
						const due = lineDue(l, covered);
						return (
							<div key={l.id} className="inv-doc__line">
								<span className="inv-doc__line-label">
									{l.label}
									{l.detail ? <span className="inv-doc__line-detail">{l.detail}</span> : null}
									{due ? (
										<span className="inv-doc__line-detail mono" style={{ color: due.tone === "late" ? "var(--bad, #b91c1c)" : due.tone === "paid" ? "var(--ok, #0d7a3f)" : undefined }}>
											{due.text}
										</span>
									) : null}
								</span>
								<span className="inv-doc__line-amt mono">{fmtGhs(l.amount)}</span>
							</div>
						);
					})}
			</div>

			<div className="inv-doc__totals">
				<Row label="Subtotal" value={fmtBoth(inv.subtotal)} />
				{paid > 0 ? <Row label="Paid" value={`− ${fmtBoth(paid)}`} /> : null}
				{inv.creditedAmount ? <Row label="Credited" value={`− ${fmtBoth(inv.creditedAmount)}`} /> : null}
				<Row label={isProforma ? "Total to approve" : "Balance due"} value={fmtBoth(balance)} strong />
			</div>

			{inv.note ? <p className="inv-doc__note">{inv.note}</p> : null}

			{inv.voidReason ? (
				<p className="inv-doc__void">Voided — {inv.voidReason}</p>
			) : null}

			{/* Actions */}
			<div className="inv-doc__actions">
				{isProforma ? (
					inv.applicationId ? (
						<Link to={`/applications?id=${inv.applicationId}&tab=payments`} className="btn btn--sm btn--primary">
							Approve on the case →
						</Link>
					) : (
						<button type="button" className="btn btn--sm btn--primary" onClick={() => void onApprove()}>
							Approve & issue
						</button>
					)
				) : (
					<>
						<button type="button" className="btn btn--ghost btn--sm" onClick={onResend}>
							Re-send
						</button>
						{!closed ? (
							<>
								<button
									type="button"
									className={`btn btn--sm ${panel === "pay" ? "btn--primary" : "btn--ghost"}`}
									onClick={() => setPanel(panel === "pay" ? "none" : "pay")}
								>
									Record payment
								</button>
								<button
									type="button"
									className={`btn btn--sm ${panel === "credit" ? "btn--primary" : "btn--ghost"}`}
									onClick={() => setPanel(panel === "credit" ? "none" : "credit")}
								>
									Credit note
								</button>
								<button
									type="button"
									className={`btn btn--sm ${panel === "void" ? "btn--primary" : "btn--ghost"}`}
									onClick={() => setPanel(panel === "void" ? "none" : "void")}
								>
									Void
								</button>
							</>
						) : null}
					</>
				)}
			</div>

			{panel === "pay" ? (
				<form
					className="inv-form"
					onSubmit={(e) => {
						e.preventDefault();
						const n = money(amount);
						if (n <= 0) return;
						onPay(Math.min(n, balance), method, reference.trim());
						reset();
					}}
				>
					<p className="eyebrow">Record a payment</p>
					<div className="inv-form__grid">
						<label>
							<span className="inv-form__label mono">Amount (USD)</span>
							<input className="input input--sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(balance)} />
						</label>
						<label>
							<span className="inv-form__label mono">Method</span>
							<select className="input input--sm" value={method} onChange={(e) => setMethod(e.target.value)}>
								<option>Visa Card</option>
								<option>Mastercard</option>
								<option>Bank Transfer</option>
								<option>Mobile Money</option>
								<option>Direct Debit</option>
							</select>
						</label>
						<label>
							<span className="inv-form__label mono">Reference</span>
							<input className="input input--sm" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
						</label>
					</div>
					<div className="inv-form__foot">
						<button type="submit" className="btn btn--primary btn--sm" disabled={money(amount) <= 0}>
							Record {money(amount) > 0 ? fmtBoth(Math.min(money(amount), balance)) : ""}
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
						<span className="mono muted inv-form__hint">Part payments leave the balance open.</span>
					</div>
				</form>
			) : null}

			{panel === "credit" ? (
				<form
					className="inv-form"
					onSubmit={(e) => {
						e.preventDefault();
						const n = money(amount);
						if (n <= 0 || !reason.trim()) return;
						onCredit(Math.min(n, balance), reason.trim());
						reset();
					}}
				>
					<p className="eyebrow">Issue a credit note</p>
					<div className="inv-form__grid">
						<label>
							<span className="inv-form__label mono">Amount (USD)</span>
							<input className="input input--sm" value={amount} onChange={(e) => setAmount(e.target.value)} />
						</label>
						<label style={{ gridColumn: "span 2" }}>
							<span className="inv-form__label mono">Reason</span>
							<input className="input input--sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shown on the applicant's statement" />
						</label>
					</div>
					<div className="inv-form__foot">
						<button type="submit" className="btn btn--primary btn--sm" disabled={money(amount) <= 0 || !reason.trim()}>
							Issue credit note
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
					</div>
				</form>
			) : null}

			{panel === "void" ? (
				<form
					className="inv-form"
					onSubmit={(e) => {
						e.preventDefault();
						if (!reason.trim()) return;
						onVoid(reason.trim());
						reset();
					}}
				>
					<p className="eyebrow">Void this invoice</p>
					<input className="input input--sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being voided?" />
					<div className="inv-form__foot">
						<button type="submit" className="btn btn--primary btn--sm" disabled={!reason.trim()}>
							Void {inv.invoiceNumber}
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
						<span className="mono muted inv-form__hint">The record is kept — nothing is deleted.</span>
					</div>
				</form>
			) : null}

			{account && (
				<div className="card cn-now" style={{ marginTop: "1rem" }}>
					<p className="cn-detail__eyebrow">The account</p>
					<div className="cn-detail__rows">
						<div className="cn-detail__row">
							<span>
								{account.count} invoice{account.count === 1 ? "" : "s"} · {fmtGhs(account.balance)} outstanding
							</span>
							<span className="cn-detail__row-note">{account.overdue > 0 ? `${account.overdue} d overdue` : account.nextDue ? `next due ${shortDate(account.nextDue)}` : "nothing overdue"}</span>
						</div>
						<Link to="/ledger" className="cn-detail__row">
							<span>Client ledger</span>
							<span className="cn-detail__row-note">journal & milestones →</span>
						</Link>
					</div>
				</div>
			)}
			{inv.history?.length ? (
				<div className="card cn-now" style={{ marginTop: "1rem" }}>
					<p className="cn-detail__eyebrow">History</p>
					<ul className="cn-timeline">
						{[...inv.history].reverse().map((h, i) => (
							<li key={`${h.at}-${i}`} className="cn-timeline__item">
								<div className="cn-timeline__head">
									<span className="cn-timeline__summary">{h.action}</span>
									<span className="cn-timeline__when">{new Date(h.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
								</div>
								<p className="cn-timeline__meta">
									{h.detail ? `${h.detail} · ` : ""}
									{h.by}
								</p>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<p className="mono muted inv-doc__by">Acting as {by}</p>
		</div>
	);
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
	return (
		<div className={`inv-doc__total-row${strong ? " inv-doc__total-row--strong" : ""}`}>
			<span>{label}</span>
			<span className="mono">{value}</span>
		</div>
	);
}
