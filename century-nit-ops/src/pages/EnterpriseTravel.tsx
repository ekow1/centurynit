import { useMemo, useState, useEffect, useCallback } from "react";
import { CaseDetail } from "./CaseDetail";
import { CaseScaffold } from "./case/CaseScaffold";
import { StatusPill } from "century-nit-core/ui";
import { TaQueueRow } from "./TravelRequestCard";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import { applicationsApi, ApiError } from "century-nit-core/api";

import type { MockApplication, PreDepartureTask } from "century-nit-core/ops";
import { JOURNEY_STAGE_LABELS, type JourneyStage, type TravelAssistanceRequest } from "century-nit-shared";

function preDepartureProgress(tasks?: PreDepartureTask[]): number {
	if (!tasks || tasks.length === 0) return 0;
	return Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100);
}

function paymentPlanLabel(plan?: string): string {
	if (plan === "full") return "Full";
	if (plan === "installment") return "Installments";
	return "Not set";
}

export function EnterpriseTravel() {
	const { opsRole, opsUser, canSeeAllBranches, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { applications, assignees } = useCases();
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");
	const [taQueue, setTaQueue] = useState<TravelAssistanceRequest[]>([]);
	const [taLoading, setTaLoading] = useState(false);
	const [taError, setTaError] = useState<string | null>(null);

	const loadQueue = useCallback(async () => {
		setTaLoading(true);
		setTaError(null);
		try {
			const rows = await applicationsApi.listTravelAssistance();
			console.log("[TA queue] loaded:", rows.length, rows);
			setTaQueue(rows);
		} catch (err) {
			const message = err instanceof ApiError ? err.message : String(err);
			console.error("[TA queue] failed:", message, err);
			setTaError(message);
		} finally {
			setTaLoading(false);
		}
	}, []);

	useEffect(() => {
		loadQueue();
		const onFocus = () => loadQueue();
		window.addEventListener("focus", onFocus);
		const interval = setInterval(() => loadQueue(), 30000);
		return () => {
			window.removeEventListener("focus", onFocus);
			clearInterval(interval);
		};
	}, [loadQueue]);


	const canSeeAll = canSeeAllBranches;
	// Only managers/coordinators/admins can approve (issue) a proforma travel
	// invoice — same role gate as the application invoice issue endpoint.
	const canIssueTravelInvoice =
		opsRole === "manager" || opsRole === "coordinator" || opsRole === "admin" || opsRole === "super_admin";

	const travelApps = useMemo(() => {
		// "Mine" is the travel handler (stage assignment) or the case owner.
		const scoped = scopeRecords(
			applications,
			(a) =>
				a.assignedStaffEmail === opsUser?.email ||
				a.assignedStaff === opsUser?.name ||
				(a.stageHandlers ?? []).some((h) => h.stage === "travel_assistance" && h.opsUserEmail === opsUser?.email),
		);
		const filtered = branchFilter === "all" ? scoped : scoped.filter((a) => a.branch === branchFilter);
		// Include applications at the travel/completed stage, plus any that have
		// a travel assistance request (the applicant may have recorded a decision
		// before ops advanced the journey stage on the board).
		const taAppIds = new Set(taQueue.map((ta) => ta.applicationId));
		return filtered.filter(
			(a) =>
				a.stage === "travel_assistance" ||
				a.stage === "completed" ||
				taAppIds.has(a.id),
		);
	}, [applications, scopeRecords, opsUser, branchFilter, taQueue]);

	const filteredApps = travelApps.filter((a) => {
		const matchesSearch =
			a.applicantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.appId.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.university.toLowerCase().includes(searchQuery.toLowerCase());
		if (!matchesSearch) return false;
		if (statusFilter === "All") return true;
		if (statusFilter === "Travel") return a.stage === "travel_assistance";
		if (statusFilter === "Completed") return a.stage === "completed";
		return true;
	});

	const liveSelected = selectedApp
		? applications.find((a) => a.appId === selectedApp.appId) ?? selectedApp
		: null;

	function openDetail(app: MockApplication) {
		setSelectedApp(app);
	}

	const active = liveSelected ?? selectedApp;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
				<div>
					<h1 className="page-title">Travel Assistance</h1>
					<p className="lead mt-1">Manage pre-departure checklists and travel clearance for settled cases.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{canSeeAll && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>

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
					<span style={{ fontSize: "1rem" }}>{canSeeAll ? "\u25f1" : "\u25cc"}</span>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						{canSeeAll
							? `All ${travelApps.length} travel cases \u00b7 ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: requiresAssignmentScope
								? `${travelApps.length} assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch \u00b7 ${travelApps.length} travel cases`}
					</p>
				</div>
				<span className="portal-pill" style={canSeeAll ? { background: "var(--background)", color: "var(--foreground)", border: "none" } : undefined}>
					{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
				</span>
			</div>

			{/* Travel Assistance Queue (direct-invoice flow) */}
		<div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
				<div>
					<p className="eyebrow">Travel Assistance Queue</p>
					<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>
						Travel requests awaiting handler assignment, invoicing, or booking.
					</p>
				</div>
				<span className="portal-pill">{taQueue.length} requests</span>
			</div>
			{taLoading ? (
				<p className="muted" style={{ fontSize: "var(--text-sm)" }}>Loading…</p>
			) : taQueue.length === 0 ? (
				<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
						{taError ? `Could not load travel queue: ${taError}` : "No travel assistance requests yet."}
					</p>
					{taError && (
						<button className="btn btn-sm" onClick={loadQueue}>Retry</button>
					)}
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
					{taQueue.map((ta) => (
						<TaQueueRow key={ta.id} ta={ta} staff={assignees} branch={applications.find((a) => a.id === ta.applicationId)?.branch} canIssue={canIssueTravelInvoice} onChanged={() => {
							applicationsApi.listTravelAssistance().then(setTaQueue).catch(() => {});
						}} onSelectApp={() => {
							const app = applications.find((a) => a.id === ta.applicationId);
							if (app) openDetail(app);
						}} />
					))}
				</div>
			)}
		</div>

			<CaseScaffold
				onClose={() => setSelectedApp(null)}
				emptyHint="Select a travel case from the list to review it and take action."
				list={
					<>
						<div className="cn-scaffold__filters">
							<div className="cn-scaffold__chips">
								{["All", "Travel", "Completed"].map((tab) => (
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
								<div className="cn-scaffold__none">No travel cases match your filter.</div>
							) : (
								filteredApps.map((app) => {
									const isSelected = selectedApp?.appId === app.appId;
									const prog = preDepartureProgress(app.preDepartureTasks);
									return (
										<div
											key={app.id}
											role="button"
											tabIndex={0}
											onClick={() => openDetail(app)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") openDetail(app);
											}}
											className={`cn-row${isSelected ? " cn-row--selected" : ""}`}
										>
											<div className="cn-row__main">
												<div className="cn-row__top">
													<span className="cn-row__ref">{app.appId}</span>
													<StatusPill tone={app.stage === "completed" ? "done" : "current"}>{JOURNEY_STAGE_LABELS[app.stage as JourneyStage]}</StatusPill>
												</div>
												<p className="cn-row__name">{app.applicantName}</p>
												<p className="cn-row__sub">
													{app.university} · {paymentPlanLabel(app.paymentPlanId)}
												</p>
												<div className="cn-row__meta">
													{app.agencySettled ? "Settled" : `${(app.agencyStageIndex ?? 0) + 1}/3 agency`} · {prog}% pre-departure ·{" "}
													{app.travelClearance === "cleared" ? "Cleared" : "Pending"}
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
				detail={active ? <CaseDetail app={active} initialTab="travel" /> : null}
			/>
		</div>
	);
}
