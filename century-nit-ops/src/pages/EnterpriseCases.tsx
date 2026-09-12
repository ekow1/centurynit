import { useEffect, useState } from "react";
import { CaseDetail } from "./CaseDetail";
import { CaseScaffold } from "./case/CaseScaffold";
import { StatusPill } from "century-nit-core/ui";
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

			<CaseScaffold
				onClose={() => setSelectedApp(null)}
				emptyHint="Select an application from the list to review it and take action."
				list={
					<>
						<div className="cn-scaffold__filters">
							<div className="cn-scaffold__chips">
								{["All", "Under Review", "Accepted", "Action Required", "Rejected"].map((tab) => (
									<button
										key={tab}
										type="button"
										onClick={() => setStatusFilter(tab)}
										className={`btn btn--sm ${statusFilter === tab ? "btn--primary" : "btn--ghost"}`}
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
							/>
						</div>
						<div className="cn-scaffold__rows">
							{filteredApps.length === 0 ? (
								<div className="cn-scaffold__none">No applications match your filter.</div>
							) : (
								filteredApps.map((app) => {
									const isSelected = selectedApp?.appId === app.appId;
									return (
										<div
											key={app.id}
											role="button"
											tabIndex={0}
											onClick={() => setSelectedApp(app)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") setSelectedApp(app);
											}}
											className={`cn-row${isSelected ? " cn-row--selected" : ""}`}
										>
											<div className="cn-row__main">
												<div className="cn-row__top">
													<span className="cn-row__ref">{app.appId}</span>
													<StatusPill tone={app.status === "Accepted" ? "done" : app.status === "Rejected" ? "blocked" : "current"}>{app.status}</StatusPill>
												</div>
												<p className="cn-row__name">{app.applicantName}</p>
												<p className="cn-row__sub">
													{app.university} · {app.program}
												</p>
												<div className="cn-row__meta">
													{app.assignedStaff ? (
														<StaffChatBadge
															opsUserId={opsUserIdByEmail(app.assignedStaffEmail)}
															name={app.assignedStaff}
															email={app.assignedStaffEmail}
														/>
													) : (
														<span>Unassigned</span>
													)}
													<span> · {app.journey?.label ?? JOURNEY_STAGE_LABELS[app.stage as JourneyStage]}</span>
												</div>
											</div>
											<span className="cn-row__arrow" aria-hidden>→</span>
										</div>
									);
								})
							)}
						</div>
					</>
				}
				detail={selectedApp ? <CaseDetail app={liveSelected ?? selectedApp} /> : null}
			/>
		</div>
	);
}
