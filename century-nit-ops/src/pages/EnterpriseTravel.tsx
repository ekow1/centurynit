import { useMemo, useState, useEffect, useCallback } from "react";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import { applicationsApi, ApiError } from "century-nit-core/api";
import type { Assignee } from "century-nit-core/ops";
import { AssignControl, CaseHeader } from "century-nit-core/ui";

import type { MockApplication, PreDepartureTask } from "century-nit-core/ops";
import { JOURNEY_STAGE_LABELS, TRAVEL_STATUS_LABELS, type JourneyStage, type TravelAssistanceRequest } from "century-nit-shared";

const PRE_DEPARTURE_CATEGORIES: Record<string, { label: string; icon: string }> = {
	travel: { label: "Travel", icon: "\u2708" },
	accommodation: { label: "Accommodation", icon: "\u2302" },
	documents: { label: "Documents", icon: "\u2261" },
	health: { label: "Health & Insurance", icon: "\u271a" },
	finance: { label: "Finance", icon: "\u00a4" },
	orientation: { label: "Orientation", icon: "\u25cb" },
};

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
	const {
		applications,
		assignees,
		setTravelClearance,
		togglePreDepartureTask,
	} = useCases();
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");
	const [taQueue, setTaQueue] = useState<TravelAssistanceRequest[]>([]);
	const [taLoading, setTaLoading] = useState(false);
	const [taError, setTaError] = useState<string | null>(null);
	const [selectedTa, setSelectedTa] = useState<TravelAssistanceRequest | null>(null);

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
	const pdProg = active ? preDepartureProgress(active.preDepartureTasks) : 0;

	useEffect(() => {
		if (!active) {
			setSelectedTa(null);
			return;
		}
		let cancelled = false;
		applicationsApi
			.getTravelAssistance(active.id)
			.then((ta) => {
				if (!cancelled) setSelectedTa(ta);
			})
			.catch((err: unknown) => {
				const message = err instanceof ApiError ? err.message : String(err);
				console.error("[TA detail] failed to load for app", active.id, message);
				if (!cancelled) setSelectedTa(null);
			});
		return () => {
			cancelled = true;
		};
	}, [active]);
	const pdCats = Object.keys(PRE_DEPARTURE_CATEGORIES);

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
							<div style={{ flex: 1, overflowY: "auto", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
								<div className="card" style={{ padding: "0.75rem 1rem" }}>
									<CaseHeader
										name={active.applicantName}
										reference={active.appId}
										branch={active.branch}
										stage={active.stage}
										portalStage={active.journey?.portalStage ?? null}
										handlerName={
											(active.stageHandlers ?? []).find((h) => h.stage === "travel_assistance")?.opsUserName ?? active.assignedStaff ?? null
										}
									/>
								</div>
							{/* Travel Clearance */}
							{(active.stage === "travel_assistance" || active.stage === "completed") && (
								<div className="card" style={{ background: "var(--muted)" }}>
									<p className="eyebrow mb-1">Travel Clearance</p>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap", gap: "0.75rem" }}>
											<div>
												<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
													{active.travelClearance === "cleared" ? "Cleared for travel" : "Pending clearance"}
												</p>
												<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
													{active.travelClearance === "cleared"
														? "Applicant is cleared for departure."
														: "Grant clearance once all checks are satisfied."}
												</p>
											</div>
										{active.stage === "travel_assistance" && (
											<button
												onClick={() => setTravelClearance(active.appId, active.travelClearance !== "cleared")}
												className={`btn btn--sm ${active.travelClearance === "cleared" ? "btn--ghost" : "btn--primary"}`}
												style={{ whiteSpace: "nowrap" }}
											>
												{active.travelClearance === "cleared" ? "Revoke clearance" : "Grant clearance"}
											</button>
										)}
										</div>
									</div>
								)}

							{/* Pre-departure Checklist */}
							{(active.stage === "travel_assistance" || active.stage === "completed") && (
									<div className="card">
										<p className="eyebrow mb-2">Pre-departure Checklist</p>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
											<span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
												{active.preDepartureTasks?.filter((t) => t.done).length ?? 0}/{active.preDepartureTasks?.length ?? 0} tasks
											</span>
											<span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", fontWeight: 600, color: pdProg === 100 ? "#22c55e" : "var(--muted-foreground)" }}>
												{pdProg}%
											</span>
										</div>
										<div style={{ height: "6px", background: "var(--muted)", borderRadius: "999px", overflow: "hidden", marginBottom: "1rem" }}>
											<div style={{ width: `${pdProg}%`, height: "100%", background: pdProg === 100 ? "#22c55e" : "#f97316", transition: "width 0.4s ease" }} />
										</div>

										{active.preDepartureTasks && active.preDepartureTasks.length > 0 ? (
											<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
												{pdCats.map((cat) => {
													const tasks = active.preDepartureTasks!.filter((t) => t.category === cat);
													if (tasks.length === 0) return null;
													const catDone = tasks.filter((t) => t.done).length;
													return (
														<div key={cat} style={{ border: "1px solid var(--border-light)", padding: "0.75rem", borderRadius: "4px" }}>
															<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
																<span style={{ fontSize: "0.9rem" }}>{PRE_DEPARTURE_CATEGORIES[cat].icon}</span>
																<div>
																	<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{PRE_DEPARTURE_CATEGORIES[cat].label}</p>
																	<p className="muted" style={{ fontSize: "var(--text-xs)" }}>{catDone}/{tasks.length} complete</p>
																</div>
															</div>
															<div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
																{tasks.map((task) => (
																	<div
																		key={task.id}
																		onClick={() => active.stage === "travel_assistance" && togglePreDepartureTask(active.appId, task.id)}
																		style={{
																			display: "flex",
																			alignItems: "flex-start",
																			gap: "0.5rem",
																			padding: "0.4rem",
																			cursor: active.stage === "travel_assistance" ? "pointer" : "default",
																			border: "1px solid var(--border-light)",
																		}}
																	>
																		<span style={{
																			width: "18px",
																			height: "18px",
																			flexShrink: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center",
																			fontSize: "0.65rem",
																			fontWeight: 700,
																			border: "2px solid",
																			borderColor: task.done ? "#22c55e" : "var(--border)",
																			borderRadius: "3px",
																			color: task.done ? "#fff" : "transparent",
																			background: task.done ? "#22c55e" : "transparent",
																		}}>
																			{task.done ? "\u2713" : ""}
																		</span>
																		<div>
																			<p style={{ fontWeight: task.done ? 400 : 500, fontSize: "var(--text-xs)", textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.6 : 1 }}>
																				{task.label}
																			</p>
																			<p className="muted" style={{ fontSize: "0.68rem" }}>{task.detail}</p>
																		</div>
																	</div>
																))}
															</div>
														</div>
													);
												})}
											</div>
										) : (
											<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No pre-departure tasks assigned yet.</p>
										)}
									</div>
								)}

						{active.stage === "travel_assistance" && active.agencySettled && active.travelClearance === "cleared" && pdProg === 100 && (
							<div className="card" style={{ background: "#dcfce7", borderColor: "#86efac" }}>
								<p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "#166534" }}>All clear</p>
								<p style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem", color: "#166534" }}>
									All milestones complete. Use the Workflow board to mark the case as Completed.
								</p>
							</div>
						)}

							{/* Case Meta */}
								<div className="card">
									<p className="eyebrow mb-2">Case Info</p>
									<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Institution</p><p>{active.university}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Program</p><p>{active.program}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Travel Handler</p><p>{selectedTa?.assignedOpsUserName ?? (selectedTa ? "Not assigned" : "—")}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Branch</p><p>{branchName(active.branch)}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Travel Status</p><p>{selectedTa ? (selectedTa.status ?? "—").replace(/_/g, " ") : "—"}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Submitted Date</p><p>{active.submittedDate}</p></div>
									</div>
								</div>

								{active.notes && (
									<div className="card">
										<p className="eyebrow mb-2">Staff Case Notes</p>
										<p style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{active.notes}</p>
									</div>
								)}
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

// Status words come from the one vocabulary (century-nit-shared labels.ts),
// so the Travel page and the applicant's travel card agree.
const TA_STATUS_LABELS = TRAVEL_STATUS_LABELS;

function TaQueueRow({
	ta,
	onChanged,
	onSelectApp,
	staff,
	branch,
	canIssue,
}: {
	ta: TravelAssistanceRequest;
	onChanged: () => void;
	onSelectApp?: () => void;
	staff: Assignee[];
	branch?: string;
	canIssue?: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const [showInvoiceForm, setShowInvoiceForm] = useState(false);
	const [showBookingForm, setShowBookingForm] = useState(false);
	const [showAssignForm, setShowAssignForm] = useState(false);
	const [carrier, setCarrier] = useState("");
	const [flightNumber, setFlightNumber] = useState("");
	const [ticketAmount, setTicketAmount] = useState("");
	const [notes, setNotes] = useState("");
	const [confirmationCode, setConfirmationCode] = useState("");
	const [bookingCarrier, setBookingCarrier] = useState("");
	const [bookingNotes, setBookingNotes] = useState("");
	async function assignHandler(opsUserId: string) {
		await applicationsApi.assignTravelHandler(ta.id, opsUserId);
		onChanged();
		setShowAssignForm(false);
	}

	async function raiseInvoice() {
		setBusy(true);
		try {
			await applicationsApi.raiseTravelInvoice(ta.id, {
				carrier: carrier || undefined,
				flightNumber: flightNumber || undefined,
				ticketAmountCents: Math.round(Number(ticketAmount) * 100),
				notes: notes || undefined,
			});
			onChanged();
			setShowInvoiceForm(false);
		} catch {
			/* ignore */
		} finally {
			setBusy(false);
		}
	}

	async function issueInvoice() {
		setBusy(true);
		try {
			await applicationsApi.issueTravelInvoice(ta.id);
			onChanged();
		} catch {
			/* ignore */
		} finally {
			setBusy(false);
		}
	}

	async function recordBooking() {
		setBusy(true);
		try {
			await applicationsApi.recordTravelBooking(ta.id, {
				carrier: bookingCarrier || undefined,
				confirmationCode: confirmationCode || undefined,
				notes: bookingNotes || undefined,
			});
			onChanged();
			setShowBookingForm(false);
		} catch {
			/* ignore */
		} finally {
			setBusy(false);
		}
	}

	const pendingHint =
		ta.status === "decision_pending"
			? "Waiting for applicant decision"
			: ta.status === "review" && !ta.assignedOpsUserId
				? "Assign a handler before raising the ticket invoice."
				: ta.status === "review" && ta.assignedOpsUserId
					? "Handler assigned — raise the ticket invoice (proforma) for manager approval."
					: ta.status === "quote_prepared"
						? "Proforma raised — a manager must approve & issue it before the applicant can pay."
						: ta.status === "invoiced"
							? "Waiting for applicant to pay the ticket"
							: ta.status === "booked"
								? "Booking confirmed — waiting for applicant to choose a payment plan"
								: ta.status === "cleared"
									? "Cleared to travel"
									: null;

	return (
		<div style={{ padding: "0.75rem", border: "1px solid var(--border-light)", borderRadius: "6px" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
				<div
					onClick={onSelectApp}
					style={{ cursor: onSelectApp ? "pointer" : "default", flex: 1, minWidth: 0 }}
					title={onSelectApp ? "View full case detail" : undefined}
				>
					<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
						{ta.applicantName ?? ta.applicantId.slice(0, 8)}
						{onSelectApp && <span style={{ opacity: 0.4, marginLeft: "0.35rem" }}>{"\u2192"}</span>}
					</p>
					<p className="muted" style={{ fontSize: "var(--text-xs)" }}>
						{ta.applicationReference ?? ""}
						{ta.university ? ` · ${ta.university}` : ""}
						{" — "}
						{TA_STATUS_LABELS[ta.status] ?? ta.status}
						{ta.decision ? ` · ${ta.decision}` : ""}
					</p>
					{ta.assignedOpsUserName && (
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
							Handler: {ta.assignedOpsUserName}
						</p>
					)}
				</div>
				<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
					{ta.status === "review" && (
						<button className="btn btn--sm btn--ghost" onClick={() => setShowAssignForm((v) => !v)}>
							{ta.assignedOpsUserId ? "Reassign handler" : "Assign handler"}
						</button>
					)}
					{ta.status === "review" && ta.assignedOpsUserId && (
						<button className="btn btn--sm btn--primary" onClick={() => setShowInvoiceForm((v) => !v)}>
							Raise invoice
						</button>
					)}
					{ta.status === "quote_prepared" && canIssue && (
						<button className="btn btn--sm btn--primary" onClick={() => void issueInvoice()} disabled={busy}>
							{busy ? "Issuing…" : "Approve & issue"}
						</button>
					)}
					{ta.status === "ticket_paid" && (
						<button className="btn btn--sm btn--primary" onClick={() => setShowBookingForm((v) => !v)}>
							Record booking
						</button>
					)}
				</div>
			</div>

			{pendingHint && (
				<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem", fontStyle: "italic" }}>
					{pendingHint}
				</p>
			)}

			{showAssignForm && ta.status === "review" && (
				<div className="mt-3">
					<AssignControl
						stage="travel_assistance"
						staff={staff}
						branch={branch}
						currentName={ta.assignedOpsUserName ?? null}
						busy={busy}
						onAssign={(opsUserId) => assignHandler(opsUserId)}
					/>
				</div>
			)}

			{showInvoiceForm && ta.status === "review" && ta.assignedOpsUserId && (
				<div style={{ marginTop: "0.75rem", display: "grid", gap: "0.4rem" }}>
					<input
						className="input input--sm"
						placeholder="Carrier (optional)"
						value={carrier}
						onChange={(e) => setCarrier(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Flight number (optional)"
						value={flightNumber}
						onChange={(e) => setFlightNumber(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Ticket amount (USD)"
						type="number"
						value={ticketAmount}
						onChange={(e) => setTicketAmount(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Notes (optional)"
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
					/>
					<button
						className="btn btn--sm btn--primary"
						onClick={() => void raiseInvoice()}
						disabled={busy || !ticketAmount}
					>
						{busy ? "Raising…" : "Raise invoice"}
					</button>
				</div>
			)}

			{showBookingForm && ta.status === "ticket_paid" && (
				<div style={{ marginTop: "0.75rem", display: "grid", gap: "0.4rem" }}>
					<input
						className="input input--sm"
						placeholder="Carrier"
						value={bookingCarrier}
						onChange={(e) => setBookingCarrier(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Confirmation code"
						value={confirmationCode}
						onChange={(e) => setConfirmationCode(e.target.value)}
					/>
					<input
						className="input input--sm"
						placeholder="Notes (optional)"
						value={bookingNotes}
						onChange={(e) => setBookingNotes(e.target.value)}
					/>
					<button
						className="btn btn--sm btn--primary"
						onClick={() => void recordBooking()}
						disabled={busy}
					>
						{busy ? "Saving…" : "Confirm booking"}
					</button>
				</div>
			)}
		</div>
	);
}
