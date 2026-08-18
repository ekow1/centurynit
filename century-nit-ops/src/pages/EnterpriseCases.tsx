import { useState } from "react";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCasesApi } from "../hooks/useCasesApi";
import { CaseWorkPanel } from "./CaseWorkPanel";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { AddSchoolApplicationModal } from "./AddSchoolApplicationModal";
import { AssignScholarshipModal } from "./AssignScholarshipModal";
import { branchName } from "century-nit-core/ops";
import type { MockApplication } from "century-nit-core/ops";
import { JOURNEY_STAGES, JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";

export function EnterpriseCases() {
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
		setApplicationStage,
	} = useCasesApi();

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
	const [branchFilter, setBranchFilter] = useState("all");
	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [isScholarshipModalOpen, setIsScholarshipModalOpen] = useState(false);

	const canSeeAll = canSeeAllBranches;
	const unassignedCases = applications.filter((a) => !a.assignedStaff).length;
	const liveSelected = selectedApp
		? applications.find((a) => a.appId === selectedApp.appId) ?? selectedApp
		: null;

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

	async function handleAdvanceStage() {
		if (!selectedApp) return;
		const idx = JOURNEY_STAGES.indexOf(selectedApp.stage as JourneyStage);
		if (idx < 0) return;
		const next = JOURNEY_STAGES[idx + 1];
		if (!next) return;
		try {
			await setApplicationStage(selectedApp.appId, next);
			setSelectedApp({ ...selectedApp, stage: next });
			setActionSuccess(`Advanced to "${JOURNEY_STAGE_LABELS[next]}"`);
			setTimeout(() => setActionSuccess(null), 4000);
		} catch (err: unknown) {
			setActionSuccess(null);
			const msg = err instanceof Error ? err.message : "Could not advance stage";
			window.alert(msg);
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
			<div className="ops-split" style={{ display: "flex", gap: "1rem", height: "var(--ops-pane-h)", minHeight: "var(--ops-pane-min)" }}>
				{/* LEFT: List Pane */}
				<div className="ops-split__list" style={{ flex: "0 0 40%", minWidth: "360px", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border-light)" }}>
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
												<p style={{ fontSize: "var(--text-xs)", opacity: 0.5, marginTop: "0.15rem" }}>
													{app.assignedStaff ? `Assigned: ${app.assignedStaff}` : "- unassigned"} · {JOURNEY_STAGE_LABELS[app.stage as JourneyStage]}
												</p>
											</div>
											<span style={{ fontSize: "0.9rem", opacity: 0.4, flexShrink: 0, marginLeft: "0.5rem" }}>→</span>
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
								<div>
									<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
										<span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", opacity: 0.7 }}>
											{(liveSelected ?? selectedApp).appId}
										</span>
										<span className="portal-pill" style={{ background: "var(--background)", color: "var(--foreground)", border: "none", fontSize: "var(--text-xs)" }}>
											{(liveSelected ?? selectedApp).status}
										</span>
									</div>
									<h2 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", color: "var(--background)", margin: 0 }}>
										{(liveSelected ?? selectedApp).applicantName}
									</h2>
									<p style={{ opacity: 0.75, fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>
										{(liveSelected ?? selectedApp).university} · {(liveSelected ?? selectedApp).program} ({(liveSelected ?? selectedApp).country})
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

								{/* Stage advance */}
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-light)", flexWrap: "wrap" }}>
									<div>
										<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
											Current stage: {JOURNEY_STAGE_LABELS[(liveSelected ?? selectedApp).stage as JourneyStage]}
										</p>
										<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
											{(liveSelected ?? selectedApp).stage === "completed"
												? "This case has reached the final stage."
												: `Next: ${JOURNEY_STAGE_LABELS[JOURNEY_STAGES[Math.min(JOURNEY_STAGES.indexOf((liveSelected ?? selectedApp).stage as JourneyStage) + 1, JOURNEY_STAGES.length - 1)]]}`}
										</p>
									</div>
									<button
										type="button"
										onClick={handleAdvanceStage}
										disabled={(liveSelected ?? selectedApp).stage === "completed"}
										className="btn btn--outline"
										style={{ whiteSpace: "nowrap" }}
									>
										{(liveSelected ?? selectedApp).stage === "completed"
											? "✓ Completed"
											: "Advance to next stage →"}
									</button>
								</div>
							</div>

								{/* Application Meta */}
								<div className="card">
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
										<p className="eyebrow mb-0">Target & Assignment</p>
										<button className="btn btn--outline btn--sm" onClick={() => setIsScholarshipModalOpen(true)}>Manage Scholarships</button>
									</div>
									<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Institution</p><p>{selectedApp.university}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Program</p><p>{selectedApp.program}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Assigned Staff</p><p>{selectedApp.assignedStaff}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Branch</p><p>{branchName(selectedApp.branch)}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Funding Track</p><p>{selectedApp.fundingTrack}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Submitted Date</p><p>{selectedApp.submittedDate}</p></div>
									</div>
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
