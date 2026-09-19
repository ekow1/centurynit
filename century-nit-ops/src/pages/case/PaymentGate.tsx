import type { ReactNode } from "react";
import type { ApiInvoice } from "../../lib/api";

/**
 * The payment gate — one band, one locked region.
 *
 * Inside a stage tab the handler's raise-invoice point is a gate: everything
 * below it locks until the invoice exists and the client has paid. The band
 * names where the chain is stuck — raised, awaiting approval, awaiting
 * payment — instead of scattering greyed buttons with tooltip-only reasons.
 *
 * Payment is automatic: the client pays in the portal, the gateway webhook
 * settles the invoice, the SSE event flips the gate open while the tab is on
 * screen. `onRecordPayment` is the fallback for cash / bank transfers only.
 */
export function PaymentGate({
	invoice,
	loading = false,
	/** What the lock protects — "Stage work", "Visa work", "Booking". */
	subject = "Stage work",
	/** Chain labels shown in the band; defaults to the invoice lifecycle. */
	steps = ["Raised", "Approved", "Issued", "Paid"],
	/** External paid signal (e.g. app.appFeePaid) — wins over invoice status. */
	paid,
	/** Force the lock state (e.g. visaStage === "locked"). Wins over invoice. */
	locked,
	/** Chain position override for custom step lists (Departure's 5 steps). */
	stepIndex,
	/** Hide the chain line — the region below already draws it (Departure rail). */
	hideChain = false,
	/** Approvers get the button right on the band when it's a proforma. */
	onApprove,
	/** Manual fallback for offline payments; omit to hide the link. */
	onRecordPayment,
	children,
}: {
	invoice: ApiInvoice | null | undefined;
	loading?: boolean;
	subject?: string;
	steps?: string[];
	paid?: boolean;
	locked?: boolean;
	stepIndex?: number;
	hideChain?: boolean;
	onApprove?: (invoice: ApiInvoice) => void;
	onRecordPayment?: () => void;
	children: ReactNode;
}) {
	// Paid (explicitly or by status), or the invoice was voided — open.
	const open = locked === undefined
		? paid === true || invoice?.status === "paid" || invoice?.status === "void"
		: !locked;
	if (open) return <>{children}</>;

	// Where the chain sits: -1 not raised, 0 raised, 1 approved/awaiting, 2 issued, 3 paid.
	const stepIdx = stepIndex ?? (invoice == null ? -1 : invoice.status === "proforma" ? 0 : 2);

	const chain = (
		<p className="payment-gate__chain">
			{steps.map((s, i) => {
				const done = stepIdx > -1 && i <= stepIdx;
				const current = i === stepIdx + 1;
				return (
					<span key={s} className={done ? "is-done" : current ? "is-current" : ""}>
						{i > 0 && <span className="payment-gate__arrow">→</span>}
						{s.toUpperCase()}
						{done ? " ✓" : current ? ` · ${invoice?.status === "proforma" ? "AWAITING" : stepIdx === -1 ? "PENDING" : "AWAITING"}` : ""}
					</span>
				);
			})}
		</p>
	);

	const headline = loading
		? `${subject} locked — checking the invoice…`
		: invoice == null
			? `${subject} locked — the invoice hasn't been raised yet`
			: invoice.status === "proforma"
				? `${subject} locked — the invoice hasn't been approved yet`
				: `${subject} locked — opens itself the moment the client pays`;

	return (
		<div className="payment-gate">
			<div className="payment-gate__band">
				<span className="payment-gate__lock" aria-hidden>🔒</span>
				<div className="payment-gate__body">
					<p className="payment-gate__headline">{headline}</p>
					{!hideChain && chain}
				</div>
				{invoice?.status === "proforma" && onApprove && (
					<button type="button" className="btn btn--sm btn--primary" onClick={() => onApprove(invoice)}>
						Approve &amp; issue
					</button>
				)}
				{invoice && invoice.status !== "proforma" && onRecordPayment && (
					<span className="payment-gate__manual">
						paid offline?{" "}
						<button type="button" className="plnk" onClick={onRecordPayment}>
							record it →
						</button>
					</span>
				)}
			</div>
			<div className="payment-gate__locked">{children}</div>
		</div>
	);
}
