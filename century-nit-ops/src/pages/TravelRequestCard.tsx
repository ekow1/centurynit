import { useState } from "react";
import { applicationsApi } from "century-nit-core/api";
import type { Assignee } from "century-nit-core/ops";
import { AssignControl } from "century-nit-core/ui";
import { TRAVEL_STATUS_LABELS, type TravelAssistanceRequest } from "century-nit-shared";

const TA_STATUS_LABELS = TRAVEL_STATUS_LABELS;

/**
 * One travel request as ops works it: decision → handler → ticket invoice
 * (proforma → issued) → payment → booking. Used by the Travel queue and by
 * the case detail, so both show the same card.
 */
export function TaQueueRow({
	ta,
	onChanged,
	onSelectApp,
	staff,
	branch,
	canIssue,
	showAssign = true,
}: {
	ta: TravelAssistanceRequest;
	onChanged: () => void;
	onSelectApp?: () => void;
	staff: Assignee[];
	branch?: string;
	canIssue?: boolean;
	/** Off inside the case detail, where the header's assign sheet is the one assignment surface. */
	showAssign?: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const [showInvoiceForm, setShowInvoiceForm] = useState(false);
	const [showBookingForm, setShowBookingForm] = useState(false);
	const [showAssignForm, setShowAssignForm] = useState(false);
	const [carrier, setCarrier] = useState("");
	const [flightNumber, setFlightNumber] = useState("");
	const [ticketAmount, setTicketAmount] = useState("");
	const [notes, setNotes] = useState("");
	const [confirmationCode, setConfirmationCode] = useState("");
	const [bookingCarrier, setBookingCarrier] = useState("");
	const [bookingNotes, setBookingNotes] = useState("");
	async function assignHandler(opsUserId: string) {
		await applicationsApi.assignTravelHandler(ta.id, opsUserId);
		onChanged();
		setShowAssignForm(false);
	}

	async function raiseInvoice() {
		setBusy(true);
		try {
			await applicationsApi.raiseTravelInvoice(ta.id, {
				carrier: carrier || undefined,
				flightNumber: flightNumber || undefined,
				ticketAmountCents: Math.round(Number(ticketAmount) * 100),
				notes: notes || undefined,
			});
			onChanged();
			setShowInvoiceForm(false);
		} catch {
			/* ignore */
		} finally {
			setBusy(false);
		}
	}

	async function issueInvoice() {
		setBusy(true);
		try {
			await applicationsApi.issueTravelInvoice(ta.id);
			onChanged();
		} catch {
			/* ignore */
		} finally {
			setBusy(false);
		}
	}

	async function recordBooking() {
		setBusy(true);
		try {
			await applicationsApi.recordTravelBooking(ta.id, {
				carrier: bookingCarrier || undefined,
				confirmationCode: confirmationCode || undefined,
				notes: bookingNotes || undefined,
			});
			onChanged();
			setShowBookingForm(false);
		} catch {
			/* ignore */
		} finally {
			setBusy(false);
		}
	}

	const pendingHint =
		ta.status === "decision_pending"
			? "Waiting for applicant decision"
			: ta.status === "review" && !ta.assignedOpsUserId
				? "Assign a handler before raising the ticket invoice."
				: ta.status === "review" && ta.assignedOpsUserId
					? "Handler assigned — raise the ticket invoice (proforma) for manager approval."
					: ta.status === "quote_prepared"
						? "Proforma raised — a manager must approve & issue it before the applicant can pay."
						: ta.status === "invoiced"
							? "Waiting for applicant to pay the ticket"
							: ta.status === "booked"
								? "Booking confirmed — waiting for applicant to choose a payment plan"
								: ta.status === "cleared"
									? "Cleared to travel"
									: null;

	return (
		<div style={{ padding: "0.75rem", border: "1px solid var(--border-light)", borderRadius: "6px" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
				<div
					onClick={onSelectApp}
					style={{ cursor: onSelectApp ? "pointer" : "default", flex: 1, minWidth: 0 }}
					title={onSelectApp ? "View full case detail" : undefined}
				>
					<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
						{ta.applicantName ?? ta.applicantId.slice(0, 8)}
						{onSelectApp && <span style={{ opacity: 0.4, marginLeft: "0.35rem" }}>{"\u2192"}</span>}
					</p>
					<p className="muted" style={{ fontSize: "var(--text-xs)" }}>
						{ta.applicationReference ?? ""}
						{ta.university ? ` · ${ta.university}` : ""}
						{" — "}
						{TA_STATUS_LABELS[ta.status] ?? ta.status}
						{ta.decision ? ` · ${ta.decision}` : ""}
					</p>
					{ta.assignedOpsUserName && (
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
							Handler: {ta.assignedOpsUserName}
						</p>
					)}
				</div>
				<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
					{showAssign && ta.status === "review" && (
						<button className="btn btn--sm btn--ghost" onClick={() => setShowAssignForm((v) => !v)}>
							{ta.assignedOpsUserId ? "Reassign handler" : "Assign handler"}
						</button>
					)}
					{ta.status === "review" && ta.assignedOpsUserId && (
						<button className="btn btn--sm btn--primary" onClick={() => setShowInvoiceForm((v) => !v)}>
							Raise invoice
						</button>
					)}
					{ta.status === "quote_prepared" && canIssue && (
						<button className="btn btn--sm btn--primary" onClick={() => void issueInvoice()} disabled={busy}>
							{busy ? "Issuing…" : "Approve & issue"}
						</button>
					)}
					{ta.status === "ticket_paid" && (
						<button className="btn btn--sm btn--primary" onClick={() => setShowBookingForm((v) => !v)}>
							Record booking
						</button>
					)}
				</div>
			</div>

			{pendingHint && (
				<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem", fontStyle: "italic" }}>
					{pendingHint}
				</p>
			)}

			{showAssign && showAssignForm && ta.status === "review" && (
				<div className="mt-3">
					<AssignControl
						stage="travel_assistance"
						staff={staff}
						branch={branch}
						currentName={ta.assignedOpsUserName ?? null}
						busy={busy}
						onAssign={(opsUserId) => assignHandler(opsUserId)}
					/>
				</div>
			)}

			{showInvoiceForm && ta.status === "review" && ta.assignedOpsUserId && (
				<div style={{ marginTop: "0.75rem", display: "grid", gap: "0.4rem" }}>
					<input
						className="input input--sm"
						placeholder="Carrier (optional)"
						value={carrier}
						onChange={(e) => setCarrier(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Flight number (optional)"
						value={flightNumber}
						onChange={(e) => setFlightNumber(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Ticket amount (USD)"
						type="number"
						value={ticketAmount}
						onChange={(e) => setTicketAmount(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Notes (optional)"
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
					/>
					<button
						className="btn btn--sm btn--primary"
						onClick={() => void raiseInvoice()}
						disabled={busy || !ticketAmount}
					>
						{busy ? "Raising…" : "Raise invoice"}
					</button>
				</div>
			)}

			{showBookingForm && ta.status === "ticket_paid" && (
				<div style={{ marginTop: "0.75rem", display: "grid", gap: "0.4rem" }}>
					<input
						className="input input--sm"
						placeholder="Carrier"
						value={bookingCarrier}
						onChange={(e) => setBookingCarrier(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Confirmation code"
						value={confirmationCode}
						onChange={(e) => setConfirmationCode(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Notes (optional)"
						value={bookingNotes}
						onChange={(e) => setBookingNotes(e.target.value)}
					/>
					<button
						className="btn btn--sm btn--primary"
						onClick={() => void recordBooking()}
						disabled={busy}
					>
						{busy ? "Saving…" : "Confirm booking"}
					</button>
				</div>
			)}
		</div>
	);
}
