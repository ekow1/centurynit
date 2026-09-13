import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "../OpsAuthContext";
import { useCases } from "../../hooks/useCases";
import { useInvoiceApi } from "../../hooks/useInvoiceApi";

import { CaseDocumentsPanel } from "./CaseDocumentsPanel";
import { ApplicationAssignSheet } from "./ApplicationAssignSheet";
import { HistorySheet } from "./HistorySheet";
import { CaseTabs, useCaseTab } from "./CaseTabs";
import { OverviewTab } from "./tabs/OverviewTab";
import { ConsultationTab } from "./tabs/ConsultationTab";
import { EnrolmentTab } from "./tabs/EnrolmentTab";
import { ApplicationsTab } from "./tabs/ApplicationsTab";
import { VisaTab } from "./tabs/VisaTab";
import { DepartureTab } from "./tabs/DepartureTab";
import { MoneyTab } from "./tabs/MoneyTab";
import { tasksForApplication, taskActionLabel, type PendingTask } from "../../lib/pendingTasks";
import { listInvoices, getApplicationActivity, type ApiInvoice } from "../../lib/api";
import { CaseHeader, NextActionBand, Sheet, type NextAction } from "century-nit-core/ui";
import { type MockApplication, branchName } from "century-nit-core/ops";
import {


	JOURNEY_STAGES,
	JOURNEY_STAGE_LABELS,
	CASE_STATUS_LABELS,



	canAdvanceToStage,
	feeMilestoneBlockReason,

	type ApplicationActivityEvent,

	type JourneyStage,



} from "century-nit-shared";


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




import type { TabId } from "./tabs/types";

/** The chapter a case is currently in — where the detail opens. */
const TAB_IDS: TabId[] = ["overview", "consultation", "enrolment", "application", "visa", "travel", "payments", "documents"];

/** Which tab a portal stage lives on — the case opens where the applicant is. */
const TAB_FOR_PORTAL_STAGE: Record<string, TabId> = {
	new: "consultation",
	consultation: "consultation",
	eligibility: "consultation",
	proceed: "enrolment",
	school_package: "enrolment",
	awaiting_handler: "enrolment",
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
			return app.proceedStatus === "accepted" && app.depositPaid ? "application" : "enrolment";
	}
}


/**
 * One detail for Cases, Visa and Travel. `initialTab` lets a host page open
 * on its own chapter (the Visa queue opens the Visa tab); otherwise the case
 * opens on the chapter the applicant is currently in.
 */
export function CaseDetail({ app, initialTab }: { app: MockApplication; initialTab?: TabId }) {
	const { opsRole, opsUser, canAssignWork, canIssueInvoices } = useOpsAuth();
	const {
		handoffs,
		travelRequests,
		consultations,
		acceptApplication,

		commentOnApplication,
		requestApplicationDocs,
		recordProceed,
		reinviteProceed,
		declineProceed,





		setApplicationStage,

	} = useCases();
	const { invoices: allInvoices } = useInvoiceApi();

	const [actionSuccess, setActionSuccess] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [appInvoice, setAppInvoice] = useState<ApiInvoice | null>(null);
	const [appInvoiceLoading, setAppInvoiceLoading] = useState(false);

	// Every invoice raised on this case, in one request; the application and
	// visa invoices the stage blocks show are views over it.
	const [caseInvoices, setCaseInvoices] = useState<ApiInvoice[]>([]);
	const [invoiceRefresh, setInvoiceRefresh] = useState(0);
	useEffect(() => {
		setAppInvoiceLoading(true);
		listInvoices({ applicationId: app.id, limit: 50 })
			.then((res) => {
				const live = res.invoices.filter((i) => i.status !== "void");
				setCaseInvoices(live);
				setAppInvoice(res.invoices.find((i) => i.type === "application") ?? null);
			})
			.catch(() => {
				setCaseInvoices([]);
				setAppInvoice(null);
			})
			.finally(() => setAppInvoiceLoading(false));
	}, [app.id, invoiceRefresh]);
	const visaApiInvoice = caseInvoices.find((i) => i.type === "visa") ?? null;


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
	// Consent override and decline both need a reason; a sheet asks for it
	// (a browser prompt cannot be styled, validated or read by a screen reader).
	const [reasonFor, setReasonFor] = useState<"record" | "decline" | null>(null);
	const [reasonDraft, setReasonDraft] = useState("");
	const [reasonBusy, setReasonBusy] = useState(false);
	function handleRecordProceed() {
		setReasonDraft("");
		setReasonFor("record");
	}
	async function submitReason() {
		const reason = reasonDraft.trim();
		if (reasonFor === "record" && !reason) return;
		setReasonBusy(true);
		try {
			if (reasonFor === "record") {
				await recordProceed(app.appId, reason);
				flash("Applicant consent recorded — the gate is now open.");
			} else if (reasonFor === "decline") {
				await declineProceed(app.appId, reason);
				flash("Applicant declined to proceed — the case is paused.");
			}
			setReasonFor(null);
		} catch (err) {
			fail(err, reasonFor === "record" ? "Could not record consent" : "Could not record decline");
		} finally {
			setReasonBusy(false);
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
	function handleDeclineProceed() {
		setReasonDraft("");
		setReasonFor("decline");
	}

	// The two case-level sheets: assignment (the one place a handler is set)
	// and history (the one place notes are read and written).
	const [assignOpen, setAssignOpen] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);

	// Tab state, mirrored to ?tab= so a notification or a handoff can link to
	// the right chapter and a refresh keeps it. Precedence: the URL, then the
	// host's chapter, then where the case is.
	const [tab, setTab] = useCaseTab<TabId>(TAB_IDS, () => currentTabFor(app), app.id, initialTab);

	// Which stage bodies apply to this case.
	const stageIdx = (s: string) => (JOURNEY_STAGES as string[]).indexOf(s === "payment_execution" ? "travel_assistance" : s);
	const visaInvoice = allInvoices.find((i) => i.type === "Visa" && i.applicationId === app.id);
	const showVisa = (app.visaStage && app.visaStage !== "locked") || stageIdx(app.stage) >= stageIdx("visa_processing") || Boolean(visaInvoice);
	const selectedTa = travelRequests.find((t) => t.applicationId === app.id) ?? null;
	const showTravel = Boolean(selectedTa) || stageIdx(app.stage) >= stageIdx("travel_assistance");
	// The standard documents were collected at consultation; nothing is
	// invoiced while any is still unverified (the API refuses too).
	const outstandingDocs = (app.documentChecklist ?? []).filter((d) => d.status !== "VERIFIED").map((d) => d.name);
	// Why a control is off, in the words the server would use to refuse it.
	const completeBlock = app.stage === "travel_assistance" ? canAdvanceToStage("travel_assistance", "completed", app) : null;
	// The pre-departure fee milestone gates the ticket; the same words the API refuses with.
	const feeBlock = feeMilestoneBlockReason(app, "The ticket cannot be invoiced yet");


	// ── Tabs: one per chapter of the case, unlocked as the case reaches it ──
	const stageIndex = stageIdx(app.stage);
	const consultation = consultations.find((c) => c.id === app.consultationId) ?? null;
	const hasAdmitted = (app.schoolApplications ?? []).some((s) => s.outcome === "Admitted");
	// Tabs open on the same rule the portal opens its chapters on
	// (`deriveJourney().chapterUnlocks`, shipped on the application). The
	// local checks are only the fallback for a case the API has not derived.
	const unlocks = app.journey?.chapterUnlocks;
	// Enrolment opens with the assessment (the client can confirm before a
	// deposit); Applications opens once the deposit is paid and a consultant is on it.
	const enrolOpen = unlocks ? unlocks.package : true;
	const applicationOpen = unlocks
		? unlocks.application
		: app.depositPaid || stageIndex >= stageIdx("school_submission");
	const visaOpen = unlocks ? unlocks.visa : showVisa || hasAdmitted;
	const travelOpen = unlocks ? unlocks.travel_assistance : showTravel || app.visaStage === "complete";
	const tabs: { id: TabId; label: string; locked: boolean; hint?: string }[] = [
		{ id: "overview", label: "Overview", locked: false },
		{ id: "consultation", label: "Consultation", locked: !consultation, hint: "Opened from a consultation" },
		{ id: "enrolment", label: "Enrolment", locked: !enrolOpen, hint: "Unlocks after the assessment" },
		{ id: "application", label: "Applications", locked: !applicationOpen, hint: "Unlocks once the deposit is paid" },
		{ id: "visa", label: "Visa", locked: !visaOpen, hint: "Unlocks on the first admission" },
		{ id: "travel", label: "Departure", locked: !travelOpen, hint: "Unlocks once the visa is approved" },
		{ id: "payments", label: "Money", locked: false },
		{ id: "documents", label: "Documents", locked: false },
	];
	const isLocked = (id: TabId) => tabs.find((t) => t.id === id)?.locked ?? false;
	// A locked request (e.g. the Visa queue opening a case whose visa has not
	// started) falls back to the chapter the case is actually in.
	const stageTab = currentTabFor(app);
	const current = !isLocked(tab) ? tab : !isLocked(stageTab) ? stageTab : "overview";

	// What this case is waiting on from us — the same tasks the dashboard
	// lists for it, plus the three gates that only exist here (handoff,
	// consent, acceptance), each with the control that clears it.
	// A closed case is a record, not a queue — no handoff, consent, or
	// acceptance prompts survive past it.
	const caseClosed = app.stage === "completed" || app.status === "Rejected";
	const pendingHandoff = caseClosed
		? null
		: (handoffs.find((h) => h.applicationId === app.id && h.status === "pending") ?? null);
	const nextActions: NextAction[] = [];
	if (pendingHandoff) {
		const stageLabel = JOURNEY_STAGE_LABELS[pendingHandoff.stage as JourneyStage] ?? pendingHandoff.stage;
		const why =
			pendingHandoff.source === "deposit_payment"
				? "Deposit received — this case needs a consultant before school selection can proceed."
				: pendingHandoff.source === "visa_payment" || pendingHandoff.source === "visa_consent_continue"
					? "The client is ready for their visa — assign a visa officer."
					: pendingHandoff.source === "offboarding"
						? "The previous owner has left — this chapter needs a new one."
						: `This case needs an owner for ${stageLabel}.`;
		nextActions.push({
			id: `handoff-${pendingHandoff.id}`,
			title: `Needs an owner · ${stageLabel}`,
			detail: why,
			tone: "blocked",
			action: canAssignWork ? (
				<button type="button" className="btn btn--sm btn--primary" onClick={() => setAssignOpen(true)}>
					Assign owner
				</button>
			) : undefined,
		});
	}
	if (!caseClosed && app.proceedStatus !== "accepted") {
		nextActions.push({
			id: "consent",
			title:
				app.proceedStatus === "paused"
					? "Client put their enrolment on hold"
					: app.proceedStatus === "declined"
						? "Client declined to enrol"
						: "Awaiting the client's enrolment confirmation",
			detail:
				app.proceedStatus === "paused"
					? "They can resume from their portal, or you can record their confirmation or re-invite them."
					: app.proceedStatus === "declined"
						? "Re-invite to let the client reopen it, or record their confirmation on their behalf."
						: "The client must confirm in the portal before the case can start.",
			tone: "waiting",
			action: (
				<>
					<button type="button" onClick={handleRecordProceed} className="btn btn--sm btn--primary">
						Record confirmation
					</button>
					{app.proceedStatus === "invited" && (
						<button type="button" onClick={handleDeclineProceed} className="btn btn--sm btn--ghost">
							Record decline
						</button>
					)}
					{(app.proceedStatus === "declined" || app.proceedStatus === "paused") && (
						<button type="button" onClick={() => void handleReinviteProceed()} className="btn btn--sm btn--ghost">
							Re-invite client
						</button>
					)}
				</>
			),
		});
	} else if (!caseClosed && app.status !== "Accepted") {
		nextActions.push({
			id: "accept",
			title: `Case is ${CASE_STATUS_LABELS[app.status] ?? app.status} — accept it to activate the client`,
			detail: "Accepting activates the case and the client's record.",
			action: (
				<button type="button" onClick={() => handleAcceptApplication()} className="btn btn--sm btn--primary">
					Accept & approve
				</button>
			),
		});
	}
	// Stage advance lives here too, so nobody is sent to the Workflow board.
	// The shared guard says why it is blocked; ready cases get the button.
	// Normalise through stageIdx — a legacy payment_execution row resolves to
	// travel_assistance here instead of falling back to the first stage.
	const coarseStage = (JOURNEY_STAGES[Math.max(0, stageIdx(app.stage))] ?? JOURNEY_STAGES[0]) as JourneyStage;
	const nextStage = JOURNEY_STAGES[JOURNEY_STAGES.indexOf(coarseStage) + 1] as JourneyStage | undefined;
	const advanceBlock = nextStage ? canAdvanceToStage(coarseStage, nextStage, app) : null;
	const mayAdvance = canAssignWork || app.assignedStaffEmail === opsUser?.email;
	// Why the next stage is out of reach — a state, not a task. The band shows
	// it only when there is nothing to do; when there is, the task explains it.
	const blockedBy =
		nextStage && advanceBlock && mayAdvance && app.proceedStatus === "accepted" && !pendingHandoff
			? `${JOURNEY_STAGE_LABELS[nextStage]} is not open yet — ${advanceBlock.replace(/^Cannot (advance to [^:]+|mark complete): /, "")}`
			: null;
	if (nextStage && !advanceBlock && mayAdvance) {
		nextActions.push({
			id: "advance",
			title: `Ready to advance to ${JOURNEY_STAGE_LABELS[nextStage]}`,
			detail: `Every requirement for ${JOURNEY_STAGE_LABELS[coarseStage]} is met.`,
			tone: "done",
			action: (
				<button
					type="button"
					className="btn btn--sm btn--primary"
					onClick={() =>
						void setApplicationStage(app.appId, nextStage)
							.then(() => flash(`Advanced to ${JOURNEY_STAGE_LABELS[nextStage]}.`))
							.catch((e) => fail(e, "Could not advance the case"))
					}
				>
					Advance →
				</button>
			),
		});
	}
	for (const task of tasksForApplication(app, { handoffs, travelRequests, invoices: allInvoices })) {
		// The three gates above already cover these.
		if (task.kind === "handoff") continue;
		if (task.kind === "application" && (task.action === "assign" || task.action === "review")) continue;
		const tabFor: Partial<Record<PendingTask["kind"], TabId>> = { application: "application", visa: "visa", travel: "travel" };
		const target = tabFor[task.kind];
		nextActions.push({
			id: task.id,
			title: task.subtitle,
			detail: task.meta || null,
			action:
				target && !isLocked(target) ? (
					<button type="button" className="btn btn--sm btn--ghost" onClick={() => setTab(target)}>
						{taskActionLabel(task)} →
					</button>
				) : (
					<Link to={task.linkTo} className="btn btn--sm btn--ghost">
						{taskActionLabel(task)} →
					</Link>
				),
		});
	}

	// The case timeline, for the history sheet; refetched when work is done here.
	const [activity, setActivity] = useState<ApplicationActivityEvent[]>([]);
	const [activityLoading, setActivityLoading] = useState(false);
	useEffect(() => {
		if (!historyOpen) return;
		setActivityLoading(true);
		getApplicationActivity(app.id)
			.then((res) => setActivity(res.events))
			.catch(() => setActivity([]))
			.finally(() => setActivityLoading(false));
	}, [app.id, historyOpen, app.comments?.length, app.assignedStaffId, invoiceRefresh]);

	// Who may act on the case at all — the handler, or anyone who can route work.
	const canWork = canAssignWork || app.assignedStaffEmail === opsUser?.email;
	const noteCount = (app.comments ?? []).length;


	return (
		<div className="cn-detail">
			{actionSuccess && <p className="ops-modal__foot" style={{ margin: 0 }}>{actionSuccess}</p>}
			{actionError && <p className="ops-modal__error" style={{ margin: 0 }}>{actionError}</p>}
{(() => {
								return (
									<div className="card" style={{ padding: "0.75rem 1rem" }}>
										<CaseHeader
											name={app.applicantName}
											reference={app.appId}
											branch={branchName(app.branch)}
											stage={app.stage}
											// Ops closed the case — the pill says so even when the client's
											// own signals still owe a step (a fee settled off-platform).
											portalStage={app.stage === "completed" ? "completed" : (app.journey?.portalStage ?? null)}
											handlerName={app.assignedStaff || null}
											handlerAction={
												canAssignWork ? (
													<button type="button" className="btn btn--sm btn--ghost" onClick={() => setAssignOpen(true)}>
														{pendingHandoff ? "Assign" : app.assignedStaff ? "Change" : "Assign"}
													</button>
												) : undefined
											}
											actions={
												<button type="button" className="btn btn--sm btn--ghost" onClick={() => setHistoryOpen(true)}>
													History{noteCount > 0 ? ` · ${noteCount}` : ""}
												</button>
											}
											stageHandlers={(app.stageHandlers ?? [])
												.filter((h) => h.opsUserName !== app.assignedStaff)
												.map((h) => ({ stage: h.stage, name: h.opsUserName }))}
											contact={{ email: app.email, phone: app.phone }}
											extra={[
												{ label: "Country", value: app.country || "—" },
												{ label: "Programme", value: app.program || "—" },
											]}
										/>
									</div>
								);
							})()}

			<NextActionBand items={nextActions} waitingOn={app.journey?.nextUnlock ?? null} blockedBy={blockedBy} />

			<ApplicationAssignSheet app={app} open={assignOpen} onClose={() => setAssignOpen(false)} onDone={flash} />

			<HistorySheet
				open={historyOpen}
				onClose={() => setHistoryOpen(false)}
				events={activity}
				loading={activityLoading}
				canPost={canWork}
				actor={opsUser?.name ?? "Staff"}
				onPost={(kind, text, visibility) => commentOnApplication(app.id, kind, text, visibility)}
			/>

			<Sheet
				open={reasonFor !== null}
				onClose={() => (reasonBusy ? undefined : setReasonFor(null))}
				title={reasonFor === "record" ? "Record consent on the applicant's behalf" : "Record that the applicant is not proceeding"}
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void submitReason();
					}}
					className="cn-assign"
				>
					<p className="cn-assign__current">
						{reasonFor === "record"
							? "Only after the applicant confirmed by phone or in person. Say who confirmed and when — it goes on the case record."
							: "Why the applicant is pausing, if they said (optional). They can resume from the portal at any time."}
					</p>
					<textarea
						className="input"
						rows={3}
						value={reasonDraft}
						onChange={(e) => setReasonDraft(e.target.value)}
						placeholder={reasonFor === "record" ? "e.g. Confirmed by phone with the applicant on 12 Sep" : "Reason (optional)"}
						autoFocus
					/>
					<div className="cn-assign__row">
						<button type="submit" className="btn btn--primary" disabled={reasonBusy || (reasonFor === "record" && !reasonDraft.trim())}>
							{reasonBusy ? "Saving…" : reasonFor === "record" ? "Record consent" : "Record decline"}
						</button>
						<button type="button" className="btn btn--ghost" onClick={() => setReasonFor(null)} disabled={reasonBusy}>
							Cancel
						</button>
					</div>
				</form>
			</Sheet>

			<CaseTabs tabs={tabs} current={current} onChange={setTab} nowId={stageTab} />


			{current === "overview" && <OverviewTab app={app} consultation={consultation} canWork={canWork} flash={flash} fail={fail} />}

			{current === "consultation" && consultation && <ConsultationTab app={app} consultation={consultation} />}

			{current === "enrolment" && <EnrolmentTab app={app} caseInvoices={caseInvoices} canIssueInvoices={canIssueInvoices} canWork={canWork} flash={flash} fail={fail} />}

			{current === "application" && (
				<ApplicationsTab
					app={app}
					appInvoice={appInvoice}
					appInvoiceLoading={appInvoiceLoading}
					canIssueInvoices={canIssueInvoices}
					canWork={canWork}
					outstandingDocs={outstandingDocs}
					setTab={setTab}
					onInvoiceChanged={(updated) => {
						setAppInvoice(updated);
						setInvoiceRefresh((n) => n + 1);
					}}
					flash={flash}
					fail={fail}
				/>
			)}

			{current === "visa" && (
				<VisaTab
					app={app}
					handoffs={handoffs}
					visaApiInvoice={visaApiInvoice}
					canIssueInvoices={canIssueInvoices}
					canWork={canWork}
					setTab={setTab}
					onAssign={() => setAssignOpen(true)}
					flash={flash}
					fail={fail}
				/>
			)}

			{current === "travel" && (
				<DepartureTab
					app={app}
					selectedTa={selectedTa}
					caseInvoices={caseInvoices}
					canWork={canWork}
					canIssueInvoices={canIssueInvoices}
					feeBlock={feeBlock}
					travelOpen={travelOpen}
					onInvoicesChanged={() => setInvoiceRefresh((n) => n + 1)}
				/>
			)}

			{current === "payments" && (
				<MoneyTab app={app} caseInvoices={caseInvoices} canWork={canWork} canIssueInvoices={canIssueInvoices} completeBlock={completeBlock} flash={flash} fail={fail} />
			)}

			{current === "documents" && (
				<CaseDocumentsPanel
					ownerUserId={app.applicantUserId}
					applicantName={app.applicantName}
					reference={app.appId}
					requestedDocuments={app.requestedDocuments ?? []}
					canReview={app.assignedStaffEmail === opsUser?.email || opsRole === "manager" || opsRole === "coordinator"}
					requestHint="Nothing requested yet."
					onRequest={canWork ? (docs) => requestApplicationDocs(app.id, docs).then(() => flash("Document request sent.")) : undefined}
					checklist={app.documentChecklist}
				/>
			)}
		</div>
	);
}
