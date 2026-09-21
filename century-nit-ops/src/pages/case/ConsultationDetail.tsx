import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOpsAuth } from "../OpsAuthContext";
import { useCases } from "../../hooks/useCases";
import { CaseDocumentsPanel } from "./CaseDocumentsPanel";
import { ReschedulePanel } from "./ReschedulePanel";
import { AssignSheet } from "./AssignSheet";
import { HistorySheet, type HistoryEvent } from "./HistorySheet";
import { CaseTabs, useCaseTab } from "./CaseTabs";
import type { MockConsultation } from "century-nit-core/ops";
import { documentsApi, bookingsApi, ApiError } from "century-nit-core/api";
import { SERVICE_INTENT_LABELS, SERVICE_STAGES, SERVICE_STAGE_LABELS, intentScope, normaliseScope, scopeLabel, type ApplicantDocument, type ServiceIntent, type ServiceStage } from "century-nit-shared";
import { getConsultationActivity, type ConsultationActivityEvent } from "../../lib/api";
import { CaseHeader, StatusPill, type NextAction } from "century-nit-core/ui";
import { CaseTodo } from "./CaseTodo";
import { ConsultationCall, MeetingEndedModal, MeetingWindowModal, type MeetingEndedInfo, type MeetingWindowInfo } from "./ConsultationCall";


function isKnown(v: string | undefined | null): v is string {
	const s = (v ?? "").trim();
	return s !== "" && s !== "-" && s !== "—";
}

function docSummary(c: MockConsultation, realDocs: ApplicantDocument[]) {
	const requested = c.requestedDocuments?.length ?? 0;
	const uploaded = realDocs.filter((d) => d.status === "UPLOADED" || d.status === "VERIFIED").length;
	const verified = realDocs.filter((d) => d.status === "VERIFIED").length;
	const pending = realDocs.filter((d) => d.status === "UPLOADED").length;
	const rejected = realDocs.filter((d) => d.status === "REJECTED").length;
	return { total: Math.max(requested, realDocs.length), verified, pending, uploaded, rejected };
}

/** A readable line for a consultation activity row; the payload carries the specifics. */
function activitySummary(e: ConsultationActivityEvent): string {
	const p = (e.payload ?? {}) as Record<string, unknown>;
	const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
	switch (e.type) {
		case "status_changed":
			return `Status ${str("fromStatus") ?? "—"} → ${str("toStatus") ?? "—"}`;
		case "consultant_assigned":
			return `${str("officerName") ?? "A consultant"} assigned`;
		case "coordinator_delegated":
			return `Delegated to coordinator ${str("coordinatorName") ?? ""}${str("note") ? ` — ${str("note")}` : ""}`;
		case "coordinator_reassigned":
			return `Coordinator ${str("fromCoordinatorName") ?? "—"} → ${str("toCoordinatorName") ?? "—"}${str("reason") ? ` — ${str("reason")}` : ""}`;
		case "auto_escalated":
			return `Escalated automatically${str("toCoordinatorName") ? ` to ${str("toCoordinatorName")}` : ""}`;
		default: {
			const words = e.type.replace(/[._]/g, " ");
			return words.charAt(0).toUpperCase() + words.slice(1);
		}
	}
}

/**
 * One consultation's detail — status bars, meeting link, actions, work
 * panel and the Background / Documents / Decision tabs. Moved out of the
 * Consultations page so it can share the case scaffold with the
 * application detail; the body is the page's original detail pane.
 */
export function ConsultationDetail({
	consultation: record,
	onToast,
}: {
	consultation: MockConsultation;
	onToast: (type: "error" | "success", message: string) => void;
	/** The detail closed itself (e.g. the case was cancelled). */
	onClosed?: () => void;
}) {
	const navigate = useNavigate();
	const { opsRole, opsUser, canAssignWork } = useOpsAuth();
	const {
		applications,
		consultations,
		assignees,
		completeConsultationAssessment,
		assignConsultation,
		referConsultation,
		confirmConsultationSlot,
		startConsultationAssessment,
		commentOnConsultation,
		requestConsultationDocs,
		rescheduleConsultation,
		decideReschedule,
		cancelConsultation,
		issueRebookingCredit,
		returnToConfirmed,
		refresh,
		refreshConsultation,
	} = useCases();

	type Tab = "profile" | "documents" | "assessment";
	const TABS: readonly Tab[] = ["profile", "documents", "assessment"];
	const [detailTab, setDetailTab] = useCaseTab<Tab>(TABS, () => "profile");
	// The two case-level sheets, the same as on an application: assignment
	// (the one place a consultant is set) and history (notes read and written).
	const [assignOpen, setAssignOpen] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);

	const [outcome, setOutcome] = useState("Eligible");
	const [notes, setNotes] = useState("");
	const [recCountry, setRecCountry] = useState("Canada");
	const [recUniversity, setRecUniversity] = useState("University of Toronto");
	const [recProgram, setRecProgram] = useState("Master of Science in Computer Science");
	const [recPackage, setRecPackage] = useState("undecided");
	// The stages the consultant recommends. All three is the full journey.
	const [recStages, setRecStages] = useState<ServiceStage[]>([...SERVICE_STAGES]);
	// A visa or departure entry is judged on the offer and the money, not on
	// eligibility: proceed as chosen, widen the scope, or not viable.
	const [verdict, setVerdict] = useState<"proceed" | "widen" | "not_viable">("proceed");
	const [isSubmitted, setIsSubmitted] = useState(false);
	const [showReschedule, setShowReschedule] = useState(false);
	const [realDocs, setRealDocs] = useState<ApplicantDocument[]>([]);
	const [showCancelForm, setShowCancelForm] = useState(false);
	const [cancelReason, setCancelReason] = useState("");
	const [meetingUrlDraft, setMeetingUrlDraft] = useState("");
	const [editingMeetingUrl, setEditingMeetingUrl] = useState(false);
	const [savingMeetingUrl, setSavingMeetingUrl] = useState(false);
	const [generatingMeet, setGeneratingMeet] = useState(false);
	const [resendingMeetLink, setResendingMeetLink] = useState(false);
	const [joiningMeet, setJoiningMeet] = useState(false);
	const [call, setCall] = useState<{ url: string; token: string } | null>(null);
	const [meetNotOpen, setMeetNotOpen] = useState<MeetingWindowInfo | null>(null);
	const [meetEnded, setMeetEnded] = useState<MeetingEndedInfo | null>(null);
	/** Result recorded this session, shown until the refreshed row carries it. */
	const [completedResult, setCompletedResult] = useState<MockConsultation["assessmentResult"] | null>(null);
	const consultation: MockConsultation = completedResult
		? { ...record, status: "Completed", assessmentResult: completedResult }
		: record;

	// The consultation's own timeline (the API has kept one all along).
	const [activity, setActivity] = useState<ConsultationActivityEvent[]>([]);
	const [activityLoading, setActivityLoading] = useState(false);
	useEffect(() => {
		if (!historyOpen) return;
		setActivityLoading(true);
		getConsultationActivity(consultation.id)
			.then((res) => setActivity(res.activities))
			.catch(() => setActivity([]))
			.finally(() => setActivityLoading(false));
	}, [consultation.id, historyOpen, consultation.status, consultation.assignedOfficer, (consultation.comments ?? []).length]);
	const historyEvents: HistoryEvent[] = activity.map((e) => ({
		id: e.id,
		at: e.createdAt,
		summary: activitySummary(e),
		actorName: e.actorName,
	}));

	// Reset per-record state when a different consultation is shown.
	useEffect(() => {
		setOutcome(consultation.assessmentResult?.outcome || "Eligible");
		setNotes(consultation.assessmentResult?.notes || "");
		setRecCountry(consultation.assessmentResult?.recCountry || consultation.targetCountry || "");
		setRecUniversity(consultation.assessmentResult?.recUniversity || "");
		setRecProgram(consultation.assessmentResult?.recProgram || `${consultation.goals.degreeLevel || ""} in ${consultation.goals.major || ""}`.trim() || "");
		setRecPackage(consultation.assessmentResult?.recPackage || "");
		// The recommendation starts from what the client said at booking.
		const intent = (consultation.entryIntent || "full") as ServiceIntent;
		setRecStages(normaliseScope(consultation.assessmentResult?.recStages?.length ? consultation.assessmentResult.recStages : intentScope(intent)));
		setVerdict(consultation.assessmentResult?.verdict ?? "proceed");
		setIsSubmitted(false);
		setShowReschedule(false);
		setEditingMeetingUrl(false);
		setMeetingUrlDraft("");
		setCompletedResult(null);
	}, [consultation.id]);

	// The detail renders from the cached list — pull the fresh row on open so
	// a link or handler minted since the list loaded (someone else's Confirm)
	// shows immediately instead of appearing after the first local mutation.
	useEffect(() => {
		void refreshConsultation(consultation.id).catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- once per record
	}, [consultation.id]);

	// The join window ticks — Join enables itself 30 min before the slot.
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNowMs(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		if (!consultation?.applicantUserId) { setRealDocs([]); return; }
		let cancelled = false;
		documentsApi
			.list({ ownerUserId: consultation.applicantUserId })
			.then((res) => { if (!cancelled) setRealDocs(res.documents); })
			.catch(() => { if (!cancelled) setRealDocs([]); });
		return () => { cancelled = true; };
	}, [consultation?.applicantUserId]);

	async function handleCompleteAssessment(e: React.FormEvent) {
		e.preventDefault();
		if (!consultation) return;
		const bringsOffer = consultation.entryIntent === "visa" || consultation.entryIntent === "departure";
		// For an entry that brings an offer, the verdict drives the outcome everything else reads.
		const finalOutcome = bringsOffer ? (verdict === "not_viable" ? "Not Eligible" : "Eligible") : outcome;
		const result = { outcome: finalOutcome, notes, recCountry, recUniversity, recProgram, recPackage, recStages, ...(bringsOffer ? { verdict } : {}) };
		const res = await completeConsultationAssessment(consultation.id, result);
		setCompletedResult(res.consultation.assessmentResult ?? result);
		setIsSubmitted(true);
		setTimeout(() => setIsSubmitted(false), 3000);
		void refresh();
	}

	const docs = docSummary(consultation, realDocs);
	const isMine = Boolean(consultation.assignedOfficerEmail === opsUser?.email);
	const canAssess = isMine || opsRole === "manager" || opsRole === "coordinator";

	// Where this applicant is on the ladder: the spawned application's derived
	// journey when there is one, else the two consultation steps.
	const spawned = consultation.applicationId ? applications.find((a) => a.id === consultation.applicationId) ?? null : null;

	// Rebooking lineage — which cancelled case this one replaced, and which
	// live case replaced this one once it's cancelled.
	const rebookedFrom = consultation.rebookedFromId
		? consultations.find((c) => c.id === consultation.rebookedFromId) ?? null
		: null;
	const replacedBy = consultation.status === "Cancelled"
		? consultations.find((c) => c.rebookedFromId === consultation.id) ?? null
		: null;


	// What this consultation is waiting on from us.
	const canActOnReschedule =
		(consultation.assignedOfficerEmail && opsUser?.email === consultation.assignedOfficerEmail) || (!consultation.assignedOfficerEmail && canAssignWork);
	const rescheduleButton = (
		<button type="button" onClick={() => setShowReschedule(!showReschedule)} className={`btn btn--sm ${showReschedule ? "btn--primary" : "btn--ghost"}`}>
			↻ Reschedule
		</button>
	);
	const nextActions: NextAction[] = [];
	if (consultation.rescheduleRequestedAt) {
		nextActions.push({
			id: "reschedule-request",
			title: "Applicant requested a reschedule",
			detail: `They want to move this to ${new Date(consultation.rescheduleRequestedStartsAt!).toLocaleString()}.${consultation.rescheduleRequestReason ? ` Reason: ${consultation.rescheduleRequestReason}` : ""}`,
			tone: "blocked",
			action: canActOnReschedule ? (
				<>
					<button type="button" className="btn btn--sm btn--ghost" onClick={() => consultation.bookingId && void decideReschedule(consultation.bookingId, "reject")}>
						Reject
					</button>
					<button type="button" className="btn btn--sm btn--primary" onClick={() => consultation.bookingId && void decideReschedule(consultation.bookingId, "approve")}>
						Approve
					</button>
				</>
			) : (
				<span className="cn-next__detail">Waiting for the {consultation.assignedOfficer ? "assigned consultant" : "manager"} to review</span>
			),
		});
	}
	if (consultation.status === "Under Review" && !consultation.assignedOfficer && canAssignWork) {
		nextActions.push({
			id: "assign",
			title: "New booking awaiting assignment",
			detail: "Review the applicant's background, then assign a consultant in the work panel.",
		});
	}
	if (consultation.status === "Assigned") {
		const slotPassed = consultation.startsAt ? new Date(consultation.startsAt).getTime() <= Date.now() : false;
		const needsLink = consultation.type?.toLowerCase() === "online" && !consultation.meetingLink;
		if (slotPassed) {
			// The slot slipped by unconfirmed — the API refuses to confirm it,
			// so the honest actions are move it or close the case.
			nextActions.push({
				id: "slot-passed",
				title: "The slot has passed unconfirmed",
				detail: "Confirming is no longer possible — move it or close the case.",
				tone: "blocked",
				action: (
					<>
						{rescheduleButton}
						<button type="button" className="btn btn--sm btn--ghost" style={{ color: "var(--danger)" }} onClick={() => setShowCancelForm(true)}>
							Cancel Case
						</button>
					</>
				),
			});
		} else if (needsLink) {
			// No link yet — confirming mints the room when a provider is
			// connected; pasting a Zoom/Meet link first works too.
			nextActions.push({
				id: "confirm",
				title: "No meeting link yet",
				detail: "Confirming will generate one if a video provider is connected — or add your own first.",
				action: (
					<>
						{rescheduleButton}
						<button type="button" onClick={() => void confirmConsultationSlot(consultation.id)} className="btn btn--primary btn--sm">
							Confirm slot
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingMeetingUrl(true)}>
							Add link manually…
						</button>
					</>
				),
			});
		} else {
			nextActions.push({
				id: "confirm",
				title: "Confirm the slot",
				detail: "Accept the booking time, or reschedule if needed.",
				action: (
					<button type="button" onClick={() => void confirmConsultationSlot(consultation.id)} className="btn btn--primary btn--sm">
						Confirm slot
					</button>
				),
			});
		}
	}
	if (consultation.status === "Confirmed") {
		nextActions.push({
			id: "start",
			title: "Start the assessment",
			detail: "Review the documents and background, then start when ready.",
			action: (
				<button
					type="button"
					onClick={() => void startConsultationAssessment(consultation.id)}
					className="btn btn--primary btn--sm"
				>
					Start assessment →
				</button>
			),
		});
	}
	if (consultation.status === "In Assessment" && canAssess) {
		nextActions.push({
			id: "decide",
			title: "Record the assessment outcome",
			detail: "The applicant sees the outcome and recommendation in their portal once it is locked.",
			action: (
				<button type="button" className="btn btn--sm btn--primary" onClick={() => setDetailTab("assessment")}>
					Open decision →
				</button>
			),
		});
	}
	const waitingOn =
		consultation.status === "Under Review" && !canAssignWork
			? "Awaiting assignment — a manager places this with a consultant."
			: consultation.status === "Completed"
				? spawned
					? null
					: "The applicant decides in their portal whether to proceed."
				: consultation.status === "Cancelled"
					? "This case was cancelled."
					: null;

	return (
		<div className="cn-detail">
			<div className="card" style={{ padding: "0.75rem 1rem" }}>
				<CaseHeader
					name={consultation.applicantName}
					reference={consultation.ref}
					branch={consultation.branch}
					portalStage={consultation.status === "Completed" ? "eligibility" : "consultation"}
					handlerName={consultation.assignedOfficer || null}
					handlerAction={
						canAssignWork && consultation.status !== "Completed" && consultation.status !== "In Assessment" && consultation.status !== "Cancelled" ? (
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setAssignOpen(true)}>
								Handler…
							</button>
						) : undefined
					}
					actions={
						<button type="button" className="btn btn--sm btn--ghost" onClick={() => setHistoryOpen(true)}>
							History{(consultation.comments ?? []).length > 0 ? ` · ${(consultation.comments ?? []).length}` : ""}
						</button>
					}
						contact={{ email: consultation.email, phone: consultation.phone }}
					extra={[
						{ label: "Status", value: <StatusPill tone={consultation.status === "Completed" ? "done" : consultation.status === "Cancelled" ? "void" : consultation.status === "Under Review" ? "waiting" : "current"}>{consultation.status}</StatusPill> },
						{ label: "When", value: [consultation.dateTime, consultation.type].filter(isKnown).join(" · ") || "—" },
						{
							label: "Targeting",
							value: (() => {
								const rec = consultation.assessmentResult;
								if (consultation.status === "Completed" && rec && (rec.recCountry || rec.recUniversity || rec.recProgram)) {
									return `${rec.recCountry || consultation.targetCountry || "—"}: ${rec.recUniversity || "University"} · ${rec.recProgram || "Programme"}`;
								}
								return isKnown(consultation.targetCountry) ? consultation.targetCountry : "Not set";
							})(),
						},
						...(docs.total > 0
							? [{ label: "Documents", value: `${docs.verified}/${docs.total} verified${docs.pending > 0 ? ` · ${docs.pending} to review` : ""}` }]
							: []),
					]}
				>
					{consultation.applicationId && (
						<p className="cn-docs__meta">
							<button type="button" className="link-arrow" onClick={() => navigate(`/applications?id=${consultation.applicationId}`)}>
								→ Application {consultation.applicationNumber || consultation.applicationId.slice(0, 8).toUpperCase()} · {consultation.applicationStage}
							</button>
						</p>
					)}
					{rebookedFrom && (
						<p className="cn-docs__meta">
							<button type="button" className="link-arrow" onClick={() => navigate(`/consultations?id=${rebookedFrom.id}`)}>
								↩ Rebooked from {rebookedFrom.ref}
								{rebookedFrom.cancelledAt ? ` — cancelled ${new Date(rebookedFrom.cancelledAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
							</button>
						</p>
					)}
				</CaseHeader>
			</div>

			<CaseTodo
				items={nextActions}
				waitingOn={waitingOn}
				blockedBy={consultation.status === "Under Review" ? "The assessment opens once a consultant is assigned." : null}
			/>

			{/* Cancelled case — who cancelled, why, what replaced it, and the
			    one way back: a free-rebooking credit the client spends on a
			    new slot. Cancelled is terminal — the replacement is a new
			    linked case, so the audit trail stays clean. */}
			{consultation.status === "Cancelled" && (
				<div className="card" style={{ padding: "0.75rem 1rem", marginTop: "0.75rem" }}>
					<div style={{ fontSize: "var(--text-sm)" }}>
						{(
							[
								["Cancelled", consultation.cancelledAt ? new Date(consultation.cancelledAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"],
								["By", consultation.cancelledBy ? (consultation.cancelledBy === consultation.email ? "the client" : consultation.cancelledBy) : "—"],
								["Reason", consultation.cancellationReason ?? "—"],
							] as const
						).map(([k, v], i, arr) => (
							<div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.4rem 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border-light)" : "none" }}>
								<span className="muted" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{k}</span>
								<span style={{ textAlign: "right" }}>{v}</span>
							</div>
						))}
						<div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.4rem 0" }}>
							<span className="muted" style={{ fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Replaced by</span>
							{replacedBy ? (
								<button type="button" className="link-arrow" onClick={() => navigate(`/consultations?id=${replacedBy.id}`)}>
									{replacedBy.ref} →
								</button>
							) : (
								<span>Not yet — awaiting the client</span>
							)}
						</div>
					</div>
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.75rem" }}>
						{consultation.freeRebooking ? (
							<>
								<StatusPill tone="done">Free rebooking issued</StatusPill>
								<span className="muted" style={{ fontSize: "var(--text-xs)" }}>· the client was notified in-app and by email</span>
							</>
						) : canAssignWork ? (
							<>
								<button
									type="button"
									className="btn btn--sm"
									onClick={() => {
										void issueRebookingCredit(consultation.id)
											.then(() => {
												void refresh();
												onToast("success", "Free rebooking issued — the client was notified.");
											})
											.catch((err: unknown) => {
												onToast("error", err instanceof Error ? err.message : "Could not issue the rebooking.");
											});
									}}
								>
									Issue free rebooking
								</button>
								<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
									Covers the fee and tells the client to pick a new slot — their new booking opens a linked case. If the client cancelled, leave it — they rebook and pay.
								</span>
							</>
						) : null}
					</div>
				</div>
			)}

			<AssignSheet
				open={assignOpen}
				onClose={() => setAssignOpen(false)}
				title={consultation.assignedOfficer ? "Change handler" : "Handler · Consultation"}
				stage="consultation"
				staff={assignees}
				branch={consultation.branch}
				currentName={consultation.assignedOfficer || null}
				coverage
				onAssign={async ({ opsUserId, scope, branch }) => {
					const to = assignees.find((a) => a.opsUserId === opsUserId);
					if (!to) throw new Error("That staff member is no longer available");
					await assignConsultation(consultation.id, to, { scope, branch });
					onToast("success", scope === "all" ? "Handler placed — carries the case it opens." : "Handler placed.");
				}}
				onLeaveOpen={async (branch) => {
					await referConsultation(consultation.id, branch);
					onToast("success", "Referred — left open for the branch to staff.");
				}}
			/>

			<HistorySheet
				open={historyOpen}
				onClose={() => setHistoryOpen(false)}
				events={historyEvents}
				loading={activityLoading}
				canPost={isMine || canAssignWork}
				actor={opsUser?.name ?? "Staff"}
				onPost={(kind, text, visibility) => commentOnConsultation(consultation.id, kind, text, visibility)}
				emptyText="Nothing recorded on this consultation yet."
			/>

		{showReschedule && (
			<ReschedulePanel
				currentWhen={consultation.dateTime}
				branchLabel={consultation.branch}
				duration="45"
				onConfirm={(date, time, reason) => {
					if (consultation.bookingId) {
						void rescheduleConsultation(
							consultation.id,
							consultation.bookingId,
							date,
							time,
							reason,
						).then(() => {
							setShowReschedule(false);
							void refresh();
						});
					} else {
						setShowReschedule(false);
					}
				}}
				onCancel={() => setShowReschedule(false)}
			/>
		)}
		{/* The call block never disappears for an online case — it states what is
		    true right now: no room yet (minted when the slot is confirmed), the
		    window not open (staff join from 30 min before), or joinable. In-person
		    cases show the office address + directions. Nothing else renders the link. */}
		{(() => {
			const isLive = consultation.status !== "Completed" && consultation.status !== "Cancelled";
			const canManageMeeting = isLive && Boolean(consultation.bookingId) && (canAssignWork || consultation.assignedOfficerEmail === opsUser?.email);
			const isOnline = consultation.type?.toLowerCase() === "online";
			if (isOnline) {
				// Staff may join 30 min before the slot (server: meetingWindow()).
				const opensAt = isLive && consultation.startsAt ? new Date(consultation.startsAt).getTime() - 30 * 60_000 : null;
				const joinOpen = opensAt === null || nowMs >= opensAt;
				return (
					<div style={{ padding: "0.75rem 1.25rem", background: "var(--muted)", borderBottom: "1px solid var(--border-light)", flexShrink: 0 }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
							<p className="eyebrow" style={{ margin: 0 }}>
								Call{consultation.meetingLink ? (joinOpen ? " · open now" : opensAt ? ` · opens ${new Date(opensAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "") : " · online"}
							</p>
							{consultation.meetingLink && (
								<span className="mono muted" style={{ fontSize: "var(--text-xs)", background: "var(--border-light)", padding: "0.1rem 0.4rem" }}>
									{consultation.meetingLink.includes("meet.google.com") ? "Google Meet" : consultation.meetingLink.startsWith("livekit:") ? "LiveKit" : consultation.meetingLink.includes("daily.co") ? "Daily · Private" : "Video Link"}
								</span>
							)}
						</div>
						{!editingMeetingUrl ? (
							<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.3rem" }}>
								{consultation.meetingLink ? (
									<>
										<button
											type="button"
											className="btn btn--primary btn--sm"
											style={{ whiteSpace: "nowrap" }}
											disabled={joiningMeet || !joinOpen}
											onClick={async () => {
												// Token'd providers need a per-person credential — /join
												// mints it. LiveKit hands back {ws url, token} and joins
												// in-app; everything else opens externally.
												setJoiningMeet(true);
												try {
													// A token'd-provider link without a booking can't be
													// opened raw — there's no URL that admits anyone.
													const stored = consultation.meetingLink ?? "";
													if (!consultation.bookingId && (stored.startsWith("livekit:") || stored.includes("daily.co"))) {
														throw new Error("This is a private room — it needs a booking on the case to join through.");
													}
													const res = consultation.bookingId
														? await bookingsApi.joinMeeting(consultation.bookingId)
														: { url: stored, provider: "manual" };
													if (res.provider === "livekit" && res.token) {
														setCall({ url: res.url, token: res.token });
													} else if (res.url && /^https?:/i.test(res.url)) {
														window.open(res.url, "_blank", "noopener,noreferrer");
													} else {
														throw new Error("No usable meeting link came back — try again in a moment.");
													}
												} catch (err) {
													if (err instanceof ApiError && err.code === "MEETING_NOT_OPEN" && typeof err.details === "object" && err.details !== null && "opensAt" in err.details) {
														setMeetNotOpen({ ...(err.details as Omit<MeetingWindowInfo, "title">), title: `Consultation · ${consultation.ref}` });
													} else if (err instanceof ApiError && err.code === "MEETING_ENDED" && typeof err.details === "object" && err.details !== null && "endsAt" in err.details) {
														setMeetEnded({ ...(err.details as Omit<MeetingEndedInfo, "title">), title: `Consultation · ${consultation.ref}` });
													} else {
														onToast("error", err instanceof Error ? err.message : "Could not join the meeting.");
													}
												} finally {
													setJoiningMeet(false);
												}
											}}
										>
											{joiningMeet ? "Joining…" : "Join →"}
										</button>
										<span className="mono muted" style={{ fontSize: "var(--text-xs)", wordBreak: "break-all" }}>
											{consultation.meetingLink.startsWith("livekit:")
												? "In-app call — joined here, nothing to copy or forward"
												: consultation.meetingLink.includes("daily.co")
													? "Private room — join via the button, a bare link won't open"
													: consultation.meetingLink}
											{!joinOpen && opensAt
												? ` — opens at ${new Date(opensAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}, 30 min before the slot`
												: ""}
										</span>
										{canManageMeeting && (
											<>
												<button
													type="button"
													className="btn btn--ghost btn--sm"
													disabled={resendingMeetLink}
													onClick={async () => {
														if (!consultation.bookingId) return;
														setResendingMeetLink(true);
														try {
															const res = await bookingsApi.resendMeetingLink(consultation.bookingId);
															onToast("success", `Meeting link emailed to ${res.clientEmail || "client"}.`);
														} catch (err) {
															onToast("error", err instanceof Error ? err.message : "Could not resend email.");
														} finally {
															setResendingMeetLink(false);
														}
													}}
													title="Re-send email with video meeting link to the client"
												>
													{resendingMeetLink ? "Sending email…" : "✉ Resend Link to Client"}
												</button>
												<button type="button" className="btn btn--ghost btn--sm" onClick={() => { const cur = consultation.meetingLink ?? ""; setMeetingUrlDraft(cur.startsWith("https://") ? cur : ""); setEditingMeetingUrl(true); }}>Change</button>
											</>
										)}
									</>
								) : (
									<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
										<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
											The room is minted when the slot is confirmed — the confirmation email carries it.
										</span>
										{canManageMeeting && (
											<>
										<button
											type="button"
											className="btn btn--primary btn--sm"
											disabled={generatingMeet}
											onClick={async () => {
												if (!consultation.bookingId) return;
												setGeneratingMeet(true);
												try {
													await bookingsApi.generateMeeting(consultation.bookingId);
													onToast("success", "Meeting link generated and emailed to client.");
													void refresh();
												} catch (err) {
													onToast("error", err instanceof Error ? err.message : "Could not generate a meeting link. Add a manual link instead.");
												} finally {
													setGeneratingMeet(false);
												}
											}}
										>
											{generatingMeet ? "Generating…" : "⚡ Generate meeting link"}
										</button>
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => { setMeetingUrlDraft(""); setEditingMeetingUrl(true); }}>
											+ Add Custom Link
										</button>
											</>
										)}
									</div>
								)}
							</div>
						) : (
							<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.3rem" }}>
								<input
									type="url"
									className="input input--sm"
									style={{ flex: 1, minWidth: "240px" }}
									placeholder="https://meet.google.com/… or https://zoom.us/j/…"
									value={meetingUrlDraft}
									onChange={(e) => setMeetingUrlDraft(e.target.value)}
								/>
								<button
									type="button"
									className="btn btn--primary btn--sm"
									disabled={savingMeetingUrl}
									onClick={async () => {
										if (!consultation.bookingId) return;
										const v = meetingUrlDraft.trim();
										if (v && !/^https:\/\//i.test(v)) {
											onToast("error", "Meeting link must start with https://");
											return;
										}
										setSavingMeetingUrl(true);
										try {
											await bookingsApi.setMeetingUrl(consultation.bookingId, v || null);
											setEditingMeetingUrl(false);
											onToast("success", v ? "Meeting link saved and emailed to client." : "Meeting link cleared.");
											void refresh();
										} catch (err) {
											onToast("error", err instanceof Error ? err.message : "Could not save the meeting link.");
										} finally {
											setSavingMeetingUrl(false);
										}
									}}
								>
									{savingMeetingUrl ? "Saving…" : "Save & Email Client"}
								</button>
								{!consultation.meetingLink && (
									<button
										type="button"
										className="btn btn--ghost btn--sm"
										disabled={generatingMeet}
										onClick={async () => {
											if (!consultation.bookingId) return;
											setGeneratingMeet(true);
											try {
												await bookingsApi.generateMeeting(consultation.bookingId);
												setEditingMeetingUrl(false);
												onToast("success", "Meeting link generated and emailed to client.");
												void refresh();
											} catch (err) {
												onToast("error", err instanceof Error ? err.message : "Could not generate a meeting link.");
											} finally {
												setGeneratingMeet(false);
											}
										}}
									>
										{generatingMeet ? "Generating…" : "⚡ Auto-generate meeting link"}
									</button>
								)}
								<button type="button" className="btn btn--ghost btn--sm" disabled={savingMeetingUrl} onClick={() => setEditingMeetingUrl(false)}>
									Cancel
								</button>
							</div>
						)}
					</div>
				);
			}
			if (consultation.mapsUrl) {
				return (
					<div style={{ padding: "0.75rem 1.25rem", background: "var(--muted)", borderBottom: "1px solid var(--border-light)", flexShrink: 0 }}>
						<p className="eyebrow" style={{ margin: "0 0 0.25rem" }}>Office location</p>
						<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.3rem" }}>
							<a href={consultation.mapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--sm" style={{ whiteSpace: "nowrap" }}>Get Directions →</a>
							<span className="mono muted" style={{ fontSize: "var(--text-xs)", wordBreak: "break-all" }}>{consultation.mapsUrl}</span>
						</div>
					</div>
				);
			}
			return null;
		})()}

		{/* --- ACTION TOOLBAR --- */}
		{/* Steering verbs live here — Reschedule, Cancel. Hidden while any
		    inline form or the reschedule panel is open. */}
		{(!editingMeetingUrl && !showCancelForm && !showReschedule) && (
			<div style={{ display: "flex", gap: "0.5rem", padding: "0.5rem 1.25rem", borderBottom: "1px solid var(--border-light)", background: "var(--card)", flexWrap: "wrap", alignItems: "center" }}>
				{(isMine || canAssignWork) && consultation.status !== "Completed" && consultation.status !== "Cancelled" && consultation.bookingId && (
					rescheduleButton
				)}
				{consultation.status === "In Assessment" && (canAssignWork || isMine) && (
					<button className="btn btn--ghost btn--sm" onClick={() => { void returnToConfirmed(consultation.id).then(() => refresh()); }}>
						← Back to confirmed
					</button>
				)}
				{canAssignWork && consultation.status !== "Completed" && consultation.status !== "Cancelled" && (
					<button className="btn btn--ghost btn--sm" style={{ color: "var(--danger)", marginLeft: "auto" }} onClick={() => setShowCancelForm(true)}>
						Cancel Case
					</button>
				)}
			</div>
		)}

		{/* --- INLINE FORMS --- */}
		{showCancelForm && (
			<div style={{ padding: "0.75rem 1.25rem", background: "var(--card)", borderBottom: "1px solid var(--border-light)" }}>
				<ul style={{ margin: "0 0 0.6rem", padding: 0, listStyle: "none", fontSize: "var(--text-xs)", color: "var(--muted-foreground)", lineHeight: 1.7 }}>
					<li>— Releases the slot and ends the meeting link</li>
					<li>— Releases the consultant and emails both sides</li>
					<li>— The client pays the fee again to rebook — unless you issue a free rebooking on the cancelled case</li>
				</ul>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", width: "100%", justifyContent: "flex-end" }}>
					<input
						type="text"
						value={cancelReason}
						onChange={(e) => setCancelReason(e.target.value)}
						placeholder="Cancellation reason (optional)"
						style={{ flex: 1, maxWidth: "320px", padding: "0.4rem 0.6rem", border: "1px solid var(--border-light)", fontSize: "var(--text-sm)" }}
					/>
					<button
						type="button"
						className="btn btn--sm"
						style={{ color: "var(--danger)", borderColor: "var(--danger)", whiteSpace: "nowrap" }}
						onClick={() => {
							void cancelConsultation(consultation.id, cancelReason.trim() || undefined)
								.then(() => {
									setShowCancelForm(false);
									setCancelReason("");
									void refresh();
									onToast("success", "Case cancelled — the client was emailed. Issue a free rebooking below if we cancelled on them.");
								})
								.catch((err: unknown) => {
									const msg = err instanceof Error ? err.message : "Could not cancel consultation.";
									onToast("error", msg);
								});
						}}
					>
						Confirm Cancel
					</button>
					<button
						type="button"
						className="btn btn--sm"
						onClick={() => { setShowCancelForm(false); setCancelReason(""); }}
					>
						Keep Case
					</button>
				</div>
			</div>
		)}

		{/* --- CONSOLIDATED STATUS STRIP --- */}
		{(() => {
			const alerts = [];
			if (consultation.status === "In Assessment") {
				alerts.push(<strong>Assessment in progress.</strong>);
				if (docs.pending > 0) alerts.push(`⚠ ${docs.pending} document(s) pending.`);
			}
			if (consultation.status === "Completed") {
				alerts.push(<strong>Assessment completed.</strong>);
				if (consultation.assessmentResult) alerts.push(`Outcome: ${consultation.assessmentResult.outcome} - ${consultation.assessmentResult.recProgram} at ${consultation.assessmentResult.recUniversity} (${consultation.assessmentResult.recCountry}).`);
			}
			if (alerts.length === 0) return null;

			return (
				<div style={{ padding: "0.5rem 1.25rem", background: "var(--muted)", borderBottom: "1px solid var(--border-light)", fontSize: "var(--text-xs)", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
					{alerts.map((alert, i) => (
						<span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem" }}>
							{i > 0 && <span style={{ opacity: 0.3 }}>|</span>}
							{alert}
						</span>
					))}
				</div>
			);
		})()}


			<CaseTabs
				tabs={[
					{ id: "profile", label: "Background" },
					{ id: "documents", label: `Documents${docs.pending ? ` · ${docs.pending} to review` : ""}` },
					{
						id: "assessment",
						label: "Decision",
						locked: consultation.status !== "In Assessment" && consultation.status !== "Completed",
						hint:
							consultation.status === "Under Review"
								? "Unlocks once the consultation is assigned"
								: consultation.status === "Assigned"
									? "Unlocks once the slot is confirmed"
									: "Unlocks when the assessment starts",
					},
				]}
				current={detailTab}
				onChange={setDetailTab}
				nowId={consultation.status === "Completed" ? "assessment" : "profile"}
			/>

			<div>

				{detailTab === "profile" && (
					<div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
						<div className="card">
							<p className="eyebrow mb-2">Where they are on the journey</p>
							<p style={{ fontWeight: 700 }}>{consultation.entryIntent ? SERVICE_INTENT_LABELS[consultation.entryIntent as ServiceIntent] ?? consultation.entryIntent : "Not said — treated as the full journey"}</p>
							<p className="muted text-xs" style={{ marginTop: "0.2rem" }}>
								Starts the plan at {scopeLabel(intentScope((consultation.entryIntent || "full") as ServiceIntent))}.
								{consultation.entryIntent === "visa" || consultation.entryIntent === "departure" ? " Check the offer they brought before anything else — it is the whole risk on this case." : ""}
							</p>
							{(consultation.entryIntent === "visa" || consultation.entryIntent === "departure") && consultation.entry && (
								<div className="ops-grid mt-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Offer · university</p><p>{consultation.entry.offerUniversity || "—"}</p></div>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Programme</p><p>{consultation.entry.offerProgram || "—"}</p></div>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Country</p><p>{consultation.entry.offerCountry || "—"}</p></div>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Offer type · reference</p><p>{[consultation.entry.offerType, consultation.entry.offerReference].filter(Boolean).join(" · ") || "—"}</p></div>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Intake</p><p>{consultation.entry.offerIntake || "—"}</p></div>
									<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Tuition · deposit paid</p><p>{[consultation.entry.offerTuition, consultation.entry.offerDepositPaid && `deposit: ${consultation.entry.offerDepositPaid}`].filter(Boolean).join(" · ") || "—"}</p></div>
									{consultation.entryIntent === "departure" && (
										<>
											<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Visa grant</p><p>{[consultation.entry.visaGrantReference, consultation.entry.visaGrantDate].filter(Boolean).join(" · ") || "—"}</p></div>
											<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Arrival window</p><p>{consultation.entry.arrivalWindow || "—"}</p></div>
										</>
									)}
								</div>
							)}
						</div>
						<div className="card">
							<p className="eyebrow mb-2">Personal</p>
							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Nationality</p><p>{consultation.personal.nationality}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Residence</p><p>{consultation.personal.residence}</p></div>
							</div>
						</div>
						<div className="card">
							<p className="eyebrow mb-2">Education Background</p>
							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Degree</p><p>{consultation.education.degree}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Institution</p><p>{consultation.education.institution}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>GPA / Grade</p><p>{consultation.education.gpa}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Graduation Year</p><p>{consultation.education.gradYear}</p></div>
							</div>
						</div>
						<div className="card">
							<p className="eyebrow mb-2">Employment & Financials</p>
							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Current Role</p><p>{consultation.employment.currentRole} at {consultation.employment.company}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Experience</p><p>{consultation.employment.experienceYears}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Funding Source</p><p>{consultation.financial.source}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Annual Budget</p><p>{consultation.financial.budget}</p></div>
							</div>
						</div>
						<div className="card">
							<p className="eyebrow mb-2">Study Goals</p>
							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Degree Level</p><p>{consultation.goals.degreeLevel}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Major Field</p><p>{consultation.goals.major}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target Intake</p><p>{consultation.goals.intake}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target Country</p><p>{consultation.targetCountry}</p></div>
							</div>
							{consultation.goals.choices?.length ? (
								<>
									<p className="muted mt-3" style={{ fontSize: "var(--text-xs)" }}>Choices, in order</p>
									<ol className="cn-choice-list">
										{consultation.goals.choices.map((c, i) => (
											<li key={i}>{[c.country, c.university, c.program || c.field, c.intake].filter(Boolean).join(" · ")}</li>
										))}
									</ol>
								</>
							) : null}
						</div>
					</div>
				)}

			{detailTab === "documents" && (
				<div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
					<CaseDocumentsPanel
						ownerUserId={consultation.applicantUserId}
						applicantName={consultation.applicantName}
						reference={consultation.ref}
						requestedDocuments={consultation.requestedDocuments ?? []}
						canReview={isMine || opsRole === "manager" || opsRole === "coordinator"}
						requestHint="Nothing requested yet."
						onChange={setRealDocs}
						checklist={consultation.documentChecklist}
						onRequest={
							(isMine || canAssignWork) && consultation.status !== "Completed" && consultation.status !== "Cancelled"
								? (docs) => requestConsultationDocs(consultation.id, docs).then(() => onToast("success", "Document request sent."))
								: undefined
						}
					/>
				</div>
			)}

				{detailTab === "assessment" && consultation.status === "Completed" && (
					<div className="card" style={{ marginTop: "1rem" }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
							<h3 className="section-title" style={{ margin: 0 }}>Consultation Assessment</h3>
							<span className="ops-badge" style={{ background: "var(--foreground)", color: "var(--background)" }}>🔒 Locked</span>
						</div>
						
						<dl className="cn-facts" style={{ marginTop: "1rem" }}>
							<dt>Outcome</dt>
							<dd><strong>{consultation.assessmentResult?.outcome ?? "—"}</strong></dd>

							<dt>Recommendation Notes</dt>
							<dd style={{ whiteSpace: "pre-wrap" }}>{consultation.assessmentResult?.notes ?? "—"}</dd>

							<dt>Recommended Country</dt>
							<dd>{consultation.assessmentResult?.recCountry ?? "—"}</dd>

							<dt>Recommended University</dt>
							<dd>{consultation.assessmentResult?.recUniversity ?? "—"}</dd>

							<dt>Recommended Program</dt>
							<dd>{consultation.assessmentResult?.recProgram ?? "—"}</dd>

							<dt>Recommended Package</dt>
							<dd>{consultation.assessmentResult?.recPackage ?? "—"}</dd>

							<dt>Recommended Plan</dt>
							<dd>{scopeLabel(consultation.assessmentResult?.recStages?.length ? consultation.assessmentResult.recStages : null)}</dd>
						</dl>
					</div>
				)}

				{detailTab === "assessment" && consultation.status !== "Completed" && !canAssess && (
					<div className="card" style={{ marginTop: "1rem" }}>
						<h3 className="section-title mb-3">Consultation Assessment Form</h3>
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
							Read-only - only the assigned consultant, a manager, or a coordinator can complete the assessment.
						</p>
					</div>
				)}

			{detailTab === "assessment" && consultation.status === "In Assessment" && canAssess && (
			<form onSubmit={handleCompleteAssessment} className="card" style={{ marginTop: "1rem" }}>
				<h3 className="section-title mb-3">Consultation Assessment Form</h3>
				{isSubmitted && (
					<div style={{ padding: "0.85rem", background: "var(--foreground)", color: "var(--background)", marginBottom: "1.25rem" }}>
						✓ Assessment recorded. Applicant status updated to {consultation.status}.
					</div>
				)}
				{docs.pending > 0 && (
					<div className="cn-next" style={{ marginBottom: "1.25rem" }}>
						<p className="cn-next__title">{docs.pending} document{docs.pending === 1 ? "" : "s"} still pending verification</p>
						<p className="cn-next__detail">
							It's recommended to verify all documents before completing the assessment. You can still proceed, but this will be noted in the record.
						</p>
						</div>
					)}
					{(consultation.entryIntent === "visa" || consultation.entryIntent === "departure") ? (
					<div style={{ marginBottom: "1.25rem" }}>
						<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
							Verdict · on the {consultation.entryIntent === "visa" ? "offer and the finances" : "visa and the offer"}
						</label>
						<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
							{([
								["proceed", "Proceed as chosen", "Offer sound, funds in place. The plan stands as the client picked it."],
								["widen", "Widen the scope", "Offer sound but weak, or funds short. Recommend adding a stage below."],
								["not_viable", "Not viable", "Offer unverifiable, sponsor unlicensed, or funds far short with no route."],
							] as const).map(([id, title, hint]) => (
								<button key={id} type="button" className={`btn ${verdict === id ? "btn--primary" : "btn--ghost"}`} style={{ textAlign: "left", display: "block", padding: "0.7rem 0.8rem", textTransform: "none", letterSpacing: 0 }} onClick={() => setVerdict(id)} aria-pressed={verdict === id}>
									<span style={{ display: "block", fontWeight: 700 }}>{title}</span>
									<span style={{ display: "block", fontSize: "var(--text-xs)", opacity: 0.8, marginTop: "0.2rem", lineHeight: 1.4 }}>{hint}</span>
								</button>
							))}
						</div>
						<p className="muted text-xs" style={{ marginTop: "0.4rem" }}>The plan can only be widened from what the client chose — narrowing is theirs to do in the builder.</p>
					</div>
					) : (
					<div style={{ marginBottom: "1.25rem" }}>
						<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
							Assessment Outcome
						</label>
						<select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="input" style={{ width: "100%", padding: "0.6rem" }}>
							<option value="Eligible">Eligible - Approve for School Selection</option>
							<option value="Conditionally Eligible">Conditionally Eligible - Pending Docs</option>
							<option value="Need More Information">Need More Information</option>
							<option value="Not Eligible">Not Eligible</option>
						</select>
					</div>
					)}
					<div style={{ marginBottom: "1.25rem" }}>
						<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
							Consultant Recommendation Notes
						</label>
						<textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detailed notes regarding eligibility, academic background, visa probability..." className="input" style={{ width: "100%", padding: "0.75rem", fontFamily: "inherit" }} />
					</div>
					<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended Country</label>
							<select value={recCountry} onChange={(e) => setRecCountry(e.target.value)} className="input" style={{ width: "100%", padding: "0.6rem" }}>
								<option value="">-- Select Country --</option>
								<option value="United States">United States</option>
								<option value="Canada">Canada</option>
								<option value="United Kingdom">United Kingdom</option>
								<option value="Australia">Australia</option>
								<option value="Germany">Germany</option>
								<option value="France">France</option>
								<option value="China">China</option>
								<option value="Other">Other</option>
							</select>
						</div>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended University</label>
							<input list="universities" type="text" value={recUniversity} onChange={(e) => setRecUniversity(e.target.value)} placeholder="Select or type..." className="input" style={{ width: "100%", padding: "0.6rem" }} />
							<datalist id="universities">
								<option value="Harvard University" />
								<option value="Stanford University" />
								<option value="Massachusetts Institute of Technology (MIT)" />
								<option value="University of Oxford" />
								<option value="University of Cambridge" />
								<option value="University of Toronto" />
								<option value="University of British Columbia" />
								<option value="McGill University" />
							</datalist>
						</div>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended Program</label>
							<input list="programs" type="text" value={recProgram} onChange={(e) => setRecProgram(e.target.value)} placeholder="Select or type..." className="input" style={{ width: "100%", padding: "0.6rem" }} />
							<datalist id="programs">
								<option value="Foundation in Computer Science" />
								<option value="BSc Computer Science" />
								<option value="BSc Business Administration" />
								<option value="BSc Nursing" />
								<option value="BSc Public Health" />
								<option value="MSc Data Science" />
								<option value="Master of Business Administration (MBA)" />
								<option value="MSc Artificial Intelligence" />
							</datalist>
						</div>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended Package</label>
							<select value={recPackage} onChange={(e) => setRecPackage(e.target.value)} className="input" style={{ width: "100%", padding: "0.6rem" }}>
								<option value="undecided">Undecided</option>
								<option value="non_scholarship">Non-Scholarship</option>
								<option value="scholarship">Scholarship</option>
								<option value="hybrid">Hybrid</option>
							</select>
						</div>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended Plan · {scopeLabel(recStages)}</label>
							<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
								{SERVICE_STAGES.map((st) => {
									const on = recStages.includes(st);
									// What the client chose stays; the consultant may only add.
									const chosen = intentScope((consultation.entryIntent || "full") as ServiceIntent);
									const fixed = chosen.includes(st) && consultation.entryIntent !== "full" && consultation.entryIntent !== "";
									return (
										<label key={st} className="btn btn--sm" style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
											<input
												type="checkbox"
												checked={on}
												disabled={fixed}
												onChange={() =>
													setRecStages((prev) => {
														const next = prev.includes(st) ? prev.filter((x) => x !== st) : [...prev, st];
														return next.length === 0 ? prev : normaliseScope(next);
													})
												}
											/>
											{SERVICE_STAGE_LABELS[st]}
										</label>
									);
								})}
							</div>
							<p className="muted text-xs" style={{ marginTop: "0.35rem" }}>Pre-fills the client's plan builder. They can change it before accepting.</p>
						</div>
					</div>
					<button type="submit" className="btn btn--primary" style={{ width: "100%", padding: "1rem", fontSize: "1rem", textTransform: "uppercase", letterSpacing: "1px" }}>
						Complete Consultation & Lock Assessment
					</button>
			</form>
		)}
			</div>
			{call ? (
				<ConsultationCall
					url={call.url}
					token={call.token}
					title={`Consultation · ${consultation.ref}`}
					waitingFor="the client"
					onClose={() => setCall(null)}
				/>
			) : null}
			{meetNotOpen ? (
				<MeetingWindowModal info={meetNotOpen} onClose={() => setMeetNotOpen(null)} />
			) : null}
			{meetEnded ? (
				<MeetingEndedModal info={meetEnded} onClose={() => setMeetEnded(null)} />
			) : null}
		</div>
	);
}
