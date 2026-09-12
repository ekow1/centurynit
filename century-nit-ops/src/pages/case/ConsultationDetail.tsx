import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOpsAuth } from "../OpsAuthContext";
import { useCases } from "../../hooks/useCases";
import { CaseWorkPanel } from "../CaseWorkPanel";
import { CaseDocumentsPanel } from "./CaseDocumentsPanel";
import { ReschedulePanel } from "../ReschedulePanel";
import type { MockConsultation } from "century-nit-core/ops";
import { documentsApi, bookingsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { StaffChatBadge } from "../StaffChatBadge";
import { getConsultationActivity, type ConsultationActivityEvent } from "../../lib/api";
import { timeAgo } from "../../lib/pendingTasks";
import { CaseHeader, JourneyStepper, NextActionBand, StatusPill, type NextAction } from "century-nit-core/ui";
import { PORTAL_STAGE_ORDER } from "century-nit-shared";

function isKnown(v: string | undefined | null): v is string {
	const s = (v ?? "").trim();
	return s !== "" && s !== "-" && s !== "-";
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
	onClosed,
}: {
	consultation: MockConsultation;
	onToast: (type: "error" | "success", message: string) => void;
	/** The detail closed itself (e.g. the case was cancelled). */
	onClosed: () => void;
}) {
	const navigate = useNavigate();
	const { opsRole, opsUser, canAssignWork } = useOpsAuth();
	const {
		applications,
		assignees,
		completeConsultationAssessment,
		assignConsultation,
		confirmConsultationSlot,
		startConsultationAssessment,
		commentOnConsultation,
		requestConsultationDocs,
		rescheduleConsultation,
		decideReschedule,
		cancelConsultation,
		delegateCoordinator,
		getWorkload,
		refresh,
	} = useCases();

	const [detailTab, setDetailTab] = useState<"profile" | "documents" | "assessment" | "activity">("profile");

	const [outcome, setOutcome] = useState("Eligible");
	const [notes, setNotes] = useState("");
	const [recCountry, setRecCountry] = useState("Canada");
	const [recUniversity, setRecUniversity] = useState("University of Toronto");
	const [recProgram, setRecProgram] = useState("Master of Science in Computer Science");
	const [recPackage, setRecPackage] = useState("undecided");
	const [isSubmitted, setIsSubmitted] = useState(false);
	const [showReschedule, setShowReschedule] = useState(false);
	const [realDocs, setRealDocs] = useState<ApplicantDocument[]>([]);
	const [showCoordinatorPicker, setShowCoordinatorPicker] = useState(false);
	const [coordinatorNote, setCoordinatorNote] = useState("");
	const [workloadData, setWorkloadData] = useState<Awaited<ReturnType<typeof getWorkload>> | null>(null);
	const [showCancelForm, setShowCancelForm] = useState(false);
	const [cancelReason, setCancelReason] = useState("");
	const [meetingUrlDraft, setMeetingUrlDraft] = useState("");
	const [editingMeetingUrl, setEditingMeetingUrl] = useState(false);
	const [savingMeetingUrl, setSavingMeetingUrl] = useState(false);
	const [generatingMeet, setGeneratingMeet] = useState(false);
	const [resendingMeetLink, setResendingMeetLink] = useState(false);
	const [workOpen, setWorkOpen] = useState<boolean>(() => {
		try {
			return localStorage.getItem("ops.case.workOpen") !== "0";
		} catch {
			return true;
		}
	});
	useEffect(() => {
		try {
			localStorage.setItem("ops.case.workOpen", workOpen ? "1" : "0");
		} catch {
			/* private mode */
		}
	}, [workOpen]);

	/** Result recorded this session, shown until the refreshed row carries it. */
	const [completedResult, setCompletedResult] = useState<MockConsultation["assessmentResult"] | null>(null);
	const consultation: MockConsultation = completedResult
		? { ...record, status: "Completed", assessmentResult: completedResult }
		: record;

	// The consultation's own timeline (the API has kept one all along).
	const [activity, setActivity] = useState<ConsultationActivityEvent[]>([]);
	const [activityLoading, setActivityLoading] = useState(false);
	useEffect(() => {
		if (detailTab !== "activity") return;
		setActivityLoading(true);
		getConsultationActivity(consultation.id)
			.then((res) => setActivity(res.activities))
			.catch(() => setActivity([]))
			.finally(() => setActivityLoading(false));
	}, [consultation.id, detailTab, consultation.status, consultation.assignedOfficer, (consultation.comments ?? []).length]);

	// Reset per-record state when a different consultation is shown.
	useEffect(() => {
		setOutcome(consultation.assessmentResult?.outcome || "Eligible");
		setNotes(consultation.assessmentResult?.notes || "");
		setRecCountry(consultation.assessmentResult?.recCountry || consultation.targetCountry || "");
		setRecUniversity(consultation.assessmentResult?.recUniversity || "");
		setRecProgram(consultation.assessmentResult?.recProgram || `${consultation.goals.degreeLevel || ""} in ${consultation.goals.major || ""}`.trim() || "");
		setRecPackage(consultation.assessmentResult?.recPackage || "");
		setDetailTab("profile");
		setIsSubmitted(false);
		setShowReschedule(false);
		setEditingMeetingUrl(false);
		setMeetingUrlDraft("");
		setCompletedResult(null);
	}, [consultation.id]);

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
		const result = { outcome, notes, recCountry, recUniversity, recProgram, recPackage };
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
	const journey: { portalStage: string; nextUnlock: string | null; stageStatuses: Record<string, "done" | "current" | "locked" | "skipped"> } =
		spawned?.journey ?? {
			portalStage: consultation.status === "Completed" ? "eligibility" : "consultation",
			nextUnlock: consultation.status === "Completed" ? "The applicant chooses whether to proceed" : null,
			stageStatuses: Object.fromEntries(
				PORTAL_STAGE_ORDER.map((id) => [
					id,
					id === "new"
						? "done"
						: id === "consultation"
							? consultation.status === "Completed"
								? "done"
								: consultation.status === "Cancelled"
									? "skipped"
									: "current"
							: id === "eligibility"
								? consultation.status === "Completed"
									? "current"
									: "locked"
								: "locked",
				]),
			),
		};

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
			action: rescheduleButton,
		});
	}
	if (consultation.status === "Assigned") {
		nextActions.push({
			id: "confirm",
			title: "Confirm the slot",
			detail: "Accept the booking time, or reschedule if needed.",
			action: (
				<>
					{rescheduleButton}
					<button type="button" onClick={() => void confirmConsultationSlot(consultation.id)} className="btn btn--primary btn--sm">
						Confirm slot
					</button>
				</>
			),
		});
	}
	if (consultation.status === "Confirmed") {
		nextActions.push({
			id: "start",
			title: "Start the assessment",
			detail: "Review the documents and background, then start when ready.",
			action: (
				<>
					{rescheduleButton}
					<button
						type="button"
						onClick={() => {
							void startConsultationAssessment(consultation.id);
							setDetailTab("assessment");
						}}
						className="btn btn--primary btn--sm"
					>
						Start assessment →
					</button>
				</>
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
			? "A manager assigns this booking; it appears here once it is yours."
			: consultation.status === "Completed"
				? spawned
					? null
					: "The applicant decides in their portal whether to proceed."
				: consultation.status === "Cancelled"
					? "This case was cancelled."
					: null;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
			<div className="card" style={{ padding: "0.75rem 1rem" }}>
				<CaseHeader
					name={consultation.applicantName}
					reference={consultation.ref}
					branch={consultation.branch}
					portalStage={journey?.portalStage ?? (consultation.status === "Completed" ? "eligibility" : "consultation")}
					handlerName={consultation.assignedOfficer || null}
					stageHandlers={consultation.coordinatorName ? [{ stage: "coordinator", name: consultation.coordinatorName }] : undefined}
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
				</CaseHeader>
			</div>

			{journey && (
				<div className="card" style={{ padding: "0.5rem 1rem 0.75rem" }}>
					<JourneyStepper stageStatuses={journey.stageStatuses} nextUnlock={journey.nextUnlock} />
				</div>
			)}

			<NextActionBand items={nextActions} waitingOn={waitingOn} />

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
		{(consultation.meetingLink || (consultation.slotConfirmed && consultation.mapsUrl)) && (
			<div className="card cn-next cn-next--waiting" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
				<div>
					<p className="cn-next__title">
						{consultation.type === "online" ? "Video meeting link" : "Office location"}
					</p>
					<p className="cn-next__detail">
						{consultation.type === "online"
							? consultation.meetingLink
							: consultation.mapsUrl}
					</p>
				</div>
				{consultation.type === "online" && consultation.meetingLink ? (
					<a
						href={consultation.meetingLink}
						target="_blank"
						rel="noopener noreferrer"
						className="btn btn--primary btn--sm"
						style={{ whiteSpace: "nowrap" }}
					>
						Join Meeting →
					</a>
				) : consultation.type !== "online" && consultation.mapsUrl ? (
					<a
						href={consultation.mapsUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="btn btn--secondary btn--sm"
						style={{ whiteSpace: "nowrap" }}
					>
						Get Directions →
					</a>
				) : null}
			</div>
		)}
		{consultation.bookingId && (canAssignWork || consultation.assignedOfficerEmail === opsUser?.email) && consultation.status !== "Completed" && consultation.status !== "Cancelled" && (
			(consultation.type === "online" || consultation.meetingLink || editingMeetingUrl) && (
				<div style={{ padding: "0.75rem 1.25rem", background: "var(--muted)", borderBottom: "1px solid var(--border-light)", flexShrink: 0 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
						<p className="eyebrow" style={{ margin: 0 }}>Meeting link</p>
						{consultation.meetingLink && (
							<span className="mono muted" style={{ fontSize: "var(--text-xs)", background: "var(--border-light)", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>
								{consultation.meetingLink.includes("meet.google.com") ? "Google Meet" : "Video Link"}
							</span>
						)}
					</div>
					{!editingMeetingUrl ? (
						<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.3rem" }}>
							{consultation.meetingLink ? (
								<>
									<a href={consultation.meetingLink} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--sm" style={{ whiteSpace: "nowrap" }}>Join →</a>
									<span className="mono muted" style={{ fontSize: "var(--text-xs)", wordBreak: "break-all" }}>{consultation.meetingLink}</span>
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
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => { setMeetingUrlDraft(consultation.meetingLink ?? ""); setEditingMeetingUrl(true); }}>Change</button>
								</>
							) : (
								<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
									<button
										type="button"
										className="btn btn--primary btn--sm"
										disabled={generatingMeet}
										onClick={async () => {
											if (!consultation.bookingId) return;
											setGeneratingMeet(true);
											try {
												await bookingsApi.generateMeeting(consultation.bookingId);
												onToast("success", "Google Meet link generated and emailed to client.");
												void refresh();
											} catch (err) {
												onToast("error", err instanceof Error ? err.message : "Could not auto-generate Google Meet. Add a manual link instead.");
											} finally {
												setGeneratingMeet(false);
											}
										}}
									>
										{generatingMeet ? "Generating Meet…" : "⚡ Generate Google Meet"}
									</button>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => { setMeetingUrlDraft(""); setEditingMeetingUrl(true); }}>
										+ Add Custom Link
									</button>
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
											onToast("success", "Google Meet link generated and emailed to client.");
											void refresh();
										} catch (err) {
											onToast("error", err instanceof Error ? err.message : "Could not auto-generate Google Meet link.");
										} finally {
											setGeneratingMeet(false);
										}
									}}
								>
									{generatingMeet ? "Generating…" : "⚡ Auto-generate Google Meet"}
								</button>
							)}
							<button type="button" className="btn btn--ghost btn--sm" disabled={savingMeetingUrl} onClick={() => setEditingMeetingUrl(false)}>
								Cancel
							</button>
						</div>
					)}
				</div>
			)
		)}

		{/* --- ACTION TOOLBAR --- */}
		{(!editingMeetingUrl && !showCancelForm && !showCoordinatorPicker) && (
			<div style={{ display: "flex", gap: "0.5rem", padding: "0.5rem 1.25rem", borderBottom: "1px solid var(--border-light)", background: "var(--card)", flexWrap: "wrap", alignItems: "center" }}>
				{!consultation.meetingLink && (
					<button className="btn btn--ghost btn--sm" onClick={() => { setMeetingUrlDraft(""); setEditingMeetingUrl(true); }}>
						+ Online Meeting
					</button>
				)}
				{canAssignWork && consultation.status !== "Completed" && consultation.status !== "Cancelled" && (
					<button className="btn btn--ghost btn--sm" onClick={async () => {
						setShowCoordinatorPicker(true);
						if (!workloadData) {
							try { setWorkloadData(await getWorkload()); } catch { /* ignore */ }
						}
					}}>
						{consultation.coordinatorName ? "Reassign Coordinator" : "+ Delegate"}
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
									onClosed();
									void refresh();
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

		{showCoordinatorPicker && (
			<div style={{ padding: "0.75rem 1.25rem", background: "var(--card)", borderBottom: "1px solid var(--border-light)" }}>
				<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
					<p style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
						Select a coordinator:
					</p>
					{workloadData ? (
						<div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
							{workloadData.coordinators.map((c) => (
								<button
									key={c.opsUserId}
									onClick={async () => {
										try {
											await delegateCoordinator(consultation.id, c.opsUserId, coordinatorNote || undefined);
											setShowCoordinatorPicker(false);
											setCoordinatorNote("");
											void refresh();
										} catch (err: unknown) {
											onToast("error", err instanceof Error ? err.message : "Failed to delegate");
										}
									}}
									className="btn btn--sm btn--ghost"
									style={{
										display: "flex",
										flexDirection: "column",
										alignItems: "flex-start",
										padding: "0.4rem 0.75rem",
										border: "1px solid var(--border)",
										borderRadius: "0",
									}}
								>
									<span style={{ fontWeight: 500 }}>{c.name}</span>
									<span style={{ fontSize: "10px", opacity: 0.7 }}>
										{c.activeCases}/{c.maxCapacity} cases
										{c.overdueCases > 0 && <span style={{ color: "var(--danger)" }}> · {c.overdueCases} overdue</span>}
									</span>
								</button>
							))}
						</div>
					) : (
						<p style={{ fontSize: "var(--text-xs)", opacity: 0.6 }}>Loading workload…</p>
					)}
					<input
						value={coordinatorNote}
						onChange={(e) => setCoordinatorNote(e.target.value)}
						placeholder="Delegation note (optional)"
						style={{ fontSize: "var(--text-xs)", padding: "0.3rem 0.5rem", border: "1px solid var(--border)" }}
					/>
					<button
						onClick={() => { setShowCoordinatorPicker(false); setCoordinatorNote(""); }}
						className="btn btn--sm btn--ghost"
						style={{ alignSelf: "flex-start" }}
					>
						Cancel
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
			if (consultation.workflow?.status === "CLOSED") {
				alerts.push(<strong style={{ color: "var(--danger)" }}>Cancelled.</strong>);
			}
			if (consultation.coordinatorName && !showCoordinatorPicker) {
				alerts.push(
					<span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
						Coordinator: <StaffChatBadge opsUserId={consultation.coordinatorEmail} name={consultation.coordinatorName} email={consultation.coordinatorEmail} />
					</span>
				);
			} else if (!consultation.coordinatorName && canAssignWork && consultation.status !== "Completed" && consultation.status !== "Cancelled") {
				alerts.push("No coordinator assigned.");
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

			<details className="cn-work" open={workOpen} onToggle={(e) => setWorkOpen((e.currentTarget as HTMLDetailsElement).open)}>
				<summary className="cn-work__summary">
					<span className="cn-work__title">Work panel</span>
					<span className="cn-work__facts">
						{consultation.assignedOfficer ? `Consultant ${consultation.assignedOfficer}` : "Unassigned"} · {(consultation.comments ?? []).length} note{(consultation.comments ?? []).length === 1 ? "" : "s"}
						{(consultation.requestedDocuments?.length ?? 0) > 0 ? ` · ${consultation.requestedDocuments!.length} document${consultation.requestedDocuments!.length === 1 ? "" : "s"} requested` : ""}
					</span>
					<span className="cn-work__hint">{workOpen ? "Hide" : "Assign · Comment · Request documents · Reschedule"}</span>
				</summary>
				<div className="cn-work__body">
				<CaseWorkPanel
					kind="consultation"
					assignedName={consultation.assignedOfficer}
					assignedEmail={consultation.assignedOfficerEmail}
					comments={consultation.comments ?? []}
					requestedDocuments={consultation.requestedDocuments ?? []}
				canAssign={canAssignWork && consultation.status !== "Completed" && consultation.status !== "In Assessment" && consultation.status !== "Cancelled"}
				closedNote={
					consultation.status === "Completed"
						? "Read-only - this consultation is completed. Reopen it to make changes."
						: consultation.status === "Cancelled"
							? "Read-only - this consultation has been cancelled."
							: undefined
				}
					actor={opsUser?.name ?? "Staff"}
					isMine={isMine}
					assignees={assignees}
					onAssign={(to) => void assignConsultation(consultation.id, to)}
					onComment={(kind, text) =>
						void commentOnConsultation(consultation.id, kind, text)
					}
					onRequestDocs={(docs) =>
						void requestConsultationDocs(consultation.id, docs)
					}
					branchLabel={consultation.branch}
					currentWhen={consultation.dateTime}
					onReschedule={
						consultation.bookingId
							? (date, time, reason) =>
									void rescheduleConsultation(
										consultation.id,
										consultation.bookingId!,
										date,
										time,
										reason,
									)
							: undefined
					}
				/>
				</div>
			</details>

			<div className="cn-tabs" role="tablist">
				{(["profile", "documents", "assessment", "activity"] as const).map((t) => {
					const labels = { profile: "Background", documents: `Documents${realDocs.length ? ` (${realDocs.length})` : ""}`, assessment: "Decision", activity: "Activity" };
					const locked = t === "assessment" && consultation.status === "Under Review";
					return (
						<button
							key={t}
							type="button"
							role="tab"
							aria-selected={detailTab === t}
							aria-disabled={locked}
							title={locked ? "Unlocks once the consultation is assigned" : undefined}
							className={`cn-tab${detailTab === t ? " cn-tab--active" : ""}${locked ? " cn-tab--locked" : ""}`}
							onClick={() => !locked && setDetailTab(t)}
						>
							{locked && <span aria-hidden>🔒 </span>}
							{labels[t]}
						</button>
					);
				})}
			</div>

			<div>

				{detailTab === "profile" && (
					<div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
						<div className="card">
							<p className="eyebrow mb-2">Personal & Contact</p>
							<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Email</p><p>{consultation.email}</p></div>
								<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Phone</p><p>{consultation.phone}</p></div>
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
						requestHint="Nothing requested yet — use Request documents in the work panel."
						onChange={setRealDocs}
						checklist={consultation.documentChecklist}
					/>
				</div>
			)}

				{detailTab === "assessment" && !canAssess && (
					<div className="card" style={{ marginTop: "1rem" }}>
						<h3 className="section-title mb-3">Consultation Assessment Form</h3>
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
							Read-only - only the assigned consultant, a manager, or a coordinator can complete the assessment.
						</p>
					</div>
				)}

			{detailTab === "activity" && (
				<div className="card" style={{ marginTop: "1rem" }}>
					<div className="cn-case__top">
						<h3 style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>Timeline</h3>
						<span className="cn-case__ref">{activity.length} events</span>
					</div>
					{activityLoading ? (
						<p className="muted">Loading timeline…</p>
					) : activity.length === 0 ? (
						<p className="muted">Nothing recorded on this consultation yet.</p>
					) : (
						<ol className="cn-timeline">
							{activity.map((e) => (
								<li key={e.id} className="cn-timeline__item">
									<div className="cn-timeline__head">
										<span className="cn-timeline__summary">{activitySummary(e)}</span>
										<time className="cn-timeline__when" dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()}>
											{timeAgo(e.createdAt)}
										</time>
									</div>
									{e.actorName && <p className="cn-timeline__meta">{e.actorName}</p>}
								</li>
							))}
						</ol>
					)}
				</div>
			)}

			{detailTab === "assessment" && canAssess && (
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
					<div style={{ marginBottom: "1.25rem" }}>
						<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
							Assessment Outcome
						</label>
						<select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="input" style={{ width: "100%" }}>
							<option value="Eligible">Eligible - Approve for School Selection</option>
							<option value="Conditionally Eligible">Conditionally Eligible - Pending Docs</option>
							<option value="Need More Information">Need More Information</option>
							<option value="Not Eligible">Not Eligible</option>
						</select>
					</div>
					<div style={{ marginBottom: "1.25rem" }}>
						<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
							Consultant Recommendation Notes
						</label>
						<textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detailed notes regarding eligibility, academic background, visa probability..." className="input" style={{ width: "100%" }} />
					</div>
					<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended Country</label>
							<input type="text" value={recCountry} onChange={(e) => setRecCountry(e.target.value)} className="input" style={{ width: "100%" }} />
						</div>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended University</label>
							<input type="text" value={recUniversity} onChange={(e) => setRecUniversity(e.target.value)} className="input" style={{ width: "100%" }} />
						</div>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended Program</label>
							<input type="text" value={recProgram} onChange={(e) => setRecProgram(e.target.value)} className="input" style={{ width: "100%" }} />
						</div>
						<div>
							<label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", marginBottom: "0.35rem" }}>Recommended Package</label>
							<select value={recPackage} onChange={(e) => setRecPackage(e.target.value)} className="input" style={{ width: "100%" }}>
								<option value="undecided">Undecided</option>
								<option value="non_scholarship">Non-Scholarship</option>
								<option value="scholarship">Scholarship</option>
								<option value="hybrid">Hybrid</option>
							</select>
						</div>
					</div>
					<button type="submit" className="btn btn--primary" style={{ width: "100%", padding: "0.85rem" }}>
						Complete Consultation & Lock Assessment
					</button>
			</form>
		)}
			</div>
		</div>
	);
}
