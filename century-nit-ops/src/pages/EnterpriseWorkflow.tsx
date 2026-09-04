import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import type { MockApplication, PreDepartureTask } from "century-nit-core/ops";
import { JOURNEY_STAGES, JOURNEY_STAGE_LABELS, canAdvanceToStage, type JourneyStage } from "century-nit-shared";

/**
 * The pipeline every application moves through. Cards can be dragged between
 * columns or advanced with the arrow control - both write back to the ops store,
 * so the Applications table and dashboard update with them. `JOURNEY_STAGES` is
 * the shared source of truth; column keys are the enum values and labels come
 * from `JOURNEY_STAGE_LABELS`.
 */

const STAGE_COLORS: Record<JourneyStage, string> = {
	document_verification: "#3b82f6",
	school_submission: "#8b5cf6",
	offer_letter_review: "#f59e0b",
	visa_processing: "#06b6d4",
	payment_execution: "#ec4899",
	travel_assistance: "#f97316",
	completed: "#22c55e",
};

const STAGE_NUMBERS: Record<JourneyStage, number> = {
	document_verification: 1,
	school_submission: 2,
	offer_letter_review: 3,
	visa_processing: 4,
	payment_execution: 5,
	travel_assistance: 6,
	completed: 7,
};


function preDepartureProgress(tasks?: PreDepartureTask[]): number {
	if (!tasks || tasks.length === 0) return 0;
	return Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100);
}

/** Anything with an unrecognised stage lands in the first column. */
function normaliseStage(stage: string): JourneyStage {
	const match = JOURNEY_STAGES.find((s) => s === stage);
	return match ?? JOURNEY_STAGES[0];
}

function initials(name: string) {
	return name
		.split(/\s+/)
		.map((p) => p[0])
		.filter(Boolean)
		.slice(0, 2)
		.join("")
		.toUpperCase();
}

export function EnterpriseWorkflow() {
	const { opsUser, opsRole, canSeeAllBranches, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { applications, setApplicationStage } = useCases();
	const navigate = useNavigate();
	const [dragging, setDragging] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState<JourneyStage | null>(null);
	const [ownerFilter, setOwnerFilter] = useState<"all" | "mine">("all");
	const [branchFilter, setBranchFilter] = useState("all");
	const [actionError, setActionError] = useState<string | null>(null);

	const canSeeAll = canSeeAllBranches;

	/**
	 * Manager and coordinator route any case; the assigned owner moves their
	 * own. Previously only the two routing roles could drag at all, so a
	 * consultant could not advance a case they were personally responsible for.
	 */
	const canMoveAny = opsRole === "manager" || opsRole === "coordinator";
	const ownsCase = (a: MockApplication) =>
		a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name;
	const canMoveCase = (a: MockApplication) => canMoveAny || ownsCase(a);

	const visible = useMemo(() => {
		const scoped = scopeRecords(
			applications,
			(a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name,
		);
		let list = branchFilter === "all" ? scoped : scoped.filter((a) => a.branch === branchFilter);
		if (ownerFilter === "mine") {
			list = list.filter(
				(a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name,
			);
		}
		return list;
	}, [applications, scopeRecords, opsUser, ownerFilter, branchFilter]);

	const columns = useMemo(() => {
		const map = new Map<JourneyStage, MockApplication[]>();
		for (const stage of JOURNEY_STAGES) map.set(stage, []);
		for (const app of visible) {
			map.get(normaliseStage(app.stage))!.push(app);
		}
		return map;
	}, [visible]);

	async function move(app: MockApplication, to: JourneyStage) {
		const reason = canAdvanceToStage(normaliseStage(app.stage), to, app);
		if (reason) {
			setActionError(reason);
			return;
		}
		try {
			await setApplicationStage(app.appId, to);
			setActionError(null);
		} catch (err: unknown) {
			setActionError(err instanceof Error ? err.message : "Could not move case");
		}
	}

	function advance(app: MockApplication) {
		const idx = JOURNEY_STAGES.indexOf(normaliseStage(app.stage));
		const next = JOURNEY_STAGES[idx + 1];
		if (next) void move(app, next);
	}

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem", gap: "1rem", flexWrap: "wrap" }}>
				<div>
					<h1 className="page-title">Workflow Board</h1>
					<p className="lead mt-2">
						Drag a case to a new stage, or use → to advance it. Changes save to the case record.
					</p>
				</div>
				{canSeeAll && (
					<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
						<button
							onClick={() => setOwnerFilter("all")}
							className={`btn btn--sm ${ownerFilter === "all" ? "btn--primary" : "btn--ghost"}`}
						>
							All cases
						</button>
						<button
							onClick={() => setOwnerFilter("mine")}
							className={`btn btn--sm ${ownerFilter === "mine" ? "btn--primary" : "btn--ghost"}`}
						>
							Assigned to me
						</button>
						<BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />
					</div>
				)}
			</div>

			{/* Role scope banner */}
			<div style={{
				padding: "0.65rem 1rem",
				border: "1px solid var(--border-light)",
				background: canSeeAll ? "var(--foreground)" : "var(--muted)",
				color: canSeeAll ? "var(--background)" : "var(--foreground)",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				marginBottom: "1.25rem",
			}}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
					<span style={{ fontSize: "1rem" }}>{canSeeAll ? "◱" : "◎"}</span>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						{canSeeAll
							? `All ${visible.length} cases on the board`
							: requiresAssignmentScope
								? `${visible.length} cases assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch · ${visible.length} cases on the board`}
					</p>
				</div>
				<span className="portal-pill" style={canSeeAll ? { background: "var(--background)", color: "var(--foreground)", border: "none" } : undefined}>
					{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
				</span>
			</div>

			{actionError && (
				<div
					role="alert"
					style={{
						padding: "0.85rem 1.25rem",
						background: "var(--danger-bg, #b91c1c)",
						color: "var(--danger, #fff)",
						marginBottom: "1rem",
					}}
				>
					{actionError}
				</div>
			)}

			<div className="ops-board" style={{ display: "flex", gap: "1rem", overflowX: "auto", paddingBottom: "1.5rem", alignItems: "flex-start" }}>
				{JOURNEY_STAGES.map((stage) => {
					const cards = columns.get(stage) ?? [];
					const isTarget = dragOver === stage;
					const color = STAGE_COLORS[stage];
					return (
						<div
							key={stage}
							onDragOver={(e) => {
								e.preventDefault();
								setDragOver(stage);
							}}
							onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
							onDrop={(e) => {
								e.preventDefault();
								const app = dragging ? visible.find((a) => a.appId === dragging) : undefined;
								if (app) void move(app, stage);
								setDragging(null);
								setDragOver(null);
							}}
							style={{
								minWidth: "280px",
								flex: "1 0 280px",
								background: isTarget ? "var(--foreground)" : "var(--muted)",
								color: isTarget ? "var(--background)" : "inherit",
								border: `1px solid ${isTarget ? "var(--foreground)" : "var(--border)"}`,
								padding: "0",
								display: "flex",
								flexDirection: "column",
								minHeight: "220px",
								overflow: "hidden",
								transition: "background 120ms, border-color 120ms",
							}}
						>
							{/* Column header */}
							<div style={{
								padding: "0.75rem 1rem",
								borderBottom: `2px solid ${color}`,
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								background: isTarget ? "transparent" : "var(--card)",
							}}>
								<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
									<span style={{
										fontSize: "0.75rem",
										fontWeight: 700,
										fontFamily: "var(--font-mono)",
										color: isTarget ? "var(--background)" : color,
									}}>
										{STAGE_NUMBERS[stage]}
									</span>
									<h3 className="section-title" style={{ fontSize: "0.85rem", color: "inherit", margin: 0 }}>{JOURNEY_STAGE_LABELS[stage]}</h3>
								</div>
								<span
									className="portal-pill"
									style={{
										fontSize: "0.72rem",
										padding: "0.15rem 0.5rem",
										...(isTarget ? { background: "var(--background)", color: "var(--foreground)", border: "none" } : {}),
									}}
								>
									{cards.length}
								</span>
							</div>

							{/* Column body */}
							<div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", flexGrow: 1, padding: "0.75rem" }}>
								{cards.length === 0 ? (
									<div style={{
										padding: "2rem 0",
										textAlign: "center",
										border: "1px dashed var(--border-light)",
									}}>
										<p
											style={{
												fontSize: "var(--text-xs)",
												opacity: 0.5,
												fontFamily: "var(--font-mono)",
											}}
										>
											{isTarget ? "Drop here" : "Empty"}
										</p>
									</div>
								) : (
								cards.map((app) => {
									const isLast = normaliseStage(app.stage) === JOURNEY_STAGES[JOURNEY_STAGES.length - 1];
									const done = app.checklist.filter((c) => c.checked).length;
									const progress = app.checklist.length > 0 ? Math.round((done / app.checklist.length) * 100) : 0;
									const stage = normaliseStage(app.stage);
									const pdProg = preDepartureProgress(app.preDepartureTasks);
									const nextStage = JOURNEY_STAGES[JOURNEY_STAGES.indexOf(stage) + 1];
									const advanceReason = nextStage ? canAdvanceToStage(stage, nextStage, app) : null;
									const canDrag = canMoveCase(app) && !isLast && advanceReason === null;
									return (
										<div
											key={app.id}
											draggable={canDrag}
											onDragStart={() => canDrag && setDragging(app.appId)}
												onDragEnd={() => {
													setDragging(null);
													setDragOver(null);
												}}
												onClick={() => navigate(`/applications?id=${app.id}`)}
												className="card wf-card"
												style={{
													padding: "0.85rem",
													cursor: "pointer",
													boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
													border: "1px solid var(--border)",
													background: "var(--background)",
													color: "var(--foreground)",
													opacity: dragging === app.appId ? 0.4 : 1,
												}}
											>
												<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
													<div style={{ minWidth: 0 }}>
														<p style={{ fontWeight: 600, fontSize: "0.875rem" }}>
															{app.applicantName}
														</p>
														<p className="muted mt-1" style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)" }}>
															{app.appId}
														</p>
													</div>
													<span
														title={app.assignedStaff}
														style={{
															width: "28px",
															height: "28px",
															flexShrink: 0,
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
															background: "var(--foreground)",
															color: "var(--background)",
															fontSize: "0.62rem",
															fontFamily: "var(--font-mono)",
															fontWeight: 600,
														}}
													>
														{initials(app.assignedStaff)}
													</span>
												</div>

												<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.4rem" }}>
													<p className="muted" style={{ fontSize: "0.72rem" }}>
														{app.university}
													</p>
												</div>

												<p className="muted" style={{ fontSize: "0.68rem", marginTop: "0.3rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
													<span>Officer:</span>
													<span style={{ fontWeight: 600 }}>{app.assignedStaff || "Unassigned"}</span>
												</p>

											{/* Stage-specific mini indicators */}
											{stage === "visa_processing" && app.visaStage && (
													<div className="wf-card__indicator" style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
														<span className="wf-dot" style={{ background: STAGE_COLORS[stage] }} />
														<span style={{ fontSize: "0.68rem", fontFamily: "var(--font-mono)", textTransform: "capitalize" }}>
															{app.visaStage === "locked" ? "Awaiting payment" : app.visaStage}
														</span>
														{!app.visaInvoicePaid && (
															<span className="wf-badge wf-badge--warn">Invoice unpaid</span>
														)}
													</div>
												)}

											{stage === "payment_execution" && (
												<div className="wf-card__indicator" style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
													<span className="wf-dot" style={{ background: STAGE_COLORS[stage] }} />
													<span style={{ fontSize: "0.68rem", fontFamily: "var(--font-mono)" }}>
														{app.paymentPlanId === "installments" ? "Installments" : app.paymentPlanId === "full" ? "Full payment" : "Not selected"}
													</span>
												</div>
											)}

											{stage === "travel_assistance" && (
													<div className="wf-card__indicator" style={{ marginTop: "0.5rem" }}>
														<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
															<span style={{ fontSize: "0.65rem", fontFamily: "var(--font-mono)" }}>Pre-departure</span>
															<span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", fontWeight: 600, color: pdProg === 100 ? "#22c55e" : "var(--muted-foreground)" }}>{pdProg}%</span>
														</div>
														<div style={{ width: "100%", height: "3px", background: "var(--muted)", overflow: "hidden" }}>
															<div style={{ width: `${pdProg}%`, height: "100%", background: pdProg === 100 ? "#22c55e" : STAGE_COLORS[stage], transition: "width 0.4s ease" }} />
														</div>
														{app.travelClearance === "pending" && (
															<span className="wf-badge wf-badge--warn" style={{ marginTop: "0.3rem" }}>Travel pending</span>
														)}
													</div>
												)}

												{/* Progress bar */}
												<div style={{ marginTop: "0.6rem" }}>
													<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
														<span className="muted" style={{ fontSize: "0.65rem", fontFamily: "var(--font-mono)" }}>
															{done}/{app.checklist.length} checks
														</span>
														<span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", fontWeight: 600, color: progress === 100 ? "#22c55e" : "var(--muted-foreground)" }}>
															{progress}%
														</span>
													</div>
													<div style={{ width: "100%", height: "4px", background: "var(--muted)", overflow: "hidden" }}>
														<div style={{
															width: `${progress}%`,
															height: "100%",
															background: progress === 100 ? "#22c55e" : "var(--foreground)",
															transition: "width 0.4s ease",
														}} />
													</div>
												</div>

									{canMoveCase(app) && !isLast && (
										<button
											type="button"
											onClick={(e) => { e.stopPropagation(); advance(app); }}
											disabled={advanceReason !== null}
											className="btn btn--ghost btn--sm"
											style={{ padding: "0.15rem 0.5rem", fontSize: "0.72rem", marginTop: "0.5rem", width: "100%" }}
											title={advanceReason ?? "Advance to next stage"}
										>
											{"\u2192"} {nextStage ? JOURNEY_STAGE_LABELS[nextStage] : "Completed"}
										</button>
									)}
											</div>
										);
									})
								)}
							</div>
						</div>
					);
				})}
			</div>

			<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
				{visible.length} case{visible.length === 1 ? "" : "s"} on the board
				{!canSeeAll ? " \u00b7 showing only cases assigned to you" : ownerFilter === "mine" ? " \u00b7 filtered to your assignments" : ""}
			</p>
		</div>
	);
}
