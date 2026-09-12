import { useEffect, useState } from "react";
import { InvoiceCard, formatMoney } from "century-nit-core/ui";
import { downloadReceipt } from "../../lib/receipt";
import { useAppState } from "../../context/AppState";
import { Button } from "../../components/ui/Button";
import { ChapterGate } from "./PortalLayout";
import { meApi, ApiError } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import type { ApiInvoice, TravelFlight } from "century-nit-shared";

export function PortalPreDeparture() {
	return (
		<ChapterGate chapter="travel_assistance">
			<TravelAssistanceInner />
		</ChapterGate>
	);
}

/**
 * The travel chapter, one path: decide → we raise the ticket invoice → you
 * pay it → we book → done. The payment plan is chosen in the Payment
 * Execution chapter, where the money is; this page ends at "booked".
 */
function TravelAssistanceInner() {
	const { application, syncFromServer, recordTravelDecision } = useAppState();
	const { toast } = useNotifier();

	const ta = application.travelAssistance;
	const [busy, setBusy] = useState(false);

	// The real ticket invoice from the server: its status (proforma / issued /
	// paid) is what decides whether there is anything to pay.
	const [trip, setTrip] = useState<ApiInvoice | null>(null);
	const [payPhase, setPayPhase] = useState<"idle" | "loading">("idle");

	useEffect(() => {
		let cancelled = false;
		meApi
			.invoices()
			.then(({ invoices }) => {
				if (cancelled) return;
				setTrip(invoices.find((i) => i.type === "travel" && i.status !== "void") ?? null);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [ta?.status]);

	const tripDue = Boolean(trip) && trip?.status !== "paid" && trip?.status !== "proforma" && (trip?.balanceCents ?? 0) > 0;

	async function payTicketing() {
		setPayPhase("loading");
		try {
			let backend = trip && trip.balanceCents > 0 ? trip : null;
			if (!backend) {
				const { invoices } = await meApi.invoices();
				backend = invoices.find((i) => i.type === "travel" && i.balanceCents > 0) ?? null;
			}
			if (!backend) {
				toast.error("Your ticket invoice has not been issued yet. Your consultant will let you know when it is ready.");
				return;
			}
			const checkout = await meApi.paystackCheckout(backend.id);
			if (checkout.authorizationUrl && checkout.authorizationUrl.startsWith("http")) {
				window.location.href = checkout.authorizationUrl;
				return;
			}
			toast.error("Could not initialize Paystack checkout.");
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Payment could not be processed. Please try again.");
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

	async function handleAdvanceToPlan() {
		try {
			await meApi.advanceToPaymentPlan();
			await syncFromServer();
			toast.success("Your payment plan chapter is now open.");
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not open your payment plan. Please try again.");
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
	const showDecision = !ta || status === "decision_pending" || status === "on_hold" || status === "declined";
	const showWaiting = status === "review";
	const showInvoice = status === "invoiced" || status === "ticket_paid" || (status === "booked" && Boolean(trip));
	const showBooked = status === "booked";
	const settled = status === "booked" || status === "declined" || status === "on_hold";

	const waitingLine = !ta?.assignedOpsUserId
		? "Your request has been sent to our travel team. A travel officer will be assigned and will prepare your ticket invoice."
		: `${ta.assignedOpsUserName ? `${ta.assignedOpsUserName} is` : "Your travel officer is"} finding your flight and preparing the ticket invoice. You'll be able to pay it here once it's ready.`;

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Travel assistance</p>
					<h1 className="page-title mt-1">Flight booking</h1>
					<p className="lead mt-2">
						Your visa is sorted. Tell us how you'd like to handle your flight and we'll take it from
						there. The flight booking service is already part of your package — the only invoice on
						this page is for the airline ticket itself.
					</p>
				</div>
			</header>

			{/* The one decision for this stage. Choosing "yes" is the applicant's
				consent to travel assistance and what puts the case in front of the
				travel team. */}
			{showDecision && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Your decision</p>
						<h2 className="mt-1" style={{ fontSize: "1.35rem" }}>How would you like to book your flight?</h2>
						<div className="portal-grid portal-grid--3 mt-4">
							<DecisionCard
								title="Book with us"
								description="We find the flight, you pay the ticket invoice here, and we book it for you."
								icon="✈"
								onClick={() => void handleDecision("yes")}
								disabled={busy}
								highlighted={ta?.decision === "yes"}
							/>
							<DecisionCard
								title="Not now"
								description="Put travel assistance on hold. Nothing is raised and nobody is assigned until you come back."
								icon="⏸"
								onClick={() => void handleDecision("hold")}
								disabled={busy}
								highlighted={ta?.decision === "hold"}
							/>
							<DecisionCard
								title="I'll book myself"
								description="Arrange your own flight. Your journey moves straight on to your payment plan."
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
								You're booking your own flight. Choose "Book with us" if you'd like our help after all.
							</p>
						)}
					</div>
				</section>
			)}

			{/* Waiting on the travel team — one card, one line */}
			{showWaiting && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">{ta?.assignedOpsUserId ? "Your travel officer is on it" : "Request received"}</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>{waitingLine}</p>
					</div>
				</section>
			)}

			{/* Ticket invoice — the same card as every other invoice */}
			{showInvoice && (
				<section className="mt-4">
					<div className="card card--pad">
						{ta?.flight && !showBooked && (
							<div className="mb-3">
								<p className="eyebrow">Your flight</p>
								<FlightRows flight={ta.flight} />
							</div>
						)}
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
										? showBooked
											? "Paid."
											: "Paid — your travel officer is booking the flight and will post the confirmation here."
										: trip.status === "proforma"
											? "Your ticket invoice is being issued. You'll be able to pay it here shortly."
											: undefined
								}
							/>
						) : (
							<>
								<p className="eyebrow">Ticket invoice</p>
								<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>Being prepared by your travel officer.</p>
							</>
						)}
					</div>
				</section>
			)}

			{/* Booked — the flight as booked, with its PNR */}
			{showBooked && ta?.booking && (
				<section className="mt-4">
					<div className="card card--pad">
						<p className="eyebrow">Flight booked 🛫</p>
						<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>
							Your flight is booked. Keep the confirmation code for check-in.
						</p>
						<div className="mt-3">
							<FlightRows flight={ta.booking} confirmationCode={ta.booking.confirmationCode} />
						</div>
					</div>
				</section>
			)}

			{/* Travel is settled — the plan chapter is next */}
			{settled && (
				<div className="card card--pad mt-5 next-action">
					<p className="eyebrow">Next step</p>
					<p className="display mt-2" style={{ fontSize: "1.25rem" }}>
						{showBooked ? "You're set to fly 🛫" : status === "declined" ? "Travel arranged independently" : "Travel on hold"}
					</p>
					<p className="muted mt-1">
						{showBooked
							? "Your flight is booked. Next, choose your payment plan and settle your service fee to complete your journey."
							: status === "declined"
								? "You're booking your own flight. Next, choose your payment plan and settle your service fee to complete your journey."
								: "Travel assistance is paused. You can still move on to your payment plan and come back to this later."}
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

function fmtWhen(iso?: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function FlightRows({ flight, confirmationCode }: { flight: TravelFlight; confirmationCode?: string }) {
	const route = [flight.from, flight.to].filter(Boolean).join(" → ");
	const rows: [string, string][] = [];
	if (confirmationCode) rows.push(["Confirmation code", confirmationCode]);
	if (flight.carrier || flight.flightNumber) rows.push(["Flight", [flight.carrier, flight.flightNumber].filter(Boolean).join(" ")]);
	if (route) rows.push(["Route", route]);
	if (flight.departAt) rows.push(["Departs", fmtWhen(flight.departAt)]);
	if (flight.arriveAt) rows.push(["Arrives", fmtWhen(flight.arriveAt)]);
	return (
		<div style={{ display: "grid", gap: "0.5rem" }}>
			{rows.map(([k, v]) => (
				<QuoteRow key={k} label={k} value={v} />
			))}
			{flight.notes && (
				<p className="muted" style={{ fontSize: "0.85rem" }}>
					{flight.notes}
				</p>
			)}
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
