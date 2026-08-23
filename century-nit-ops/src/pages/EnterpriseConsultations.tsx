import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { CaseWorkPanel } from "./CaseWorkPanel";
import { DocPreviewInline, type DocPreviewData } from "./DocPreviewInline";
import { ReschedulePanel } from "./ReschedulePanel";
import { Toast } from "./OpsDialogs";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import type { MockConsultation } from "century-nit-core/ops";
import { documentsApi, bookingsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
import { StaffChatBadge } from "./StaffChatBadge";

/** Placeholder values shouldn't be joined into a meta line as bare em-dashes */
function isKnown(v: string | undefined | null): v is string {
	const s = (v ?? "").trim();
	return s !== "" && s !== "-" && s !== "-";
}

function docSummary(c: MockConsultation, realDocs: ApplicantDocument[]) {
	const requested = c.requestedDocuments?.length ?? 0;
	const uploaded = realDocs.filter((d) => d.status === "UPLOADED" || d.status === "VERIFIED").length;
	const verified = realDocs.filter((d) => d.status === "VERIFIED").length;
	const pending = realDocs.filter((d) => d.status === "UPLOADED").length;
	return { total: Math.max(requested, realDocs.length), verified, pending, uploaded };
}

const DOC_STATUS_MAP: Record<string, string> = {
	UPLOADED: "Pending Review",
	VERIFIED: "Verified",
	REJECTED: "Rejected",
	PENDING_UPLOAD: "Pending Upload",
};

export function EnterpriseConsultations() {
	const [searchParams] = useSearchParams();
	const { opsRole, opsUser, canSeeAllBranches, canAssignWork, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const {
		consultations,
		assignees,
		error: casesError,
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
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedConsultation, setSelectedConsultation] = useState<MockConsultation | null>(null);

	const queryId = searchParams.get("id");
	useEffect(() => {
		if (queryId) {
			const match = consultations.find((c) => c.id === queryId);
			if (match) setSelectedConsultation(match);
		}
	}, [queryId, consultations]);
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
	const [branchFilter, setBranchFilter] = useState("all");
	const [realDocs, setRealDocs] = useState<ApplicantDocument[]>([]);
	const [showCoordinatorPicker, setShowCoordinatorPicker] = useState(false);
	const [coordinatorNote, setCoordinatorNote] = useState("");
	const [workloadData, setWorkloadData] = useState<Awaited<ReturnType<typeof getWorkload>> | null>(null);
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const showToast = (type: "error" | "success", message: string) => setToast({ type, message });
	const [showCancelForm, setShowCancelForm] = useState(false);
	const [cancelReason, setCancelReason] = useState("");
	const [meetingUrlDraft, setMeetingUrlDraft] = useState("");
	const [editingMeetingUrl, setEditingMeetingUrl] = useState(false);
	const [savingMeetingUrl, setSavingMeetingUrl] = useState(false);
	/* Date, slot and reason now live inside ReschedulePanel */

	const canSeeAll = canSeeAllBranches;
	const reviewCount = consultations.filter((c) => c.status === "Under Review").length;

	const roleScopedConsultations = useMemo(
		() =>
			scopeRecords(
				consultations,
				(c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
			),
		[scopeRecords, consultations, opsUser],
	);

	const filteredConsultations = roleScopedConsultations.filter((c) => {
		if (branchFilter !== "all" && c.branch !== branchFilter) return false;
		const matchesSearch =
			c.applicantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			c.ref.toLowerCase().includes(searchQuery.toLowerCase()) ||
			c.targetCountry.toLowerCase().includes(searchQuery.toLowerCase()) ||
			c.assignedOfficer.toLowerCase().includes(searchQuery.toLowerCase());
		if (!matchesSearch) return false;
		if (statusFilter === "All") return true;
		if (statusFilter === "Unassigned") return !c.assignedOfficer;
		return c.status === statusFilter;
	});

	const liveSelected = selectedConsultation
		? consultations.find((c) => c.id === selectedConsultation.id) ?? selectedConsultation
		: null;

	useEffect(() => {
		if (!liveSelected?.applicantId) { setRealDocs([]); return; }
		let cancelled = false;
		documentsApi
			.list({ ownerUserId: liveSelected.applicantId })
			.then((res) => { if (!cancelled) setRealDocs(res.documents); })
			.catch(() => { if (!cancelled) setRealDocs([]); });
		return () => { cancelled = true; };
	}, [liveSelected?.applicantId]);

	function openDetail(c: MockConsultation) {
		setSelectedConsultation(c);
		setOutcome(c.assessmentResult?.outcome || "Eligible");
		setNotes(c.assessmentResult?.notes || "");
		setRecCountry(c.assessmentResult?.recCountry || c.targetCountry || "");
		setRecUniversity(c.assessmentResult?.recUniversity || "");
		setRecProgram(c.assessmentResult?.recProgram || `${c.goals.degreeLevel || ""} in ${c.goals.major || ""}`.trim() || "");
		setRecPackage(c.assessmentResult?.recPackage || "");
		setDetailTab("profile");
		setIsSubmitted(false);
		setPreviewingDoc(null);
		setShowReschedule(false);
		setEditingMeetingUrl(false);
		setMeetingUrlDraft("");
	}

	async function handleCompleteAssessment(e: React.FormEvent) {
		e.preventDefault();
		if (!selectedConsultation) return;
		const result = { outcome, notes, recCountry, recUniversity, recProgram, recPackage };
		const res = await completeConsultationAssessment(selectedConsultation.id, result);
		setSelectedConsultation({ ...selectedConsultation, status: "Completed", assessmentResult: res.consultation.assessmentResult ?? result });
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
			showToast("error", err instanceof Error ? err.message : "Could not review document");
		}
	}

	const active = liveSelected ?? selectedConsultation;
	const docs = active ? docSummary(active, realDocs) : { total: 0, verified: 0, pending: 0, uploaded: 0 };
	const isMine = Boolean(active && active.assignedOfficerEmail === opsUser?.email);
	const canAssess = isMine || opsRole === "manager" || opsRole === "coordinator";
	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem" }}>
				<div>
					<h1 className="page-title">Consultations</h1>
					<p className="lead mt-1">
						Bookings arrive from the client portal. {canAssignWork ? "Assign to a consultant to begin the assessment." : "You see the ones assigned to you."}
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{reviewCount > 0 && canAssignWork && (
						<span className="portal-pill" style={{ background: "#fef3c7", color: "#92400e", whiteSpace: "nowrap" }}>
							{reviewCount} awaiting assignment
						</span>
					)}
					{canSeeAll && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			{casesError ? <p className="ops-modal__error" role="alert">{casesError}</p> : null}

			<div style={{
				padding: "0.65rem 1rem",
				border: "1px solid var(--border-light)",
				background: canSeeAll ? "var(--foreground)" : "var(--muted)",
				color: canSeeAll ? "var(--background)" : "var(--foreground)",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				marginBottom: "1rem",
			}}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
					<span style={{ fontSize: "1rem" }}>{canSeeAll ? "◱" : "◎"}</span>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						{/* Manager sees every branch; the coordinator is scoped to their
						    own branch; the consultant to their assignments. */}
						{canSeeAll
							? `All ${roleScopedConsultations.length} consultations · ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: requiresAssignmentScope
								? `${roleScopedConsultations.length} assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch · ${roleScopedConsultations.length} consultations`}
					</p>
				</div>
				<span className="portal-pill" style={canSeeAll ? { background: "var(--background)", color: "var(--foreground)", border: "none" } : undefined}>
					{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
				</span>
			</div>

			{/* Split Pane Layout */}
			<div className="ops-split" style={{ display: "flex", gap: "1rem", height: "var(--ops-pane-h)", minHeight: "var(--ops-pane-min)" }}>
				{/* LEFT: List Pane */}
				<div className="ops-split__list" style={{ flex: "0 0 40%", minWidth: "360px", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border-light)" }}>
					<div style={{ padding: "0.75rem", borderBottom: "1px solid var(--border-light)", background: "var(--muted)", flexShrink: 0 }}>
						<div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
							{(canAssignWork
								? ["All", "Under Review", "Assigned", "In Assessment", "Completed", "Cancelled"]
								: ["All", "Assigned", "In Assessment", "Completed", "Cancelled"]
							).map((tab) => (
								<button
									key={tab}
									onClick={() => setStatusFilter(tab)}
									className={`btn btn--sm ${statusFilter === tab ? "btn--primary" : "btn--ghost"}`}
									style={{ padding: "0.3rem 0.6rem", fontSize: "var(--text-xs)" }}
								>
									{tab}
								</button>
							))}
						</div>
						<input
							type="search"
							placeholder="Search applicant, ref, country..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="input input--sm"
							style={{ width: "100%" }}
						/>
					</div>

					<div style={{ flex: 1, overflowY: "auto" }}>
						{filteredConsultations.length === 0 ? (
							<div style={{ padding: "3rem 1.5rem", textAlign: "center" }} className="muted">
								No consultations match your filter.
							</div>
						) : (
							filteredConsultations.map((c) => {
								const isSelected = selectedConsultation?.id === c.id;
								const d = docSummary(c, realDocs);
								return (
									<div
										key={c.id}
										onClick={() => openDetail(c)}
										style={{
											padding: "0.85rem 1rem",
											borderBottom: "1px solid var(--border-light)",
											cursor: "pointer",
											transition: "background 100ms",
											background: isSelected ? "var(--foreground)" : "transparent",
											color: isSelected ? "var(--background)" : "var(--foreground)",
											borderLeft: isSelected ? "4px solid var(--accent, #6366f1)" : "4px solid transparent",
										}}
										onMouseEnter={(e) => {
											if (!isSelected) e.currentTarget.style.background = "var(--muted)";
										}}
										onMouseLeave={(e) => {
											if (!isSelected) e.currentTarget.style.background = "transparent";
										}}
									>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
											<div style={{ minWidth: 0, flex: 1 }}>
												<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.2rem" }}>
													<span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600, opacity: 0.8 }}>
														{c.ref}
													</span>
												<span className="portal-pill" style={{
													fontSize: "var(--text-xs)",
													padding: "0.15rem 0.4rem",
													background: isSelected ? "var(--background)" : undefined,
													color: isSelected ? "var(--foreground)" : undefined,
													border: isSelected ? "none" : undefined,
												}}>
													{c.status}
												</span>
												</div>
												<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{c.applicantName}</p>
												<p style={{ fontSize: "var(--text-xs)", opacity: 0.65, marginTop: "0.15rem" }}>
													{/* Drop unknowns rather than printing "Live · portal session · - · Online" */}
													{[c.dateTime, c.targetCountry, c.type].filter(isKnown).join(" · ")}
												</p>
												<div style={{ display: "flex", gap: "0.75rem", fontSize: "var(--text-xs)", marginTop: "0.2rem", alignItems: "center" }}>
													{c.assignedOfficer ? (
														<StaffChatBadge
															opsUserId={opsUserIdByEmail(c.assignedOfficerEmail)}
															name={c.assignedOfficer}
															email={c.assignedOfficerEmail}
														/>
													) : (
														<span>Unassigned</span>
													)}
													{c.coordinatorName && (
														<>
															<span>·</span>
															<span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
																Coord: <StaffChatBadge opsUserId={c.coordinatorEmail} name={c.coordinatorName} email={c.coordinatorEmail} />
															</span>
														</>
													)}
													<span>·</span>
													<span>{d.verified}/{d.total} docs verified{d.pending > 0 ? ` · ${d.pending} pending` : ""}</span>
												</div>
											</div>
											<span style={{ fontSize: "0.9rem", flexShrink: 0, marginLeft: "0.5rem" }}>→</span>
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>

				{/* RIGHT: Detail Pane */}
				<div className="ops-split__detail" style={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					border: "1px solid var(--border)",
					background: "var(--background)",
				}}>
					{!selectedConsultation || !active ? (
						<div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
							<span style={{ fontSize: "2.5rem", opacity: 0.15, marginBottom: "1rem" }}>◷</span>
							<p className="muted" style={{ fontSize: "var(--text-sm)", textAlign: "center" }}>
								Select a consultation from the list to view the full assessment workflow.
							</p>
						</div>
					) : (
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
											{active.ref}
										</span>
										<span className="portal-pill" style={{ background: "var(--background)", color: "var(--foreground)", border: "none", fontSize: "var(--text-xs)" }}>
											{active.status}
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
										{active.applicantName}
									</h2>
									<p style={{ opacity: 0.75, fontSize: "var(--text-xs)", marginTop: "0.2rem", display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
										{isKnown(active.targetCountry) ? <span>Targeting {active.targetCountry}</span> : <span>Target not set</span>}
										<span>·</span>
										{active.assignedOfficer ? (
											<StaffChatBadge
												opsUserId={opsUserIdByEmail(active.assignedOfficerEmail)}
												name={active.assignedOfficer}
												email={active.assignedOfficerEmail}
											/>
										) : (
											<span>Unassigned</span>
										)}
										<span>·</span>
										<span>{active.branch}</span>
									</p>
									<p style={{ opacity: 0.6, fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
										{active.dateTime} · {active.type} · {docs.verified}/{docs.total} documents verified
									</p>
								</div>
								<button
									type="button"
									onClick={() => setSelectedConsultation(null)}
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
						{active.rescheduleRequestedAt && (
							(() => {
								const canActOnReschedule = 
									(active.assignedOfficerEmail && opsUser?.email === active.assignedOfficerEmail) || 
									(!active.assignedOfficerEmail && canAssignWork);
								
								return (
									<div style={{ padding: "0.75rem 1.25rem", background: "var(--bg-warning)", borderBottom: "1px solid var(--border-light)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
										<div>
											<p style={{ fontSize: "var(--text-sm)", color: "var(--text-warning)" }}>
												<strong>Applicant requested a reschedule.</strong>
											</p>
											<p style={{ fontSize: "var(--text-xs)", color: "var(--text-warning)", marginTop: "0.2rem" }}>
												They want to move this to <strong>{new Date(active.rescheduleRequestedStartsAt!).toLocaleString()}</strong>.
												{active.rescheduleRequestReason && <><br/>Reason: {active.rescheduleRequestReason}</>}
											</p>
										</div>
										<div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
											{canActOnReschedule ? (
												<>
													<button
														onClick={() => {
															if (active.bookingId) void decideReschedule(active.bookingId, "reject");
														}}
														className="btn btn--sm btn--ghost"
													>
														Reject
													</button>
													<button
														onClick={() => {
															if (active.bookingId) void decideReschedule(active.bookingId, "approve");
														}}
														className="btn btn--sm btn--primary"
													>
														✓ Approve
													</button>
												</>
											) : (
												<span style={{ fontSize: "var(--text-xs)", color: "var(--text-warning)", fontWeight: 500 }}>
													Waiting for {active.assignedOfficer ? "assigned consultant" : "manager"} to review
												</span>
											)}
										</div>
									</div>
								);
							})()
						)}

						{active.status === "Under Review" && !active.assignedOfficer && canAssignWork && (
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
						{active.status === "Under Review" && !canAssignWork && (
							<div style={{ padding: "0.75rem 1.25rem", background: "var(--muted)", borderBottom: "1px solid var(--border-light)", flexShrink: 0 }}>
								<p style={{ fontSize: "var(--text-sm)" }} className="muted">
									This booking is awaiting manager assignment. You'll see it here once it's assigned to you.
								</p>
							</div>
						)}
						{active.status === "Assigned" && !canAssignWork && !active.slotConfirmed && (
							<div style={{ padding: "0.75rem 1.25rem", background: "#e0e7ff", borderBottom: "1px solid #c7d2fe", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
								<p style={{ fontSize: "var(--text-sm)", color: "#4338ca" }}>
									<strong>Assigned to you.</strong> Confirm the slot to accept the booking time, or reschedule if needed.
								</p>
								<div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
									<button
										onClick={() => setShowReschedule(!showReschedule)}
										className={`btn btn--sm ${showReschedule ? "btn--primary" : "btn--ghost"}`}
									>
										↻ Reschedule
									</button>
									<button
										onClick={() => void confirmConsultationSlot(selectedConsultation.id)}
										className="btn btn--primary btn--sm"
										style={{ whiteSpace: "nowrap" }}
									>
										✓ Confirm Slot
									</button>
								</div>
							</div>
						)}
						{active.status === "Assigned" && !canAssignWork && active.slotConfirmed && (
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
											void startConsultationAssessment(selectedConsultation.id);
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
						{showReschedule && (active.status === "Under Review" || active.status === "Assigned") && (
							<ReschedulePanel
								currentWhen={active.dateTime}
								branchLabel={active.branch}
								onConfirm={(date, time, reason) => {
									if (!active.bookingId) { setShowReschedule(false); return; }
									rescheduleConsultation(active.id, active.bookingId, date, time, reason)
										.then(() => setShowReschedule(false))
										.catch(() => setShowReschedule(false));
								}}
								onCancel={() => setShowReschedule(false)}
							/>
						)}
						{active.slotConfirmed && (active.meetingLink || active.mapsUrl) && (
							<div style={{ padding: "0.75rem 1.25rem", background: "#f0f9ff", borderBottom: "1px solid #bae6fd", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
								<div>
									<p style={{ fontSize: "var(--text-sm)", color: "#0c4a6e", fontWeight: 600 }}>
										{active.type === "online" ? "Video Meeting Link" : "Office Location"}
									</p>
									<p style={{ fontSize: "var(--text-xs)", color: "#0c4a6e", opacity: 0.8, marginTop: "0.2rem" }}>
										{active.type === "online"
											? active.meetingLink
											: active.mapsUrl}
									</p>
								</div>
								{active.type === "online" && active.meetingLink ? (
									<a
										href={active.meetingLink}
										target="_blank"
										rel="noopener noreferrer"
										className="btn btn--primary btn--sm"
										style={{ whiteSpace: "nowrap" }}
									>
										Join Meeting →
									</a>
								) : active.type !== "online" && active.mapsUrl ? (
									<a
										href={active.mapsUrl}
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
						{active.type === "online" && active.slotConfirmed && active.bookingId && canAssignWork && active.status !== "Completed" && active.status !== "Cancelled" && (
							<div style={{ padding: "0.75rem 1.25rem", background: "var(--muted)", borderBottom: "1px solid var(--border-light)", flexShrink: 0 }}>
								<p className="eyebrow">Meeting link</p>
								{!editingMeetingUrl ? (
									<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.3rem" }}>
										{active.meetingLink ? (
											<>
												<a href={active.meetingLink} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--sm" style={{ whiteSpace: "nowrap" }}>Join →</a>
												<span className="mono muted" style={{ fontSize: "var(--text-xs)", wordBreak: "break-all" }}>{active.meetingLink}</span>
												<button type="button" className="btn btn--ghost btn--sm" onClick={() => { setMeetingUrlDraft(active.meetingLink ?? ""); setEditingMeetingUrl(true); }}>Change</button>
											</>
										) : (
											<button type="button" className="btn btn--primary btn--sm" onClick={() => { setMeetingUrlDraft(""); setEditingMeetingUrl(true); }}>Add meeting link</button>
										)}
									</div>
								) : (
									<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.3rem" }}>
										<input
											type="url"
											className="input input--sm"
											style={{ flex: 1, minWidth: "240px" }}
											placeholder="https://zoom.us/j/… or https://meet.google.com/…"
											value={meetingUrlDraft}
											onChange={(e) => setMeetingUrlDraft(e.target.value)}
										/>
										<button
											type="button"
											className="btn btn--primary btn--sm"
											disabled={savingMeetingUrl}
											onClick={async () => {
												if (!active.bookingId) return;
												const v = meetingUrlDraft.trim();
												if (v && !/^https:\/\//i.test(v)) {
													showToast("error", "Meeting link must start with https://");
													return;
												}
												setSavingMeetingUrl(true);
												try {
													await bookingsApi.setMeetingUrl(active.bookingId, v || null);
													setEditingMeetingUrl(false);
													showToast("success", v ? "Meeting link saved." : "Meeting link cleared.");
													void refresh();
												} catch (err) {
													showToast("error", err instanceof Error ? err.message : "Could not save the meeting link.");
												} finally {
													setSavingMeetingUrl(false);
												}
											}}
										>
											{savingMeetingUrl ? "Saving…" : "Save"}
										</button>
										<button type="button" className="btn btn--ghost btn--sm" disabled={savingMeetingUrl} onClick={() => setEditingMeetingUrl(false)}>
											Cancel
										</button>
									</div>
								)}
							</div>
						)}
						{active.status === "In Assessment" && (
								<div style={{ padding: "0.75rem 1.25rem", background: "#e0e7ff", borderBottom: "1px solid #c7d2fe", flexShrink: 0 }}>
									<p style={{ fontSize: "var(--text-sm)", color: "#4338ca" }}>
										<strong>Assessment in progress.</strong> Review documents and complete the assessment decision below.
										{docs.pending > 0 && ` ⚠ ${docs.pending} document(s) still pending verification.`}
									</p>
								</div>
							)}
						{active.status === "Completed" && (
							<div style={{ padding: "0.75rem 1.25rem", background: "#d1fae5", borderBottom: "1px solid #6ee7b7", flexShrink: 0 }}>
								<p style={{ fontSize: "var(--text-sm)", color: "#065f46" }}>
									<strong>Assessment completed.</strong>
									{active.assessmentResult ? ` Outcome: ${active.assessmentResult.outcome} - ${active.assessmentResult.recProgram} at ${active.assessmentResult.recUniversity} (${active.assessmentResult.recCountry}).` : ""}
								</p>
							</div>
						)}
						{active.workflow?.status === "CLOSED" && (
							<div style={{ padding: "0.75rem 1.25rem", background: "#fee2e2", borderBottom: "1px solid #fca5a5", flexShrink: 0 }}>
								<p style={{ fontSize: "var(--text-sm)", color: "#991b1b" }}>
									<strong>
										{active.workflow.closureReason === "APPOINTMENT_CANCELLED"
											? "Appointment Cancelled"
											: "Consultation Cancelled"}
									</strong>
									{active.workflow.nextAction === "REBOOK_APPOINTMENT" && " — client can rebook a new appointment."}
								</p>
							</div>
						)}
						{false && (
							<div style={{ padding: "0.75rem 1.25rem", background: "#fee2e2", borderBottom: "1px solid #fca5a5", flexShrink: 0 }}>
								<p style={{ fontSize: "var(--text-sm)", color: "#991b1b" }}>
									<strong>This consultation has been cancelled.</strong> The linked appointment was released and the applicant has been notified.
								</p>
							</div>
						)}
						{canAssignWork && active.status !== "Completed" && active.status !== "Cancelled" && (
							<div style={{ padding: "0.5rem 1.25rem", background: "var(--muted)", borderBottom: "1px solid var(--border-light)", flexShrink: 0, display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-end" }}>
								{showCancelForm ? (
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
											style={{ color: "#991b1b", borderColor: "#fca5a5", whiteSpace: "nowrap" }}
											onClick={() => {
												void cancelConsultation(active.id, cancelReason.trim() || undefined)
													.then(() => {
														setShowCancelForm(false);
														setCancelReason("");
														setSelectedConsultation(null);
														void refresh();
													})
													.catch((err: unknown) => {
														const msg = err instanceof Error ? err.message : "Could not cancel consultation.";
														showToast("error", msg);
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
								) : (
									<button
										type="button"
										onClick={() => setShowCancelForm(true)}
										className="btn btn--sm"
										style={{ color: "#991b1b", borderColor: "#fca5a5", whiteSpace: "nowrap" }}
									>
										✕ Cancel Case
									</button>
								)}
							</div>
						)}

						{/* Coordinator section — managers/owners can delegate */}
						{canAssignWork && active.status !== "Completed" && active.status !== "Cancelled" && !active.coordinatorName && (
							<div style={{ padding: "0.75rem 1.25rem", background: "#f0f9ff", borderBottom: "1px solid #bae6fd", flexShrink: 0 }}>
								{showCoordinatorPicker ? (
									<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
										<p style={{ fontSize: "var(--text-sm)", color: "#0c4a6e", fontWeight: 600 }}>
											Select a coordinator:
										</p>
										{workloadData ? (
											<div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
												{workloadData.coordinators.map((c) => (
													<button
														key={c.opsUserId}
														onClick={async () => {
															try {
																await delegateCoordinator(active.id, c.opsUserId, coordinatorNote || undefined);
																setShowCoordinatorPicker(false);
																setCoordinatorNote("");
																void refresh();
															} catch (err: unknown) {
																showToast("error", err instanceof Error ? err.message : "Failed to delegate");
															}
														}}
														className="btn btn--sm btn--ghost"
														style={{
															display: "flex",
															flexDirection: "column",
															alignItems: "flex-start",
															padding: "0.4rem 0.75rem",
															border: "1px solid var(--border)",
															borderRadius: "6px",
														}}
													>
														<span style={{ fontWeight: 500 }}>{c.name}</span>
														<span style={{ fontSize: "10px", opacity: 0.7 }}>
															{c.activeCases}/{c.maxCapacity} cases
															{c.overdueCases > 0 && <span style={{ color: "#dc2626" }}> · {c.overdueCases} overdue</span>}
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
											style={{ fontSize: "var(--text-xs)", padding: "0.3rem 0.5rem", border: "1px solid var(--border)", borderRadius: "4px" }}
										/>
										<button
											onClick={() => { setShowCoordinatorPicker(false); setCoordinatorNote(""); }}
											className="btn btn--sm btn--ghost"
											style={{ alignSelf: "flex-start" }}
										>
											Cancel
										</button>
									</div>
								) : (
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
										<p style={{ fontSize: "var(--text-sm)", color: "#0c4a6e" }}>
											No coordinator assigned. Delegate to a coordinator for case management.
										</p>
										<button
											onClick={async () => {
												setShowCoordinatorPicker(true);
												if (!workloadData) {
													try {
														setWorkloadData(await getWorkload());
													} catch { /* ignore */ }
												}
											}}
											className="btn btn--primary btn--sm"
											style={{ whiteSpace: "nowrap" }}
										>
											Delegate to Coordinator →
										</button>
									</div>
								)}
							</div>
						)}
						{active.coordinatorName && (
							<div style={{ padding: "0.5rem 1.25rem", background: "#f0f9ff", borderBottom: "1px solid #bae6fd", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
								<p style={{ fontSize: "var(--text-xs)", color: "#0c4a6e", display: "flex", alignItems: "center", gap: "0.35rem" }}>
									<strong>Coordinator:</strong> <StaffChatBadge opsUserId={active.coordinatorEmail} name={active.coordinatorName} email={active.coordinatorEmail} />
									{active.coordinatorAssignedByName && <span style={{ opacity: 0.7 }}> (assigned by {active.coordinatorAssignedByName})</span>}
									{active.delegationNote && <span style={{ opacity: 0.7 }}> — {active.delegationNote}</span>}
								</p>
								<button
									onClick={async () => {
										setShowCoordinatorPicker(true);
										if (!workloadData) {
											try { setWorkloadData(await getWorkload()); } catch { /* ignore */ }
										}
									}}
									className="btn btn--sm btn--ghost"
									style={{ whiteSpace: "nowrap", fontSize: "var(--text-xs)" }}
								>
									Reassign
								</button>
							</div>
						)}

							{/* Detail Tabs */}
							<div style={{ display: "flex", borderBottom: "1px solid var(--border-light)", background: "var(--muted)", flexShrink: 0 }}>
								{(["profile", "documents", "assessment"] as const).map((t) => {
									const labels = { profile: "1. Background", documents: `2. Documents (${realDocs.length})`, assessment: "3. Decision" };
									const disabled = t === "assessment" && active.status === "Under Review";
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
									assignedName={active.assignedOfficer}
									assignedEmail={active.assignedOfficerEmail}
									comments={active.comments ?? []}
									requestedDocuments={active.requestedDocuments ?? []}
								canAssign={canAssignWork && active.status !== "Completed" && active.status !== "In Assessment" && active.status !== "Cancelled"}
								closedNote={
									active.status === "Completed"
										? "Read-only - this consultation is completed. Reopen it to make changes."
										: active.status === "Cancelled"
											? "Read-only - this consultation has been cancelled."
											: undefined
								}
									actor={opsUser?.name ?? "Staff"}
									isMine={isMine}
									assignees={assignees}
									onAssign={(to) => void assignConsultation(selectedConsultation.id, to)}
									onComment={(kind, text) =>
										void commentOnConsultation(selectedConsultation.id, kind, text)
									}
									onRequestDocs={(docs) =>
										void requestConsultationDocs(selectedConsultation.id, docs)
									}
									branchLabel={active.branch}
									currentWhen={active.dateTime}
									onReschedule={
										active.bookingId
											? (date, time, reason) =>
													void rescheduleConsultation(
														selectedConsultation.id,
														active.bookingId!,
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
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Email</p><p>{selectedConsultation.email}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Phone</p><p>{selectedConsultation.phone}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Nationality</p><p>{selectedConsultation.personal.nationality}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Residence</p><p>{selectedConsultation.personal.residence}</p></div>
											</div>
										</div>
										<div className="card">
											<p className="eyebrow mb-2">Education Background</p>
											<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Degree</p><p>{selectedConsultation.education.degree}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Institution</p><p>{selectedConsultation.education.institution}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>GPA / Grade</p><p>{selectedConsultation.education.gpa}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Graduation Year</p><p>{selectedConsultation.education.gradYear}</p></div>
											</div>
										</div>
										<div className="card">
											<p className="eyebrow mb-2">Employment & Financials</p>
											<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Current Role</p><p>{selectedConsultation.employment.currentRole} at {selectedConsultation.employment.company}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Experience</p><p>{selectedConsultation.employment.experienceYears}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Funding Source</p><p>{selectedConsultation.financial.source}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Annual Budget</p><p>{selectedConsultation.financial.budget}</p></div>
											</div>
										</div>
										<div className="card">
											<p className="eyebrow mb-2">Study Goals</p>
											<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Degree Level</p><p>{selectedConsultation.goals.degreeLevel}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Major Field</p><p>{selectedConsultation.goals.major}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target Intake</p><p>{selectedConsultation.goals.intake}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target Country</p><p>{selectedConsultation.targetCountry}</p></div>
											</div>
										</div>
									</div>
								)}

							{detailTab === "documents" && (
								previewingDoc ? (
									<div style={{ marginTop: "1rem" }}>
									<DocPreviewInline
										doc={previewingDoc}
										isMine={isMine}
										applicantName={active.applicantName}
										reference={active.ref}
										documentId={previewingDoc.documentId}
										onVerdict={(status) => void handleReviewDoc(previewingDoc.documentId!, status)}
										onBack={() => setPreviewingDoc(null)}
									/>
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
										{realDocs.length === 0 && (selectedConsultation.requestedDocuments?.length ?? 0) > 0 && (
											<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
												No documents uploaded yet. The applicant has been asked to provide: {(selectedConsultation.requestedDocuments ?? []).join(", ")}.
											</p>
										)}
										{realDocs.length === 0 && (selectedConsultation.requestedDocuments?.length ?? 0) === 0 && (
											<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.75rem" }}>
												No documents have been uploaded or requested for this case yet.
											</p>
										)}
										<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
											{realDocs.map((doc, idx) => {
												const displayStatus = DOC_STATUS_MAP[doc.status] ?? doc.status;
												const settled = doc.status === "VERIFIED" || doc.status === "REJECTED";
												const docKey = `applicant:${active.applicantId}:${doc.documentType}`;
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
															<a href="/documents" className="btn btn--ghost btn--sm" style={{ padding: "0.25rem 0.6rem", fontSize: "0.72rem" }}>Review queue</a>
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
										✓ Assessment recorded. Applicant status updated to {selectedConsultation.status}.
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
					)}
				</div>
			</div>
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
