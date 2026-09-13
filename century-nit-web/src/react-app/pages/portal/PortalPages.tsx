import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { API_PREFIX, JOURNEY_STAGE_LABELS, LookupValue, PAYMENT_PLAN_LABELS, decisionOf, type JourneyStage } from "century-nit-shared";
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
	useAppState,
	type AssessmentData,
	type AssessmentDoc,
	type BookingData,
	type EligibilityOutcome,
	type InvoiceLine,
	type SchoolApplicationTrack,
	type StageInvoice,
	FALLBACK_FEE_SCHEDULE,
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
} from "century-nit-core";
import { meApi, bookingsApi, schoolsApi, documentsApi, feesApi, packagesApi, ApiError } from "century-nit-core/api";
import type { ApiInvoice, AvailabilitySlot, ApiConsultation, ApiApplication, ServicePackage, SchoolFileKind } from "century-nit-shared";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "century-nit-shared";
import { useNotifier } from "../../components/notifier/Notifier";
import { UploadPickModal } from "../../components/portal/UploadPickModal";
import { prepareDocumentForUpload } from "../../lib/upload";



import { ChapterGate } from "./PortalLayout";
import { ConsultationAppointmentCard } from "./ConsultationAppointmentCard";

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
				<div className="card card--pad">
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
			<div className="card card--pad">
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
								background: "var(--accent, #3b82f6)",
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
			<div className="card card--pad">
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
								background: "var(--accent, #3b82f6)",
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

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter II · Enrolment</p>
					<h1 className="page-title mt-1">Enrol with Century NIT</h1>
					<p className="lead mt-2">
						One page: confirm you're enrolling, choose your package and payment plan, and pay the deposit.
						Your consultant is assigned as soon as the deposit lands.
					</p>
				</div>
			</header>

			<ol className="mt-3" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
				{enrolSteps.map((st, i) => {
					const current = !st.done && enrolSteps.slice(0, i).every((x) => x.done);
					return (
						<li key={st.label}>
							<StatusPill tone={st.done ? "done" : current ? "current" : "neutral"} dot={st.done || current}>
								{i + 1} · {st.label}
							</StatusPill>
						</li>
					);
				})}
			</ol>

			<section className="mt-4">
				<div className="card card--pad">
					<p className="eyebrow">1 · Confirm your enrolment</p>
					<div className="mt-2">
						<EnrolmentDecision />
					</div>
				</div>
			</section>

			{!confirmed && (
				<p className="muted mt-4" style={{ fontSize: "0.9rem" }}>
					Confirm above to choose your package and plan.
				</p>
			)}

			{chosen ? (
				isDepositPaid ? (
					<div className="alert alert--success mb-4" role="status">
						Package locked:{" "}
						<strong>
							{(selectedPkg?.name || SCHOOL_FUNDING_TRACKS.find((f) => f.id === application.schoolFundingTrack)?.name)} ·{" "}
							{SCHOOL_DEGREE_LEVELS.find((d) => d.id === application.schoolDegreeLevel)?.name} ·{" "}
							{application.targetSchoolCount ?? targetSchoolCount} Target Schools
						</strong>
						<span> · Deposit paid. You can now select schools.</span>
					</div>
				) : (
					<div className="alert alert--info mb-4" role="status">
						Selected Package:{" "}
						<strong>
							{(selectedPkg?.name || SCHOOL_FUNDING_TRACKS.find((f) => f.id === activeFunding)?.name)} ·{" "}
							{SCHOOL_DEGREE_LEVELS.find((d) => d.id === activeLevel)?.name} ·{" "}
							{targetSchoolCount} Target Schools
						</strong>
						<span> · You can freely adjust your package, track, and degree level below before paying the 10% deposit.</span>
					</div>
				)
			) : null}

			{confirmed && (<>
			{/* 2 · Package: funding track, level, target schools */}
			<section className="mb-5">
				<p className="eyebrow mb-2">1 · Funding track</p>
				<div className="card-grid card-grid--3">
					{packageCards.map((f) => (
						<button
							key={f.id}
							type="button"
							className={`card card--pad card--selectable school-pkg-card${activeFunding === f.id ? " card--selected" : ""}`}
							onClick={() => !isLocked && setFunding(f.id)}
							disabled={isLocked}
							aria-pressed={activeFunding === f.id}
						>
							<span className="school-pkg-card__check" aria-hidden>
								✓
							</span>
							{recommendedTrack === f.id && (
								<span
									className="portal-pill portal-pill--verified mb-1"
									style={{ fontSize: "0.72rem", alignSelf: "flex-start", fontWeight: 700 }}
								>
									★ Advisor Recommendation
								</span>
							)}
							<span className="eyebrow">{f.tagline}</span>
							<span className="school-pkg-card__name display">{f.name}</span>
							<p className="school-pkg-card__blurb muted">{f.blurb}</p>
							{f.priceCents > 0 && (
								<div className="mt-2" style={{ fontWeight: 700, fontSize: "1.05rem" }}>
									<Money usd={f.priceCents / 100} />
								</div>
							)}
						</button>
					))}
				</div>
			</section>

			{/* 2 · Degree level */}
			<section className="mb-5">
				<p className="eyebrow mb-2">2 · Degree level</p>
				<div className="degree-chip-grid">
					{SCHOOL_DEGREE_LEVELS.map((d) => (
						<button
							key={d.id}
							type="button"
							className={`degree-chip${activeLevel === d.id ? " degree-chip--selected" : ""}`}
							onClick={() => !isLocked && setLevel(d.id)}
							disabled={isLocked}
							aria-pressed={activeLevel === d.id}
						>
							<span className="degree-chip__check" aria-hidden>
								✓
							</span>
							<strong>{d.short}</strong>
							<span className="muted">{d.name}</span>
							{recommendedLevel === d.id && (
								<span style={{ fontSize: "0.68rem", color: "var(--primary, #2563eb)", fontWeight: 700, display: "block" }}>
									★ Recommended
								</span>
							)}
						</button>
					))}
				</div>
			</section>

			{/* 3 · Target school count */}
			<section className="mb-5">
				<p className="eyebrow mb-2">3 · Number of target schools</p>
				<p className="muted mb-3" style={{ fontSize: "0.9rem" }}>
					How many institutions do you plan to apply to? We prepare, review, and lodge submissions across your full target list.
				</p>
				<div className="degree-chip-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
					{[1, 2, 3, 4, 5, 6].map((count) => (
						<button
							key={count}
							type="button"
							className={`degree-chip${targetSchoolCount === count ? " degree-chip--selected" : ""}`}
							onClick={() => !isLocked && setTargetSchoolCount(count)}
							disabled={isLocked}
							aria-pressed={targetSchoolCount === count}
						>
							<span className="degree-chip__check" aria-hidden>
								✓
							</span>
							<strong>{count} {count === 1 ? "School" : "Schools"}</strong>
							<span className="muted">{count === 3 ? "Recommended" : count === 5 ? "Comprehensive" : ""}</span>
						</button>
					))}
				</div>
			</section>

			{funding && level ? (
				<div className="card card--pad mb-5 package-compose">
					<div>
						<p className="eyebrow">Your composed package</p>
						<p className="display mt-2" style={{ fontSize: "1.5rem" }}>
							{fundMeta?.name} × {levelMeta?.short} ({targetSchoolCount} {targetSchoolCount === 1 ? "School" : "Schools"})
						</p>
					</div>
					<span className="package-compose__badge mono">
						{chosen ? "Locked" : "Ready to lock"}
					</span>
					<p className="muted package-compose__note">
						Only institutions and programs matching this track and degree level will be shown during school selection.
					</p>
				</div>
			) : null}

			{funding && level ? (
				<section className="pkg-cost mb-5">
					<header className="pkg-cost__head">
						<p className="eyebrow">Century NIT Service Package & Scope</p>
						<p className="pkg-cost__note">
							Transparent all-inclusive pricing covering full advisory, credential evaluation, and filing.
						</p>
					</header>

					<ul className="pkg-cost__lines">
						<li className="pkg-cost__line pkg-cost__line--total">
							<span className="pkg-cost__label">
								Century NIT Consultancy Service Fee
								<span className="pkg-cost__when">
									Full advisory, verification, portal setup & visa coaching for {targetSchoolCount} school{targetSchoolCount === 1 ? "" : "s"}
								</span>
							</span>
							<Money usd={serviceFee} className="pkg-cost__amt" />
						</li>
						<li className="pkg-cost__line" style={{ borderTop: "1px dashed var(--border, #e5e7eb)", paddingTop: "0.75rem", marginTop: "0.5rem" }}>
							<span className="pkg-cost__label">
								<strong>Deposit (10%) — due now</strong>
								<span className="pkg-cost__when">
									Assigns your consultant and opens school selection
								</span>
							</span>
							<span style={{ color: "var(--accent, #3b82f6)", fontWeight: 700 }}>
								<Money usd={depositUsd} className="pkg-cost__amt" />
							</span>
						</li>
						<li className="pkg-cost__line">
							<span className="pkg-cost__label">
								Remaining 90% balance
								<span className="pkg-cost__when">
									{plan === "full" ? "Due before you depart" : "50% before you depart · 40% after you arrive"}
								</span>
							</span>
							<Money usd={remainingUsd} className="pkg-cost__amt" />
						</li>
					</ul>

					<div className="card card--pad mt-4" style={{ background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
						<p className="eyebrow" style={{ color: "var(--success, #10b981)" }}>All-Inclusive Consultancy Scope</p>
						<p className="muted mt-1" style={{ fontSize: "0.85rem" }}>
							The following are 100% covered by Century NIT — never charged as hidden desk fees:
						</p>
						<ul className="mt-2" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.5rem", fontSize: "0.85rem" }}>
							{((selectedPkg?.features && selectedPkg.features.length > 0) ? selectedPkg.features : [
								"Academic Credential Evaluation",
								"Document Verification & Notarization",
								"Direct University Portal Submissions",
								"Statement of Purpose (SOP) Polishing",
								"Courier & International Postal Dispatch",
								"Dedicated Visa Mock Interview Coaching",
							]).map((feat, idx) => (
								<li key={idx}>✓ {feat}</li>
							))}
						</ul>
					</div>

					{selectedPkg?.exclusions && selectedPkg.exclusions.length > 0 && (
						<div className="card card--pad mt-3" style={{ background: "rgba(239, 68, 68, 0.04)", border: "1px solid rgba(239, 68, 68, 0.15)" }}>
							<p className="eyebrow" style={{ color: "var(--danger, #ef4444)" }}>Package Exclusions</p>
							<ul className="mt-2" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.5rem", fontSize: "0.85rem" }}>
								{selectedPkg.exclusions.map((excl, idx) => (
									<li key={idx}>✗ {excl}</li>
								))}
							</ul>
						</div>
					)}

					<p className="pkg-cost__excl mt-3">
						Institutional university application fees and tuition are <strong>not</strong> agency fees. Application fees are billed per school selected, and tuition is paid directly to whichever university issues your offer.
					</p>
				</section>
			) : null}

			{/* 3 · Payment plan — chosen here, so the money is agreed before any work starts */}
			<section className="mt-4">
				<div className="card card--pad">
					<p className="eyebrow">3 · Payment plan</p>
					<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
						The deposit (10%) is due now either way. The rest of your service fee follows your plan.
					</p>
					<div className="portal-grid portal-grid--2 mt-3">
						{PAYMENT_PLANS.map((pl) => {
							const on = plan === pl.id;
							return (
								<button
									key={pl.id}
									type="button"
									className={`card card--pad${on ? " card--selected" : ""}`}
									style={{ textAlign: "left", cursor: isLocked ? "default" : "pointer", borderColor: on ? "var(--accent, #3b82f6)" : undefined }}
									disabled={isLocked || savingPlan}
									onClick={() => void savePlan(pl.id)}
									aria-pressed={on}
								>
									<p style={{ fontWeight: 600, margin: 0 }}>{PAYMENT_PLAN_LABELS[pl.id] ?? pl.name}</p>
									<p className="muted mt-1" style={{ fontSize: "0.85rem", margin: 0 }}>
										{pl.id === "full"
											? "10% now · the remaining 90% before you depart."
											: "10% now · 50% before you depart · 40% after you arrive, on a schedule you choose."}
									</p>
								</button>
							);
						})}
					</div>
					{isLocked && (
						<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
							Plan: <strong>{PAYMENT_PLAN_LABELS[application.paymentPlanId] ?? "—"}</strong>. To change it, message your consultant.
						</p>
					)}
				</div>
			</section>

			{/* 4 · Deposit */}
			<div className="row mt-4" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
				{isDepositPaid ? (
					<Button type="button" arrow onClick={() => nav("/portal/application")}>
						Next · Applications →
					</Button>
				) : (
					<>
						<Button
							type="button"
							onClick={() => void confirm(true)}
							arrow
							disabled={!funding || !level || saving || payingDeposit}
						>
							{payingDeposit ? "Connecting to Paystack…" : <>Pay the deposit (<MoneyInline usd={depositUsd} />) →</>}
						</Button>
						<Button
							type="button"
							variant="secondary"
							onClick={() => void confirm(false)}
							disabled={!funding || !level || saving || payingDeposit}
						>
							{saving ? "Saving…" : "Save & pay later"}
						</Button>
					</>
				)}
				<Button to="/portal/consultation" variant="ghost">
					← Consultation
				</Button>
			</div>
			</>)}
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
			<p className="eyebrow">Date &amp; time</p>

			<p className="resched__label mono mt-3">Date</p>
			<div className="resched__days">
				{dates.map((d) => (
					<button
						key={d.value}
						type="button"
						onClick={() => {
							onDateChange(d.value);
							onTimeChange("");
						}}
						className={`resched__day${date === d.value ? " resched__day--on" : ""}`}
					>
						<span className="resched__day-wd">{d.weekday}</span>
						<span className="resched__day-num">{d.dayMonth}</span>
					</button>
				))}
			</div>

			<p className="resched__label mono mt-3">
				Time{" "}
				<span className="muted">
					· {CONSULTATION_DURATIONS.find((d) => d.id === String(durationMinutes))?.label ?? `${durationMinutes} min`} · branch local
				</span>
			</p>
			{error && <p style={{ color: "#dc2626", fontSize: "0.85rem" }}>{error}</p>}
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

function AssessmentForm({
	assessment,
	assessmentDocs,
	onUpdate,
	onDocUpdate,
}: {
	assessment: AssessmentData;
	assessmentDocs: Record<string, AssessmentDoc>;
	onUpdate: (patch: Partial<AssessmentData>) => void;
	onDocUpdate: (id: string, fileName: string | null, documentId?: string | null) => void;
}) {
	const { toast } = useNotifier();
	const [section, setSection] = useState(0);
	const [lookups, setLookups] = useState<LookupValue[]>([]);
	const [catalogUnis, setCatalogUnis] = useState<any[]>([]);
	const [catalogDestinations, setCatalogDestinations] = useState<any[]>([]);
	const [catalogPrograms, setCatalogPrograms] = useState<any[]>([]);
	
	useEffect(() => {
		apiFetch<{ lookups: LookupValue[] }>(`${API_PREFIX}/lookups`)
			.then((res) => {
				if (res && res.lookups) setLookups(res.lookups);
			})
			.catch(console.error);

		apiFetch<{ universities: any[] }>(`${API_PREFIX}/catalog/universities`)
			.then(res => setCatalogUnis(res.universities))
			.catch(console.error);

		apiFetch<{ destinations: any[] }>(`${API_PREFIX}/catalog/destinations`)
			.then(res => setCatalogDestinations(res.destinations))
			.catch(console.error);

		apiFetch<{ programs: any[] }>(`${API_PREFIX}/catalog/programs`)
			.then(res => setCatalogPrograms(res.programs))
			.catch(console.error);
	}, []);

	const getLookupOptions = (category: string) => {
		return lookups.filter(l => l.category === category).map(l => (
			<option key={l.id} value={l.value}>{l.label}</option>
		));
	};
	const [uploading, setUploading] = useState<Record<string, number>>({});
	const [pickDocId, setPickDocId] = useState<string | null>(null);

	const sections = [
		{ label: "Personal", icon: "◎" },
		{ label: "Passport", icon: "≡" },
		{ label: "Education", icon: "◈" },
		{ label: "Employment", icon: "◴" },
		{ label: "English", icon: "✦" },
		{ label: "Preferences", icon: "❖" },
		{ label: "Financial", icon: "¤" },
		{ label: "Documents", icon: "📎" },
	];

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

			<div className="dash-tabs mt-3" role="tablist">
				{sections.map((s, i) => (
					<button
						key={s.label}
						type="button"
						role="tab"
						aria-selected={section === i}
						className={`dash-tabs__btn${section === i ? " dash-tabs__btn--active" : ""}`}
						onClick={() => setSection(i)}
					>
						<span>{s.icon}</span> {s.label}
					</button>
				))}
			</div>

			<div className="mt-4">
				{section === 0 && (
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
				)}

				{section === 1 && (
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
				)}

				{section === 2 && (
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-edu">Highest education</label>
							<select id="a-edu" className="select select--full-border" value={assessment.highestEducation} onChange={(e) => onUpdate({ highestEducation: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('highestEducation')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-inst">Institution</label>
							<select id="a-inst" className="select select--full-border" value={assessment.institution} onChange={(e) => onUpdate({ institution: e.target.value })}>
		<option value="">Select</option>
		{catalogUnis.map(u => (<option key={u.id} value={u.name}>{u.name}</option>))}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-fos">Field of study</label>
							<select id="a-fos" className="select select--full-border" value={assessment.fieldOfStudy} onChange={(e) => onUpdate({ fieldOfStudy: e.target.value })}>
		<option value="">Select</option>
		{Array.from(new Set(catalogPrograms.map(p => p.field).filter(Boolean))).map(f => (<option key={f} value={f}>{f}</option>))}
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
				)}

				{section === 3 && (
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
				)}

				{section === 4 && (
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
				)}

				{section === 5 && (
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-pc2">Preferred countries</label>
							<select id="a-pc2" className="select select--full-border" value={assessment.preferredCountries} onChange={(e) => onUpdate({ preferredCountries: e.target.value })}>
		<option value="">Select</option>
		{catalogDestinations.map(d => (<option key={d.id} value={d.name}>{d.name}</option>))}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-pl">Preferred level</label>
							<select id="a-pl" className="select select--full-border" value={assessment.preferredLevel} onChange={(e) => onUpdate({ preferredLevel: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('preferredLevel')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-pf">Preferred field</label>
							<select id="a-pf" className="select select--full-border" value={assessment.preferredField} onChange={(e) => onUpdate({ preferredField: e.target.value })}>
		<option value="">Select</option>
		{Array.from(new Set(catalogPrograms.map(p => p.field).filter(Boolean))).map(f => (<option key={f} value={f}>{f}</option>))}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-intake">Intake preference</label>
							<select id="a-intake" className="select select--full-border" value={assessment.intakePreference} onChange={(e) => onUpdate({ intakePreference: e.target.value })}>
								<option value="">Select</option>
								<option value="spring">Spring (Jan/Feb)</option>
								<option value="fall">Fall (Sep/Oct)</option>
								<option value="summer">Summer (May/Jun)</option>
								<option value="flexible">Flexible</option>
							</select>
						</div>
					</div>
				)}

				{section === 6 && (
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
				)}

			{section === 7 && (
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
								<div key={doc.id} className="card card--pad">
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
										<div>
											<p style={{ fontWeight: 600, fontSize: "0.9rem" }}>{doc.label}</p>
											<p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>{doc.hint}</p>
										</div>
										{isUploading ? (
											<span className="portal-pill portal-pill--draft">Uploading {pct}%</span>
										) : uploaded?.fileName ? (
											<span className="portal-pill portal-pill--approved">Uploaded</span>
										) : (
											<span className="portal-pill portal-pill--needs_info">Pending</span>
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
			)}
			</div>

			<div className="row mt-4" style={{ borderTop: "1px solid var(--border-light)", paddingTop: "1rem" }}>
				<Button type="button" variant="ghost" disabled={section === 0} onClick={() => setSection((s) => Math.max(0, s - 1))}>
					← Prev section
				</Button>
				<Button type="button" variant="secondary" disabled={section >= sections.length - 1} onClick={() => setSection((s) => Math.min(sections.length - 1, s + 1))}>
					Next section →
				</Button>
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

const CONSULT_TABS = [
	"Type",
	"Location",
	"Branch",
	"Assessment",
	"Schedule",
	"Pay",
	"Review",
	"Outcome",
] as const;


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
				<div className="card card--pad mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
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
				<div className="card card--pad mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
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
				<div className="card card--pad mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
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
				<div className="card card--pad mt-3" style={{ textAlign: "center", padding: "2rem 1.5rem", border: "2px solid var(--foreground)" }}>
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
				<div className="card card--pad mt-4" style={{ textAlign: "center" }}>
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
				<div className="card card--pad mt-4" style={{ textAlign: "center" }}>
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

	} = useAppState();
	const { toast } = useNotifier();
	const [selectedTab, setSelectedTab] = useState(0);

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
	const tab = useMemo(() => {
		if (booking.consultationPhase === "outcome" || booking.consultationPhase === "assessment_complete" || booking.consultationPhase === "cancelled") {
			return CONSULT_TABS.length - 1;
		}
		return selectedTab;
	}, [booking.consultationPhase, selectedTab]);
	const [payState, setPayState] = useState<"method" | "card" | "momo" | "processing" | "success" | "paid">(
		booking.confirmationId ? "paid" : "method",
	);

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
					<p className="eyebrow">Dashboard · Stage I</p>
					<h1 className="page-title mt-1">Consultation</h1>
					<p className="lead mt-2">
						All consultation steps stay <strong>inside this dashboard</strong> - not a separate app.
						Mockup: skip freely between tabs.
					</p>
				</div>
			</header>

			<div className="dash-tabs" role="tablist">
				{CONSULT_TABS.map((label, i) => {
					const isOutcomeTab = i === CONSULT_TABS.length - 1;
					const outcomeUnlocked =
						booking.consultationPhase === "assessment_complete" ||
						booking.consultationPhase === "outcome";
					const isLocked = isOutcomeTab && !outcomeUnlocked;
					return (
						<button
							key={label}
							type="button"
							role="tab"
							aria-selected={tab === i}
							aria-disabled={isLocked}
							className={`dash-tabs__btn${tab === i ? " dash-tabs__btn--active" : ""}${isLocked ? " dash-tabs__btn--locked" : ""}`}
							onClick={() => !isLocked && setSelectedTab(i)}
						>
							<span className="mono">{i + 1}</span> {label}
							{isLocked ? <span className="dash-tabs__lock">🔒</span> : null}
						</button>
					);
				})}
			</div>

			<div className="card card--pad mt-3">
				{tab === 0 && (
					<>
						<p className="eyebrow">Meeting type</p>
						<div className="card-grid card-grid--2 mt-3">
							{(
								[
									["online", "Online Consultation"],
									["in_person", "In-Person Consultation"],
								] as const
							).map(([id, name]) => (
								<button
									key={id}
									type="button"
									className={`card card--pad card--selectable${booking.consultationType === id ? " card--selected" : ""}`}
									onClick={() => updateBooking({ consultationType: id })}
								>
									<span className="display" style={{ fontSize: "1.25rem" }}>
										{name}
									</span>
								</button>
							))}
						</div>
					</>
				)}
				{tab === 1 && (
					<>
						<p className="eyebrow">Your location</p>
						<div className="form-grid form-grid--3 mt-3">
							<div className="field">
								<label htmlFor="c-country">Country</label>
								<input
									id="c-country"
									className="input input--full-border"
									value={booking.country}
									onChange={(e) => updateBooking({ country: e.target.value })}
									placeholder="Ghana"
								/>
							</div>
							<div className="field">
								<label htmlFor="c-region">Region</label>
								<input
									id="c-region"
									className="input input--full-border"
									value={booking.region}
									onChange={(e) => updateBooking({ region: e.target.value })}
									placeholder="Greater Accra"
								/>
							</div>
							<div className="field">
								<label htmlFor="c-city">City</label>
								<input
									id="c-city"
									className="input input--full-border"
									value={booking.city}
									onChange={(e) => updateBooking({ city: e.target.value })}
									placeholder="Accra"
								/>
							</div>
						</div>
					</>
				)}
				{tab === 2 && (
					<>
						<p className="eyebrow">Branch</p>
						<div className="card-grid card-grid--2 mt-3">
							{[
								{ id: "accra-hq", name: "Accra Headquarters" },
								{ id: "kumasi", name: "Kumasi Branch" },
								{ id: "takoradi", name: "Takoradi Branch" },
							].map((b) => (
								<button
									key={b.id}
									type="button"
									className={`card card--pad card--selectable${booking.branchId === b.id ? " card--selected" : ""}`}
									onClick={() => updateBooking({ branchId: b.id })}
								>
									<span className="display" style={{ fontSize: "1.2rem" }}>
										{b.name}
									</span>
								</button>
							))}
						</div>
					</>
				)}
				{tab === 3 && (
					<AssessmentForm
						assessment={booking.assessment}
						assessmentDocs={booking.assessmentDocs}
						onUpdate={updateAssessment}
						onDocUpdate={updateAssessmentDoc}
					/>
				)}
				{tab === 4 && (
					<SlotPickerLive
						branchId={booking.branchId}
						date={booking.date}
						onDateChange={(d) => updateBooking({ date: d })}
						time={booking.time}
						onTimeChange={(t) => updateBooking({ time: t })}
						durationMinutes={45}
					/>
				)}
				{tab === 5 && (					<>
						<p className="eyebrow">Consultation fee</p>
						<p className="display mt-2" style={{ fontSize: "2rem" }}>
							{formatDualCurrency(consultationFeeUsd)}
						</p>
						<p className="muted mt-1">Confirm your booking details below. Payment will be collected at the branch.</p>

						{payState === "paid" && booking.confirmationId ? (
							<div className="card card--pad mt-3" style={{ background: "var(--foreground)", color: "var(--accent-foreground)" }}>
								<p className="eyebrow">Booking confirmed</p>
								<p className="mono mt-2">Ref: {booking.confirmationId}</p>
								<p className="mt-2" style={{ opacity: 0.85 }}>
									Your consultation has been booked. A branch coordinator will review and assign your consultant shortly.
								</p>
							</div>
						) : null}

						{payState === "method" ? (
							<div className="card card--pad mt-3" style={{ border: "1px solid var(--border-light)" }}>
								<p className="eyebrow mb-2">Booking summary</p>
								<div style={{ display: "grid", gap: "0.5rem", fontSize: "var(--text-sm)" }}>
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<span className="muted">Branch</span>
										<span>{getBranchName(booking.branchId)}</span>
									</div>
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<span className="muted">Date</span>
										<span>{booking.date || "—"}</span>
									</div>
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<span className="muted">Time</span>
										<span>{booking.time || "—"}</span>
									</div>
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<span className="muted">Type</span>
										<span>{booking.consultationType === "online" ? "Online" : "In-person"}</span>
									</div>
									<div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-light)", paddingTop: "0.5rem", marginTop: "0.25rem" }}>
										<span className="muted">Fee</span>
										<span style={{ fontWeight: 600 }}>{formatDualCurrency(consultationFeeUsd)}</span>
									</div>
								</div>
								<div className="row mt-4">
									<Button type="button" onClick={startPayment} arrow>
										Confirm Booking — {formatDualCurrency(consultationFeeUsd)}
									</Button>
								</div>
							</div>
						) : null}

						{payState === "processing" ? (
							<div className="card card--pad mt-3" style={{ textAlign: "center", border: "1px solid var(--border-light)" }}>
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
							<div className="card card--pad mt-3" style={{ textAlign: "center", background: "var(--foreground)", color: "var(--accent-foreground)" }}>
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
				{tab === 6 && (
					<ConsultationReview
						booking={booking}
						onProceed={() => setSelectedTab(7)}
						onRevealOutcome={revealOutcome}
					/>
				)}
				{tab === 7 && (
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
						disabled={tab === 0}
						onClick={() => setSelectedTab((t) => Math.max(0, t - 1))}
					>
						← Prev tab
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={tab >= CONSULT_TABS.length - 1 || (tab === CONSULT_TABS.length - 2 && !(booking.consultationPhase === "assessment_complete" || booking.consultationPhase === "outcome"))}
						onClick={() => setSelectedTab((t) => Math.min(CONSULT_TABS.length - 1, t + 1))}
					>
						Next tab →
					</Button>
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
					<p className="eyebrow">Dashboard · Stage I</p>
					<h1 className="page-title mt-1">Consultation &amp; Assessment</h1>
					<p className="lead mt-2">
						{hasActiveCase
							? "Your consultation appointment and official assessment file with Century NIT."
							: "Schedule your one-on-one advisory consultation with a licensed study abroad counselor."}
					</p>
				</div>
			</header>

			{loading ? (
				<div className="card card--pad text-center py-5">
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
									<div className="card card--pad">
										<p className="eyebrow mb-2">Your journey</p>
										<JourneyStepper stageStatuses={stageStatuses} nextUnlock={journeyPhase.nextUnlock} />
									</div>
								)}

								{activeOutcome ? (
									<div id="assessment-outcome">
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
										<div className="card card--pad">
											<p className="eyebrow mb-2">Assessment</p>
											<p className="muted">
												{activeOfficer
													? `${activeOfficer} reviews your background, documents and goals during and after your session. Your outcome and recommendation appear here.`
													: "Once a consultant is assigned they review your background, documents and goals. Your outcome and recommendation appear here."}
											</p>
										</div>
									)
								)}

								{liveConsultation?.comments && liveConsultation.comments.length > 0 && (
									<div className="card card--pad">
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
								<NextActionBand
									items={actions}
									waitingOn={journeyPhase.nextUnlock}
									title="Your next steps"
									emptyTitle="Nothing needed from you right now"
								/>

								{checklist.length > 0 && (
									<div className="card card--pad">
										<div className="cn-case__top">
											<p className="eyebrow" style={{ margin: 0 }}>Your documents</p>
											<StatusPill tone={verifiedDocs.length === checklist.length ? "done" : toVerify.length > 0 ? "current" : "waiting"} dot>
												{verifiedDocs.length}/{checklist.length} verified
											</StatusPill>
										</div>
										<p className="muted mt-1" style={{ fontSize: "0.85rem" }}>
											We collect these now so your applications never wait on paperwork.
										</p>
										<ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0 0", display: "grid", gap: "0.4rem" }}>
											{checklist.map((d) => (
												<li key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.9rem" }}>
													<span title={d.hint}>{d.name}</span>
													<StatusPill tone={d.status === "VERIFIED" ? "done" : d.status === "UPLOADED" ? "current" : d.status === "REJECTED" ? "blocked" : "neutral"}>
														{d.status === "VERIFIED" ? "Verified" : d.status === "UPLOADED" ? "Being checked" : d.status === "REJECTED" ? "Needs re-upload" : "To upload"}
													</StatusPill>
												</li>
											))}
										</ul>
										{toUpload.length > 0 && (
											<div className="row mt-3">
												<Button to="/portal/documents" variant="secondary">
													Upload in the vault →
												</Button>
											</div>
										)}
									</div>
								)}

								<div className="card card--pad">
									<div className="cn-case__top">
										<span className="cn-case__ref">{activeRef}</span>
										<StatusPill tone={statusTone} dot>
											{statusLabel}
										</StatusPill>
									</div>
									<dl className="portal-case__facts">
										<dt>Session</dt>
										<dd>{liveConsultation?.type === "in_person" ? "In person" : "Online"}</dd>
										<dt>When</dt>
										<dd>{when}</dd>
										<dt>Branch</dt>
										<dd>{getBranchName(liveConsultation?.branch ?? booking.branchId)}</dd>
										<dt>Consultant</dt>
										<dd>
											{activeOfficer ? (
												<span className="portal-case__person">
													<span className="portal-case__avatar" aria-hidden>
														{activeOfficer.slice(0, 1)}
													</span>
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
									</dl>
									{liveConsultation?.meetingUrl && workflowStatus !== "CLOSED" && (
										<a href={liveConsultation.meetingUrl} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--sm mt-3">
											Join video meeting →
										</a>
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
		booking,
		fees,
		payAgencyInstallment,
		syncFromServer,
		syncTick,
	} = useAppState();
	const nav = useNavigate();
	const [depositPaying, setDepositPaying] = useState(false);
	const [serverInvoice, setServerInvoice] = useState<ApiInvoice | null>(null);
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
				const found = res.invoices.find((i) => i.status !== "void");
				if (found) setServerInvoice(found);
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
				? "Proforma estimate — your consultant is reviewing and will confirm the final figures."
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

	const selectionDone = Boolean(application.schoolSelectionDoneAt) || Boolean(serverInvoice);
	const paid = effectiveInv.status === "paid" || inv.status === "paid";

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
	const previewAmount =
		Math.max(0, schoolApplications.length) * usdFromCents((fees || FALLBACK_FEE_SCHEDULE).appPerSchoolCents);

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
		setPayPhase("loading");
		try {
			const { invoices } = await meApi.invoices();
			const backend = invoices.find((i) => i.type === "application" && i.balanceCents > 0);
			if (!backend) {
				toast.error(
					"Your application invoice has not been issued on the server yet. Ask your consultant to raise it.",
				);
				return;
			}
			if (backend.status === "proforma") {
				toast.error(
					"This invoice is currently in review as a proforma estimate. Your consultant will issue the final invoice shortly.",
				);
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

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Schools & pay</p>
					<h1 className="page-title mt-1">Select schools · pay invoice</h1>
					<p className="lead mt-2">
						Pick schools, confirm the list, pay the invoice. Tracking is a{" "}
						<strong>separate next stage</strong> - after payment, click Next to open it (sidebar
						unlocks).
						{booking.assessment.firstName ? ` · ${booking.assessment.firstName}` : ""}
					</p>
				</div>
			</header>

			{application.proceedStatus === "declined" ? (
				<section className="card card--pad mb-4" style={{ borderLeft: "4px solid var(--warning, #f59e0b)" }}>
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

			<ol className="mini-steps mb-4">
				<li className={schoolApplications.length || selectionDone ? "is-done" : "is-current"}>
					1 · Select
				</li>
				<li className={selectionDone ? (paid ? "is-done" : "is-current") : ""}>
					2 · Invoice & pay
				</li>
				<li className={paid ? "is-done" : ""}>3 · Next → Tracking</li>
			</ol>

			{/* 1 · Selection */}
			{!selectionDone ? (
				<section className="mb-5">
					<p className="eyebrow mb-2">Select schools & programmes</p>
					{!hasPkg ? (
						<div className="card card--pad mb-4">
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
						<div className="card card--pad mb-4" style={{ borderLeft: "4px solid var(--accent, #3b82f6)" }}>
							<p className="eyebrow" style={{ color: "var(--accent, #3b82f6)" }}>10% Commitment Deposit Required</p>
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

			{/* 2 · Invoice only on this page — show the real invoice once issued,
				or a simple "awaiting" card while it's still a proforma. */}
			{selectionDone ? (
				effectiveInv.status === "estimated" ? (
					<div className="card card--pad mb-4" style={{ borderLeft: "4px solid var(--primary, #2563eb)" }}>
						<p className="eyebrow">Application invoice</p>
						<h3 className="display mt-1" style={{ fontSize: "1.4rem" }}>
							Awaiting invoice
						</h3>
						<p className="muted mt-2" style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>
							Your school selection has been submitted. Your consultant is reviewing the
							list and will issue the application invoice shortly.
						</p>
						<p className="muted mt-1" style={{ fontSize: "0.85rem" }}>
							You don't need to do anything right now — the payment card will appear
							here once the invoice is issued.
						</p>
						<div className="row mt-4">
							<Button to="/portal/home" variant="secondary">
								Dashboard home
							</Button>
						</div>
					</div>
				) : serverInvoice ? (
					<section className="card card--pad mb-4">
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
								<span>University filing fee</span>
								<strong>{formatDualCurrency(usdFromCents((fees || FALLBACK_FEE_SCHEDULE).appPerSchoolCents))} / school</strong>
							</li>
						</ul>
					</section>
				) : null
			) : (
				<p className="mono muted mb-4">Confirm your school list to submit it to your consultant for invoicing.</p>
			)}


			{/* After pay: Next → Tracking page (not embedded here) */}
			{paid ? (
				<div className="card card--pad next-action">
					<p className="eyebrow">Payment complete</p>
					<p className="display mt-1" style={{ fontSize: "1.35rem" }}>
						Tracking is unlocked in the sidebar
					</p>
					<p className="muted mt-2">
						Process / track is a separate stage. Click Next to open it.
					</p>
					<div className="row mt-4">
						<Button
							type="button"
							arrow
							onClick={() => nav("/portal/tracking")}
						>
							Next · Open tracking
						</Button>
						<Button to="/portal/home" variant="ghost">
							Dashboard home
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}

/* ========== Tracking - own dashboard stage after payment ========== */

export function PortalTrackingPage() {
	return (
		<ChapterGate chapter="tracking">
			<TrackingPageInner />
		</ChapterGate>
	);
}

function TrackingPageInner() {
	const { schoolApplications, application, setSchoolApplications, syncFromServer } = useAppState();
	const paid = application.applicationInvoice.status === "paid";
	const acceptedCount = schoolApplications.filter((s) => s.outcome === "Admitted").length;

	// Poll the server for the authoritative school application statuses. The
	// local state is the seed; the server is the source of truth once the
	// invoice is paid and handlers start posting updates.
	useEffect(() => {
		if (!paid) return;
		let active = true;
		const sync = async () => {
			try {
				const res = await schoolsApi.list();
				if (!active) return;
				const mapped: SchoolApplicationTrack[] = res.schools.map((s) => ({
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
			}));
				setSchoolApplications(mapped);
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

	if (!paid) {
		return (
			<div className="portal-page">
				<p className="eyebrow">Tracking</p>
				<h1 className="page-title mt-1">Pay first</h1>
				<p className="lead mt-2">Tracking unlocks after the application invoice is paid.</p>
				<Button to="/portal/application" arrow>
					Back to schools & pay
				</Button>
			</div>
		);
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Tracking</p>
					<h1 className="page-title mt-1">Application process</h1>
					<p className="lead mt-2">
						Watch your school applications move through the review pipeline. Your consultant posts
						updates as institutions respond.
					</p>
				</div>
			</header>

			{application.pendingHandoff && (
				<div className="card card--pad mb-4" style={{ background: "#fef9c3", borderColor: "#fde047" }}>
					<p className="eyebrow" style={{ color: "#854d0e" }}>Assigning your visa officer</p>
					<p style={{ fontSize: "0.95rem", lineHeight: 1.6, color: "#713f12", marginTop: "0.4rem" }}>
						We're assigning your{" "}
						{JOURNEY_STAGE_LABELS[application.pendingHandoff.stage as JourneyStage] ??
							application.pendingHandoff.stage}{" "}
						specialist — you'll be notified once your consultant is confirmed.
					</p>
				</div>
			)}

			<div className="stat-band mt-4">
				<div className="stat-cell">
					<p className="stat-cell__label">Schools</p>
					<p className="stat-cell__value">{schoolApplications.length}</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Offers</p>
					<p className="stat-cell__value">
						{schoolApplications.filter((s) => s.status === "Decision Reached").length}
					</p>
				</div>
				<div className="stat-cell stat-cell--accent">
					<p className="stat-cell__label">Admitted</p>
					<p className="stat-cell__value">{acceptedCount}</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Payment</p>
					<p className="stat-cell__value">
						<Money usd={application.applicationInvoice.amount} />
					</p>
				</div>
			</div>

			<div className="card card--pad mt-5" style={{ background: "var(--foreground)", color: "var(--background)" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
					<span style={{ fontSize: "1.5rem" }}>✓</span>
					<div>
						<p style={{ fontWeight: 600 }}>Application invoice paid</p>
						<p className="muted" style={{ color: "rgba(255,255,255,0.75)" }}>
							<MoneyInline usd={application.applicationInvoice.amount} /> received · processing
							started
						</p>
					</div>
				</div>
			</div>

			<div className="mt-6">
				<div className="between" style={{ marginBottom: "1rem" }}>
					<p className="eyebrow">Schools · {schoolApplications.length} selected</p>
				</div>
				<ul className="school-track-list school-track-list--grid" style={{ gap: "1.5rem" }}>
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
			</div>

			{acceptedCount > 0 ? (
				application.visaConsent?.decision === "continue" ? (
					<div className="card card--pad mt-6 next-action" style={{ border: "2px solid var(--foreground)" }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
							<div>
								<p className="eyebrow">Admitted · {acceptedCount} school(s)</p>
								<p className="display mt-1" style={{ fontSize: "1.35rem" }}>
									Visa processing requested
								</p>
								<p className="muted mt-2">
									You have consented to proceed to the visa stage. Continue to your visa hub to monitor specialist assignment and invoice status.
								</p>
							</div>
							<Button to="/portal/visa" arrow>
								Next · Visa & travel
							</Button>
						</div>
					</div>
				) : (
					<div className="mt-6">
						<div className="mb-3">
							<p className="eyebrow">Admitted · Next Action</p>
						</div>
						<StageConsentCard
							stage="visa"
							currentDecision={application.visaConsent?.decision ?? null}
							title="Congratulations on your Admission! Continue to Visa Stage?"
							lead={`You have been admitted to ${acceptedCount} school(s). Decide whether you would like Century NIT to handle your visa processing.`}
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
				<div className="card card--pad mt-6">
					<p className="eyebrow">In progress</p>
					<p className="muted mt-2">
						First school reaches <strong>Decision Reached</strong> to unlock the visa stage. This is
						automated in the simulation.
					</p>
				</div>
			)}
		</div>
	);
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
		} catch {
			setError("Could not load the admission letter. Please try again.");
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
					className="card card--pad"
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
				amount: usdFromCents((fees || FALLBACK_FEE_SCHEDULE).visaBaseCents),
				actualAmount: usdFromCents((fees || FALLBACK_FEE_SCHEDULE).visaBaseCents),
				estimatedAmount: usdFromCents((fees || FALLBACK_FEE_SCHEDULE).visaBaseCents),
				estimateLines: [],
				actualLines: [],
				description: "Visa processing fee (estimate) · awaiting ops confirmation",
			};
	const amount = cardInvoice.amount || usdFromCents((fees || FALLBACK_FEE_SCHEDULE).visaBaseCents);

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

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Visa</p>
					<h1 className="page-title mt-1">{paid ? "Visa tracking" : "Visa stage · Application & Processing"}</h1>
					<p className="lead mt-2">
						{paid
							? "Visa invoice settled. Your consultant will open your visa case and update you through the tracking page."
							: isAwaitingSpecialist
								? "Your consent has been recorded. Operations is assigning your dedicated consultant."
								: isPendingInvoice
									? "Your consultant is preparing your official visa application fee invoice."
									: "Review and pay your official visa application invoice to begin active visa processing."}
					</p>
				</div>
			</header>

			<ol className="mini-steps mb-4">
				<li className={hasAdmit ? "is-done" : "is-current"}>1 · Admitted</li>
				<li className={hasAdmit ? (paid ? "is-done" : "is-current") : ""}>
					2 · {paid ? "Visa fee paid" : isAwaitingSpecialist ? "Assigning visa officer" : isPendingInvoice ? "Preparing invoice" : "Visa invoice"}
				</li>
				<li className={paid ? "is-current" : ""}>3 · Visa tracking</li>
			</ol>

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

			<div className="portal-grid portal-grid--2 portal-grid--align-start mb-2">
				{!hasAdmit ? (
					<div className="card card--pad">
						<p className="display" style={{ fontSize: "1.25rem" }}>
							No admission yet
						</p>
						<p className="muted mt-2">
							Pay the application invoice on Schools, then wait for handler tracking to reach{" "}
							<strong>Decision Reached</strong> (your consultant confirms the decision).
						</p>
						<div className="row mt-3">
							<Button to="/portal/application" arrow>
								Back to schools tracking
							</Button>
						</div>
					</div>
				) : (
					<div className="card card--pad">
						<p className="eyebrow">Your offers</p>
						<ul className="portal-snapshot mt-2">
							{accepted.map((s) => (
								<li key={s.id}>
									<span>{getUniversity(s.universityId)?.name}</span>
									<strong>
										{getProgram(s.programId)?.name} · {application.acceptedSchoolId === s.id ? "★ Your choice" : trackLabel(s)}
									</strong>
								</li>
							))}
						</ul>
					</div>
				)}

				{isAwaitingSpecialist ? (
					<div className="card card--pad">
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
							<span style={{ background: "#fef3c7", color: "#92400e", padding: "0.25rem 0.6rem", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 600 }}>
								Awaiting Visa Specialist
							</span>
							<span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Checking automatically</span>
						</div>
						<h3 className="display mt-1" style={{ fontSize: "1.25rem" }}>
							Assigning Your Visa Specialist
						</h3>
						<p className="muted mt-2" style={{ lineHeight: 1.6 }}>
							Your consent to proceed has been received. Our Operations management team is currently assigning your dedicated visa counselor.
						</p>
						<div className="mt-4" style={{ background: "rgba(0,0,0,0.03)", border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
							<div className="spinner" style={{ width: "20px", height: "20px", borderWidth: "2px", borderColor: "var(--foreground) transparent transparent transparent" }} />
							<div>
								<p style={{ fontWeight: 600, fontSize: "0.9rem" }}>Matching your case with a consultant…</p>
								<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>
									Once assigned, your specialist will prepare and issue your official visa application fee invoice. This screen updates in real time.
								</p>
							</div>
						</div>
					</div>
				) : isPendingInvoice ? (
					<div className="card card--pad">
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
							<span style={{ background: "#fef3c7", color: "#92400e", padding: "0.25rem 0.6rem", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 600 }}>
								Invoice in Review
							</span>
							<span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Checking automatically</span>
						</div>
						<h3 className="display mt-1" style={{ fontSize: "1.25rem" }}>
							Pending Visa Application Fee Invoice
						</h3>
						<p className="muted mt-2" style={{ lineHeight: 1.6 }}>
							{application.assignedStaffName ? `${application.assignedStaffName} has been assigned as your consultant.` : "Your consultant has been assigned."}{" "}
							They are currently preparing and reviewing your official visa fee invoice.
						</p>
						<div className="mt-4" style={{ background: "rgba(0,0,0,0.03)", border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
							<div className="spinner" style={{ width: "20px", height: "20px", borderWidth: "2px", borderColor: "var(--foreground) transparent transparent transparent" }} />
							<div>
								<p style={{ fontWeight: 600, fontSize: "0.9rem" }}>Being reviewed and issued…</p>
								<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>
									{serverInv?.invoiceNumber ? `Draft #${serverInv.invoiceNumber} is being reviewed.` : "Your invoice is being finalised."}{" "}
									Payment will unlock automatically on this page as soon as the invoice is issued.
								</p>
							</div>
						</div>
					</div>
				) : (hasIssuedInvoice || paid) && serverInv ? (
					<section className="card card--pad mb-4">
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
			</div>

			<div className="row mt-3" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
				<Button to="/portal/tracking" variant="secondary">
					← Back to admission tracking
				</Button>
				<Button to="/portal/financial" variant="ghost">
					View all invoices
				</Button>
				{paid ? (
					<Button to="/portal/visa/tracking" arrow>
						Continue to visa tracking
					</Button>
				) : null}
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
	const refusedDetail =
		application.visaStatus === "decision" && application.visaOutcome === "refused" ? "Refused — your consultant will advise" : "Awaiting decision";
	const steps = [
		{ id: "pending", label: "Case opened", detail: "Handler opens your file" },
		{ id: "biometrics", label: "Biometrics / appointment", detail: "Attend your appointment" },
		{ id: "decision", label: "Authority decision", detail: refusedDetail },
		{ id: "complete", label: "Visa complete", detail: "Ready for payment plan" },
	] as const;
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
				<div className="card card--pad">
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
					<p className="eyebrow">Dashboard · Visa</p>
					<h1 className="page-title mt-1">Visa tracking</h1>
					<p className="lead mt-2">Follow your visa case updates from your consultant.</p>
				</div>
			</header>
			<ol className="mini-steps mb-4">
				<li className="is-done">1 · Admitted</li>
				<li className="is-done">2 · Visa invoice</li>
				<li className="is-current">3 · Visa tracking</li>
			</ol>
			<div className={`card card--pad mb-4${refused ? " cn-next" : ""}`}>
				<p className="eyebrow">Current update</p>
				<p className="display mt-2" style={{ fontSize: "1.2rem" }}>
					{refused
						? "The visa authority refused this application."
						: (VISA_UPDATE_BY_STAGE[application.visaStatus] ?? "Visa case updating…")}
				</p>
				{refused && (
					<p className="muted mt-2">
						This is not the end of the road. Your consultant will review the refusal reasons with you and, where it makes
						sense, reopen your case for a reapplication. Check your messages, or reach your consultant from the
						Communication Centre.
					</p>
				)}
			</div>
			{application.visaCounselorNote && (
				<div className="card card--pad mb-4">
					<p className="eyebrow">Message from your consultant</p>
					<p style={{ fontSize: "0.95rem", lineHeight: 1.6, marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
						{application.visaCounselorNote}
					</p>
				</div>
			)}
			{assigningHandler && (
				<div className="card card--pad mb-4" style={{ background: "#fef9c3", borderColor: "#fde047" }}>
					<p className="eyebrow" style={{ color: "#854d0e" }}>Assigning your visa officer</p>
					<p style={{ fontSize: "0.95rem", lineHeight: 1.6, color: "#713f12", marginTop: "0.5rem" }}>
						Your payment is confirmed. Centurion is matching your case to a consultant — you'll get a
						notification with your consultant's details once your case is open.
					</p>
				</div>
			)}
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
								<strong>{step.label}</strong>
								<p className="muted">{step.detail}</p>
							</div>
						</li>
					);
				})}
			</ol>
			<div className="card card--pad mt-5 next-action">
				<p className="eyebrow">Continue</p>
				{application.visaStatus === "complete" ? (
					<div className="row mt-3">
						<Button
							type="button"
							arrow
							onClick={() => nav("/portal/pre-departure")}
						>
							Continue to travel assistance
						</Button>
					</div>
				) : (
					<p className="muted mt-1">
						{refused
							? "Travel assistance stays closed while the refusal is reviewed. Your consultant will let you know the next step."
							: "Visa tracking is in progress. Travel assistance unlocks once your visa is complete."}
					</p>
				)}
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
	const finished =
		Boolean(application.completedAt) ||
		(Boolean(application.agencySettledAt) &&
			application.visaStatus === "complete" &&
			application.travelInvoicePaid);
	const accepted = schoolApplications.filter((s) => s.outcome === "Admitted");
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

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Complete · last step</p>
					<h1 className="page-title mt-1">Application complete</h1>
					<p className="lead mt-2">
						Consultation → school package → schools → visa → payment plan & fees → travel → done.
					</p>
				</div>
				<div className="success-check" aria-hidden>
					✓
				</div>
			</header>
			<div className="card card--pad mb-4">
				<ul className="status-list">
					<li>Stage I · Consultation {booking.confirmationId}</li>
					<li>
						School package · {fund?.name ?? "-"} · {deg?.name ?? "-"}
					</li>
					<li>{schoolApplications.length} school(s) tracked</li>
					<li>Visa & travel</li>
					<li>
						Payment plan ·{" "}
						{application.paymentPlanId === "installment" ? "Instalments" : "Full payment"}
					</li>
					<li>Service fee settled</li>
				</ul>
			</div>
			{accepted.length ? (
				<div className="card card--pad">
					<p className="eyebrow">Accepted</p>
					{accepted.map((s) => (
						<p key={s.id} className="display mt-2" style={{ fontSize: "1.25rem" }}>
							{getUniversity(s.universityId)?.name} · {getProgram(s.programId)?.name}
						</p>
					))}
				</div>
			) : null}
			<div className="row mt-5">
				<Button to="/portal/pre-departure" arrow>
					Pre-departure checklist
				</Button>
				<Button to="/portal/journey" variant="secondary">
					Journey map
				</Button>
				<Button to="/" variant="ghost">
					Home
				</Button>
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
				<div className="card card--pad">
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
