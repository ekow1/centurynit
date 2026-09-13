import { useMemo, useState } from "react";
import { useOpsAuth } from "../OpsAuthContext";
import { useCases } from "../../hooks/useCases";
import type { MockApplication, PreDepartureTask } from "century-nit-core/ops";
import { JOURNEY_STAGES, JOURNEY_STAGE_LABELS, canAdvanceToStage, isTravelResolved, type JourneyStage } from "century-nit-shared";

/**
 * The cases as columns, one per chapter. Cards can be dragged between
 * columns or advanced with the arrow control — both write to the case, so
 * the list and the dashboard move with them. `JOURNEY_STAGES` is the shared
 * source of truth; column keys are the enum values and labels come from the
 * vocabulary. A view of the Cases page, not a page of its own.
 */

function preDepartureProgress(tasks?: PreDepartureTask[]): number {
	if (!tasks || tasks.length === 0) return 0;
	return Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100);
}

/** Legacy payment_execution rows live in Departure; anything else unrecognised lands in the first column. */
function normaliseStage(stage: string): JourneyStage {
	const match = JOURNEY_STAGES.find((s) => s === (stage === "payment_execution" ? "travel_assistance" : stage));
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

export function CaseBoard({ apps, onOpen }: { apps: MockApplication[]; onOpen: (app: MockApplication) => void }) {

	const { opsUser, opsRole } = useOpsAuth();
	const { setApplicationStage } = useCases();
	const [dragging, setDragging] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState<JourneyStage | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	/**
	 * Manager and coordinator route any case; the assigned owner moves their
	 * own. Previously only the two routing roles could drag at all, so a
	 * consultant could not advance a case they were personally responsible for.
	 */
	const canMoveAny = opsRole === "manager" || opsRole === "coordinator";
	const ownsCase = (a: MockApplication) =>
		a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name;
	const canMoveCase = (a: MockApplication) => canMoveAny || ownsCase(a);

	const columns = useMemo(() => {
		const map = new Map<JourneyStage, MockApplication[]>();
		for (const stage of JOURNEY_STAGES) map.set(stage, []);
		for (const app of apps) {
			map.get(normaliseStage(app.stage))!.push(app);
		}
		return map;
	}, [apps]);

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
		<div>
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
				{JOURNEY_STAGES.map((stage, stageNum) => {
					const cards = columns.get(stage) ?? [];
					const isTarget = dragOver === stage;
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
								const app = dragging ? apps.find((a) => a.appId === dragging) : undefined;
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
								borderBottom: "2px solid var(--foreground)",
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
										color: isTarget ? "var(--background)" : "var(--foreground)",
									}}>
										{stageNum + 1}
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
												onClick={() => onOpen(app)}
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
											{app.proceedStatus && app.proceedStatus !== "accepted" && (
												<div className="wf-card__indicator" style={{ marginTop: "0.5rem" }}>
													<span className="wf-badge wf-badge--warn">
														{app.proceedStatus === "paused"
															? "On hold (Paused)"
															: app.proceedStatus === "declined"
																? "Consent declined · re-invite"
																: "Awaiting consent"}
													</span>
												</div>
											)}

											{stage === "document_verification" && !app.agencySettled && app.agencyStageIndex === 0 && (
												<div className="wf-card__indicator" style={{ marginTop: "0.5rem" }}>
													<span className="wf-badge wf-badge--warn">Deposit Unpaid</span>
												</div>
											)}

											{stage === "school_submission" && !app.appFeePaid && (
												<div className="wf-card__indicator" style={{ marginTop: "0.5rem" }}>
													<span className="wf-badge wf-badge--warn">App Fee Unpaid</span>
												</div>
											)}

											{stage === "visa_processing" && app.visaStage && (
													<div className="wf-card__indicator" style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
														<span className="wf-dot" style={{ background: "var(--foreground)" }} />
														<span style={{ fontSize: "0.68rem", fontFamily: "var(--font-mono)", textTransform: "capitalize" }}>
															{app.visaStage === "locked" ? "Awaiting payment" : app.visaStage}
														</span>
														{!app.visaInvoicePaid && (
															<span className="wf-badge wf-badge--warn">Invoice unpaid</span>
														)}
													</div>
												)}

											{stage === "travel_assistance" && (
													<div className="wf-card__indicator" style={{ marginTop: "0.5rem" }}>
														<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
															<span style={{ fontSize: "0.65rem", fontFamily: "var(--font-mono)" }}>Pre-departure</span>
															<span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", fontWeight: 600, color: pdProg === 100 ? "var(--foreground)" : "var(--muted-foreground)" }}>{pdProg}%</span>
														</div>
														<div style={{ width: "100%", height: "3px", background: "var(--muted)", overflow: "hidden" }}>
															<div style={{ width: `${pdProg}%`, height: "100%", background: "var(--foreground)", transition: "width 0.4s ease" }} />
														</div>
														{!isTravelResolved(app.travelAssistanceStatus) && (
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
														<span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", fontWeight: 600, color: progress === 100 ? "var(--foreground)" : "var(--muted-foreground)" }}>
															{progress}%
														</span>
													</div>
													<div style={{ width: "100%", height: "4px", background: "var(--muted)", overflow: "hidden" }}>
														<div style={{
															width: `${progress}%`,
															height: "100%",
															background: "var(--foreground)",
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
				{apps.length} case{apps.length === 1 ? "" : "s"} on the board
			</p>
		</div>
	);
}
