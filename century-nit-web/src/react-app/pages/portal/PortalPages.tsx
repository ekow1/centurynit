import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { API_PREFIX, JOURNEY_STAGE_LABELS, INVOICE_TYPE_LABELS, LookupValue, MAX_STUDY_CHOICES, PAYMENT_PLAN_LABELS, decisionOf, type JourneyStage, type StudyChoice } from "century-nit-shared";
import { Button } from "../../components/ui/Button";
import { Money, MoneyInline } from "../../components/ui/Money";
import { Field, Select } from "../../components/ui/Field";
import { InvoiceCard, JourneyStepper, NextActionBand, StatusPill, formatMoney, type NextAction, type Tone } from "century-nit-core/ui";
import { downloadReceipt } from "../../lib/receipt";
import { StageConsentCard } from "../../components/StageConsentCard";
import { EnrolmentDecision } from "../../components/EnrolmentDecision";
import { AssessmentOutcomeCard } from "../../components/AssessmentOutcomeCard";
import {
	hasAcceptedOffer,
	hasSchoolPackage,
	documentsReleasedFor,
	documentHoldReasonFor,
	useAppState,
	type AssessmentData,
	type AssessmentDoc,
	type BookingData,
	type EligibilityOutcome,
	type InvoiceLine,
	type SchoolApplicationTrack,
	type StageInvoice,
	FALLBACK_FEE_SCHEDULE,
	emptyStudyChoice,
	flattenStudyChoices,
} from "../../context/AppState";
import { usdFromCents } from "century-nit-shared";
import {
	destinations,
	formatDualCurrency,
	getDestination,
	getProgram,
	getUniversity,
	programs,
	programsForUniversity,
	SCHOOL_DEGREE_LEVELS,
	SCHOOL_FUNDING_TRACKS,
	PAYMENT_PLANS,
	type PaymentPlanId,
	serviceFeeForPackage,
	filterProgramsForPackage,
	universitiesForPrograms,
	SCHOOL_TRACK_STATUS_LABELS,
	SCHOOL_TRACK_STAGES,
	SCHOOL_OUTCOME_LABELS,
	schoolDecisionNote,
	type SchoolDegreeLevel,
	type SchoolFundingTrack,
	type SchoolTrackStatus,
	universities,
	universitiesForDestination,
	CONSULTATION_DURATIONS,
	getBranchName,
	branches,
} from "century-nit-core";
import { meApi, bookingsApi, schoolsApi, documentsApi, feesApi, packagesApi, ApiError, visaCostsCentsFor } from "century-nit-core/api";
import type { ApiInvoice, ApplicantDocument, AvailabilitySlot, ApiConsultation, ApiApplication, ServicePackage, SchoolFileKind } from "century-nit-shared";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "century-nit-shared";
import { useNotifier } from "../../components/notifier/Notifier";
import { UploadPickModal } from "../../components/portal/UploadPickModal";
import { prepareDocumentForUpload } from "../../lib/upload";



import { STAGE_SHORT } from "../../data/stageLabels";
import { ChapterGate } from "./PortalLayout";
import { ConsultationAppointmentCard } from "./ConsultationAppointmentCard";
import { ConsultantUpdates, isVisaUpdate } from "./ConsultantUpdates";
import { OfficialDocuments, officialRows } from "../../components/OfficialDocuments";

/* ========== Journey ========== */

export function PortalJourney() {
	return <Navigate to="/portal/home" replace />;
}

/* ========== Awaiting handler assignment (after 10% deposit) ========== */

export function PortalAwaitingHandler() {
	const { application, journeyPhase, syncFromServer } = useAppState();
	const navigate = useNavigate();

	const hasHandler = Boolean(application.assignedStaffId);
	const stageAdvanced =
		(journeyPhase.stage !== "awaiting_handler" &&
		journeyPhase.stage !== "school_package" &&
		journeyPhase.stage !== "proceed" &&
		journeyPhase.stage !== "consultation" &&
		journeyPhase.stage !== "eligibility") ||
		(!application.pendingHandoff && application.agencyDepositPaid);

	// The assignment arrives over SSE (`stage.changed` /
	// `assignment.handoff_resolved`), which AppState turns into a sync. A
	// slow interval is only the fallback for a dropped stream.
	useEffect(() => {
		void syncFromServer();
		const timer = window.setInterval(() => void syncFromServer(), 20_000);
		return () => window.clearInterval(timer);
	}, [syncFromServer]);

	useEffect(() => {
		if (hasHandler || stageAdvanced) {
			navigate("/portal/application", { replace: true });
		}
	}, [hasHandler, stageAdvanced, navigate]);

	if (hasHandler || stageAdvanced) {
		return (
			<div className="portal-page">
				<header className="portal-page__header">
					<p className="eyebrow">Dashboard · Application</p>
					<h1 className="page-title mt-1">Handler Assigned</h1>
				</header>
				<div className="sharp-card">
					<p className="display" style={{ fontSize: "1.2rem" }}>
						Your consultant has been assigned
					</p>
					<p className="muted mt-2">
						{application.assignedStaffName
							? `${application.assignedStaffName} has been assigned to your case.`
							: "Your consultant has been assigned."}{" "}
						You can now proceed to select your preferred schools and programmes.
					</p>
					<div className="mt-4">
						<Link to="/portal/application" className="btn btn--primary">
							Continue to School Selection →
						</Link>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<p className="eyebrow">Dashboard · Application</p>
				<h1 className="page-title mt-1">Your consultant is being assigned</h1>
			</header>
			<div className="sharp-card">
				<p className="display" style={{ fontSize: "1.2rem" }}>
					Your 10% deposit has been received
				</p>
				<p className="muted mt-2">
					A handler is being assigned to your case. Once assigned, you'll be able to
					select schools and programmes. This usually happens within 1–2 business days.
				</p>
				<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>
					You don't need to do anything right now — checking status automatically in the background.
				</p>
				<div className="mt-4 row" style={{ gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
					<span
						className="portal-pill portal-pill--draft"
						style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
					>
						<span
							style={{
								width: "8px",
								height: "8px",
								borderRadius: "50%",
								background: "var(--foreground)",
								display: "inline-block",
								animation: "pulse 1.5s infinite ease-in-out",
							}}
						/>
						Checking assignment behind the scenes…
					</span>
					<Link to="/portal/journey" className="btn btn--ghost">
						View Application Journey
					</Link>
				</div>
			</div>
		</div>
	);
}

/* ========== Awaiting application invoice (after school lock) ========== */

export function PortalAwaitingInvoice() {
	const { syncFromServer, syncTick } = useAppState();
	const navigate = useNavigate();
	// The invoice waits on the standard documents (collected at consultation);
	// if any is still outstanding, say so — it is the client's move, not ours.
	const [outstandingDocs, setOutstandingDocs] = useState<{ name: string; status: string }[]>([]);
	useEffect(() => {
		let active = true;
		meApi
			.application()
			.then((me) => {
				if (!active) return;
				const list = me.application?.documentChecklist ?? me.consultation?.documentChecklist ?? [];
				setOutstandingDocs(list.filter((d) => d.status !== "VERIFIED").map((d) => ({ name: d.name, status: d.status })));
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [syncTick]);
	const toUpload = outstandingDocs.filter((d) => d.status === "PENDING_UPLOAD" || d.status === "REJECTED");

	// Re-check whenever AppState syncs — which happens on the `invoice.issued`
	// SSE event — plus a slow fallback interval.
	useEffect(() => {
		let active = true;
		const checkInvoice = async () => {
			try {
				const { invoices } = await meApi.invoices({ type: "application" });
				const inv = invoices.find((i) => i.status === "issued" || i.status === "partial" || i.status === "paid");
				if (inv && active) navigate("/portal/application", { replace: true });
			} catch {
				/* silent background retry */
			}
		};
		void checkInvoice();
		return () => {
			active = false;
		};
	}, [navigate, syncTick]);

	useEffect(() => {
		const timer = window.setInterval(() => void syncFromServer(), 20_000);
		return () => window.clearInterval(timer);
	}, [syncFromServer]);

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<p className="eyebrow">Dashboard · Application</p>
				<h1 className="page-title mt-1">Awaiting application invoice</h1>
			</header>
			<div className="sharp-card">
				<p className="display" style={{ fontSize: "1.2rem" }}>
					Your school selection has been submitted
				</p>
				{outstandingDocs.length > 0 ? (
					<>
						<p className="muted mt-2">
							{toUpload.length > 0
								? `Before the application fee can be raised, ${toUpload.length === 1 ? "one document still needs" : `${toUpload.length} documents still need`} uploading: ${toUpload.map((d) => d.name).join(", ")}.`
								: `Your consultant is verifying your documents (${outstandingDocs.map((d) => d.name).join(", ")}). The application fee is raised once they are all verified.`}
						</p>
						{toUpload.length > 0 && (
							<div className="row mt-3">
								<Link to="/portal/documents" className="btn btn--primary">
									Upload in the vault →
								</Link>
							</div>
						)}
					</>
				) : (
					<p className="muted mt-2">
						Your consultant is reviewing your selected schools and programmes. The application
						fee will be raised shortly — you'll be able to pay it once it's issued.
					</p>
				)}
				<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>
					You don't need to do anything right now — checking status automatically in the background.
				</p>
				<div className="mt-4 row" style={{ gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
					<span
						className="portal-pill portal-pill--draft"
						style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
					>
						<span
							style={{
								width: "8px",
								height: "8px",
								borderRadius: "50%",
								background: "var(--foreground)",
								display: "inline-block",
								animation: "pulse 1.5s infinite ease-in-out",
							}}
						/>
						Checking invoice status behind the scenes…
					</span>
					<Link to="/portal/journey" className="btn btn--ghost">
						View Application Journey
					</Link>
				</div>
			</div>
		</div>
	);
}

/* ========== School application package (after eligibility) ========== */

export function PortalPackage() {
	return (
		<ChapterGate chapter="package">
			<SchoolPackageInner />
		</ChapterGate>
	);
}

function SchoolPackageInner() {
	const { application, chooseSchoolPackage, payAgencyInstallment, booking, choosePaymentPlan } = useAppState();
	const { toast } = useNotifier();
	const nav = useNavigate();
	const [dbPackages, setDbPackages] = useState<ServicePackage[]>([]);
	const [funding, setFunding] = useState<SchoolFundingTrack | "">(
		application.schoolFundingTrack || "",
	);
	const [level, setLevel] = useState<SchoolDegreeLevel | "">(
		application.schoolDegreeLevel || "",
	);
	const [targetSchoolCount, setTargetSchoolCount] = useState<number>(
		application.targetSchoolCount || 3,
	);
	const [recommendedTrack, setRecommendedTrack] = useState<SchoolFundingTrack | null>(null);
	const [recommendedLevel, setRecommendedLevel] = useState<SchoolDegreeLevel | null>(null);
	const [saving, setSaving] = useState(false);
	const [payingDeposit, setPayingDeposit] = useState(false);
	const chosen = hasSchoolPackage(application);
	const isDepositPaid = Boolean(application.agencyDepositPaid);
	const isLocked = isDepositPaid;
	// Enrolment in four steps: confirm · package & plan · deposit · consultant.
	const confirmed = decisionOf(application.applicationConsent?.decision ?? application.proceedStatus) === "confirmed";
	const [plan, setPlan] = useState<PaymentPlanId>((application.paymentPlanId as PaymentPlanId) || "full");
	const [savingPlan, setSavingPlan] = useState(false);
	const enrolSteps = [
		{ label: "Confirmed", done: confirmed },
		{ label: "Package & plan", done: chosen && Boolean(application.paymentPlanId) },
		{ label: "Deposit paid", done: isDepositPaid },
		{ label: "Consultant assigned", done: Boolean(application.assignedStaffId) },
	];
	async function savePlan(next: PaymentPlanId) {
		setPlan(next);
		if (next === application.paymentPlanId) return;
		setSavingPlan(true);
		try {
			await meApi.choosePaymentPlan({ paymentPlanId: next });
			choosePaymentPlan(next);
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not save your payment plan.");
		} finally {
			setSavingPlan(false);
		}
	}

	useEffect(() => {
		packagesApi.list()
			.then((res) => {
				if (res?.packages && Array.isArray(res.packages) && res.packages.length > 0) {
					setDbPackages(res.packages.filter((p) => p.active));
				}
			})
			.catch(console.error);
	}, []);

	useEffect(() => {
		const applyRec = (rec?: { recPackage?: string | null; recProgram?: string | null }) => {
			if (!rec) return;
			if (rec.recPackage) {
				const p = rec.recPackage.toLowerCase();
				let track: SchoolFundingTrack | null = null;
				if (p.includes("non")) track = "non_scholarship";
				else if (p.includes("hybrid")) track = "hybrid";
				else if (p.includes("scholarship")) track = "scholarship";
				if (track) {
					setRecommendedTrack(track);
					if (!application.schoolFundingTrack) {
						setFunding(track);
					}
				}
			}
			if (rec.recProgram) {
				const prog = rec.recProgram.toLowerCase();
				let lvl: SchoolDegreeLevel | null = null;
				if (prog.includes("master") || prog.includes("msc") || prog.includes("mba") || prog.includes("postgraduate")) {
					lvl = "masters";
				} else if (prog.includes("bachelor") || prog.includes("bsc") || prog.includes("undergraduate")) {
					lvl = "bachelor";
				} else if (prog.includes("phd") || prog.includes("doctor")) {
					lvl = "phd";
				}
				if (lvl) {
					setRecommendedLevel(lvl);
					if (!application.schoolDegreeLevel) {
						setLevel(lvl);
					}
				}
			}
		};

		if (booking.assessmentResult) {
			applyRec(booking.assessmentResult);
		}
		meApi.application()
			.then((res) => {
				if (res.consultation?.assessmentResult) {
					applyRec(res.consultation.assessmentResult);
				}
			})
			.catch(() => {});
	}, [booking.assessmentResult, application.schoolFundingTrack, application.schoolDegreeLevel]);

	const activeFunding = (funding || application.schoolFundingTrack || "scholarship") as SchoolFundingTrack;
	const activeLevel = (level || application.schoolDegreeLevel || "masters") as SchoolDegreeLevel;

	const selectedPkg = dbPackages.find((p) => p.code === activeFunding);
	const fundMeta = selectedPkg
		? { id: selectedPkg.code as SchoolFundingTrack, name: selectedPkg.name, tagline: selectedPkg.tagline || "", blurb: selectedPkg.features?.[0] || "" }
		: SCHOOL_FUNDING_TRACKS.find((f) => f.id === activeFunding);
	const levelMeta = SCHOOL_DEGREE_LEVELS.find((d) => d.id === activeLevel);

	const totalServiceFeeCents = (selectedPkg && selectedPkg.priceCents > 0)
		? selectedPkg.priceCents
		: serviceFeeForPackage(activeLevel, activeFunding, targetSchoolCount);
	const serviceFee = totalServiceFeeCents / 100;
	const depositCents = Math.max(1, Math.round(totalServiceFeeCents * 0.1));
	const depositUsd = depositCents / 100;
	const remainingUsd = serviceFee - depositUsd;

	const packageCards = dbPackages.length > 0
		? dbPackages.map((p) => ({
				id: p.code as SchoolFundingTrack,
				name: p.name,
				tagline: p.tagline || (p.code === "scholarship" ? "Funded / award-led path" : p.code === "hybrid" ? "Partial award + self-fund" : "Self-funded / family-funded"),
				blurb: p.tagline || p.features?.[0] || "",
				priceCents: p.priceCents,
				features: p.features,
				exclusions: p.exclusions,
				maxSchools: p.maxSchools,
		  }))
		: SCHOOL_FUNDING_TRACKS.map((f) => ({
				...f,
				priceCents: serviceFeeForPackage(activeLevel, f.id, 1),
				features: [],
				exclusions: [],
				maxSchools: 3,
		  }));

	async function confirm(andPayDeposit = false) {
		if (!funding || !level || saving || payingDeposit) return;
		setSaving(true);
		try {
			await meApi.choosePackage({
				packageCode: funding,
				degreeLevel: level,
				targetSchoolCount,
			});
			chooseSchoolPackage(funding, level, targetSchoolCount, totalServiceFeeCents);
			if (plan !== application.paymentPlanId) {
				await meApi.choosePaymentPlan({ paymentPlanId: plan });
				choosePaymentPlan(plan);
			}

			if (andPayDeposit) {
				setPayingDeposit(true);
				await payAgencyInstallment();
				return;
			}
			toast.success("Package and plan saved. Pay the deposit to begin choosing schools.");
			nav("/portal/application", { replace: true });
		} catch (err) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Could not save your package. Please try again.";
			toast.error(msg);
		} finally {
			setSaving(false);
			setPayingDeposit(false);
		}
	}

	const scopeFeatures =
		selectedPkg?.features && selectedPkg.features.length > 0
			? selectedPkg.features
			: [
					"Academic credential evaluation",
					"Document verification & notarisation",
					"Direct university portal submissions",
					"Statement of purpose polishing",
					"Courier & international dispatch",
					"Visa mock-interview coaching",
				];

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter II · Enrolment</p>
					<h1 className="page-title mt-1">Enrol with Century NIT</h1>
					<p className="lead mt-2">
						Confirm you're enrolling, choose your package and plan, pay the deposit — your
						consultant is assigned when it lands.
					</p>
				</div>
			</header>

			<ol className="psteps mt-3">
				{enrolSteps.map((st, i) => {
					const current = !st.done && enrolSteps.slice(0, i).every((x) => x.done);
					return (
						<li key={st.label}>
							<span
								className={`portal-pill${st.done ? " portal-pill--done" : current ? " portal-pill--solid" : " portal-pill--hollow"}`}
							>
								{i + 1} · {st.label}
								{st.done ? " ✓" : ""}
							</span>
						</li>
					);
				})}
			</ol>

			<div className="psplit mt-4">
				{/* left: the choices, numbered once */}
				<div>
					<section className="psec">
						<p>
							<span className={`psec__no${confirmed ? " psec__no--done" : ""}`}>1</span>
							<span className="psec__title">Confirm your enrolment</span>
						</p>
						<div className="sharp-card" style={{ marginTop: "0.6rem" }}>
							<EnrolmentDecision />
						</div>
						{!confirmed && (
							<p className="psec__hint">Confirm above to choose your package and plan.</p>
						)}
					</section>

					{confirmed && (
						<>
							<section className="psec">
								<p>
									<span className={`psec__no${isLocked ? " psec__no--done" : ""}`}>2</span>
									<span className="psec__title">Funding track</span>
								</p>
								<div className="pcards" style={{ marginTop: "0.6rem" }}>
									{packageCards.map((f) => (
										<button
											key={f.id}
											type="button"
											className={`pick${activeFunding === f.id ? " pick--on" : ""}`}
											onClick={() => !isLocked && setFunding(f.id)}
											disabled={isLocked}
											aria-pressed={activeFunding === f.id}
										>
											{recommendedTrack === f.id && <span className="pick__tag">Advisor's pick</span>}
											<span className="eyebrow">{f.tagline}</span>
											<span className="pick__name">{f.name}</span>
											<span className="muted" style={{ fontSize: "var(--text-xs)" }}>{f.blurb}</span>
											{f.priceCents > 0 && (
												<span className="pick__price">
													<Money usd={f.priceCents / 100} />
												</span>
											)}
										</button>
									))}
								</div>
							</section>

							<section className="psec">
								<p>
									<span className={`psec__no${isLocked ? " psec__no--done" : ""}`}>3</span>
									<span className="psec__title">Degree level</span>
								</p>
								<div className="pchips" style={{ marginTop: "0.6rem" }}>
									{SCHOOL_DEGREE_LEVELS.map((d) => (
										<button
											key={d.id}
											type="button"
											className={`pchip${activeLevel === d.id ? " pchip--on" : ""}`}
											onClick={() => !isLocked && setLevel(d.id)}
											disabled={isLocked}
											aria-pressed={activeLevel === d.id}
										>
											{d.short}
											<small>
												{d.name}
												{recommendedLevel === d.id ? " · advisor's pick" : ""}
											</small>
										</button>
									))}
								</div>
							</section>

							<section className="psec">
								<p>
									<span className={`psec__no${isLocked ? " psec__no--done" : ""}`}>4</span>
									<span className="psec__title">Target schools</span>
								</p>
								<p className="psec__hint">
									We prepare, review and lodge submissions across your full list. Three is the
									recommended spread.
								</p>
								<div className="pchips">
									{[1, 2, 3, 4, 5, 6].map((count) => (
										<button
											key={count}
											type="button"
											className={`pchip${targetSchoolCount === count ? " pchip--on" : ""}`}
											onClick={() => !isLocked && setTargetSchoolCount(count)}
											disabled={isLocked}
											aria-pressed={targetSchoolCount === count}
										>
											{count}
											{count === 3 ? <small>recommended</small> : null}
										</button>
									))}
								</div>
							</section>

							<section className="psec">
								<p>
									<span className={`psec__no${isLocked ? " psec__no--done" : ""}`}>5</span>
									<span className="psec__title">Payment plan</span>
								</p>
								<p className="psec__hint">
									The deposit is due now either way — the plan decides how the rest follows.
								</p>
								<div className="pcards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(15rem, 1fr))" }}>
									{PAYMENT_PLANS.map((pl) => {
										const on = plan === pl.id;
										return (
											<button
												key={pl.id}
												type="button"
												className={`pick${on ? " pick--on" : ""}`}
												disabled={isLocked || savingPlan}
												onClick={() => void savePlan(pl.id)}
												aria-pressed={on}
											>
												<span className="pick__name">{PAYMENT_PLAN_LABELS[pl.id] ?? pl.name}</span>
												<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
													{pl.id === "full"
														? "10% now · 90% before you depart"
														: "10% now · 50% before you depart · 40% after you arrive"}
												</span>
											</button>
										);
									})}
								</div>
								{isLocked && (
									<p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.6rem" }}>
										Plan: <strong>{PAYMENT_PLAN_LABELS[application.paymentPlanId] ?? "—"}</strong>. To
										change it, message your consultant.
									</p>
								)}
							</section>

							<section className="psec">
								<p className="eyebrow" style={{ marginBottom: "0.5rem" }}>
									Covered by the service fee
								</p>
								<div className="sharp-card">
									<ul
										style={{
											listStyle: "none",
											padding: 0,
											margin: 0,
											columns: 2,
											columnGap: "2rem",
											fontSize: "var(--text-xs)",
										}}
									>
										{scopeFeatures.map((feat, idx) => (
											<li key={idx} style={{ padding: "0.3rem 0", borderBottom: "1px dashed var(--border-light)" }}>
												✓ {feat}
											</li>
										))}
									</ul>
									{(selectedPkg?.exclusions?.length ?? 0) > 0 && (
										<ul style={{ listStyle: "none", padding: 0, margin: "0.6rem 0 0", fontSize: "var(--text-xs)" }}>
											{selectedPkg!.exclusions.map((excl, idx) => (
												<li key={idx} className="muted" style={{ padding: "0.3rem 0" }}>
													✗ {excl}
												</li>
											))}
										</ul>
									)}
									<ul style={{ listStyle: "none", padding: 0, margin: "0.6rem 0 0", fontSize: "var(--text-xs)" }}>
										<li className="muted" style={{ padding: "0.3rem 0" }}>
											✗ University application fees — billed per school selected
										</li>
										<li className="muted" style={{ padding: "0.3rem 0" }}>
											✗ Tuition — paid to the university that admits you
										</li>
									</ul>
								</div>
							</section>
						</>
					)}
				</div>

				{/* right: the composed package — the money never scrolls away */}
				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow">Your package</p>
						{funding && level ? (
							<>
								<p style={{ fontWeight: 700, fontSize: "1.05rem", margin: "0.3rem 0 0.6rem" }}>
									{fundMeta?.name} × {levelMeta?.short} · {targetSchoolCount}{" "}
									{targetSchoolCount === 1 ? "school" : "schools"}
								</p>
								<div className="pkv">
									<span className="pkv__k">Service fee</span>
									<span className="pkv__v">
										<MoneyInline usd={serviceFee} />
									</span>
								</div>
								<div className="pkv pkv--due">
									<span className="pkv__k">Deposit · due now (10%)</span>
									<span className="pkv__v">
										{isDepositPaid ? "Paid ✓" : <MoneyInline usd={depositUsd} />}
									</span>
								</div>
								<div className="pkv">
									<span className="pkv__k">Pre-departure milestone</span>
									<span className="pkv__v">
										<MoneyInline usd={remainingUsd} />
									</span>
								</div>
								<div className="pkv">
									<span className="pkv__k">— due</span>
									<span className="pkv__v muted">after your visa is approved</span>
								</div>
								<p
									className="muted"
									style={{ fontSize: "0.68rem", lineHeight: 1.5, margin: "0.8rem 0" }}
								>
									By paying the deposit you agree: your admission letter and visa documents are
									released, and your ticket is issued, after the pre-departure milestone. School
									application fees and tuition are the institutions', not ours.
								</p>
								{isDepositPaid ? (
									<Button
										type="button"
										arrow
										onClick={() => nav("/portal/application")}
										style={{ width: "100%" }}
									>
										Next · Applications →
									</Button>
								) : (
									<>
										<Button
											type="button"
											onClick={() => void confirm(true)}
											arrow
											disabled={!funding || !level || saving || payingDeposit}
											style={{ width: "100%" }}
										>
											{payingDeposit ? (
												"Connecting to Paystack…"
											) : (
												<>
													Pay the deposit · <MoneyInline usd={depositUsd} /> →
												</>
											)}
										</Button>
										<Button
											type="button"
											variant="ghost"
											onClick={() => void confirm(false)}
											disabled={!funding || !level || saving || payingDeposit}
											style={{ width: "100%", marginTop: "0.5rem" }}
										>
											{saving ? "Saving…" : "Save & pay later"}
										</Button>
									</>
								)}
							</>
						) : (
							<p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: "0.5rem" }}>
								Pick a funding track and degree level — the fee and deposit compose here.
							</p>
						)}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">What the deposit opens</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.6 }}>
							Your consultant is assigned within 1–2 business days, and school selection opens in{" "}
							<strong style={{ color: "var(--foreground)" }}>Chapter III · Applications</strong>.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ========== Consultation & Assessment ========== */

/**
 * Date and slot picker for the applicant's consultation booking.
 *
 * Replaces a bare `<input type="date">` plus six hard-coded times that checked
 * nothing: an applicant could book a date in the past, a day the branch is
 * closed, or a slot another applicant already had. It now applies the same
 * rules the Operations Center's reschedule panel does, from the same module —
 * when the two drifted, one side offered slots the other considered taken.
 */
function upcomingDates(count = 21): { value: string; weekday: string; dayMonth: string }[] {
	const out: { value: string; weekday: string; dayMonth: string }[] = [];
	const cursor = new Date();
	cursor.setHours(0, 0, 0, 0);
	cursor.setDate(cursor.getDate() + 1);
	for (let i = 0; i < count; i++) {
		const y = cursor.getFullYear();
		const m = String(cursor.getMonth() + 1).padStart(2, "0");
		const d = String(cursor.getDate()).padStart(2, "0");
		out.push({
			value: `${y}-${m}-${d}`,
			weekday: cursor.toLocaleDateString("en-US", { weekday: "short" }),
			dayMonth: cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
		});
		cursor.setDate(cursor.getDate() + 1);
	}
	return out;
}

function SlotPickerLive({
	branchId,
	date,
	onDateChange,
	time,
	onTimeChange,
	durationMinutes = 45,
}: {
	branchId: string;
	date: string;
	onDateChange: (d: string) => void;
	time: string;
	onTimeChange: (t: string) => void;
	durationMinutes?: number;
}) {
	const dates = useMemo(() => upcomingDates(), []);
	const requestKey = `${branchId}|${date}|${durationMinutes}`;
	const [result, setResult] = useState<{ key: string; slots: AvailabilitySlot[] } | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Open-slot counts for the whole window, so a day with nothing open is
	// greyed out before anyone clicks it and waits.
	const daysKey = `${branchId}|${durationMinutes}`;
	const [daysResult, setDaysResult] = useState<{ key: string; open: Record<string, number> } | null>(null);

	useEffect(() => {
		if (!branchId || dates.length === 0) return;
		let active = true;
		bookingsApi
			.availabilityDays({ branchId, from: dates[0].value, days: dates.length, durationMinutes })
			.then((res) => {
				if (active) setDaysResult({ key: daysKey, open: Object.fromEntries(res.days.map((d) => [d.date, d.open])) });
			})
			.catch(() => {
				// The per-day query still works; the calendar just isn't pre-greyed.
				if (active) setDaysResult({ key: daysKey, open: {} });
			});
		return () => {
			active = false;
		};
	}, [branchId, durationMinutes, dates, daysKey]);
	// A stale result (a previous branch) reads as "not loaded", never as wrong greys.
	const openByDate = daysResult?.key === daysKey ? daysResult.open : null;

	useEffect(() => {
		if (!branchId || !date) return;
		let active = true;
		bookingsApi
			.availability({ branchId, date, durationMinutes })
			.then((res) => {
				if (!active) return;
				setResult({ key: requestKey, slots: res.slots });
				setError(null);
			})
			.catch((err: unknown) => {
				if (!active) return;
				setError(err instanceof Error ? err.message : "Could not load branch availability.");
			});
		return () => {
			active = false;
		};
	}, [branchId, date, durationMinutes, requestKey]);

	const slots = result?.key === requestKey ? result.slots : null;

	return (
		<div>
			<div className="resched__days">
				{dates.map((d) => {
					const open = openByDate?.[d.value];
					const closed = open === 0;
					return (
						<button
							key={d.value}
							type="button"
							disabled={closed}
							title={closed ? "No open slots" : open ? `${open} open` : undefined}
							onClick={() => {
								onDateChange(d.value);
								onTimeChange("");
							}}
							className={`resched__day${date === d.value ? " resched__day--on" : ""}`}
						>
							<span className="resched__day-wd">{d.weekday}</span>
							<span className="resched__day-num">{d.dayMonth}</span>
							<span className="resched__day-n">{closed ? "full" : open != null ? `${open} open` : "…"}</span>
						</button>
					);
				})}
			</div>
			{openByDate === null && branchId ? (
				<p className="muted mt-1" style={{ fontSize: "0.8rem" }}>Checking which days are open…</p>
			) : null}

			<p className="resched__label mono mt-3">
				{date
					? `${dates.find((d) => d.value === date)?.weekday ?? ""} ${dates.find((d) => d.value === date)?.dayMonth ?? date}`.trim()
					: "Pick a day first"}{" "}
				<span className="muted">
					· {CONSULTATION_DURATIONS.find((d) => d.id === String(durationMinutes))?.label ?? `${durationMinutes} min`} · branch local
				</span>
			</p>
			{error && <p className="mono" style={{ fontSize: "0.85rem", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: "2px" }}>{error}</p>}
			{!slots && !error && date && <p className="muted" style={{ fontSize: "0.85rem" }}>Checking live availability…</p>}
			{date && slots && (
				<div className="resched__slots">
					{slots.map((s) => (
						<button
							key={s.time}
							type="button"
							disabled={!s.available}
							onClick={() => onTimeChange(s.time)}
							className={`resched__slot${time === s.time ? " resched__slot--on" : ""}`}
							title={!s.available ? "Already booked at this branch" : undefined}
						>
							{s.time}
							{!s.available ? <span className="resched__slot-tag">booked</span> : null}
						</button>
					))}
				</div>
			)}
			{!date && (
				<p className="resched__hint muted">Select a date to see open slots.</p>
			)}
			{slots?.every((s) => !s.available) && (
				<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
					No open slots on this date. Please choose another date above.
				</p>
			)}
		</div>
	);
}

/**
 * 100% Server-backed PortalConsultation
 * Sends bookings to Postgres (century-nit-api) and receives live assessment results from Ops Center.
 */


/* ========== Consultation - fully inside dashboard (mockup) ========== */

const ASSESSMENT_DOC_FIELDS: { id: string; label: string; hint: string }[] = [
	{ id: "passport", label: "Passport bio page", hint: "Clear scan of photo page" },
	{ id: "certificates", label: "Academic certificates", hint: "Degree/diploma certificates" },
	{ id: "transcripts", label: "Academic transcripts", hint: "Official grade transcripts" },
	{ id: "cv", label: "CV / Resume", hint: "Current CV (PDF)" },
	{ id: "english", label: "English test result", hint: "IELTS, TOEFL, or Duolingo score" },
	{ id: "financial", label: "Financial proof", hint: "Bank statements (last 3 months)" },
	{ id: "sponsorship", label: "Sponsorship letter", hint: "If sponsored by a third party" },
	{ id: "additional", label: "Additional documents", hint: "Any other supporting documents" },
];

/** The reference data the assessment form's selects are built from. */
type AssessmentCatalog = {
	lookups: LookupValue[];
	universities: { id: string; name: string; destinationId?: string | null }[];
	destinations: { id: string; name: string }[];
	programs: { id: string; name: string; universityId?: string | null; level?: string | null; field?: string | null; intake?: string[] | null }[];
};

const EMPTY_CATALOG: AssessmentCatalog = { lookups: [], universities: [], destinations: [], programs: [] };

/**
 * Fetched once by the flow, not by the form: the form used to load all four
 * on every mount, and it mounted again on every tab switch.
 */
function useAssessmentCatalog(): AssessmentCatalog {
	const [catalog, setCatalog] = useState<AssessmentCatalog>(EMPTY_CATALOG);
	useEffect(() => {
		let active = true;
		void Promise.all([
			apiFetch<{ lookups: LookupValue[] }>(`${API_PREFIX}/lookups`).then((r) => r?.lookups ?? []).catch(() => []),
			apiFetch<{ universities: AssessmentCatalog["universities"] }>(`${API_PREFIX}/catalog/universities`).then((r) => r?.universities ?? []).catch(() => []),
			apiFetch<{ destinations: AssessmentCatalog["destinations"] }>(`${API_PREFIX}/catalog/destinations`).then((r) => r?.destinations ?? []).catch(() => []),
			apiFetch<{ programs: AssessmentCatalog["programs"] }>(`${API_PREFIX}/catalog/programs`).then((r) => r?.programs ?? []).catch(() => []),
		]).then(([lookups, universities, destinations, programs]) => {
			if (active) setCatalog({ lookups, universities, destinations, programs });
		});
		return () => { active = false; };
	}, []);
	return catalog;
}

/**
 * Up to three study choices, each picked as one thing: country → school →
 * programme (which names the field) → intake. Each select narrows the next
 * from the catalogue; a programme's own intakes replace the generic list
 * when the catalogue knows them.
 */
function StudyChoicesEditor({
	choices,
	catalog,
	onChange,
}: {
	choices: StudyChoice[];
	catalog: AssessmentCatalog;
	onChange: (next: StudyChoice[]) => void;
}) {
	const fields = useMemo(
		() => Array.from(new Set(catalog.programs.map((p) => p.field).filter((x): x is string => Boolean(x)))),
		[catalog.programs],
	);
	const update = (i: number, patch: Partial<StudyChoice>) =>
		onChange(choices.map((c, j) => (j === i ? { ...c, ...patch } : c)));

	return (
		<div className="choices mt-3">
			{choices.map((choice, i) => {
				const destination = catalog.destinations.find((d) => d.name === choice.country);
				const schools = destination
					? catalog.universities.filter((u) => u.destinationId === destination.id)
					: catalog.universities;
				const school = catalog.universities.find((u) => u.name === choice.university);
				const programmes = school ? catalog.programs.filter((p) => p.universityId === school.id) : [];
				const programme = programmes.find((p) => p.name === choice.program);
				const intakes = programme?.intake?.length ? programme.intake : GENERIC_INTAKES.map((o) => o.value);
				return (
					<fieldset key={i} className="choice">
						<legend className="choice__legend">
							Choice {i + 1}
							{choices.length > 1 ? (
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(choices.filter((_, j) => j !== i))}>
									Remove
								</button>
							) : null}
						</legend>
						<div className="form-grid form-grid--2">
							<div className="field">
								<label htmlFor={`ch-${i}-country`}>Country</label>
								<select
									id={`ch-${i}-country`}
									className="select select--full-border"
									value={choice.country}
									onChange={(e) => update(i, { country: e.target.value, university: "", program: "", field: "", intake: "" })}
								>
									<option value="">Select</option>
									{catalog.destinations.map((d) => (<option key={d.id} value={d.name}>{d.name}</option>))}
								</select>
							</div>
							<div className="field">
								<label htmlFor={`ch-${i}-school`}>School</label>
								<select
									id={`ch-${i}-school`}
									className="select select--full-border"
									value={choice.university}
									onChange={(e) => update(i, { university: e.target.value, program: "", field: "", intake: "" })}
								>
									<option value="">{choice.country ? "Select" : "Choose a country first"}</option>
									{schools.map((u) => (<option key={u.id} value={u.name}>{u.name}</option>))}
								</select>
							</div>
							<div className="field">
								<label htmlFor={`ch-${i}-programme`}>Programme</label>
								<select
									id={`ch-${i}-programme`}
									className="select select--full-border"
									value={choice.program}
									onChange={(e) => {
										const p = programmes.find((x) => x.name === e.target.value);
										update(i, { program: e.target.value, field: p?.field ?? choice.field, intake: "" });
									}}
									disabled={!school}
								>
									<option value="">{school ? (programmes.length ? "Select" : "No programmes listed — pick a field") : "Choose a school first"}</option>
									{programmes.map((p) => (<option key={p.id} value={p.name}>{p.name}{p.level ? ` · ${p.level}` : ""}</option>))}
								</select>
							</div>
							<div className="field">
								<label htmlFor={`ch-${i}-field`}>Field</label>
								<select
									id={`ch-${i}-field`}
									className="select select--full-border"
									value={choice.field}
									onChange={(e) => update(i, { field: e.target.value })}
								>
									<option value="">Select</option>
									{fields.map((f) => (<option key={f} value={f}>{f}</option>))}
								</select>
							</div>
							<div className="field">
								<label htmlFor={`ch-${i}-intake`}>Intake</label>
								<select
									id={`ch-${i}-intake`}
									className="select select--full-border"
									value={choice.intake}
									onChange={(e) => update(i, { intake: e.target.value })}
								>
									<option value="">Select</option>
									{intakes.map((v) => (<option key={v} value={v}>{GENERIC_INTAKES.find((o) => o.value === v)?.label ?? v}</option>))}
								</select>
							</div>
						</div>
					</fieldset>
				);
			})}
			{choices.length < MAX_STUDY_CHOICES ? (
				<button type="button" className="btn btn--secondary btn--sm mt-2" onClick={() => onChange([...choices, emptyStudyChoice()])}>
					+ Add another choice
				</button>
			) : null}
		</div>
	);
}

const GENERIC_INTAKES = [
	{ value: "spring", label: "Spring (Jan/Feb)" },
	{ value: "fall", label: "Fall (Sep/Oct)" },
	{ value: "summer", label: "Summer (May/Jun)" },
	{ value: "flexible", label: "Flexible" },
];

const ASSESSMENT_SECTIONS = [
	{ id: "personal", label: "Personal", required: 4, fields: ["firstName", "middleName", "lastName", "email", "phone", "dateOfBirth", "gender", "nationality", "address"] },
	{ id: "passport", label: "Passport", required: 0, fields: ["passportNumber", "passportCountry", "passportIssue", "passportExpiry"] },
	{ id: "education", label: "Education", required: 0, fields: ["highestEducation", "institution", "fieldOfStudy", "graduationYear", "gpa"] },
	{ id: "employment", label: "Employment", required: 0, fields: ["employmentStatus", "employer", "jobTitle", "yearsExperience"] },
	{ id: "english", label: "English", required: 0, fields: ["englishTest", "englishScore", "englishDate"] },
	{ id: "preferences", label: "Preferences", required: 0, fields: ["preferredLevel", "studyChoices"] },
	{ id: "financial", label: "Financial", required: 0, fields: ["fundingSource", "budgetRange", "sponsorName", "sponsorRelationship"] },
	{ id: "documents", label: "Documents", required: 0, fields: [] as string[] },
] as const;

function AssessmentForm({
	assessment,
	assessmentDocs,
	catalog,
	onUpdate,
	onDocUpdate,
}: {
	assessment: AssessmentData;
	assessmentDocs: Record<string, AssessmentDoc>;
	catalog: AssessmentCatalog;
	onUpdate: (patch: Partial<AssessmentData>) => void;
	onDocUpdate: (id: string, fileName: string | null, documentId?: string | null) => void;
}) {
	const { toast } = useNotifier();
	const { lookups, programs: catalogPrograms } = catalog;
	// Distinct fields of study, in catalogue order; a programme without one contributes nothing.
	const programFields = useMemo(
		() => Array.from(new Set(catalogPrograms.map((p) => p.field).filter((x): x is string => Boolean(x)))),
		[catalogPrograms],
	);

	const getLookupOptions = (category: string) => {
		return lookups.filter(l => l.category === category).map(l => (
			<option key={l.id} value={l.value}>{l.label}</option>
		));
	};
	const [uploading, setUploading] = useState<Record<string, number>>({});
	const [pickDocId, setPickDocId] = useState<string | null>(null);

	// Filled/total per section — drives the counts in the TOC and each head.
	function sectionProgress(id: string, fields: readonly string[]): { done: number; total: number } {
		if (id === "documents") {
			const total = ASSESSMENT_DOC_FIELDS.length;
			const done = ASSESSMENT_DOC_FIELDS.filter((d) => assessmentDocs[d.id]?.fileName).length;
			return { done, total };
		}
		const done = fields.filter((k) => {
			const v = assessment[k as keyof AssessmentData];
			if (typeof v === "string") return v.trim() !== "";
			if (Array.isArray(v)) return v.some((c) => c.country || c.university || c.program || c.field);
			return Boolean(v);
		}).length;
		return { done, total: fields.length };
	}
	const progress = Object.fromEntries(
		ASSESSMENT_SECTIONS.map((s) => [s.id, sectionProgress(s.id, s.fields)]),
	) as Record<string, { done: number; total: number }>;
	const sectionMeta = (id: string, required: number) =>
		`${progress[id]?.done ?? 0}/${progress[id]?.total ?? 0}${required > 0 ? ` · ${required} required` : " filled"}`;

	function handleDocUpload(id: string) {
		setPickDocId(id);
	}

	function closePickModal() {
		setPickDocId(null);
	}

	async function handleFileChosen(file: File) {
		const id = pickDocId;
		if (!id) return;
		setPickDocId(null);

		if (file.size > MAX_DOCUMENT_BYTES) {
			toast.error(`${file.name} is larger than 15 MB. Please upload a smaller scan.`);
			return;
		}
		if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
			toast.error("Upload a PDF, image (JPEG, PNG), or Word document (DOC, DOCX).");
			return;
		}

		setUploading((prev) => ({ ...prev, [id]: 0 }));
		try {
			const ready = await prepareDocumentForUpload(file, (pct) => {
				setUploading((prev) => ({ ...prev, [id]: pct }));
			});
			if (ready.size > MAX_DOCUMENT_BYTES) {
				toast.error(`${file.name} is still larger than 15 MB after compression. Please upload a smaller scan.`);
				return;
			}
			const doc = await documentsApi.upload(ready, id, {
				onProgress: (pct) => setUploading((prev) => ({ ...prev, [id]: pct })),
			});
			onDocUpdate(id, doc.fileName, doc.id);
			toast.success(`${file.name} uploaded.`);
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : `Could not upload ${file.name}. Please try again.`;
			toast.error(msg);
		} finally {
			setUploading((prev) => { const n = { ...prev }; delete n[id]; return n; });
		}
	}

	return (
		<>
			<p className="eyebrow">Assessment form</p>
			<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
				Complete all sections. Your consultant will review this before your meeting.
			</p>

			{/* One page, top to bottom — the flow's tabs are the only tabs. The nav
			    is a table of contents, not a second stepper. */}
			<div className="assess-layout mt-3">
				<nav className="assess-nav" aria-label="Assessment sections">
					<ul>
						{ASSESSMENT_SECTIONS.map((s) => {
							const { done, total } = sectionProgress(s.id, s.fields);
							return (
								<li key={s.id}>
									<a href={`#assess-${s.id}`}>
										<span>{s.label}</span>
										<span className="assess-nav__n">{done}/{total}</span>
									</a>
								</li>
							);
						})}
					</ul>
				</nav>
				<div className="assess-body">
				<section id="assess-personal" className="assess-section">
					<h3 className="assess-section__title"><span>01 · Personal</span><span className="assess-section__meta">{sectionMeta("personal", 4)}</span></h3>
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-fn">First name *</label>
							<input id="a-fn" className="input input--full-border" value={assessment.firstName} onChange={(e) => onUpdate({ firstName: e.target.value })} placeholder="Kwame" />
						</div>
						<div className="field">
							<label htmlFor="a-mn">Middle name</label>
							<input id="a-mn" className="input input--full-border" value={assessment.middleName} onChange={(e) => onUpdate({ middleName: e.target.value })} />
						</div>
						<div className="field">
							<label htmlFor="a-ln">Last name *</label>
							<input id="a-ln" className="input input--full-border" value={assessment.lastName} onChange={(e) => onUpdate({ lastName: e.target.value })} placeholder="Mensah" />
						</div>
						<div className="field">
							<label htmlFor="a-em">Email *</label>
							<input id="a-em" type="email" className="input input--full-border" value={assessment.email} onChange={(e) => onUpdate({ email: e.target.value })} placeholder="you@example.com" />
						</div>
						<div className="field">
							<label htmlFor="a-ph">Phone *</label>
							<input id="a-ph" className="input input--full-border" value={assessment.phone} onChange={(e) => onUpdate({ phone: e.target.value })} placeholder="+233 24 000 0000" />
						</div>
						<div className="field">
							<label htmlFor="a-dob">Date of birth</label>
							<input id="a-dob" type="date" className="input input--full-border" value={assessment.dateOfBirth} onChange={(e) => onUpdate({ dateOfBirth: e.target.value })} />
						</div>
						<div className="field">
							<label htmlFor="a-gender">Gender</label>
							<select id="a-gender" className="select select--full-border" value={assessment.gender} onChange={(e) => onUpdate({ gender: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('gender')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-nat">Nationality</label>
							<input id="a-nat" className="input input--full-border" value={assessment.nationality} onChange={(e) => onUpdate({ nationality: e.target.value })} placeholder="Ghanaian" />
						</div>
						<div className="field">
							<label htmlFor="a-addr">Residential address</label>
							<input id="a-addr" className="input input--full-border" value={assessment.address} onChange={(e) => onUpdate({ address: e.target.value })} placeholder="Street, city, country" />
						</div>
					</div>
				</section>

				<section id="assess-passport" className="assess-section">
					<h3 className="assess-section__title"><span>02 · Passport</span><span className="assess-section__meta">{sectionMeta("passport", 0)}</span></h3>
					<div className="form-grid form-grid--2">
						<div className="field">
							<label htmlFor="a-pn">Passport number</label>
							<input id="a-pn" className="input input--full-border" value={assessment.passportNumber} onChange={(e) => onUpdate({ passportNumber: e.target.value })} placeholder="G1234567" />
						</div>
						<div className="field">
							<label htmlFor="a-pc">Passport country</label>
							<input id="a-pc" className="input input--full-border" value={assessment.passportCountry} onChange={(e) => onUpdate({ passportCountry: e.target.value })} placeholder="Ghana" />
						</div>
						<div className="field">
							<label htmlFor="a-pi">Issue date</label>
							<input id="a-pi" type="date" className="input input--full-border" value={assessment.passportIssue} onChange={(e) => onUpdate({ passportIssue: e.target.value })} />
						</div>
						<div className="field">
							<label htmlFor="a-pe">Expiry date</label>
							<input id="a-pe" type="date" className="input input--full-border" value={assessment.passportExpiry} onChange={(e) => onUpdate({ passportExpiry: e.target.value })} />
						</div>
					</div>
				</section>

				<section id="assess-education" className="assess-section">
					<h3 className="assess-section__title"><span>03 · Education</span><span className="assess-section__meta">{sectionMeta("education", 0)}</span></h3>
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-edu">Highest education</label>
							<select id="a-edu" className="select select--full-border" value={assessment.highestEducation} onChange={(e) => onUpdate({ highestEducation: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('highestEducation')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-inst">Institution attended</label>
							<input id="a-inst" className="input input--full-border" value={assessment.institution} onChange={(e) => onUpdate({ institution: e.target.value })} placeholder="University of Ghana" />
						</div>
						<div className="field">
							<label htmlFor="a-fos">Field of study</label>
							<select id="a-fos" className="select select--full-border" value={assessment.fieldOfStudy} onChange={(e) => onUpdate({ fieldOfStudy: e.target.value })}>
		<option value="">Select</option>
		{programFields.map((f) => (<option key={f} value={f}>{f}</option>))}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-gy">Graduation year</label>
							<input id="a-gy" className="input input--full-border" value={assessment.graduationYear} onChange={(e) => onUpdate({ graduationYear: e.target.value })} placeholder="2024" />
						</div>
						<div className="field">
							<label htmlFor="a-gpa">GPA / Grade</label>
							<input id="a-gpa" className="input input--full-border" value={assessment.gpa} onChange={(e) => onUpdate({ gpa: e.target.value })} placeholder="3.6 / 4.0" />
						</div>
					</div>
				</section>

				<section id="assess-employment" className="assess-section">
					<h3 className="assess-section__title"><span>04 · Employment</span><span className="assess-section__meta">{sectionMeta("employment", 0)}</span></h3>
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-es">Employment status</label>
							<select id="a-es" className="select select--full-border" value={assessment.employmentStatus} onChange={(e) => onUpdate({ employmentStatus: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('employmentStatus')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-emp">Employer</label>
							<input id="a-emp" className="input input--full-border" value={assessment.employer} onChange={(e) => onUpdate({ employer: e.target.value })} placeholder="Company name" />
						</div>
						<div className="field">
							<label htmlFor="a-jt">Job title</label>
							<input id="a-jt" className="input input--full-border" value={assessment.jobTitle} onChange={(e) => onUpdate({ jobTitle: e.target.value })} placeholder="Software Engineer" />
						</div>
						<div className="field">
							<label htmlFor="a-yexp">Years of experience</label>
							<input id="a-yexp" className="input input--full-border" value={assessment.yearsExperience} onChange={(e) => onUpdate({ yearsExperience: e.target.value })} placeholder="3" />
						</div>
					</div>
				</section>

				<section id="assess-english" className="assess-section">
					<h3 className="assess-section__title"><span>05 · English</span><span className="assess-section__meta">{sectionMeta("english", 0)}</span></h3>
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-et">English test taken</label>
							<select id="a-et" className="select select--full-border" value={assessment.englishTest} onChange={(e) => onUpdate({ englishTest: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('englishTest')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-es-score">Score</label>
							<input id="a-es-score" className="input input--full-border" value={assessment.englishScore} onChange={(e) => onUpdate({ englishScore: e.target.value })} placeholder="7.5" />
						</div>
						<div className="field">
							<label htmlFor="a-ed">Test date</label>
							<input id="a-ed" type="date" className="input input--full-border" value={assessment.englishDate} onChange={(e) => onUpdate({ englishDate: e.target.value })} />
						</div>
					</div>
				</section>

				<section id="assess-preferences" className="assess-section">
					<h3 className="assess-section__title"><span>06 · Preferences</span><span className="assess-section__meta">{sectionMeta("preferences", 0)}</span></h3>
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-pl">Level of study</label>
							<select id="a-pl" className="select select--full-border" value={assessment.preferredLevel} onChange={(e) => onUpdate({ preferredLevel: e.target.value })}>
								<option value="">Select</option>
								{getLookupOptions('preferredLevel')}
							</select>
						</div>
					</div>
					<p className="muted mt-3" style={{ fontSize: "0.85rem" }}>
						Where would you like to study? Pick the country, school, programme and intake together — add a second and third choice if you have them.
					</p>
					<StudyChoicesEditor
						choices={assessment.studyChoices}
						catalog={catalog}
						onChange={(studyChoices) => onUpdate({ studyChoices, ...flattenStudyChoices(studyChoices) })}
					/>
				</section>

				<section id="assess-financial" className="assess-section">
					<h3 className="assess-section__title"><span>07 · Financial</span><span className="assess-section__meta">{sectionMeta("financial", 0)}</span></h3>
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-fs">Funding source</label>
							<select id="a-fs" className="select select--full-border" value={assessment.fundingSource} onChange={(e) => onUpdate({ fundingSource: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('fundingSource')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-br">Budget range (GHS / USD per year)</label>
							<select id="a-br" className="select select--full-border" value={assessment.budgetRange} onChange={(e) => onUpdate({ budgetRange: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('budgetRange')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-sn">Sponsor name</label>
							<input id="a-sn" className="input input--full-border" value={assessment.sponsorName} onChange={(e) => onUpdate({ sponsorName: e.target.value })} placeholder="If applicable" />
						</div>
						<div className="field">
							<label htmlFor="a-sr">Sponsor relationship</label>
							<input id="a-sr" className="input input--full-border" value={assessment.sponsorRelationship} onChange={(e) => onUpdate({ sponsorRelationship: e.target.value })} placeholder="Parent, Guardian, etc." />
						</div>
					</div>
				</section>

			<section id="assess-documents" className="assess-section">
				<h3 className="assess-section__title"><span>08 · Documents</span><span className="assess-section__meta">{sectionMeta("documents", 0)}</span></h3>
				<div>
					<p className="muted mb-3" style={{ fontSize: "0.85rem" }}>
						Upload scanned copies of your documents. Accepted: PDF, JPEG, PNG, DOC, DOCX (max 15 MB each).
					</p>
					<div className="form-grid form-grid--2">
						{ASSESSMENT_DOC_FIELDS.map((doc) => {
							const uploaded = assessmentDocs[doc.id];
							const pct = uploading[doc.id];
							const isUploading = pct !== undefined;
							return (
								<div key={doc.id} className="sharp-card">
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
										<div>
											<p style={{ fontWeight: 600, fontSize: "0.9rem" }}>{doc.label}</p>
											<p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>{doc.hint}</p>
										</div>
										{isUploading ? (
											<span className="portal-pill portal-pill--hollow">Uploading {pct}%</span>
										) : uploaded?.fileName ? (
											<span className="portal-pill portal-pill--solid">Uploaded</span>
										) : (
											<span className="portal-pill portal-pill--hollow">Pending</span>
										)}
									</div>
									{isUploading ? (
										<div style={{ marginTop: "0.75rem" }}>
											<div style={{ height: "4px", background: "var(--border-light)", borderRadius: "2px", overflow: "hidden" }}>
												<div style={{ height: "100%", width: `${pct}%`, background: "var(--foreground)", transition: "width 0.2s" }} />
											</div>
										</div>
									) : uploaded?.fileName ? (
										<div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
											<span className="mono" style={{ fontSize: "0.75rem" }}>{uploaded.fileName}</span>
											{uploaded.uploadedAt ? (
												<span className="muted" style={{ fontSize: "0.7rem" }}>{new Date(uploaded.uploadedAt).toLocaleDateString()}</span>
											) : null}
											<div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
												<button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDocUpload(doc.id)}>Replace</button>
												<button type="button" className="btn btn--ghost btn--sm" onClick={() => onDocUpdate(doc.id, null)}>Remove</button>
											</div>
										</div>
									) : (
										<div style={{ marginTop: "0.75rem" }}>
											<button type="button" className="btn btn--secondary btn--sm" onClick={() => handleDocUpload(doc.id)}>Upload file</button>
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			</section>
				</div>
			</div>

			<UploadPickModal
				open={pickDocId !== null}
				title={pickDocId ? (assessmentDocs[pickDocId]?.fileName ? "Replace document" : "Upload document") : ""}
				subtitle={pickDocId ? ASSESSMENT_DOC_FIELDS.find((d) => d.id === pickDocId)?.label : undefined}
				extraNotes="Large images are compressed automatically before upload."
				onFileChosen={(file) => void handleFileChosen(file)}
				onClose={closePickModal}
			/>
		</>
	);
}

/**
 * The flow's steps, by id. Online consultations skip Branch and book at HQ,
 * so the list depends on the type; Review and Outcome are the post-booking
 * chapters and stay in the bar so the story reads in one line.
 */
type ConsultStepId = "type" | "branch" | "assessment" | "schedule" | "pay" | "review" | "outcome";
const CONSULT_STEP_LABELS: Record<ConsultStepId, string> = {
	type: "Type",
	branch: "Branch",
	assessment: "Assessment",
	schedule: "Schedule",
	pay: "Pay",
	review: "Review",
	outcome: "Outcome",
};
/** Where an online consultation is hosted — the branch whose slots and consultants it uses. */
const ONLINE_BRANCH_ID = "accra-hq";

/** Consultations run at the two Ghana offices — partner desks don't take bookings. */
const BOOKABLE_BRANCHES = branches.filter((b) => b.id === "accra-hq" || b.id === "kumasi");
function consultSteps(type: string | null | undefined): ConsultStepId[] {
	return type === "online"
		? ["type", "assessment", "schedule", "pay", "review", "outcome"]
		: ["type", "branch", "assessment", "schedule", "pay", "review", "outcome"];
}

function ConsultationOutcome({
	booking,
	onMockOutcome,
	onRevealOutcome,
	autopilot,
}: {
	booking: BookingData;
	onMockOutcome: (outcome: EligibilityOutcome, note?: string) => void;
	onRevealOutcome: () => void;
	autopilot: boolean;
}) {
	const { application, syncFromServer } = useAppState();
	const outcome = booking.eligibilityOutcome;
	const isPending =
		outcome === "pending" ||
		(booking.consultationPhase !== "outcome" &&
			booking.consultationPhase !== "assessment_complete" &&
			booking.consultationPhase !== "cancelled");

	if (!booking.confirmationId) {
		return (
			<>
				<p className="eyebrow">Outcome</p>
				<p className="muted mt-2">Complete payment in the Pay tab to receive your consultation outcome.</p>
			</>
		);
	}

	if (booking.consultationPhase === "assessment_complete") {
		return (
			<>
				<p className="eyebrow">Outcome</p>
				<div className="sharp-card mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
					<p className="display" style={{ fontSize: "1.3rem" }}>Assessment complete</p>
					<p className="muted mt-2" style={{ maxWidth: "28rem", margin: "0.5rem auto 0" }}>
						Your consultant has finished reviewing your file. Your eligibility outcome is ready to view.
					</p>
					<div className="row mt-4" style={{ justifyContent: "center" }}>
						<Button type="button" onClick={onRevealOutcome} arrow>
							View your outcome →
						</Button>
					</div>
					<p className="mono muted mt-4" style={{ fontSize: "0.75rem" }}>
						Booking ref: {booking.confirmationId}
					</p>
				</div>
			</>
		);
	}

	if (booking.consultationPhase === "cancelled") {
		return (
			<>
				<p className="eyebrow">Outcome</p>
				<div className="sharp-card mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
					<p className="display" style={{ fontSize: "1.3rem" }}>Consultation cancelled</p>
					<p className="muted mt-2" style={{ maxWidth: "28rem", margin: "0.5rem auto 0" }}>
						Your consultation has been cancelled. If you'd like to continue, you can book a new appointment from the Appointments tab.
					</p>
					<div className="row mt-4" style={{ justifyContent: "center" }}>
						<Button to="/portal/appointments" arrow>
							Book a new appointment →
						</Button>
					</div>
					<p className="mono muted mt-4" style={{ fontSize: "0.75rem" }}>
						Case ref: {booking.confirmationId}
					</p>
				</div>
			</>
		);
	}

	if (isPending) {
		const phaseLabels: Record<string, string> = {
			awaiting_confirmation: "Awaiting booking confirmation",
			confirmed: "Booking confirmed - awaiting consultant assignment",
			awaiting_assignment: "Awaiting consultant assignment",
			assigned: booking.consultantName ? `Assigned to ${booking.consultantName}` : "Consultant assigned",
			awaiting_assignment_confirmation: "Awaiting assignment confirmation",
			assessment: "Assessment in progress",
			booked: "Booking confirmed",
			draft: "Awaiting payment",
		};
		const phaseLabel = phaseLabels[booking.consultationPhase] ?? "In progress";
		return (
			<>
				<p className="eyebrow">Outcome</p>
				<div className="sharp-card mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
					<div style={{ marginBottom: "1.5rem" }}>
						<span
							style={{
								display: "inline-flex",
								width: "48px",
								height: "48px",
								border: "2px solid var(--border)",
								borderTopColor: "var(--foreground)",
								borderRadius: "50%",
								animation: "spin 1s linear infinite",
							}}
						/>
					</div>
					<p className="display" style={{ fontSize: "1.2rem" }}>{phaseLabel}</p>
					<p className="muted mt-2" style={{ maxWidth: "28rem", margin: "0.5rem auto 0" }}>
						Your consultant is reviewing your assessment details and uploaded documents. This typically takes a few minutes in the prototype. You'll see the outcome here once it's ready.
					</p>
					<p className="mono muted mt-4" style={{ fontSize: "0.75rem" }}>
						Booking ref: {booking.confirmationId}
					</p>
				</div>
				<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
			</>
		);
	}

	return (
		<>
			<AssessmentOutcomeCard
				outcome={outcome === "conditional" ? "Conditionally Eligible" : outcome === "eligible" ? "Eligible" : outcome}
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

			{import.meta.env.DEV && autopilot ? (
				<details style={{ marginTop: "1rem" }}>
					<summary className="mono muted" style={{ fontSize: "0.75rem", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						Simulate other outcomes
					</summary>
					<div className="row mt-2" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
						<Button type="button" variant="secondary" size="sm" onClick={() => onMockOutcome("eligible")}>
							Eligible
						</Button>
						<Button type="button" variant="secondary" size="sm" onClick={() => onMockOutcome("conditional")}>
							Conditional
						</Button>
						<Button type="button" variant="ghost" size="sm" onClick={() => onMockOutcome("needs_info")}>
							Needs Info
						</Button>
						<Button type="button" variant="ghost" size="sm" onClick={() => onMockOutcome("not_eligible")}>
							Not Eligible
						</Button>
					</div>
				</details>
			) : null}
		</>
	);
}

/* ========== Consultation review - awaiting approval & assessment ========== */

function ConsultationReview({
	booking,
	onProceed,
	onRevealOutcome,
}: {
	booking: BookingData;
	onProceed: () => void;
	onRevealOutcome: () => void;
}) {
	const phase = booking.consultationPhase;

	if (!booking.confirmationId) {
		return (
			<>
				<p className="eyebrow">Review</p>
				<p className="muted mt-2">Complete payment in the Pay tab first. Your consultant review begins after confirmation.</p>
			</>
		);
	}

	const isPast = (p: string) => {
		const order = ["draft", "awaiting_confirmation", "confirmed", "awaiting_assignment", "assigned", "awaiting_assignment_confirmation", "assessment", "assessment_complete", "outcome"];
		return order.indexOf(phase) > order.indexOf(p);
	};
	const isActive = (p: string) => phase === p;
	const isDone = (p: string) => isPast(p) || phase === "outcome";

	const steps = [
		{
			id: "paid",
			label: "Payment received",
			detail: `Reference ${booking.confirmationId} · ${formatDualCurrency(75)}`,
			done: true,
		},
		{
			id: "awaiting_confirmation",
			label: "Awaiting booking confirmation",
			detail: "The branch reviews your payment and confirms your consultation slot.",
			active: isActive("awaiting_confirmation"),
			done: isDone("awaiting_confirmation"),
		},
		{
			id: "confirmed",
			label: "Booking confirmed",
			detail: "Your consultation slot has been confirmed. Waiting for a consultant to be assigned.",
			active: isActive("confirmed"),
			done: isDone("confirmed"),
		},
		{
			id: "awaiting_assignment",
			label: "Awaiting consultant assignment",
			detail: "The branch is assigning a consultant to your case.",
			active: isActive("awaiting_assignment"),
			done: isDone("awaiting_assignment"),
		},
		{
			id: "assigned",
			label: "Consultant assigned",
			detail: booking.consultantName
				? `Your case has been assigned to ${booking.consultantName}. Waiting for the consultant to confirm the assignment.`
				: "A consultant has been assigned to your case. Waiting for confirmation.",
			active: isActive("assigned"),
			done: isDone("assigned"),
		},
		{
			id: "awaiting_assignment_confirmation",
			label: "Awaiting assignment confirmation",
			detail: booking.consultantName
				? `${booking.consultantName} is reviewing and accepting the assignment before assessment begins.`
				: "The consultant is confirming the assignment before assessment begins.",
			active: isActive("awaiting_assignment_confirmation"),
			done: isDone("awaiting_assignment_confirmation"),
		},
		{
			id: "assessment",
			label: "Assessment in progress",
			detail: booking.consultantName
				? `${booking.consultantName} is reviewing your academic background, documents, and study goals.`
				: "Your consultant evaluates your academic background, documents, and study goals.",
			active: isActive("assessment"),
			done: isDone("assessment"),
		},
		{
			id: "assessment_complete",
			label: "Assessment complete",
			detail: "Your consultant has finished the assessment. Click to view your eligibility outcome.",
			active: isActive("assessment_complete"),
			done: phase === "outcome",
		},
		{
			id: "outcome",
			label: "Eligibility outcome",
			detail: "The consultant determines your eligibility and recommends next steps.",
			active: isActive("outcome"),
			done: phase === "outcome",
		},
	];

	const phaseLabels: Record<string, string> = {
		awaiting_confirmation: "Awaiting booking confirmation",
		confirmed: "Booking confirmed",
		awaiting_assignment: "Awaiting consultant assignment",
		assigned: booking.consultantName ? `Assigned to ${booking.consultantName}` : "Consultant assigned",
		awaiting_assignment_confirmation: "Awaiting assignment confirmation",
		assessment: "Assessment in progress",
		assessment_complete: "Assessment complete",
		outcome: "Review complete",
		draft: "Awaiting payment",
		booked: "Booking confirmed",
	};

	return (
		<>
			<p className="eyebrow">Consultant review</p>
			<p className="display mt-2" style={{ fontSize: "1.3rem" }}>
				{phaseLabels[phase] ?? "In progress"}
			</p>
			<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
				{booking.eligibilityNote ??
					"Your file has been submitted. The consultant at your branch will review and assess before producing an outcome."}
			</p>

			{/* Assessment complete - prominent call to action */}
			{phase === "assessment_complete" ? (
				<div className="sharp-card mt-3" style={{ textAlign: "center", padding: "2rem 1.5rem", border: "2px solid var(--foreground)" }}>
					<p className="display" style={{ fontSize: "1.3rem" }}>Assessment complete</p>
					<p className="muted mt-2" style={{ maxWidth: "28rem", margin: "0.5rem auto 0" }}>
						Your consultant has finished reviewing your file. Your eligibility outcome is ready.
					</p>
					<div className="row mt-3" style={{ justifyContent: "center" }}>
						<Button type="button" onClick={onRevealOutcome} arrow>
							View your outcome →
						</Button>
					</div>
				</div>
			) : null}

			{/* Appointment - consultant, when, and a mode-aware where + actions */}
			<ConsultationAppointmentCard />

			{/* The consultant now leads the appointment card above, so no separate tile */}

			<div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
				{steps.map((s, i) => (
					<div
						key={s.id}
						style={{
							display: "flex",
							gap: "1rem",
							paddingBottom: i < steps.length - 1 ? "1.5rem" : 0,
							position: "relative",
						}}
					>
						<div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
							<span
								style={{
									width: "32px",
									height: "32px",
									borderRadius: "50%",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "0.75rem",
									fontWeight: 600,
									border: s.done
										? "2px solid var(--foreground)"
										: s.active
											? "2px solid var(--foreground)"
											: "2px solid var(--border)",
									background: s.done ? "var(--foreground)" : "transparent",
									color: s.done ? "var(--background)" : s.active ? "var(--foreground)" : "var(--muted-foreground)",
								}}
							>
								{s.done ? "✓" : s.active ? (
									<span
										style={{
											display: "inline-block",
											width: "14px",
											height: "14px",
											border: "2px solid var(--foreground)",
											borderTopColor: "transparent",
											borderRadius: "50%",
											animation: "spin 1s linear infinite",
										}}
									/>
								) : i + 1}
							</span>
							{i < steps.length - 1 ? (
								<span
									style={{
										width: "2px",
										flex: 1,
										minHeight: "2rem",
										marginTop: "0.25rem",
										background: s.done ? "var(--foreground)" : "var(--border)",
									}}
								/>
							) : null}
						</div>
						<div style={{ paddingBottom: "0.5rem" }}>
							<p
								style={{
									fontSize: "0.95rem",
									fontWeight: s.active || s.done ? 600 : 400,
									color: s.done || s.active ? "var(--foreground)" : "var(--muted-foreground)",
								}}
							>
								{s.label}
							</p>
							<p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
								{s.detail}
							</p>
							{s.active ? (
								<p className="mono" style={{ fontSize: "0.7rem", marginTop: "0.4rem", color: "var(--muted-foreground)" }}>
									In progress…
								</p>
							) : null}
						</div>
					</div>
				))}
			</div>

			<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

			{phase === "outcome" ? (
				<div className="row mt-4">
					<Button type="button" onClick={onProceed} arrow>
						View outcome →
					</Button>
				</div>
			) : phase === "cancelled" ? (
				<div className="sharp-card mt-4" style={{ textAlign: "center" }}>
					<p className="mono muted" style={{ fontSize: "0.75rem" }}>
						Booking ref: {booking.confirmationId}
					</p>
					<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
						This consultation was cancelled. Book a new appointment from the Appointments tab to continue.
					</p>
					<div className="row mt-3" style={{ justifyContent: "center" }}>
						<Button to="/portal/appointments" variant="secondary" arrow>
							Book a new appointment →
						</Button>
					</div>
				</div>
			) : phase !== "assessment_complete" ? (
				<div className="sharp-card mt-4" style={{ textAlign: "center" }}>
					<p className="mono muted" style={{ fontSize: "0.75rem" }}>
						Booking ref: {booking.confirmationId}
					</p>
					<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
						This typically takes a few minutes in the prototype. The outcome will appear automatically - you can stay on this page or check the Outcome tab.
					</p>
				</div>
			) : null}
		</>
	);
}

export function PortalConsultationBookingFlow() {
	const {
		booking,
		updateBooking,
		updateAssessment,
		updateAssessmentDoc,

		setEligibilityOutcome,
		revealOutcome,
		journeyPhase,
	} = useAppState();
	const { toast } = useNotifier();
	const [selectedStep, setSelectedStep] = useState<ConsultStepId>("type");
	const steps = consultSteps(booking.consultationType);
	const catalog = useAssessmentCatalog();

	// Live consultation fee (USD) from platform_settings — what ops configured,
	// not the hardcoded default. Falls back to FALLBACK_FEE_SCHEDULE on error.
	const { fees } = useAppState();
	const [consultationFeeUsd, setConsultationFeeUsd] = useState<number>(
		usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents)
	);
	useEffect(() => {
		let active = true;
		(async () => {
			try {
				const fees = await feesApi.schedule();
				if (active) setConsultationFeeUsd(fees.consultationCents / 100);
			} catch {
				/* keep default */
			}
		})();
		return () => { active = false; };
	}, []);
	const step: ConsultStepId = useMemo(() => {
		if (booking.consultationPhase === "outcome" || booking.consultationPhase === "assessment_complete" || booking.consultationPhase === "cancelled") {
			return "outcome";
		}
		return steps.includes(selectedStep) ? selectedStep : "type";
	}, [booking.consultationPhase, selectedStep, steps]);
	const stepIndex = steps.indexOf(step);
	const outcomeUnlocked = booking.consultationPhase === "assessment_complete" || booking.consultationPhase === "outcome";
	const [payState, setPayState] = useState<"method" | "card" | "momo" | "processing" | "success" | "paid">(
		booking.confirmationId ? "paid" : "method",
	);

	// Earliest open day per branch — the branch card doubles as a date hint.
	const [nextSlots, setNextSlots] = useState<Record<string, string | null>>({});
	useEffect(() => {
		if (booking.consultationType !== "in_person") return;
		const from = upcomingDates(1)[0]?.value;
		if (!from) return;
		let active = true;
		Promise.all(
			BOOKABLE_BRANCHES.map((b) =>
				bookingsApi
					.availabilityDays({ branchId: b.id, from, days: 14, durationMinutes: 45 })
					.then((res) => [b.id, res.days.find((d) => d.open > 0)?.date ?? null] as const)
					.catch(() => [b.id, null] as const),
			),
		).then((entries) => {
			if (active) {
				setNextSlots(
					Object.fromEntries(
						entries.map(([id, date]) => [
							id,
							date
								? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()
								: null,
						]),
					),
				);
			}
		});
		return () => {
			active = false;
		};
	}, [booking.consultationType]);

	async function startPayment() {
		if (payState === "paid" || payState === "processing" || payState === "success") return;
		// Gate payment on the required booking fields — Paystack will reject
		// an incomplete booking anyway, so fail fast with a clear message.
		const missing: string[] = [];
		if (!booking.branchId) missing.push("a branch");
		if (!booking.date) missing.push("a date");
		if (!booking.time) missing.push("a time");
		if (missing.length > 0) {
			toast.error(`Please select ${missing.join(", ")} before paying.`);
			return;
		}
		setPayState("processing");

		try {
			const res = await bookingsApi.checkout({
				serviceId: "consultation",
				branchId: booking.branchId,
				type: booking.consultationType || "online",
				date: booking.date,
				time: booking.time,
				durationMinutes: 45,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				notes: "Preferred: " + booking.assessment.preferredCountries + ", " + booking.assessment.preferredLevel,
			});

			await meApi.updateProfile({
				name: [booking.assessment.firstName, booking.assessment.middleName, booking.assessment.lastName].filter(Boolean).join(" "),
				phone: booking.assessment.phone,
				targetCountry: booking.assessment.preferredCountries,
				profile: {
					nationality: booking.assessment.nationality,
					dob: booking.assessment.dateOfBirth,
					passportNumber: booking.assessment.passportNumber,
					passportExpiry: booking.assessment.passportExpiry,
					previousRefusals: "",
					degree: booking.assessment.highestEducation,
					institution: booking.assessment.institution,
					gpa: booking.assessment.gpa,
					gradYear: booking.assessment.graduationYear,
					currentRole: booking.assessment.jobTitle,
					company: booking.assessment.employer,
					experienceYears: booking.assessment.yearsExperience,
					fundingSource: booking.assessment.fundingSource,
					budget: booking.assessment.budgetRange,
					degreeLevel: booking.assessment.preferredLevel,
					intake: booking.assessment.intakePreference,
					major: booking.assessment.preferredField,
					studyChoices: booking.assessment.studyChoices.filter((c) => c.country || c.university || c.program || c.field),
					referralSource: "",
				},
			});

			window.location.href = res.authorizationUrl;
		} catch (err) {
			setPayState("method");
			toast.error("Error creating booking: " + String(err));
		}
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · {STAGE_SHORT[journeyPhase.stage] ?? journeyPhase.label}</p>
					<h1 className="page-title mt-1">Consultation</h1>
					<p className="lead mt-2">
						Choose how you'd like to meet, tell us about yourself, pick a time and pay the fee — all here.
					</p>
				</div>
			</header>

			<ol className="psteps" role="tablist">
				{steps.map((id, i) => {
					const isLocked = id === "outcome" && !outcomeUnlocked;
					const done = i < stepIndex && !isLocked;
					return (
						<li key={id}>
							<button
								type="button"
								role="tab"
								aria-selected={step === id}
								aria-disabled={isLocked}
								disabled={isLocked}
								className={`portal-pill${step === id ? " portal-pill--solid" : done ? " portal-pill--done" : " portal-pill--hollow"}`}
								onClick={() => !isLocked && setSelectedStep(id)}
							>
								{i + 1} · {CONSULT_STEP_LABELS[id]}
								{done ? " ✓" : isLocked ? " —" : ""}
							</button>
						</li>
					);
				})}
			</ol>

			<div className="psplit">
			<div className="sharp-card">
				{step === "type" && (
					<>
						<div className="psec" style={{ marginBottom: "0.9rem" }}>
							<div>
								<span className="psec__no">1</span>
								<span className="psec__title">How do you want to meet?</span>
							</div>
							<p className="psec__hint">Same session, same fee — pick what suits you.</p>
						</div>
						<div className="pcards pcards--pair">
							{(
								[
									["online", "Video call", "Online consultation", "Meet from anywhere — the link is sent with your confirmation."],
									["in_person", "At a branch", "In-person consultation", "Accra or Kumasi — you pick the branch next."],
								] as const
							).map(([id, kicker, name, blurb]) => (
								<button
									key={id}
									type="button"
									className={`pick${booking.consultationType === id ? " pick--on" : ""}`}
									onClick={() =>
										updateBooking(
											id === "online"
												? { consultationType: id, branchId: ONLINE_BRANCH_ID }
												: { consultationType: id, branchId: booking.branchId === ONLINE_BRANCH_ID ? "" : booking.branchId },
										)
									}
								>
									<span className="eyebrow">{kicker}</span>
									<span className="pick__name" style={{ fontSize: "1.05rem" }}>{name}</span>
									<span className="muted">{blurb}</span>
									<span className="pick__price">45 min · {formatDualCurrency(consultationFeeUsd)}</span>
								</button>
							))}
						</div>
					</>
				)}
				{step === "branch" && (
					<>
						<div className="psec" style={{ marginBottom: "0.9rem" }}>
							<div>
								<span className="psec__no">2</span>
								<span className="psec__title">Which branch?</span>
							</div>
							<p className="psec__hint">Earliest available slot shown — the full grid comes next.</p>
						</div>
						<div className="pcards pcards--pair">
							{BOOKABLE_BRANCHES.map((b) => (
								<button
									key={b.id}
									type="button"
									className={`pick${booking.branchId === b.id ? " pick--on" : ""}`}
									onClick={() => updateBooking({ branchId: b.id })}
								>
									<span className="pick__name">{b.name}</span>
									<span className="muted">{b.address}</span>
									<span className="pick__price">
										{nextSlots[b.id] === undefined
											? "Checking openings…"
											: nextSlots[b.id]
												? `Next slot · ${nextSlots[b.id]}`
												: "No openings in the next 14 days"}
									</span>
								</button>
							))}
						</div>
					</>
				)}
				{step === "assessment" && (
					<>
						<div className="psec" style={{ marginBottom: "0.9rem" }}>
							<div>
								<span className="psec__no">3</span>
								<span className="psec__title">Tell us about yourself</span>
							</div>
							<p className="psec__hint">Your consultant reads this before the meeting — required fields are marked.</p>
						</div>
						<AssessmentForm
							assessment={booking.assessment}
							assessmentDocs={booking.assessmentDocs}
							catalog={catalog}
							onUpdate={updateAssessment}
							onDocUpdate={updateAssessmentDoc}
						/>
					</>
				)}
				{step === "schedule" && (
					<>
						<div className="psec" style={{ marginBottom: "0.9rem" }}>
							<div>
								<span className="psec__no">4</span>
								<span className="psec__title">Pick your slot{booking.branchId ? ` — ${getBranchName(booking.branchId)}` : ""}</span>
							</div>
							<p className="psec__hint">Struck-through days are full or closed. Slots are 45 minutes, branch time.</p>
						</div>
						<SlotPickerLive
							branchId={booking.branchId}
							date={booking.date}
							onDateChange={(d) => updateBooking({ date: d })}
							time={booking.time}
							onTimeChange={(t) => updateBooking({ time: t })}
							durationMinutes={45}
						/>
					</>
				)}
				{step === "pay" && (
					<>
						<div className="psec" style={{ marginBottom: "0.9rem" }}>
							<div>
								<span className="psec__no">5</span>
								<span className="psec__title">Confirm &amp; pay</span>
							</div>
							<p className="psec__hint">Check the order — then Paystack takes card or mobile money.</p>
						</div>

						{payState === "paid" && booking.confirmationId ? (
							<div className="sharp-card mt-3" style={{ background: "var(--foreground)", color: "var(--accent-foreground)" }}>
								<p className="eyebrow">Booking confirmed</p>
								<p className="mono mt-2">Ref: {booking.confirmationId}</p>
								<p className="mt-2" style={{ opacity: 0.85 }}>
									Your consultation has been booked. A branch coordinator will review and assign your consultant shortly.
								</p>
							</div>
						) : null}

						{payState === "method" ? (
							<>
								<div className="order mt-3">
									<div className="order__row">
										<span>
											{booking.consultationType === "online" ? "Online consultation" : "In-person consultation"} — 45 min
											<small>{[booking.date, booking.time, getBranchName(booking.branchId)].filter(Boolean).join(" · ") || "Details in the rail"}</small>
										</span>
										<span className="order__amt">{formatDualCurrency(consultationFeeUsd)}</span>
									</div>
									<div className="order__row">
										<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
											Includes — eligibility review, route recommendation, document checklist, named consultant
										</span>
										<span className="order__amt muted">—</span>
									</div>
									<div className="order__total">
										<span>Due now</span>
										<span className="order__amt">{formatDualCurrency(consultationFeeUsd)}</span>
									</div>
								</div>
								<p className="muted mt-3" style={{ fontSize: "var(--text-xs)", lineHeight: 1.6, maxWidth: "30rem" }}>
									Free reschedule up to 24h before · refunded in full if we can't place you · receipt lands in your Money ledger.
								</p>
								<div className="row mt-4">
									<Button type="button" onClick={startPayment} arrow>
										Pay with Paystack · {formatDualCurrency(consultationFeeUsd)} →
									</Button>
									<Button type="button" variant="ghost" onClick={() => setSelectedStep("schedule")}>
										← Change slot
									</Button>
								</div>
								<p className="mono muted mt-2" style={{ fontSize: "0.62rem" }}>
									Card · MTN MoMo · Vodafone Cash — processed by Paystack
								</p>
							</>
						) : null}

						{payState === "processing" ? (
							<div className="sharp-card mt-3" style={{ textAlign: "center", border: "1px solid var(--border-light)" }}>
								<p className="eyebrow">Creating your booking…</p>
								<p className="mono mt-2" style={{ fontSize: "0.85rem" }}>
									Submitting to server
								</p>
								<div
									style={{
										width: "100%",
										height: "4px",
										background: "var(--border-light)",
										marginTop: "1rem",
										overflow: "hidden",
									}}
								>
									<div
										style={{
											width: "30%",
											height: "100%",
											background: "var(--foreground)",
											animation: "pulse 1s infinite ease-in-out",
										}}
									/>
								</div>
							</div>
						) : null}

						{payState === "success" ? (
							<div className="sharp-card mt-3" style={{ textAlign: "center", background: "var(--foreground)", color: "var(--accent-foreground)" }}>
								<p className="eyebrow">Booking confirmed</p>
								<p className="display mt-2" style={{ fontSize: "1.35rem" }}>
									✓ {formatDualCurrency(consultationFeeUsd)} consultation booked
								</p>
								<p className="mono mt-2" style={{ opacity: 0.85 }}>
									Redirecting to booking confirmation…
								</p>
							</div>
						) : null}
					</>
				)}
				{step === "review" && (
					<ConsultationReview
						booking={booking}
						onProceed={() => setSelectedStep("outcome")}
						onRevealOutcome={revealOutcome}
					/>
				)}
				{step === "outcome" && (
					<ConsultationOutcome
						booking={booking}
						onMockOutcome={setEligibilityOutcome}
						onRevealOutcome={revealOutcome}
						autopilot={false}
					/>
				)}

				<div className="row mt-4" style={{ borderTop: "1px solid var(--border-light)", paddingTop: "1rem" }}>
					<Button
						type="button"
						variant="ghost"
						disabled={stepIndex <= 0}
						onClick={() => setSelectedStep(steps[Math.max(0, stepIndex - 1)])}
					>
						← Back
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={stepIndex >= steps.length - 1 || (steps[stepIndex + 1] === "outcome" && !outcomeUnlocked)}
						onClick={() => setSelectedStep(steps[Math.min(steps.length - 1, stepIndex + 1)])}
					>
						{step === "assessment" ? "Continue to schedule →" : "Next →"}
					</Button>
				</div>
			</div>

			{/* the booking rail — what you're about to pay for, always visible */}
			<div className="prail">
				<div className="sharp-card sharp-card--key">
					<p className="eyebrow">Your booking</p>
					<div style={{ marginTop: "0.4rem" }}>
						<div className="pkv">
							<span className="pkv__k">Type</span>
							<span className={`pkv__v${booking.consultationType ? "" : " muted"}`}>
								{booking.consultationType === "online"
									? "Online"
									: booking.consultationType === "in_person"
										? "In person"
										: "Not chosen"}
							</span>
						</div>
						{booking.consultationType !== "online" && (
							<div className="pkv">
								<span className="pkv__k">Branch</span>
								<span className={`pkv__v${booking.branchId ? "" : " muted"}`}>
									{booking.branchId ? getBranchName(booking.branchId) : "Not chosen"}
								</span>
							</div>
						)}
						<div className="pkv">
							<span className="pkv__k">About you</span>
							<span className={`pkv__v${booking.assessment.firstName ? "" : " muted"}`}>
								{booking.assessment.firstName ? "Complete ✓" : "In progress"}
							</span>
						</div>
						<div className="pkv">
							<span className="pkv__k">Date</span>
							<span className={`pkv__v${booking.date ? "" : " muted"}`}>{booking.date || "Not picked"}</span>
						</div>
						<div className="pkv">
							<span className="pkv__k">Time</span>
							<span className={`pkv__v${booking.time ? "" : " muted"}`}>
								{booking.time ? `${booking.time} · 45 min` : "Not picked"}
							</span>
						</div>
						<div className="pkv pkv--due">
							<span className="pkv__k">Consultation fee</span>
							<span className="pkv__v">
								{payState === "paid" ? "Paid ✓" : formatDualCurrency(consultationFeeUsd)}
							</span>
						</div>
					</div>
					<p className="mono" style={{ fontSize: "0.68rem", marginTop: "0.8rem" }}>
						{payState === "paid"
							? `Booked · Ref ${booking.confirmationId}`
							: step === "pay"
								? "The Pay button is on the order."
								: "Fill each step — the Pay button is on the last one."}
					</p>
					<p className="muted" style={{ fontSize: "0.66rem", marginTop: "0.7rem", lineHeight: 1.5 }}>
						The fee confirms the slot. Reschedule free up to 24h before.
					</p>
				</div>

				<div className="sharp-card">
					<p className="eyebrow">What happens next</p>
					<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.6 }}>
						You get the confirmation and a reminder the day before. Your consultant reads your
						assessment form first — that's why step {steps.indexOf("assessment") + 1} asked all those
						questions.
					</p>
				</div>
			</div>
			</div>
		</div>
	);
}



export function PortalConsultation() {
	const { booking, stageStatuses, journeyPhase, pendingAction } = useAppState();

	const [liveConsultation, setLiveConsultation] = useState<ApiConsultation | null>(null);
	const [liveApplication, setLiveApplication] = useState<ApiApplication | null>(null);
	const [loading, setLoading] = useState(true);

	const refreshLiveCase = useCallback(async () => {
		try {
			const res = await meApi.application();
			setLiveConsultation(res.consultation ?? null);
			setLiveApplication(res.application ?? null);
		} catch {
			/* ignore network drop */
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshLiveCase();
	}, [refreshLiveCase]);

	const applicationConsent = liveApplication?.applicationConsent?.decision ?? null;

	// An active case exists if there's a consultation OR an application. Ops
	// can create the application directly (bypassing consultation), and a
	// silent consultation-creation failure after payment shouldn't strand the
	// applicant on the fee page when their application is already in flight.
	const hasActiveCase = Boolean(liveConsultation || liveApplication || booking.confirmationId);
	const activeRef = liveConsultation?.reference ?? booking.confirmationId;
	const activeOfficer = liveConsultation?.assignedOfficerName;
	const workflow = liveConsultation?.workflow;
	const workflowStatus = workflow?.status ?? "AWAITING_ASSIGNMENT";
	const activeOutcome =
		liveConsultation?.assessmentResult?.outcome ||
		(liveConsultation?.assessmentResult && (liveConsultation.assessmentResult.recCountry || liveConsultation.assessmentResult.recPackage) ? "Eligible" : null) ||
		(workflowStatus === "COMPLETED" ? "Eligible" : null) ||
		(booking.consultationPhase === "outcome" ? "Eligible" : null);
	const activeNotes = liveConsultation?.assessmentResult?.notes || booking.eligibilityNote || null;

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · {STAGE_SHORT[journeyPhase.stage] ?? journeyPhase.label}</p>
					<h1 className="page-title mt-1">Consultation &amp; Assessment</h1>
					<p className="lead mt-2">
						{hasActiveCase
							? "Your consultation appointment and official assessment file with Century NIT."
							: "Schedule your one-on-one advisory consultation with a licensed study abroad counselor."}
					</p>
				</div>
			</header>

			{loading ? (
				<div className="sharp-card text-center py-5">
					<p className="muted">Loading consultation case details…</p>
				</div>
			) : !hasActiveCase ? (
				<PortalConsultationBookingFlow />
			) : (
				/* ── The case: journey spine, outcome and messages; facts and next steps beside ── */
				(() => {
					const consultationDocs = liveConsultation?.requestedDocuments ?? [];
					const applicationDocs = liveApplication?.requestedDocuments ?? [];
					const allRequested = Array.from(new Set([...consultationDocs, ...applicationDocs]));
					// The standard documents are collected here, in this chapter, so
					// nothing waits on paperwork later. Not uploaded and rejected are
					// the client's to act on; uploaded is with the consultant.
					const checklist = liveApplication?.documentChecklist ?? liveConsultation?.documentChecklist ?? [];
					const toUpload = checklist.filter((d) => d.status === "PENDING_UPLOAD" || d.status === "REJECTED");
					const toVerify = checklist.filter((d) => d.status === "UPLOADED");
					const verifiedDocs = checklist.filter((d) => d.status === "VERIFIED");
					const statusTone: Tone =
						workflowStatus === "CLOSED" ? "void" : workflowStatus === "COMPLETED" ? "done" : workflowStatus === "IN_PROGRESS" ? "current" : "waiting";
					const statusLabel =
						workflowStatus === "CLOSED"
							? "Appointment closed"
							: workflowStatus === "COMPLETED"
								? "Assessment complete"
								: workflowStatus === "IN_PROGRESS"
									? "In progress"
									: "Awaiting your consultant";
					const when = liveConsultation?.startsAt
						? new Date(liveConsultation.startsAt).toLocaleString(undefined, {
								weekday: "short",
								year: "numeric",
								month: "short",
								day: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})
						: booking.date
							? `${booking.date} at ${booking.time}`
							: "Scheduled";
					const decisionOpen = Boolean(activeOutcome) && (applicationConsent === null || applicationConsent === "pending");

					// What the applicant has to do now — the same derivation the
					// dashboard uses, plus the two things only this chapter asks for.
					const actions: NextAction[] = [];
					if (decisionOpen) {
						actions.push({
							id: "decide",
							title: "Decide whether to proceed",
							detail: "Your assessment is ready. Continue to start your application, or put it on hold.",
							action: (
								<a href="#assessment-outcome" className="btn btn--primary btn--sm">
									Review outcome →
								</a>
							),
						});
					}
					// The assessment feeds the consultant's preparation. A booking made
					// in a hurry can skip it, so it stays asked for until the meeting.
					const profile = liveConsultation?.profile;
					const assessmentGaps = profile
						? (["nationality", "dob", "degree", "degreeLevel", "intake"] as const).filter((k) => !profile[k])
						: [];
					if (assessmentGaps.length > 0 && workflowStatus !== "COMPLETED" && workflowStatus !== "CLOSED") {
						actions.push({
							id: "assessment",
							title: "Complete your assessment form",
							detail: "Your consultant reads this before you meet — your background, passport, education and what you're aiming for.",
							action: (
								<Button to="/portal/profile" variant="primary">
									Complete form →
								</Button>
							),
						});
					}
					if (toUpload.length > 0) {
						actions.push({
							id: "standard-documents",
							title: `Upload your ${toUpload.length === checklist.length ? "documents" : `${toUpload.length} remaining document${toUpload.length === 1 ? "" : "s"}`}`,
							detail: toUpload.map((d) => d.name).join(" · "),
							action: (
								<Button to="/portal/documents" variant="primary">
									Open vault →
								</Button>
							),
						});
					}
					if (allRequested.length > 0) {
						actions.push({
							id: "documents",
							title: `Upload ${allRequested.length} requested document${allRequested.length === 1 ? "" : "s"}`,
							detail: allRequested.join(" · "),
							action: (
								<Button to="/portal/documents" variant="secondary">
									Open vault →
								</Button>
							),
						});
					}
					if (pendingAction && pendingAction.kind !== "documents") {
						actions.push({
							id: pendingAction.kind,
							title: pendingAction.title,
							detail: pendingAction.detail,
							action: (
								<Button to={pendingAction.to} variant="primary">
									{pendingAction.label} →
								</Button>
							),
						});
					}
					if (workflowStatus === "CLOSED") {
						actions.push({
							id: "rebook",
							title: "Rebook your consultation",
							detail: "This appointment was cancelled. Book again to continue.",
							tone: "blocked",
							action: (
								<Button to="/portal/appointments" variant="secondary">
									Rebook →
								</Button>
							),
						});
					}

					return (
						<div className="portal-case">
							<div className="portal-case__main">
								{stageStatuses && (
									<div className="sharp-card">
										<p className="eyebrow mb-2">Your journey</p>
										<JourneyStepper stageStatuses={stageStatuses} nextUnlock={journeyPhase.nextUnlock} />
									</div>
								)}

								{activeOutcome ? (
									<div id="assessment-outcome" className="mt-5">
										<AssessmentOutcomeCard
											outcome={activeOutcome}
											notes={activeNotes}
											recommendations={{
												country: liveConsultation?.assessmentResult?.recCountry,
												university: liveConsultation?.assessmentResult?.recUniversity,
												program: liveConsultation?.assessmentResult?.recProgram,
												package: liveConsultation?.assessmentResult?.recPackage,
											}}
											currentDecision={applicationConsent}
											onDecided={refreshLiveCase}
										/>
									</div>
								) : (
									workflowStatus !== "CLOSED" && (
										<div className="sharp-card mt-5">
											<p className="eyebrow mb-2">Assessment</p>
											<p className="muted">
												{activeOfficer
													? `${activeOfficer} reviews your background, documents and goals during and after your session. Your outcome and recommendation appear here.`
													: "Once a consultant is assigned they review your background, documents and goals. Your outcome and recommendation appear here."}
											</p>
										</div>
									)
								)}

								<div className="sharp-card mt-5">
									<div className="cn-case__top mb-4">
										<span className="cn-case__ref" style={{ fontWeight: 600 }}>{activeRef}</span>
										<StatusPill tone={statusTone} dot>
											{statusLabel}
										</StatusPill>
									</div>
									<dl className="portal-case__facts dossier-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "1.5rem 1rem" }}>
										<div className="dossier-field">
											<dt className="dossier-field__label">Format & Branch</dt>
											<dd className="dossier-field__value">
												{(liveConsultation?.type === "in_person" ? "In person" : "Online")} · {getBranchName(liveConsultation?.branch ?? booking.branchId)}
											</dd>
										</div>
										<div className="dossier-field">
											<dt className="dossier-field__label">Date & Time</dt>
											<dd className="dossier-field__value">{when}</dd>
										</div>
										<div className="dossier-field">
											<dt className="dossier-field__label">Consultant</dt>
											<dd className="dossier-field__value">
												{activeOfficer ? (
													<span className="portal-case__person" style={{ display: "inline-block" }}>
														<span>
															{activeOfficer}
															{liveConsultation?.assignedOfficerEmail && (
																<>
																	<br />
																	<a href={`mailto:${liveConsultation.assignedOfficerEmail}`} className="muted">
																		{liveConsultation.assignedOfficerEmail}
																	</a>
																</>
															)}
														</span>
													</span>
												) : (
													<span className="muted">Being assigned at your branch</span>
												)}
											</dd>
										</div>
									</dl>
									{liveConsultation?.meetingUrl && workflowStatus !== "CLOSED" && (
										<a href={liveConsultation.meetingUrl} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--sm mt-4">
											Join video meeting →
										</a>
									)}
								</div>

								{liveConsultation?.comments && liveConsultation.comments.length > 0 && (
									<div className="sharp-card mt-5">
										<p className="eyebrow mb-2">Messages from your consultant</p>
										<ol className="cn-timeline">
											{[...liveConsultation.comments].reverse().map((cm) => (
												<li key={cm.id} className="cn-timeline__item">
													<div className="cn-timeline__head">
														<span className="cn-timeline__summary">{cm.author}</span>
														<time className="cn-timeline__when" dateTime={cm.at}>
															{new Date(cm.at).toLocaleDateString()}
														</time>
													</div>
													<p className="cn-timeline__detail">{cm.text}</p>
												</li>
											))}
										</ol>
									</div>
								)}
							</div>

							<aside className="portal-case__side">
								<div className="sharp-card">
									<NextActionBand
										items={actions}
										waitingOn={journeyPhase.nextUnlock}
										title="Your next steps"
										emptyTitle="Nothing needed from you right now"
									/>

									{checklist.length > 0 && (
										<>
											<div className="sharp-card-divider" />
											<div className="cn-case__top">
												<p className="eyebrow" style={{ margin: 0 }}>Your documents</p>
												<StatusPill tone={verifiedDocs.length === checklist.length ? "done" : toVerify.length > 0 ? "current" : "waiting"} dot>
													{verifiedDocs.length}/{checklist.length} verified
												</StatusPill>
											</div>
											<p className="muted mt-1" style={{ fontSize: "0.85rem" }}>
												We collect these now so your applications never wait on paperwork.
											</p>
											<ul style={{ listStyle: "none", padding: 0, margin: "1.25rem 0 0", display: "grid", gap: "0.75rem" }}>
												{checklist.map((d) => (
													<li key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.9rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border-light)" }}>
														<span title={d.hint} style={{ fontWeight: 500 }}>{d.name}</span>
														<StatusPill tone={d.status === "VERIFIED" ? "done" : d.status === "UPLOADED" ? "current" : d.status === "REJECTED" ? "blocked" : "neutral"}>
															{d.status === "VERIFIED" ? "Verified" : d.status === "UPLOADED" ? "Being checked" : d.status === "REJECTED" ? "Needs re-upload" : "To upload"}
														</StatusPill>
													</li>
												))}
											</ul>
											{toUpload.length > 0 && (
												<div className="row mt-4">
													<Button to="/portal/documents" variant="secondary">
														Upload in the vault →
													</Button>
												</div>
											)}
										</>
									)}
								</div>
							</aside>
						</div>
					);
				})()
			)}
		</div>
	);
}

/* ========== Payment plan ==========
   The plan is confirmed on the Payment execution chapter; this route only
   exists so old links still land somewhere sensible. */

export function PortalPaymentPlan() {
	return <Navigate to="/portal/payment-execution" replace />;
}


/* ========== Service fee ==========
   Agency settlement happens on the Payment execution chapter. */

export function PortalAgency() {
	return <Navigate to="/portal/payment-execution" replace />;
}


/* ========== Application stage: invoice + school select + tracking ========== */

export function PortalApplicationHub() {
	return (
		<ChapterGate chapter="application">
			<ApplicationHubInner />
		</ChapterGate>
	);
}

function ApplicationHubInner() {
	const {
		application,
		schoolApplications,
		addSchoolApplication,
		removeSchoolApplication,
		lockSchoolSelection,
		setSchoolApplications,
		payAgencyInstallment,
		syncFromServer,
		syncTick,
		journeyPhase,
	} = useAppState();
	const [depositPaying, setDepositPaying] = useState(false);
	const [serverInvoice, setServerInvoice] = useState<ApiInvoice | null>(null);
	// Schools added after the first invoice went out are billed on a
	// supplementary one — every application invoice past the first.
	const [extraInvoices, setExtraInvoices] = useState<ApiInvoice[]>([]);
	const [destId, setDestId] = useState("");
	const [uniId, setUniId] = useState("");
	const [progId, setProgId] = useState("");
	const [intake, setIntake] = useState("");
	const [payPhase, setPayPhase] = useState<"idle" | "loading">("idle");
	const { toast } = useNotifier();

	const hasPkg = hasSchoolPackage(application);
	const depositPaid = application.agencyDepositPaid;

	// Refetched on every AppState sync — the `invoice.issued` / `invoice.paid`
	// SSE events trigger one — so no page-level polling is needed.
	useEffect(() => {
		let cancelled = false;
		meApi
			.invoices({ type: "application" })
			.then((res) => {
				if (cancelled) return;
				const live = res.invoices.filter((i) => i.status !== "void").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
				if (live[0]) setServerInvoice(live[0]);
				setExtraInvoices(live.slice(1));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [syncTick]);

	const inv = application.applicationInvoice;

	const effectiveInv: StageInvoice = useMemo(() => {
		if (!serverInvoice) return inv;
		const isProforma = serverInvoice.status === "proforma";
		const isPaid = serverInvoice.status === "paid";
		const isRaised =
			serverInvoice.status === "issued" ||
			serverInvoice.status === "partial" ||
			serverInvoice.status === "overdue";

		const lines: InvoiceLine[] = serverInvoice.lines.map((l) => ({
			id: l.id,
			label: l.label,
			detail: l.detail || "",
			amount: l.amountCents / 100,
		}));

		return {
			id: serverInvoice.invoiceNumber,
			amount:
				serverInvoice.balanceCents > 0
					? serverInvoice.balanceCents / 100
					: serverInvoice.subtotalCents / 100,
			status: isPaid ? "paid" : isRaised ? "raised" : isProforma ? "estimated" : "none",
			raisedAt: serverInvoice.createdAt,
			paidAt: isPaid ? serverInvoice.updatedAt : null,
			description: isProforma
				? "Your consultant is preparing your invoice."
				: isRaised
					? `Official invoice ${serverInvoice.invoiceNumber} issued by ${serverInvoice.issuedByName}`
					: isPaid
						? `Settled in full (${serverInvoice.invoiceNumber})`
						: inv.description,
			estimatedAmount: serverInvoice.subtotalCents / 100,
			estimateLines: lines,
			actualAmount: isRaised || isPaid ? serverInvoice.subtotalCents / 100 : null,
			actualLines: isRaised || isPaid ? lines : [],
			consultantNote:
				serverInvoice.note && !serverInvoice.note.startsWith("Proforma estimate for")
					? serverInvoice.note
					: null,
		};
	}, [serverInvoice, inv]);

	// A raised-but-unapproved invoice is not shown to the client (`/me/invoices`
	// leaves it out), so "selection done, nothing to pay yet" is read from the
	// journey stage as well as the local lock.
	const selectionDone = Boolean(application.schoolSelectionDoneAt) || Boolean(serverInvoice) || journeyPhase.stage === "awaiting_invoice";
	const paid = effectiveInv.status === "paid" || inv.status === "paid";

	// Poll the server for the authoritative school application statuses once
	// the invoice is paid — handlers post updates as institutions respond.
	// (Moved here from the old Tracking page; the hub is the chapter now.)
	useEffect(() => {
		if (!paid) return;
		let active = true;
		const sync = async () => {
			try {
				const res = await schoolsApi.list();
				if (!active) return;
				setSchoolApplications(
					res.schools.map((s) => ({
						id: s.id,
						destinationId: s.destinationId,
						universityId: s.universityId,
						programId: s.programId,
						universityName: s.universityName ?? null,
						programName: s.programName ?? null,
						intake: s.intake,
						status: s.status,
						outcome: s.outcome ?? null,
						handlerNote: s.handlerNote,
						financialNote: s.financialNote,
						events: (s.events ?? []).map((e) => ({
							at: e.at,
							status: e.status,
							outcome: e.outcome ?? null,
							note: e.note,
							financialNote: e.financialNote ?? undefined,
						})),
						createdAt: s.createdAt,
						updatedAt: s.updatedAt,
						trackStartedAt: null,
						offerTuitionUsd: s.offerTuitionUsd ?? null,
						offerTuitionLabel: s.offerTuitionLabel ?? null,
						offerDepositUsd: s.offerDepositUsd ?? null,
						offerDepositDueAt: s.offerDepositDueAt ?? null,
						offerDepositPaidAt: s.offerDepositPaidAt ?? null,
						offerLetterStorageKey: s.offerLetterStorageKey ?? null,
						institutionReference: s.institutionReference ?? null,
						submissionProofUrl: s.submissionProofUrl ?? null,
					})),
				);
			} catch {
				/* keep local state on network drop */
			}
		};
		void sync();
		const id = window.setInterval(() => void sync(), 30_000);
		return () => {
			active = false;
			window.clearInterval(id);
		};
	}, [paid, setSchoolApplications]);

	const offersCount = schoolApplications.filter((s) => s.outcome === "Admitted").length;
	const decidedCount = schoolApplications.filter((s) => s.status === "Decision Reached").length;

	const selectedLevel = application.schoolDegreeLevel || undefined;
	const selectedTrack = application.schoolFundingTrack || undefined;

	const packagePrograms = useMemo(() => {
		return filterProgramsForPackage(programs, selectedLevel, selectedTrack);
	}, [selectedLevel, selectedTrack]);

	const packageUniversities = useMemo(() => {
		return universitiesForPrograms(packagePrograms, universities);
	}, [packagePrograms]);

	const uniList = destId
		? packageUniversities.filter((u) => u.destinationId === destId)
		: packageUniversities;
	const progList = uniId
		? packagePrograms.filter((p) => p.universityId === uniId)
		: packagePrograms;
	const program = getProgram(progId);
	const intakes = program?.intake ?? ["September 2026", "January 2027"];
	// The universities' own fees are only known once the invoice is raised; the
	// preview is what the ledger says, never a guess.
	const previewAmount = 0;

	// If the applicant already locked their school selection (or has a server
	// invoice), they are past the package/deposit gate — show the invoice
	// instead of bouncing them back to package selection. The redirects below
	// only apply to applicants who haven't started school selection yet.
	if (!selectionDone && !hasPkg) {
		return <Navigate to="/portal/package" replace />;
	}
	if (!selectionDone && !depositPaid) {
		return <Navigate to="/portal/package" replace />;
	}
	if (
		application.pendingHandoff &&
		application.pendingHandoff.stage === "school_submission"
	) {
		return <Navigate to="/portal/awaiting-handler" replace />;
	}

	async function payInvoice() {
		const { invoices } = await meApi.invoices().catch(() => ({ invoices: [] as ApiInvoice[] }));
		const backend = invoices.find((i) => i.type === "application" && i.balanceCents > 0);
		if (!backend) {
			toast.error("Your application invoice has not been issued on the server yet. Ask your consultant to raise it.");
			return;
		}
		await payOne(backend);
	}

	/** Paystack hosted checkout for one issued invoice. */
	async function payOne(backend: ApiInvoice) {
		setPayPhase("loading");
		try {
			if (backend.status === "proforma") {
				toast.error("Your consultant is still preparing this invoice. You'll be notified when it is ready to pay.");
				return;
			}
			// Real Paystack hosted checkout session
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

	function addSchool(e: FormEvent) {
		e.preventDefault();
		const d = destId || destinations[0]?.id || "uk";
		const uList = universitiesForDestination(d);
		const u = uniId || uList[0]?.id || universities[0]?.id || "";
		const pList = programsForUniversity(u);
		const p = progId || pList[0]?.id || programs[0]?.id || "";
		const i = intake || "September 2026";
		addSchoolApplication({
			destinationId: d,
			universityId: u,
			programId: p,
			intake: i,
		});
		schoolsApi
			.add({
				destinationId: d,
				universityId: u,
				programId: p,
				intake: i,
			})
			.catch((err) => console.warn("Failed to sync school to server", err));
		setProgId("");
		setIntake("");
	}

	function handleRemoveSchool(schoolId: string) {
		removeSchoolApplication(schoolId);
		schoolsApi.remove(schoolId).catch((err) => console.warn("Failed to remove school from server", err));
	}

	async function handleLockSelection() {
		try {
			await schoolsApi.lock();
			// Pulls the proforma the lock just raised (via the syncTick refetch).
			void syncFromServer();
		} catch (err) {
			console.warn("Failed to sync lock to server", err);
		}
		lockSchoolSelection();
	}



	if (payPhase === "loading") {
		return (
			<div className="loading-overlay">
				<div className="spinner" aria-hidden />
				<p className="mono">Contacting payment provider…</p>
				<p className="muted">Charging {formatDualCurrency(inv.amount || previewAmount)}</p>
			</div>
		);
	}

	const fund = SCHOOL_FUNDING_TRACKS.find((f) => f.id === application.schoolFundingTrack);
	const deg = SCHOOL_DEGREE_LEVELS.find((d) => d.id === application.schoolDegreeLevel);

	// The band — the one thing this chapter needs from the applicant.
	const band = !selectionDone
		? { title: "Choose your target schools", detail: "Pick the institutions and programmes, confirm the list — your consultant prices the application fees from it.", cta: null as ReactNode }
		: paid && application.acceptedSchoolId
			? { title: "Offer accepted — your visa chapter is open", detail: "Your destination is confirmed. Visa processing is the next chapter.", cta: <Button to="/portal/visa" variant="inverted" arrow>Open Visa →</Button> }
			: paid && offersCount > 0
				? { title: `${offersCount} offer${offersCount === 1 ? "" : "s"} in — accept one to open the visa chapter`, detail: "Your consultant is holding the visa file until you pick a school.", cta: null as ReactNode }
				: paid
					? { title: "Applications under review", detail: "Your handler has lodged every file. Universities typically reply in 2–6 weeks — the status changes here the moment one lands.", cta: null as ReactNode }
					: effectiveInv.status === "raised"
						? { title: `Pay the application invoice — ${formatMoney(serverInvoice?.balanceCents ?? 0, "ghs")} due`, detail: "Each university's own application fee, paid on your behalf at cost.", cta: <Button variant="inverted" onClick={payInvoice} arrow>Pay now →</Button> }
						: { title: "Your invoice is being prepared", detail: "Your school list is with your consultant. You'll be notified the moment it's ready to pay.", cta: null as ReactNode };

	const stepState = (n: 1 | 2 | 3 | 4): "done" | "current" | "later" =>
		n === 1 ? (selectionDone ? "done" : "current")
		: n === 2 ? (paid ? "done" : selectionDone ? "current" : "later")
		: n === 3 ? (offersCount > 0 || application.acceptedSchoolId ? "done" : paid ? "current" : "later")
		: application.acceptedSchoolId ? "done" : offersCount > 0 ? "current" : "later";

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter III · Applications</p>
					<h1 className="page-title mt-1">Applications</h1>
					<p className="lead mt-2">
						Target your schools, settle the application invoice, then watch each file move.
						Your consultant submits — you watch.
					</p>
				</div>
				{application.applicationId ? (
					<p className="mono muted" style={{ fontSize: "0.7rem" }}>
						CASE {application.applicationId}
						{application.assignedStaffName ? ` · HANDLER ${application.assignedStaffName.toUpperCase()}` : ""}
					</p>
				) : null}
			</header>

			{application.proceedStatus === "declined" ? (
				<section className="sharp-card mb-4" style={{ borderLeft: "4px solid var(--foreground)" }}>
					<p className="eyebrow">Application Paused</p>
					<h2 className="page-title mt-1" style={{ fontSize: "1.45rem" }}>
						You paused your application
					</h2>
					<p className="lead mt-2" style={{ maxWidth: "44rem" }}>
						Everything stays on hold. We can re-open your application whenever you are ready — just reach out to your consultant.
					</p>
					<div className="row mt-4">
						<Button to="/portal/home" variant="ghost">
							Back to dashboard
						</Button>
					</div>
				</section>
			) : null}

			{/* You are here */}
			<div className="journey-now mt-4">
				<div>
					<p className="eyebrow">Chapter III · Applications — you are here</p>
					<p className="display journey-now__title">{band.title}</p>
					<p className="journey-now__detail">{band.detail}</p>
				</div>
				{band.cta}
			</div>

			<div className="psteps mt-4">
				<span className={`portal-pill ${stepState(1) === "done" ? "portal-pill--done" : stepState(1) === "current" ? "portal-pill--solid" : "portal-pill--hollow"}`}>
					{stepState(1) === "done" ? "✓" : "1"} · Target schools
				</span>
				<span className={`portal-pill ${stepState(2) === "done" ? "portal-pill--done" : stepState(2) === "current" ? "portal-pill--solid" : "portal-pill--hollow"}`}>
					{stepState(2) === "done" ? "✓" : "2"} · Invoice
				</span>
				<span className={`portal-pill ${stepState(3) === "done" ? "portal-pill--done" : stepState(3) === "current" ? "portal-pill--solid" : "portal-pill--hollow"}`}>
					{stepState(3) === "done" ? "✓" : "3"} · Submission &amp; decisions
				</span>
				<span className={`portal-pill ${stepState(4) === "done" ? "portal-pill--done" : stepState(4) === "current" ? "portal-pill--solid" : "portal-pill--hollow"}`}>
					{stepState(4) === "done" ? "✓" : "4"} · Accept an offer
				</span>
			</div>

			<div className="psplit mt-6">
				<div>
			{/* 1 · Target list */}
			{!selectionDone ? (
				<section className="mb-5">
					<div className="psec">
						<span className="psec__no">1</span>
						<span className="psec__title">Your target list</span>
						<span className="psec__hint">up to 5 schools</span>
					</div>
					{!hasPkg ? (
						<div className="sharp-card mb-4">
							<p className="eyebrow">Academic Package Required</p>
							<h3 className="display mt-1" style={{ fontSize: "1.25rem" }}>Please Select Your School Package First</h3>
							<p className="muted mt-2" style={{ maxWidth: "42rem" }}>
								Your study level (BSc, Master&apos;s, PhD) and funding track (Scholarship, Hybrid, Non-Scholarship) filter the institutions and courses available for targeting.
							</p>
							<div className="row mt-3">
								<Button to="/portal/package" arrow>
									Choose School Package →
								</Button>
							</div>
						</div>
					) : !depositPaid ? (
						<div className="sharp-card mb-4" style={{ borderLeft: "4px solid var(--foreground)" }}>
							<p className="eyebrow">10% Commitment Deposit Required</p>
							<h3 className="display mt-1" style={{ fontSize: "1.25rem" }}>Activate Your File to Unlock School Selection</h3>
							<p className="muted mt-2" style={{ maxWidth: "44rem", lineHeight: 1.6 }}>
								A 10% commitment deposit is required to begin preparing and submitting your university applications. This covers your comprehensive credential review, document verification, and portal account setup.
							</p>
							<div className="row mt-3" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
								<Button
									type="button"
									onClick={async () => {
										setDepositPaying(true);
										try {
											await payAgencyInstallment();
										} catch (err) {
											toast.error(err instanceof Error ? err.message : "Could not initiate deposit payment");
											setDepositPaying(false);
										}
									}}
									disabled={depositPaying}
									arrow
								>
									{depositPaying ? "Connecting to Paystack…" : "Pay 10% Deposit via Paystack →"}
								</Button>
								<Button to="/portal/package" variant="ghost">
									Review Package Details
								</Button>
							</div>
						</div>
					) : null}

					<div className="application-select">
						<form className="form-shell card card--pad" onSubmit={addSchool}>
							<fieldset disabled={!hasPkg || !depositPaid} style={{ border: "none", padding: 0, margin: 0, opacity: (!hasPkg || !depositPaid) ? 0.6 : 1 }}>
							<div className="form-grid form-grid--2">
								<Field label="Destination" htmlFor="s-dest">
									<Select
										id="s-dest"
										value={destId}
										onChange={(e) => {
											setDestId(e.target.value);
											setUniId("");
											setProgId("");
											setIntake("");
										}}
										fullBorder
									>
										<option value="">Any / pick</option>
										{destinations.map((d) => (
											<option key={d.id} value={d.id}>
												{d.flag} {d.name}
											</option>
										))}
									</Select>
								</Field>
								<Field label="University" htmlFor="s-uni">
									<Select
										id="s-uni"
										value={uniId}
										onChange={(e) => {
											setUniId(e.target.value);
											setProgId("");
											setIntake("");
										}}
										fullBorder
									>
										<option value="">Any / pick</option>
										{uniList.map((u) => (
											<option key={u.id} value={u.id}>
												{u.name}
											</option>
										))}
									</Select>
								</Field>
								<Field label="Programme" htmlFor="s-prog">
									<Select
										id="s-prog"
									value={progId}
									onChange={(e) => {
										setProgId(e.target.value);
										setIntake("");
									}}
									fullBorder
								>
									<option value="">Any / pick</option>
									{(progList.length ? progList : programs).map((p) => (
										<option key={p.id} value={p.id}>
											{p.name}
										</option>
									))}
								</Select>
							</Field>
							<Field label="Intake" htmlFor="s-int">
								<Select
									id="s-int"
									value={intake}
									onChange={(e) => setIntake(e.target.value)}
									fullBorder
								>
									<option value="">Any / pick</option>
									{intakes.map((i) => (
										<option key={i} value={i}>
											{i}
										</option>
									))}
								</Select>
							</Field>
						</div>
						{/* The figure that should influence the choice, shown before it is made */}
						{program ? (
							<p className="tuition-peek mt-2">
								<span className="tuition-peek__label mono">Tuition</span>
								<span className="tuition-peek__fig">{program.tuition}</span>
								<span className="tuition-peek__usd mono">
									≈ {formatDualCurrency(program.tuitionUsd)} · paid to the university
								</span>
							</p>
						) : null}

						<div className="row mt-3">
							<Button type="submit" variant="secondary">
								Add school
							</Button>

							{schoolApplications.length > 0 ? (
								<>
									<ul className="school-track-list mt-3">
										{schoolApplications.map((s) => {
											const prog = getProgram(s.programId);
											return (
												<li key={s.id} className="school-track-card">
													<div className="school-track-card__main">
														<strong>
															{getUniversity(s.universityId)?.name} · {prog?.name}
														</strong>
														<p className="muted">{s.intake}</p>
														{prog ? (
															<p className="school-tuition">
																<span className="school-tuition__fig">{prog.tuition}</span>
																<span className="school-tuition__note">
																	tuition · paid to the university
																</span>
															</p>
														) : null}
													</div>
													<button
														type="button"
														className="btn btn--ghost btn--sm"
														onClick={() => handleRemoveSchool(s.id)}
													>
														Remove
													</button>
												</li>
											);
										})}
									</ul>
								</>
							) : null}
						</div>
						</fieldset>
					</form>
					</div>

					{schoolApplications.length > 0 ? (
						<div className="row mt-4">
							<Button type="button" onClick={handleLockSelection}>
								Confirm school list & submit to handler
							</Button>
						</div>
					) : (
						<p className="mono muted mt-3">Add at least one school to continue.</p>
					)}

				</section>
			) : null}

			{/* The locked list — tracking rows once the invoice is paid */}
			{selectionDone ? (
				<section className="mb-5">
					<div className="psec">
						<span className="psec__no psec__no--done">✓</span>
						<span className="psec__title">Your target list</span>
						<span className="psec__hint">
							{schoolApplications.length} school{schoolApplications.length === 1 ? "" : "s"} · locked
							{application.schoolSelectionDoneAt
								? ` ${new Date(application.schoolSelectionDoneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
								: ""}
						</span>
					</div>
					{paid ? (
						<ul className="school-track-list school-track-list--grid" style={{ gap: "1.5rem", padding: 0 }}>
							{schoolApplications.map((s) => (
								<SchoolTrackCard
									key={s.id}
									row={s}
									canRemove={false}
									onRemove={() => undefined}
									accepted={application.acceptedSchoolId === s.id}
									anotherAccepted={Boolean(application.acceptedSchoolId) && application.acceptedSchoolId !== s.id}
									onAccept={async () => {
										await schoolsApi.meAcceptOffer(s.id);
										await syncFromServer();
									}}
								/>
							))}
						</ul>
					) : (
						<div className="sharp-card">
							<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
								{schoolApplications.map((s) => (
									<li key={s.id} className="pkv" style={{ alignItems: "baseline" }}>
										<span className="pkv__v" style={{ textAlign: "left" }}>
											<strong>{s.universityName ?? getUniversity(s.universityId)?.name}</strong>
											<span className="muted"> · {s.programName ?? getProgram(s.programId)?.name} · {s.intake}</span>
										</span>
										<span className="pkv__k">with your consultant</span>
									</li>
								))}
							</ul>
						</div>
					)}
				</section>
			) : null}

			{/* 2 · Invoice — the real invoice once issued, an awaiting card while proforma */}
			<section className="mb-5">
				<div className="psec">
					<span className={`psec__no${paid ? " psec__no--done" : ""}`}>{paid ? "✓" : "2"}</span>
					<span className="psec__title">Application invoice</span>
					<span className="psec__hint">
						{serverInvoice ? `${serverInvoice.invoiceNumber} · ${serverInvoice.status}` : selectionDone ? "being prepared" : "not raised"}
					</span>
				</div>
				{selectionDone ? (
					effectiveInv.status === "estimated" || !serverInvoice ? (
						<div className="sharp-card mb-4" style={{ borderLeft: "4px solid var(--foreground)" }}>
							<h3 className="display mt-1" style={{ fontSize: "1.4rem" }}>
								Being prepared
							</h3>
							<p className="muted mt-2" style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>
								Your school list is with your consultant. They are preparing your application invoice —
								you'll be notified the moment it is ready to pay.
							</p>
							<p className="muted mt-1" style={{ fontSize: "0.85rem" }}>
								Nothing to do right now — the payment card appears here once the invoice is issued.
							</p>
						</div>
					) : (
						<div className="sharp-card mb-4">
							<InvoiceCard
								title="Application invoice"
								invoice={serverInvoice}
								actions={
									serverInvoice.status === "paid" ? (
										<Button variant="secondary" onClick={() => downloadReceipt(serverInvoice, "Application invoice")}>
											Download receipt
										</Button>
									) : serverInvoice.status !== "proforma" && serverInvoice.balanceCents > 0 ? (
										<Button onClick={payInvoice} arrow>
											Pay {formatMoney(serverInvoice.balanceCents, "ghs")}
										</Button>
									) : null
								}
							/>
							<ul className="portal-snapshot mt-4" style={{ maxWidth: "20rem" }}>
								<li>
									<span>Schools</span>
									<strong>{schoolApplications.length}</strong>
								</li>
								<li>
									<span>What this covers</span>
									<strong>Each university's own application fee — paid on your behalf, at cost</strong>
								</li>
							</ul>
							{extraInvoices.map((x) => (
								<div key={x.id} className="mt-4">
									<InvoiceCard
										compact
										title="Additional schools"
										invoice={x}
										actions={
											x.status === "paid" ? (
												<Button variant="secondary" onClick={() => downloadReceipt(x, "Application invoice")}>
													Download receipt
												</Button>
											) : x.status !== "proforma" && x.balanceCents > 0 ? (
												<Button onClick={() => void payOne(x)} arrow>
													Pay {formatMoney(x.balanceCents, "ghs")}
												</Button>
											) : null
										}
									/>
								</div>
							))}
						</div>
					)
				) : (
					<p className="mono muted mb-4">Confirm your school list to submit it to your consultant for invoicing.</p>
				)}
			</section>

			{/* 3 · Decisions & your consultant — what Century does, then what you do */}
			<section className="mb-5">
				<div className="psec">
					<span className={`psec__no${application.acceptedSchoolId ? " psec__no--done" : ""}`}>{application.acceptedSchoolId ? "✓" : "3"}</span>
					<span className="psec__title">Submission &amp; decisions</span>
					<span className="psec__hint">
						{paid ? `${decidedCount} of ${schoolApplications.length} decided` : "unlocks after payment"}
					</span>
				</div>
				{paid ? (
					<>
						{application.pendingHandoff && (
							<div className="sharp-card mb-4" style={{ borderLeft: "4px solid var(--foreground)" }}>
								<p className="eyebrow">Assigning your visa officer</p>
								<p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.6, marginTop: "0.4rem" }}>
									We're assigning your{" "}
									{JOURNEY_STAGE_LABELS[application.pendingHandoff.stage as JourneyStage] ??
										application.pendingHandoff.stage}{" "}
									specialist — you'll be notified once your consultant is confirmed.
								</p>
							</div>
						)}

						{/* Several offers and no choice yet: the visa and departure are for one school. */}
						{offersCount > 1 && !application.acceptedSchoolId && (
							<div className="sharp-card mb-4" style={{ border: "2px solid var(--foreground)" }}>
								<p className="eyebrow">Choose your school</p>
								<p className="display mt-1" style={{ fontSize: "1.2rem" }}>
									You hold {offersCount} offers — which one are you going with?
								</p>
								<p className="muted mt-2">
									Use “Accept this offer” on the school above. Your visa application and departure are prepared for that school.
								</p>
							</div>
						)}

						<ConsultantUpdates comments={application.comments} filter={(c) => !isVisaUpdate(c)} className="mb-4" />

						{offersCount > 0 ? (
							application.visaConsent?.decision === "continue" ? (
								<div className="sharp-card next-action" style={{ border: "2px solid var(--foreground)" }}>
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
										<div>
											<p className="eyebrow">Admitted · {offersCount} school(s)</p>
											<p className="display mt-1" style={{ fontSize: "1.35rem" }}>
												Visa processing requested
											</p>
											<p className="muted mt-2">
												You have consented to proceed to the visa stage. Continue to your visa hub to monitor specialist assignment and invoice status.
											</p>
										</div>
										<Button to="/portal/visa" arrow>
											Next · Visa &amp; travel
										</Button>
									</div>
								</div>
							) : (
								<div>
									<div className="mb-3">
										<p className="eyebrow">Admitted · Next Action</p>
									</div>
									<StageConsentCard
										stage="visa"
										currentDecision={application.visaConsent?.decision ?? null}
										title="Congratulations on your Admission! Continue to Visa Stage?"
										lead={`You have been admitted to ${offersCount} school(s). Decide whether you would like Century NIT to handle your visa processing.`}
										continueDetail="Your case will be sent to our Operations team to assign a dedicated consultant and prepare your official visa application fee invoice."
										holdDetail="Need time to review your offers or arrange funding? You can keep your file on hold and return whenever you are ready. No invoices will be raised."
										optOutDetail="You may choose to handle your visa application independently or decline visa processing."
										onDecided={() => {
											void syncFromServer();
										}}
									/>
								</div>
							)
						) : (
							<div className="sharp-card">
								<p className="eyebrow">In progress</p>
								<p className="muted mt-2">
									Your handler has lodged every file and chases replies weekly. A school reaching{" "}
									<strong>Decision Reached</strong> unlocks the visa chapter — you'll see it here first.
								</p>
							</div>
						)}
					</>
				) : (
					<p className="mono muted">The pipeline view opens once the application invoice is paid.</p>
				)}
			</section>
				</div>

				{/* the rail — position, chapter facts, the offer explainer */}
				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>Your position</p>
						<p style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.3rem" }}>
							{offersCount > 0 ? `${offersCount} offer${offersCount === 1 ? "" : "s"}` : paid ? `${schoolApplications.length} filed` : `${schoolApplications.length} targeted`}
						</p>
						<p className="mono" style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.7)", marginTop: "0.15rem" }}>
							{schoolApplications.length} TARGETED · {decidedCount} DECIDED
							{application.acceptedSchoolId ? " · OFFER ACCEPTED" : ""}
						</p>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">This chapter</p>
						<div style={{ marginTop: "0.4rem" }}>
							<div className="pkv">
								<span className="pkv__k">Package</span>
								<span className="pkv__v">{[fund?.name, deg?.name].filter(Boolean).join(" · ") || "—"}</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Schools targeted</span>
								<span className="pkv__v">{schoolApplications.length}</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Invoice</span>
								<span className="pkv__v">
									{paid ? "Paid" : effectiveInv.status === "raised" ? `${formatMoney(serverInvoice?.balanceCents ?? 0, "ghs")} due` : "Not raised"}
								</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Handler</span>
								<span className="pkv__v">{application.assignedStaffName ?? "Assigning…"}</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Next unlock</span>
								<span className="pkv__v">IV · Visa</span>
							</div>
						</div>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Accepting an offer</p>
						<p className="muted" style={{ fontSize: "var(--text-sm)", lineHeight: 1.6, marginTop: "0.5rem" }}>
							Accepting confirms your destination — the visa file and departure are prepared for that
							school. The university's own deposit is paid to the school directly; your consultant
							walks you through it.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ========== Tracking — folded into the Applications chapter ========== */

export function PortalTrackingPage() {
	return <Navigate to="/portal/application" replace />;
}

/**
 * What the university is asking for, once an offer exists.
 *
 * Deliberately styled apart from every Century NIT money surface — this is
 * paid to the institution. The deposit deadline is given the most weight
 * because missing it forfeits the place.
 */
function OfferTerms({ row }: { row: SchoolApplicationTrack }) {
	const due = row.offerDepositDueAt ? new Date(row.offerDepositDueAt) : null;
	const paid = Boolean(row.offerDepositPaidAt);

	// The clock is external state, so it is read after paint rather than during
	// render. The deadline itself shows immediately; only the countdown waits.
	const [daysLeft, setDaysLeft] = useState<number | null>(null);
	useEffect(() => {
		if (!row.offerDepositDueAt) return;
		const target = new Date(row.offerDepositDueAt).getTime();
		const tick = () => setDaysLeft(Math.ceil((target - Date.now()) / 86_400_000));
		tick();
		const id = window.setInterval(tick, 60_000);
		return () => window.clearInterval(id);
	}, [row.offerDepositDueAt]);

	const urgent = daysLeft !== null && daysLeft <= 14;

	return (
		<div className="offer-terms">
			<p className="offer-terms__head mono">Offer terms · payable to {"the university"}</p>

			<div className="offer-terms__grid">
				<div className="offer-terms__cell">
					<span className="offer-terms__label mono">Tuition</span>
					<span className="offer-terms__native">{row.offerTuitionLabel}</span>
					<Money usd={row.offerTuitionUsd ?? 0} className="offer-terms__money" />
				</div>

				{row.offerDepositUsd ? (
					<div className="offer-terms__cell">
						<span className="offer-terms__label mono">Deposit to hold your place</span>
						<Money usd={row.offerDepositUsd} className="offer-terms__money" />
					</div>
				) : null}
			</div>

			{due ? (
				<p
					className={`offer-terms__due${urgent && !paid ? " offer-terms__due--urgent" : ""}${paid ? " offer-terms__due--paid" : ""}`}
				>
					{paid ? (
						<>Deposit paid {new Date(row.offerDepositPaidAt!).toLocaleDateString()}</>
					) : (
						<>
							<strong>
								Deposit due {due.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
							</strong>
							{daysLeft !== null ? (
								<span className="offer-terms__countdown">
									{daysLeft > 0
										? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
										: " · overdue"}
								</span>
							) : null}
							<span className="offer-terms__warn">
								The place is not held until the university receives this.
							</span>
						</>
					)}
				</p>
			) : null}
		</div>
	);
}

const TRACK_PIPELINE: SchoolTrackStatus[] = SCHOOL_TRACK_STAGES;

function trackSlug(status: SchoolTrackStatus): string {
	return status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function trackLabel(row: SchoolApplicationTrack): string {
	if (row.status === "Decision Reached" && row.outcome) {
		return SCHOOL_OUTCOME_LABELS[row.outcome];
	}
	return SCHOOL_TRACK_STATUS_LABELS[row.status];
}

function decisionUpdateCopy(row: SchoolApplicationTrack, uniName: string, programName: string): string {
	if (row.handlerNote) return row.handlerNote;
	if (row.status !== "Decision Reached" || !row.outcome) {
		return "Waiting for your consultant's first update…";
	}
	return (
		schoolDecisionNote({ outcome: row.outcome, universityName: uniName, programName }) ??
		"Waiting for your consultant's first update…"
	);
}

/** A signed, short-lived link to one file on a school row, opened in a new tab. */
function SchoolFileLink({ schoolId, kind, label }: { schoolId: string; kind: SchoolFileKind; label: string }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const open = async () => {
		setBusy(true);
		setError(null);
		try {
			const ticket = await schoolsApi.meFileDownloadUrl(schoolId, kind);
			window.open(ticket.url, "_blank", "noopener");
		} catch {
			setError("Could not open the file. Please try again.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<button type="button" className="btn btn--secondary btn--sm" onClick={open} disabled={busy}>
				{busy ? "Opening…" : label}
			</button>
			{error ? <span className="muted" style={{ marginLeft: "0.5rem" }}>{error}</span> : null}
		</>
	);
}

function AdmissionLetterViewer({ schoolId, universityName }: { schoolId: string; universityName: string }) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [url, setUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const openModal = async () => {
		setOpen(true);
		if (url) return;
		setBusy(true);
		setError(null);
		try {
			const ticket = await schoolsApi.meAdmissionLetterDownloadUrl(schoolId);
			setUrl(ticket.url);
		} catch (err) {
			// Held until the pre-departure fee milestone — the API says so; show it as it is.
			setError(err instanceof ApiError && err.code === "RELEASE_HELD" ? `🔒 ${err.message}` : "Could not load the admission letter. Please try again.");
		} finally {
			setBusy(false);
		}
	};

	const closeModal = () => {
		setOpen(false);
	};

	return (
		<>
			<button
				type="button"
				onClick={openModal}
				className="btn btn--secondary btn--sm"
				style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
			>
				<span aria-hidden>📄</span>
				<span>View admission letter</span>
			</button>

			{open ? (
				<div
					className="admission-letter-modal"
					role="dialog"
					aria-modal="true"
					aria-label={`Admission letter for ${universityName}`}
					onClick={closeModal}
				>
					<div
						className="admission-letter-modal__panel"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="admission-letter-modal__header">
							<div>
								<p className="eyebrow" style={{ fontSize: "0.65rem" }}>Admission letter</p>
								<p style={{ fontWeight: 600, fontSize: "0.95rem" }}>{universityName}</p>
							</div>
							<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
								{url ? (
									<a
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										className="btn btn--ghost btn--sm"
										style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
									>
										<span aria-hidden>⤢</span>
										<span>Expand</span>
									</a>
								) : null}
								<button
									type="button"
									onClick={closeModal}
									aria-label="Close"
									className="btn btn--ghost btn--sm"
									style={{ fontSize: "1rem", lineHeight: 1 }}
								>
									✕
								</button>
							</div>
						</div>
						<div className="admission-letter-modal__body">
							{busy ? (
								<div className="admission-letter-modal__loading">
									<p className="mono muted">Loading admission letter…</p>
								</div>
							) : error ? (
								<div className="admission-letter-modal__error">
									<p>{error}</p>
								</div>
							) : url ? (
								<iframe
									src={url}
									title={`Admission letter for ${universityName}`}
									className="admission-letter-modal__frame"
								/>
							) : null}
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}

/** Read-only school card - applicant sees handler updates, cannot edit them */
function SchoolTrackCard({
	row,
	canRemove,
	onRemove,
	accepted = false,
	anotherAccepted = false,
	onAccept,
}: {
	row: SchoolApplicationTrack;
	canRemove: boolean;
	onRemove: () => void;
	/** This is the offer the client is going with. */
	accepted?: boolean;
	/** A different offer is already accepted — accepting this one replaces it. */
	anotherAccepted?: boolean;
	/** Present once decisions are in and the client may choose. */
	onAccept?: () => Promise<void>;
}) {
	const dest = getDestination(row.destinationId);
	const uni = getUniversity(row.universityId);
	const program = getProgram(row.programId);
	const curIdx = Math.max(0, TRACK_PIPELINE.indexOf(row.status));
	const [accepting, setAccepting] = useState(false);
	const [acceptError, setAcceptError] = useState<string | null>(null);
	const accept = async () => {
		if (!onAccept) return;
		if (anotherAccepted && !window.confirm(`Switch your accepted offer to ${uni?.name ?? row.universityName ?? "this school"}?`)) return;
		setAccepting(true);
		setAcceptError(null);
		try {
			await onAccept();
		} catch (err) {
			setAcceptError(err instanceof ApiError ? err.message : "Could not record your choice. Please try again.");
		} finally {
			setAccepting(false);
		}
	};

	return (
		<li
			className={`school-track-card school-track-card--${trackSlug(row.status)}${row.outcome === "Admitted" ? " school-track-card--admitted" : ""}`}
		>
			<div className="school-track-card__main">
				<div className="between" style={{ gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
					<div>
						<p className="eyebrow" style={{ fontSize: "0.7rem" }}>
							{dest?.flag} {dest?.name}
						</p>
						<strong className="display mt-1" style={{ fontSize: "1.4rem", display: "block" }}>
							{uni?.name}
						</strong>
						<p className="muted" style={{ fontSize: "0.9rem" }}>
							{program?.name} · {row.intake}
						</p>
						{row.institutionReference ? (
							<p className="mono muted mt-1" style={{ fontSize: "0.75rem" }}>
								Application ref · {row.institutionReference}
							</p>
						) : null}
					</div>
					<span className={`track-status-pill track-status-pill--${trackSlug(row.status)}${row.outcome === "Admitted" ? " track-status-pill--admitted" : ""}`}>
						{accepted ? "★ Your choice" : trackLabel(row)}
					</span>
				</div>

				{/* Offer terms — only displayed for schools that have made an offer */}
				{row.offerTuitionUsd && row.outcome === "Admitted" ? (
					<OfferTerms row={row} />
				) : null}

				{/* Compact progress bar */}
				<div style={{ marginTop: "1.25rem" }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							fontSize: "0.7rem",
							marginBottom: "0.4rem",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
						}}
					>
						<span>Progress</span>
						<span>
							{curIdx + 1} / {TRACK_PIPELINE.length}
						</span>
					</div>
					<div
						style={{
							height: "6px",
							background: "var(--border-light)",
							borderRadius: "999px",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								width: `${((curIdx + 1) / TRACK_PIPELINE.length) * 100}%`,
								height: "100%",
								background: "var(--foreground)",
								transition: "width 600ms ease",
							}}
						/>
					</div>
				</div>

				{/* Pipeline steps as compact chips */}
				<ol className="track-pipeline" aria-label="Application status pipeline" style={{ marginTop: "1rem" }}>
					{TRACK_PIPELINE.map((step, i) => (
						<li
							key={step}
							className={`track-pipeline__step${i <= curIdx ? " track-pipeline__step--done" : ""}${i === curIdx ? " track-pipeline__step--current" : ""}`}
						>
							<span className="track-pipeline__dot" aria-hidden>
								{i < curIdx ? "✓" : i + 1}
							</span>
							<span className="track-pipeline__label">
								{SCHOOL_TRACK_STATUS_LABELS[step]}
							</span>
						</li>
					))}
				</ol>

				{/* Latest update — congrats / decision copy, admission letter, docs */}
				<div
					className="sharp-card"
					style={{
						marginTop: "1.25rem",
						background: "var(--background)",
						border: "1px solid var(--border-light)",
					}}
				>
					<div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
						<div style={{ flex: "1 1 240px" }}>
							<p className="eyebrow" style={{ fontSize: "0.65rem" }}>
								Latest update
							</p>
							<p className="mt-2" style={{ fontSize: "0.95rem", fontWeight: 500, lineHeight: 1.55 }}>
								{decisionUpdateCopy(row, uni?.name ?? "", program?.name ?? "")}
							</p>
							{row.outcome === "Admitted" && row.offerLetterStorageKey ? (
								<div className="mt-3" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
									<AdmissionLetterViewer schoolId={row.id} universityName={uni?.name ?? row.universityName ?? "University"} />
								</div>
							) : null}
							{row.outcome === "Admitted" && !row.offerLetterStorageKey ? (
								<p className="muted mt-2" style={{ fontSize: "0.8rem" }}>
									The official admission letter and documents will appear here once your consultant
									uploads them.
								</p>
							) : null}
							{row.submissionProofUrl ? (
								<p className="mt-2" style={{ fontSize: "0.8rem" }}>
									<SchoolFileLink schoolId={row.id} kind="submission-proof" label="View submission confirmation" />
								</p>
							) : null}
							{row.outcome === "Admitted" && onAccept ? (
								<div className="mt-3">
									{accepted ? (
										<p style={{ fontSize: "0.85rem", fontWeight: 600 }}>
											★ You accepted this offer. Your consultant will take it from here.
										</p>
									) : (
										<>
											<button type="button" className="btn btn--primary btn--sm" onClick={accept} disabled={accepting}>
												{accepting ? "Saving…" : anotherAccepted ? "Switch to this offer" : "Accept this offer"}
											</button>
											<p className="muted mt-1" style={{ fontSize: "0.75rem" }}>
												Tell us which school you are going with — visa and travel are arranged for that one.
											</p>
										</>
									)}
									{acceptError ? (
										<p className="mt-1" style={{ fontSize: "0.8rem", color: "var(--danger, #b91c1c)" }}>
											{acceptError}
										</p>
									) : null}
								</div>
							) : null}
							{row.updatedAt ? (
								<p className="mono muted mt-2" style={{ fontSize: "0.7rem" }}>
									{new Date(row.updatedAt).toLocaleString()}
								</p>
							) : null}
						</div>
						{row.financialNote ? (
							<div
								style={{
									flex: "1 1 200px",
									paddingLeft: "1rem",
									borderLeft: "1px solid var(--border-light)",
								}}
							>
								<p className="eyebrow" style={{ fontSize: "0.65rem" }}>
									From the university
								</p>
								<p className="mt-2" style={{ fontSize: "0.85rem", lineHeight: 1.55 }}>
									{row.financialNote}
								</p>
							</div>
						) : null}
					</div>
				</div>
			</div>

			{canRemove ? (
				<div className="school-track-card__actions">
					<button type="button" className="btn btn--ghost btn--sm" onClick={onRemove}>
						Remove
					</button>
				</div>
			) : null}
		</li>
	);
}

/* ========== Visa stage: invoice and processing ========== */

export function PortalVisa() {
	return (
		<ChapterGate chapter="visa">
			<VisaHubInner />
		</ChapterGate>
	);
}

function VisaHubInner() {
	const { application, schoolApplications, fees, syncFromServer, syncTick } = useAppState();
	const inv = application.visaInvoice;
	const [payPhase, setPayPhase] = useState<"idle" | "loading">("idle");
	const accepted = schoolApplications.filter((s) => s.outcome === "Admitted");
	const hasAdmit = hasAcceptedOffer(schoolApplications);
	// The school the visa is for: the accepted offer, else the sole admission.
	const chosen = schoolApplications.find((s) => s.id === application.acceptedSchoolId) ?? (accepted.length === 1 ? accepted[0] : null);
	const { toast } = useNotifier();

	const [serverInv, setServerInv] = useState<ApiInvoice | null>(null);

	const serverPaid = serverInv?.status === "paid";
	const paid = Boolean(serverPaid);

	const isConsented = (application.visaConsent?.decision ?? null) === "continue";
	const isAwaitingSpecialist =
		isConsented &&
		(application.pendingHandoff?.stage === "visa_processing" ||
			application.visaStatus === "awaiting_handler");
	const hasIssuedInvoice = Boolean(
		serverInv &&
			(serverInv.status === "issued" ||
				serverInv.status === "partial" ||
				serverInv.status === "paid"),
	);
	const isPendingInvoice = isConsented && !isAwaitingSpecialist && !hasIssuedInvoice && !paid;

	// The visa invoice for the current application. `/me/invoices` is already
	// scoped to it server-side. Refetched on every AppState sync, which the
	// `invoice.issued` / `invoice.paid` / `visa.*` SSE events trigger.
	useEffect(() => {
		let cancelled = false;
		meApi
			.invoices({ type: "visa" })
			.then(({ invoices }) => {
				if (cancelled) return;
				setServerInv(invoices.find((i) => i.status !== "void") ?? null);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [application.applicationId, syncTick]);

	// While waiting on ops (specialist assignment or invoice issuance) the
	// update arrives over SSE; a slow interval is only the fallback.
	useEffect(() => {
		if (!isAwaitingSpecialist && !isPendingInvoice) return;
		const timer = window.setInterval(() => void syncFromServer(), 20_000);
		return () => window.clearInterval(timer);
	}, [isAwaitingSpecialist, isPendingInvoice, syncFromServer]);

	const serverLines: InvoiceLine[] = (serverInv?.lines ?? []).map((l) => ({
		id: l.id,
		label: l.label,
		detail: l.detail ?? "",
		amount: usdFromCents(l.amountCents),
	}));

	const cardInvoice: StageInvoice = serverInv
		? {
				...inv,
				id: serverInv.invoiceNumber,
				status: serverPaid
					? "paid"
					: serverInv.status === "proforma"
						? "estimated"
						: serverInv.status === "void"
							? "none"
							: "raised",
				amount: usdFromCents(serverInv.balanceCents > 0 ? serverInv.balanceCents : serverInv.subtotalCents),
				actualAmount: usdFromCents(serverInv.balanceCents > 0 ? serverInv.balanceCents : serverInv.subtotalCents),
				description: `Visa processing fee · ${serverInv.invoiceNumber}`,
				estimateLines: serverLines,
				actualLines: serverLines,
			}
		: {
				...inv,
				id: null,
				status: "estimated" as const,
				// The destination's visa and biometrics fees from the catalogue, paid on your behalf at cost.
				amount: usdFromCents(visaCostsCentsFor(fees?.catalogue, application.destinationId)),
				actualAmount: usdFromCents(visaCostsCentsFor(fees?.catalogue, application.destinationId)),
				estimatedAmount: usdFromCents(visaCostsCentsFor(fees?.catalogue, application.destinationId)),
				estimateLines: [],
				actualLines: [],
				description: "Visa costs — paid on your behalf, at cost · being prepared",
			};
	const amount = cardInvoice.amount || usdFromCents(visaCostsCentsFor(fees?.catalogue, application.destinationId));

	async function pay() {
		setPayPhase("loading");
		try {
			let backend = serverInv && serverInv.balanceCents > 0 ? serverInv : null;
			if (!backend) {
				const { invoices } = await meApi.invoices();
				backend = invoices.find((i) => i.type === "visa" && i.balanceCents > 0) ?? null;
			}
			if (!backend) {
				toast.error(
					"Your visa invoice has not been issued on the server yet. Ask your consultant to raise it.",
				);
				return;
			}
			if (backend.status === "proforma") {
				toast.error(
					"Cannot pay a proforma invoice before it is reviewed and issued by staff.",
				);
				return;
			}
			// Real Paystack checkout — redirect to hosted checkout
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

	if (payPhase === "loading") {
		return (
			<div className="loading-overlay">
				<div className="spinner" aria-hidden />
				<p className="mono">Contacting payment provider…</p>
				<p className="muted">Charging {formatDualCurrency(amount)} visa fee</p>
			</div>
		);
	}

	const bandTitle = !hasAdmit
		? "Waiting on an offer"
		: !isConsented && !paid
			? "Your decision is needed"
			: isAwaitingSpecialist
				? "Assigning your visa officer"
				: isPendingInvoice
					? "Preparing your visa invoice"
					: paid
						? "Visa fee settled"
						: "Pay the visa fee";
	const bandDetail = !hasAdmit
		? "Pay the application invoice on Schools, then wait for tracking to reach Decision Reached."
		: !isConsented && !paid
			? "You've been admitted. Continue with visa processing so we can assign your visa officer and raise the visa fee."
			: isAwaitingSpecialist
				? "Consent recorded — operations is matching your case to a specialist. This page updates automatically."
				: isPendingInvoice
					? `${application.assignedStaffName ? `${application.assignedStaffName} is` : "Your consultant is"} finalising the fee — payment unlocks here the moment it's issued.`
					: paid
						? "Your visa case opens on the tracking page — your officer updates it there."
						: `Visa processing starts once this invoice is paid · ${formatDualCurrency(amount)}`;

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter IV · Visa</p>
					<h1 className="page-title mt-1">Visa</h1>
					<p className="lead mt-2">
						{chosen
							? [chosen.universityName ?? getUniversity(chosen.universityId)?.name, chosen.programName ?? getProgram(chosen.programId)?.name, chosen.intake]
									.filter(Boolean)
									.join(" · ")
							: "Application & processing — the visa chapter."}
					</p>
				</div>
			</header>

			{/* the live state */}
			<div className="journey-now mt-4">
				<div>
					<p className="eyebrow">Current update</p>
					<p className="display journey-now__title" style={{ fontSize: "1.15rem" }}>
						{bandTitle}
					</p>
					<p className="journey-now__detail">{bandDetail}</p>
				</div>
				{!hasAdmit ? (
					<Button to="/portal/application" variant="inverted" arrow>
						Back to applications
					</Button>
				) : paid ? (
					<Button to="/portal/visa/tracking" variant="inverted" arrow>
						Open visa tracking
					</Button>
				) : hasIssuedInvoice && serverInv && serverInv.balanceCents > 0 ? (
					<Button variant="inverted" onClick={pay} arrow>
						Pay {formatMoney(serverInv.balanceCents, "ghs")}
					</Button>
				) : null}
			</div>

			<div className="psplit mt-4">
				<div>
					{hasAdmit && !paid && !isConsented && (
						<div className="mb-4">
							<StageConsentCard
								stage="visa"
								currentDecision={application.visaConsent?.decision ?? null}
								title="Continue with visa processing?"
								lead="You've been admitted. Continue with your visa so we can assign your visa officer and raise the visa fee."
								continueDetail="A visa officer will be assigned and the visa fee will be raised. You'll pay it before your visa case opens."
								holdDetail="You can come back and continue with visa processing whenever you're ready. Nothing is sent to our team until you continue."
								optOutDetail="Visa processing will be cancelled. You won't be able to use travel assistance without a visa."
								onDecided={() => void syncFromServer()}
							/>
						</div>
					)}

					{hasAdmit && !chosen ? (
						<div className="sharp-card mb-4">
							<p className="eyebrow">Your offers</p>
							<ul className="portal-snapshot mt-2">
								{accepted.map((s) => (
									<li key={s.id}>
										<span>{getUniversity(s.universityId)?.name}</span>
										<strong>
											{getProgram(s.programId)?.name} · {trackLabel(s)}
										</strong>
									</li>
								))}
							</ul>
							{accepted.length > 1 && (
								<p className="muted mt-3" style={{ fontSize: "0.85rem" }}>
									You hold {accepted.length} offers. Accept the one you are going with on{" "}
									<Link to="/portal/application">Applications</Link> — your visa is prepared for that school.
								</p>
							)}
						</div>
					) : null}

					{isAwaitingSpecialist ? (
						<div className="sharp-card">
							<span className="portal-pill">Awaiting visa officer</span>
							<h3 className="display mt-2" style={{ fontSize: "1.25rem" }}>
								Matching your case with a consultant
							</h3>
							<p className="muted mt-2" style={{ lineHeight: 1.6 }}>
								Your consent to proceed has been received. Our operations team is assigning your
								dedicated visa officer — once assigned, they'll prepare and issue your official visa
								application fee invoice.
							</p>
							<p className="muted mt-3" style={{ fontSize: "0.8rem" }}>
								Nothing needed from you — this page updates in real time.
							</p>
						</div>
					) : isPendingInvoice ? (
						<div className="sharp-card">
							<span className="portal-pill">Invoice in review</span>
							<h3 className="display mt-2" style={{ fontSize: "1.25rem" }}>
								Your visa fee invoice is being finalised
							</h3>
							<p className="muted mt-2" style={{ lineHeight: 1.6 }}>
								{application.assignedStaffName
									? `${application.assignedStaffName} has been assigned as your consultant.`
									: "Your consultant has been assigned."}{" "}
								{serverInv?.invoiceNumber
									? `Draft #${serverInv.invoiceNumber} is being reviewed.`
									: "They are preparing and reviewing your official visa fee invoice."}{" "}
								Payment unlocks automatically here as soon as it's issued.
							</p>
						</div>
					) : (hasIssuedInvoice || paid) && serverInv ? (
						<section className="sharp-card">
							<InvoiceCard
								title="Visa invoice"
								invoice={serverInv}
								actions={
									serverInv.status === "paid" ? (
										<Button variant="secondary" onClick={() => downloadReceipt(serverInv, "Visa invoice")}>
											Download receipt
										</Button>
									) : serverInv.balanceCents > 0 ? (
										<Button onClick={pay} arrow>
											Pay {formatMoney(serverInv.balanceCents, "ghs")}
										</Button>
									) : null
								}
								hint={paid ? undefined : "Visa processing starts once this invoice is paid."}
							/>
						</section>
					) : null}

					<div className="row mt-4" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
						<Button to="/portal/application" variant="secondary">
							← Applications
						</Button>
						<Button to="/portal/financial" variant="ghost">
							View all invoices
						</Button>
					</div>
				</div>

				{/* the rail — who and where the case stands */}
				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow">Your visa officer</p>
						{application.assignedStaffName ? (
							<>
								<p style={{ fontWeight: 700, marginTop: "0.5rem" }}>{application.assignedStaffName}</p>
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
									Visa processing
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
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem", lineHeight: 1.6 }}>
								Assigned when you continue with visa processing.
							</p>
						)}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">The case file</p>
						<div style={{ marginTop: "0.4rem" }}>
							{chosen ? (
								<div className="pkv">
									<span className="pkv__k">Visa for</span>
									<span className="pkv__v">
										{chosen.universityName ?? getUniversity(chosen.universityId)?.name}
									</span>
								</div>
							) : null}
							<div className="pkv">
								<span className="pkv__k">Visa fee</span>
								<span className="pkv__v">
									{paid ? "Paid ✓" : hasIssuedInvoice ? "Issued — due" : "Not yet"}
								</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Officer</span>
								<span className="pkv__v muted">
									{application.assignedStaffName ?? "Awaiting assignment"}
								</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Tracking</span>
								<span className="pkv__v muted">{paid ? "Open" : "Opens when the fee clears"}</span>
							</div>
						</div>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">After the visa</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.6 }}>
							Once approved, <strong style={{ color: "var(--foreground)" }}>Chapter V · Departure</strong>{" "}
							opens: the pre-departure milestone, then your ticket. Your letter and visa documents
							release with the milestone.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

export function PortalVisaTracking() {
	return (
		<ChapterGate chapter="visa">
			<VisaTrackingInner />
		</ChapterGate>
	);
}

const VISA_UPDATE_BY_STAGE: Record<string, string> = {
	locked: "Visa case not started yet. Settle the visa invoice to open it.",
	awaiting_handler: "Visa payment received. We are assigning your consultant — you'll be notified once your consultant is confirmed.",
	pending: "Visa payment received — your consultant has opened your visa case.",
	biometrics: "Visa case in progress. Attend your biometrics / appointment when scheduled.",
	decision: "Visa case in progress. Awaiting the authority's decision.",
	complete: "Visa approved. Your visa is complete — continue to travel assistance.",
};

function VisaTrackingInner() {
	const { application } = useAppState();
	const nav = useNavigate();
	// Fetch the real server invoice so the paid check doesn't rely solely on
	// the local `application.visaInvoice.status` (which is only synced when
	// the `visaInvoicePaid` flag is set on the application row). The invoice
	// table is the source of truth — see VisaHubInner for the same pattern.
	const [serverInv, setServerInv] = useState<{ status: string } | null>(null);
	useEffect(() => {
		let cancelled = false;
		meApi
			.invoices()
			.then(({ invoices }) => {
				if (cancelled) return;
				const visa = invoices.find((i) => i.type === "visa");
				if (visa) setServerInv({ status: visa.status });
			})
			.catch(() => {});
		return () => { cancelled = true; };
	}, []);
	const serverPaid = serverInv?.status === "paid";
	const paid = application.visaInvoice.status === "paid" || serverPaid;
	const vd = application.visaDetails ?? {};
	const day = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : null;
	const when = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
	const refusedDetail =
		application.visaStatus === "decision" && application.visaOutcome === "refused" ? "Refused — your consultant will advise" : "Awaiting the authority's decision";
	const lodgedDetail = [vd.visaType, vd.reference ? `Ref ${vd.reference}` : null, vd.submittedAt ? `Submitted ${day(vd.submittedAt)}` : null]
		.filter(Boolean)
		.join(" · ");
	const appointmentDetail = vd.biometricsAt
		? `Biometrics given ${day(vd.biometricsAt)}`
		: vd.appointmentAt
			? `${when(vd.appointmentAt)}${vd.appointmentCentre ? ` · ${vd.appointmentCentre}` : ""} — bring your passport and the documents your consultant listed`
			: "Your consultant will tell you when and where";
	const decisionDetail = vd.decidedAt && application.visaStatus === "complete" ? `Approved ${day(vd.decidedAt)}` : refusedDetail;
	const completeDetail =
		vd.validFrom || vd.validTo
			? `Valid ${day(vd.validFrom) ?? "…"} → ${day(vd.validTo) ?? "…"}${vd.collectedAt ? ` · collected ${day(vd.collectedAt)}` : ""}`
			: "Passport back with the visa — then Departure";
	const steps = [
		{ id: "pending", label: "Application lodged", detail: lodgedDetail || "Your consultant opens your file and lodges the application" },
		{ id: "biometrics", label: "Appointment & biometrics", detail: appointmentDetail },
		{ id: "decision", label: "Authority decision", detail: decisionDetail },
		{ id: "complete", label: "Visa granted", detail: completeDetail },
	] as const;
	// The appointment is the one date the client must not miss.
	const [now] = useState(() => Date.now());
	const appointmentSoon =
		vd.appointmentAt && !vd.biometricsAt && new Date(vd.appointmentAt).getTime() > now - 6 * 3_600_000
			? new Date(vd.appointmentAt)
			: null;
	const order = ["locked", "awaiting_handler", "pending", "biometrics", "decision", "complete"] as const;
	const currentIndex = order.indexOf(application.visaStatus);
	const assigningHandler = application.visaStatus === "awaiting_handler";
	const refused = application.visaStatus === "decision" && application.visaOutcome === "refused";

	if (!paid) {
		return (
			<div className="portal-page">
				<header className="portal-page__header">
					<p className="eyebrow">Dashboard · Visa</p>
					<h1 className="page-title mt-1">Visa tracking</h1>
				</header>
				<div className="sharp-card">
					<p className="display" style={{ fontSize: "1.2rem" }}>
						Visa tracking is not open yet
					</p>
					<p className="muted mt-2">Pay your visa invoice before visa processing can begin.</p>
					<Button to="/portal/visa" className="mt-3" arrow>
						View visa invoice
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter IV · Visa</p>
					<h1 className="page-title mt-1">Visa tracking</h1>
					<p className="lead mt-2">Follow your visa case updates from your visa officer.</p>
				</div>
			</header>

			{/* the live state */}
			<div className="journey-now mt-4">
				<div>
					<p className="eyebrow">Current update</p>
					<p className="display journey-now__title" style={{ fontSize: "1.15rem" }}>
						{refused
							? "The visa authority refused this application"
							: (VISA_UPDATE_BY_STAGE[application.visaStatus] ?? "Visa case updating…")}
					</p>
					{refused ? (
						<p className="journey-now__detail">
							This is not the end of the road. Your consultant will review the refusal reasons with
							you and, where it makes sense, reopen your case for a reapplication.
						</p>
					) : null}
				</div>
				{application.visaStatus === "complete" ? (
					<Button variant="inverted" arrow onClick={() => nav("/portal/pre-departure")}>
						Continue to Departure
					</Button>
				) : (
					<Button to="/portal/home" variant="inverted">
						Message your visa officer →
					</Button>
				)}
			</div>

			{/* The refusal reason and any note for the client arrive as history
			    lines; the legacy counselor note shows only when there are none. */}
			{application.visaCounselorNote && !application.comments.some(isVisaUpdate) && (
				<div className="sharp-card mt-4">
					<p className="eyebrow">Message from your consultant</p>
					<p style={{ fontSize: "0.95rem", lineHeight: 1.6, marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
						{application.visaCounselorNote}
					</p>
				</div>
			)}

			{/* the one date the client must not miss gets the heavy frame */}
			{appointmentSoon && (
				<div className="sharp-card mt-4" style={{ border: "2px solid var(--foreground)" }}>
					<p className="eyebrow">Your visa appointment</p>
					<p className="display mt-1" style={{ fontSize: "1.25rem" }}>
						{when(vd.appointmentAt)}
					</p>
					{vd.appointmentCentre ? <p className="mt-1">{vd.appointmentCentre}</p> : null}
					<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
						Arrive early with your passport, the appointment confirmation and every document in your
						visa list below.
					</p>
				</div>
			)}

			{assigningHandler && (
				<div className="sharp-card mt-4">
					<span className="portal-pill">Assigning your visa officer</span>
					<p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.6, marginTop: "0.6rem" }}>
						Your payment is confirmed. Century NIT is matching your case to a visa officer — you'll
						get a notification with their details once your case is open.
					</p>
				</div>
			)}

			<div className="psplit mt-4">
				<div>
					{/* the spine */}
					<ol className="visa-track">
						{steps.map((step, index) => {
							const stepIndex = order.indexOf(step.id);
							const done = currentIndex >= stepIndex && application.visaStatus !== "locked";
							const current = application.visaStatus === step.id;
							return (
								<li
									key={step.id}
									className={`visa-track__item${done ? " visa-track__item--done" : ""}${current ? " visa-track__item--current" : ""}`}
								>
									<span className="visa-track__dot">{done ? "✓" : index + 1}</span>
									<div>
										<strong>
											{step.label}
											{current ? (
												<span className="mono muted" style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 400 }}>
													{" "}· now
												</span>
											) : null}
										</strong>
										<p className="muted">{step.detail}</p>
									</div>
								</li>
							);
						})}
					</ol>

					{/* the checklist — the action item is the underlined one */}
					{application.visaDocumentChecklist.length > 0 && (
						<div className="sharp-card mt-4">
							<div className="between">
								<p className="eyebrow">Your visa documents</p>
								<span className="mono muted" style={{ fontSize: "0.75rem" }}>
									{application.visaDocumentChecklist.filter((x) => x.status === "VERIFIED").length}/
									{application.visaDocumentChecklist.length} verified
								</span>
							</div>
							<ul className="vdocs">
								{application.visaDocumentChecklist.map((x) => (
									<li key={x.id}>
										<span title={x.hint}>{x.name}</span>
										<span
											className={`vdocs__st${x.status === "VERIFIED" ? " vdocs__st--ok" : x.status === "REJECTED" ? " vdocs__st--fix" : " vdocs__st--wait"}`}
										>
											{x.status === "VERIFIED"
												? "Verified"
												: x.status === "UPLOADED"
													? "Under review"
													: x.status === "REJECTED"
														? "Re-upload needed"
														: "Upload"}
										</span>
									</li>
								))}
							</ul>
							<div className="row mt-3">
								<Button to="/portal/documents" variant="secondary" arrow>
									Upload in your vault
								</Button>
							</div>
						</div>
					)}

					<div className="sharp-card mt-4">
						<ConsultantUpdates
							comments={application.comments}
							filter={isVisaUpdate}
							title="Your visa case, as recorded"
						/>
					</div>
				</div>

				{/* the rail */}
				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow">Your visa officer</p>
						{application.assignedStaffName ? (
							<>
								<p style={{ fontWeight: 700, marginTop: "0.5rem" }}>{application.assignedStaffName}</p>
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
									Visa processing
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
								Being assigned — you'll be notified once your case is open.
							</p>
						)}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">The case file</p>
						<div style={{ marginTop: "0.4rem" }}>
							<div className="pkv">
								<span className="pkv__k">Visa fee</span>
								<span className="pkv__v">Paid ✓</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Lodged</span>
								<span className="pkv__v muted">
									{vd.submittedAt ? day(vd.submittedAt) : "Not yet"}
									{vd.reference ? ` · ${vd.reference}` : ""}
								</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Biometrics</span>
								<span className="pkv__v muted">
									{vd.biometricsAt ? `${day(vd.biometricsAt)} ✓` : vd.appointmentAt ? when(vd.appointmentAt) : "Not yet"}
								</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Decision</span>
								<span className="pkv__v muted">
									{application.visaStatus === "complete"
										? `Approved ${vd.decidedAt ? day(vd.decidedAt) : ""} ✓`
										: refused
											? "Refused"
											: "Pending"}
								</span>
							</div>
						</div>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">After the visa</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.6 }}>
							{application.visaStatus === "complete"
								? "Chapter V · Departure is open — the pre-departure milestone, then your ticket."
								: refused
									? "Departure stays closed while the refusal is reviewed. Your consultant will let you know the next step."
									: "Once approved, Chapter V · Departure opens: the pre-departure milestone, then your ticket. Your letter and visa documents release with the milestone."}
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ========== Complete ========== */

export function PortalComplete() {
	return (
		<ChapterGate chapter="complete">
			<CompleteInner />
		</ChapterGate>
	);
}

function CompleteInner() {
	const { application, booking, schoolApplications } = useAppState();
	const [paidInvoices, setPaidInvoices] = useState<ApiInvoice[]>([]);
	const [officialDocs, setOfficialDocs] = useState<ApplicantDocument[]>([]);
	useEffect(() => {
		let alive = true;
		meApi
			.invoices()
			.then((r) => {
				if (alive) setPaidInvoices(r.invoices.filter((i) => i.status === "paid"));
			})
			.catch(() => {});
		documentsApi
			.list()
			.then((r) => {
				if (alive) setOfficialDocs(r.documents);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	const finished =
		Boolean(application.completedAt) ||
		(Boolean(application.agencySettledAt) &&
			application.visaStatus === "complete" &&
			application.travelInvoicePaid);
	const accepted = schoolApplications.filter((s) => s.outcome === "Admitted");
	const chosen = schoolApplications.find((s) => s.id === application.acceptedSchoolId) ?? (accepted.length === 1 ? accepted[0] : null);
	const fund = SCHOOL_FUNDING_TRACKS.find((f) => f.id === application.schoolFundingTrack);
	const deg = SCHOOL_DEGREE_LEVELS.find((d) => d.id === application.schoolDegreeLevel);

	if (!finished) {
		return (
			<div className="portal-page">
				<header className="portal-page__header">
					<div>
						<p className="eyebrow">Complete · last step</p>
						<h1 className="page-title mt-1">Almost there</h1>
						<p className="lead mt-2">
							Finish visa, payment plan, and agency settlement. Completion unlocks last.
						</p>
					</div>
				</header>
				<div className="row">
					<Button to="/portal/visa" arrow>
						Visa
					</Button>
					<Button to="/portal/pre-departure" variant="secondary">
						Travel assistance
					</Button>
					<Button to="/portal/payment-execution" variant="secondary">
						Service fee
					</Button>
				</div>
			</div>
		);
	}

	const day = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }).toUpperCase() : "—";

	const vd = application.visaDetails ?? {};
	const flight = application.travelAssistance?.booking ?? application.travelAssistance?.flight ?? null;
	const flightLine = [flight?.carrier, flight?.flightNumber].filter(Boolean).join(" ") || null;
	const journeyStart = booking.paidAt ?? booking.outcomeAt;
	const spanDays =
		journeyStart && application.completedAt
			? Math.max(1, Math.round((new Date(application.completedAt).getTime() - new Date(journeyStart).getTime()) / 86_400_000))
			: null;
	const spanLabel = spanDays ? (spanDays >= 60 ? `${Math.round(spanDays / 30.4)} months` : `${spanDays} days`) : null;

	const recap: { numeral: string; name: string; fact: string; when: string }[] = [
		{ numeral: "I", name: "Consultation", fact: [booking.consultationType ? `${booking.consultationType} session` : "Session held", booking.confirmationId].filter(Boolean).join(" · "), when: day(journeyStart) },
		{ numeral: "II", name: "Enrolment", fact: [fund?.name, deg?.name, "deposit paid"].filter(Boolean).join(" · "), when: day(application.packageChosenAt) },
		{ numeral: "III", name: "Applications", fact: `${schoolApplications.length} targeted · ${accepted.length} admitted${chosen ? ` · ${chosen.universityName ?? getUniversity(chosen.universityId)?.name} accepted` : ""}`, when: day(application.offerAcceptedAt ?? application.schoolSelectionDoneAt) },
		{ numeral: "IV", name: "Visa", fact: vd.validFrom || vd.validTo ? `Granted · ${day(vd.validFrom)} → ${day(vd.validTo)}` : "Granted", when: day(vd.decidedAt) },
		{ numeral: "V", name: "Departure", fact: [flightLine ? `${flightLine} booked` : "Travel settled", "milestone paid", "checklist done"].join(" · "), when: day(application.agencySettledAt) },
		{ numeral: "VI", name: "Complete", fact: "File closed — post-arrival support open", when: day(application.completedAt) },
	];

	return (
		<div className="portal-page">
			{/* the closed file */}
			<div className="jclosed">
				<span className="jclosed__seal">VI</span>
				<p className="eyebrow">Chapter VI · Complete{application.applicationId ? ` · case ${application.applicationId}` : ""}</p>
				<h1 className="jclosed__title">File closed. You're enrolled.</h1>
				<p className="jclosed__lead">
					Every chapter done, every invoice settled, your documents released. Safe travels
					{booking.assessment.firstName ? `, ${booking.assessment.firstName}` : ""}.
				</p>
				<div className="jclosed__meta">
					{chosen ? (
						<div className="jclosed__m">
							<p className="jclosed__k">Destination</p>
							<p className="jclosed__v">{chosen.universityName ?? getUniversity(chosen.universityId)?.name}</p>
						</div>
					) : null}
					{chosen ? (
						<div className="jclosed__m">
							<p className="jclosed__k">Programme</p>
							<p className="jclosed__v">{chosen.programName ?? getProgram(chosen.programId)?.name}</p>
						</div>
					) : null}
					{flightLine ? (
						<div className="jclosed__m">
							<p className="jclosed__k">Flight</p>
							<p className="jclosed__v">{flightLine}{flight?.departAt ? ` · ${day(flight.departAt)}` : ""}</p>
						</div>
					) : null}
					{spanLabel ? (
						<div className="jclosed__m">
							<p className="jclosed__k">Journey</p>
							<p className="jclosed__v">{spanLabel}</p>
						</div>
					) : null}
				</div>
			</div>

			<div className="psplit mt-6">
				<div>
					{/* the journey, on record */}
					<div className="psec">
						<span className="psec__title">The whole journey, on record</span>
						<span className="psec__hint">6 of 6 chapters</span>
					</div>
					<div className="recap">
						{recap.map((r) => (
							<div key={r.numeral} className="recap__row">
								<span className="recap__seal">{r.numeral}</span>
								<span className="recap__name">{r.name}</span>
								<span className="recap__fact">{r.fact}</span>
								<span className="recap__when">{r.when}</span>
							</div>
						))}
					</div>

					{/* money, in full — the real invoices */}
					<div className="psec">
						<span className="psec__title">Money, in full</span>
						<span className="psec__hint">{paidInvoices.length} receipt{paidInvoices.length === 1 ? "" : "s"}</span>
					</div>
					<div className="sharp-card" style={{ padding: "1.25rem 1.25rem 0.75rem" }}>
						{paidInvoices.length === 0 ? (
							<p className="mono muted" style={{ fontSize: "0.8rem" }}>NO PAID INVOICES ON RECORD</p>
						) : (
							<>
								{paidInvoices.map((i) => (
									<div key={i.id} className="pkv">
										<span className="pkv__k">{INVOICE_TYPE_LABELS[i.type] ?? i.type}</span>
										<span className="pkv__v">
											{formatMoney(i.subtotalCents - i.balanceCents, "ghs")} ·{" "}
											<button type="button" className="jlink" onClick={() => void downloadReceipt(i, INVOICE_TYPE_LABELS[i.type] ?? i.type)}>
												receipt
											</button>
										</span>
									</div>
								))}
								<div className="pkv" style={{ borderTop: "1.5px solid var(--border)", paddingTop: "0.6rem", marginTop: "0.3rem" }}>
									<span className="pkv__k" style={{ color: "var(--foreground)", fontWeight: 700 }}>Total</span>
									<span className="pkv__v"><strong>{formatMoney(paidInvoices.reduce((n, i) => n + i.subtotalCents - i.balanceCents, 0), "ghs")}</strong> · receipts in your vault</span>
								</div>
							</>
						)}
					</div>

					{/* what stays open */}
					<div className="psec">
						<span className="psec__title">What stays open</span>
						<span className="psec__hint">post-arrival</span>
					</div>
					<div className="sharp-card">
						<ul style={{ listStyle: "none", padding: 0, fontSize: "var(--text-sm)", lineHeight: 1.9, margin: 0 }}>
							<li style={{ display: "flex", gap: "0.7rem" }}><span className="mono">→</span><span><strong>Check in when you land</strong> — message your officer through the portal chat; we confirm your arrival with the school.</span></li>
							<li style={{ display: "flex", gap: "0.7rem" }}><span className="mono">→</span><span><strong>Enrolment week</strong> — report by {day(application.departureDetails?.reportBy) !== "—" ? day(application.departureDetails?.reportBy) : "your school's date"}. Your officer watches for issues in the first month.</span></li>
							<li style={{ display: "flex", gap: "0.7rem" }}><span className="mono">→</span><span><strong>Your record stays</strong> — receipts, letters and the vault remain available here. Come back for a transcript request or a reference any time.</span></li>
						</ul>
					</div>
				</div>

				{/* the rail — destination, released documents, the people */}
				<div className="prail">
					{chosen ? (
						<div className="sharp-card">
							<p className="eyebrow">Your destination</p>
							<p style={{ fontWeight: 700, fontSize: "1.15rem", marginTop: "0.4rem" }}>
								{chosen.universityName ?? getUniversity(chosen.universityId)?.name}
							</p>
							<p className="mono muted" style={{ fontSize: "0.65rem", marginTop: "0.2rem" }}>
								{(chosen.programName ?? getProgram(chosen.programId)?.name ?? "").toUpperCase()} · {(chosen.intake ?? "").toUpperCase()}
							</p>
							<div className="pkv" style={{ marginTop: "0.7rem" }}>
								<span className="pkv__k">Offer accepted</span>
								<span className="pkv__v">{day(application.offerAcceptedAt)}</span>
							</div>
							{accepted.length > 1 && (
								<div className="pkv">
									<span className="pkv__k">Also admitted</span>
									<span className="pkv__v">{accepted.filter((s) => s.id !== chosen.id).map((s) => s.universityName ?? getUniversity(s.universityId)?.name).join(", ")}</span>
								</div>
							)}
							{vd.validFrom || vd.validTo ? (
								<div className="pkv">
									<span className="pkv__k">Visa</span>
									<span className="pkv__v">{day(vd.validFrom)} → {day(vd.validTo)}</span>
								</div>
							) : null}
						</div>
					) : null}

					<OfficialDocuments
						rows={officialRows({ schools: schoolApplications, docs: officialDocs })}
						released={documentsReleasedFor(application)}
						holdReason={documentHoldReasonFor(application)}
					/>

					<div className="sharp-card">
						<p className="eyebrow">The people on your file</p>
						<div style={{ marginTop: "0.4rem" }}>
							<div className="pkv"><span className="pkv__k">Consultant</span><span className="pkv__v">{booking.consultantName ?? application.assignedStaffName ?? "—"}</span></div>
							{application.travelAssistance?.assignedOpsUserName ? (
								<div className="pkv"><span className="pkv__k">Travel officer</span><span className="pkv__v">{application.travelAssistance.assignedOpsUserName}</span></div>
							) : null}
						</div>
					</div>

					<Button to="/portal/journey" variant="secondary">Open the journey map</Button>
					<Button to="/portal/home" variant="ghost">Back to home</Button>
				</div>
			</div>
		</div>
	);
}

/**
 * Paystack redirects the browser back to `/portal/pay?invoice=…&paystack=1&reference=…`
 * after the hosted checkout. This route verifies the transaction server-side,
 * then re-syncs the authoritative invoice/application state from the API
 * before routing to the right stage page.
 */
export function PortalPayCallback() {
	const { payApplicationInvoice, syncFromServer } = useAppState();
	const { toast } = useNotifier();
	const nav = useNavigate();
	const [failed, setFailed] = useState(false);
	const startedRef = useRef(false);

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;
		const params = new URLSearchParams(window.location.search);
		const invoiceId = params.get("invoice");
		const reference = params.get("reference");
		let cancelled = false;
		(async () => {
			try {
				if (params.get("paystack") !== "1" || !reference) {
					nav("/portal/application", { replace: true });
					return;
				}
				
				if (params.get("booking") === "consultation") {
					await bookingsApi.verifyPayment(reference);
					if (cancelled) return;

					// Force a sync to get the new booking into AppState
					await syncFromServer();
					if (cancelled) return;

					nav("/portal/appointments", { replace: true });
					toast.success("Payment confirmed. Your booking is now complete.");
					return;
				}

				// Agency service-fee payment (Stage IV). There is no invoice id
				// in the URL — the server resolved it from the session. Re-sync
				// the authoritative agency invoice state, which syncFromServer
				// maps onto agencyPaid / agencyDepositPaid / agencyStageIndex /
				// agencySettledAt, then route back to the Financial page.
				if (params.get("type") === "agency" || params.get("booking") === "agency") {
					await syncFromServer();
					if (cancelled) return;
					if (params.get("deposit") === "1") {
						const journey = await meApi.journey().catch(() => null);
						const to = journey?.portalStage === "school_select" ? "/portal/application" : "/portal/awaiting-handler";
						nav(to, { replace: true });
						toast.success("Deposit confirmed. Your consultant is being assigned.");
						return;
					}
					nav("/portal/financial", { replace: true });
					toast.success("Payment confirmed. Your service fee has been updated.");
					return;
				}

				if (!invoiceId) {
					nav("/portal/application", { replace: true });
					return;
				}

				const { invoice } = await meApi.paystackVerify(invoiceId, reference);
				if (cancelled) return;

				// Always re-sync so a partial (deposit/installment) payment also
				// updates the portal immediately instead of waiting for the 30s poll.
				await syncFromServer();
				if (cancelled) return;

				const settled = invoice.balanceCents === 0;
				// Only the application invoice unlocks the application stage
				// locally; other invoice types (agency/visa/travel) are handled by
				// the sync above. The 30s poll confirms with server truth.
				if (settled && invoice.type === "application") {
					payApplicationInvoice();
				}

				if (invoice.type === "agency") {
					// 10% commitment deposit or Stage IV post-visa settlement?
					const journey = await meApi.journey().catch(() => null);
					const isDeposit =
						params.get("deposit") === "1" ||
						!settled ||
						journey?.portalStage === "awaiting_handler" ||
						journey?.portalStage === "school_select" ||
						journey?.portalStage === "school_package";

					if (isDeposit) {
						const to = journey?.portalStage === "school_select" ? "/portal/application" : "/portal/awaiting-handler";
						nav(to, { replace: true });
						toast.success("10% deposit confirmed! Your application is underway.");
						return;
					}

					nav("/portal/financial", { replace: true });
					toast.success(settled ? "Payment confirmed. Your service fee is settled." : "Payment received.");
					return;
				}

				nav(
					invoice.type === "visa"
						? "/portal/visa"
						: invoice.type === "travel"
							? "/portal/pre-departure"
							: "/portal/application",
					{ replace: true },
				);
				if (settled) toast.success("Payment confirmed. Your stage is now unlocked.");
				else toast.success("Payment confirmed. Your payment has been received.");
			} catch (err) {
				if (cancelled) return;
				setFailed(true);
				toast.error(
					err instanceof ApiError ? err.message : "Could not confirm the payment.",
				);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [nav, payApplicationInvoice, syncFromServer, toast]);

	if (failed) {
		return (
			<div className="portal-page">
				<div className="sharp-card">
					<p className="eyebrow">Payment confirmation</p>
					<h1 className="page-title mt-1">Could not confirm the payment</h1>
					<p className="muted mt-2">
						If you were charged, the payment will still be recorded via the webhook.
						Go back and try again.
					</p>
					<div className="row mt-4">
						<Button to="/portal/application" arrow>
							Back to dashboard
						</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="portal-page">
			<div className="loading-overlay">
				<div className="spinner" aria-hidden />
				<p className="mono">Confirming payment…</p>
			</div>
		</div>
	);
}

/* ========== Redirects / legacy ========== */

export function PortalIndex() {
	return <Navigate to="/portal/home" replace />;
}

export function PortalApplication() {
	return <Navigate to="/portal/application" replace />;
}

export function PortalTracking() {
	return <Navigate to="/portal/journey" replace />;
}

export function PortalAgreement() {
	return <Navigate to="/portal/consultation" replace />;
}

export function PortalPayment() {
	return <Navigate to="/portal/application" replace />;
}

export function PortalProfile() {
	return <Navigate to="/portal/consultation" replace />;
}

export function PortalDocuments() {
	return <Navigate to="/portal/documents" replace />;
}

export function PortalSchool() {
	return <Navigate to="/portal/application" replace />;
}

export function PortalInterview() {
	return <Navigate to="/portal/application" replace />;
}
