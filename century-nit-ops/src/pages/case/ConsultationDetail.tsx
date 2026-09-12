import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOpsAuth } from "../OpsAuthContext";
import { useCases } from "../../hooks/useCases";
import { CaseWorkPanel } from "../CaseWorkPanel";
import { DocPreviewInline, type DocPreviewData } from "../DocPreviewInline";
import { ReschedulePanel } from "../ReschedulePanel";
import type { MockConsultation } from "century-nit-core/ops";
import { documentsApi, bookingsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { StaffChatBadge } from "../StaffChatBadge";

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

const DOC_STATUS_MAP: Record<string, string> = {
	UPLOADED: "Pending Review",
	VERIFIED: "Verified",
	REJECTED: "Rejected",
	PENDING_UPLOAD: "Pending Upload",
};

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

	const [detailTab, setDetailTab] = useState<"profile" | "documents" | "assessment">("profile");
	const [previewingDoc, setPreviewingDoc] = useState<DocPreviewData | null>(null);

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
	/** Result recorded this session, shown until the refreshed row carries it. */
	const [completedResult, setCompletedResult] = useState<MockConsultation["assessmentResult"] | null>(null);
	const consultation: MockConsultation = completedResult
		? { ...record, status: "Completed", assessmentResult: completedResult }
		: record;

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
		setPreviewingDoc(null);
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

	// Close the document preview overlay with Escape.
	useEffect(() => {
		if (!previewingDoc) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setPreviewingDoc(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [previewingDoc]);


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

	async function handleReviewDoc(documentId: string, status: "VERIFIED" | "REJECTED") {
		try {
			const updated = await documentsApi.review(documentId, { status });
			setRealDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
			setPreviewingDoc((prev) =>
				prev
					? { ...prev, status: DOC_STATUS_MAP[updated.status] ?? updated.status, documentId: updated.id }
					: prev,
			);
		} catch (err: unknown) {
			onToast("error", err instanceof Error ? err.message : "Could not review document");
		}
	}

	const docs = docSummary(consultation, realDocs);
	const isMine = Boolean(consultation.assignedOfficerEmail === opsUser?.email);
	const canAssess = isMine || opsRole === "manager" || opsRole === "coordinator";
	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;

	return (
		<>
			{/* Detail Header */}
			<div style={{
				padding: "1rem 1.25rem",
				background: "var(--foreground)",
				color: "var(--background)",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-start",
				flexShrink: 0,
			}}>
				<div>
					<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
						<span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", opacity: 0.7 }}>
							{consultation.ref}
						</span>
						<span className="portal-pill" style={{ background: "var(--background)", color: "var(--foreground)", border: "none", fontSize: "var(--text-xs)" }}>
							{consultation.status}
						</span>
						{docs.pending > 0 && (
							<span style={{
								padding: "0.15rem 0.4rem",
								background: "rgba(254, 243, 199, 0.2)",
								border: "1px solid rgba(254, 243, 199, 0.4)",
								color: "#fde68a",
								fontSize: "0.65rem",
								fontWeight: 600,
							}}>
								{docs.pending} DOC{docs.pending !== 1 ? "S" : ""} PENDING
							</span>
						)}
					</div>
					<h2 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", color: "var(--background)", margin: 0 }}>
						{consultation.applicantName}
					</h2>
						<p style={{ opacity: 0.75, fontSize: "var(--text-xs)", marginTop: "0.2rem", display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
							{(() => {
								const rec = consultation.assessmentResult;
								if (consultation.status === "Completed" && rec && (rec.recCountry || rec.recUniversity || rec.recProgram)) {
									const country = rec.recCountry || consultation.targetCountry || "Unknown";
									const uni = rec.recUniversity || "University";
									const prog = rec.recProgram || "Program";
									return <span>Targeting {country}: {uni} · {prog}</span>;
								}
								return isKnown(consultation.targetCountry) ? <span>Targeting {consultation.targetCountry}</span> : <span>Target not set</span>;
							})()}
							<span>·</span>
							{consultation.assignedOfficer ? (
								<StaffChatBadge
									opsUserId={opsUserIdByEmail(consultation.assignedOfficerEmail)}
									name={consultation.assignedOfficer}
									email={consultation.assignedOfficerEmail}
								/>
							) : (
								<span>Unassigned</span>
							)}
							<span>·</span>
							<span>{consultation.branch}</span>
						</p>
						<p style={{ opacity: 0.6, fontSize: "var(--text-xs)", marginTop: "0.15rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
								<span>{consultation.dateTime} · {consultation.type} · {docs.verified}/{docs.total} verified · {docs.pending} pending{docs.rejected > 0 ? ` · ${docs.rejected} rejected` : ""}</span>
							{consultation.applicationId ? (
								<button
									type="button"
									className="link-arrow"
									style={{ color: "var(--background)", textDecoration: "underline" }}
									onClick={() => navigate(`/applications?id=${consultation.applicationId}`)}
								>
									→ Application {consultation.applicationNumber || consultation.applicationId.slice(0, 8).toUpperCase()} · {consultation.applicationStage}
								</button>
							) : null}
						</p>
				</div>
				<button
					type="button"
					onClick={() => onClosed()}
					aria-label="Close detail"
					style={{
						width: "40px",
						height: "40px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						border: "1px solid rgba(255, 255, 255, 0.25)",
						background: "transparent",
						color: "var(--background)",
						fontSize: "1.1rem",
						cursor: "pointer",
						transition: "all 100ms",
						flexShrink: 0,
					}}
					onMouseEnter={(e) => {
						e.currentTarget.style.background = "var(--background)";
						e.currentTarget.style.color = "var(--foreground)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.background = "transparent";
						e.currentTarget.style.color = "var(--background)";
					}}
				>
					✕
				</button>
			</div>

		{/* Status Action Bar */}
		{consultation.rescheduleRequestedAt && (
			(() => {
				const canActOnReschedule = 
					(consultation.assignedOfficerEmail && opsUser?.email === consultation.assignedOfficerEmail) || 
					(!consultation.assignedOfficerEmail && canAssignWork);
				
				return (
					<div style={{ padding: "0.75rem 1.25rem", background: "var(--bg-warning)", borderBottom: "1px solid var(--border-light)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
						<div>
							<p style={{ fontSize: "var(--text-sm)", color: "var(--text-warning)" }}>
								<strong>Applicant requested a reschedule.</strong>
							</p>
							<p style={{ fontSize: "var(--text-xs)", color: "var(--text-warning)", marginTop: "0.2rem" }}>
								They want to move this to <strong>{new Date(consultation.rescheduleRequestedStartsAt!).toLocaleString()}</strong>.
								{consultation.rescheduleRequestReason && <><br/>Reason: {consultation.rescheduleRequestReason}</>}
							</p>
						</div>
						<div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
							{canActOnReschedule ? (
								<>
									<button
										onClick={() => {
											if (consultation.bookingId) void decideReschedule(consultation.bookingId, "reject");
										}}
										className="btn btn--sm btn--ghost"
									>
										Reject
									</button>
									<button
										onClick={() => {
											if (consultation.bookingId) void decideReschedule(consultation.bookingId, "approve");
										}}
										className="btn btn--sm btn--primary"
									>
										✓ Approve
									</button>
								</>
							) : (
								<span style={{ fontSize: "var(--text-xs)", color: "var(--text-warning)", fontWeight: 500 }}>
									Waiting for {consultation.assignedOfficer ? "assigned consultant" : "manager"} to review
								</span>
							)}
						</div>
					</div>
				);
			})()
		)}

		{consultation.status === "Under Review" && !consultation.assignedOfficer && canAssignWork && (
			<div style={{ padding: "0.75rem 1.25rem", background: "#fef3c7", borderBottom: "1px solid #fde68a", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
				<p style={{ fontSize: "var(--text-sm)", color: "#92400e" }}>
					<strong>New booking awaiting assignment.</strong> Review the applicant's background below, then assign to a consultant using the panel.
				</p>
				<button
					onClick={() => setShowReschedule(!showReschedule)}
					className={`btn btn--sm ${showReschedule ? "btn--primary" : "btn--ghost"}`}
					style={{ whiteSpace: "nowrap" }}
				>
					↻ Reschedule
				</button>
			</div>
		)}
		{consultation.status === "Under Review" && !canAssignWork && (
			<div style={{ padding: "0.75rem 1.25rem", background: "var(--muted)", borderBottom: "1px solid var(--border-light)", flexShrink: 0 }}>
				<p style={{ fontSize: "var(--text-sm)" }} className="muted">
					This booking is awaiting manager assignment. You'll see it here once it's assigned to you.
				</p>
			</div>
		)}
		{consultation.status === "Assigned" && (
			<div style={{ padding: "0.75rem 1.25rem", background: "#e0e7ff", borderBottom: "1px solid #c7d2fe", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
				<p style={{ fontSize: "var(--text-sm)", color: "#4338ca" }}>
					<strong>Assigned.</strong> Confirm the slot to accept the booking time, or reschedule if needed.
				</p>
				<div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
					<button
						onClick={() => setShowReschedule(!showReschedule)}
						className={`btn btn--sm ${showReschedule ? "btn--primary" : "btn--ghost"}`}
					>
						↻ Reschedule
					</button>
					<button
						onClick={() => void confirmConsultationSlot(consultation.id)}
						className="btn btn--primary btn--sm"
						style={{ whiteSpace: "nowrap" }}
					>
						✓ Confirm Slot
					</button>
				</div>
			</div>
		)}
		{consultation.status === "Confirmed" && (
			<div style={{ padding: "0.75rem 1.25rem", background: "#d1fae5", borderBottom: "1px solid #6ee7b7", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
				<p style={{ fontSize: "var(--text-sm)", color: "#065f46" }}>
					<strong>Slot confirmed.</strong> Review the documents and applicant background, then start the assessment when ready.
				</p>
				<div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
					<button
						onClick={() => setShowReschedule(!showReschedule)}
						className={`btn btn--sm ${showReschedule ? "btn--primary" : "btn--ghost"}`}
					>
						↻ Reschedule
					</button>
					<button
						onClick={() => {
							void startConsultationAssessment(consultation.id);
							setDetailTab("assessment");
						}}
						className="btn btn--primary btn--sm"
						style={{ whiteSpace: "nowrap" }}
					>
						Start Assessment →
					</button>
				</div>
			</div>
		)}
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
			<div style={{ padding: "0.75rem 1.25rem", background: "#f0f9ff", borderBottom: "1px solid #bae6fd", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
				<div>
					<p style={{ fontSize: "var(--text-sm)", color: "#0c4a6e", fontWeight: 600 }}>
						{consultation.type === "online" ? "Video Meeting Link" : "Office Location"}
					</p>
					<p style={{ fontSize: "var(--text-xs)", color: "#0c4a6e", opacity: 0.8, marginTop: "0.2rem" }}>
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

			{/* Detail Tabs */}
			<div style={{ display: "flex", borderBottom: "1px solid var(--border-light)", background: "var(--muted)", flexShrink: 0 }}>
				{(["profile", "documents", "assessment"] as const).map((t) => {
					const labels = { profile: "1. Background", documents: `2. Documents (${realDocs.length})`, assessment: "3. Decision" };
					const disabled = t === "assessment" && consultation.status === "Under Review";
					return (
						<button
							key={t}
							onClick={() => !disabled && setDetailTab(t)}
							style={{
								flex: 1,
								padding: "0.7rem",
								fontFamily: "var(--font-mono)",
								fontSize: "var(--text-xs)",
								textTransform: "uppercase",
								borderBottom: detailTab === t ? "2px solid var(--foreground)" : "2px solid transparent",
								fontWeight: detailTab === t ? 600 : 400,
								background: "none",
								border: "none",
								borderBottomWidth: "2px",
								borderBottomStyle: "solid",
								cursor: disabled ? "not-allowed" : "pointer",
								color: disabled ? "var(--muted-foreground)" : "var(--foreground)",
								opacity: disabled ? 0.4 : 1,
							}}
						>
							{labels[t]}
						</button>
					);
				})}
			</div>

			{/* Detail Content - scrollable.
			    minHeight:0 is required: a flex item defaults to min-height:auto,
			    so without it this refuses to shrink below its own content and the
			    fixed chrome above pushes it off the bottom of the pane. */}
			<div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "1.25rem" }}>
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
				previewingDoc ? (
					<div className="ops-modal-backdrop" onClick={() => setPreviewingDoc(null)} role="dialog" aria-modal="true" aria-label={`Preview ${previewingDoc.name}`}>
						<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "46rem" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1rem" }}>
								<div>
									<h3 style={{ margin: 0, fontSize: "var(--text-lg)", lineHeight: 1.2 }}>{previewingDoc.name}</h3>
									<p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "var(--text-sm)" }}>
										{previewingDoc.category} · {consultation.applicantName} · {consultation.ref}
									</p>
								</div>
								<button type="button" onClick={() => setPreviewingDoc(null)} aria-label="Close preview" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.5rem", lineHeight: 1, color: "var(--muted-foreground)", padding: "0.25rem" }}>×</button>
							</div>
						<DocPreviewInline
						doc={previewingDoc}
						isMine={isMine}
						applicantName={consultation.applicantName}
						reference={consultation.ref}
						documentId={previewingDoc.documentId}
						onVerdict={(status) => void handleReviewDoc(previewingDoc.documentId!, status)}
					/>
						</div>
					</div>
				) : (
					<div className="card" style={{ marginTop: "1rem" }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
							<p className="eyebrow">Uploaded Documents</p>
							<span style={{ fontSize: "var(--text-xs)", color: docs.pending > 0 ? "#92400e" : "#065f46", fontWeight: 600 }}>
								{docs.verified}/{docs.uploaded || docs.total} verified{docs.pending > 0 ? ` · ${docs.pending} pending` : docs.uploaded > 0 ? " ✓ all clear" : ""}
							</span>
						</div>
						{docs.pending > 0 && (
							<div style={{ padding: "0.6rem 0.85rem", background: "#fef3c7", border: "1px solid #fde68a", marginBottom: "0.75rem", fontSize: "var(--text-xs)", color: "#92400e" }}>
								{docs.pending} document(s) awaiting verification. Verify or reject each document before completing the assessment.
							</div>
						)}
						{realDocs.length === 0 && (consultation.requestedDocuments?.length ?? 0) > 0 && (
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
								No documents uploaded yet. The applicant has been asked to provide: {(consultation.requestedDocuments ?? []).join(", ")}.
							</p>
						)}
						{realDocs.length === 0 && (consultation.requestedDocuments?.length ?? 0) === 0 && (
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
								No documents have been uploaded or requested for this case yet.
							</p>
						)}
						<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
							{realDocs.map((doc, idx) => {
								const displayStatus = DOC_STATUS_MAP[doc.status] ?? doc.status;
								const settled = doc.status === "VERIFIED" || doc.status === "REJECTED";
								const docKey = `applicant:${consultation.applicantId}:${doc.documentType}`;
								return (
									<li key={doc.id} style={{ padding: "0.75rem 0.5rem", borderBottom: idx < realDocs.length - 1 ? "1px solid var(--border-light)" : "none" }}>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
										<button
											type="button"
											onClick={() => setPreviewingDoc({ name: doc.fileName, category: doc.documentType, status: displayStatus, isLive: true, docKey, documentId: doc.id })}
											style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0 }}
										>
												<span style={{ fontSize: "1.1rem", fontFamily: "var(--font-mono)" }}>≡</span>
												<div style={{ minWidth: 0 }}>
													<p style={{ fontWeight: 500, fontSize: "var(--text-sm)", textDecoration: "underline", textUnderlineOffset: "3px" }}>{doc.fileName}</p>
													<p className="muted" style={{ fontSize: "var(--text-xs)" }}>{doc.documentType} · {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(0)} KB` : ""} · Click to inspect →</p>
												</div>
											</button>
											<span className="portal-pill" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{displayStatus}</span>
										</div>
									{!settled && isMine && (
										<div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem", paddingLeft: "1.875rem", flexWrap: "wrap" }}>
											<button
												type="button"
												onClick={() => void handleReviewDoc(doc.id, "VERIFIED")}
												className="btn btn--sm"
												style={{ padding: "0.25rem 0.6rem", fontSize: "0.72rem" }}
											>
												✓ Verify
											</button>
											<button
												type="button"
												onClick={() => void handleReviewDoc(doc.id, "REJECTED")}
												className="btn btn--ghost btn--sm"
												style={{ padding: "0.25rem 0.6rem", fontSize: "0.72rem" }}
											>
✕ Reject
										</button>
										</div>
									)}
										{!settled && !isMine && (
											<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem", paddingLeft: "1.875rem" }}>
												Read-only - only the assigned consultant can verify documents.
											</p>
										)}
									</li>
								);
							})}
						</ul>
					</div>
				)
			)}

				{detailTab === "assessment" && !canAssess && (
					<div className="card" style={{ marginTop: "1rem" }}>
						<h3 className="section-title mb-3">Consultation Assessment Form</h3>
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
							Read-only - only the assigned consultant, a manager, or a coordinator can complete the assessment.
						</p>
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
					<div style={{ padding: "0.75rem 1rem", background: "#fef3c7", border: "1px solid #fde68a", marginBottom: "1.25rem" }}>
						<p style={{ fontSize: "var(--text-sm)", color: "#92400e", fontWeight: 600 }}>⚠ {docs.pending} document(s) still pending verification</p>
						<p style={{ fontSize: "var(--text-xs)", color: "#92400e", marginTop: "0.25rem" }}>
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
		</>
	);
}
