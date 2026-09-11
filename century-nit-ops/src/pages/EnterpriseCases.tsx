import { useEffect, useState } from "react";
import { CaseDetail } from "./CaseDetail";
import { useSearchParams } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { StaffChatBadge } from "./StaffChatBadge";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { AddSchoolApplicationModal } from "./AddSchoolApplicationModal";
import { AssignScholarshipModal } from "./AssignScholarshipModal";
import { branchName } from "century-nit-core/ops";
import type { MockApplication } from "century-nit-core/ops";
import { JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";

export function EnterpriseCases() {
	const [searchParams] = useSearchParams();
	const { opsRole, opsUser, canSeeAllBranches, canAssignWork, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const {
		applications,
		assignees,
		error: casesError,
		addApplication,
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
	const [actionError] = useState<string | null>(null);
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
							<div style={{ flex: 1, overflowY: "auto", padding: "1.25rem" }}>
								<CaseDetail app={liveSelected ?? selectedApp} />
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
