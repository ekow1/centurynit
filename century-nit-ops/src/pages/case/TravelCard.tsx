import { useState } from "react";
import { Link } from "react-router-dom";
import { applicationsApi, ApiError } from "century-nit-core/api";
import { InvoiceCard, TravelStatusPill } from "century-nit-core/ui";
import type { TravelAssistanceRequest, TravelFlight } from "century-nit-shared";
import type { ApiInvoice } from "../../lib/api";
import { ArtifactCard } from "./ArtifactCard";
import { ApproveInvoiceSheet } from "./ApproveInvoiceSheet";

/**
 * One travel request as ops works it — one path, one card:
 *
 *   decide → handler assigned → ticket invoice raised (and issued) → paid →
 *   booked. "Booking their own" and "on hold" leave the path.
 *
 * `TravelCard` is the case-tab view: status, the flight, and the single
 * next action. `TaQueueRow` wraps it for the Travel queue with the
 * applicant's name and the assign control (assignment inside a case lives
 * in the case header).
 */

function fmtWhen(iso?: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The flight as a few rows; the same rendering for the invoice's flight and the booked one. */
export function FlightSummary({ flight, confirmationCode }: { flight: TravelFlight | null; confirmationCode?: string }) {
	if (!flight && !confirmationCode) return null;
	const route = [flight?.from, flight?.to].filter(Boolean).join(" → ");
	const rows: [string, string][] = [];
	if (confirmationCode) rows.push(["PNR", confirmationCode]);
	if (flight?.carrier || flight?.flightNumber) rows.push(["Flight", [flight.carrier, flight.flightNumber].filter(Boolean).join(" ")]);
	if (route) rows.push(["Route", route]);
	if (flight?.departAt) rows.push(["Departs", fmtWhen(flight.departAt)]);
	if (flight?.arriveAt) rows.push(["Arrives", fmtWhen(flight.arriveAt)]);
	return (
		<dl className="cn-case__facts" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.2rem 1rem", margin: 0 }}>
			{rows.map(([k, v]) => (
				<span key={k} style={{ display: "contents" }}>
					<dt className="muted" style={{ fontSize: "var(--text-xs)" }}>{k}</dt>
					<dd style={{ margin: 0, fontSize: "var(--text-sm)" }}>{v}</dd>
				</span>
			))}
			{flight?.notes && (
				<span style={{ display: "contents" }}>
					<dt className="muted" style={{ fontSize: "var(--text-xs)" }}>Notes</dt>
					<dd style={{ margin: 0, fontSize: "var(--text-sm)", whiteSpace: "pre-wrap" }}>{flight.notes}</dd>
				</span>
			)}
		</dl>
	);
}

/** Datetime-local wants "YYYY-MM-DDTHH:mm"; the API wants ISO with an offset. */
const toLocalInput = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);

/**
 * The flight form — raising the ticket invoice (fare + flight) or recording
 * the booking (PNR + the flight as actually booked, prefilled from the
 * invoice's flight).
 */
export function FlightForm({
	mode,
	initial,
	busy,
	onSubmit,
	onCancel,
}: {
	mode: "raise" | "book";
	initial?: TravelFlight | null;
	busy: boolean;
	onSubmit: (input: { flight: TravelFlight; fareCents?: number; confirmationCode?: string }) => void;
	onCancel: () => void;
}) {
	const [carrier, setCarrier] = useState(initial?.carrier ?? "");
	const [flightNumber, setFlightNumber] = useState(initial?.flightNumber ?? "");
	const [from, setFrom] = useState(initial?.from ?? "");
	const [to, setTo] = useState(initial?.to ?? "");
	const [departAt, setDepartAt] = useState(toLocalInput(initial?.departAt));
	const [arriveAt, setArriveAt] = useState(toLocalInput(initial?.arriveAt));
	const [notes, setNotes] = useState(initial?.notes ?? "");
	const [fare, setFare] = useState("");
	const [pnr, setPnr] = useState("");

	const fareCents = Math.round(Number(fare) * 100);
	const ready = mode === "raise" ? fareCents > 0 : pnr.trim().length > 0;

	return (
		<form
			className="cn-assign"
			onSubmit={(e) => {
				e.preventDefault();
				if (!ready) return;
				onSubmit({
					flight: {
						carrier: carrier || undefined,
						flightNumber: flightNumber || undefined,
						from: from || undefined,
						to: to || undefined,
						departAt: fromLocalInput(departAt),
						arriveAt: fromLocalInput(arriveAt),
						notes: notes || undefined,
					},
					fareCents: mode === "raise" ? fareCents : undefined,
					confirmationCode: mode === "book" ? pnr.trim() : undefined,
				});
			}}
		>
			{mode === "book" && (
				<input className="input input--sm" placeholder="PNR / confirmation code" value={pnr} onChange={(e) => setPnr(e.target.value)} disabled={busy} autoFocus />
			)}
			<div className="cn-assign__row">
				<input className="input input--sm" placeholder="Airline" value={carrier} onChange={(e) => setCarrier(e.target.value)} disabled={busy} />
				<input className="input input--sm" placeholder="Flight no." value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} disabled={busy} style={{ flex: "0 1 8rem", minWidth: "6rem" }} />
			</div>
			<div className="cn-assign__row">
				<input className="input input--sm" placeholder="From (e.g. ACC)" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
				<input className="input input--sm" placeholder="To (e.g. LHR)" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
			</div>
			<div className="cn-assign__row">
				<label className="muted" style={{ fontSize: "var(--text-xs)", display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1 }}>
					Departs
					<input type="datetime-local" className="input input--sm" value={departAt} onChange={(e) => setDepartAt(e.target.value)} disabled={busy} />
				</label>
				<label className="muted" style={{ fontSize: "var(--text-xs)", display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1 }}>
					Arrives
					<input type="datetime-local" className="input input--sm" value={arriveAt} onChange={(e) => setArriveAt(e.target.value)} disabled={busy} />
				</label>
			</div>
			{mode === "raise" && (
				<input
					type="number"
					min="0"
					step="0.01"
					className="input input--sm"
					placeholder="Fare (USD) — the airline ticket only; the service fee is in the package"
					value={fare}
					onChange={(e) => setFare(e.target.value)}
					disabled={busy}
					autoFocus
				/>
			)}
			<textarea className="input" rows={2} placeholder="Notes for the applicant (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
			<div className="cn-assign__row">
				<button type="submit" className="btn btn--sm btn--primary" disabled={busy || !ready}>
					{busy ? "Saving…" : mode === "raise" ? "Raise ticket invoice" : "Record booking"}
				</button>
				<button type="button" className="btn btn--sm btn--ghost" onClick={onCancel} disabled={busy}>
					Cancel
				</button>
			</div>
		</form>
	);
}

/**
 * Status, the flight, and the one next action. `invoice` is the ticket
 * invoice when the caller has it (the case detail does; the queue does
 * not) — it decides whether "raised" means "awaiting issue" or "awaiting
 * payment" and gives finance the link to issue it.
 */
export function TravelCard({
	ta,
	invoice,
	canWork,
	canIssueInvoices,
	canUploadArtifacts = false,
	ownerUserId = null,
	feeBlock = null,
	onChanged,
}: {
	ta: TravelAssistanceRequest;
	invoice?: ApiInvoice | null;
	/** May raise the invoice and record the booking (the handler or a manager). */
	canWork: boolean;
	/** Holds the invoices module — sees the Review & issue link. */
	canIssueInvoices: boolean;
	/** Holds the documents module — may place the flight receipt on the client's record. */
	canUploadArtifacts?: boolean;
	/** Portal user the flight receipt belongs to. */
	ownerUserId?: string | null;
	/** Why the ticket cannot be invoiced yet (the pre-departure fee milestone), or null. */
	feeBlock?: string | null;
	onChanged: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [form, setForm] = useState<"none" | "raise" | "book">("none");
	const [error, setError] = useState<string | null>(null);
	const [approving, setApproving] = useState<ApiInvoice | null>(null);

	async function run(fn: () => Promise<unknown>) {
		setBusy(true);
		setError(null);
		try {
			await fn();
			setForm("none");
			onChanged();
		} catch (e) {
			setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong");
		} finally {
			setBusy(false);
		}
	}

	const status = ta.status;
	const line =
		status === "decision_pending"
			? "Waiting for the applicant to decide how they want to book."
			: status === "review" && !ta.assignedOpsUserId
				? "Assign a travel handler to raise the ticket invoice."
				: status === "review"
					? `${ta.assignedOpsUserName ?? "The handler"} raises the ticket invoice for the flight.`
					: status === "invoiced"
						? invoice?.status === "proforma"
							? "Ticket invoice raised — finance reviews and issues it, then the applicant can pay."
							: "Ticket invoice issued — waiting for the applicant to pay."
						: status === "ticket_paid"
							? "Ticket paid — record the booking once the airline confirms it."
							: status === "booked"
								? "Flight booked. The case has moved on to Payment Execution."
								: status === "declined"
									? "The applicant is booking their own flight. Travel is settled."
									: "Travel assistance is on hold — the applicant can resume from the portal.";

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
			<div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
				<TravelStatusPill status={status} />
				<p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>{line}</p>
			</div>

			{status === "booked" && ta.booking ? (
				<FlightSummary flight={ta.booking} confirmationCode={ta.booking.confirmationCode} />
			) : ta.flight ? (
				<FlightSummary flight={ta.flight} />
			) : null}

			<ApproveInvoiceSheet invoice={approving} onClose={() => setApproving(null)} onIssued={onChanged} onDeclined={onChanged} />

			{invoice && (
				<InvoiceCard
					compact
					title="Ticket invoice"
					invoice={invoice}
					hint={invoice.status === "proforma" ? "Awaiting approval — the client cannot see or pay it until it is issued." : undefined}
					actions={
						canIssueInvoices ? (
							invoice.status === "proforma" ? (
								<button type="button" className="btn btn--sm btn--primary" onClick={() => setApproving(invoice)}>
									Approve & issue
								</button>
							) : (
								<Link to={`/invoices?open=${invoice.id}`} className="btn btn--sm btn--ghost">
									Open in Money →
								</Link>
							)
						) : undefined
					}
				/>
			)}

			{canWork && form === "none" && status === "review" && ta.assignedOpsUserId && (
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<button type="button" className="btn btn--sm btn--primary" onClick={() => setForm("raise")} disabled={Boolean(feeBlock)} title={feeBlock ?? undefined}>
						Raise ticket invoice
					</button>
					{feeBlock && <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{feeBlock}</span>}
				</div>
			)}
			{canWork && form === "none" && status === "ticket_paid" && (
				<div>
					<button type="button" className="btn btn--sm btn--primary" onClick={() => setForm("book")}>
						Record booking
					</button>
				</div>
			)}
			{form === "raise" && (
				<FlightForm
					mode="raise"
					busy={busy}
					onCancel={() => setForm("none")}
					onSubmit={({ flight, fareCents }) =>
						void run(() => applicationsApi.raiseTravelInvoice(ta.id, { fareCents: fareCents ?? 0, flight }))
					}
				/>
			)}
			{form === "book" && (
				<FlightForm
					mode="book"
					initial={ta.flight}
					busy={busy}
					onCancel={() => setForm("none")}
					onSubmit={({ flight, confirmationCode }) =>
						void run(() => applicationsApi.recordTravelBooking(ta.id, { ...flight, confirmationCode }))
					}
				/>
			)}
			{(status === "ticket_paid" || status === "booked") && ownerUserId && (
				<ArtifactCard
					ownerUserId={ownerUserId}
					documentType="flight_receipt"
					title="Flight booking receipt"
					hint="The issued ticket or booking confirmation — shared with the client via their document vault."
					canUpload={canUploadArtifacts}
				/>
			)}
			{error && <p className="cn-assign__error">{error}</p>}
		</div>
	);
}
