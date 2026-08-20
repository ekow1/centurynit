import { useEffect, useMemo, useState } from "react";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import type { MockApplication, VisaStage, PreDepartureTask } from "century-nit-core/ops";
import { listSchoolsForApplicant, updateSchoolStatus } from "../lib/api";
import type { SchoolApplication } from "century-nit-shared";
import { JOURNEY_STAGES, JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";

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

const VISA_STEPS: { id: VisaStage; label: string; detail: string }[] = [
	{ id: "pending", label: "Case opened", detail: "Visa file opened after invoice payment" },
	{ id: "biometrics", label: "Biometrics / appointment", detail: "Applicant attended biometrics" },
	{ id: "decision", label: "Authority decision", detail: "Awaiting visa decision" },
	{ id: "complete", label: "Visa complete", detail: "Visa approved, ready for next stage" },
];

const VISA_STEP_ORDER: VisaStage[] = ["locked", "pending", "biometrics", "decision", "complete"];

const AGENCY_STAGES = [
	{ id: "agency_deposit", label: "Agency deposit", detail: "Secure agency file & coordinator", portion: "30%" },
	{ id: "agency_balance", label: "Agency balance", detail: "Remaining service fees before travel", portion: "50%" },
	{ id: "agency_clearance", label: "Travel clearance", detail: "Final clearance for departure", portion: "20%" },
];

const PRE_DEPARTURE_CATEGORIES: Record<string, { label: string; icon: string }> = {
	travel: { label: "Travel", icon: "\u2708" },
	accommodation: { label: "Accommodation", icon: "\u2302" },
	documents: { label: "Documents", icon: "\u2261" },
	health: { label: "Health & Insurance", icon: "\u271a" },
	finance: { label: "Finance", icon: "\u00a4" },
	orientation: { label: "Orientation", icon: "\u25cb" },
};

/**
 * Per-school application statuses. These match the server's
 * `schoolTrackStatusSchema` enum — the dropdown writes back through
 * `PATCH /api/v1/schools/:id/status`, so the values must be ones the API
 * accepts (the simplified labels in the spec are mapped onto these).
 */
const SCHOOL_STATUSES = [
	"Draft",
	"Preparing Application",
	"Documents under review",
	"Submitted to University",
	"Conditional Offer Received",
	"Unconditional Offer",
	"Offer Accepted",
	"Offer Declined",
	"Application Rejected",
	"Waitlisted",
	"Withdrawn",
] as const;

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
	const [dragging, setDragging] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState<JourneyStage | null>(null);
	const [ownerFilter, setOwnerFilter] = useState<"all" | "mine">("all");
	const [branchFilter, setBranchFilter] = useState("all");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);

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

	function move(appId: string, to: JourneyStage) {
		setApplicationStage(appId, to);
	}

	function advance(app: MockApplication) {
		const idx = JOURNEY_STAGES.indexOf(normaliseStage(app.stage));
		const next = JOURNEY_STAGES[idx + 1];
		if (next) move(app.appId, next);
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

			{/* Stage progress bar */}
			<div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", alignItems: "center", overflowX: "auto", paddingBottom: "0.5rem" }}>
				{JOURNEY_STAGES.map((stage, i) => {
					const count = columns.get(stage)?.length ?? 0;
					const color = STAGE_COLORS[stage];
					return (
						<div key={stage} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: "1 0 auto" }}>
							<div style={{
								display: "flex",
								alignItems: "center",
								gap: "0.35rem",
								padding: "0.4rem 0.7rem",
								background: "var(--card)",
								border: "1px solid var(--border-light)",
								borderRadius: "4px",
								flex: 1,
							}}>
								<span style={{
									fontSize: "0.7rem",
									fontWeight: 700,
									fontFamily: "var(--font-mono)",
									color,
								}}>
									{STAGE_NUMBERS[stage]}
								</span>
								<span className="muted" style={{ fontSize: "0.68rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
									{JOURNEY_STAGE_LABELS[stage]}
								</span>
								<span style={{ marginLeft: "auto", fontSize: "0.68rem", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{count}</span>
							</div>
							{i < JOURNEY_STAGES.length - 1 && (
								<span className="muted" style={{ fontSize: "0.6rem", flexShrink: 0 }}>→</span>
							)}
						</div>
					);
				})}
			</div>

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
								if (dragging) move(dragging, stage);
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
										return (
											<div
												key={app.id}
												draggable={canMoveCase(app)}
												onDragStart={() => canMoveCase(app) && setDragging(app.appId)}
												onDragEnd={() => {
													setDragging(null);
													setDragOver(null);
												}}
												onClick={() => setSelectedApp(app)}
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
													<span style={{ opacity: 0.5 }}>Officer:</span>
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
													className="btn btn--ghost btn--sm"
													style={{ padding: "0.15rem 0.5rem", fontSize: "0.72rem", marginTop: "0.5rem", width: "100%" }}
													title="Advance to next stage"
												>
													{"\u2192"} {JOURNEY_STAGE_LABELS[JOURNEY_STAGES[JOURNEY_STAGES.indexOf(normaliseStage(app.stage)) + 1]]}
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

			{/* Case detail drawer */}
			{selectedApp && (
				<CaseDetailDrawer app={selectedApp} onClose={() => setSelectedApp(null)} />
			)}
		</div>
	);
}

/* ─── Case Detail Drawer ─── */

function CaseDetailDrawer({ app, onClose }: { app: MockApplication; onClose: () => void }) {
	const stage = normaliseStage(app.stage);
	const color = STAGE_COLORS[stage];
	const visaCur = app.visaStage ? VISA_STEP_ORDER.indexOf(app.visaStage) : -1;
	const pdProg = preDepartureProgress(app.preDepartureTasks);
	const pdCats = Object.keys(PRE_DEPARTURE_CATEGORIES);

	const [schools, setSchools] = useState<SchoolApplication[]>([]);
	const [schoolsLoading, setSchoolsLoading] = useState(false);
	const [schoolError, setSchoolError] = useState<string | null>(null);
	const [savingSchoolId, setSavingSchoolId] = useState<string | null>(null);

	useEffect(() => {
		if (!app.applicantId) { setSchools([]); return; }
		let cancelled = false;
		setSchoolsLoading(true);
		setSchoolError(null);
		listSchoolsForApplicant(app.applicantId)
			.then((res) => { if (!cancelled) setSchools(res.schools); })
			.catch((err: unknown) => {
				if (!cancelled) {
					setSchools([]);
					setSchoolError(err instanceof Error ? err.message : "Could not load school applications");
				}
			})
			.finally(() => { if (!cancelled) setSchoolsLoading(false); });
		return () => { cancelled = true; };
	}, [app.applicantId]);

	async function handleStatusChange(school: SchoolApplication, status: string) {
		setSavingSchoolId(school.id);
		try {
			const updated = await updateSchoolStatus(school.id, { status });
			setSchools((prev) => prev.map((s) => (s.id === school.id ? updated : s)));
		} catch (err: unknown) {
			setSchoolError(err instanceof Error ? err.message : "Could not update school status");
		} finally {
			setSavingSchoolId(null);
		}
	}

	return (
		<>
			<div className="wf-drawer-overlay" onClick={onClose} />
			<aside className="wf-drawer">
				{/* Header */}
				<div className="wf-drawer__header" style={{ borderBottomColor: color }}>
				<div style={{ flex: 1 }}>
					<p className="eyebrow" style={{ color }}>
						Stage {STAGE_NUMBERS[stage]} {"\u00b7"} {JOURNEY_STAGE_LABELS[stage]}
					</p>
						<h2 className="page-title" style={{ fontSize: "1.2rem", marginTop: "0.3rem" }}>
							{app.applicantName}
						</h2>
						<p className="muted mono" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
							{app.appId} {"\u00b7"} {app.university} {"\u00b7"} {app.program}
						</p>
					</div>
					<button type="button" onClick={onClose} className="wf-drawer__close" aria-label="Close">
						{"\u00d7"}
					</button>
				</div>

				<div className="wf-drawer__body">
					{/* Applicant info */}
					<div className="wf-info-grid">
						<div>
							<p className="wf-info-label">Country</p>
							<p className="wf-info-value">{app.country}</p>
						</div>
						<div>
							<p className="wf-info-label">Degree</p>
							<p className="wf-info-value">{app.degreeLevel}</p>
						</div>
						<div>
							<p className="wf-info-label">Funding</p>
							<p className="wf-info-value">{app.fundingTrack}</p>
						</div>
						<div>
							<p className="wf-info-label">Officer</p>
							<p className="wf-info-value">{app.assignedStaff || "Unassigned"}</p>
						</div>
					</div>

					{/* School applications — per-school offer decisions */}
					<div className="wf-section">
						<h3 className="wf-section__title">School Applications</h3>
						{schoolError && (
							<p className="ops-modal__error" role="alert" style={{ marginBottom: "0.75rem" }}>{schoolError}</p>
						)}
						{schoolsLoading ? (
							<p className="muted" style={{ fontSize: "0.82rem" }}>Loading school applications…</p>
						) : schools.length === 0 ? (
							<p className="muted" style={{ fontSize: "0.82rem" }}>
								No school applications recorded for this applicant yet.
							</p>
						) : (
							<ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
								{schools.map((school) => (
									<li
										key={school.id}
										style={{
											padding: "0.6rem 0.75rem",
											border: "1px solid var(--border-light)",
											background: "var(--card)",
										}}
									>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
											<div style={{ minWidth: 0 }}>
												<p style={{ fontWeight: 600, fontSize: "0.82rem" }}>
													{school.universityId}
												</p>
												<p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.15rem" }}>
													{school.programId} · Intake {school.intake}
												</p>
											</div>
											<label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
												<span className="muted" style={{ fontSize: "0.68rem", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
													Status
												</span>
												<select
													value={school.status}
													disabled={savingSchoolId === school.id}
													onChange={(e) => void handleStatusChange(school, e.target.value)}
													className="input input--sm"
													style={{ fontSize: "0.78rem", padding: "0.25rem 0.4rem" }}
												>
													{SCHOOL_STATUSES.map((s) => (
														<option key={s} value={s}>{s}</option>
													))}
												</select>
											</label>
										</div>
										{school.handlerNote && (
											<p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.4rem" }}>
												Note: {school.handlerNote}
											</p>
										)}
									</li>
								))}
							</ul>
						)}
					</div>

					{/* Stage-specific content */}
					{stage === "visa_processing" && (
						<div className="wf-section">
							<h3 className="wf-section__title">Visa Tracking</h3>

							<div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
								<span className={`wf-badge ${app.visaInvoicePaid ? "wf-badge--ok" : "wf-badge--warn"}`}>
									{app.visaInvoicePaid ? "Invoice paid" : "Invoice unpaid"}
								</span>
								{app.visaStage && app.visaStage !== "locked" && (
									<span className="wf-badge" style={{ background: "var(--foreground)", color: "var(--background)" }}>
										{app.visaStage}
									</span>
								)}
							</div>

							{app.visaCounselorNote && (
								<div className="wf-note">
									<p className="wf-info-label">Counselor note</p>
									<p className="wf-info-value" style={{ marginTop: "0.3rem" }}>{app.visaCounselorNote}</p>
								</div>
							)}

							<ol className="wf-track">
								{VISA_STEPS.map((s, i) => {
									const idx = VISA_STEP_ORDER.indexOf(s.id);
									const done = visaCur >= idx && app.visaStage !== "locked";
									const current = app.visaStage === s.id;
									return (
										<li key={s.id} className={`wf-track__item${done ? " wf-track__item--done" : ""}${current ? " wf-track__item--current" : ""}`}>
											<span className="wf-track__dot">{done ? "\u2713" : i + 1}</span>
											<div>
												<strong>{s.label}</strong>
												<p className="muted" style={{ fontSize: "0.78rem" }}>{s.detail}</p>
											</div>
										</li>
									);
								})}
							</ol>
						</div>
					)}

					{stage === "payment_execution" && (
						<div className="wf-section">
							<h3 className="wf-section__title">Payment Execution</h3>
							<div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
								<div className={`wf-plan-card ${app.paymentPlanId === "full" ? "wf-plan-card--selected" : ""}`}>
									<p className="wf-info-label">Full Payment</p>
									<p className="wf-info-value" style={{ fontSize: "0.82rem", marginTop: "0.3rem" }}>
										Pay remaining fees in one transaction. Discount eligible.
									</p>
									{app.paymentPlanId === "full" && <span className="wf-badge wf-badge--ok">Selected</span>}
								</div>
								<div className={`wf-plan-card ${app.paymentPlanId === "installments" ? "wf-plan-card--selected" : ""}`}>
									<p className="wf-info-label">Installments</p>
									<p className="wf-info-value" style={{ fontSize: "0.82rem", marginTop: "0.3rem" }}>
										Split into 2-3 payments. Agency settlement follows.
									</p>
									{app.paymentPlanId === "installments" && <span className="wf-badge wf-badge--ok">Selected</span>}
								</div>
							</div>
							{!app.paymentPlanId && (
								<p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.75rem" }}>
									Applicant has not selected a payment plan yet.
								</p>
							)}
						</div>
					)}

					{stage === "travel_assistance" && (
						<div className="wf-section">
							<h3 className="wf-section__title">Travel & Pre-departure</h3>

							{/* Agency settlement milestones */}
							<div style={{ marginBottom: "1.25rem" }}>
								<p className="wf-info-label" style={{ marginBottom: "0.5rem" }}>Agency Settlement</p>
								<div className="wf-milestones">
									{AGENCY_STAGES.map((s, i) => {
										const completed = app.agencySettled || (app.agencyStageIndex ?? 0) > i;
										const current = !app.agencySettled && (app.agencyStageIndex ?? 0) === i;
										return (
											<div key={s.id} className={`wf-milestone${completed ? " wf-milestone--done" : ""}${current ? " wf-milestone--current" : ""}`}>
												<span className="wf-milestone__dot">{completed ? "\u2713" : i + 1}</span>
												<div>
													<strong style={{ fontSize: "0.82rem" }}>{s.label}</strong>
													<p className="muted" style={{ fontSize: "0.75rem" }}>{s.detail} {"\u00b7"} {s.portion}</p>
												</div>
											</div>
										);
									})}
								</div>
								{app.agencySettled && (
									<span className="wf-badge wf-badge--ok" style={{ marginTop: "0.5rem" }}>Settlement complete</span>
								)}
							</div>

							{/* Travel clearance */}
							<div style={{ marginBottom: "1.25rem" }}>
								<span className={`wf-badge ${app.travelClearance === "cleared" ? "wf-badge--ok" : "wf-badge--warn"}`}>
									{app.travelClearance === "cleared" ? "Travel cleared" : "Travel pending"}
								</span>
							</div>

							{/* Pre-departure checklist */}
							<div>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
									<p className="wf-info-label">Pre-departure Checklist</p>
									<span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", fontWeight: 600, color: pdProg === 100 ? "#22c55e" : "var(--muted-foreground)" }}>
										{pdProg}%
									</span>
								</div>
								<div style={{ height: "6px", background: "var(--muted)", borderRadius: "999px", overflow: "hidden", marginBottom: "1rem" }}>
									<div style={{ width: `${pdProg}%`, height: "100%", background: pdProg === 100 ? "#22c55e" : "#f97316", transition: "width 0.4s ease" }} />
								</div>

								{app.preDepartureTasks && app.preDepartureTasks.length > 0 ? (
									<div className="wf-pd-grid">
										{pdCats.map((cat) => {
											const tasks = app.preDepartureTasks!.filter((t) => t.category === cat);
											if (tasks.length === 0) return null;
											const catDone = tasks.filter((t) => t.done).length;
											return (
												<div key={cat} className="wf-pd-card">
													<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
														<span className="wf-pd-icon">{PRE_DEPARTURE_CATEGORIES[cat].icon}</span>
														<div>
															<p style={{ fontWeight: 600, fontSize: "0.82rem" }}>{PRE_DEPARTURE_CATEGORIES[cat].label}</p>
															<p className="muted" style={{ fontSize: "0.7rem" }}>{catDone}/{tasks.length} complete</p>
														</div>
													</div>
													<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
														{tasks.map((task) => (
															<li key={task.id} className="wf-pd-task">
																<span className={`wf-pd-check${task.done ? " wf-pd-check--done" : ""}`}>
																	{task.done ? "\u2713" : ""}
																</span>
																<div>
																	<p style={{ fontWeight: task.done ? 400 : 500, fontSize: "0.78rem", textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.6 : 1 }}>
																		{task.label}
																	</p>
																	<p className="muted" style={{ fontSize: "0.72rem" }}>{task.detail}</p>
																</div>
															</li>
														))}
													</ul>
												</div>
											);
										})}
									</div>
								) : (
									<p className="muted" style={{ fontSize: "0.82rem" }}>No pre-departure tasks assigned yet.</p>
								)}
							</div>
						</div>
					)}

					{stage === "completed" && (
						<div className="wf-section">
							<div className="alert alert--success" style={{ marginBottom: "1rem" }}>
								<strong>Case completed.</strong> Student has travelled and all stages are settled.
							</div>
							<div className="wf-info-grid">
								<div>
									<p className="wf-info-label">Visa outcome</p>
									<p className="wf-info-value">{app.visaStage === "complete" ? "Approved" : "N/A"}</p>
								</div>
								<div>
									<p className="wf-info-label">Payment plan</p>
									<p className="wf-info-value">{app.paymentPlanId === "full" ? "Full payment" : app.paymentPlanId === "installments" ? "Installments" : "N/A"}</p>
								</div>
								<div>
									<p className="wf-info-label">Agency</p>
									<p className="wf-info-value">{app.agencySettled ? "Settled" : "N/A"}</p>
								</div>
								<div>
									<p className="wf-info-label">Travel</p>
									<p className="wf-info-value">{app.travelClearance === "cleared" ? "Cleared" : "N/A"}</p>
								</div>
							</div>
						</div>
					)}

					{/* Notes */}
					{app.notes && (
						<div className="wf-section">
							<h3 className="wf-section__title">Case Notes</h3>
							<p style={{ fontSize: "0.85rem", lineHeight: 1.5 }}>{app.notes}</p>
						</div>
					)}
				</div>
			</aside>
		</>
	);
}
