import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { API_PREFIX, JOURNEY_STAGE_LABELS, INVOICE_TYPE_LABELS, LookupValue, MAX_STUDY_CHOICES, PAYMENT_PLAN_LABELS, decisionOf, type JourneyStage, type StudyChoice } from "century-nit-shared";
import { Button } from "../../components/ui/Button";
import { Money, MoneyInline } from "../../components/ui/Money";
import { Field, Select } from "../../components/ui/Field";
import { InvoiceCard, StatusPill, formatMoney } from "century-nit-core/ui";
import { openInvoiceDocument } from "../../lib/receipt";
import { usePaySheet } from "../../components/portal/PaySheet";
import { StageConsentCard } from "../../components/StageConsentCard";
import { EnrolmentDecision } from "../../components/EnrolmentDecision";
import { AssessmentOutcomeCard } from "../../components/AssessmentOutcomeCard";
import { useJoinMeeting } from "../../components/ConsultationCall";
import {
	hasAcceptedOffer,
	hasSchoolPackage,
	documentsReleasedFor,
	documentHoldReasonFor,
	useAppState,
	type AssessmentData,
	type AssessmentDoc,
	type ConsultationType,
	type InvoiceLine,
	type SchoolApplicationTrack,
	type StageInvoice,
	FALLBACK_FEE_SCHEDULE,
	emptyStudyChoice,
	flattenStudyChoices,
} from "../../context/AppState";
import { usdFromCents, feePlanSentences, DEFAULT_SERVICE_FEE_SPLIT, DEFAULT_POST_ARRIVAL_CATALOGUE } from "century-nit-shared";
import {
	formatDualCurrency,
	getDestination,
	getProgram,
	getUniversity,
	SCHOOL_DEGREE_LEVELS,
	SCHOOL_FUNDING_TRACKS,
	PAYMENT_PLANS,
	type PaymentPlanId,
	serviceFeeForPackage,
	filterProgramsForPackage,
	SCHOOL_TRACK_STATUS_LABELS,
	SCHOOL_TRACK_STAGES,
	SCHOOL_OUTCOME_LABELS,
	schoolDecisionNote,
	type Program,
	type SchoolDegreeLevel,
	type SchoolFundingTrack,
	type SchoolTrackStatus,
	CONSULTATION_DURATIONS,
	getBranchName,
	branches,
	AGENCY_DEPOSIT_PORTION,
} from "century-nit-core";
import { openInNewTab } from "century-nit-core";
import { meApi, bookingsApi, schoolsApi, documentsApi, feesApi, packagesApi, ApiError, visaCostsCentsFor } from "century-nit-core/api";
import type { ApiInvoice, ApplicantDocument, AvailabilitySlot, ApiConsultation, ApiApplication, ServicePackage, SchoolFileKind } from "century-nit-shared";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "century-nit-shared";
import { useNotifier } from "../../components/notifier/Notifier";
import { UploadPickModal } from "../../components/portal/UploadPickModal";
import { prepareDocumentForUpload } from "../../lib/upload";



import { ChapterGate } from "./PortalLayout";
import { ConsultantUpdates, isVisaUpdate } from "./ConsultantUpdates";
import { OfficialDocuments, officialRows } from "../../components/OfficialDocuments";
import { useConsultationInvoice } from "../../hooks/useConsultationInvoice";

/* ========== Journey ========== */

export function PortalJourney() {
	return <Navigate to="/portal/home" replace />;
}

/* ========== Awaiting handler assignment (after 10% deposit) ========== */

export function PortalAwaitingHandler() {
	const { application, booking, journeyPhase, syncFromServer, syncTick } = useAppState();
	const navigate = useNavigate();
	const [docList, setDocList] = useState<{ name: string; status: string }[]>([]);

	const hasHandler = Boolean(application.assignedStaffId);
	const stageAdvanced =
		(journeyPhase.stage !== "awaiting_handler" &&
		journeyPhase.stage !== "school_package" &&
		journeyPhase.stage !== "proceed" &&
		journeyPhase.stage !== "consultation" &&
		journeyPhase.stage !== "eligibility") ||
		(!application.pendingHandoff && application.agencyDepositPaid);

	// The checklist fills the wait usefully. A complete file lets the handler
	// start on school selection the day they land.
	useEffect(() => {
		let active = true;
		meApi
			.application()
			.then((me) => {
				if (!active) return;
				const list = me.application?.documentChecklist ?? me.consultation?.documentChecklist ?? [];
				setDocList(list.map((d) => ({ name: d.name, status: d.status })));
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [syncTick]);

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

	const fundMeta = SCHOOL_FUNDING_TRACKS.find((t) => t.id === application.schoolFundingTrack);
	const levelMeta = SCHOOL_DEGREE_LEVELS.find((d) => d.id === normaliseDegreeLevel(application.schoolDegreeLevel));
	const packageLabel = [fundMeta?.name, levelMeta?.short].filter(Boolean).join(" × ") || "N/A";
	const planLabel = application.paymentPlanId ? (PAYMENT_PLAN_LABELS[application.paymentPlanId] ?? "N/A") : "N/A";
	const branchName = getBranchName(booking.branchId || null);
	const depositUsd = application.agencyTotal > 0 ? Math.round(application.agencyTotal * AGENCY_DEPOSIT_PORTION) : null;
	const docsDue = docList.filter((d) => d.status === "PENDING_UPLOAD" || d.status === "REJECTED");

	const seqRows = (
		<div className="seq">
			<div className="seq__row seq__row--done">
				<span className="seq__no">✓</span>
				<div>
					<p className="seq__name">Enrolment deposit received</p>
					<p className="seq__meta">
						AGENCY DEPOSIT · PAID{depositUsd ? <> · <MoneyInline usd={depositUsd} /></> : null}
					</p>
				</div>
				<span className="seq__st">Done</span>
			</div>
			<div className={`seq__row${hasHandler ? " seq__row--done" : " seq__row--now"}`}>
				<span className="seq__no">{hasHandler ? "✓" : "2"}</span>
				<div>
					<p className="seq__name">
						{hasHandler && application.assignedStaffName
							? `${application.assignedStaffName} assigned`
							: "Handler being assigned"}
					</p>
					<p className="seq__meta">
						{branchName.toUpperCase()} DESK
						{hasHandler ? "" : " · USUALLY 1–2 BUSINESS DAYS"}
					</p>
				</div>
				<span className="seq__st">
					{hasHandler ? "Done" : (
						<>
							<span className="pulse-dot" /> In motion
						</>
					)}
				</span>
			</div>
			<div className={`seq__row${hasHandler ? " seq__row--now" : " seq__row--later"}`}>
				<span className="seq__no">3</span>
				<div>
					<p className="seq__name">School selection opens</p>
					<p className="seq__meta">CHAPTER III · APPLICATIONS{hasHandler ? " · OPEN NOW" : " · UNLOCKS ON ASSIGNMENT"}</p>
				</div>
				<span className="seq__st">{hasHandler ? "Open" : "Queued"}</span>
			</div>
		</div>
	);

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<p className="eyebrow">Chapter II · Enrolment → III · Applications</p>
				<h1 className="page-title mt-1">
					{hasHandler ? "Your consultant is assigned" : "Your consultant is being assigned"}
				</h1>
				<p className="lead" style={{ fontSize: "var(--text-sm)" }}>
					{hasHandler
						? "Your handler has landed. School selection is open."
						: "Deposit received. The office is assigning your handler. School selection opens the moment they land."}
				</p>
			</header>

			<div className="psplit" style={{ marginTop: "1.5rem" }}>
				<div>
					<section className="sec" style={{ marginBottom: "1.75rem" }}>
						<p className="eyebrow" style={{ marginBottom: "0.6rem" }}>Where your case sits</p>
						{seqRows}
					</section>

					{hasHandler ? (
						<section className="sec" style={{ marginBottom: "1.75rem" }}>
							<div className="sharp-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
								<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
									{application.assignedStaffName
										? `${application.assignedStaffName} is on your file. Pick your schools and programmes.`
										: "Your consultant is on your file. Pick your schools and programmes."}
								</p>
								<Link to="/portal/application" className="btn btn--primary">
									Continue to school selection →
								</Link>
							</div>
						</section>
					) : docList.length > 0 ? (
						<section className="sec" style={{ marginBottom: "1.75rem" }}>
							<p className="eyebrow" style={{ marginBottom: "0.6rem" }}>While you wait</p>
							<div className="sharp-card">
								{docsDue.length > 0 ? (
									<p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "0.9rem" }}>
										Your handler starts faster when your file is complete.{" "}
										<strong style={{ color: "var(--foreground)" }}>
											{docsDue.length} document{docsDue.length === 1 ? "" : "s"}
										</strong>{" "}
										still outstanding.
									</p>
								) : (
									<p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "0.9rem" }}>
										Your file is complete. Every document verified.
									</p>
								)}
								<div>
									{docList.map((d) => {
										const ok = d.status === "VERIFIED";
										const due = d.status === "PENDING_UPLOAD" || d.status === "REJECTED";
										return (
											<div key={d.name} className={`drow${ok ? " drow--ok" : due ? " drow--now" : ""}`}>
												<span className="drow__mark">{ok ? "✓" : due ? "!" : "…"}</span>
												<div>
													<p className="drow__name">{d.name}</p>
												</div>
												<span className="portal-pill portal-pill--hollow">
													{ok ? "Verified" : due ? "Upload needed" : "In review"}
												</span>
											</div>
										);
									})}
								</div>
								{docsDue.length > 0 ? (
									<div style={{ marginTop: "0.9rem" }}>
										<Link to="/portal/documents" className="btn btn--primary">
											Finish your file →
										</Link>
									</div>
								) : null}
							</div>
						</section>
					) : null}

					{!hasHandler && (
						<section className="sec">
							<div className="sharp-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
								<p className="muted" style={{ fontSize: "var(--text-xs)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
									<span className="pulse-dot" />
									This page advances itself. Checking the assignment every 20 seconds. No need to refresh or call.
								</p>
								<Link to="/portal/journey" className="btn btn--ghost">
									View full journey
								</Link>
							</div>
						</section>
					)}
				</div>

				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow">Your case</p>
						<p className="prail__title">{application.appNumber ?? "N/A"}</p>
						<div className="pkv"><span className="pkv__k">Package</span><span className="pkv__v">{packageLabel}</span></div>
						<div className="pkv"><span className="pkv__k">Schools</span><span className="pkv__v">{application.targetSchoolCount ? `${application.targetSchoolCount} targets` : "N/A"}</span></div>
						<div className="pkv"><span className="pkv__k">Plan</span><span className="pkv__v">{planLabel}</span></div>
						<div className="pkv"><span className="pkv__k">Deposit</span><span className="pkv__v">{depositUsd ? <MoneyInline usd={depositUsd} /> : "Paid"}</span></div>
						<div className="pkv"><span className="pkv__k">Handling branch</span><span className="pkv__v">{branchName}</span></div>
						<div className="pkv"><span className="pkv__k">Consultant</span><span className="pkv__v">{application.assignedStaffName ?? <span className="muted">Assigning</span>}</span></div>
						<div style={{ marginTop: "0.9rem" }}>
							<Link to="/portal/financial" className="btn btn--ghost" style={{ width: "100%", textAlign: "center" }}>
								Deposit receipt
							</Link>
						</div>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">When your handler lands</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.65 }}>
							They introduce themselves by email and in-app message, school selection opens in{" "}
							<strong style={{ color: "var(--foreground)" }}>Chapter III</strong>, and this page moves you
							forward automatically. You will not miss it.
						</p>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Questions meanwhile</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.65 }}>
							Anything about your package, deposit or timeline. Message the desk.
						</p>
						<button
							type="button"
							className="btn"
							style={{ width: "100%", textAlign: "center", marginTop: "0.7rem" }}
							onClick={() => window.dispatchEvent(new CustomEvent("century:open-chat"))}
						>
							Message us
						</button>
					</div>
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
	// if any is still outstanding, say so. It is the client's move, not ours.
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

	// Re-check whenever AppState syncs. Which happens on the `invoice.issued`
	// SSE event. Plus a slow fallback interval.
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
						fee will be raised shortly. You'll be able to pay it once it's issued.
					</p>
				)}
				<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>
					You don't need to do anything right now. Checking status automatically in the background.
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

/** The stored level is free text on the API. Read it back to one of ours. */
function normaliseDegreeLevel(raw: string | null | undefined): SchoolDegreeLevel | null {
	if (!raw) return null;
	const v = raw.toLowerCase();
	if (SCHOOL_DEGREE_LEVELS.some((d) => d.id === v)) return v as SchoolDegreeLevel;
	if (v.includes("master") || v.includes("msc") || v.includes("mba") || v.includes("postgrad")) return "masters";
	if (v.includes("bachelor") || v.includes("bsc") || v.includes("undergrad")) return "bachelor";
	if (v.includes("phd") || v.includes("doctor")) return "phd";
	if (v.includes("diploma") || v.includes("certificate")) return "diploma";
	if (v.includes("professional")) return "professional";
	return null;
}

function SchoolPackageInner() {
	const { application, chooseSchoolPackage, booking, choosePaymentPlan, fees, syncFromServer } = useAppState();
	const { toast } = useNotifier();
	const nav = useNavigate();
	const paySheet = usePaySheet(() => void syncFromServer());
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
	const activeLevel = normaliseDegreeLevel(level || application.schoolDegreeLevel) ?? "masters";

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
				tagline: p.code === "scholarship" ? "Funded / award-led path" : p.code === "hybrid" ? "Partial award + self-fund" : "Self-funded / family-funded",
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
				const { invoices } = await meApi.invoices({ type: "agency" });
				const due = invoices.find((i) => i.balanceCents > 0 && i.status !== "void");
				if (!due) {
					throw new Error("Your deposit invoice isn't on the server yet. Ask your consultant to raise it.");
				}
				paySheet.pay(due);
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

	// The plans in the client's words. From the configured split, never a typed number.
	const planWords = feePlanSentences(fees?.catalogue.serviceFeeSplit ?? DEFAULT_SERVICE_FEE_SPLIT, fees?.catalogue.postArrival ?? DEFAULT_POST_ARRIVAL_CATALOGUE);

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
						Confirm you're enrolling, choose your package and plan, pay the deposit. Your
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
									The deposit is due now either way. The plan decides how the rest follows.
								</p>
								<div className="pcards pcards--pair">
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
													{pl.id === "full" ? planWords.fullShort : planWords.installmentShort}
												</span>
											</button>
										);
									})}
								</div>
								{isLocked && (
									<p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.6rem" }}>
										Plan: <strong>{PAYMENT_PLAN_LABELS[application.paymentPlanId] ?? "N/A"}</strong>. To
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
											✗ University application fees. Billed per school selected
										</li>
										<li className="muted" style={{ padding: "0.3rem 0" }}>
											✗ Tuition. Paid to the university that admits you
										</li>
									</ul>
								</div>
							</section>
						</>
					)}
				</div>

				{/* right: the composed package. The money never scrolls away */}
				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow">Your package</p>
						{funding && level ? (
							<>
								<p className="prail__title">
									{[fundMeta?.name, levelMeta?.short, `${targetSchoolCount} ${targetSchoolCount === 1 ? "school" : "schools"}`]
										.filter(Boolean)
										.join(" · ")}
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
									<span className="pkv__k">Due</span>
									<span className="pkv__v muted">once your flight is booked</span>
								</div>
								<p
									className="muted"
									style={{ fontSize: "0.68rem", lineHeight: 1.5, margin: "0.8rem 0" }}
								>
									By paying the deposit you agree: your admission letter, visa documents and e-ticket
									are released after the pre-departure milestone. Which unlocks once your flight is booked.
									School application fees and tuition are the institutions', not ours.
								</p>
								{isDepositPaid ? (
									<Button
										type="button"
										arrow
										onClick={() => nav("/portal/application")}
										style={{ width: "100%" }}
									>
										Next · Applications
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
													Pay the deposit · <MoneyInline usd={depositUsd} />
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
								Pick a funding track and degree level. The fee and deposit compose here.
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
			{paySheet.sheet}
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
 * rules the Operations Center's reschedule panel does, from the same module,
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
	destinations: { id: string; name: string; flag?: string | null }[];
	programs: {
		id: string;
		name: string;
		universityId?: string | null;
		level?: string | null;
		field?: string | null;
		intake?: string[] | null;
		tuition?: string | null;
		tuitionUsd?: number | null;
	}[];
};

const EMPTY_CATALOG: AssessmentCatalog = { lookups: [], universities: [], destinations: [], programs: [] };

/**
 * Fetched once by the flow, not by the form: the form used to load all four
 * on every mount, and it mounted again on every tab switch. The school picker
 * reads the same live catalogue. The bundled `universities`/`programs` lists
 * in content.ts are a build-time snapshot that can never see ops's edits.
 */
function useAssessmentCatalog(): { catalog: AssessmentCatalog; loaded: boolean; failed: boolean } {
	const [catalog, setCatalog] = useState<AssessmentCatalog>(EMPTY_CATALOG);
	const [loaded, setLoaded] = useState(false);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		void Promise.all([
			apiFetch<{ lookups: LookupValue[] }>(`${API_PREFIX}/lookups`).then((r) => r?.lookups ?? []),
			apiFetch<{ universities: AssessmentCatalog["universities"] }>(`${API_PREFIX}/catalog/universities`).then((r) => r?.universities ?? []),
			apiFetch<{ destinations: AssessmentCatalog["destinations"] }>(`${API_PREFIX}/catalog/destinations`).then((r) => r?.destinations ?? []),
			apiFetch<{ programs: AssessmentCatalog["programs"] }>(`${API_PREFIX}/catalog/programs`).then((r) => r?.programs ?? []),
		])
			.then(([lookups, universities, destinations, programs]) => {
				if (active) {
					setCatalog({ lookups, universities, destinations, programs });
					setLoaded(true);
				}
			})
			.catch(() => {
				if (active) {
					setLoaded(true);
					setFailed(true);
				}
			});
		return () => { active = false; };
	}, []);
	return { catalog, loaded, failed };
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
									<option value="">{school ? (programmes.length ? "Select" : "No programmes listed. Pick a field") : "Choose a school first"}</option>
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

	// Filled/total per section. Drives the counts in the TOC and each head.
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
			toast.error("Upload a PDF document.");
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

			{/* One page, top to bottom. The flow's tabs are the only tabs. The nav
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
						Where would you like to study? Pick the country, school, programme and intake together. Add a second and third choice if you have them.
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
						Upload scanned copies of your documents. Accepted: PDF only (max 15 MB each).
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

/** Consultations run at the two Ghana offices. Partner desks don't take bookings. */
const BOOKABLE_BRANCHES = branches.filter((b) => b.id === "accra-hq" || b.id === "kumasi");

// The branch is the office that handles your file. Its slots, its
// consultants. So it is picked for online meetings too, not just in-person.

export function PortalConsultationBookingFlow({ embedded = false, freeRebooking = false, prefill }: {
	/** Render only the two-column flow. No page chrome (used inside the cancelled-case layout). */
	embedded?: boolean;
	/** A free-rebooking credit covers the fee. No Paystack hop, no fee line. */
	freeRebooking?: boolean;
	/** Carry branch/type over from the cancelled case. Never clobbers a choice already made. */
	prefill?: { branchId?: string; consultationType?: string };
} = {}) {
	const {
		booking,
		updateBooking,
		updateAssessment,
		updateAssessmentDoc,
	} = useAppState();
	const { toast } = useNotifier();
	const { catalog } = useAssessmentCatalog();

	// Rebook prefill. The cancelled case's branch/type, applied only to
	// fields the client hasn't already picked.
	useEffect(() => {
		const patch: { branchId?: string; consultationType?: ConsultationType } = {};
		if (prefill?.branchId && !booking.branchId) patch.branchId = prefill.branchId;
		if (prefill?.consultationType && !booking.consultationType) {
			patch.consultationType = prefill.consultationType as ConsultationType;
		}
		if (Object.keys(patch).length > 0) updateBooking(patch);
	}, [prefill?.branchId, prefill?.consultationType, booking.branchId, booking.consultationType, updateBooking]);

	// Live consultation fee (USD) from platform_settings. What ops configured,
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
	const [payState, setPayState] = useState<"method" | "processing" | "success" | "paid">(
		booking.confirmationId ? "paid" : "method",
	);

	// Earliest open day per branch. The branch card doubles as a date hint.
	const [nextSlots, setNextSlots] = useState<Record<string, string | null>>({});
	useEffect(() => {
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
	}, []);

	async function startPayment() {
		if (payState === "paid" || payState === "processing" || payState === "success") return;
		// Gate payment on the required booking fields. Paystack will reject
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

			if (res.authorizationUrl) {
				window.location.href = res.authorizationUrl;
				return;
			}
			if (res.booking) {
				// Free rebooking. The credit covered the fee; the booking is
				// already made, no Paystack hop.
				updateBooking({ confirmationId: res.booking.reference });
				setPayState("paid");
				toast.success("Booked. Your slot is confirmed. No payment was needed.");
				return;
			}
			throw new Error("Checkout returned neither a payment link nor a booking");
		} catch (err) {
			setPayState("method");
			toast.error("Error creating booking: " + String(err));
		}
	}

	const flow = (
		<div className="psplit">
				<div>
					{/* 1 · how you meet */}
					<section className="psec">
						<div className="psec__h">
							<span className="psec__no">1</span>
							<span className="psec__title">How you meet</span>
							<span className="psec__hint">same session, same fee</span>
						</div>
						<div className="pcards pcards--pair">
							{(
								[
									["online", "Video call", "Online consultation", "Meet from anywhere. You still pick which office handles your file."],
									["in_person", "At a branch", "In-person consultation", "Accra or Kumasi. The office you visit."],
								] as const
							).map(([id, kicker, name, blurb]) => (
								<button
									key={id}
									type="button"
									className={`pick${booking.consultationType === id ? " pick--on" : ""}`}
									onClick={() => updateBooking({ consultationType: id })}
								>
									<span className="eyebrow">{kicker}</span>
									<span className="pick__name" style={{ fontSize: "1.05rem" }}>{name}</span>
									<span className="muted">{blurb}</span>
									<span className="pick__price">45 min · {formatDualCurrency(consultationFeeUsd)}</span>
								</button>
							))}
						</div>
					</section>

					{/* 2 · which office handles the file */}
					<section className="psec">
						<div className="psec__h">
							<span className="psec__no">2</span>
							<span className="psec__title">Which office handles you</span>
							<span className="psec__hint">your file sits with one office. Even for a video call</span>
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
					</section>

					{/* 3 · about you */}
					<section className="psec">
						<div className="psec__h">
							<span className="psec__no">3</span>
							<span className="psec__title">About you</span>
							<span className="psec__hint">your consultant reads this before you meet</span>
						</div>
						<div className="sharp-card">
							<AssessmentForm
								assessment={booking.assessment}
								assessmentDocs={booking.assessmentDocs}
								catalog={catalog}
								onUpdate={updateAssessment}
								onDocUpdate={updateAssessmentDoc}
							/>
							<p className="muted mt-3" style={{ fontSize: "0.85rem" }}>
								Passport details, budget and study choices. The same form as your profile. Filled once; it feeds both.
							</p>
						</div>
					</section>

					{/* 4 · pick a time */}
					<section className="psec" id="pick-a-time">
						<div className="psec__h">
							<span className="psec__no">4</span>
							<span className="psec__title">Pick a time{booking.branchId ? ` · ${getBranchName(booking.branchId)}` : ""}</span>
							<span className="psec__hint">45 min · branch time · struck days are full</span>
						</div>
						<div className="sharp-card">
							<SlotPickerLive
								branchId={booking.branchId}
								date={booking.date}
								onDateChange={(d) => updateBooking({ date: d })}
								time={booking.time}
								onTimeChange={(t) => updateBooking({ time: t })}
								durationMinutes={45}
							/>
						</div>
					</section>

					{/* 5 · confirm & pay */}
					<section className="psec">
						<div className="psec__h">
							<span className="psec__no">5</span>
							<span className="psec__title">Confirm &amp; pay</span>
							<span className="psec__hint">Paystack · card or mobile money</span>
						</div>

						{payState === "method" ? (
							<>
								<div className="order">
									<div className="order__row">
										<span>
											{freeRebooking
												? "Consultation. Free rebooking"
												: `${booking.consultationType === "online" ? "Online consultation" : "In-person consultation"}. 45 min`}
											<small>
												{[booking.date, booking.time, booking.branchId ? `${getBranchName(booking.branchId)} handles the file` : null]
													.filter(Boolean)
													.join(" · ") || "Details in the rail"}
											</small>
										</span>
										<span className="order__amt">{freeRebooking ? "Covered" : formatDualCurrency(consultationFeeUsd)}</span>
									</div>
									<div className="order__row">
										<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
											Includes. Eligibility review, route recommendation, document checklist, named consultant
										</span>
										<span className="order__amt muted"></span>
									</div>
									<div className="order__total">
										<span>Due now</span>
										<span className="order__amt">{freeRebooking ? "GH₵ 0" : formatDualCurrency(consultationFeeUsd)}</span>
									</div>
								</div>
								<p className="muted mt-3" style={{ fontSize: "var(--text-xs)", lineHeight: 1.6, maxWidth: "30rem" }}>
									Free reschedule up to 24h before · if we cancel on you, the fee carries to a free rebooking. You never pay twice for our cancellation · receipt lands in your Money ledger.
								</p>
								<div className="row mt-4">
									<Button type="button" onClick={startPayment} arrow>
										{freeRebooking ? "Book the slot" : `Pay with Paystack · ${formatDualCurrency(consultationFeeUsd)}`}
									</Button>
									<a className="btn btn--ghost" href="#pick-a-time">Change slot</a>
								</div>
								{!freeRebooking ? (
									<p className="mono muted mt-2" style={{ fontSize: "0.62rem" }}>
										Card · MTN MoMo · Vodafone Cash. Processed by Paystack
									</p>
								) : null}
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

						{payState === "paid" || payState === "success" ? (
							<div className="sharp-card mt-3" style={{ background: "var(--foreground)", color: "var(--accent-foreground)" }}>
								<p className="eyebrow">Booking confirmed</p>
								{booking.confirmationId ? <p className="mono mt-2">Ref: {booking.confirmationId}</p> : null}
								<p className="mt-2" style={{ opacity: 0.85 }}>
									A branch coordinator will review and assign your consultant shortly.
								</p>
							</div>
						) : null}
					</section>
				</div>

				{/* the booking rail. What you're about to pay for, always visible */}
				<div className="prail">
					<div className="sharp-card sharp-card--key">
						<p className="eyebrow">Your booking</p>
						<div style={{ marginTop: "0.4rem" }}>
							<div className="pkv">
								<span className="pkv__k">Type</span>
								<span className={`pkv__v${booking.consultationType ? "" : " muted"}`}>
									{booking.consultationType === "online"
										? "Video call"
										: booking.consultationType === "in_person"
											? "At a branch"
											: "Not chosen"}
								</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Handling branch</span>
								<span className={`pkv__v${booking.branchId ? "" : " muted"}`}>
									{booking.branchId ? getBranchName(booking.branchId) : "Not chosen"}
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
							<div className={`pkv${freeRebooking ? "" : " pkv--due"}`}>
								<span className="pkv__k">Fee</span>
								<span className="pkv__v">
									{freeRebooking ? "Covered ✓" : payState === "paid" ? "Paid ✓" : formatDualCurrency(consultationFeeUsd)}
								</span>
							</div>
						</div>
						<p className="mono" style={{ fontSize: "0.68rem", marginTop: "0.8rem" }}>
							{payState === "paid"
								? `Booked · Ref ${booking.confirmationId}`
								: "Fill each section. The Pay button is on the last one."}
						</p>
						<p className="muted" style={{ fontSize: "0.66rem", marginTop: "0.7rem", lineHeight: 1.5 }}>
							The fee confirms the slot. Reschedule free up to 24h before.
						</p>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">What happens next</p>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.6 }}>
							Payment books the slot. You get a confirmation and a reminder the day before; your consultant reads your "About you"
							before you meet.
						</p>
					</div>
				</div>
			</div>
	);

	if (embedded) return flow;

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter I · Consultation</p>
					<h1 className="page-title mt-1">Book your consultation</h1>
					<p className="lead mt-2">
						One session, video or at a branch, 45 minutes, {formatDualCurrency(consultationFeeUsd)}. Your consultant reviews your
						background, tells you if the route is viable, and hands you a document checklist and a named consultant for the rest of the journey.
					</p>
				</div>
			</header>
			{flow}
		</div>
	);
}



export function PortalConsultation() {
	const { booking, fees, revealOutcome } = useAppState();
	const nav = useNavigate();

	const [liveConsultation, setLiveConsultation] = useState<ApiConsultation | null>(null);
	const [liveApplication, setLiveApplication] = useState<ApiApplication | null>(null);
	const [loading, setLoading] = useState(true);
	const { join, joining, error: joinError, overlay } = useJoinMeeting({ onReschedule: () => nav("/portal/appointments") });
	const { invoice: consultInvoice, loaded: consultInvoiceLoaded } = useConsultationInvoice();

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
	const workflow = liveConsultation?.workflow;
	const workflowStatus = workflow?.status ?? "AWAITING_ASSIGNMENT";

	// An active case exists if there's a consultation OR an application. Ops
	// can create the application directly (bypassing consultation), and a
	// silent consultation-creation failure after payment shouldn't strand the
	// applicant on the fee page when their application is already in flight.
	// A CLOSED workflow with no live application and no paid booking is a dead
	// case. Render the booking sheet again. (The old case view linked out to
	// Appointments to rebook, whose own Book CTA loops right back here.)
	const closedCase = workflowStatus === "CLOSED" && !liveApplication && !booking.confirmationId;
	const hasActiveCase = Boolean(liveConsultation || liveApplication || booking.confirmationId) && !closedCase;
	const activeRef = liveConsultation?.reference ?? booking.confirmationId;
	const activeOfficer = liveConsultation?.assignedOfficerName;
	const activeOutcome =
		liveConsultation?.assessmentResult?.outcome ||
		(liveConsultation?.assessmentResult && (liveConsultation.assessmentResult.recCountry || liveConsultation.assessmentResult.recPackage) ? "Eligible" : null) ||
		(workflowStatus === "COMPLETED" ? "Eligible" : null) ||
		(booking.consultationPhase === "outcome" ? "Eligible" : null);
	const activeNotes = liveConsultation?.assessmentResult?.notes || booking.eligibilityNote || null;

	if (loading) {
		return (
			<div className="portal-page">
				<header className="portal-page__header">
					<div>
						<p className="eyebrow">Chapter I · Consultation</p>
						<h1 className="page-title mt-1">Consultation</h1>
					</div>
				</header>
				<div className="sharp-card text-center">
					<p className="muted">Loading consultation case details…</p>
				</div>
			</div>
		);
	}

	if (!hasActiveCase) {
		if (closedCase) {
			// Cancelled case. State the money plainly and offer the free
			// rebooking when ops issued one. The booking sheet sits in the
			// same page, prefilled from the cancelled case.
			const isFree = liveConsultation?.freeRebooking ?? false;
			const cancelledFeeUsd = usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents);
			return (
				<div className="portal-page">
					<header className="portal-page__header">
						<div>
							<p className="eyebrow">Chapter I · Consultation</p>
							<h1 className="page-title mt-1">Consultation · cancelled</h1>
							<p className="lead mt-2">
								This consultation was cancelled and the slot released back to the branch.
							</p>
						</div>
					</header>

					<div className="journey-now mt-4">
						<div>
							<p className="eyebrow">You are here</p>
							<p className="display journey-now__title" style={{ fontSize: "1.3rem" }}>
								{isFree
									? "Book a new slot. The fee is covered"
									: "Book a new slot. Or move, don't cancel, next time"}
							</p>
							<p className="journey-now__detail">
								{isFree
									? "A free rebooking was issued on your case. Your assessment and documents carry over. Only the appointment is new."
									: `A new booking carries the consultation fee again (${formatDualCurrency(cancelledFeeUsd)}). If we cancelled on you, message us first. You shouldn't pay twice. Your assessment and documents carry over; only the appointment is new.`}
							</p>
						</div>
						<a className="btn btn--inverted" href="#rebook">Book a new slot ↓</a>
					</div>

					<div className="sharp-card mt-4" style={{ maxWidth: "44rem" }}>
						<p className="eyebrow">What carries over</p>
						<div className="pkv">
							<span className="pkv__k">Assessment</span>
							<span className="pkv__v">Kept. No need to refill</span>
						</div>
						<div className="pkv">
							<span className="pkv__k">Documents</span>
							<span className="pkv__v">Kept in your vault</span>
						</div>
						<div className="pkv">
							<span className="pkv__k">Consultant</span>
							<span className="pkv__v">Assigned within a day, as before</span>
						</div>
						<div className="pkv">
							<span className="pkv__k">Fee</span>
							<span className="pkv__v">
								{isFree ? "Covered. Free rebooking" : `${formatDualCurrency(cancelledFeeUsd)} again`}
							</span>
						</div>
					</div>

					<section className="psec" id="rebook" style={{ marginTop: "2rem" }}>
						<div className="psec__h">
							<span className="psec__title">Your new booking</span>
						</div>
						<PortalConsultationBookingFlow
							embedded
							freeRebooking={isFree}
							prefill={{
								branchId: liveConsultation?.branch,
								consultationType: liveConsultation?.type,
							}}
						/>
					</section>
				</div>
			);
		}
		return <PortalConsultationBookingFlow />;
	}

	// The standard documents are collected here, in this chapter, so
	// nothing waits on paperwork later. Not uploaded and rejected are
	// the client's to act on; uploaded is with the consultant.
	const checklist = liveApplication?.documentChecklist ?? liveConsultation?.documentChecklist ?? [];
	const toUpload = checklist.filter((d) => d.status === "PENDING_UPLOAD" || d.status === "REJECTED");
	const verifiedDocs = checklist.filter((d) => d.status === "VERIFIED");
	const statusLabel =
		workflowStatus === "CLOSED"
			? "Appointment closed"
			: workflowStatus === "COMPLETED"
				? "Assessment complete"
				: workflowStatus === "IN_PROGRESS"
					? "In progress"
					: "Awaiting your consultant";
	const startsAt = liveConsultation?.startsAt ? new Date(liveConsultation.startsAt) : null;
	const startsInFuture = Boolean(startsAt && startsAt.getTime() > Date.now());
	const daysTo = startsAt ? Math.max(0, Math.ceil((startsAt.getTime() - Date.now()) / 86_400_000)) : null;
	const when = startsAt
		? startsAt.toLocaleString(undefined, {
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
	const whenShort = startsAt
		? startsAt.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
		: booking.date
			? `${booking.date} ${booking.time}`.trim()
			: "Scheduled";
	const whenDay = startsAt
		? startsAt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
		: booking.date || null;
	const bookedDay = startsAt ? startsAt.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : booking.date || null;
	const branchName = getBranchName(liveConsultation?.branch ?? booking.branchId);
	const meetingUrl = workflowStatus !== "CLOSED" ? (liveConsultation?.meetingUrl ?? null) : null;
	// The stored meetingUrl is never opened raw. For token'd providers it
	// isn't a usable link. Joins mint a per-person credential through /join.
	const meetingBookingId = liveConsultation?.bookingId ?? booking.bookingId ?? null;
	const appointmentDone = workflowStatus === "COMPLETED" || workflowStatus === "CLOSED" || Boolean(activeOutcome);
	const decisionOpen = Boolean(activeOutcome) && (applicationConsent === null || applicationConsent === "pending");
	const consentDecision = decisionOf(applicationConsent);
	// The assessment feeds the consultant's preparation. A booking made
	// in a hurry can skip it, so it stays asked for until the meeting.
	const profile = liveConsultation?.profile;
	const assessmentGaps = profile
		? (["nationality", "dob", "degree", "degreeLevel", "intake"] as const).filter((k) => !profile[k])
		: [];
	const consultationFeeUsd = usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents);
	const consultPaidCents = consultInvoice ? consultInvoice.subtotalCents - consultInvoice.balanceCents : null;
	const consultPayments = consultInvoice ? [...consultInvoice.payments].sort((a, b) => a.at.localeCompare(b.at)) : [];
	const lastConsultPayment = consultPayments.length > 0 ? consultPayments[consultPayments.length - 1] : null;

	const steps: { label: string; done: boolean; fact: string }[] = [
		{
			label: "Booked",
			done: Boolean(activeRef),
			fact: activeRef
				? `${bookedDay ?? "paid"} · ${consultInvoice ? (consultPaidCents === 0 ? `${formatMoney(0, "ghs")} · covered` : `${formatMoney(consultPaidCents ?? 0, "ghs")} paid`) : "paid"}`
				: "not booked",
		},
		{
			label: "With your consultant",
			done: Boolean(activeOfficer) || workflowStatus === "IN_PROGRESS" || workflowStatus === "COMPLETED",
			fact: activeOfficer ?? (workflowStatus === "IN_PROGRESS" || workflowStatus === "COMPLETED" ? "your consultant" : "assigning"),
		},
		{ label: "Outcome", done: Boolean(activeOutcome), fact: activeOutcome ? activeOutcome.toLowerCase() : "after the session" },
		{ label: "Your call", done: Boolean(consentDecision), fact: consentDecision ?? "proceed or hold" },
	];
	const onStep = steps.findIndex((s) => !s.done);

	// The band. The one thing this chapter needs right now.
	const band: { title: string; detail: string; cta: ReactNode } =
		workflowStatus === "CLOSED"
			? {
					title: "This consultation was cancelled",
					detail: "Book a new slot to continue. Check-ins are free once you're enrolled, the first consultation carries the fee.",
					cta: (
						<a className="btn btn--inverted" href="/portal/appointments">
							Manage appointments →
						</a>
					),
				}
			: decisionOpen
				? {
						title: `${activeOutcome}. Decide whether to proceed`,
						detail: "Proceeding opens Chapter II · Enrolment: the package, your plan, and the deposit that starts your file moving.",
						cta: (
							<a className="btn btn--inverted" href="#assessment-outcome">
								Review the outcome ↓
							</a>
						),
					}
				: meetingUrl && startsInFuture
					? {
							title: `${whenShort}. Your link is ready`,
							detail: "Join opens the video call right here. Your consultant reads your assessment before you meet.",
							cta: meetingBookingId ? (
								<button type="button" className="btn btn--inverted" disabled={joining} onClick={() => void join(meetingBookingId, `Consultation · ${activeRef ?? ""}`)}>
									{joining ? "Joining…" : "Join video meeting →"}
								</button>
							) : null,
						}
					: assessmentGaps.length > 0
						? {
								title: "Complete your assessment form",
								detail: "Your consultant reads this before you meet. Your background, passport, education and what you're aiming for.",
								cta: (
									<Button to="/portal/profile" variant="inverted" arrow>
										Complete form
									</Button>
								),
							}
						: toUpload.length > 0
							? {
									title: `Upload your documents · ${toUpload.map((d) => d.name).join(" · ")}`,
									detail: "The standard set, checked off here so nothing waits on paperwork later.",
									cta: (
										<Button to="/portal/documents" variant="inverted" arrow>
											Open vault
										</Button>
									),
								}
							: {
									title:
										workflowStatus === "AWAITING_ASSIGNMENT"
											? `${whenShort}. A consultant is being assigned`
											: workflowStatus === "IN_PROGRESS"
												? "Session done. Your outcome is being prepared"
												: "Consultation in progress",
									detail:
										workflowStatus === "AWAITING_ASSIGNMENT"
											? `${branchName} assigns your consultant within a day. Upload your standard documents meanwhile so nothing waits on paperwork.`
											: workflowStatus === "IN_PROGRESS"
												? "Your consultant writes up the outcome and route recommendation. It lands in Your assessment below."
												: "Your branch updates this page as the case moves.",
									cta: null,
								};

	return (
		<div className="portal-page">
			{overlay}
			{joinError ? <p className="appt-error">{joinError}</p> : null}
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter I · Consultation</p>
					<h1 className="page-title mt-1">{activeOutcome ? "Consultation · outcome in" : "Consultation · booked"}</h1>
					<p className="lead mt-2">
						{activeOutcome
							? "Your consultant has reviewed your file. One decision ends this chapter."
							: "Your session is paid and on the calendar. This page is your case file. The appointment, the outcome, and anything your consultant asks for."}
					</p>
				</div>
			</header>

			{/* You are here */}
			<div className="journey-now mt-4">
				<div>
					<p className="eyebrow">You are here</p>
					<p className="display journey-now__title" style={{ fontSize: "1.3rem" }}>
						{band.title}
					</p>
					<p className="journey-now__detail">{band.detail}</p>
				</div>
				{band.cta}
			</div>

			{/* the strip. Booked → consultant → outcome → your call */}
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
					{/* 1 · the appointment. Open card until it's held, then a mono line */}
					<section className="psec">
						<div className="psec__h">
							<span className={`psec__no${appointmentDone ? " psec__no--done" : ""}`}>{appointmentDone ? "✓" : "1"}</span>
							<span className="psec__title">Your appointment</span>
							<span className="psec__hint">
								{appointmentDone
									? `held${whenDay ? ` · ${whenDay}` : ""}`
									: activeRef
										? `confirmed · ${activeRef}`
										: "awaiting confirmation"}
							</span>
						</div>
						{appointmentDone ? (
							<p className="mono muted" style={{ fontSize: "0.75rem" }}>
								{liveConsultation?.type === "in_person" ? "In person" : "Video call"} · {branchName} · held {whenShort}. Ref {activeRef}
							</p>
						) : (
							<div className="sharp-card sharp-card--key">
								<div className="between" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
									<p className="eyebrow">
										{liveConsultation?.type === "in_person" ? "In person" : "Online"} · {branchName}
									</p>
									<span className="portal-pill portal-pill--solid">{statusLabel}</span>
								</div>
								<div className="mt-1">
									<div className="pkv">
										<span className="pkv__k">When</span>
										<span className="pkv__v">{when}</span>
									</div>
									<div className="pkv">
										<span className="pkv__k">Consultant</span>
										<span className="pkv__v">
											{activeOfficer ? (
												<>
													{activeOfficer}
													{liveConsultation?.assignedOfficerEmail ? (
														<>
															<br />
															<a href={`mailto:${liveConsultation.assignedOfficerEmail}`} className="muted" style={{ fontSize: "0.78rem" }}>
																{liveConsultation.assignedOfficerEmail}
															</a>
														</>
													) : null}
												</>
											) : (
												<span className="muted">Being assigned at your branch</span>
											)}
										</span>
									</div>
								</div>
								{liveConsultation?.rescheduleRequestedAt && liveConsultation.rescheduleRequestedStartsAt ? (
									<div
										className="mt-3"
										style={{
											border: "1.5px dashed var(--ink, #000)",
											background: "var(--muted-bg, #f5f5f5)",
											padding: "0.6rem 0.8rem",
											fontSize: "0.78rem",
											lineHeight: 1.5,
										}}
									>
										<span className="mono" style={{ fontSize: "0.62rem", letterSpacing: "0.12em", textTransform: "uppercase", display: "block", marginBottom: "0.15rem" }}>
											Reschedule requested. Awaiting your consultant
										</span>
										You asked to move to{" "}
										<b>
											{new Date(liveConsultation.rescheduleRequestedStartsAt).toLocaleString(undefined, {
												weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
												timeZone: liveConsultation.timezone ?? undefined,
											})}
										</b>
										. The slot above holds until they confirm.
										{liveConsultation.rescheduleRequestReason ? (
											<span className="muted"> Reason: “{liveConsultation.rescheduleRequestReason}”</span>
										) : null}
									</div>
								) : null}
								{meetingUrl && meetingBookingId ? (
									<button type="button" onClick={() => void join(meetingBookingId, `Consultation · ${activeRef ?? ""}`)} disabled={joining} className="btn btn--primary btn--sm mt-4">
										{joining ? "Joining…" : "Join video meeting →"}
									</button>
								) : meetingUrl ? null : (
									<p className="muted mt-3" style={{ fontSize: "0.85rem" }}>
										The meeting link appears here once your consultant is seated.
									</p>
								)}
							</div>
						)}
					</section>

					{/* 2 · the assessment outcome. The decision lives on the card */}
					<section className="psec" id="assessment-outcome">
						<div className="psec__h">
							<span className={`psec__no${activeOutcome ? " psec__no--done" : ""}`}>{activeOutcome ? "✓" : "2"}</span>
							<span className="psec__title">Your assessment</span>
							<span className="psec__hint">{activeOutcome ? "outcome ready" : "after the session"}</span>
						</div>
						{activeOutcome ? (
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
						) : (
							<>
								<p className="mono muted" style={{ fontSize: "0.75rem" }}>
									YOUR CONSULTANT REVIEWS YOUR BACKGROUND, DOCUMENTS AND GOALS. THE OUTCOME AND ROUTE RECOMMENDATION APPEAR HERE.
								</p>
								{booking.consultationPhase === "assessment_complete" ? (
									<div className="mt-3">
										<Button type="button" onClick={() => void revealOutcome()} arrow>
											View your outcome
										</Button>
									</div>
								) : null}
							</>
						)}
					</section>

					{/* 3 · the standard documents. Collected here so nothing waits later */}
					{checklist.length > 0 ? (
						<section className="psec">
							<div className="psec__h">
								<span className="psec__no">3</span>
								<span className="psec__title">Your documents</span>
								<span className="psec__hint">
									standard set · {verifiedDocs.length}/{checklist.length} verified
								</span>
							</div>
							<div className="sharp-card">
								<ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
									{checklist.map((d) => (
										<li
											key={d.id}
											style={{
												display: "flex",
												justifyContent: "space-between",
												gap: "0.75rem",
												fontSize: "0.9rem",
												paddingBottom: "0.75rem",
												borderBottom: "1px solid var(--border-light)",
											}}
										>
											<span title={d.hint} style={{ fontWeight: 500 }}>
												{d.name}
											</span>
											<StatusPill
												tone={d.status === "VERIFIED" ? "done" : d.status === "UPLOADED" ? "current" : d.status === "REJECTED" ? "blocked" : "neutral"}
											>
												{d.status === "VERIFIED" ? "Verified" : d.status === "UPLOADED" ? "Being checked" : d.status === "REJECTED" ? "Needs re-upload" : "To upload"}
											</StatusPill>
										</li>
									))}
								</ul>
								{toUpload.length > 0 ? (
									<div className="mt-3">
										<Button to="/portal/documents" variant="ghost" size="sm">
											Upload in your vault →
										</Button>
									</div>
								) : null}
							</div>
						</section>
					) : null}

					{/* 4 · messages. Only when the consultant has written */}
					{liveConsultation?.comments && liveConsultation.comments.length > 0 ? (
						<section className="psec">
							<div className="psec__h">
								<span className="psec__no">{checklist.length > 0 ? "4" : "3"}</span>
								<span className="psec__title">Messages</span>
								<span className="psec__hint">from your consultant</span>
							</div>
							<ConsultantUpdates
								comments={liveConsultation.comments}
								title={`Messages from ${liveConsultation.assignedOfficerName?.split(" ")[0] ?? "your consultant"}`}
								seenKey={`consultation:${liveConsultation.id}`}
								showEmpty
							/>
						</section>
					) : null}
				</div>

				{/* the rail. Countdown, money, consultant, next chapter */}
				<aside className="prail">
					{startsInFuture && workflowStatus !== "CLOSED" ? (
						<div className="sharp-card sharp-card--key sharp-card--invert">
							<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>Countdown</p>
							<p style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: "0.3rem" }}>
								{daysTo !== null && daysTo > 0 ? `${daysTo} day${daysTo === 1 ? "" : "s"}` : "Today"}
							</p>
							<p className="mono" style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.7)", marginTop: "0.15rem" }}>
								TO {whenShort.toUpperCase()}
							</p>
						</div>
					) : null}

					<div className="sharp-card">
						<p className="eyebrow">Money · Chapter I</p>
						{consultInvoice ? (
							<p className="mono muted" style={{ fontSize: "0.68rem", marginTop: "0.3rem" }}>
								{consultInvoice.invoiceNumber} · paid{" "}
								{new Date(lastConsultPayment?.at ?? consultInvoice.updatedAt).toLocaleDateString(undefined, {
									day: "numeric",
									month: "short",
									year: "numeric",
								})}
							</p>
						) : null}
						<div style={{ marginTop: "0.4rem" }}>
							<div className="pkv">
								<span className="pkv__k">Consultation fee</span>
								<span className="pkv__v">
									{consultInvoice && consultPaidCents !== null
										? consultPaidCents === 0
											? `${formatMoney(0, "ghs")} · covered`
											: `${formatMoney(consultPaidCents, "ghs")} paid ✓`
										: `${formatDualCurrency(consultationFeeUsd)} paid ✓`}
								</span>
							</div>
							{consultInvoice && lastConsultPayment ? (
								<p className="muted" style={{ fontSize: "0.68rem" }}>
									≈ {formatMoney(consultPaidCents ?? 0, "usd")} · {lastConsultPayment.method}
									{lastConsultPayment.reference ? ` · ref ${lastConsultPayment.reference}` : ""}
								</p>
							) : null}
						</div>
						{consultInvoice ? (
							<>
								<div style={{ display: "flex", gap: "0.75rem", marginTop: "0.6rem" }}>
									<button type="button" className="doc-link" onClick={() => openInvoiceDocument(consultInvoice, "invoice")}>
										↓ invoice
									</button>
									{consultInvoice.payments.length > 0 ? (
										<button type="button" className="doc-link" onClick={() => openInvoiceDocument(consultInvoice, "receipt")}>
											↓ receipt
										</button>
									) : null}
								</div>
								<p className="muted" style={{ fontSize: "0.7rem", marginTop: "0.5rem" }}>
									Opens the PDF the office emailed you. Same document, byte for byte.
								</p>
							</>
						) : consultInvoiceLoaded ? (
							<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.6rem" }}>
								Receipt is being written up. It appears here within a minute — refresh, or find it under Money.
							</p>
						) : null}
						<div style={{ marginTop: "0.8rem" }}>
							<Button to="/portal/financial" variant="ghost" size="sm">
								Open Money →
							</Button>
						</div>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Your consultant</p>
						{activeOfficer ? (
							<>
								<p style={{ fontWeight: 700, marginTop: "0.5rem" }}>{activeOfficer}</p>
								<p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.15rem" }}>
									Consultation · {branchName}
								</p>
								<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem" }}>
									<Button to="/portal/home" variant="ghost" size="sm">
										Message
									</Button>
									<Button to="/portal/appointments" variant="ghost" size="sm">
										{startsInFuture && workflowStatus !== "CLOSED" ? "Appointments →" : "Book call"}
									</Button>
								</div>
							</>
						) : (
							<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
								Being assigned at {branchName}. Usually same day.
							</p>
						)}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">{activeOutcome ? "Next chapter" : "After the session"}</p>
						<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem", lineHeight: 1.6 }}>
							{activeOutcome
								? "Proceeding opens Chapter II · Enrolment. The package and plan, then the deposit that starts your file moving."
								: "Your outcome and recommendation land here, then Chapter II · Enrolment opens. The package and your plan."}
						</p>
					</div>
				</aside>
			</div>
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

/** The most schools one list can hold. The package's spread. */
const MAX_TARGET_SCHOOLS = 5;

function ApplicationHubInner() {
	const {
		application,
		schoolApplications,
		addSchoolApplication,
		removeSchoolApplication,
		lockSchoolSelection,
		setSchoolApplications,
		syncFromServer,
		syncTick,
		journeyPhase,
	} = useAppState();
	const paySheet = usePaySheet(() => void syncFromServer());
	const [serverInvoice, setServerInvoice] = useState<ApiInvoice | null>(null);
	// Schools added after the first invoice went out are billed on a
	// supplementary one. Every application invoice past the first.
	const [extraInvoices, setExtraInvoices] = useState<ApiInvoice[]>([]);
	const [destId, setDestId] = useState("");
	const [uniId, setUniId] = useState("");
	const [progId, setProgId] = useState("");
	const [intake, setIntake] = useState("");
	const { toast } = useNotifier();

	const hasPkg = hasSchoolPackage(application);
	const depositPaid = application.agencyDepositPaid;

	// Refetched on every AppState sync. The `invoice.issued` / `invoice.paid`
	// SSE events trigger one. So no page-level polling is needed.
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
	// the invoice is paid. Handlers post updates as institutions respond.
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

	// The live catalogue. The same /catalog/* rows ops maintains. The bundled
	// content.ts lists this picker used to render are a build-time snapshot:
	// a school added or deactivated in ops would never appear (or would keep
	// appearing) here, and the freeze-snapshot on the server would silently
	// null out the university name on submit.
	const { catalog, loaded: catalogLoaded, failed: catalogFailed } = useAssessmentCatalog();
	const livePrograms = catalog.programs as unknown as Program[];
	const liveUniversities = catalog.universities;
	const liveDestinations = catalog.destinations;

	const selectedLevel = application.schoolDegreeLevel || undefined;
	const selectedTrack = application.schoolFundingTrack || undefined;

	const packagePrograms = useMemo(() => {
		return filterProgramsForPackage(livePrograms, selectedLevel, selectedTrack);
	}, [livePrograms, selectedLevel, selectedTrack]);

	const packageUniversities = useMemo(() => {
		return liveUniversities.filter((u) => packagePrograms.some((p) => p.universityId === u.id));
	}, [packagePrograms, liveUniversities]);

	const uniList = destId
		? packageUniversities.filter((u) => u.destinationId === destId)
		: packageUniversities;
	const progList = uniId
		? packagePrograms.filter((p) => p.universityId === uniId)
		: packagePrograms;
	const program = livePrograms.find((p) => p.id === progId);
	const intakes = program?.intake?.length ? program.intake : ["September 2026", "January 2027"];

	// If the applicant already locked their school selection (or has a server
	// invoice), they are past the package/deposit gate. Show the invoice
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

	/** In-portal Paystack sheet for one issued invoice. */
	function payOne(backend: ApiInvoice) {
		if (backend.status === "proforma") {
			toast.error("Your consultant is still preparing this invoice. You'll be notified when it is ready to pay.");
			return;
		}
		paySheet.pay(backend);
	}

	function addSchool(e: FormEvent) {
		e.preventDefault();
		const d = destId || liveDestinations[0]?.id || "";
		const uList = liveUniversities.filter((u) => u.destinationId === d);
		const u = uniId || uList[0]?.id || "";
		const pList = livePrograms.filter((p) => p.universityId === u);
		const p = progId || pList[0]?.id || "";
		// Without a real catalogue row the server freeze-snapshot would land
		// nulls. Refuse rather than file a school with no name.
		if (!d || !u || !p) {
			toast.error("Pick a destination, university and programme first.");
			return;
		}
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



	const fund = SCHOOL_FUNDING_TRACKS.find((f) => f.id === application.schoolFundingTrack);
	const deg = SCHOOL_DEGREE_LEVELS.find((d) => d.id === application.schoolDegreeLevel);
	const handler = application.assignedStaffName ?? null;
	// Staff names arrive in caps ("ENOCH ENU"). A first name reads better in sentence case.
	const handlerFirst = handler
		? handler.split(" ")[0].charAt(0).toUpperCase() + handler.split(" ")[0].slice(1).toLowerCase()
		: "your consultant";
	const n = schoolApplications.length;
	const filedCount = schoolApplications.filter((r) => r.status !== "Preparing Application").length;
	const acceptedRow = schoolApplications.find((r) => r.id === application.acceptedSchoolId) ?? null;
	const acceptedName = acceptedRow ? (liveUniversities.find((u) => u.id === acceptedRow.universityId)?.name ?? acceptedRow.universityName ?? null) : null;
	const visaConsent = application.visaConsent?.decision ?? null;
	const invoiceDue = effectiveInv.status === "raised" && (serverInvoice?.balanceCents ?? 0) > 0;
	const dueLabel = invoiceDue ? formatMoney(serverInvoice?.balanceCents ?? 0, "ghs") : null;
	const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

	const stepState = (k: 1 | 2 | 3 | 4): "done" | "on" | "later" =>
		k === 1 ? (selectionDone ? "done" : "on")
		: k === 2 ? (paid ? "done" : selectionDone ? "on" : "later")
		: k === 3 ? (offersCount > 0 || application.acceptedSchoolId ? "done" : paid ? "on" : "later")
		: application.acceptedSchoolId ? "done" : offersCount > 0 ? "on" : "later";
	const stepFact = [
		selectionDone ? plural(n, "school") : `${n} of ${MAX_TARGET_SCHOOLS}`,
		paid ? "paid" : dueLabel ?? "",
		paid ? `${decidedCount} of ${n}` : "",
		application.acceptedSchoolId ? "accepted" : offersCount > 0 ? plural(offersCount, "offer") : "",
	];
	const STEP_LABELS = ["Target schools", "Invoice", "Decisions", "Accept an offer"];

	const openChat = () => window.dispatchEvent(new CustomEvent("open-chat", { detail: { channel: "support" } }));

	const acceptOffer = async (row: SchoolApplicationTrack) => {
		await schoolsApi.meAcceptOffer(row.id);
		await syncFromServer();
	};

	// The band. The one thing this chapter needs right now.
	const band: { title: string; detail: string; cta: ReactNode } = !selectionDone
		? {
				title: `Choose your target schools · ${n} of ${MAX_TARGET_SCHOOLS} picked`,
				detail: `Add up to five; the catalogue filters to your package. When the list is right, send it · ${handlerFirst} raises one invoice for all of them.`,
				cta: (
					<a className="btn btn--inverted" href="#target-list">
						Review your list ↓
					</a>
				),
			}
		: invoiceDue
			? {
					title: `Pay the application invoice · ${dueLabel}`,
					detail: "Each university's own application fee, passed on at cost. Files are lodged within two business days of payment.",
					cta: (
						<a className="btn btn--inverted" href="#invoice">
							Pay {dueLabel} ↓
						</a>
					),
				}
			: !paid
				? {
						title: `Your school list is with ${handlerFirst}`,
						detail: "The invoice is being prepared. You'll be notified the moment it is ready to pay.",
						cta: null,
					}
				: application.acceptedSchoolId && visaConsent === "continue"
					? {
							title: "Visa processing requested",
							detail: "Your visa specialist is being assigned and the invoice prepared. Follow it on the visa hub.",
							cta: (
								<Button to="/portal/visa" variant="inverted" arrow>
									Next · Visa &amp; travel
								</Button>
							),
						}
					: application.acceptedSchoolId
						? {
								title: "Offer accepted. Decide on visa processing",
								detail: "Your destination is confirmed. The visa decision below opens Chapter IV.",
								cta: (
									<a className="btn btn--inverted" href="#decision">
										Decide ↓
									</a>
								),
							}
						: offersCount > 0
							? {
									title: `${plural(offersCount, "offer")} in. Pick your school`,
									detail: "Accepting one confirms your destination; the visa file and departure are prepared for that school.",
									cta: (
										<a className="btn btn--inverted" href="#decision">
											Choose your school ↓
										</a>
									),
								}
							: {
									title: `${plural(filedCount, "file")} lodged. Universities reply in 2–6 weeks`,
									detail: `Nothing to do. ${handlerFirst} chases replies weekly; a decision lands on the school's card the moment it arrives.`,
									cta: null,
								};

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter III · Applications</p>
					<h1 className="page-title mt-1">Applications</h1>
					<p className="lead mt-2">
						Pick up to five schools. {handlerFirst} prices their application fees, you settle one invoice, and every file is lodged and chased for you.
					</p>
				</div>
			</header>

			{application.proceedStatus === "declined" ? (
				<section className="sharp-card mb-4" style={{ borderLeft: "4px solid var(--foreground)" }}>
					<p className="eyebrow">Application Paused</p>
					<h2 className="page-title mt-1" style={{ fontSize: "1.45rem" }}>
						You paused your application
					</h2>
					<p className="lead mt-2" style={{ maxWidth: "44rem" }}>
						Everything stays on hold. We can re-open your application whenever you are ready. Just reach out to your consultant.
					</p>
					<div className="row mt-4">
						<Button to="/portal/home" variant="ghost">
							Back to dashboard
						</Button>
					</div>
				</section>
			) : (
				<div className="journey-now mt-4">
					<div>
						<p className="eyebrow">You are here</p>
						<p className="display journey-now__title" style={{ fontSize: "1.3rem" }}>
							{band.title}
						</p>
						<p className="journey-now__detail">{band.detail}</p>
					</div>
					{band.cta}
				</div>
			)}

			<div className="psteps4">
				{STEP_LABELS.map((label, i) => {
					const k = (i + 1) as 1 | 2 | 3 | 4;
					const st = stepState(k);
					return (
						<div key={label} className={`pstep${st === "done" ? " pstep--done" : st === "on" ? " pstep--on" : ""}`}>
							<span className="pstep__m">{st === "done" ? "✓" : k}</span>
							<span className="pstep__l">{label}</span>
							{stepFact[i] ? <span className="pstep__s">{stepFact[i]}</span> : null}
						</div>
					);
				})}
			</div>

			<div className="psplit mt-5">
				<div>
					{/* 1 · Target list */}
					{!selectionDone ? (
						<section className="psec" id="target-list">
							<div className="psec__h">
								<span className="psec__no">1</span>
								<span className="psec__title">Your target list</span>
								<span className="psec__hint">
									{n} of {MAX_TARGET_SCHOOLS}
									{deg ? ` · ${deg.short}` : ""}
									{fund ? ` · ${fund.name}` : ""}
								</span>
							</div>

							<div className="schools">
								{schoolApplications.map((row) => (
									<SchoolCard key={row.id} row={row} mode="editing" handlerFirst={handlerFirst} onRemove={() => handleRemoveSchool(row.id)} />
								))}
								{n < MAX_TARGET_SCHOOLS ? (
									<button
										type="button"
										className="sch sch--add"
										onClick={() => document.getElementById("s-dest")?.focus()}
									>
										<span className="sch__plus">+</span>
										<span className="sch__addt">Add a school</span>
										<span className="sch__adds">
											{MAX_TARGET_SCHOOLS - n} more
											{deg ? ` · ${deg.short}` : ""}
											{fund ? ` · ${fund.name}` : ""}
										</span>
									</button>
								) : null}
							</div>

							{n < MAX_TARGET_SCHOOLS ? (
								<form className="picker" onSubmit={addSchool}>
									{catalogFailed ? (
										<p className="picker__peek">
											<span className="picker__s">Couldn't load the school list. Refresh to try again, or message us.</span>
										</p>
									) : !catalogLoaded ? (
										<p className="picker__peek">
											<span className="picker__s">Loading the school catalogue…</span>
										</p>
									) : null}
									<fieldset className="picker__row" disabled={!catalogLoaded}>
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
												<option value="">Choose a country</option>
												{liveDestinations.map((d) => (
													<option key={d.id} value={d.id}>
														{d.flag ? `${d.flag} ` : ""}{d.name}
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
												<option value="">Choose a university</option>
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
												<option value="">Choose a programme</option>
												{progList.map((pr) => (
													<option key={pr.id} value={pr.id}>
														{pr.name}
													</option>
												))}
											</Select>
										</Field>
										<Field label="Intake" htmlFor="s-int">
											<Select id="s-int" value={intake} onChange={(e) => setIntake(e.target.value)} fullBorder>
												<option value="">Choose an intake</option>
												{intakes.map((i) => (
													<option key={i} value={i}>
														{i}
													</option>
												))}
											</Select>
										</Field>
										<Button type="submit" variant="secondary" disabled={!progId}>
											Add school
										</Button>
									</fieldset>
									{program ? (
										<p className="picker__peek">
											<span className="picker__k">Tuition</span>
											<b>{program.tuition ?? "N/A"}</b>
											<span className="picker__s">
												{program.tuitionUsd != null ? `≈ ${formatDualCurrency(program.tuitionUsd)} · ` : ""}paid to the university, not to us
											</span>
										</p>
									) : destId && !uniList.length && catalogLoaded ? (
										<p className="picker__peek">
											<span className="picker__s">No universities listed for this destination yet. Message us and we'll add one.</span>
										</p>
									) : uniId && !progList.length && catalogLoaded ? (
										<p className="picker__peek">
											<span className="picker__s">No programmes listed for this university yet. Message us and we'll add one.</span>
										</p>
									) : (
										<p className="picker__peek">
											<span className="picker__s">Pick a programme to see its tuition before you add it.</span>
										</p>
									)}
								</form>
							) : null}

							<div className="pfoot">
								<Button type="button" onClick={handleLockSelection} disabled={n === 0} arrow>
									Confirm list &amp; send to {handlerFirst}
								</Button>
								<span className="pfoot__note">
									{n === 0
										? "Add at least one school to continue."
										: `${handlerFirst} prices the application fees from this list. You can add schools later. They go on a supplementary invoice.`}
								</span>
							</div>
						</section>
					) : (
						<section className="psec" id="target-list">
							<div className="psec__h">
								<span className="psec__no psec__no--done">✓</span>
								<span className="psec__title">{paid ? "Your schools" : "Your target list"}</span>
								<span className="psec__hint">
									{paid
										? `${plural(filedCount, "school")} filed · ${decidedCount} decided${offersCount > 0 ? ` · ${plural(offersCount, "offer")}` : ""}`
										: `${plural(n, "school")} · confirmed${application.schoolSelectionDoneAt ? ` ${new Date(application.schoolSelectionDoneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}`}
								</span>
							</div>
							<div className="schools">
								{schoolApplications.map((row) =>
									paid ? (
										<SchoolCard
											key={row.id}
											row={row}
											mode="tracking"
											handlerFirst={handlerFirst}
											accepted={application.acceptedSchoolId === row.id}
											anotherAccepted={Boolean(application.acceptedSchoolId) && application.acceptedSchoolId !== row.id}
											onAccept={() => acceptOffer(row)}
										/>
									) : (
										<SchoolCard key={row.id} row={row} mode="locked" handlerFirst={handlerFirst} onAskChange={openChat} />
									),
								)}
							</div>
						</section>
					)}

					{/* 2 · Invoice. The real invoice once issued, an awaiting line while proforma */}
					<section className={`psec${!selectionDone ? " psec--later" : ""}`} id="invoice">
						<div className="psec__h">
							<span className={`psec__no${paid ? " psec__no--done" : !selectionDone ? " psec__no--later" : ""}`}>{paid ? "✓" : "2"}</span>
							<span className="psec__title">Application invoice</span>
							<span className="psec__hint">
								{serverInvoice ? `${serverInvoice.invoiceNumber} · ${serverInvoice.status === "paid" ? `paid${serverInvoice.updatedAt ? ` ${new Date(serverInvoice.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}` : serverInvoice.status}` : selectionDone ? "being prepared" : "not raised"}
							</span>
						</div>
						{!selectionDone ? (
							<p className="psec__later">
								Raised by {handlerFirst} once your list is confirmed. Each university's own application fee, paid on your behalf at cost.
							</p>
						) : paid && extraInvoices.every((x) => x.status === "paid" || x.balanceCents <= 0) ? (
							<p className="psec__later">
								{serverInvoice ? formatMoney(serverInvoice.subtotalCents, "ghs") : formatDualCurrency(inv.amount)} settled in full. Receipt in your Money ledger.
							</p>
						) : effectiveInv.status === "estimated" || !serverInvoice ? (
							<p className="psec__later">
								Your school list is with {handlerFirst}, who is preparing the invoice. You'll be notified the moment it is ready to pay. The payment card appears here once it is issued.
							</p>
						) : (
							<div className={`sharp-card${paid ? "" : " sharp-card--key"}`}>
								<InvoiceCard
									title="Application invoice"
									invoice={serverInvoice}
									display="ghs"
									actions={
										<>
											{serverInvoice.status !== "proforma" && serverInvoice.balanceCents > 0 ? (
												<Button onClick={payInvoice} arrow>
													Pay {formatMoney(serverInvoice.balanceCents, "ghs")}
												</Button>
											) : null}
											<button type="button" className="doc-link" onClick={() => openInvoiceDocument(serverInvoice, "invoice")}>
												↓ invoice
											</button>
											{serverInvoice.payments.length > 0 ? (
												<button type="button" className="doc-link" onClick={() => openInvoiceDocument(serverInvoice, "receipt")}>
													↓ receipt
												</button>
											) : null}
										</>
									}
								/>
								<p className="pfoot__note mt-3">
									{plural(n, "school")} · each university's own application fee, paid on your behalf at cost
									{paid ? "" : " · Paystack, card or mobile money · the receipt lands in Money"}.
								</p>
								{extraInvoices.map((x) => (
									<div key={x.id} className="mt-4">
										<InvoiceCard
											compact
											title="Additional schools"
											invoice={x}
											display="ghs"
											actions={
												<>
													{x.status !== "proforma" && x.balanceCents > 0 ? (
														<Button onClick={() => void payOne(x)} arrow>
															Pay {formatMoney(x.balanceCents, "ghs")}
														</Button>
													) : null}
													<button type="button" className="doc-link" onClick={() => openInvoiceDocument(x, "invoice")}>
														↓ invoice
													</button>
													{x.payments.length > 0 ? (
														<button type="button" className="doc-link" onClick={() => openInvoiceDocument(x, "receipt")}>
															↓ receipt
														</button>
													) : null}
												</>
											}
										/>
									</div>
								))}
							</div>
						)}
					</section>

					{/* 3 · Your decision. The prompt and the visa consent in one card */}
					{offersCount > 0 || application.acceptedSchoolId ? (
						<section className="psec" id="decision">
							<div className="psec__h">
								<span className={`psec__no${application.acceptedSchoolId ? " psec__no--done" : ""}`}>
									{application.acceptedSchoolId ? "✓" : "3"}
								</span>
								<span className="psec__title">Your decision</span>
								<span className="psec__hint">
									{application.acceptedSchoolId
										? visaConsent === "continue"
											? "visa processing"
											: `${acceptedName ?? "accepted"} · visa pending`
										: `${plural(offersCount, "offer")} in`}
								</span>
							</div>
							{visaConsent === "continue" ? (
								<div className="sharp-card sharp-card--key">
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
										<div>
											<p className="eyebrow">{acceptedName ?? `Admitted · ${plural(offersCount, "school")}`}</p>
											<p className="display mt-1" style={{ fontSize: "1.35rem" }}>
												Visa processing requested
											</p>
											<p className="muted mt-2">
												{application.pendingHandoff
													? `We're assigning your ${JOURNEY_STAGE_LABELS[application.pendingHandoff.stage as JourneyStage] ?? application.pendingHandoff.stage} specialist and preparing the visa invoice. You'll be notified once your consultant is confirmed.`
													: "Your visa specialist is being assigned and the invoice prepared. Follow it on the visa hub."}
											</p>
										</div>
										<Button to="/portal/visa" arrow>
											Next · Visa &amp; travel
										</Button>
									</div>
								</div>
							) : (
								<>
									{offersCount > 1 && !application.acceptedSchoolId ? (
										<div className="sharp-card sharp-card--key mb-3">
											<p className="eyebrow">Admitted · {plural(offersCount, "school")}</p>
											<p className="display mt-1" style={{ fontSize: "1.2rem" }}>
												You hold {offersCount} offers. Which one are you going with?
											</p>
											<p className="muted mt-2">
												Use “Accept this offer” on the school's card above, then decide below.
											</p>
										</div>
									) : null}
									<StageConsentCard
										stage="visa"
										currentDecision={application.visaConsent?.decision ?? null}
										title="Congratulations on your Admission! Continue to Visa Stage?"
										lead={`You have been admitted to ${plural(offersCount, "school")}. Decide whether you would like Century NIT to handle your visa processing.`}
										continueDetail="Your case will be sent to our Operations team to assign a dedicated consultant and prepare your official visa application fee invoice."
										holdDetail="Need time to review your offers or arrange funding? You can keep your file on hold and return whenever you are ready. No invoices will be raised."
										optOutDetail="You may choose to handle your visa application independently or decline visa processing."
										onDecided={() => {
											void syncFromServer();
										}}
									/>
								</>
							)}
						</section>
					) : null}

					{/* Updates. Only when the consultant has written on this chapter */}
					{application.comments.some((c) => !isVisaUpdate(c)) ? (
						<section className="psec">
							<div className="psec__h">
								<span className="psec__no">{offersCount > 0 || application.acceptedSchoolId ? "4" : "3"}</span>
								<span className="psec__title">Updates</span>
								<span className="psec__hint">from {handlerFirst}</span>
							</div>
							<ConsultantUpdates
								comments={application.comments}
								title={`Updates from ${handlerFirst}`}
								filter={(c) => !isVisaUpdate(c)}
								seenKey={`${application.applicationId ?? "case"}:main`}
								className="mb-3"
							/>
						</section>
					) : null}
				</div>

				{/* the rail. Position, the chapter's facts, one explainer for the state */}
				<div className="prail">
					<div className="prail__ink">
						<p className="prail__ink-k">Your position</p>
						<p className="prail__ink-big">
							{offersCount > 0 ? plural(offersCount, "offer") : paid ? `${n} filed` : invoiceDue ? `${dueLabel} due` : `${n} targeted`}
						</p>
						<p className="prail__ink-s">
							{n} targeted · {paid ? filedCount : 0} filed · {decidedCount} decided
							{application.acceptedSchoolId ? " · offer accepted" : ""}
						</p>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">This chapter</p>
						<div style={{ marginTop: "0.4rem" }}>
							<div className="pkv">
								<span className="pkv__k">Package</span>
								<span className="pkv__v">{[fund?.name, deg?.short].filter(Boolean).join(" · ") || "N/A"}</span>
							</div>
							<div className={`pkv${invoiceDue ? " pkv--due" : ""}`}>
								<span className="pkv__k">Invoice</span>
								<span className="pkv__v">{paid ? "Paid" : invoiceDue ? `${dueLabel} due` : selectionDone ? "Being prepared" : "Not raised"}</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Handler</span>
								<span className="pkv__v">{handler ?? "Assigning…"}</span>
							</div>
							<div className={`pkv${offersCount > 0 && !application.acceptedSchoolId ? " pkv--due" : ""}`}>
								<span className="pkv__k">Next unlock</span>
								<span className="pkv__v">IV · Visa · {application.acceptedSchoolId ? (visaConsent === "continue" ? "chapter opens" : "your visa decision") : offersCount > 0 ? "accept an offer" : "when you're admitted"}</span>
							</div>
						</div>
					</div>

					{!selectionDone ? (
						<div className="sharp-card">
							<p className="eyebrow">How the list works</p>
							<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem", lineHeight: 1.6 }}>
								Up to five schools within your package. Confirming sends the list to {handlerFirst}, who prices each university's application fee and raises one invoice. Late additions go on a supplementary invoice.
							</p>
						</div>
					) : invoiceDue ? (
						<div className="sharp-card">
							<p className="eyebrow">What you're paying for</p>
							<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem", lineHeight: 1.6 }}>
								Each university's own application fee, passed on at cost. Century NIT adds nothing to it. Payment lodges every file within two business days.
							</p>
						</div>
					) : offersCount > 0 || application.acceptedSchoolId ? (
						<div className="sharp-card">
							<p className="eyebrow">How accepting works</p>
							<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem", lineHeight: 1.6 }}>
								Accepting confirms your destination. The visa file and departure are prepared for that school. The university's own deposit is paid to the school directly; {handlerFirst} walks you through it.
							</p>
						</div>
					) : (
						<div className="sharp-card">
							<p className="eyebrow">While you wait</p>
							<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem", lineHeight: 1.6 }}>
								{handlerFirst} chases every school weekly. A decision shows on its card first. An offer opens Chapter IV · Visa. Nothing is asked of you here.
							</p>
						</div>
					)}
				</div>
			</div>
			{paySheet.sheet}
		</div>
	);
}

/* ========== Tracking. Folded into the Applications chapter ========== */

export function PortalTrackingPage() {
	return <Navigate to="/portal/application" replace />;
}

const TRACK_PIPELINE: SchoolTrackStatus[] = SCHOOL_TRACK_STAGES;

function trackLabel(row: SchoolApplicationTrack): string {
	if (row.status === "Decision Reached" && row.outcome) {
		return SCHOOL_OUTCOME_LABELS[row.outcome];
	}
	return SCHOOL_TRACK_STATUS_LABELS[row.status];
}

/** A signed, short-lived link to one file on a school row, opened in a new tab. */
function SchoolFileLink({ schoolId, kind, label, compact = false }: { schoolId: string; kind: SchoolFileKind; label: string; compact?: boolean }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const open = async () => {
		setBusy(true);
		setError(null);
		try {
			await openInNewTab(schoolsApi.meFileDownloadUrl(schoolId, kind));
		} catch {
			setError("Could not open the file. Please try again.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<button type="button" className={compact ? "plnk plnk--dim" : "btn btn--secondary btn--sm"} onClick={open} disabled={busy}>
				{busy ? "Opening…" : label}
			</button>
			{error ? <span className="muted" style={{ marginLeft: "0.5rem" }}>{error}</span> : null}
		</>
	);
}

function AdmissionLetterViewer({ schoolId, universityName, compact = false }: { schoolId: string; universityName: string; compact?: boolean }) {
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
			// Held until the pre-departure fee milestone. The API says so; show it as it is.
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
				className={compact ? "plnk" : "btn btn--secondary btn--sm"}
				style={compact ? undefined : { display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
			>
				{compact ? null : <span aria-hidden>📄</span>}
				<span>{compact ? "View ↗" : "View admission letter"}</span>
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

/**
 * One school, one card. The same shape while the list is being built,
 * once it is locked with the consultant, and while the file moves. The
 * pipeline (Preparing · Submitted · Decided) is a three-segment rule; the
 * outcome is a corner tag in the client's words; an admitted card is the
 * key card and holds the offer.
 */
function SchoolCard({
	row,
	mode,
	handlerFirst,
	onRemove,
	onAskChange,
	accepted = false,
	anotherAccepted = false,
	onAccept,
}: {
	row: SchoolApplicationTrack;
	mode: "editing" | "locked" | "tracking";
	handlerFirst: string;
	onRemove?: () => void;
	onAskChange?: () => void;
	/** This is the offer the client is going with. */
	accepted?: boolean;
	/** A different offer is already accepted. Accepting this one replaces it. */
	anotherAccepted?: boolean;
	/** Present once decisions are in and the client may choose. */
	onAccept?: () => Promise<void>;
}) {
	const dest = getDestination(row.destinationId);
	const uni = getUniversity(row.universityId);
	const program = getProgram(row.programId);
	const uniName = uni?.name ?? row.universityName ?? "University";
	const progName = program?.name ?? row.programName ?? "";
	const stageIdx = Math.max(0, TRACK_PIPELINE.indexOf(row.status));
	const admittedRow = row.outcome === "Admitted";
	const unsuccessful = row.outcome === "Application Rejected" || row.outcome === "Withdrawn";
	const [accepting, setAccepting] = useState(false);
	const [acceptError, setAcceptError] = useState<string | null>(null);
	const accept = async () => {
		if (!onAccept) return;
		if (anotherAccepted && !window.confirm(`Switch your accepted offer to ${uniName}?`)) return;
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
	const shortDate = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
	const tracking = mode === "tracking";
	const rawNote = tracking ? (row.handlerNote ?? (row.status === "Decision Reached" && row.outcome ? schoolDecisionNote({ outcome: row.outcome, universityName: uniName, programName: progName }) : null)) : null;
	// The consent card below carries the congratulations. The card states the fact.
	const note = rawNote?.replace(/^Congratulations!\s*/, "") ?? null;

	return (
		<div className={`sch${tracking && admittedRow ? " sch--key" : ""}${tracking && unsuccessful ? " sch--dim" : ""}`}>
			<div className="sch__dest">
				<span>
					{dest?.flag} {dest?.name ?? row.destinationId}
					{uni?.city ? ` · ${uni.city}` : ""}
				</span>
				{tracking ? (
					<span className={`ptag${admittedRow ? " ptag--ink" : ""}`}>{accepted ? "★ Your choice" : trackLabel(row)}</span>
				) : mode === "locked" ? (
					<span className="ptag">With {handlerFirst}</span>
				) : row.createdAt ? (
					<span className="ptag">Added {shortDate(row.createdAt)}</span>
				) : null}
			</div>
			<div className="sch__uni">{uniName}</div>
			{progName ? <div className="sch__prog">{progName}</div> : null}
			<div className="sch__meta">
				{row.intake}
				{program?.duration ? ` · ${program.duration}` : ""}
				{row.institutionReference ? ` · ref ${row.institutionReference}` : ""}
			</div>

			{tracking ? (
				<>
					<div className="pipe" aria-label={`Status: ${trackLabel(row)}`}>
						{TRACK_PIPELINE.map((step, i) => (
							<span
								key={step}
								className={i < stageIdx || (i === stageIdx && stageIdx === TRACK_PIPELINE.length - 1) ? "pipe__on" : i === stageIdx ? "pipe__half" : ""}
							/>
						))}
					</div>
					<div className="pipe__l">
						{TRACK_PIPELINE.map((step) => (
							<span key={step}>{SCHOOL_TRACK_STATUS_LABELS[step]}</span>
						))}
					</div>
				</>
			) : null}

			{(!tracking || !admittedRow) && program ? (
				<div className="sch__fee">
					<b>{program.tuition}</b>
					<span>tuition · paid to the university</span>
				</div>
			) : null}

			{tracking && admittedRow ? (
				<div className="offer">
					<span className="offer__k">Your offer</span>
					<div className="offer__row">
						<span>Tuition</span>
						<b>{row.offerTuitionLabel ?? program?.tuition ?? "N/A"}</b>
					</div>
					{row.offerTuitionUsd ? (
						<div className="offer__row offer__row--sub">
							<span />
							<span>≈ {formatDualCurrency(row.offerTuitionUsd)}</span>
						</div>
					) : null}
					{row.offerDepositUsd ? (
						<div className="offer__row">
							<span>
								University deposit
								{row.offerDepositPaidAt ? ` · paid ${shortDate(row.offerDepositPaidAt)}` : row.offerDepositDueAt ? ` · due ${shortDate(row.offerDepositDueAt)}` : ""}
							</span>
							<b>{formatDualCurrency(row.offerDepositUsd)}</b>
						</div>
					) : null}
					<div className="offer__row">
						<span>Offer letter</span>
						{row.offerLetterStorageKey ? (
							<AdmissionLetterViewer schoolId={row.id} universityName={uniName} compact />
						) : (
							<span className="muted">arrives once {handlerFirst} uploads it</span>
						)}
					</div>
					{row.financialNote ? <p className="offer__from">From the university: {row.financialNote}</p> : null}
				</div>
			) : null}

			{note ? <p className="sch__note">{note}</p> : null}

			<div className="sch__act">
				{mode === "editing" && onRemove ? (
					<button type="button" className="plnk plnk--dim" onClick={onRemove}>
						Remove
					</button>
				) : mode === "locked" ? (
					<button type="button" className="plnk plnk--dim" onClick={onAskChange}>
						Ask to change
					</button>
				) : tracking && admittedRow && onAccept ? (
					accepted ? (
						<span className="sch__meta" style={{ margin: 0 }}>★ You accepted this offer · {handlerFirst} takes it from here</span>
					) : (
						<>
							<button type="button" className="btn btn--primary btn--sm" onClick={accept} disabled={accepting}>
								{accepting ? "Saving…" : anotherAccepted ? "Switch to this offer" : "Accept this offer"}
							</button>
							<button type="button" className="plnk plnk--dim" onClick={() => window.dispatchEvent(new CustomEvent("open-chat", { detail: { channel: "support" } }))}>
								Ask {handlerFirst} first
							</button>
						</>
					)
				) : tracking ? (
					<span className="sch__meta" style={{ margin: 0 }}>
						{row.status === "Submitted"
							? `Lodged${shortDate(row.updatedAt) ? ` ${shortDate(row.updatedAt)}` : ""} · replies take 2–6 weeks`
							: row.status === "Decision Reached"
								? `Decided${shortDate(row.updatedAt) ? ` ${shortDate(row.updatedAt)}` : ""}`
								: `${handlerFirst} is preparing the file`}
					</span>
				) : null}
				{tracking && row.submissionProofUrl ? <SchoolFileLink schoolId={row.id} kind="submission-proof" label="Proof of submission" compact /> : null}
			</div>
			{acceptError ? (
				<p className="sch__note" role="alert" style={{ color: "var(--foreground)", fontWeight: 600 }}>
					{acceptError}
				</p>
			) : null}
		</div>
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
	const paySheet = usePaySheet(() => void syncFromServer());
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
				description: "Visa costs. Paid on your behalf, at cost · being prepared",
			};
	const amount = cardInvoice.amount || usdFromCents(visaCostsCentsFor(fees?.catalogue, application.destinationId));

	async function pay() {
		let backend = serverInv && serverInv.balanceCents > 0 ? serverInv : null;
		if (!backend) {
			const { invoices } = await meApi.invoices().catch(() => ({ invoices: [] as ApiInvoice[] }));
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
		paySheet.pay(backend);
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
				? "Consent recorded. Operations is matching your case to a specialist. This page updates automatically."
				: isPendingInvoice
					? `${application.assignedStaffName ? `${application.assignedStaffName} is` : "Your consultant is"} finalising the fee. Payment unlocks here the moment it's issued.`
					: paid
						? "Your visa case opens on the tracking page. Your officer updates it there."
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
							: "Application & processing. The visa chapter."}
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
									<Link to="/portal/application">Applications</Link>. Your visa is prepared for that school.
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
								dedicated visa officer. Once assigned, they'll prepare and issue your official visa
								application fee invoice.
							</p>
							<p className="muted mt-3" style={{ fontSize: "0.8rem" }}>
								Nothing needed from you. This page updates in real time.
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
								display="ghs"
								actions={
									<>
										{serverInv.balanceCents > 0 ? (
											<Button onClick={pay} arrow>
												Pay {formatMoney(serverInv.balanceCents, "ghs")}
											</Button>
										) : null}
										<button type="button" className="doc-link" onClick={() => openInvoiceDocument(serverInv, "invoice")}>
											↓ invoice
										</button>
										{serverInv.payments.length > 0 ? (
											<button type="button" className="doc-link" onClick={() => openInvoiceDocument(serverInv, "receipt")}>
												↓ receipt
											</button>
										) : null}
									</>
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

				{/* the rail. Who and where the case stands */}
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
									{paid ? "Paid ✓" : hasIssuedInvoice ? "Issued. Due" : "Not yet"}
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
							opens: your flight first, then the pre-departure milestone. Your letter and visa
							documents release with the milestone.
						</p>
					</div>
				</div>
			</div>
			{paySheet.sheet}
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
	awaiting_handler: "Visa payment received. We are assigning your consultant. You'll be notified once your consultant is confirmed.",
	pending: "Visa payment received. Your consultant has opened your visa case.",
	biometrics: "Visa case in progress. Attend your biometrics / appointment when scheduled.",
	decision: "Visa case in progress. Awaiting the authority's decision.",
	complete: "Visa approved. Your visa is complete. Continue to travel assistance.",
};

function VisaTrackingInner() {
	const { application } = useAppState();
	const nav = useNavigate();
	// Fetch the real server invoice so the paid check doesn't rely solely on
	// the local `application.visaInvoice.status` (which is only synced when
	// the `visaInvoicePaid` flag is set on the application row). The invoice
	// table is the source of truth. See VisaHubInner for the same pattern.
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
		application.visaStatus === "decision" && application.visaOutcome === "refused" ? "Refused. Your consultant will advise" : "Awaiting the authority's decision";
	const lodgedDetail = [vd.visaType, vd.reference ? `Ref ${vd.reference}` : null, vd.submittedAt ? `Submitted ${day(vd.submittedAt)}` : null]
		.filter(Boolean)
		.join(" · ");
	const appointmentDetail = vd.biometricsAt
		? `Biometrics given ${day(vd.biometricsAt)}`
		: vd.appointmentAt
			? `${when(vd.appointmentAt)}${vd.appointmentCentre ? ` · ${vd.appointmentCentre}` : ""}. Bring your passport and the documents your consultant listed`
			: "Your consultant will tell you when and where";
	const decisionDetail = vd.decidedAt && application.visaStatus === "complete" ? `Approved ${day(vd.decidedAt)}` : refusedDetail;
	const completeDetail =
		vd.validFrom || vd.validTo
			? `Valid ${day(vd.validFrom) ?? "…"} → ${day(vd.validTo) ?? "…"}${vd.collectedAt ? ` · collected ${day(vd.collectedAt)}` : ""}`
			: "Passport back with the visa. Then Departure";
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
						Your payment is confirmed. Century NIT is matching your case to a visa officer. You'll
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

					{/* the checklist. The action item is the underlined one */}
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

					<ConsultantUpdates
						comments={application.comments}
						filter={isVisaUpdate}
						title="Your visa case, as recorded"
						seenKey={`${application.applicationId ?? "case"}:visa`}
						showEmpty
						className="mt-4"
					/>
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
								Being assigned. You'll be notified once your case is open.
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
								? "Chapter V · Departure is open. Your flight first, then the pre-departure milestone."
								: refused
									? "Departure stays closed while the refusal is reviewed. Your consultant will let you know the next step."
									: "Once approved, Chapter V · Departure opens: your flight first, then the pre-departure milestone. Your letter and visa documents release with the milestone."}
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
		iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }).toUpperCase() : "N/A";

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
		{ numeral: "VI", name: "Complete", fact: "File closed. Post-arrival support open", when: day(application.completedAt) },
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

					{/* money, in full. The real invoices */}
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
											<button type="button" className="doc-link" onClick={() => openInvoiceDocument(i, "invoice")}>
												↓ invoice
											</button>
											<button type="button" className="doc-link" onClick={() => openInvoiceDocument(i, "receipt")}>
												↓ receipt
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
							<li style={{ display: "flex", gap: "0.7rem" }}><span className="mono">→</span><span><strong>Check in when you land</strong>. Message your officer through the portal chat; we confirm your arrival with the school.</span></li>
							<li style={{ display: "flex", gap: "0.7rem" }}><span className="mono">→</span><span><strong>Enrolment week</strong>. Report by {day(application.departureDetails?.reportBy) !== "N/A" ? day(application.departureDetails?.reportBy) : "your school's date"}. Your officer watches for issues in the first month.</span></li>
							<li style={{ display: "flex", gap: "0.7rem" }}><span className="mono">→</span><span><strong>Your record stays</strong>. Receipts, letters and the vault remain available here. Come back for a transcript request or a reference any time.</span></li>
						</ul>
					</div>
				</div>

				{/* the rail. Destination, released documents, the people */}
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
							<div className="pkv"><span className="pkv__k">Consultant</span><span className="pkv__v">{booking.consultantName ?? application.assignedStaffName ?? "N/A"}</span></div>
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
				// in the URL. The server resolved it from the session. Re-sync
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
