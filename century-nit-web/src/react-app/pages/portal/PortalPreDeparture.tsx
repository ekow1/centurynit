import { useEffect, useState, type CSSProperties } from "react";
import { InvoiceCard, formatMoney } from "century-nit-core/ui";
import { downloadReceipt } from "../../lib/receipt";
import { useAppState } from "../../context/AppState";
import { Button } from "../../components/ui/Button";
import { ChapterGate } from "./PortalLayout";
import { meApi, ApiError } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import type { ApiInvoice } from "century-nit-shared";

export function PortalPreDeparture() {
	return (
		<ChapterGate chapter="travel_assistance">
			<TravelAssistanceInner />
		</ChapterGate>
	);
}

function TravelAssistanceInner() {
	const { application, syncFromServer, recordTravelDecision } = useAppState();
	const { toast } = useNotifier();

	const ta = application.travelAssistance;
	const [busy, setBusy] = useState(false);

	const ticketingPaid = Boolean(application.travelInvoicePaid);

	// Fetch the real server travel invoice on mount so the card reflects
	// actual status and a real Paystack checkout can be charged against it.
	const [serverInv, setServerInv] = useState<ApiInvoice | null>(null);
	const [payPhase, setPayPhase] = useState<"idle" | "loading">("idle");
	const [planChoice, setPlanChoice] = useState<"full" | "installment">("full");

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
	// A proforma invoice is not payable yet — the manager must approve & issue
	// it first. Show "Awaiting approval" instead of a Pay button.
	const tripProforma = Boolean(trip) && trip?.status === "proforma";
	const tripDue = Boolean(trip) && trip?.status !== "paid" && !tripProforma && (trip?.balanceCents ?? 0) > 0;
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
				toast.success("Your request has been sent to our travel team.");
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

	async function handleChoosePlan() {
		if (busy) return;
		setBusy(true);
		try {
			await meApi.chooseTravelPlan({ paymentPlanId: planChoice });
			await syncFromServer();
			toast.success("Payment plan chosen. You're cleared to travel!");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Could not choose your payment plan. Please try again.",
			);
		} finally {
			setBusy(false);
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
	// If a travel invoice exists on the server, always surface it — even if
	// the TA request status hasn't been updated to "invoiced" yet. The
	// server invoice is the source of truth for payment.
	// `quote_prepared`/`quote_approved` are legacy statuses from the removed
	// quote flow; keep them covered here so a stray legacy row never renders
	// a blank page between the header and the help card.
	const showReview =
		(status === "review" || status === "quote_prepared" || status === "quote_approved") && !trip;
	const showInvoice = status === "invoiced" || status === "ticket_paid" || status === "booked" || Boolean(trip);
	// Booking tracker: visible once the ticket is paid, all the way through
	// booked. Gives the applicant a progress indicator instead of a blank
	// "waiting" gap between paid and booked.
	const showBookingTracker =
		status === "ticket_paid" || status === "booked" || status === "cleared";
	const showBooked = status === "booked";
	const showCleared = status === "cleared";

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

			{/* The one decision for this stage. Choosing "yes" is the applicant's
				consent to travel assistance (recorded server-side with the
				request) and what puts the case in front of the travel team. */}
			{showDecision && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Your decision</p>
						<h2 className="mt-1" style={{ fontSize: "1.35rem" }}>How would you like to book your flight?</h2>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							Choose whether you'd like our team to help book your flight, hold for now, or arrange
							your own travel.
						</p>
						<div className="portal-grid portal-grid--3 mt-4">
							<DecisionCard
								title="Yes, help me book"
								description="Our travel team will assign a handler to issue your flight ticket invoice. You pay it and we book your flight."
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

			{/* Review — request sent to ops, awaiting handler */}
			{showReview && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">
							{ta?.status === "quote_prepared"
								? "Ticket invoice being approved"
								: ta?.assignedOpsUserId
									? "Your consultant is on it"
									: "Request received"}
						</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							{ta?.status === "quote_prepared"
								? "Your ticket invoice has been prepared and is with a manager for approval. You'll be able to pay it here as soon as it's issued."
								: ta?.assignedOpsUserId
									? `${ta.assignedOpsUserName ? `${ta.assignedOpsUserName} is` : "Your consultant is"} preparing your flight ticket invoice. Check back here to pay it once it's ready.`
									: "Your request has been sent to our travel team. A handler will be assigned to issue your flight ticket invoice shortly. Check back here to pay it once it's ready."}
						</p>
					</div>
				</section>
			)}

			{/* Ticket invoice — the same card as every other invoice */}
			{showInvoice && (
				<section className="mt-4">
					<div className="card card--pad">
						{trip ? (
							<InvoiceCard
								title="Ticket invoice"
								invoice={trip}
								actions={
									trip.status === "paid" ? (
										<Button variant="secondary" onClick={() => downloadReceipt(trip, "Ticket invoice")}>
											Download receipt
										</Button>
									) : tripDue ? (
										<Button variant="primary" onClick={() => void payTicketing()} arrow>
											Pay {formatMoney(trip.balanceCents, "ghs")}
										</Button>
									) : null
								}
								hint={
									trip.status === "paid"
										? "Paid — your consultant will confirm the booking shortly."
										: tripProforma
											? "Your ticket invoice is with a manager for approval. You'll be able to pay it here once it's issued."
											: undefined
								}
							/>
						) : (
							<>
								<p className="eyebrow">Ticket invoice</p>
								<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>Awaiting invoice from your consultant.</p>
							</>
						)}
					</div>
				</section>
			)}

			{/* Booking tracker — progress between ticket paid and booked */}
			{showBookingTracker && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Booking tracker</p>
						<div className="mt-3" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
							<TrackerStep
								done={ticketingEffectivePaid}
								label="Ticket paid"
								detail={ticketingEffectivePaid ? "Your flight ticket invoice is settled." : "Awaiting ticket payment."}
							/>
							<TrackerStep
								done={status === "booked" || status === "cleared"}
								active={status === "ticket_paid"}
								label="Booking in progress"
								detail={
									status === "ticket_paid"
										? "Your consultant is booking your flight. You'll see the confirmation here once it's done."
										: status === "booked" || status === "cleared"
											? "Your flight is booked."
											: "Starts once the ticket is paid."
								}
							/>
							<TrackerStep
								done={status === "cleared"}
								active={status === "booked"}
								label="Choose payment plan"
								detail={
									status === "cleared"
										? "Payment plan chosen — you're cleared to travel."
										: status === "booked"
											? "Choose how to settle your service fee below."
											: "Available once your booking is confirmed."
								}
							/>
						</div>
					</div>
				</section>
			)}

			{/* Booked — confirmation from handler */}
			{showBooked && ta?.bookingConfirmation && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Flight booked 🛫</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							Your consultant has confirmed your booking. Choose your payment plan below to be cleared
							to travel.
						</p>
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

			{/* Choose payment plan → cleared to travel */}
			{showBooked && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Choose your payment plan</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							Choose how you'd like to settle your service fee. You'll be cleared to travel once
							you've paid the full amount or your first installment.
						</p>
						<div className="portal-grid portal-grid--2 mt-3">
							<DecisionCard
								title="Full payment"
								description="Pay the full service fee now and be cleared to travel immediately."
								icon="✓"
								onClick={() => setPlanChoice("full")}
								disabled={busy}
								highlighted={planChoice === "full"}
							/>
							<DecisionCard
								title="Installments"
								description="Pay the first installment now to be cleared to travel. The rest follows your plan."
								icon="≣"
								onClick={() => setPlanChoice("installment")}
								disabled={busy}
								highlighted={planChoice === "installment"}
							/>
						</div>
						<div className="row mt-3">
							<Button variant="primary" onClick={() => void handleChoosePlan()} disabled={busy}>
								{busy ? "Saving…" : `Choose ${planChoice === "full" ? "full payment" : "installments"}`}
							</Button>
						</div>
					</div>
				</section>
			)}

			{/* Cleared to travel */}
			{showCleared && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Cleared to travel 🛫</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							Your flight is booked and your payment plan is in place. You're cleared to travel.
							Complete your remaining plan payments in the payment plan chapter.
						</p>
					</div>
				</section>
			)}

			{/* Next action: move on to the payment plan */}
			{(showCleared || status === "declined") && (
				<div className="card card--pad mt-5 next-action">
					<p className="eyebrow">Next step</p>
					<p className="display mt-2" style={{ fontSize: "1.25rem" }}>
						{showCleared ? "You're cleared to fly 🛫" : "Travel arranged independently"}
					</p>
					<p className="muted mt-1">
						{showCleared
							? "Your flight is booked and you're cleared. Move to your payment plan to settle your service fee and complete your journey."
							: "You've opted out of travel assistance. Move to your payment plan to settle your service fee and complete your journey."}
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
			)}

			<div className="card card--pad mt-5">
				<p className="eyebrow">Need help?</p>
				<p className="muted mt-2">
					Message your consultant through the chat widget at the bottom right of the portal if you
					have questions about your flight or invoice.
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

function TrackerStep({
	done,
	active,
	label,
	detail,
}: {
	done: boolean;
	active?: boolean;
	label: string;
	detail: string;
}) {
	const dotStyle: CSSProperties = {
		width: "1.5rem",
		height: "1.5rem",
		borderRadius: "50%",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		flexShrink: 0,
		fontSize: "0.8rem",
		fontWeight: 600,
		background: done ? "var(--success, #16a34a)" : active ? "var(--primary, #2563eb)" : "var(--muted, #e5e7eb)",
		color: done || active ? "#fff" : "var(--text-muted, #6b7280)",
	};
	return (
		<div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
			<div style={dotStyle}>{done ? "✓" : active ? "•" : ""}</div>
			<div>
				<p style={{ fontWeight: 500, fontSize: "0.95rem" }}>{label}</p>
				<p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.15rem" }}>
					{detail}
				</p>
			</div>
		</div>
	);
}
