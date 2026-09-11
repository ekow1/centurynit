import { useMemo, useState, useEffect, useCallback } from "react";
import { CaseDetail } from "./CaseDetail";
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
	if (plan === "installments") return "Installments";
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

		{/* Split Pane Layout */}
			<div className="ops-split" style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
				{/* LEFT: List Pane */}
				<div className="ops-split__list" style={{ flex: "0 0 40%", minWidth: "360px", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border-light)", height: "var(--ops-pane-h)" }}>
					<div style={{ padding: "0.75rem", borderBottom: "1px solid var(--border-light)", background: "var(--muted)", flexShrink: 0 }}>
						<div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
							{["All", "Travel", "Completed"].map((tab) => (
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
								No travel cases match your filter.
							</div>
						) : (
							filteredApps.map((app) => {
								const isSelected = selectedApp?.appId === app.appId;
								const prog = preDepartureProgress(app.preDepartureTasks);
								return (
									<div
										key={app.id}
										onClick={() => openDetail(app)}
										style={{
											padding: "0.85rem 1rem",
											borderBottom: "1px solid var(--border-light)",
											cursor: "pointer",
											transition: "background 100ms",
											background: isSelected ? "var(--foreground)" : "transparent",
											color: isSelected ? "var(--background)" : "var(--foreground)",
											borderLeft: isSelected ? "4px solid #f97316" : "4px solid transparent",
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
													background: isSelected ? "var(--background)" : undefined,
													color: isSelected ? "var(--foreground)" : undefined,
													border: isSelected ? "none" : undefined,
												}}>
													{JOURNEY_STAGE_LABELS[app.stage as JourneyStage]}
												</span>
												</div>
												<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{app.applicantName}</p>
												<p style={{ fontSize: "var(--text-xs)", opacity: 0.65, marginTop: "0.15rem" }}>
													{app.university} {"\u00b7"} {paymentPlanLabel(app.paymentPlanId)}
												</p>
												<div style={{ display: "flex", gap: "0.75rem", fontSize: "var(--text-xs)", marginTop: "0.2rem", alignItems: "center" }}>
													<span>{app.agencySettled ? "Settled" : `${(app.agencyStageIndex ?? 0) + 1}/3 agency`}</span>
													<span>{"\u00b7"}</span>
													<span>{prog}% pre-departure</span>
													<span>{"\u00b7"}</span>
													<span>{app.travelClearance === "cleared" ? "Cleared" : "Pending"}</span>
												</div>
											</div>
											<span style={{ fontSize: "0.9rem", flexShrink: 0, marginLeft: "0.5rem" }}>{"\u2192"}</span>
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
					{!active ? (
						<div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
							<span style={{ fontSize: "2.5rem", opacity: 0.15, marginBottom: "1rem" }}>{"\u2708"}</span>
							<p className="muted" style={{ fontSize: "var(--text-sm)", textAlign: "center" }}>
								Select a case from the list to manage travel clearance and pre-departure details.
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
											{active.appId}
										</span>
									<span className="portal-pill" style={{ background: "var(--background)", color: "var(--foreground)", border: "none", fontSize: "var(--text-xs)" }}>
										{JOURNEY_STAGE_LABELS[active.stage as JourneyStage]}
									</span>
									</div>
									<h2 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", color: "var(--background)", margin: 0 }}>
										{active.applicantName}
									</h2>
									<p style={{ opacity: 0.75, fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>
										{active.university} {"\u00b7"} {active.program} ({active.country})
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
									{"\u2715"}
								</button>
							</div>

							{/* Detail Content */}
							<div style={{ flex: 1, overflowY: "auto", padding: "1.25rem" }}>
								<CaseDetail app={active} />
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
