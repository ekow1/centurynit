import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { CaseWorkPanel } from "./CaseWorkPanel";
import { StaffChatBadge } from "./StaffChatBadge";
import { TaQueueRow } from "./TravelRequestCard";
import { handoffOffersKeep } from "../lib/pendingTasks";
import { listInvoices, issueApplicationInvoice, type ApiInvoice } from "../lib/api";
import { AssignControl, CaseHeader, InvoiceCard, StatusPill } from "century-nit-core/ui";
import { branchName, type MockApplication, type PreDepartureTask } from "century-nit-core/ops";
import {
	ALLOWED_DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,
	JOURNEY_STAGE_LABELS,
	PORTAL_STAGE_LABELS,
	PORTAL_STAGE_ORDER,
	VISA_STAGE_LABELS,
	TRAVEL_STATUS_LABELS,
	type ApplicantDocument,
	canOwnStage,
	schoolDecisionNote,
	type JourneyStage,
	type SchoolApplication,
	type SchoolOutcome,
	type VisaStage,
} from "century-nit-shared";
import { schoolsApi, documentsApi, ApiError } from "century-nit-core/api";

/**
 * One case, one view.
 *
 * Cases, Visa and Travel each used to render their own right-hand detail for
 * the same application — different header, different "assigned" block,
 * notes on some, documents on others. A handler working one case across
 * stages watched it change shape three times. This is the single detail:
 * header, the applicant's own journey, whatever is pending (handoff,
 * invoice), then the stage bodies that apply — schools, visa, travel — and
 * the shared work panel (comments, document requests, assignment).
 *
 * The three pages are now filters over the same list with the same detail.
 */

const VISA_STEPS: { id: VisaStage; label: string }[] = [
	{ id: "pending", label: VISA_STAGE_LABELS.pending },
	{ id: "biometrics", label: VISA_STAGE_LABELS.biometrics },
	{ id: "decision", label: VISA_STAGE_LABELS.decision },
	{ id: "complete", label: VISA_STAGE_LABELS.complete },
];
const VISA_ORDER: VisaStage[] = ["locked", "awaiting_handler", "pending", "biometrics", "decision", "complete"];

const PRE_DEPARTURE_CATEGORIES: Record<string, { label: string; icon: string }> = {
	documents: { label: "Documents", icon: "📄" },
	finances: { label: "Finances", icon: "💳" },
	logistics: { label: "Logistics", icon: "✈️" },
	health: { label: "Health", icon: "🩺" },
};
function preDepartureProgress(tasks?: PreDepartureTask[]): number {
	if (!tasks || tasks.length === 0) return 0;
	return Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100);
}

function InlineSchoolTracker({ appId, school }: { appId: string; school: SchoolApplication }) {
	const { updateSchoolApplication } = useCases();
	const [status, setStatus] = useState<string>(school.status || "Preparing Application");
	const [outcome, setOutcome] = useState<string>(school.outcome || "Admitted");
	const [consultantNote, setConsultantNote] = useState(school.handlerNote ?? "");
	const [sendUpdateEmail, setSendUpdateEmail] = useState(true);

	const [isSaving, setIsSaving] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [uploadPct, setUploadPct] = useState(0);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [hasLetter, setHasLetter] = useState(Boolean(school.offerLetterStorageKey));
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const showOfferFields = status === "Decision Reached" && outcome === "Admitted";
	const showDecisionFields = status === "Decision Reached";

	const effectiveNote = showDecisionFields
		? consultantNote.trim() ||
			(schoolDecisionNote({
				outcome: outcome as SchoolOutcome,
				universityName: school.universityName,
				programName: school.programName,
			}) ?? "")
		: "";

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await updateSchoolApplication(appId, school.id, {
				status: status as any,
				outcome: status === "Decision Reached" ? outcome as any : null,
				sendUpdateEmail: status === "Decision Reached" && sendUpdateEmail,
				handlerNote: consultantNote.trim() || null,
				consultantNote: consultantNote.trim() || null,
			});
		} catch {
			/* handled by hook */
		} finally {
			setIsSaving(false);
		}
	};

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setUploadError(null);

		if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as any)) {
			setUploadError("Upload a PDF, image (JPEG, PNG), or Word document (DOC, DOCX).");
			e.target.value = "";
			return;
		}
		if (file.size > MAX_DOCUMENT_BYTES) {
			setUploadError("That file is larger than 15 MB.");
			e.target.value = "";
			return;
		}

		setUploading(true);
		setUploadPct(0);
		try {
			await schoolsApi.uploadAdmissionLetter(school.id, file, (p) => setUploadPct(p));
			setHasLetter(true);
		} catch (err) {
			const msg =
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: "Could not upload the admission letter.";
			setUploadError(msg);
		} finally {
			setUploading(false);
			e.target.value = "";
		}
	};

	const handleRemoveLetter = async () => {
		setUploading(true);
		setUploadError(null);
		try {
			await schoolsApi.removeAdmissionLetter(school.id);
			setHasLetter(false);
		} catch (err) {
			const msg =
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: "Could not remove the admission letter.";
			setUploadError(msg);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "var(--text-xs)" }}>
			<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
				<select
					className="input input--sm"
					value={status}
					onChange={(e) => setStatus(e.target.value)}
					style={{ width: "auto" }}
				>
					<option value="Preparing Application">Preparing Application</option>
					<option value="Submitted">Submitted</option>
					<option value="Decision Reached">Decision Reached</option>
				</select>

				{status === "Decision Reached" && (
					<select
						className="input input--sm"
						value={outcome}
						onChange={(e) => setOutcome(e.target.value)}
						style={{ width: "auto" }}
					>
						<option value="Admitted">Admitted</option>
						<option value="Waitlisted">Waitlisted</option>
						<option value="Application Rejected">Application Rejected</option>
						<option value="Withdrawn">Withdrawn</option>
					</select>
				)}

				<button
					type="button"
					className="btn btn--primary btn--sm"
					onClick={handleSave}
					disabled={isSaving}
					style={{ marginLeft: "auto" }}
				>
					{isSaving ? "Saving..." : "Update Status"}
				</button>
			</div>

			{showDecisionFields && (
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", padding: "0.75rem", background: "var(--background)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)", marginTop: "0.5rem" }}>
					<p className="eyebrow" style={{ gridColumn: "1 / -1", margin: 0 }}>
						{showOfferFields ? "Offer details" : "Decision update"}
					</p>
					{showOfferFields ? (
						<div style={{ gridColumn: "1 / -1" }}>
							<p className="muted" style={{ marginBottom: "0.15rem" }}>Official admission letter (PDF / image / Word)</p>
							<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
								<input
									ref={fileInputRef}
									type="file"
									accept={ALLOWED_DOCUMENT_TYPES.join(",")}
									onChange={handleFileChange}
									disabled={uploading}
									style={{ fontSize: "var(--text-xs)" }}
								/>
								{hasLetter && !uploading ? (
									<button
										type="button"
										className="btn btn--ghost btn--sm"
										onClick={handleRemoveLetter}
									>
										Remove letter
									</button>
								) : null}
								{uploading ? (
									<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
										Uploading… {uploadPct}%
									</span>
								) : hasLetter ? (
									<span style={{ color: "var(--success, #15803d)", fontSize: "var(--text-xs)" }}>
										✓ Letter uploaded
									</span>
								) : null}
							</div>
							{uploadError ? (
								<p style={{ color: "var(--danger, #b91c1c)", fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
									{uploadError}
								</p>
							) : null}
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
								The letter is stored in the document vault under the applicant's folder and emailed
								to the applicant when “Send status update email” is checked.
							</p>
						</div>
					) : null}
					<div style={{ gridColumn: "1 / -1" }}>
						<p className="muted" style={{ marginBottom: "0.15rem" }}>
							Note to applicant (optional — leave blank to use the automated message)
						</p>
						<textarea
							className="input input--sm"
							placeholder="Leave blank for the automated message, or type a custom note…"
							value={consultantNote}
							onChange={(e) => setConsultantNote(e.target.value)}
							rows={2}
						/>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.15rem", marginTop: "0.5rem" }}>
							Applicant will see in the portal Latest update:
						</p>
						<div
							style={{
								background: "var(--background)",
								border: "1px solid var(--border-light)",
								borderRadius: "var(--radius-md)",
								padding: "0.5rem 0.6rem",
								fontSize: "var(--text-xs)",
								color: "var(--text)",
								whiteSpace: "pre-wrap",
							}}
						>
							{effectiveNote || <span className="muted">Waiting for first handler update…</span>}
						</div>
					</div>
					<div style={{ gridColumn: "1 / -1" }}>
						<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
							<input
								type="checkbox"
								checked={sendUpdateEmail}
								onChange={(e) => setSendUpdateEmail(e.target.checked)}
							/>
							<span>Send status update email to applicant (includes note & admission letter if uploaded)</span>
						</label>
					</div>
				</div>
			)}
		</div>
	);
}

type TabId = "overview" | "consultation" | "application" | "visa" | "travel" | "payments" | "documents" | "activity";

/** The chapter a case is currently in — where the detail opens. */
/** Which tab a portal stage lives on — the case opens where the applicant is. */
const TAB_FOR_PORTAL_STAGE: Record<string, TabId> = {
	new: "consultation",
	consultation: "consultation",
	eligibility: "consultation",
	proceed: "overview",
	school_package: "application",
	awaiting_handler: "application",
	school_select: "application",
	awaiting_invoice: "application",
	application_invoice: "application",
	school_tracking: "application",
	visa_invoice: "visa",
	visa: "visa",
	travel_assistance: "travel",
	payment_execution: "payments",
	completed: "payments",
};

/**
 * The tab a case should open on: the chapter the applicant is currently in
 * (from the derived journey), falling back to the coarse ops stage when the
 * journey has not been computed yet.
 */
function currentTabFor(app: MockApplication): TabId {
	const fromJourney = app.journey?.portalStage ? TAB_FOR_PORTAL_STAGE[app.journey.portalStage] : undefined;
	if (fromJourney) return fromJourney;
	switch (app.stage) {
		case "school_submission":
		case "offer_letter_review":
			return "application";
		case "visa_processing":
			return "visa";
		case "travel_assistance":
			return "travel";
		case "payment_execution":
		case "completed":
			return "payments";
		default:
			return app.proceedStatus === "accepted" ? "application" : "overview";
	}
}

const INVOICE_TYPE_TITLES: Record<string, string> = {
	application: "Application",
	visa: "Visa",
	agency: "Service package",
	travel: "Ticket",
	consultation: "Consultation",
	custom: "Custom",
};

/**
 * One detail for Cases, Visa and Travel. `initialTab` lets a host page open
 * on its own chapter (the Visa queue opens the Visa tab); otherwise the case
 * opens on the chapter the applicant is currently in.
 */
export function CaseDetail({ app, initialTab }: { app: MockApplication; initialTab?: TabId }) {
	const navigate = useNavigate();
	const { opsRole, opsUser, canAssignWork } = useOpsAuth();
	const {
		assignees,
		handoffs,
		travelRequests,
		consultations,
		resolveHandoff,
		assignApplication,
		acceptApplication,
		toggleApplicationChecklist,
		commentOnApplication,
		requestApplicationDocs,
		recordProceed,
		reinviteProceed,
		declineProceed,
		setVisaStage,
		setVisaCounselorNote,
		setTravelClearance,
		togglePreDepartureTask,
		setPaymentPlan,
		setApplicationStage,
		refresh,
	} = useCases();
	const { invoices: allInvoices } = useInvoiceApi();

	const [actionSuccess, setActionSuccess] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [appInvoice, setAppInvoice] = useState<ApiInvoice | null>(null);
	const [appInvoiceLoading, setAppInvoiceLoading] = useState(false);
	const [issuingInvoice, setIssuingInvoice] = useState(false);
	const [invoiceFlash, setInvoiceFlash] = useState<string | null>(null);
	const [noteDraft, setNoteDraft] = useState("");
	const [editingNote, setEditingNote] = useState(false);

	// This case's application and visa invoices (proforma or issued).
	const [visaApiInvoice, setVisaApiInvoice] = useState<ApiInvoice | null>(null);
	useEffect(() => {
		setAppInvoiceLoading(true);
		Promise.all([listInvoices({ type: "application" }), listInvoices({ type: "visa" })])
			.then(([apps, visas]) => {
				setAppInvoice(apps.invoices.find((i) => i.applicationId === app.id) ?? null);
				setVisaApiInvoice(visas.invoices.find((i) => i.applicationId === app.id && i.status !== "void") ?? null);
			})
			.catch(() => {
				setAppInvoice(null);
				setVisaApiInvoice(null);
			})
			.finally(() => setAppInvoiceLoading(false));
	}, [app.id]);

	function handleIssueApplicationInvoice() {
		setIssuingInvoice(true);
		issueApplicationInvoice(app.id)
			.then((updated) => {
				setAppInvoice(updated);
				setInvoiceFlash(`Invoice ${updated.invoiceNumber} issued — applicant can now pay.`);
				window.setTimeout(() => setInvoiceFlash(null), 5000);
			})
			.catch((e) => {
				setInvoiceFlash(e instanceof Error ? e.message : "Failed to issue invoice");
				window.setTimeout(() => setInvoiceFlash(null), 5000);
			})
			.finally(() => setIssuingInvoice(false));
	}

	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;
	const flash = (msg: string) => {
		setActionError(null);
		setActionSuccess(msg);
		window.setTimeout(() => setActionSuccess(null), 4000);
	};
	const fail = (err: unknown, fallback: string) => {
		setActionSuccess(null);
		setActionError(err instanceof Error ? err.message : fallback);
	};

	async function handleAcceptApplication() {
		try {
			const updated = await acceptApplication(app.id);
			flash(`Application ${updated.appId} has been accepted & approved.`);
		} catch (err) {
			fail(err, "Could not accept the application");
		}
	}
	async function handleToggleChecklist(itemIndex: number) {
		const item = app.checklist[itemIndex];
		if (!item) return;
		await toggleApplicationChecklist(app.id, item.id, !item.checked);
	}
	async function handleRecordProceed() {
		const reason = window.prompt("Why are you recording consent on the applicant's behalf?", "");
		if (reason === null || reason.trim() === "") return;
		try {
			await recordProceed(app.appId, reason.trim());
			flash("Applicant consent recorded — the gate is now open.");
		} catch (err) {
			fail(err, "Could not record consent");
		}
	}
	async function handleReinviteProceed() {
		try {
			await reinviteProceed(app.appId);
			flash("Consent gate re-opened for the applicant.");
		} catch (err) {
			fail(err, "Could not re-invite");
		}
	}
	async function handleDeclineProceed() {
		const reason = window.prompt("Record why the applicant is pausing (optional):", "");
		if (reason === null) return;
		try {
			await declineProceed(app.appId, reason);
			flash("Applicant declined to proceed — the case is paused.");
		} catch (err) {
			fail(err, "Could not record decline");
		}
	}

	// Tab state: the host's chapter if it asked for one, else where the case is.
	const [tab, setTab] = useState<TabId>(() => initialTab ?? currentTabFor(app));
	useEffect(() => setTab(initialTab ?? currentTabFor(app)), [app.id, initialTab]);

	// Every invoice on this case (all types), for the Payments tab.
	const [caseInvoices, setCaseInvoices] = useState<ApiInvoice[]>([]);
	useEffect(() => {
		listInvoices({ limit: 200 })
			.then((res) => setCaseInvoices(res.invoices.filter((i) => i.applicationId === app.id && i.status !== "void")))
			.catch(() => setCaseInvoices([]));
	}, [app.id, appInvoice?.status, visaApiInvoice?.status]);

	// The applicant's uploads, for the Documents tab.
	const [docs, setDocs] = useState<ApplicantDocument[]>([]);
	const [docsLoading, setDocsLoading] = useState(false);
	useEffect(() => {
		if (!app.applicantUserId) return;
		setDocsLoading(true);
		documentsApi
			.list({ ownerUserId: app.applicantUserId })
			.then((res) => setDocs(res.documents))
			.catch(() => setDocs([]))
			.finally(() => setDocsLoading(false));
	}, [app.applicantUserId]);

	// Which stage bodies apply to this case.
	const stageIdx = (s: string) => ["document_verification", "school_submission", "offer_letter_review", "visa_processing", "travel_assistance", "payment_execution", "completed"].indexOf(s);
	const visaInvoice = allInvoices.find((i) => i.type === "Visa" && i.applicationId === app.id);
	const showVisa = (app.visaStage && app.visaStage !== "locked") || stageIdx(app.stage) >= stageIdx("visa_processing") || Boolean(visaInvoice);
	const selectedTa = travelRequests.find((t) => t.applicationId === app.id) ?? null;
	const showTravel = Boolean(selectedTa) || stageIdx(app.stage) >= stageIdx("travel_assistance");
	const canIssueTravelInvoice = opsRole === "manager" || opsRole === "coordinator" || opsRole === "admin" || opsRole === "super_admin";
	const pdProg = preDepartureProgress(app.preDepartureTasks);
	const pdCats = Object.keys(PRE_DEPARTURE_CATEGORIES);

	function advanceVisa() {
		const cur = app.visaStage ?? "locked";
		if (cur === "awaiting_handler") return;
		const next = VISA_ORDER[VISA_ORDER.indexOf(cur) + 1];
		if (next) setVisaStage(app.appId, next);
	}
	function saveNote() {
		if (noteDraft.trim()) {
			setVisaCounselorNote(app.appId, noteDraft.trim());
			setEditingNote(false);
			setNoteDraft("");
		}
	}

	// ── Tabs: one per chapter of the case, unlocked as the case reaches it ──
	const stageIndex = stageIdx(app.stage);
	const consultation = consultations.find((c) => c.id === app.consultationId) ?? null;
	const hasAdmitted = (app.schoolApplications ?? []).some((s) => s.outcome === "Admitted");
	const tabs: { id: TabId; label: string; locked: boolean; hint?: string }[] = [
		{ id: "overview", label: "Overview", locked: false },
		{ id: "consultation", label: "Consultation", locked: !consultation, hint: "Opened from a consultation" },
		{
			id: "application",
			label: "Application",
			locked: !(app.proceedStatus === "accepted" || app.depositPaid || stageIndex >= stageIdx("school_submission")),
			hint: "Unlocks when the applicant consents to proceed",
		},
		{ id: "visa", label: "Visa", locked: !showVisa && !hasAdmitted, hint: "Unlocks on the first admission" },
		{ id: "travel", label: "Travel", locked: !showTravel && app.visaStage !== "complete", hint: "Unlocks when the visa is complete" },
		{ id: "payments", label: "Payments", locked: false },
		{ id: "documents", label: "Documents", locked: false },
		{ id: "activity", label: "Activity", locked: false },
	];
	const isLocked = (id: TabId) => tabs.find((t) => t.id === id)?.locked ?? false;
	// A locked request (e.g. the Visa queue opening a case whose visa has not
	// started) falls back to the chapter the case is actually in.
	const stageTab = currentTabFor(app);
	const current = !isLocked(tab) ? tab : !isLocked(stageTab) ? stageTab : "overview";

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
			{actionSuccess && <p className="ops-modal__foot" style={{ margin: 0 }}>{actionSuccess}</p>}
			{actionError && <p className="ops-modal__error" style={{ margin: 0 }}>{actionError}</p>}
{(() => {
								return (
									<div className="card" style={{ padding: "0.75rem 1rem" }}>
										<CaseHeader
											name={app.applicantName}
											reference={app.appId}
											branch={app.branch}
											stage={app.stage}
											portalStage={app.journey?.portalStage ?? null}
											handlerName={app.assignedStaff || null}
											extra={[
												{ label: "Country", value: app.country || "—" },
												{ label: "Programme", value: app.program || "—" },
											]}
										/>
									</div>
								);
							})()}

			<div className="cn-tabs" role="tablist">
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={current === t.id}
						aria-disabled={t.locked}
						title={t.locked ? t.hint : undefined}
						className={`cn-tab${current === t.id ? " cn-tab--active" : ""}${t.locked ? " cn-tab--locked" : ""}`}
						onClick={() => !t.locked && setTab(t.id)}
					>
						{t.locked && <span aria-hidden>🔒 </span>}
						{t.label}
						{t.id === stageTab && !t.locked && <span className="cn-tab__now" title="Current stage" aria-label="current stage" />}
					</button>
				))}
			</div>

			{current === "overview" && (
				<>
							{(() => {
								if (!app?.journey) return null;
								// The applicant's own journey, from the same derivation the
								// portal reads — what the client sees is what we see.
								const { journey } = app;
								const steps = PORTAL_STAGE_ORDER.filter((id) => id !== "new").map((id) => ({
									id,
									label: PORTAL_STAGE_LABELS[id],
									status: journey.stageStatuses[id] ?? "locked",
								}));
								const tone = {
									done: { bg: "#dcfce7", fg: "#16a34a", mark: "✓" },
									current: { bg: "#fef3c7", fg: "#d97706", mark: "●" },
									skipped: { bg: "#fee2e2", fg: "#b91c1c", mark: "↷" },
									locked: { bg: "#f3f4f6", fg: "#9ca3af", mark: "○" },
								} as const;
								return (
									<div className="card" style={{ padding: "0.75rem 1rem" }}>
										<p className="eyebrow mb-1" style={{ fontSize: "var(--text-xs)" }}>Applicant's journey</p>
										<p style={{ fontWeight: 600, fontSize: "var(--text-sm)", margin: "0 0 0.5rem" }}>
											{journey.label}
											{journey.nextUnlock && (
												<span className="muted" style={{ fontWeight: 400 }}> · next: {journey.nextUnlock}</span>
											)}
										</p>
										<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
											{steps.map((s) => (
												<span
													key={s.id}
													title={s.status === "skipped" ? "Passed without its signal being met" : s.status}
													style={{
														fontSize: "var(--text-xs)",
														padding: "0.2rem 0.5rem",
														borderRadius: "var(--radius-sm)",
														background: tone[s.status].bg,
														color: tone[s.status].fg,
														fontWeight: s.status === "current" ? 700 : s.status === "locked" ? 400 : 600,
													}}
												>
													{tone[s.status].mark} {s.label}
												</span>
											))}
										</div>
									</div>
								);
							})()}
							{(() => {
								// Any pending handoff on this case — school, visa, travel or
								// finance — not just the school one.
								const handoff = handoffs.find((h) => h.applicationId === app.id && h.status === "pending");
								if (!handoff) return null;
								const stageLabel = JOURNEY_STAGE_LABELS[handoff.stage as JourneyStage] ?? handoff.stage;
								const why =
									handoff.source === "deposit_payment"
										? "10% deposit received — this case needs a handler before school selection can proceed."
										: handoff.source === "visa_payment" || handoff.source === "visa_consent_continue"
											? "The applicant is ready for visa processing — assign a visa specialist."
											: handoff.source === "offboarding"
												? "The previous handler has left — this stage needs a new owner."
												: `This case needs a handler for ${stageLabel}.`;
								return (
									<div className="card">
										<p className="eyebrow mb-1">Handler assignment required · {stageLabel}</p>
										<p className="mt-2" style={{ fontSize: "var(--text-sm)" }}>{why}</p>
										<div className="mt-3">
											<AssignControl
												stage={handoff.stage}
												staff={assignees}
												branch={app.branch}
												currentName={null}
												keepName={handoffOffersKeep(handoff) ? handoff.fromOpsUserName : null}
												withReason
												onAssign={(opsUserId, reason) =>
													resolveHandoff(handoff.id, "assign", { opsUserId, reason }).then(() => navigate("/applications"))
												}
												onKeep={(reason) => resolveHandoff(handoff.id, "keep", { reason }).then(() => navigate("/applications"))}
											/>
										</div>
									</div>
								);
							})()}
							{app.proceedStatus !== "accepted" && (
								<div className="card" style={{ background: "var(--muted)" }}>
									<p className="eyebrow mb-1">Consent Gate</p>
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
										<div>
											<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
												{app.proceedStatus === "paused"
													? "Applicant placed application on hold (Paused)"
													: app.proceedStatus === "declined"
														? "Applicant opted out (Declined)"
														: "Awaiting the applicant's consent to proceed"}
											</p>
											<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
												{app.proceedStatus === "paused"
													? "The applicant placed this case on hold. They can resume anytime from their portal, or you can record consent / re-invite them."
													: app.proceedStatus === "declined"
														? "The case is opted out. Re-invite to let the applicant reopen it, or record consent on their behalf."
														: "The applicant must confirm in the portal before document verification can advance."}
											</p>
										</div>
										<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
											<button onClick={() => void handleRecordProceed()} className="btn btn--primary" style={{ whiteSpace: "nowrap" }}>
												Record consent (override)
											</button>
											{app.proceedStatus === "invited" && (
												<button onClick={() => void handleDeclineProceed()} className="btn btn--ghost" style={{ whiteSpace: "nowrap" }}>
													Record decline
												</button>
											)}
											{(app.proceedStatus === "declined" || app.proceedStatus === "paused") && (
												<button onClick={() => void handleReinviteProceed()} className="btn btn--ghost" style={{ whiteSpace: "nowrap" }}>
													Re-invite applicant
												</button>
											)}
										</div>
									</div>
								</div>
							)}
							{app.status !== "Accepted" && (
								<div className="card" style={{ background: "var(--muted)" }}>
									<p className="eyebrow mb-1">Application Lifecycle Action</p>
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
										<div>
											<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
												Status: {app.status}
											</p>
											<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
												Accepting will mark this application as Approved & create/activate the Applicant record.
											</p>
										</div>
										<button
											onClick={() => handleAcceptApplication()}
											className="btn btn--primary"
											style={{ whiteSpace: "nowrap" }}
										>
											✓ Accept & Approve
										</button>
									</div>
								</div>
							)}
								{/* Target & Assignment */}
								<div className="card">
									<p className="eyebrow mb-3">Assignment</p>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
										<div style={{ gridColumn: "1 / -1" }}>
											<p className="muted" style={{ fontSize: "var(--text-xs)" }}>Assigned Staff</p>
											<p>
												<StaffChatBadge
													opsUserId={opsUserIdByEmail(app.assignedStaffEmail)}
													name={app.assignedStaff}
													email={app.assignedStaffEmail}
												/>
											</p>
										</div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Branch</p><p>{branchName(app.branch)}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Funding Track</p><p>{app.fundingTrack}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target Schools</p><p>{app.targetSchoolCount ? `${app.targetSchoolCount} institution${app.targetSchoolCount === 1 ? "" : "s"}` : "Not specified"}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Submitted Date</p><p>{app.submittedDate}</p></div>
									</div>
									{app.consultationId ? (
										<p style={{ fontSize: "var(--text-xs)", marginTop: "0.75rem" }}>
											<button
												type="button"
												className="link-arrow"
												onClick={() => navigate(`/consultations?id=${app.consultationId}`)}
											>
												← Opened from consultation {app.consultationNumber || app.consultationId.slice(0, 8).toUpperCase()}
											</button>
										</p>
									) : null}
								</div>
								{/* Staff Internal Notes */}
								<div className="card">
									<p className="eyebrow mb-2">Staff Case Notes</p>
									<p style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{app.notes}</p>
								</div>
				</>
			)}

			{current === "consultation" && consultation && (
				<>
					<div className="card">
						<p className="eyebrow mb-2">Consultation {consultation.ref}</p>
						<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Officer</p><p>{consultation.assignedOfficer || "—"}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>When</p><p>{consultation.dateTime}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Type</p><p>{consultation.type}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Status</p><p>{consultation.status}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target country</p><p>{consultation.targetCountry || "—"}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Degree level</p><p>{consultation.goals?.degreeLevel || app.degreeLevel || "—"}</p></div>
						</div>
						<p style={{ fontSize: "var(--text-xs)", marginTop: "0.75rem" }}>
							<button type="button" className="link-arrow" onClick={() => navigate(`/consultations?id=${consultation.id}`)}>
								Open consultation →
							</button>
						</p>
					</div>
					<div className="card">
						<p className="eyebrow mb-2">Assessment & recommendation</p>
						{consultation.assessmentResult ? (
							<>
								<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{consultation.assessmentResult.outcome}</p>
								{consultation.assessmentResult.notes && (
									<p className="muted mt-1" style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{consultation.assessmentResult.notes}</p>
								)}
								<div className="ops-grid mt-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Recommended country</p><p>{consultation.assessmentResult.recCountry || "—"}</p></div>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Recommended university</p><p>{consultation.assessmentResult.recUniversity || "—"}</p></div>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Recommended programme</p><p>{consultation.assessmentResult.recProgram || "—"}</p></div>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Recommended package</p><p>{consultation.assessmentResult.recPackage || "—"}</p></div>
								</div>
							</>
						) : (
							<p className="muted" style={{ fontSize: "var(--text-sm)" }}>The assessment has not been completed yet.</p>
						)}
						{(consultation.requestedDocuments?.length ?? 0) > 0 && (
							<p className="muted mt-3" style={{ fontSize: "var(--text-xs)" }}>
								Documents requested at consultation: {consultation.requestedDocuments!.join(", ")}
							</p>
						)}
					</div>
				</>
			)}

			{current === "application" && (
				<>
					<div className="card">
						<p className="eyebrow mb-2">Package & deposit</p>
						<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Package</p><p>{app.fundingTrack || "Not chosen"}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target schools</p><p>{app.targetSchoolCount ? `${app.targetSchoolCount} institution${app.targetSchoolCount === 1 ? "" : "s"}` : "Not specified"}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>10% deposit</p><p>{app.depositPaid ? "Paid" : "Not paid"}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Handler</p><p>{app.assignedStaff || "Unassigned"}</p></div>
						</div>
						{caseInvoices.find((i) => i.type === "agency") && (
							<div className="mt-3">
								<InvoiceCard
									compact
									title="Service package invoice"
									invoice={caseInvoices.find((i) => i.type === "agency")!}
									actions={
										<Link to={`/invoices?open=${caseInvoices.find((i) => i.type === "agency")!.id}`} className="btn btn--sm btn--ghost">
											Open in Invoices →
										</Link>
									}
								/>
							</div>
						)}
					</div>
							{(() => {
								if (app.appFeePaid) return null;

								const isProforma = appInvoice?.status === "proforma";
								const schools = app.schoolApplications?.length ?? 0;

								return (
									<div className="card">
										{invoiceFlash && (
											<p className="mb-2" style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{invoiceFlash}</p>
										)}
										{appInvoiceLoading ? (
											<p className="muted" style={{ fontSize: "var(--text-sm)" }}>Loading invoice…</p>
										) : !appInvoice ? (
											<>
												<p className="eyebrow mb-1">Application invoice</p>
												<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
													No invoice yet — {schools === 0 ? "no schools selected" : `${schools} school(s) selected`}
												</p>
												<p className="muted" style={{ fontSize: "var(--text-xs)" }}>
													Issue the application fee invoice so the applicant can pay. Per-school line items are added as schools are selected.
												</p>
												<div className="mt-3" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
													<button type="button" className="btn btn--sm btn--primary" onClick={handleIssueApplicationInvoice} disabled={issuingInvoice}>
														{issuingInvoice ? "Issuing…" : "Issue application invoice"}
													</button>
												</div>
											</>
										) : (
											<InvoiceCard
												title="Application invoice"
												invoice={appInvoice}
												hint={isProforma ? "The applicant cannot pay until you review and issue this invoice." : undefined}
												actions={
													isProforma ? (
														<Link to={`/invoices?open=${appInvoice.id}`} className="btn btn--sm btn--primary">
															Review & issue
														</Link>
													) : (
														<Link to={`/invoices?open=${appInvoice.id}`} className="btn btn--sm btn--ghost">
															Open in Invoices →
														</Link>
													)
												}
											/>
										)}
									</div>
								);
							})()}
								{/* School Applications */}
								<div className="card">
									<p className="eyebrow mb-3">School Applications</p>
									{(() => {
										const schools = app.schoolApplications ?? [];
										const total = schools.length;
										const admitted = schools.filter((s) => s.outcome === "Admitted").length;
										const pending = schools.filter((s) => s.status !== "Decision Reached").length;
										const rejected = schools.filter((s) => s.outcome === "Application Rejected" || s.outcome === "Withdrawn").length;
										return (
											<div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
												<span>{total} school{total !== 1 ? "s" : ""}</span>
												{admitted > 0 ? <span style={{ color: "#16a34a", fontWeight: 600 }}>{admitted} admitted</span> : null}
												{pending > 0 ? <span>{pending} pending</span> : null}
												{rejected > 0 ? <span style={{ color: "#dc2626" }}>{rejected} rejected/declined</span> : null}
											</div>
										);
									})()}
									{app.schoolApplications && app.schoolApplications.length > 0 ? (
										<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
											{app.schoolApplications.map((s) => {
												const displayName = s.universityName || s.universityId;
												const displayProgram = s.programName || s.programId;
												const displayCountry = s.countryName || s.destinationId;
												const admitted = s.outcome === "Admitted";
												return (
													<div
														key={s.id}
														style={{
															padding: "0.6rem 0.75rem",
															border: admitted ? "2px solid #16a34a" : "1px solid var(--border-light)",
															background: admitted ? "#f0fdf4" : "transparent",
															borderRadius: "var(--radius-md)",
														}}
													>
														<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
															<div style={{ width: "100%" }}>
																<p style={{ fontWeight: 500 }}>{displayName}</p>
																<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.5rem" }}>{displayProgram} · {displayCountry} · {s.intake}</p>
																<InlineSchoolTracker appId={app.appId} school={s} />
															</div>
														</div>
													</div>
												);
											})}
										</div>
									) : (
										<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No schools have been selected yet.</p>
									)}
								</div>
								{/* Document Checklist */}
								<div className="card">
									<p className="eyebrow mb-3">Verification Checklist</p>
									<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
										{app.checklist.map((item, idx) => (
											<label
												key={item.id}
												style={{
													display: "flex",
													alignItems: "center",
													gap: "0.75rem",
													fontSize: "var(--text-sm)",
													cursor: "pointer",
													padding: "0.5rem",
													border: "1px solid var(--border-light)",
												}}
											>
												<input
													type="checkbox"
													checked={item.checked}
													onChange={() => handleToggleChecklist(idx)}
												/>
												<span style={{ textDecoration: item.checked ? "line-through" : "none", opacity: item.checked ? 0.7 : 1 }}>
													{item.label}
												</span>
											</label>
										))}
									</div>
								</div>
				</>
			)}

			{current === "visa" && (
				<>
					<div className="card">
						<p className="eyebrow mb-1">Visa consent</p>
						<p style={{ fontSize: "var(--text-sm)" }}>
							{app.visaConsent?.decision === "continue"
								? "The applicant has consented to visa processing."
								: app.visaConsent?.decision === "hold"
									? "The applicant put the visa stage on hold."
									: app.visaConsent?.decision === "opt_out"
										? "The applicant opted out of visa processing."
										: "Awaiting the applicant's decision to continue with visa processing."}
						</p>
					</div>
{/* Visa invoice — the same card as every other invoice */}
					<div className="card">
						{visaApiInvoice ? (
							<InvoiceCard
								title="Visa invoice"
								invoice={visaApiInvoice}
								hint={visaApiInvoice.status === "proforma" ? "The applicant cannot pay until this is reviewed and issued." : undefined}
								actions={
									<Link to={`/invoices?open=${visaApiInvoice.id}`} className="btn btn--sm btn--ghost">
										{visaApiInvoice.status === "proforma" ? "Review & issue" : "Open in Invoices →"}
									</Link>
								}
							/>
						) : (
							<>
								<p className="eyebrow mb-1">Visa invoice</p>
								<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
									{app.visaInvoicePaid
										? "Recorded as paid — record the real invoice in Invoices."
										: "Issued automatically when the applicant consents to the visa stage and a specialist is assigned."}
								</p>
							</>
						)}
					</div>

					{/* Visa Tracking Steps */}
								<div className="card">
									<p className="eyebrow mb-3">Visa Tracking</p>
									{app.visaStage === "awaiting_handler" ? (
										(() => {
											const handoff = handoffs.find(
												(h) => h.applicationId === app.id && h.status === "pending" && h.stage === "visa_processing",
											);
											const canResolve = opsRole === "manager" || opsRole === "coordinator" || opsRole === "admin" || opsRole === "super_admin";
											return (
												<div className="card" style={{ padding: "0.75rem 1rem" }}>
													<p className="eyebrow mb-1">Awaiting visa specialist</p>
													<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
														The applicant is ready for visa processing. Assign a specialist to open tracking.
													</p>
													{handoff && canResolve ? (
														<div className="mt-3">
															<AssignControl
																stage="visa_processing"
																staff={assignees}
																branch={app.branch}
																keepName={handoffOffersKeep(handoff) ? handoff.fromOpsUserName : null}
																onAssign={(opsUserId, reason) => resolveHandoff(handoff.id, "assign", { opsUserId, reason })}
																onKeep={(reason) => resolveHandoff(handoff.id, "keep", { reason })}
															/>
														</div>
													) : (
														<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>A manager or coordinator assigns the specialist.</p>
													)}
												</div>
											);
										})()
									) : (
										<>
										<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
										{VISA_STEPS.map((s, i) => {
											const curIdx = app.visaStage ? VISA_ORDER.indexOf(app.visaStage) : -1;
											const stepIdx = VISA_ORDER.indexOf(s.id);
											const done = curIdx >= stepIdx && app.visaStage !== "locked";
											const current = app.visaStage === s.id;
											return (
												<div
													key={s.id}
													style={{
														display: "flex",
														alignItems: "center",
														gap: "0.75rem",
														padding: "0.6rem 0.75rem",
														border: "1px solid var(--border-light)",
														opacity: done ? 1 : 0.5,
													}}
												>
													<span style={{
														width: "28px",
														height: "28px",
														flexShrink: 0,
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														fontSize: "0.72rem",
														fontWeight: 700,
														fontFamily: "var(--font-mono)",
														border: "2px solid",
														borderColor: done ? "#22c55e" : current ? "#06b6d4" : "var(--border)",
														borderRadius: "50%",
														color: done ? "#fff" : current ? "#06b6d4" : "var(--muted-foreground)",
														background: done ? "#22c55e" : "transparent",
													}}>
														{done ? "\u2713" : i + 1}
													</span>
													<div style={{ flex: 1 }}>
														<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.label}</p>
													</div>
													{current && app.visaStage !== "complete" && (
														<button
															onClick={() => advanceVisa()}
															className="btn btn--ghost btn--sm"
															style={{ fontSize: "var(--text-xs)", padding: "0.2rem 0.6rem" }}
														>
															{"\u2192"} {VISA_STEPS[i + 1]?.label ?? "next"}
														</button>
													)}
												</div>
											);
										})}
									</div>
									</>
									)}
								</div>

								{/* Counselor Note */}
								<div className="card">
									<p className="eyebrow mb-2">Counselor Note</p>
									{app.visaCounselorNote && !editingNote ? (
										<div>
											<p style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{app.visaCounselorNote}</p>
											<button
												onClick={() => { setEditingNote(true); setNoteDraft(app.visaCounselorNote ?? ""); }}
												className="btn btn--ghost btn--sm"
												style={{ marginTop: "0.5rem", fontSize: "var(--text-xs)" }}
											>
												Edit note
											</button>
										</div>
									) : (
										<div>
											<textarea
												value={noteDraft}
												onChange={(e) => setNoteDraft(e.target.value)}
												placeholder="Add a counselor note..."
												rows={3}
												className="input"
												style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
											/>
											<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
												<button
													onClick={saveNote}
													className="btn btn--primary btn--sm"
													disabled={!noteDraft.trim()}
												>
													Save note
												</button>
												{editingNote && (
													<button
														onClick={() => { setEditingNote(false); setNoteDraft(""); }}
														className="btn btn--ghost btn--sm"
													>
														Cancel
													</button>
												)}
											</div>
										</div>
									)}
								</div>
{app.visaStage === "complete" && (
							<div className="card" style={{ background: "#dcfce7", borderColor: "#86efac" }}>
								<p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "#166534" }}>Visa approved</p>
								<p style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem", color: "#166534" }}>
									This visa case is complete — the applicant can proceed to the payment plan. Advance this
									case to Payment Execution on the Workflow board when ready.
								</p>
							</div>
						)}
				</>
			)}

			{current === "travel" && (
				<>
					<div className="card">
						<p className="eyebrow mb-1">Travel decision</p>
						<p style={{ fontSize: "var(--text-sm)" }}>
							{selectedTa
								? TRAVEL_STATUS_LABELS[selectedTa.status] ?? selectedTa.status
								: app.visaStage === "complete"
									? "Awaiting the applicant's decision on travel assistance."
									: "Opens once the visa is complete."}
						</p>
					</div>
					{selectedTa && (
						<div className="card">
							<p className="eyebrow mb-2">Travel request</p>
							<TaQueueRow
								ta={selectedTa}
								staff={assignees}
								branch={app.branch}
								canIssue={canIssueTravelInvoice}
								onChanged={() => void refresh()}
							/>
						</div>
					)}
{/* Travel Clearance */}
							{(app.stage === "travel_assistance" || app.stage === "completed") && (
								<div className="card" style={{ background: "var(--muted)" }}>
									<p className="eyebrow mb-1">Travel Clearance</p>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap", gap: "0.75rem" }}>
											<div>
												<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
													{app.travelClearance === "cleared" ? "Cleared for travel" : "Pending clearance"}
												</p>
												<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
													{app.travelClearance === "cleared"
														? "Applicant is cleared for departure."
														: "Grant clearance once all checks are satisfied."}
												</p>
											</div>
										{app.stage === "travel_assistance" && (
											<button
												onClick={() => setTravelClearance(app.appId, app.travelClearance !== "cleared")}
												className={`btn btn--sm ${app.travelClearance === "cleared" ? "btn--ghost" : "btn--primary"}`}
												style={{ whiteSpace: "nowrap" }}
											>
												{app.travelClearance === "cleared" ? "Revoke clearance" : "Grant clearance"}
											</button>
										)}
										</div>
									</div>
								)}

							{/* Pre-departure Checklist */}
							{(app.stage === "travel_assistance" || app.stage === "completed") && (
									<div className="card">
										<p className="eyebrow mb-2">Pre-departure Checklist</p>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
											<span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
												{app.preDepartureTasks?.filter((t) => t.done).length ?? 0}/{app.preDepartureTasks?.length ?? 0} tasks
											</span>
											<span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", fontWeight: 600, color: pdProg === 100 ? "#22c55e" : "var(--muted-foreground)" }}>
												{pdProg}%
											</span>
										</div>
										<div style={{ height: "6px", background: "var(--muted)", borderRadius: "999px", overflow: "hidden", marginBottom: "1rem" }}>
											<div style={{ width: `${pdProg}%`, height: "100%", background: pdProg === 100 ? "#22c55e" : "#f97316", transition: "width 0.4s ease" }} />
										</div>

										{app.preDepartureTasks && app.preDepartureTasks.length > 0 ? (
											<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
												{pdCats.map((cat) => {
													const tasks = app.preDepartureTasks!.filter((t) => t.category === cat);
													if (tasks.length === 0) return null;
													const catDone = tasks.filter((t) => t.done).length;
													return (
														<div key={cat} style={{ border: "1px solid var(--border-light)", padding: "0.75rem", borderRadius: "4px" }}>
															<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
																<span style={{ fontSize: "0.9rem" }}>{PRE_DEPARTURE_CATEGORIES[cat].icon}</span>
																<div>
																	<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{PRE_DEPARTURE_CATEGORIES[cat].label}</p>
																	<p className="muted" style={{ fontSize: "var(--text-xs)" }}>{catDone}/{tasks.length} complete</p>
																</div>
															</div>
															<div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
																{tasks.map((task) => (
																	<div
																		key={task.id}
																		onClick={() => app.stage === "travel_assistance" && togglePreDepartureTask(app.appId, task.id)}
																		style={{
																			display: "flex",
																			alignItems: "flex-start",
																			gap: "0.5rem",
																			padding: "0.4rem",
																			cursor: app.stage === "travel_assistance" ? "pointer" : "default",
																			border: "1px solid var(--border-light)",
																		}}
																	>
																		<span style={{
																			width: "18px",
																			height: "18px",
																			flexShrink: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center",
																			fontSize: "0.65rem",
																			fontWeight: 700,
																			border: "2px solid",
																			borderColor: task.done ? "#22c55e" : "var(--border)",
																			borderRadius: "3px",
																			color: task.done ? "#fff" : "transparent",
																			background: task.done ? "#22c55e" : "transparent",
																		}}>
																			{task.done ? "\u2713" : ""}
																		</span>
																		<div>
																			<p style={{ fontWeight: task.done ? 400 : 500, fontSize: "var(--text-xs)", textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.6 : 1 }}>
																				{task.label}
																			</p>
																			<p className="muted" style={{ fontSize: "0.68rem" }}>{task.detail}</p>
																		</div>
																	</div>
																))}
															</div>
														</div>
													);
												})}
											</div>
										) : (
											<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No pre-departure tasks assigned yet.</p>
										)}
									</div>
								)}

						{app.stage === "travel_assistance" && app.agencySettled && app.travelClearance === "cleared" && pdProg === 100 && (
							<div className="card" style={{ background: "#dcfce7", borderColor: "#86efac" }}>
								<p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "#166534" }}>All clear</p>
								<p style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem", color: "#166534" }}>
									All milestones complete. Use the Workflow board to mark the case as Completed.
								</p>
							</div>
						)}
				</>
			)}

			{current === "payments" && (
				<>
					<div className="card">
						<p className="eyebrow mb-2">Payment plan & service fee</p>
						<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Plan</p><p>{app.paymentPlanId === "full" ? "Full payment" : app.paymentPlanId === "installment" ? "Installments" : "Not chosen"}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Milestones paid</p><p>{app.agencyStageIndex ?? 0} · {app.agencySettled ? "settled" : "outstanding"}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Application fee</p><p>{app.appFeePaid ? "Paid" : "Unpaid"}</p></div>
							<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Visa invoice</p><p>{app.visaInvoicePaid ? "Paid" : "Unpaid"}</p></div>
						</div>
						<p className="muted mt-3" style={{ fontSize: "var(--text-xs)" }}>
							Paid state follows the ledger: record payments against the invoice below and these figures update.
						</p>
						{app.stage === "payment_execution" && (
							<div className="mt-3" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
								{!app.paymentPlanId && (
									<>
										<button type="button" className="btn btn--sm btn--ghost" onClick={() => void setPaymentPlan(app.appId, "full")}>Record plan: full</button>
										<button type="button" className="btn btn--sm btn--ghost" onClick={() => void setPaymentPlan(app.appId, "installment")}>Record plan: installments</button>
									</>
								)}
								<button
									type="button"
									className="btn btn--sm btn--primary"
									onClick={() => void setApplicationStage(app.appId, "completed").then(() => flash("Case marked complete.")).catch((e) => fail(e, "Could not complete the case"))}
								>
									Mark case complete
								</button>
							</div>
						)}
					</div>
					{caseInvoices.length === 0 ? (
						<div className="card"><p className="muted" style={{ fontSize: "var(--text-sm)" }}>No invoices on this case yet.</p></div>
					) : (
						caseInvoices.map((inv) => (
							<div className="card" key={inv.id}>
								<InvoiceCard
									compact
									title={`${INVOICE_TYPE_TITLES[inv.type] ?? inv.type} invoice`}
									invoice={inv}
									actions={
										<Link to={`/invoices?open=${inv.id}`} className="btn btn--sm btn--ghost">
											{inv.status === "proforma" ? "Review & issue" : "Open in Invoices →"}
										</Link>
									}
								/>
							</div>
						))
					)}
				</>
			)}

			{current === "documents" && (
				<>
					<div className="card">
						<p className="eyebrow mb-2">Requested from the applicant</p>
						{(app.requestedDocuments?.length ?? 0) > 0 ? (
							<ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "var(--text-sm)" }}>
								{app.requestedDocuments!.map((d) => <li key={d}>{d}</li>)}
							</ul>
						) : (
							<p className="muted" style={{ fontSize: "var(--text-sm)" }}>Nothing requested yet — use Activity → Request documents.</p>
						)}
					</div>
					<div className="card">
						<p className="eyebrow mb-2">Uploaded</p>
						{docsLoading ? (
							<p className="muted" style={{ fontSize: "var(--text-sm)" }}>Loading…</p>
						) : docs.length === 0 ? (
							<p className="muted" style={{ fontSize: "var(--text-sm)" }}>The applicant has not uploaded any documents.</p>
						) : (
							<table className="ops-table" style={{ width: "100%", fontSize: "var(--text-sm)" }}>
								<thead><tr><th>Type</th><th>File</th><th>Status</th><th>Uploaded</th></tr></thead>
								<tbody>
									{docs.map((d) => (
										<tr key={d.id}>
											<td>{d.documentType}</td>
											<td>{d.fileName}</td>
											<td><StatusPill tone={d.status === "VERIFIED" ? "done" : d.status === "REJECTED" ? "blocked" : d.status === "UPLOADED" ? "waiting" : "neutral"}>{d.status.replace(/_/g, " ").toLowerCase()}</StatusPill></td>
											<td>{d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : "—"}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
						{app.applicantUserId && (
							<p style={{ fontSize: "var(--text-xs)", marginTop: "0.75rem" }}>
								<Link to={`/documents?owner=${app.applicantUserId}`} className="link-arrow">Review in Document Vault →</Link>
							</p>
						)}
					</div>
				</>
			)}

			{current === "activity" && (
				<>
							<CaseWorkPanel
									kind="application"
									assignedName={app.assignedStaff}
									assignedEmail={app.assignedStaffEmail}
									comments={app.comments ?? []}
									requestedDocuments={app.requestedDocuments ?? []}
									canAssign={canAssignWork}
									pendingHandoffNote={
										handoffs.find(
											(h) => h.applicationId === app.id && h.status === "pending" && h.stage === "school_submission",
										)
											? "Resolve the handler assignment above first"
											: undefined
									}
									actor={opsUser?.name ?? "Staff"}
									isMine={app.assignedStaffEmail === opsUser?.email}
									assignees={assignees.filter((a) => canOwnStage(a.role, "school_submission"))}
									onAssign={(to) => void assignApplication(app.id, to)}
									onComment={(kind, text) =>
										void commentOnApplication(app.id, kind, text)
									}
									onRequestDocs={(docs) =>
										void requestApplicationDocs(app.id, docs)
									}
								/>

				</>
			)}
		</div>
	);
}
