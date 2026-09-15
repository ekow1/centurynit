import { useEffect, useState } from "react";
import { InvoiceCard, formatMoney } from "century-nit-core/ui";
import { downloadReceipt } from "../../lib/receipt";
import { useAppState, hasSettledPlan } from "../../context/AppState";
import { Button } from "../../components/ui/Button";
import { ChapterGate } from "./PortalLayout";
import { PreDepartureChecklist } from "../../components/PreDepartureChecklist";
import { OfficialDocuments, officialRows } from "../../components/OfficialDocuments";
import { documentsReleasedFor, documentHoldReasonFor } from "../../context/AppState";
import { documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { meApi, ApiError } from "century-nit-core/api";
import { AGENCY_STAGES, PAYMENT_PLANS } from "century-nit-core";
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
	const { application, schoolApplications, syncFromServer, recordTravelDecision, preDepartureTasks, togglePreDepartureTask } = useAppState();
	const { toast } = useNotifier();

	// Where the client is going: the accepted offer, else the one admission.
	const admitted = schoolApplications.filter((s) => s.outcome === "Admitted");
	const destination =
		schoolApplications.find((s) => s.id === application.acceptedSchoolId) ?? (admitted.length === 1 ? admitted[0] : null);
	const vd = application.visaDetails ?? {};
	const dd = application.departureDetails ?? {};
	const day = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
	const when = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
	const daysUntil = (iso: string | null | undefined) => {
		if (!iso) return null;
		const t = new Date(iso).getTime();
		return Number.isNaN(t) ? null : Math.ceil((t - Date.now()) / 86_400_000);
	};
	// The documents Century holds for the client — shown here because this is where the milestone is paid.
	const [officialDocs, setOfficialDocs] = useState<ApplicantDocument[]>([]);
	useEffect(() => {
		let alive = true;
		documentsApi
			.list()
			.then((res) => {
				if (alive) setOfficialDocs(res.documents);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [application.agencyStageIndex, application.agencySettledAt, application.departureDetails?.releaseOverrideAt]);
	const flightAt = application.travelAssistance?.booking?.departAt ?? application.travelAssistance?.flight?.departAt ?? null;
	const flyDays = daysUntil(flightAt);
	const hasFacts = Boolean(dd.reportBy || dd.orientationAt || dd.briefingAt || dd.pickupBy || dd.accommodationAddress || dd.emergencyContactName);

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

	async function handleComplete() {
		try {
			await meApi.completeApplication();
			await syncFromServer();
			toast.success("Your journey is complete. Safe travels!");
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not complete your journey yet. Please try again.");
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
	// The pre-departure service fee milestone is due before the ticket is
	// issued; the decision can be made either way, the invoice waits.
	const feePaid = hasSettledPlan(application);
	const checklistDone = Boolean(application.preDepartureCompletedAt);
	const canComplete = settled && feePaid && checklistDone;

	const isInstalment = application.paymentPlanId === "installment";
	const ghs = (usd: number) => formatMoney(Math.round(usd * 100), "ghs");
	// The milestone figure, derived the same way as the Payment Execution chapter.
	const milestoneUsd =
		application.agencyTotal > 0 && application.paymentPlanId
			? isInstalment
				? Math.round(application.agencyTotal * (AGENCY_STAGES[1]?.portion ?? 0.3))
				: Math.max(0, application.agencyTotal - application.agencyPaid)
			: 0;
	const postArrivalUsd = isInstalment && application.agencyTotal > 0 ? Math.round(application.agencyTotal * (AGENCY_STAGES[2]?.portion ?? 0.6)) : 0;

	const docRows = officialRows({ schools: schoolApplications, docs: officialDocs });
	const docsReleased = documentsReleasedFor(application);
	const docsHeld = docRows.filter((r) => r.gated && !docsReleased).length;

	const closedTasks = preDepartureTasks.filter((t) => t.done || Boolean(t.waivedReason)).length;
	const totalTasks = preDepartureTasks.length;

	const decisionDone = status !== "decision_pending" && Boolean(ta?.decision);
	const decisionFact =
		ta?.decision === "yes"
			? "book with us"
			: ta?.decision === "no" || status === "declined"
				? "own booking"
				: ta?.decision === "hold" || status === "on_hold"
					? "on hold"
					: "your call";
	const ticketDone = showBooked || trip?.status === "paid";
	const ticketFact = showBooked
		? `booked${ta?.booking?.confirmationCode ? ` · ${ta.booking.confirmationCode}` : ""}`
		: trip?.status === "paid"
			? "paid · booking"
			: tripDue
				? `${formatMoney(trip?.balanceCents ?? 0, "ghs")} due`
				: showWaiting
					? "with your officer"
					: status === "declined"
						? "own booking"
						: status === "on_hold"
							? "on hold"
							: "after 1 & 2";

	const steps: { label: string; done: boolean; fact: string }[] = [
		{
			label: "Milestone",
			done: feePaid,
			fact: feePaid ? `settled${application.agencySettledAt ? ` ${day(application.agencySettledAt)}` : ""}` : milestoneUsd ? `${ghs(milestoneUsd)} due` : "due",
		},
		{ label: "Flight decision", done: decisionDone, fact: decisionFact },
		{ label: "Ticket", done: ticketDone, fact: ticketFact },
		{ label: "Before you fly", done: checklistDone, fact: `${closedTasks} / ${totalTasks}` },
	];
	const onStep = steps.findIndex((s) => !s.done);

	const waitingLine = !ta?.assignedOpsUserId
		? "Your request has been sent to our travel team. A travel officer will be assigned and will prepare your ticket invoice."
		: `${ta.assignedOpsUserName ? `${ta.assignedOpsUserName} is` : "Your travel officer is"} finding your flight and preparing the ticket invoice. You'll be able to pay it here once it's ready.`;

	// The band — the one thing this chapter needs right now.
	const band = canComplete
		? { title: "Everything is settled — close your file", detail: "Fee milestone paid, travel settled, checklist done. Completing hands you to post-arrival support.", cta: <Button variant="inverted" onClick={() => void handleComplete()} arrow>Complete my journey</Button> }
		: !feePaid
			? { title: "Settle the fee milestone to release your documents", detail: "Your admission letter and visa documents release on payment — your ticket is issued after it.", cta: <Button to="/portal/payment-execution" variant="inverted" arrow>Pay the milestone</Button> }
			: status === "decision_pending" || status === "on_hold" || status === "declined"
				? { title: "Tell us how you'd like to fly", detail: "One decision — the flight booking service is part of your package; the only invoice here is the ticket itself.", cta: null }
				: showWaiting
					? { title: "Your travel officer is finding your flight", detail: waitingLine, cta: null }
					: tripDue
						? { title: `Pay the ticket invoice — ${formatMoney(trip?.balanceCents ?? 0, "ghs")} due`, detail: `The airline ticket, at cost. ${ta?.assignedOpsUserName ?? "Your travel officer"} books the seat as soon as it's paid and posts the confirmation here.`, cta: <Button variant="inverted" onClick={() => void payTicketing()} arrow>Pay now</Button> }
						: showBooked
							? { title: "Flight booked — finish the checklist below", detail: ta?.booking?.confirmationCode ? `Keep ${ta.booking.confirmationCode} for check-in.` : "Keep the confirmation code for check-in.", cta: null }
							: { title: "Departure in motion", detail: "Your officer updates this page as each piece settles.", cta: null };

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter V · Departure</p>
					<h1 className="page-title mt-1">
						Departure{destination ? ` · ${destination.universityName ?? "your school"}` : ""}
					</h1>
					{destination && (
						<p className="mono muted mt-1" style={{ fontSize: "0.8rem" }}>
							{[destination.programName, destination.intake, vd.validFrom || vd.validTo ? `Visa valid ${day(vd.validFrom) ?? "…"} → ${day(vd.validTo) ?? "…"}` : null]
								.filter(Boolean)
								.join(" · ")}
						</p>
					)}
				</div>
			</header>

			{/* You are here */}
			<div className="journey-now mt-4">
				<div>
					<p className="eyebrow">You are here</p>
					<p className="display journey-now__title" style={{ fontSize: "1.3rem" }}>{band.title}</p>
					<p className="journey-now__detail">{band.detail}</p>
				</div>
				{band.cta}
			</div>

			{/* the strip — the same four dependencies the sections below follow */}
			<div className="psteps4">
				{steps.map((s, i) => {
					const st = s.done ? "done" : i === onStep ? "on" : "pending";
					return (
						<div key={s.label} className={`pstep${st === "done" ? " pstep--done" : st === "on" ? " pstep--on" : ""}`}>
							<span className="pstep__m">{s.done ? "✓" : i + 1}</span>
							<span className="pstep__l">{s.label}</span>
							<span className="pstep__s">{s.fact}</span>
						</div>
					);
				})}
			</div>

			<div className="psplit mt-5">
				<div>
					{/* 1 · the milestone — the release */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${feePaid ? " psec__no--done" : ""}`}>{feePaid ? "✓" : "1"}</span>
							<span className="psec__title">Fee milestone</span>
							<span className="psec__hint">
								{feePaid
									? `settled${application.agencySettledAt ? ` · ${day(application.agencySettledAt)}` : ""}`
									: isInstalment
										? "pre-departure instalment · releases your documents"
										: "balance · releases your documents"}
							</span>
						</div>
						{feePaid ? (
							<p className="mono muted" style={{ fontSize: "0.75rem" }}>
								SERVICE FEE MILESTONE PAID{application.agencySettledAt ? ` · ${(day(application.agencySettledAt) ?? "").toUpperCase()}` : ""} — YOUR DOCUMENTS ARE RELEASED BELOW.{postArrivalUsd ? ` ${ghs(postArrivalUsd).toUpperCase()} FOLLOWS AFTER ARRIVAL ON YOUR SCHEDULE.` : ""}
							</p>
						) : (
							<div className="sharp-card sharp-card--key">
								<div className="between" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
									<div>
										<p style={{ fontWeight: 700 }}>Pre-departure milestone</p>
										<p className="mono muted" style={{ fontSize: "0.68rem", marginTop: "0.3rem" }}>
											{application.paymentPlanId
												? `SERVICE FEE · ${isInstalment ? "INSTALMENT PLAN" : "FULL PAYMENT"} · AGREED AT PACKAGE SELECTION`
												: "CHOOSE YOUR PAYMENT PLAN FIRST"}
										</p>
									</div>
									{milestoneUsd ? (
										<span className="mono" style={{ fontWeight: 700, fontSize: "1.05rem" }}>
											{ghs(milestoneUsd)} <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>· ${milestoneUsd.toLocaleString()}</span>
										</span>
									) : null}
								</div>
								<p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
									Due before your ticket is issued.{isInstalment ? " Any post-arrival remainder follows on your schedule." : ""}
								</p>
								<div className="mt-3">
									<Button to="/portal/payment-execution" variant="primary" arrow>
										{application.paymentPlanId ? "Pay the fee milestone" : "Choose plan & pay"}
									</Button>
								</div>
							</div>
						)}
					</section>

					{/* 2 · documents the milestone releases */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${docsReleased ? " psec__no--done" : ""}`}>{docsReleased ? "✓" : "2"}</span>
							<span className="psec__title">Your documents</span>
							<span className="psec__hint">filed by Century NIT{docsHeld > 0 ? ` · ${docsHeld} held` : docsReleased ? " · released" : ""}</span>
						</div>
						{docRows.length > 0 ? (
							<OfficialDocuments rows={docRows} released={docsReleased} holdReason={documentHoldReasonFor(application)} hidePayCta />
						) : (
							<p className="mono muted" style={{ fontSize: "0.75rem" }}>
								Your admission letter and visa documents appear here as your consultant files them.
							</p>
						)}
					</section>

					{/* 3 · the decision */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${!showDecision ? " psec__no--done" : ""}`}>{showDecision ? "3" : "✓"}</span>
							<span className="psec__title">How you're flying</span>
							<span className="psec__hint">
								{status === "decision_pending"
									? "your call"
									: status === "on_hold"
										? "on hold"
										: status === "declined"
											? "own booking"
											: `book with us · chosen${ta?.updatedAt ? ` ${day(ta.updatedAt)}` : ""}`}
							</span>
						</div>
						{showDecision ? (
							<>
								<div className="portal-grid portal-grid--3">
									<button type="button" className={`pick${ta?.decision === "yes" ? " pick--on" : ""}`} onClick={() => void handleDecision("yes")} disabled={busy}>
										<span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Book with us</span>
										<span className="muted" style={{ display: "block", fontSize: "0.78rem", marginTop: "0.4rem", lineHeight: 1.5 }}>We find the flight, you pay the ticket invoice here, and we book it for you.</span>
									</button>
									<button type="button" className={`pick${ta?.decision === "hold" ? " pick--on" : ""}`} onClick={() => void handleDecision("hold")} disabled={busy}>
										<span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Not now</span>
										<span className="muted" style={{ display: "block", fontSize: "0.78rem", marginTop: "0.4rem", lineHeight: 1.5 }}>Put travel assistance on hold. Nothing is raised and nobody is assigned until you come back.</span>
									</button>
									<button type="button" className={`pick${ta?.decision === "no" ? " pick--on" : ""}`} onClick={() => void handleDecision("no")} disabled={busy}>
										<span style={{ fontWeight: 700, fontSize: "0.92rem" }}>I'll book myself</span>
										<span className="muted" style={{ display: "block", fontSize: "0.78rem", marginTop: "0.4rem", lineHeight: 1.5 }}>Arrange your own flight. Your journey moves straight on.</span>
									</button>
								</div>
								{status === "on_hold" && (
									<p className="muted mt-3" style={{ fontSize: "0.85rem" }}>You're on hold. Pick an option above when you're ready.</p>
								)}
								{status === "declined" && (
									<p className="muted mt-3" style={{ fontSize: "0.85rem" }}>You're booking your own flight. Choose "Book with us" if you'd like our help after all.</p>
								)}
							</>
						) : (
							<p className="mono muted" style={{ fontSize: "0.75rem" }}>
								{showBooked ? "BOOKED WITH CENTURY NIT" : "BOOKING WITH CENTURY NIT"}
								{ta?.assignedOpsUserName ? ` — ${ta.assignedOpsUserName.toUpperCase()} IS YOUR TRAVEL OFFICER` : ""}.
							</p>
						)}
					</section>

					{/* 4 · the flight — waiting, invoice, or booked */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${showBooked ? " psec__no--done" : ""}`}>{showBooked ? "✓" : "4"}</span>
							<span className="psec__title">Your flight</span>
							<span className="psec__hint">
								{showBooked ? "booked · ticketed" : trip?.status === "paid" ? "ticket paid · booking" : tripDue ? "ticket invoice due" : showWaiting ? "with your officer" : "not started"}
							</span>
						</div>
						{showWaiting && (
							<div className="sharp-card">
								<p className="eyebrow">{ta?.assignedOpsUserId ? "Your travel officer is on it" : "Request received"}</p>
								<p className="muted mt-2" style={{ fontSize: "0.9rem" }}>{waitingLine}</p>
							</div>
						)}
						{showInvoice && (
							<div className="sharp-card sharp-card--key">
								{ta?.flight && !showBooked && (
									<>
										<p className="eyebrow">Flight found</p>
										<div className="mt-2 mb-3">
											<FlightRows flight={ta.flight} />
										</div>
									</>
								)}
								{trip ? (
									<InvoiceCard
										title="Ticket invoice"
										invoice={trip}
										display="ghs"
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
						)}
						{showBooked && ta?.booking && (
							<div className="sharp-card sharp-card--key">
								<div className="between" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
									<p className="eyebrow">Booked · confirmed</p>
									<span className="portal-pill portal-pill--solid">Ticketed</span>
								</div>
								<div className="mt-3">
									<FlightRows flight={ta.booking} confirmationCode={ta.booking.confirmationCode} />
								</div>
								{hasFacts && (
									<>
										<p className="eyebrow mt-4">On arrival · recorded by your officer</p>
										<div className="mt-1">
											{dd.reportBy && (
												<div className="pkv"><span className="pkv__k">Report to your school by</span><span className="pkv__v">{day(dd.reportBy)}</span></div>
											)}
											{dd.orientationAt && (
												<div className="pkv"><span className="pkv__k">Orientation</span><span className="pkv__v">{day(dd.orientationAt)}</span></div>
											)}
											{dd.briefingAt && (
												<div className="pkv"><span className="pkv__k">Pre-departure briefing</span><span className="pkv__v">{when(dd.briefingAt)}</span></div>
											)}
											{dd.pickupBy && (
												<div className="pkv"><span className="pkv__k">Airport pickup</span><span className="pkv__v">{dd.pickupBy}{dd.pickupNote ? ` · ${dd.pickupNote}` : ""}</span></div>
											)}
											{dd.accommodationAddress && (
												<div className="pkv"><span className="pkv__k">Accommodation</span><span className="pkv__v">{dd.accommodationAddress}{dd.accommodationMoveInAt ? ` · from ${day(dd.accommodationMoveInAt)}` : ""}</span></div>
											)}
											{dd.emergencyContactName && (
												<div className="pkv"><span className="pkv__k">Emergency contact</span><span className="pkv__v">{dd.emergencyContactName}{dd.emergencyContactRelation ? ` (${dd.emergencyContactRelation})` : ""}{dd.emergencyContactPhone ? ` · ${dd.emergencyContactPhone}` : ""}</span></div>
											)}
										</div>
									</>
								)}
								<div className="between mt-3" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
									<p className="muted" style={{ fontSize: "0.8rem" }}>Keep the confirmation code for check-in.</p>
									{trip?.status === "paid" && (
										<Button variant="secondary" size="sm" onClick={() => downloadReceipt(trip, "Ticket invoice")}>
											Download receipt
										</Button>
									)}
								</div>
							</div>
						)}
						{!showWaiting && !showInvoice && !showBooked && (
							<p className="mono muted" style={{ fontSize: "0.75rem" }}>Choose how you'd like to fly above — this section fills in from there.</p>
						)}
					</section>

					{/* 5 · the shared checklist */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${checklistDone ? " psec__no--done" : ""}`}>{checklistDone ? "✓" : "5"}</span>
							<span className="psec__title">Before you fly</span>
							<span className="psec__hint">yours + your officer's · {closedTasks}/{totalTasks}</span>
						</div>
						<PreDepartureChecklist tasks={preDepartureTasks} onToggle={togglePreDepartureTask} locked={Boolean(application.completedAt)} />

						{/* travel is settled — close the file */}
						{settled && (
							<div className="sharp-card next-action mt-3">
								<p className="eyebrow">Close the chapter</p>
								<p className="display mt-2" style={{ fontSize: "1.25rem" }}>
									{showBooked || canComplete ? "You're set to fly" : status === "declined" ? "Travel arranged independently" : "Travel on hold"}
								</p>
								<p className="muted mt-1">
									{canComplete
										? "Completing moves you to Chapter VI · post-arrival support. Your documents and receipts stay in your vault."
										: !feePaid
											? "Settle your pre-departure fee milestone to finish."
											: !checklistDone
												? "Work through your pre-departure checklist to finish."
												: "Travel assistance is paused. You can resume it above whenever you're ready."}
								</p>
								<div className="row mt-3">
									{canComplete ? (
										<Button variant="primary" onClick={() => void handleComplete()} arrow>
											Complete my journey
										</Button>
									) : !feePaid ? (
										<Button to="/portal/payment-execution" variant="ghost">
											Pay the fee milestone
										</Button>
									) : (
										<Button to="/portal/journey" variant="ghost">
											See your journey
										</Button>
									)}
								</div>
							</div>
						)}
					</section>
				</div>

				{/* the rail — countdown, money, officer, what happens after */}
				<div className="prail">
					<div className="sharp-card sharp-card--key sharp-card--invert">
						<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>Countdown</p>
						<p style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.3rem" }}>
							{flightAt ? (flyDays !== null && flyDays > 0 ? `${flyDays} day${flyDays === 1 ? "" : "s"}` : flyDays === 0 ? "Today" : "Flown") : "Not booked"}
						</p>
						<p className="mono" style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.7)", marginTop: "0.15rem" }}>
							{flightAt ? `TO ${when(flightAt)?.toUpperCase() ?? ""}` : "FLIGHT DATE SHOWS HERE ONCE TICKETED"}
						</p>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Money · Chapter V</p>
						<div style={{ marginTop: "0.4rem" }}>
							<div className={`pkv${feePaid ? "" : " pkv--due"}`}>
								<span className="pkv__k">Fee milestone</span>
								<span className="pkv__v">{feePaid ? "settled ✓" : milestoneUsd ? `${ghs(milestoneUsd)} due` : "due"}</span>
							</div>
							<div className={`pkv${tripDue ? " pkv--due" : ""}`}>
								<span className="pkv__k">Ticket</span>
								<span className={`pkv__v${tripDue || trip?.status === "paid" ? "" : " muted"}`}>
									{tripDue
										? `${formatMoney(trip?.balanceCents ?? 0, "ghs")} due`
										: trip?.status === "paid"
											? `${formatMoney(trip.subtotalCents, "ghs")} paid ✓`
											: trip?.status === "proforma"
												? "being issued"
												: "not yet raised"}
								</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Plan</span>
								<span className="pkv__v">{application.paymentPlanId ? PAYMENT_PLANS.find((p) => p.id === application.paymentPlanId)?.name ?? application.paymentPlanId : "not chosen"}</span>
							</div>
							{isInstalment && (
								<div className="pkv">
									<span className="pkv__k">After arrival</span>
									<span className="pkv__v muted">{postArrivalUsd ? `${ghs(postArrivalUsd)} ` : ""}on your schedule</span>
								</div>
							)}
						</div>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Your travel officer</p>
						{ta?.assignedOpsUserName ? (
							<>
								<p style={{ fontWeight: 700, marginTop: "0.5rem" }}>{ta.assignedOpsUserName}</p>
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
									Travel
								</p>
								<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem" }}>
									<Button to="/portal/home" variant="ghost" size="sm">
										Message
									</Button>
									<Button to="/portal/appointments" variant="ghost" size="sm">
										Book call
									</Button>
								</div>
							</>
						) : (
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
								Assigned when you choose "Book with us" — usually same day.
							</p>
						)}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">After landing</p>
						<p className="muted" style={{ fontSize: "var(--text-sm)", lineHeight: 1.6, marginTop: "0.5rem" }}>
							Post-arrival support continues — check in when you land, enrolment week, and any issues in
							your first month. Completing this chapter closes your file.
						</p>
					</div>
				</div>
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

function QuoteRow({ label, value }: { label: string; value: string }) {
	return (
		<div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
			<span className="muted">{label}</span>
			<span style={{ fontWeight: 500 }}>{value}</span>
		</div>
	);
}
