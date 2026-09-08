import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { CaseWorkPanel } from "./CaseWorkPanel";
import { StaffChatBadge } from "./StaffChatBadge";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { AddSchoolApplicationModal } from "./AddSchoolApplicationModal";
import { AssignScholarshipModal } from "./AssignScholarshipModal";
import { branchName } from "century-nit-core/ops";
import type { MockApplication } from "century-nit-core/ops";
import { JOURNEY_STAGE_LABELS, type JourneyStage, type SchoolApplication } from "century-nit-shared";

function InlineSchoolTracker({ appId, school }: { appId: string; school: SchoolApplication }) {
	const { updateSchoolApplication } = useCases();
	const [status, setStatus] = useState<string>(school.status || "Preparing Application");
	const [outcome, setOutcome] = useState<string>(school.outcome || "Offer Received");
	const [tuitionUsd, setTuitionUsd] = useState(school.offerTuitionUsd?.toString() ?? "");
	const [tuitionLabel, setTuitionLabel] = useState(school.offerTuitionLabel ?? "");
	const [depositUsd, setDepositUsd] = useState(school.offerDepositUsd?.toString() ?? "");
	const [dueAt, setDueAt] = useState(school.offerDepositDueAt ? school.offerDepositDueAt.slice(0, 10) : "");
	const [paidAt, setPaidAt] = useState(school.offerDepositPaidAt ? school.offerDepositPaidAt.slice(0, 10) : "");
	const [offerLetterUrl, setOfferLetterUrl] = useState(school.offerLetterUrl ?? "");
	const [sendOfferEmail, setSendOfferEmail] = useState(true);
	const [consultantNote, setConsultantNote] = useState("");

	const [isSaving, setIsSaving] = useState(false);

	const toIso = (date: string) => (date ? `${date}T00:00:00Z` : null);
	const toNumber = (value: string) => {
		const n = Number(value);
		return Number.isFinite(n) && value.trim() !== "" ? n : null;
	};

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await updateSchoolApplication(appId, school.id, {
				status: status as any,
				outcome: status === "Decision Reached" ? outcome as any : null,
				offerTuitionUsd: status === "Decision Reached" && outcome === "Offer Received" ? toNumber(tuitionUsd) : null,
				offerTuitionLabel: status === "Decision Reached" && outcome === "Offer Received" ? tuitionLabel.trim() || null : null,
				offerDepositUsd: status === "Decision Reached" && outcome === "Offer Received" ? toNumber(depositUsd) : null,
				offerDepositDueAt: status === "Decision Reached" && outcome === "Offer Received" ? toIso(dueAt) : null,
				offerDepositPaidAt: status === "Decision Reached" && outcome === "Offer Received" ? toIso(paidAt) : null,
				offerLetterUrl: status === "Decision Reached" && outcome === "Offer Received" ? offerLetterUrl.trim() || null : null,
				sendOfferEmail: status === "Decision Reached" && outcome === "Offer Received" && sendOfferEmail && Boolean(offerLetterUrl.trim()),
				consultantNote: consultantNote.trim() || undefined,
			});
		} catch {
			/* handled by hook */
		} finally {
			setIsSaving(false);
		}
	};

	const showOfferFields = status === "Decision Reached" && outcome === "Offer Received";

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
						<option value="Offer Received">Offer Received</option>
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

			{showOfferFields && (
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", padding: "0.75rem", background: "var(--background)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)", marginTop: "0.5rem" }}>
					<p className="eyebrow" style={{ gridColumn: "1 / -1", margin: 0 }}>Offer Details</p>
					<div>
						<p className="muted" style={{ marginBottom: "0.15rem" }}>Tuition USD</p>
						<input className="input input--sm" type="number" value={tuitionUsd} onChange={(e) => setTuitionUsd(e.target.value)} />
					</div>
					<div>
						<p className="muted" style={{ marginBottom: "0.15rem" }}>Tuition label</p>
						<input className="input input--sm" type="text" value={tuitionLabel} onChange={(e) => setTuitionLabel(e.target.value)} />
					</div>
					<div>
						<p className="muted" style={{ marginBottom: "0.15rem" }}>Deposit USD</p>
						<input className="input input--sm" type="number" value={depositUsd} onChange={(e) => setDepositUsd(e.target.value)} />
					</div>
					<div>
						<p className="muted" style={{ marginBottom: "0.15rem" }}>Deposit due</p>
						<input className="input input--sm" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
					</div>
					<div>
						<p className="muted" style={{ marginBottom: "0.15rem" }}>Deposit paid</p>
						<input className="input input--sm" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
					</div>
					<div style={{ gridColumn: "1 / -1" }}>
						<p className="muted" style={{ marginBottom: "0.15rem" }}>Official Offer Letter / Document URL (PDF)</p>
						<input
							className="input input--sm"
							type="url"
							placeholder="https://.../offer-letter.pdf"
							value={offerLetterUrl}
							onChange={(e) => setOfferLetterUrl(e.target.value)}
						/>
					</div>
					<div style={{ gridColumn: "1 / -1" }}>
						<p className="muted" style={{ marginBottom: "0.15rem" }}>Consultant Note to Applicant (included in email)</p>
						<textarea
							className="input input--sm"
							placeholder="e.g. Congratulations! Your official offer has arrived with a scholarship award..."
							value={consultantNote}
							onChange={(e) => setConsultantNote(e.target.value)}
							rows={2}
						/>
					</div>
					<div style={{ gridColumn: "1 / -1" }}>
						<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
							<input
								type="checkbox"
								checked={sendOfferEmail}
								onChange={(e) => setSendOfferEmail(e.target.checked)}
							/>
							<span>Send official acceptance email with PDF attachment to applicant</span>
						</label>
					</div>
				</div>
			)}
		</div>
	);
}

export function EnterpriseCases() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { opsRole, opsUser, canSeeAllBranches, canAssignWork, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const {
		applications,
		assignees,
		error: casesError,
		acceptApplication,
		toggleApplicationChecklist,
		assignApplication,
		commentOnApplication,
		requestApplicationDocs,
		addApplication,
		recordProceed,
		declineProceed,
		reinviteProceed,
	} = useCases();

	/**
	 * The pipeline a case advances through. Mirrors the Workflow Board columns
	 * so "Advance to next stage" moves a case to the same place a drag would.
	 * `JOURNEY_STAGES` is the shared source of truth; `JOURNEY_STAGE_LABELS`
	 * provides the human-readable label for display.
	 */
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);
	const [actionSuccess, setActionSuccess] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");
	const [isAddModalOpen, setIsAddModalOpen] = useState(false);

	const queryId = searchParams.get("id");
	useEffect(() => {
		if (queryId) {
			const match = applications.find((a) => a.id === queryId);
			if (match) setSelectedApp(match);
		}
	}, [queryId, applications]);
	const [isScholarshipModalOpen, setIsScholarshipModalOpen] = useState(false);

	const canSeeAll = canSeeAllBranches;
	const unassignedCases = applications.filter((a) => !a.assignedStaff).length;
	const liveSelected = selectedApp
		? applications.find((a) => a.appId === selectedApp.appId) ?? selectedApp
		: null;

	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;

	const roleScopedApps = scopeRecords(
		applications,
		(a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name,
	);

	const filteredApps = roleScopedApps.filter((a) => {
		if (branchFilter !== "all" && a.branch !== branchFilter) return false;
		const matchesSearch =
			a.applicantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.appId.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.university.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.assignedStaff.toLowerCase().includes(searchQuery.toLowerCase());
		if (!matchesSearch) return false;
		if (statusFilter === "All") return true;
		return a.status === statusFilter;
	});

	async function handleAcceptApplication(appId: string) {
		const target = applications.find((a) => a.appId === appId) ?? selectedApp;
		if (!target) return;
		const updated = await acceptApplication(target.id);
		setSelectedApp(updated);
		setActionSuccess(`Application ${updated.appId} has been ACCEPTED & Approved!`);
		setTimeout(() => setActionSuccess(null), 4000);
	}

	async function handleToggleChecklist(itemIndex: number) {
		if (!selectedApp) return;
		const item = selectedApp.checklist[itemIndex];
		if (!item) return;
		const updated = await toggleApplicationChecklist(selectedApp.id, item.id, !item.checked);
		setSelectedApp(updated);
	}

	async function handleRecordProceed() {
		if (!selectedApp) return;
		const reason = window.prompt("Why are you recording consent on the applicant's behalf?", "");
		if (reason === null || reason.trim() === "") return;
		try {
			await recordProceed(selectedApp.appId, reason.trim());
			setActionSuccess("Applicant consent recorded — the gate is now open.");
			setTimeout(() => setActionSuccess(null), 4000);
		} catch (err) {
			setActionSuccess(null);
			setActionError(err instanceof Error ? err.message : "Could not record consent");
		}
	}

	async function handleReinviteProceed() {
		if (!selectedApp) return;
		try {
			await reinviteProceed(selectedApp.appId);
			setActionSuccess("Consent gate re-opened for the applicant.");
			setTimeout(() => setActionSuccess(null), 4000);
		} catch (err) {
			setActionSuccess(null);
			setActionError(err instanceof Error ? err.message : "Could not re-invite");
		}
	}

	async function handleDeclineProceed() {
		if (!selectedApp) return;
		const reason = window.prompt("Record why the applicant is pausing (optional):", "");
		if (reason === null) return;
		try {
			await declineProceed(selectedApp.appId, reason);
			setActionSuccess("Applicant declined to proceed — the case is paused.");
			setTimeout(() => setActionSuccess(null), 4000);
		} catch (err) {
			setActionSuccess(null);
			setActionError(err instanceof Error ? err.message : "Could not record decline");
		}
	}

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
				<div>
					<h1 className="page-title">Applications</h1>
					<p className="lead mt-1">Manage, review, and approve staff-assigned applications.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<button
						className="btn btn--primary"
						onClick={() => setIsAddModalOpen(true)}
						style={{ whiteSpace: "nowrap" }}
					>
						+ Add School Application
					</button>
					{canAssignWork && unassignedCases > 0 && (
						<span className="portal-pill" style={{ background: "var(--foreground)", color: "var(--background)", whiteSpace: "nowrap" }}>
							{unassignedCases} awaiting assignment
						</span>
					)}
					{canSeeAll && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

			{isAddModalOpen && (
				<AddSchoolApplicationModal
					onClose={() => setIsAddModalOpen(false)}
					onAdd={async (applicantId, destinationId, universityId, programId, intake) => {
						await addApplication(applicantId, { destinationId, universityId, programId, intake });
						setActionSuccess("School application added successfully!");
						setTimeout(() => setActionSuccess(null), 4000);
					}}
				/>
			)}

			{isScholarshipModalOpen && selectedApp && (
				<AssignScholarshipModal
					applicantId={selectedApp.applicantId}
					onClose={() => setIsScholarshipModalOpen(false)}
				/>
			)}

			{casesError ? <p className="ops-modal__error" role="alert">{casesError}</p> : null}

			{actionSuccess && (
				<div style={{ padding: "0.85rem 1.25rem", background: "var(--foreground)", color: "var(--background)", marginBottom: "1rem" }}>
					✓ {actionSuccess}
				</div>
			)}

			{actionError && (
				<div style={{ padding: "0.85rem 1.25rem", background: "var(--danger-bg, #b91c1c)", color: "#fff", marginBottom: "1rem" }} role="alert">
					{actionError}
				</div>
			)}

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
					<span style={{ fontSize: "1rem" }}>{canSeeAll ? "◱" : "◈"}</span>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						{canSeeAll
							? `All ${roleScopedApps.length} applications · ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: requiresAssignmentScope
								? `${roleScopedApps.length} assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch · ${roleScopedApps.length} applications`}
					</p>
				</div>
				<span className="portal-pill" style={canSeeAll ? { background: "var(--background)", color: "var(--foreground)", border: "none" } : undefined}>
					{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
				</span>
			</div>

			{/* Split Pane Layout */}
			<div className="ops-split" style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
				{/* LEFT: List Pane */}
				<div className="ops-split__list" style={{ flex: "0 0 40%", minWidth: "360px", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border-light)", height: "var(--ops-pane-h)" }}>
					<div style={{ padding: "0.75rem", borderBottom: "1px solid var(--border-light)", background: "var(--muted)", flexShrink: 0 }}>
						<div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
							{["All", "Under Review", "Accepted", "Action Required", "Rejected"].map((tab) => (
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
							placeholder="Search app ID, applicant, university..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="input input--sm"
							style={{ width: "100%" }}
						/>
					</div>

					<div style={{ flex: 1, overflowY: "auto" }}>
						{filteredApps.length === 0 ? (
							<div style={{ padding: "3rem 1.5rem", textAlign: "center" }} className="muted">
								No applications match your filter.
							</div>
						) : (
							filteredApps.map((app) => {
								const isSelected = selectedApp?.appId === app.appId;
								return (
									<div
										key={app.id}
										onClick={() => setSelectedApp(app)}
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
														{app.appId}
													</span>
													<span className="portal-pill" style={{
														fontSize: "var(--text-xs)",
														padding: "0.15rem 0.4rem",
														background: isSelected ? "var(--background)" : app.status === "Accepted" ? "var(--foreground)" : undefined,
														color: isSelected ? "var(--foreground)" : app.status === "Accepted" ? "var(--background)" : undefined,
														border: isSelected ? "none" : undefined,
													}}>
														{app.status}
													</span>
												</div>
												<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{app.applicantName}</p>
												<p style={{ fontSize: "var(--text-xs)", opacity: 0.65, marginTop: "0.15rem" }}>
													{app.university} · {app.program}
												</p>
												<div style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
													{app.assignedStaff ? (
														<StaffChatBadge
															opsUserId={opsUserIdByEmail(app.assignedStaffEmail)}
															name={app.assignedStaff}
															email={app.assignedStaffEmail}
														/>
													) : (
														<span>Unassigned</span>
													)}
													<span style={{ marginLeft: "0.4rem" }}>· {JOURNEY_STAGE_LABELS[app.stage as JourneyStage]}</span>
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
					border: "1px solid var(--border-light)",
					background: "var(--background)",
					height: "calc(100dvh - 11rem)",
				}}>
					{!selectedApp ? (
						<div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
							<span style={{ fontSize: "2.5rem", opacity: 0.15, marginBottom: "1rem" }}>◈</span>
							<p className="muted" style={{ fontSize: "var(--text-sm)", textAlign: "center" }}>
								Select an application from the list to review details and take action.
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
									<div style={{ flex: 1, minWidth: 0 }}>
										<div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
											<h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--background)", margin: 0 }}>{(liveSelected ?? selectedApp).applicantName}</h2>
											<span className="portal-pill" style={{ background: "var(--background)", color: "var(--foreground)", border: "none", fontSize: "var(--text-xs)" }}>{(liveSelected ?? selectedApp).appId}</span>
										</div>
										<p style={{ fontSize: "var(--text-sm)", opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
											{selectedApp.targetSchoolCount ? `Tracking ${selectedApp.targetSchoolCount} School${selectedApp.targetSchoolCount === 1 ? "" : "s"}` : "No schools selected yet"}
										</p>
									</div>
								<button
									type="button"
									onClick={() => setSelectedApp(null)}
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

							{/* Detail Content */}
							<div style={{ flex: 1, overflowY: "auto", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
								<CaseWorkPanel
									kind="application"
									assignedName={(liveSelected ?? selectedApp).assignedStaff}
									assignedEmail={(liveSelected ?? selectedApp).assignedStaffEmail}
									comments={(liveSelected ?? selectedApp).comments ?? []}
									requestedDocuments={(liveSelected ?? selectedApp).requestedDocuments ?? []}
									canAssign={canAssignWork}
									actor={opsUser?.name ?? "Staff"}
									isMine={(liveSelected ?? selectedApp).assignedStaffEmail === opsUser?.email}
									assignees={assignees}
									onAssign={(to) => void assignApplication(selectedApp.id, to)}
									onComment={(kind, text) =>
										void commentOnApplication(selectedApp.id, kind, text)
									}
									onRequestDocs={(docs) =>
										void requestApplicationDocs(selectedApp.id, docs)
									}
								/>

							{/* Action Control */}
							<div className="card" style={{ background: "var(--muted)" }}>
								<p className="eyebrow mb-1">Application Lifecycle Action</p>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
									<div>
										<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
											Status: {selectedApp.status}
										</p>
										<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
											{selectedApp.status === "Accepted"
												? "This application is Accepted & Active in Applicants directory."
												: "Accepting will mark this application as Approved & create/activate the Applicant record."}
										</p>
									</div>
									{selectedApp.status !== "Accepted" && (
										<button
											onClick={() => handleAcceptApplication(selectedApp.appId)}
											className="btn btn--primary"
											style={{ whiteSpace: "nowrap" }}
										>
											✓ Accept & Approve
										</button>
									)}
								</div>

								<div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-light)" }}>
									<p className="muted" style={{ fontSize: "var(--text-xs)", margin: 0 }}>
										Current stage: {JOURNEY_STAGE_LABELS[(liveSelected ?? selectedApp).stage as JourneyStage]}. Use the <a href="/workflow" style={{ textDecoration: "underline" }}>Workflow board</a> to advance the journey.
									</p>
								</div>
							</div>

							{/* Consent Gate */}
							<div className="card" style={{ background: "var(--muted)" }}>
								<p className="eyebrow mb-1">Consent Gate</p>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
									<div>
										<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
											{selectedApp.proceedStatus === "accepted"
												? "Consent recorded ✓"
												: selectedApp.proceedStatus === "paused"
													? "Applicant placed application on hold (Paused)"
													: selectedApp.proceedStatus === "declined"
														? "Applicant opted out (Declined)"
														: "Awaiting the applicant's consent to proceed"}
										</p>
										<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
											{selectedApp.proceedStatus === "accepted"
												? "The consent gate is open — school selection, invoices and tracking are unlocked."
												: selectedApp.proceedStatus === "paused"
													? "The applicant placed this case on hold. They can resume anytime from their portal, or you can record consent / re-invite them."
													: selectedApp.proceedStatus === "declined"
														? "The case is opted out. Re-invite to let the applicant reopen it, or record consent on their behalf."
														: "The applicant must confirm in the portal before document verification can advance."}
										</p>
									</div>
									<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
										{selectedApp.proceedStatus !== "accepted" && (
											<button onClick={() => void handleRecordProceed()} className="btn btn--primary" style={{ whiteSpace: "nowrap" }}>
												Record consent (override)
											</button>
										)}
										{selectedApp.proceedStatus === "invited" && (
											<button onClick={() => void handleDeclineProceed()} className="btn btn--ghost" style={{ whiteSpace: "nowrap" }}>
												Record decline
											</button>
										)}
										{(selectedApp.proceedStatus === "declined" || selectedApp.proceedStatus === "paused") && (
											<button onClick={() => void handleReinviteProceed()} className="btn btn--ghost" style={{ whiteSpace: "nowrap" }}>
												Re-invite applicant
											</button>
										)}
									</div>
								</div>
							</div>

								{/* Target & Assignment */}
								<div className="card">
									<p className="eyebrow mb-3">Assignment</p>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
										<div style={{ gridColumn: "1 / -1" }}>
											<p className="muted" style={{ fontSize: "var(--text-xs)" }}>Assigned Staff</p>
											<p>
												<StaffChatBadge
													opsUserId={opsUserIdByEmail(selectedApp.assignedStaffEmail)}
													name={selectedApp.assignedStaff}
													email={selectedApp.assignedStaffEmail}
												/>
											</p>
										</div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Branch</p><p>{branchName(selectedApp.branch)}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Funding Track</p><p>{selectedApp.fundingTrack}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target Schools</p><p>{selectedApp.targetSchoolCount ? `${selectedApp.targetSchoolCount} institution${selectedApp.targetSchoolCount === 1 ? "" : "s"}` : "Not specified"}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Submitted Date</p><p>{selectedApp.submittedDate}</p></div>
									</div>
									{selectedApp.consultationId ? (
										<p style={{ fontSize: "var(--text-xs)", marginTop: "0.75rem" }}>
											<button
												type="button"
												className="link-arrow"
												onClick={() => navigate(`/consultations?id=${selectedApp.consultationId}`)}
											>
												← Opened from consultation {selectedApp.consultationNumber || selectedApp.consultationId.slice(0, 8).toUpperCase()}
											</button>
										</p>
									) : null}
								</div>

								{/* School Applications */}
								<div className="card">
									<p className="eyebrow mb-3">School Applications</p>
									{(() => {
										const schools = selectedApp.schoolApplications ?? [];
										const total = schools.length;
										const admitted = schools.filter((s) => s.outcome === "Offer Received").length;
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
									{selectedApp.schoolApplications && selectedApp.schoolApplications.length > 0 ? (
										<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
											{selectedApp.schoolApplications.map((s) => {
												const latest = s.events?.[0];
												const displayName = s.universityName || s.universityId;
												const displayProgram = s.programName || s.programId;
												const displayCountry = s.countryName || s.destinationId;
												const admitted = s.outcome === "Offer Received";
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
																<InlineSchoolTracker appId={selectedApp.appId} school={s} />
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
										{selectedApp.checklist.map((item, idx) => (
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

								{/* Staff Internal Notes */}
								<div className="card">
									<p className="eyebrow mb-2">Staff Case Notes</p>
									<p style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{selectedApp.notes}</p>
								</div>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
