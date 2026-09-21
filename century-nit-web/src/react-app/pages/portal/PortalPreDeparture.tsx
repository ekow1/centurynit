import { useEffect, useRef, useState } from "react";
import { InvoiceCard, formatMoney } from "century-nit-core/ui";
import { openInvoiceDocument } from "../../lib/receipt";
import { useAppState, hasSettledPlan } from "../../context/AppState";
import { Button } from "../../components/ui/Button";
import { ChapterGate } from "./PortalLayout";
import { PreDepartureChecklist } from "../../components/PreDepartureChecklist";
import { OfficialDocuments, officialRows } from "../../components/OfficialDocuments";
import { displayAuthor } from "./ConsultantUpdates";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { documentsReleasedFor, documentHoldReasonFor, milestoneLockReasonFor, milestoneUnlockedFor } from "../../context/AppState";
import { documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { meApi, ApiError } from "century-nit-core/api";
import { usePaySheet } from "../../components/portal/PaySheet";
import { StageIntakeCard } from "../../components/portal/StageIntakeCard";
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
 * pay it → we book → the fee milestone unlocks → done. The payment plan is
 * chosen in the Payment Execution chapter, where the money is; this page
 * ends at "booked" plus the milestone it unlocks.
 */
function TravelAssistanceInner() {
	const { application, schoolApplications, syncFromServer, recordTravelDecision, preDepartureTasks, togglePreDepartureTask } = useAppState();
	const { toast } = useNotifier();
	const paySheet = usePaySheet(() => void syncFromServer());

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
	// The documents Century holds for the client. Shown here because this is where the milestone is paid.
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
	const isMobile = useMediaQuery("(max-width: 959.98px)");
	const heroRef = useRef<HTMLDivElement | null>(null);
	const [heroVisible, setHeroVisible] = useState(true);
	useEffect(() => {
		const el = heroRef.current;
		if (!el || typeof IntersectionObserver === "undefined") return;
		const obs = new IntersectionObserver(([e]) => setHeroVisible(e.isIntersecting));
		obs.observe(el);
		return () => obs.disconnect();
	}, []);

	// The real ticket invoice from the server: its status (proforma / issued /
	// paid) is what decides whether there is anything to pay.
	const [trip, setTrip] = useState<ApiInvoice | null>(null);

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
		let backend = trip && trip.balanceCents > 0 ? trip : null;
		if (!backend) {
			const { invoices } = await meApi.invoices().catch(() => ({ invoices: [] as ApiInvoice[] }));
			backend = invoices.find((i) => i.type === "travel" && i.balanceCents > 0) ?? null;
		}
		if (!backend) {
			toast.error("Your ticket invoice has not been issued yet. Your consultant will let you know when it is ready.");
			return;
		}
		paySheet.pay(backend);
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



	const status = ta?.status ?? "decision_pending";
	const showDecision = !ta || status === "decision_pending" || status === "on_hold" || status === "declined";
	const showWaiting = status === "review";
	const showInvoice = status === "invoiced" || status === "ticket_paid" || (status === "booked" && Boolean(trip));
	const showBooked = status === "booked";
	const settled = status === "booked" || status === "declined" || status === "on_hold";
	// The flight is booked first; the fee milestone unlocks once travel is
	// settled (booked or own booking) and releases the papers.
	const milestoneUnlocked = milestoneUnlockedFor(application);
	const milestoneLockReason = milestoneLockReasonFor(application);
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
							: "after 1";

	const papersFact = feePaid
		? `released${application.agencySettledAt ? ` ${day(application.agencySettledAt)}` : ""}`
		: !milestoneUnlocked
			? status === "on_hold"
				? "on hold"
				: "after your flight"
			: milestoneUsd
				? `${ghs(milestoneUsd)} due`
				: "due";

	// The strip mirrors the four sections below, one name each.
	const steps: { label: string; done: boolean; fact: string }[] = [
		{ label: "Your flight", done: ticketDone, fact: ticketFact },
		{ label: "Your papers", done: feePaid && docsReleased, fact: papersFact },
		{ label: "Before you fly", done: checklistDone, fact: `${closedTasks} / ${totalTasks}` },
		{ label: "Finish", done: Boolean(application.completedAt), fact: application.completedAt ? "file closed" : canComplete ? "ready" : "last step" },
	];
	const onStep = steps.findIndex((s) => !s.done);

	const officerName = ta?.assignedOpsUserName ? displayAuthor(ta.assignedOpsUserName) : null;
	const waitingLine = !ta?.assignedOpsUserId
		? "Your request has been sent to our travel team. A travel officer will be assigned and will prepare your ticket invoice."
		: `${officerName ? `${officerName} is` : "Your travel officer is"} finding your flight and preparing the ticket invoice. You'll be able to pay it here once it's ready.`;

	// The band. The one thing this chapter needs right now. The flight first;
	// the fee milestone waits on it.
	const band = canComplete
		? { title: "Everything is settled. Close your file", detail: "Service fee paid, travel settled, checklist done. Completing hands you to post-arrival support.", cta: <Button variant="inverted" onClick={() => void handleComplete()} arrow>Complete my journey</Button> }
		: status === "decision_pending"
			? { title: "Tell us how you'd like to fly", detail: "One decision. The flight booking service is part of your package; the only invoice here is the ticket itself.", cta: null }
			: showWaiting
				? { title: "Your travel officer is finding your flight", detail: waitingLine, cta: null }
				: tripDue
					? { title: `Pay the ticket invoice · ${formatMoney(trip?.balanceCents ?? 0, "ghs")} due`, detail: `The airline ticket, at cost. ${officerName ?? "Your travel officer"} books the seat as soon as it's paid and posts the confirmation here.`, cta: <Button variant="inverted" onClick={() => void payTicketing()} arrow>Pay now</Button> }
					: trip?.status === "paid" && !showBooked
						? { title: "Ticket paid. Your officer is booking", detail: "The fare is settled. Your travel officer is booking the flight and will post the confirmation here.", cta: null }
						: status === "on_hold"
							? { title: "Travel is on hold", detail: "Travel assistance is on hold. Resume it, or choose to book your own flight, to unlock this milestone.", cta: null }
							: (showBooked || status === "declined") && !feePaid
								? { title: "Settle the service fee to release your papers", detail: "Your flight is settled. Your admission letter, visa documents and e-ticket release on payment.", cta: <Button to="/portal/payment-execution" variant="inverted" arrow>Pay service fee</Button> }
								: (showBooked || status === "declined") && feePaid && !checklistDone
									? { title: showBooked ? "Flight booked. Finish the checklist below" : "Travel settled. Finish the checklist below", detail: showBooked ? (ta?.booking?.confirmationCode ? `Keep ${ta.booking.confirmationCode} for check-in.` : "Keep the confirmation code for check-in.") : "Your service fee is paid and your papers are released. The checklist is the last step.", cta: null }
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

			{/* You are here — one block: state, countdown, the single CTA */}
			<div ref={heroRef} className={`dhero mt-4${band.cta ? " dhero--act" : ""}`}>
				<div className="dhero__main">
					<p className="eyebrow">You are here</p>
					<p className="dhero__t">{band.title}</p>
					<p className="dhero__d muted">{band.detail}</p>
				</div>
				<div className="dhero__side">
					<div className={`dtile${flightAt ? "" : " dtile--hollow"}`}>
						<p className="dtile__n">
							{flightAt ? (flyDays !== null && flyDays > 0 ? `${flyDays} days` : flyDays === 0 ? "Today" : "Flown") : "—"}
						</p>
						<p className="dtile__d">
							{flightAt
								? `To ${ta?.booking?.to ?? ta?.flight?.to ?? "your destination"} · ${when(flightAt)}`
								: "Flight not booked"}
						</p>
					</div>
					{band.cta}
				</div>
			</div>

			{/* the strip. The same four dependencies the sections below follow */}
			<div className="vsteps">
				{steps.map((s, i) => (
					<div key={s.label} className={`vstep${s.done ? " vstep--done" : i === onStep ? " vstep--on" : ""}`}>
						<p className="vstep__l">{s.label}</p>
						{s.fact ? <p className="vstep__d">{s.fact}</p> : null}
					</div>
				))}
			</div>

			{/* the intake this stage asks of a client who continued into it */}
			<div className="mt-4">
				<StageIntakeCard stage="departure" />
			</div>

			<div className="psplit mt-5">
				<div>
					{/* 1 · your flight — the decision inline, then the ticket */}
					<section className="psec" id="your-flight">
						<div className="psec__h">
							<span className={`psec__no${ticketDone ? " psec__no--done" : ""}`}>{ticketDone ? "✓" : "1"}</span>
							<span className="psec__title">Your flight</span>
							<span className="psec__hint">
								{showBooked
									? "booked · ticketed"
									: trip?.status === "paid"
										? "ticket paid · booking"
										: tripDue
											? "ticket invoice due"
											: showWaiting
												? "with your officer"
												: status === "decision_pending"
													? "your call"
													: status === "on_hold"
														? "on hold"
														: status === "declined"
															? "own booking"
															: "not started"}
							</span>
						</div>
						{showDecision ? (
							<>
								<div className="picks">
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
							<div className="settled">
								<span className="mono">✓</span>
								<span style={{ fontSize: "0.85rem" }}>
									<b>{showBooked ? "Booked" : "Booking"} with Century NIT</b>
									{officerName ? ` · travel officer ${officerName}` : ""}
								</span>
							</div>
						)}
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
											<BoardingPass flight={ta.flight} />
										</div>
									</>
								)}
								{trip ? (
									<InvoiceCard
										title="Ticket invoice"
										invoice={trip}
										display="ghs"
										actions={
											<>
												{tripDue ? (
													<Button variant="primary" onClick={() => void payTicketing()} arrow>
														Pay {formatMoney(trip.balanceCents, "ghs")}
													</Button>
												) : null}
												<button type="button" className="doc-link" onClick={() => openInvoiceDocument(trip, "invoice")}>
													↓ invoice
												</button>
												{trip.payments.length > 0 ? (
													<button type="button" className="doc-link" onClick={() => openInvoiceDocument(trip, "receipt")}>
														↓ receipt
													</button>
												) : null}
											</>
										}
										hint={
											trip.status === "paid"
												? showBooked
													? "Paid."
													: "Paid. Your travel officer is booking the flight and will post the confirmation here."
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
								<p className="eyebrow">Booked · confirmed</p>
								<div className="mt-3">
									<BoardingPass flight={ta.booking} confirmationCode={ta.booking.confirmationCode} ticketed />
								</div>
								<p className="muted mt-3" style={{ fontSize: "0.8rem" }}>
									Keep the confirmation code for check-in.
									{!feePaid && " Your e-ticket releases with your papers below once the service-fee instalment is settled."}
								</p>
							</div>
						)}
					</section>

					{/* 2 · service fee — the payment only; papers sit in the next section */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${feePaid ? " psec__no--done" : ""}`}>{feePaid ? "✓" : "2"}</span>
							<span className="psec__title">Service fee</span>
							<span className="psec__hint">
								{feePaid ? "settled" : !milestoneUnlocked ? "after your flight" : "due"}
							</span>
						</div>
						{feePaid ? (
							<div className="settled">
								<span className="mono">✓</span>
								<span style={{ fontSize: "0.85rem" }}>
									<b>Service fee</b> · settled{application.agencySettledAt ? ` ${day(application.agencySettledAt)}` : ""}
									{postArrivalUsd ? ` · ${ghs(postArrivalUsd)} follows after arrival` : ""}
								</span>
							</div>
						) : (
							<>
								<div className={`pledger__row${milestoneUnlocked ? " pledger__row--due" : " pledger__row--locked"}`} style={{ borderTop: "1.5px solid var(--foreground)" }}>
									<span className={`pledger__mark${milestoneUnlocked ? " pledger__mark--on" : ""}`}>V</span>
									<div className="pledger__body">
										<p className="pledger__name">Service fee · {isInstalment ? "pre-departure instalment" : "balance"}</p>
										<p className="pledger__sub">
											{!milestoneUnlocked
												? (milestoneLockReason ?? "unlocks once your flight is settled")
												: `${application.paymentPlanId ? (PAYMENT_PLANS.find((p) => p.id === application.paymentPlanId)?.name ?? "plan") : "choose your plan first"} · releases your admission letter, visa documents & e-ticket`}
										</p>
									</div>
									<div className="pledger__amt">
										{milestoneUsd ? (
											<>
												<b>{ghs(milestoneUsd)}</b>
												<small>${milestoneUsd.toLocaleString()}</small>
											</>
										) : (
											<b>—</b>
										)}
									</div>
									<span className="pledger__status">
										<span className={`portal-pill${milestoneUnlocked ? "" : " portal-pill--hollow"}`}>{milestoneUnlocked ? "Due" : "Locked"}</span>
									</span>
									<div className="pledger__acts">
										{milestoneUnlocked ? (
											<Button to="/portal/payment-execution" size="sm" arrow>
												{application.paymentPlanId ? "Pay service fee" : "Choose plan & pay"}
											</Button>
										) : null}
									</div>
								</div>
								{milestoneUnlocked ? (
									<p className="muted mt-2" style={{ fontSize: "0.78rem" }}>
										{status === "declined"
											? "You're booking your own flight. Settling it releases your admission letter, visa documents and papers."
											: `Settling releases your admission letter, visa documents and e-ticket.${isInstalment ? " Any post-arrival remainder follows on your schedule." : ""}`}
									</p>
								) : null}
							</>
						)}
					</section>

					{/* 3 · your papers — the files Century holds for you */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${docsReleased && docRows.length > 0 ? " psec__no--done" : ""}`}>{docsReleased && docRows.length > 0 ? "✓" : "3"}</span>
							<span className="psec__title">Your papers</span>
							<span className="psec__hint">
								{docRows.length === 0 ? "nothing filed yet" : docsHeld > 0 ? `${docsHeld} held until fee` : "released"}
							</span>
						</div>
						{docRows.length > 0 ? (
							<OfficialDocuments rows={docRows} released={docsReleased} holdReason={documentHoldReasonFor(application)} hidePayCta variant="rows" />
						) : (
							<p className="mono muted" style={{ fontSize: "0.75rem" }}>
								Your admission letter and visa documents appear here as your consultant files them.
							</p>
						)}
					</section>

					{/* 4 · before you fly — the arrival facts first, then the checklist */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${checklistDone ? " psec__no--done" : ""}`}>{checklistDone ? "✓" : "4"}</span>
							<span className="psec__title">Before you fly</span>
							<span className="psec__hint">{closedTasks} of {totalTasks}</span>
						</div>
						{hasFacts && (
							<div className="arrive">
								<div className="between" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
									<p className="eyebrow">On arrival</p>
									<span className="mono muted" style={{ fontSize: "0.62rem" }}>recorded by your officer</span>
								</div>
								<div className="arrive__grid">
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
							</div>
						)}
						<div className="mt-3">
							<PreDepartureChecklist tasks={preDepartureTasks} onToggle={togglePreDepartureTask} locked={Boolean(application.completedAt)} />
						</div>
					</section>

					{/* finish is a state, not a section */}
					<p className="finishline">
						{application.completedAt
							? `✓ File closed ${day(application.completedAt)}`
							: `Finish unlocks when: ${settled ? "✓" : "○"} flight · ${feePaid ? "✓" : "○"} fee · ${checklistDone ? "✓" : "○"} checklist ${closedTasks}/${totalTasks}`}
					</p>
				</div>

				{/* the rail. The officer, then what happens after — money lives in the hero and the ledger */}
				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow">Your travel officer</p>
						{officerName ? (
							<>
								<div style={{ display: "flex", gap: "0.8rem", alignItems: "center", marginTop: "0.6rem" }}>
									<span className="avatar avatar--inv" aria-hidden>
										{initialsOf(officerName)}
									</span>
									<div>
										<p style={{ fontWeight: 700 }}>{officerName}</p>
										<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
											Travel officer
										</p>
									</div>
								</div>
								<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem" }}>
									<Button to="/portal/home" variant="ghost" size="sm" style={{ flex: 1, minHeight: 44 }}>
										Message
									</Button>
									<Button to="/portal/appointments" variant="ghost" size="sm" style={{ flex: 1, minHeight: 44 }}>
										Book call
									</Button>
								</div>
							</>
						) : (
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
								Assigned when you choose "Book with us". Usually same day.
							</p>
						)}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">After landing</p>
						<div style={{ marginTop: "0.4rem" }}>
							<div className="pkv"><span className="pkv__k">Check-in on landing</span><span className="pkv__v">Message your officer</span></div>
							<div className="pkv"><span className="pkv__k">Enrolment week</span><span className="pkv__v">Report by {day(dd.reportBy) ?? "date to follow"}</span></div>
							<div className="pkv"><span className="pkv__k">First month</span><span className="pkv__v">Support continues</span></div>
						</div>
					</div>
				</div>
			</div>

			{/* the pay action stays a thumb away while money is due */}
			{isMobile && !heroVisible && (tripDue || (!feePaid && milestoneUnlocked && milestoneUsd)) ? (
				<div className="pstick">
					{tripDue ? (
						<>
							<span>Ticket · {formatMoney(trip?.balanceCents ?? 0, "ghs")} due</span>
							<Button variant="primary" size="sm" onClick={() => void payTicketing()}>
								Pay →
							</Button>
						</>
					) : (
						<>
							<span>Service fee · {ghs(milestoneUsd)} due</span>
							<Button to="/portal/payment-execution" variant="primary" size="sm">
								Pay →
							</Button>
						</>
					)}
				</div>
			) : null}
			{paySheet.sheet}
		</div>
	);
}

/** Two-letter mark for the officer avatar; "Century NIT" → CN. */
function initialsOf(name: string): string {
	const parts = name.trim().split(/\s+/);
	return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function fmtWhen(iso?: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The flight as a boarding pass: route big, times under the codes, conf in a box. */
function BoardingPass({ flight, confirmationCode, ticketed = false }: { flight: TravelFlight; confirmationCode?: string | null; ticketed?: boolean }) {
	return (
		<div className="bpass">
			<div className="bpass__top">
				<div className="bpass__leg">
					<p className="bpass__code">{flight.from ?? "—"}</p>
					{flight.departAt ? <p className="bpass__pt">dep {fmtWhen(flight.departAt)}</p> : null}
				</div>
				<div className="bpass__mid">
					<span aria-hidden>→</span>
					<p className="bpass__pt">{[flight.carrier, flight.flightNumber].filter(Boolean).join(" ")}</p>
				</div>
				<div className="bpass__leg" style={{ textAlign: "right" }}>
					<p className="bpass__code">{flight.to ?? "—"}</p>
					{flight.arriveAt ? <p className="bpass__pt">arr {fmtWhen(flight.arriveAt)}</p> : null}
				</div>
				{ticketed ? <span className="portal-pill portal-pill--solid">Ticketed</span> : null}
			</div>
			<div className="bpass__bot">
				{confirmationCode ? <span className="bpass__conf">CONF {confirmationCode}</span> : null}
				{flight.notes ? <span className="muted">{flight.notes}</span> : null}
			</div>
		</div>
	);
}
