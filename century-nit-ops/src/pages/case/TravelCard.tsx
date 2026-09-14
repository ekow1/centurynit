import { useState } from "react";
import { Link } from "react-router-dom";
import { applicationsApi, ApiError } from "century-nit-core/api";
import { InvoiceCard, Sheet, formatMoney } from "century-nit-core/ui";
import type { TravelAssistanceRequest, TravelFlight } from "century-nit-shared";
import type { ApiInvoice } from "../../lib/api";
import { ArtifactCard } from "./ArtifactCard";
import { ApproveInvoiceSheet } from "./ApproveInvoiceSheet";
import { centsFromGhs } from "../currency";

/**
 * One travel request as ops works it — the same shape as every other
 * chapter: the invoice card at the top, as everywhere, then the flight
 * milestone by milestone with one action each:
 *
 *   1 Decision · 2 Quote & invoice · 3 Approved & issued · 4 Paid · 5 Booked
 *
 * "Booking their own" and "on hold" leave the path at 1. The forms — the
 * quote and the booking — live in sheets, like Approve & issue. Nothing here
 * waits on the service fee: the ticket is bought when it is paid; the
 * e-ticket is handed over with the papers.
 */

function fmtWhen(iso?: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function fmtDay(iso?: string | null): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The flight on one line — carrier and number, route, departure. */
export function flightLine(flight: TravelFlight | null | undefined): string {
	if (!flight) return "";
	const route = [flight.from, flight.to].filter(Boolean).join(" → ");
	const num = [flight.carrier, flight.flightNumber].filter(Boolean).join(" ");
	return [route, num, flight.departAt ? fmtWhen(flight.departAt) : ""].filter(Boolean).join(" · ");
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
 * The quote (raises the ticket proforma) or the booking (records the PNR),
 * in a sheet: labelled fields in a grid, the fare in cedis, and a line
 * saying what the client will see.
 */
export function FlightSheet({
	mode,
	open,
	initial,
	busy,
	error,
	onSubmit,
	onClose,
}: {
	mode: "raise" | "book";
	open: boolean;
	initial?: TravelFlight | null;
	busy: boolean;
	error?: string | null;
	onSubmit: (input: { flight: TravelFlight; fareCents?: number; confirmationCode?: string }) => void;
	onClose: () => void;
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

	// The fare is entered in cedis — what the client pays — and stored as USD cents.
	const fareCents = centsFromGhs(Number(fare.replace(/[^0-9.]/g, "")) || 0);
	const ready = mode === "raise" ? fareCents > 0 : pnr.trim().length > 0;
	const preview = flightLine({ carrier, flightNumber, from, to, departAt: fromLocalInput(departAt) });

	return (
		<Sheet open={open} onClose={() => (busy ? undefined : onClose())} title={mode === "raise" ? "Quote the flight" : "Record the booking"}>
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
				<p className="cn-assign__current">
					{mode === "raise"
						? "The flight as quoted and the fare — this raises the ticket proforma for approval. The client sees it once it is issued."
						: "The ticket is bought — record the airline's confirmation. The e-ticket is uploaded on the card and handed over with the papers."}
				</p>
				{mode === "book" && (
					<label className="su-fld">
						<span className="su-k">PNR / confirmation code</span>
						<input className="input input--sm su-mono" value={pnr} onChange={(e) => setPnr(e.target.value)} disabled={busy} autoFocus />
					</label>
				)}
				<div className="su-grid su-grid--2">
					<label className="su-fld">
						<span className="su-k">Airline</span>
						<input className="input input--sm" value={carrier} onChange={(e) => setCarrier(e.target.value)} disabled={busy} placeholder="e.g. British Airways" autoFocus={mode === "raise"} />
					</label>
					<label className="su-fld">
						<span className="su-k">Flight no.</span>
						<input className="input input--sm su-mono" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} disabled={busy} placeholder="e.g. BA 078" />
					</label>
				</div>
				<div className="su-grid su-grid--2">
					<label className="su-fld">
						<span className="su-k">From</span>
						<input className="input input--sm su-mono" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} placeholder="e.g. ACC" />
					</label>
					<label className="su-fld">
						<span className="su-k">To</span>
						<input className="input input--sm su-mono" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} placeholder="e.g. LHR" />
					</label>
				</div>
				<div className="su-grid su-grid--2">
					<label className="su-fld">
						<span className="su-k">Departs</span>
						<input type="datetime-local" className="input input--sm cn-dt" value={departAt} onChange={(e) => setDepartAt(e.target.value)} disabled={busy} />
					</label>
					<label className="su-fld">
						<span className="su-k">Arrives</span>
						<input type="datetime-local" className="input input--sm cn-dt" value={arriveAt} onChange={(e) => setArriveAt(e.target.value)} disabled={busy} />
					</label>
				</div>
				{mode === "raise" && (
					<label className="su-fld">
						<span className="su-k">Fare · GH₵ — the airline ticket only; the service fee is in the package</span>
						<input className="input input--sm su-mono" inputMode="decimal" value={fare} onChange={(e) => setFare(e.target.value)} disabled={busy} placeholder="e.g. 9800.00" />
					</label>
				)}
				<label className="su-fld">
					<span className="su-k">Note to the client (optional)</span>
					<textarea className="input input--sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} placeholder="e.g. 23kg checked bag included; change fee applies after 20 Oct" />
				</label>
				{(preview || fareCents > 0 || pnr) && (
					<p className="su-preview">
						<span className="su-k">The client will see</span>
						{[preview, mode === "raise" && fareCents > 0 ? formatMoney(fareCents, "ghs") : "", mode === "book" && pnr ? `PNR ${pnr.trim()}` : ""].filter(Boolean).join(" · ")}
						{mode === "raise" ? ' — "Flight ticket" on their Money page once issued.' : " — on their Departure page, with the e-ticket once uploaded."}
					</p>
				)}
				{mode === "raise" && !ready && fare.length > 0 && <p className="cn-assign__error">The fare must be more than zero.</p>}
				{error && <p className="cn-assign__error">{error}</p>}
				<div className="cn-assign__row">
					<button type="submit" className="btn btn--primary" disabled={busy || !ready}>
						{busy ? "Saving…" : mode === "raise" ? "Raise ticket invoice →" : "Record booking →"}
					</button>
					<button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
						Cancel
					</button>
				</div>
			</form>
		</Sheet>
	);
}

/** One milestone row — the visa tab's shape: a numbered square, the title, its facts, one action. */
function Step({ n, title, state, facts, action }: { n: number; title: string; state: "done" | "current" | "todo"; facts: (string | null | false | undefined)[]; action?: React.ReactNode }) {
	const shown = facts.filter(Boolean) as string[];
	return (
		<div className={`cn-ms cn-ms--${state}`}>
			<span className="cn-ms__n">{state === "done" ? "✓" : n}</span>
			<div className="cn-ms__b">
				<span className="cn-ms__t">{title}</span>
				{shown.map((f) => (
					<span key={f} className="cn-ms__f">
						{f}
					</span>
				))}
				{action && <div className="cn-ms__a">{action}</div>}
			</div>
		</div>
	);
}

/**
 * The flight: the ticket invoice card (the same as every other invoice),
 * then the five milestones. `invoice` is the ticket invoice when the caller
 * has it (the case detail does; the queue does not).
 */
export function TravelCard({
	ta,
	invoice,
	canWork,
	canIssueInvoices,
	canUploadArtifacts = false,
	ownerUserId = null,
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
	const offPath = status === "declined" || status === "on_hold";
	const decided = Boolean(ta.decision);
	const decidedOn = fmtDay(ta.updatedAt);
	const invoiceIssued = Boolean(invoice && invoice.status !== "proforma" && invoice.status !== "void");
	const paid = invoice?.status === "paid" || status === "ticket_paid" || status === "booked";
	const booked = status === "booked";
	const issuedBy = invoice?.issuedByName ?? null;
	const paidAt = invoice?.payments?.length ? [...invoice.payments].sort((a, b) => (a.at < b.at ? 1 : -1))[0]?.at : null;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
			<ApproveInvoiceSheet invoice={approving} onClose={() => setApproving(null)} onIssued={onChanged} onDeclined={onChanged} />

			{/* The ticket invoice — the same card as the application and visa invoices */}
			{invoice ? (
				<InvoiceCard
					compact={invoice.status === "paid"}
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
			) : (
				<div className="cn-inv-none">
					<div>
						<b>Ticket invoice</b>
						<small>
							{offPath
								? status === "declined"
									? "not needed — the client is booking their own flight"
									: "on hold — the client can resume from the portal"
								: status === "decision_pending"
									? "raised once the client asks us to book"
									: "not raised yet — quote the flight below; the client pays it in Money"}
						</small>
					</div>
					<span className="cn-inv-none__k">—</span>
				</div>
			)}

			<div className="cn-stack">
				<Step
					n={1}
					title="Decision"
					state={decided ? "done" : "current"}
					facts={[
						!decided && "Waiting for the client to decide how they want to book — on their Departure page.",
						ta.decision === "yes" && `Asked us to book${decidedOn ? ` · ${decidedOn}` : ""}`,
						ta.decision === "no" && `Booking their own flight${decidedOn ? ` · ${decidedOn}` : ""} — travel is settled on their word`,
						ta.decision === "hold" && `On hold${decidedOn ? ` · ${decidedOn}` : ""} — they can resume from the portal`,
						ta.applicantNote && `“${ta.applicantNote}”`,
					]}
				/>
				<Step
					n={2}
					title="Quote & invoice"
					state={invoice ? "done" : !offPath && status === "review" ? "current" : "todo"}
					facts={[
						offPath && "Not on this path.",
						!invoice && status === "review" && !ta.assignedOpsUserId && "Assign a departure officer first — from the case header.",
						!invoice && status === "review" && ta.assignedOpsUserId && `${ta.assignedOpsUserName ?? "The officer"} quotes the flight and its fare; this raises the proforma. Nothing waits on the service fee.`,
						invoice && flightLine(ta.flight),
						invoice && `${formatMoney(invoice.subtotalCents, "ghs")}${invoice.raisedAt ? ` · quoted ${fmtDay(invoice.raisedAt)}` : invoice.createdAt ? ` · quoted ${fmtDay(invoice.createdAt)}` : ""}`,
						invoice && ta.flight?.notes && `Note to the client: ${ta.flight.notes}`,
					]}
					action={
						canWork && !invoice && status === "review" && ta.assignedOpsUserId ? (
							<button type="button" className="btn btn--sm btn--primary" onClick={() => setForm("raise")}>
								Quote the flight…
							</button>
						) : undefined
					}
				/>
				<Step
					n={3}
					title="Approved & issued"
					state={invoiceIssued || paid ? "done" : invoice?.status === "proforma" ? "current" : "todo"}
					facts={[
						invoice?.status === "proforma" && "Waiting on finance — Approve & issue above. The client sees it once issued.",
						invoiceIssued && `Issued${invoice?.reviewedAt ? ` ${fmtDay(invoice.reviewedAt)}` : ""}${issuedBy ? ` by ${issuedBy}` : ""}`,
						!invoice && !offPath && "Finance approves; the client can then see and pay it.",
					]}
				/>
				<Step
					n={4}
					title="Paid"
					state={paid ? "done" : invoiceIssued ? "current" : "todo"}
					facts={[
						paid && `Paid${paidAt ? ` ${fmtDay(paidAt)}` : ""}${invoice ? ` · ${formatMoney(invoice.subtotalCents, "ghs")}` : ""}`,
						!paid && invoiceIssued && "Waiting for the client — it is on their Money page. Record a transfer from the invoice.",
						!paid && !invoiceIssued && !offPath && "Recorded from the ledger.",
					]}
				/>
				<Step
					n={5}
					title="Booked"
					state={booked ? "done" : status === "ticket_paid" ? "current" : "todo"}
					facts={[
						booked && ta.booking && `${ta.booking.confirmationCode ? `PNR ${ta.booking.confirmationCode} · ` : ""}${flightLine(ta.booking)}`,
						booked && `Booked${ta.updatedAt ? ` ${fmtDay(ta.updatedAt)}` : ""} — the e-ticket is handed over with the papers.`,
						status === "ticket_paid" && "Buy the ticket and record the PNR; upload the e-ticket — it is handed over with the papers.",
						!booked && status !== "ticket_paid" && !offPath && "PNR and the e-ticket — held with the papers until the 30%.",
					]}
					action={
						canWork && status === "ticket_paid" ? (
							<button type="button" className="btn btn--sm btn--primary" onClick={() => setForm("book")}>
								Record booking…
							</button>
						) : undefined
					}
				/>
			</div>

			{(status === "ticket_paid" || booked) && ownerUserId && (
				<ArtifactCard
					ownerUserId={ownerUserId}
					documentType="flight_receipt"
					title="E-ticket · flight booking receipt"
					hint="The issued ticket or booking confirmation — filed in the client's vault and released with the papers once the pre-departure milestone is paid."
					canUpload={canUploadArtifacts}
				/>
			)}

			{form !== "none" && (
				<FlightSheet
					key={form}
					mode={form}
					open
					initial={form === "book" ? ta.flight : null}
					busy={busy}
					error={error}
					onClose={() => {
						setForm("none");
						setError(null);
					}}
					onSubmit={({ flight, fareCents, confirmationCode }) =>
						void run(() =>
							form === "raise"
								? applicationsApi.raiseTravelInvoice(ta.id, { fareCents: fareCents ?? 0, flight })
								: applicationsApi.recordTravelBooking(ta.id, { ...flight, confirmationCode }),
						)
					}
				/>
			)}
			{error && form === "none" && <p className="cn-assign__error">{error}</p>}
		</div>
	);
}
