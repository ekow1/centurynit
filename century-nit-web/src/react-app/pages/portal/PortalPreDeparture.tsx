import { useEffect, useState } from "react";
import { useAppState } from "../../context/AppState";
import { Button } from "../../components/ui/Button";
import { ChapterGate } from "./PortalLayout";
import { meApi, ApiError } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { usdFromCents, type ApiInvoice } from "century-nit-shared";

export function PortalPreDeparture() {
	return (
		<ChapterGate chapter="travel_assistance">
			<TravelAssistanceInner />
		</ChapterGate>
	);
}

function TravelAssistanceInner() {
	const {
		application,
		syncFromServer,
		recordTravelDecision,
		approveTravelQuote,
		requestTravelQuoteChanges,
	} = useAppState();
	const { toast } = useNotifier();

	const ta = application.travelAssistance;
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState("");

	const ticketingPaid = Boolean(application.travelInvoicePaid);

	// Fetch the real server travel invoice on mount so the card reflects
	// actual status and a real Paystack checkout can be charged against it.
	const [serverInv, setServerInv] = useState<ApiInvoice | null>(null);
	const [payPhase, setPayPhase] = useState<"idle" | "loading">("idle");

	useEffect(() => {
		let cancelled = false;
		meApi
			.invoices()
			.then(({ invoices }) => {
				if (cancelled) return;
				setServerInv(invoices.find((i) => i.type === "travel") ?? null);
			})
			.catch(() => {});
		return () => { cancelled = true; };
	}, []);

	const trip = serverInv ?? null;
	const tripDue = Boolean(trip) && trip?.status !== "paid" && (trip?.balanceCents ?? 0) > 0;
	const tripAmountCents = trip ? (trip.balanceCents > 0 ? trip.balanceCents : trip.subtotalCents) : 0;
	const ticketingEffectivePaid = ticketingPaid || (trip?.status === "paid");

	async function payTicketing() {
		setPayPhase("loading");
		try {
			let backend = serverInv && serverInv.balanceCents > 0 ? serverInv : null;
			if (!backend) {
				const { invoices } = await meApi.invoices();
				backend = invoices.find((i) => i.type === "travel" && i.balanceCents > 0) ?? null;
			}
			if (!backend) {
				toast.error(
					"Your ticket invoice has not been issued on the server yet. Ask your consultant to raise it.",
				);
				return;
			}
			const checkout = await meApi.paystackCheckout(backend.id);
			if (checkout.authorizationUrl && checkout.authorizationUrl.startsWith("http")) {
				window.location.href = checkout.authorizationUrl;
				return;
			}
			toast.error("Could not initialize Paystack checkout.");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Payment could not be processed. Please try again.",
			);
		} finally {
			setPayPhase("idle");
		}
	}

	async function handleDecision(decision: "yes" | "hold" | "no") {
		if (busy) return;
		setBusy(true);
		try {
			await recordTravelDecision(decision);
			await syncFromServer();
			if (decision === "yes") {
				toast.success("Your consultant will prepare a flight quote for your review.");
			} else if (decision === "hold") {
				toast.info("Travel assistance is on hold. You can resume anytime.");
			} else {
				toast.info("You've chosen to arrange your own flight. Safe travels!");
			}
		} catch {
			/* error already surfaced by AppState */
		} finally {
			setBusy(false);
		}
	}

	async function handleApprove() {
		if (busy) return;
		setBusy(true);
		try {
			await approveTravelQuote(note.trim() || undefined);
			await syncFromServer();
			toast.success("Quote approved. Your ticket invoice will be raised shortly.");
		} catch {
			/* error already surfaced */
		} finally {
			setBusy(false);
			setNote("");
		}
	}

	async function handleRequestChanges() {
		if (busy) return;
		setBusy(true);
		try {
			await requestTravelQuoteChanges(note.trim() || undefined);
			await syncFromServer();
			toast.info("Changes requested. Your consultant will revise the quote.");
		} catch {
			/* error already surfaced */
		} finally {
			setBusy(false);
			setNote("");
		}
	}

	async function handleAdvanceToPlan() {
		try {
			await meApi.advanceToPaymentPlan();
			await syncFromServer();
			toast.success("Your payment plan chapter is now open.");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Could not open your payment plan. Please try again.",
			);
		}
	}

	if (payPhase === "loading") {
		return (
			<div className="portal-page">
				<div className="loading-overlay">
					<div className="spinner" aria-hidden />
					<p className="mono">Contacting payment provider…</p>
				</div>
			</div>
		);
	}

	const status = ta?.status ?? "decision_pending";
	const showDecision =
		!ta || status === "decision_pending" || status === "on_hold" || status === "declined";
	const showQuote = status === "quote_prepared";
	const showAwaitingInvoice = status === "quote_approved";
	const showInvoice = status === "invoiced";
	const showBooked = status === "booked";
	const showReview = status === "review";

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Travel assistance</p>
					<h1 className="page-title mt-1">Flight booking</h1>
					<p className="lead mt-2">
						Your visa is sorted. Let us know how you'd like to handle your flight, and we'll take it
						from there. The flight booking service fee is already included in your payment plan —
						any invoice here is only for the airline ticket itself.
					</p>
				</div>
			</header>

			{/* 3-way decision */}
			{showDecision && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">How would you like to book your flight?</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							Choose whether you'd like our team to help book your flight, hold for now, or arrange
							your own travel. You can change your mind until a quote is approved.
						</p>
						<div className="portal-grid portal-grid--3 mt-4">
							<DecisionCard
								title="Yes, help me book"
								description="Our travel desk will prepare a flight quote for your review. You approve before any ticket invoice is raised."
								icon="✈"
								onClick={() => void handleDecision("yes")}
								disabled={busy}
								highlighted={ta?.decision === "yes"}
							/>
							<DecisionCard
								title="Hold for now"
								description="Park your travel assistance. No invoice is raised and no handler is assigned. You can resume anytime."
								icon="⏸"
								onClick={() => void handleDecision("hold")}
								disabled={busy}
								highlighted={ta?.decision === "hold"}
							/>
							<DecisionCard
								title="I'll arrange my own"
								description="Opt out of travel assistance. Your journey continues without a flight booking from us."
								icon="✕"
								onClick={() => void handleDecision("no")}
								disabled={busy}
								highlighted={ta?.decision === "no"}
							/>
						</div>
						{status === "on_hold" && (
							<p className="muted mt-3" style={{ fontSize: "0.85rem" }}>
								You're on hold. Pick an option above when you're ready.
							</p>
						)}
						{status === "declined" && (
							<p className="muted mt-3" style={{ fontSize: "0.85rem" }}>
								You've opted out of travel assistance. Choose "Yes" above if you'd like us to help
								after all.
							</p>
						)}
					</div>
				</section>
			)}

			{/* Review — Ops is preparing the quote */}
			{showReview && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Preparing your flight quote</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							Your consultant is preparing a flight option for you. You'll be able to review and
							approve it here once it's ready.
						</p>
					</div>
				</section>
			)}

			{/* Quote ready for review */}
			{showQuote && ta?.quote && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Flight quote — review & approve</p>
						<div className="mt-3" style={{ display: "grid", gap: "0.75rem" }}>
							{ta.quote.carrier && <QuoteRow label="Carrier" value={ta.quote.carrier} />}
							{ta.quote.flightNumber && (
								<QuoteRow label="Flight" value={ta.quote.flightNumber} />
							)}
							{ta.quote.departure?.from && (
								<QuoteRow
									label="Departure"
									value={`${ta.quote.departure.from}${ta.quote.departure.at ? ` · ${ta.quote.departure.at}` : ""}`}
								/>
							)}
							{ta.quote.arrival?.to && (
								<QuoteRow
									label="Arrival"
									value={`${ta.quote.arrival.to}${ta.quote.arrival.at ? ` · ${ta.quote.arrival.at}` : ""}`}
								/>
							)}
							{ta.quote.fareBreakdown && ta.quote.fareBreakdown.length > 0 && (
								<div className="mt-2">
									<p className="muted" style={{ fontSize: "0.8rem" }}>
										Fare breakdown
									</p>
									<ul style={{ listStyle: "none", margin: 0, padding: 0, marginTop: "0.5rem" }}>
										{ta.quote.fareBreakdown.map((f, i) => (
											<li
												key={i}
												style={{
													display: "flex",
													justifyContent: "space-between",
													padding: "0.4rem 0",
													borderBottom: "1px solid var(--border-light)",
													fontSize: "0.85rem",
												}}
											>
												<span>{f.label}</span>
												<span>${usdFromCents(f.amountCents)}</span>
											</li>
										))}
									</ul>
								</div>
							)}
							{ta.ticketAmountCents != null && (
								<p className="display mt-2" style={{ fontSize: "1.25rem" }}>
									Ticket total: ${usdFromCents(ta.ticketAmountCents)}
								</p>
							)}
							{ta.quote.notes && (
								<p className="muted" style={{ fontSize: "0.85rem" }}>
									{ta.quote.notes}
								</p>
							)}
						</div>

						<div className="mt-4">
							<label className="muted" style={{ fontSize: "0.8rem" }}>
								Note (optional)
							</label>
							<textarea
								value={note}
								onChange={(e) => setNote(e.target.value)}
								placeholder="Add a note for your consultant…"
								style={{
									width: "100%",
									minHeight: "80px",
									marginTop: "0.4rem",
									padding: "0.6rem",
									border: "1px solid var(--border)",
									borderRadius: "6px",
									fontFamily: "inherit",
									fontSize: "0.85rem",
								}}
							/>
						</div>

						<div className="row mt-4" style={{ gap: "0.75rem" }}>
							<Button variant="primary" onClick={() => void handleApprove()} disabled={busy}>
								{busy ? "Approving…" : "Approve & raise invoice"}
							</Button>
							<Button variant="ghost" onClick={() => void handleRequestChanges()} disabled={busy}>
								{busy ? "Sending…" : "Request changes"}
							</Button>
						</div>
						<p className="muted mt-3" style={{ fontSize: "0.78rem" }}>
							Approving raises your ticket invoice. The flight booking service fee is already
							covered by your payment plan — this invoice is only for the airline fare.
						</p>
					</div>
				</section>
			)}

			{/* Quote approved — awaiting invoice */}
			{showAwaitingInvoice && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Quote approved</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							Your quote is approved. Your consultant is raising the ticket invoice — check back
							shortly to pay it.
						</p>
					</div>
				</section>
			)}

			{/* Ticket invoice — pay it */}
			{showInvoice && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Ticket invoice</p>
						<div className="row mt-2" style={{ alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
							<div>
								<p className="display" style={{ fontSize: "1.25rem" }}>
									{tripDue ? `$${usdFromCents(tripAmountCents)}` : "Flight ticket"}
								</p>
								<p className="muted" style={{ fontSize: "0.85rem" }}>
									{ticketingEffectivePaid
										? "Paid — your flight ticket is settled."
										: tripDue
											? `Invoice ${trip?.invoiceNumber ?? ""} · awaiting payment`
											: "Awaiting invoice from your consultant."}
								</p>
							</div>
							<div className="row" style={{ marginLeft: "auto" }}>
								{!ticketingEffectivePaid ? (
									<Button variant="primary" onClick={() => void payTicketing()} disabled={!tripDue}>
										{!tripDue && !trip ? "Awaiting invoice…" : "Pay ticket"}
									</Button>
								) : (
									<span className="success-check" aria-hidden>
										✓
									</span>
								)}
							</div>
						</div>
					</div>
				</section>
			)}

			{/* Booked — confirmation */}
			{showBooked && ta?.bookingConfirmation && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Flight booked 🛫</p>
						<div className="mt-2" style={{ display: "grid", gap: "0.5rem" }}>
							{ta.bookingConfirmation.carrier && (
								<QuoteRow label="Carrier" value={ta.bookingConfirmation.carrier} />
							)}
							{ta.bookingConfirmation.confirmationCode && (
								<QuoteRow label="Confirmation code" value={ta.bookingConfirmation.confirmationCode} />
							)}
							{ta.bookingConfirmation.notes && (
								<p className="muted" style={{ fontSize: "0.85rem" }}>
									{ta.bookingConfirmation.notes}
								</p>
							)}
						</div>
					</div>
				</section>
			)}

			{/* Next action: move on to the payment plan */}
			<div className="card card--pad mt-5 next-action">
				<p className="eyebrow">Next step</p>
				<p className="display mt-2" style={{ fontSize: "1.25rem" }}>
					{status === "booked"
						? "You're ready to fly 🛫"
						: status === "declined"
							? "Travel arranged independently"
							: "Payment plan"}
				</p>
				<p className="muted mt-1">
					{status === "booked"
						? "Your flight is booked. Move to your payment plan to settle your service fee and complete your journey."
						: status === "declined"
							? "You've opted out of travel assistance. Move to your payment plan to settle your service fee and complete your journey."
							: "Once your flight is sorted, move to your payment plan to settle your service fee and complete your journey."}
				</p>
				<div className="row mt-3">
					<Button className="btn btn--primary" onClick={() => void handleAdvanceToPlan()}>
						Move to Payment Plan →
					</Button>
					<Button to="/portal/payment-execution" variant="ghost">
						See payment plan
					</Button>
				</div>
			</div>

			<div className="card card--pad mt-5">
				<p className="eyebrow">Need help?</p>
				<p className="muted mt-2">
					Message your consultant through the chat widget at the bottom right of the portal if you
					have questions about your flight or quote.
				</p>
			</div>
		</div>
	);
}

function DecisionCard({
	title,
	description,
	icon,
	onClick,
	disabled,
	highlighted,
}: {
	title: string;
	description: string;
	icon: string;
	onClick: () => void;
	disabled?: boolean;
	highlighted?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			style={{
				textAlign: "left",
				cursor: disabled ? "wait" : "pointer",
				padding: "1.25rem",
				borderRadius: "8px",
				border: highlighted ? "2px solid var(--foreground)" : "1px solid var(--border)",
				background: highlighted ? "var(--accent-light, transparent)" : "transparent",
				display: "flex",
				flexDirection: "column",
				gap: "0.5rem",
				fontFamily: "inherit",
			}}
		>
			<span style={{ fontSize: "1.5rem" }}>{icon}</span>
			<span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{title}</span>
			<span className="muted" style={{ fontSize: "0.82rem" }}>
				{description}
			</span>
		</button>
	);
}

function QuoteRow({ label, value }: { label: string; value: string }) {
	return (
		<div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
			<span className="muted">{label}</span>
			<span style={{ fontWeight: 500 }}>{value}</span>
		</div>
	);
}