import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { useAppState } from "../../context/AppState";
import type { ProcessStageId } from "century-nit-core";
import {
	CHAPTERS,
	PORTAL_STAGE_ORDER,
	PORTAL_STEP_CHAPTER,
	type ChapterId,
	type PortalStepId,
	type Booking,
} from "century-nit-shared";
import { bookingsApi, documentsApi, meApi } from "century-nit-core/api";
import { STAGE_PATH, STAGE_SHORT } from "../../data/stageLabels";
import { AssessmentOutcomeCard } from "../../components/AssessmentOutcomeCard";
import { ConsultantUpdates } from "./ConsultantUpdates";
import { MoneyStack } from "../../components/ui/Money";

/**
 * Where "continue" goes for the current stage, with a verb that names the
 * actual next act instead of the generic "Continue". The label stays short -
 * the stage is already named in the band above the button, so repeating it
 * there just crowds narrow screens.
 */
const STAGE_CTA: Partial<Record<ProcessStageId, { to: string; label: string }>> = {
	new: { to: "/portal/consultation", label: "Book consultation" },
	consultation: { to: "/portal/consultation", label: "Book consultation" },
	eligibility: { to: "/portal/consultation", label: "View consultation" },
	proceed: { to: "/portal/package", label: "Choose package" },
	school_package: { to: "/portal/package", label: "Choose package" },
	awaiting_handler: { to: "/portal/awaiting-handler", label: "Consultant being assigned" },
	school_select: { to: "/portal/application", label: "Select schools" },
	awaiting_invoice: { to: "/portal/application", label: "Awaiting invoice" },
	application_invoice: { to: "/portal/application", label: "Pay invoice" },
	school_tracking: { to: "/portal/application", label: "View applications" },
	visa_invoice: { to: "/portal/visa", label: "Pay visa invoice" },
	visa: { to: "/portal/visa/tracking", label: "View visa" },
	payment_execution: { to: "/portal/payment-execution", label: "Pay fee milestone" },
	travel_assistance: { to: "/portal/pre-departure", label: "View checklist" },
	completed: { to: "/portal/complete", label: "View summary" },
};

function currentStageCta(
	stage: ProcessStageId,
	proceedStatus: "invited" | "accepted" | "declined" | "paused",
): { to: string; label: string } {
	if (stage === "proceed") {
		if (proceedStatus === "declined" || proceedStatus === "paused") {
			return { to: "/portal/consultation", label: "Resume application" };
		}
		if (proceedStatus === "accepted") {
			return STAGE_CTA.school_package ?? { to: "/portal/package", label: "Choose package" };
		}
		// invited. The consent gate is still open. The consultation page shows
		// the assessment recommendation + consent card, so we send them there
		// instead of straight to package selection.
		return { to: "/portal/consultation", label: "Review recommendation" };
	}
	return STAGE_CTA[stage] ?? { to: STAGE_PATH[stage] ?? "/portal/home", label: "Continue" };
}

const STAGE_META: Record<ProcessStageId, { title: string; desc: string }> = {
	new: { title: "Start your journey", desc: "Book your first consultation to begin your application with Century NIT." },
	consultation: { title: "Start your consultation", desc: "Book the first meeting, fill your assessment, and pay the consultation fee." },
	eligibility: { title: "Your recommendation", desc: "Review the assessment outcome and the package your consultant recommends." },
	proceed: { title: "Confirm your enrolment", desc: "Confirm you're enrolling with us so we can assign your consultant and begin." },
	school_package: { title: "Choose your school package", desc: "Pick a funding track and degree level to shape school targeting." },
	awaiting_handler: { title: "Consultant being assigned", desc: "Your deposit has been received. Your consultant is being assigned." },
	school_select: { title: "Select schools & programmes", desc: "Choose where to apply, then pay the application invoice." },
	awaiting_invoice: { title: "Awaiting application invoice", desc: "Your consultant is reviewing your school selection and will issue the application invoice shortly." },
	application_invoice: { title: "Pay the application invoice", desc: "Settle the application fee so submissions and tracking can begin." },
	school_tracking: { title: "Application tracking", desc: "Follow each school application through the process." },
	visa_invoice: { title: "Pay the visa fee", desc: "On admission, settle the visa fee to open your visa case." },
	visa: { title: "Visa tracking", desc: "Your consultant processes your visa after you settle the invoice." },
	payment_execution: { title: "Pre-departure fee milestone", desc: "Unlocks once your flight is booked. It releases your documents." },
	travel_assistance: { title: "Departure", desc: "Choose how to book your flight, pay the ticket, and work through the pre-departure checklist." },
	completed: { title: "Journey complete", desc: "Everything is settled - thank you for using Century NIT." },
};

/** Each chapter's home page, for the strip. */
const CHAPTER_PATH: Record<ChapterId, string> = {
	consult: "/portal/consultation",
	enrol: "/portal/package",
	apply: "/portal/application",
	visa: "/portal/visa",
	depart: "/portal/pre-departure",
	done: "/portal/complete",
};

function chapterStateOf(
	ch: ChapterId,
	current: ProcessStageId,
	statuses: Record<string, "done" | "current" | "locked" | "skipped"> | null,
): "done" | "current" | "locked" {
	if (PORTAL_STEP_CHAPTER[current as PortalStepId] === ch) return "current";
	const steps = PORTAL_STAGE_ORDER.filter((s) => PORTAL_STEP_CHAPTER[s as PortalStepId] === ch);
	if (steps.length === 0) return "locked";
	const done = steps.every((s) => {
		const st = statuses?.[s];
		return st === "done" || st === "skipped";
	});
	return done ? "done" : "locked";
}

type DueInvoice = { invoiceNumber: string; balanceCents: number };

/** Overview - one glance: what to do next, where you are, and who is on it. */
export function DashboardHome() {
	const {
		journeyPhase,
		pendingAction,
		application,
		booking,
		schoolApplications,
		authUser,
		stageStatuses,
	} = useAppState();
	const { syncFromServer } = useAppState();
	const current = journeyPhase.stage;
	const stageCta = currentStageCta(current, application.proceedStatus);
	const meta = STAGE_META[current];

	const currentChapter = PORTAL_STEP_CHAPTER[current as PortalStepId] as ChapterId | undefined;
	const currentChapterMeta = currentChapter ? CHAPTERS.find((c) => c.id === currentChapter) : undefined;

	/* Rail data: money position, next appointment, documents on file */
	const [money, setMoney] = useState<{ paid: number; due: number; dueList: DueInvoice[] } | null>(null);
	const [nextAppt, setNextAppt] = useState<Booking | null>(null);
	const [docsOnFile, setDocsOnFile] = useState<number | null>(null);

	// A live booking turns "Book consultation" into "your appointment". The
	// stage hasn't moved on, but the thing to do with it has.
	const cta = nextAppt && (current === "new" || current === "consultation")
		? { to: "/portal/appointments", label: "Your appointment" }
		: stageCta;

	useEffect(() => {
		let alive = true;
		meApi
			.invoices()
			.then(({ invoices }) => {
				if (!alive) return;
				const live = invoices.filter((i) => i.status !== "void");
				const paid =
					live
						.filter((i) => i.status === "paid")
						.reduce((n, i) => n + i.subtotalCents - i.balanceCents, 0) / 100;
				const dueList = live
					.filter((i) => i.balanceCents > 0 && i.status !== "proforma")
					.map((i) => ({ invoiceNumber: i.invoiceNumber, balanceCents: i.balanceCents }));
				const due = dueList.reduce((n, i) => n + i.balanceCents, 0) / 100;
				setMoney({ paid, due, dueList });
			})
			.catch(() => {});
		bookingsApi
			.list()
			.then(({ bookings }) => {
				if (!alive) return;
				const upcoming = bookings
					.filter((b) => b.status !== "CANCELLED" && new Date(b.startsAt).getTime() > Date.now())
					.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
				setNextAppt(upcoming[0] ?? null);
			})
			.catch(() => {});
		documentsApi
			.list()
			.then((res) => {
				if (alive) setDocsOnFile(res.documents.length);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [booking.paymentStatus]);

	const offersCount = schoolApplications.filter((s) => s.outcome === "Admitted").length;

	// Refs resolve from the server-side booking first — `booking.confirmationId`
	// is localStorage-backed and reads "Not booked" on a fresh device/session
	// even though the case exists.
	const consultationRef = nextAppt?.reference ?? booking.confirmationId;
	const applicationId = application.appNumber;

	// Booked-but-not-yet-confirmed is a staff-side wait, not a client task.
	const slotConfirming = Boolean(nextAppt) && booking.consultationPhase === "awaiting_confirmation";

	return (
		<div className="portal-page dash-home">
			<header className="dash-hero">
				<div>
					<p className="eyebrow">Overview</p>
					<h1 className="dash-hero__title">
						Welcome{authUser ? `, ${authUser.name.split(" ")[0]}` : ""}
					</h1>
					<p className="dash-hero__line">
						<span className={`dash-hero__dot${pendingAction ? "" : " dash-hero__dot--ok"}`} />
						{currentChapterMeta ? `Ch. ${currentChapterMeta.numeral} · ${currentChapterMeta.label}` : meta.title}
						{" — "}
						{slotConfirming
							? "consultation booked, slot being confirmed"
							: pendingAction
								? pendingAction.title.toLowerCase()
								: (STAGE_SHORT[current] ?? meta.title).toLowerCase()}
					</p>
				</div>
				<div className="dash-refs">
					<span className="dash-ref">APP · <strong>{applicationId ?? "not issued"}</strong></span>
					<span className="dash-ref">CONS · <strong>{consultationRef ?? "not booked"}</strong></span>
				</div>
			</header>

			{/* Assessment Outcome & Consent Decision */}
			{current === "proceed" && (
				<AssessmentOutcomeCard
					outcome={booking.eligibilityOutcome === "conditional" ? "Conditionally Eligible" : "Eligible"}
					notes={booking.eligibilityNote}
					recommendations={{
						country: booking.assessmentResult?.recCountry,
						university: booking.assessmentResult?.recUniversity,
						program: booking.assessmentResult?.recProgram,
						package: booking.assessmentResult?.recPackage,
					}}
					currentDecision={application.applicationConsent?.decision ?? null}
					onDecided={() => void syncFromServer()}
				/>
			)}

			{/* The one band: action when something needs the applicant, status when
			    the wait is on our side. Never both, never a staff-only verb. */}
			{current !== "proceed" && (
				pendingAction ? (
					<div className="dband mt-5">
						<div className="dband__main">
							<p className="eyebrow">Action required</p>
							<p className="dband__title">{pendingAction.title}</p>
							<p className="dband__detail">{pendingAction.detail}</p>
						</div>
						<div className="dband__act">
							<Button to={pendingAction.to} variant="primary" arrow>
								{pendingAction.label}
							</Button>
						</div>
					</div>
				) : nextAppt ? (
					<div className="dband dband--wait mt-5">
						<div className="dband__main">
							<p className="eyebrow">Up next</p>
							<p className="dband__title">
								{current === "new" || current === "consultation"
									? "Your consultation is booked"
									: nextAppt.serviceName}
							</p>
							<p className="dband__detail">
								{slotConfirming
									? "The branch is confirming the slot — nothing for you to do. If it moves, you'll see it here and in your email."
									: "Confirmed. Join from your appointments page, or move the slot free up to 24h before."}
							</p>
							<div className="dband__appt">
								<div className="dband__date">
									<b>{new Date(nextAppt.startsAt).getDate()}</b>
									<span>{new Date(nextAppt.startsAt).toLocaleDateString(undefined, { month: "short" })}</span>
								</div>
								<div>
									<p className="dband__apptname">{nextAppt.serviceName}</p>
									<p className="dband__apptmeta">
										{new Date(nextAppt.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
										{" · "}{nextAppt.type === "online" ? "Online" : "In person"}
										{nextAppt.employeeName ? ` · ${nextAppt.employeeName}` : ""}
										{nextAppt.reference ? ` · ${nextAppt.reference}` : ""}
										{nextAppt.rescheduleRequestedAt ? " · reschedule asked" : ""}
									</p>
								</div>
								<span className={`dband__chip${slotConfirming ? "" : " dband__chip--ok"}`}>
									{slotConfirming ? "Confirming" : "Confirmed"}
								</span>
							</div>
						</div>
						<div className="dband__act">
							<Button to="/portal/appointments" variant="secondary" arrow>
								Manage appointment
							</Button>
						</div>
					</div>
				) : (
					<div className="dband dband--wait mt-5">
						<div className="dband__main">
							<p className="eyebrow">You are here</p>
							<p className="dband__title">{STAGE_SHORT[current] ?? meta.title}</p>
							<p className="dband__detail">{meta.desc}</p>
							{journeyPhase.nextUnlock ? <p className="dband__detail">{journeyPhase.nextUnlock}</p> : null}
						</div>
						<div className="dband__act">
							<Button to={cta.to} variant="secondary" arrow>
								{cta.label}
							</Button>
						</div>
					</div>
				)
			)}

			{/* The six chapters as one slim rail */}
			{current !== "proceed" && (
				<div className="jrail mt-4">
					{CHAPTERS.map((ch) => {
						const st = chapterStateOf(ch.id, current, stageStatuses);
						return (
							<Link
								key={ch.id}
								to={CHAPTER_PATH[ch.id]}
								className={`jrail__step jrail__step--${st === "current" ? "now" : st}`}
							>
								<span className="jrail__n">{st === "done" ? "✓" : ch.numeral}</span>
								<span className="jrail__name">{ch.label}</span>
							</Link>
						);
					})}
				</div>
			)}

			{current !== "proceed" && (
				<div className="psplit mt-5">
					<div>
						{/* Needs you — real open items, not the stage blurb */}
						<div className="ncard">
							<div className="ncard__h">
								<p className="eyebrow">
									{currentChapter === "apply" && schoolApplications.length > 0
										? "Now · Applications"
										: "Needs you"}
								</p>
								<span className="ncard__r">
									{currentChapter === "apply" && schoolApplications.length > 0
										? `${schoolApplications.length} school${schoolApplications.length === 1 ? "" : "s"} filed`
										: `${(pendingAction ? 1 : 0) + (money?.dueList.length ?? 0) || "all clear"}`}
								</span>
							</div>
							<div className="ncard__b">
								{currentChapter === "apply" && schoolApplications.length > 0 ? (
									schoolApplications.map((s) => (
										<div key={s.id} className="nli">
											<span className="nli__t">
												<strong>{s.universityName ?? "University"}</strong>
												{s.programName ? ` · ${s.programName}` : ""}
											</span>
											<span className={`portal-pill${s.outcome === "Admitted" ? " portal-pill--solid" : ""}`}>
												{s.outcome ?? s.status}
											</span>
										</div>
									))
								) : (
									<>
										{pendingAction ? (
											<div className="nli">
												<span className="nli__t">{pendingAction.title}</span>
												<Link to={pendingAction.to} className="nli__s nli__s--warn">{pendingAction.label} →</Link>
											</div>
										) : null}
										{money?.dueList.map((i) => (
											<div key={i.invoiceNumber} className="nli">
												<span className="nli__t">Invoice {i.invoiceNumber}</span>
												<span className="nli__s nli__s--warn"><MoneyStack usd={i.balanceCents / 100} /> due</span>
											</div>
										))}
										{nextAppt ? (
											<div className="nli">
												<span className="nli__t">{nextAppt.serviceName}</span>
												<span className="nli__s nli__s--ok">
													{slotConfirming ? "Booked" : "Confirmed"} · {new Date(nextAppt.startsAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
												</span>
											</div>
										) : null}
										{!pendingAction && (money?.dueList.length ?? 0) === 0 && !nextAppt ? (
											<div className="nli">
												<span className="nli__t muted">Nothing waiting on you — the file is moving.</span>
											</div>
										) : null}
									</>
								)}
							</div>
							<div className="ncard__f">
								<span>
									{currentChapter === "apply" && schoolApplications.length > 0
										? offersCount > 0
											? `${offersCount} offer${offersCount === 1 ? "" : "s"} in. Accepting one opens the visa chapter.`
											: "Your handler lodges each file and chases replies."
										: "Everything else is moving on its own."}
								</span>
								<Link to="/portal/journey" className="jlink">Journey map →</Link>
							</div>
						</div>
					</div>

					{/* The rail. One "file" card: money, people, documents — then updates */}
					<div className="prail">
						<div className="sharp-card sharp-card--key sharp-card--invert dfile">
							<div className="dfile__sec">
								<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>Money</p>
								{money ? (
									<>
										<div className="pkv" style={{ borderColor: "rgba(255,255,255,0.3)" }}>
											<span className="pkv__k" style={{ color: "rgba(255,255,255,0.72)" }}>Paid to date</span>
											<span className="pkv__v"><MoneyStack usd={money.paid} /></span>
										</div>
										<div className="pkv" style={{ borderColor: "rgba(255,255,255,0.3)" }}>
											<span className="pkv__k" style={{ color: "rgba(255,255,255,0.72)" }}>Due now</span>
											<span className="pkv__v">{money.due > 0 ? <MoneyStack usd={money.due} /> : "N/A"}</span>
										</div>
									</>
								) : (
									<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", color: "rgba(255,255,255,0.7)" }}>
										Loading your ledger…
									</p>
								)}
								<p style={{ marginTop: "0.6rem" }}>
									<Link to="/portal/financial" className="jlink" style={{ color: "rgba(255,255,255,0.85)" }}>Open the ledger →</Link>
								</p>
							</div>
							<div className="dfile__sec">
								<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>Your people</p>
								<div className="pkv" style={{ borderColor: "rgba(255,255,255,0.3)" }}>
									<span className="pkv__k" style={{ color: "rgba(255,255,255,0.72)" }}>Consultant</span>
									<span className="pkv__v">{booking.consultantName ?? application.assignedStaffName ?? "Assigning…"}</span>
								</div>
								<div className="pkv" style={{ borderColor: "rgba(255,255,255,0.3)" }}>
									<span className="pkv__k" style={{ color: "rgba(255,255,255,0.72)" }}>Handler</span>
									<span className="pkv__v">{application.assignedStaffName ?? "N/A"}</span>
								</div>
								<div className="pkv" style={{ borderColor: "rgba(255,255,255,0.3)" }}>
									<span className="pkv__k" style={{ color: "rgba(255,255,255,0.72)" }}>Travel officer</span>
									<span className="pkv__v">{application.travelAssistance?.assignedOpsUserName ?? "assigned later"}</span>
								</div>
							</div>
							<div className="dfile__sec">
								<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>
									Documents · {docsOnFile !== null ? `${docsOnFile} on file` : "…"}
								</p>
								<Link to="/portal/documents" className="jlink" style={{ color: "rgba(255,255,255,0.85)" }}>Open the vault →</Link>
							</div>
						</div>

						{/* From your file. The consultant's latest notes, newest first */}
						<ConsultantUpdates comments={application.comments} limit={3} title="From your file" />
					</div>
				</div>
			)}

			{/* Return to marketing website link */}
			<div className="row mt-5">
				<Link to="/" className="link-arrow">
					← Public website
				</Link>
			</div>
		</div>
	);
}
