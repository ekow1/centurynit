import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { useAppState } from "../../context/AppState";
import { PROCESS_STAGES, type ProcessStageId } from "century-nit-core";
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
		// invited — the consent gate is still open. The consultation page shows
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
	payment_execution: { title: "Pre-departure fee milestone", desc: "Due once your visa is approved — your ticket is issued after it." },
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
	const cta = currentStageCta(current, application.proceedStatus);
	const meta = STAGE_META[current];
	const stageMeta = PROCESS_STAGES.find((s) => s.id === current);

	// Reference ID depends on the stage:
	// consultation ref exists once the consultation is booked+paid,
	// application ID exists once the application invoice is paid.
	const consultationRef = booking.confirmationId;
	const applicationId = application.appNumber;

	const currentChapter = PORTAL_STEP_CHAPTER[current as PortalStepId] as ChapterId | undefined;

	/* ── Rail data: money position, next appointment, documents on file ── */
	const [money, setMoney] = useState<{ paid: number; due: number; next: string | null } | null>(null);
	const [nextAppt, setNextAppt] = useState<Booking | null>(null);
	const [docsOnFile, setDocsOnFile] = useState<number | null>(null);

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
						.reduce((n, i) => n + i.subtotalCents - i.balanceCents, 0) / 100 +
					(booking.paymentStatus === "success" ? 0 : 0);
				const dueList = live.filter((i) => i.balanceCents > 0 && i.status !== "proforma");
				const due = dueList.reduce((n, i) => n + i.balanceCents, 0) / 100;
				setMoney({
					paid,
					due,
					next: dueList[0] ? `${dueList[0].invoiceNumber}` : null,
				});
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

	return (
		<div className="portal-page dash-home">
			<header className="dash-home__hero">
				<p className="eyebrow">Overview</p>
				<h1 className="page-title mt-1">
					Welcome{authUser ? `, ${authUser.name.split(" ")[0]}` : ""}
				</h1>
				<p className="lead mt-2">
					One glance at your journey — where you are, what needs you, and who is on your file.
				</p>
				<div className="dash-refs">
					<span className="dash-ref">
						Application ID · <strong>{applicationId ?? "Not issued"}</strong>
					</span>
					<span className="dash-ref">
						Consultation reference · <strong>{consultationRef ?? "Not booked"}</strong>
					</span>
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

			{/* The one ask — action required, else where you stand */}
			{current !== "proceed" && (pendingAction ? (
				<div className="action-now mt-5">
					<div>
						<p className="eyebrow">Action required</p>
						<p className="display action-now__title">{pendingAction.title}</p>
						<p className="action-now__detail">{pendingAction.detail}</p>
					</div>
					<Button to={pendingAction.to} variant="primary" arrow>
						{pendingAction.label}
					</Button>
				</div>
			) : (
				<div className="journey-now mt-5">
					<div>
						<p className="eyebrow">You are here</p>
						<p className="display journey-now__title">
							{STAGE_SHORT[current] ?? stageMeta?.label ?? journeyPhase.label}
						</p>
						<p className="journey-now__detail">{meta.desc}</p>
						{journeyPhase.nextUnlock ? (
							<p className="journey-now__detail">{journeyPhase.nextUnlock}</p>
						) : null}
					</div>
					<Button to={cta.to} variant="inverted" arrow>
						{cta.label}
					</Button>
				</div>
			))}

			{/* The six chapters, at a glance — the journey map's edge into home */}
			{current !== "proceed" && (
				<div className="jmini mt-4">
					{CHAPTERS.map((ch) => {
						const st = chapterStateOf(ch.id, current, stageStatuses);
						return (
							<Link
								key={ch.id}
								to={CHAPTER_PATH[ch.id]}
								className={`jmini--${st === "current" ? "now" : st}`}
							>
								<span className="jmini__n">{st === "done" ? "✓" : ch.numeral}</span>
								<p className="jmini__name">{ch.label}</p>
								<p className="jmini__st">
									{st === "done" ? "Done" : st === "current" ? "You are here" : "Locked"}
								</p>
							</Link>
						);
					})}
				</div>
			)}

			{current !== "proceed" && (
				<div className="psplit mt-5">
					<div>
						{/* Now — the live detail of the chapter you are in */}
						<div className="psec">
							<span className="psec__title">Now · {CHAPTERS.find((c) => c.id === currentChapter)?.label ?? meta.title}</span>
							<span className="psec__hint">
								{currentChapter === "apply" && schoolApplications.length > 0
									? `${schoolApplications.length} school${schoolApplications.length === 1 ? "" : "s"} filed`
									: (STAGE_SHORT[current] ?? stageMeta?.label ?? "")}
							</span>
						</div>
						<div className="nowlist">
							{currentChapter === "apply" && schoolApplications.length > 0 ? (
								<>
									{schoolApplications.map((s) => (
										<div key={s.id} className="nowlist__row">
											<span>
												<strong>{s.universityName ?? "University"}</strong>
												{s.programName ? ` · ${s.programName}` : ""}
											</span>
											<span className={`portal-pill${s.outcome === "Admitted" ? " portal-pill--solid" : ""}`}>
												{s.outcome ?? s.status}
											</span>
										</div>
									))}
									<div className="nowlist__row nowlist__foot">
										<span>
											{offersCount > 0
												? `${offersCount} offer${offersCount === 1 ? "" : "s"} in — accepting one opens the visa chapter.`
												: "Your handler lodges each file and chases replies — changes land here first."}
										</span>
										<Link to="/portal/application" className="jlink">Open applications →</Link>
									</div>
								</>
							) : (
								<>
									<div className="nowlist__row nowlist__lead" style={{ borderBottom: "none" }}>
										<span>{meta.desc}</span>
									</div>
									<div className="nowlist__row nowlist__foot">
										<span>{STAGE_SHORT[current] ?? stageMeta?.label ?? ""} · chapter {currentChapter ? CHAPTERS.find((c) => c.id === currentChapter)?.numeral : ""}</span>
										<Link to={cta.to} className="jlink">{cta.label} →</Link>
									</div>
								</>
							)}
						</div>

						<p className="mt-3">
							<Link to="/portal/journey" className="jlink">Open the journey map →</Link>
						</p>
					</div>

					{/* The rail — money, calendar, people, documents */}
					<div className="prail">
						<div className="sharp-card sharp-card--key">
							<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>Money</p>
							{money ? (
								<>
									<div className="pkv" style={{ borderColor: "rgba(255,255,255,0.3)" }}>
										<span className="pkv__k" style={{ color: "rgba(255,255,255,0.72)" }}>Paid to date</span>
										<span className="pkv__v"><MoneyStack usd={money.paid} /></span>
									</div>
									<div className="pkv" style={{ borderColor: "rgba(255,255,255,0.3)" }}>
										<span className="pkv__k" style={{ color: "rgba(255,255,255,0.72)" }}>Due now</span>
										<span className="pkv__v">{money.due > 0 ? <MoneyStack usd={money.due} /> : "—"}</span>
									</div>
								</>
							) : (
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", color: "rgba(255,255,255,0.7)" }}>
									Loading your ledger…
								</p>
							)}
							<p style={{ marginTop: "0.8rem" }}>
								<Link to="/portal/financial" className="jlink" style={{ color: "rgba(255,255,255,0.85)" }}>Open the ledger →</Link>
							</p>
						</div>

						<div className="sharp-card">
							<p className="eyebrow">Next appointment</p>
							{nextAppt ? (
								<>
									<div className="appt-mini">
										<div className="appt-mini__date">
											<b>{new Date(nextAppt.startsAt).getDate()}</b>
											<span>{new Date(nextAppt.startsAt).toLocaleDateString(undefined, { month: "short" })}</span>
										</div>
										<div>
											<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{nextAppt.serviceName}</p>
											<p className="mono muted" style={{ fontSize: "0.62rem" }}>
												{new Date(nextAppt.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
												{" · "}{nextAppt.type === "online" ? "Online" : "In person"}
												{nextAppt.employeeName ? ` · ${nextAppt.employeeName}` : ""}
											</p>
										</div>
									</div>
									<p style={{ marginTop: "0.8rem" }}>
										<Link to="/portal/appointments" className="jlink">Join / manage →</Link>
									</p>
								</>
							) : (
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
									Nothing scheduled.
								</p>
							)}
						</div>

						<div className="sharp-card">
							<p className="eyebrow">Your people</p>
							<div style={{ marginTop: "0.4rem" }}>
								<div className="pkv">
									<span className="pkv__k">Consultant</span>
									<span className="pkv__v">{booking.consultantName ?? application.assignedStaffName ?? "Assigning…"}</span>
								</div>
								<div className="pkv">
									<span className="pkv__k">Handler</span>
									<span className="pkv__v">{application.assignedStaffName ?? "—"}</span>
								</div>
								<div className="pkv">
									<span className="pkv__k">Travel officer</span>
									<span className="pkv__v">{application.travelAssistance?.assignedOpsUserName ?? "assigned later"}</span>
								</div>
							</div>
							<p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.6rem" }}>
								Message any of them through the chat, bottom right.
							</p>
						</div>

						<div className="sharp-card">
							<p className="eyebrow">Documents</p>
							<div className="pkv" style={{ marginTop: "0.4rem" }}>
								<span className="pkv__k">On file</span>
								<span className="pkv__v"><strong>{docsOnFile !== null ? `${docsOnFile}` : "—"}</strong></span>
							</div>
							<p style={{ marginTop: "0.8rem" }}>
								<Link to="/portal/documents" className="jlink">Open the vault →</Link>
							</p>
						</div>

						{/* From your file — the consultant's latest notes, newest first */}
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
