import { useMemo, useState } from "react";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import type { MockApplication, VisaStage } from "century-nit-core/ops";
import { JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";

const VISA_STEPS: { id: VisaStage; label: string }[] = [
	{ id: "pending", label: "Case opened" },
	{ id: "biometrics", label: "Biometrics" },
	{ id: "decision", label: "Decision" },
	{ id: "complete", label: "Complete" },
];

const VISA_ORDER: VisaStage[] = ["locked", "pending", "biometrics", "decision", "complete"];

function visaStepLabel(stage?: VisaStage): string {
	if (!stage || stage === "locked") return "Awaiting payment";
	const step = VISA_STEPS.find((s) => s.id === stage);
	return step ? step.label : stage;
}

export function EnterpriseVisa() {
	const { opsRole, opsUser, canSeeAllBranches, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const {
		applications,
		setVisaStage,
		setVisaInvoicePaid,
		setVisaCounselorNote,
	} = useCases();
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");
	const [noteDraft, setNoteDraft] = useState("");
	const [editingNote, setEditingNote] = useState(false);

	const canSeeAll = canSeeAllBranches;

	const visaApps = useMemo(() => {
		const scoped = scopeRecords(
			applications,
			(a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name,
		);
		const filtered = branchFilter === "all" ? scoped : scoped.filter((a) => a.branch === branchFilter);
		return filtered.filter(
			(a) =>
				a.stage === "visa_processing" ||
				a.stage === "payment_execution" ||
				a.stage === "travel_assistance" ||
				a.stage === "completed",
		);
	}, [applications, scopeRecords, opsUser, branchFilter]);

	const filteredApps = visaApps.filter((a) => {
		const matchesSearch =
			a.applicantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.appId.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.university.toLowerCase().includes(searchQuery.toLowerCase());
		if (!matchesSearch) return false;
		if (statusFilter === "All") return true;
		if (statusFilter === "Unpaid") return !a.visaInvoicePaid;
		if (statusFilter === "In Progress") return a.visaStage !== "complete" && a.visaStage !== "locked";
		if (statusFilter === "Complete") return a.visaStage === "complete";
		return true;
	});

	const liveSelected = selectedApp
		? applications.find((a) => a.appId === selectedApp.appId) ?? selectedApp
		: null;

	function openDetail(app: MockApplication) {
		setSelectedApp(app);
		setNoteDraft("");
		setEditingNote(false);
	}

	function advanceVisa(app: MockApplication) {
		const cur = app.visaStage ?? "locked";
		const idx = VISA_ORDER.indexOf(cur);
		const next = VISA_ORDER[idx + 1];
		if (next) setVisaStage(app.appId, next);
	}

	function saveNote() {
		if (selectedApp && noteDraft.trim()) {
			setVisaCounselorNote(selectedApp.appId, noteDraft.trim());
			setEditingNote(false);
			setNoteDraft("");
		}
	}

	const active = liveSelected ?? selectedApp;

	return (
		<div className="page-content fade-in" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
				<div>
					<h1 className="page-title">Visa Processing</h1>
					<p className="lead mt-1">Track visa sub-steps, manage invoices, and advance cases to payment execution.</p>
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
							? `All ${visaApps.length} visa cases \u00b7 ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: requiresAssignmentScope
								? `${visaApps.length} assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch \u00b7 ${visaApps.length} visa cases`}
					</p>
				</div>
				<span className="portal-pill" style={canSeeAll ? { background: "var(--background)", color: "var(--foreground)", border: "none" } : undefined}>
					{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
				</span>
			</div>

			{/* Split Pane Layout */}
			<div className="ops-split" style={{ display: "flex", flex: 1, gap: "1rem", minHeight: "var(--ops-pane-min)" }}>
				{/* LEFT: List Pane */}
				<div className="ops-split__list" style={{ flex: "0 0 40%", minWidth: "360px", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border-light)" }}>
					<div style={{ padding: "0.75rem", borderBottom: "1px solid var(--border-light)", background: "var(--muted)", flexShrink: 0 }}>
						<div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
							{["All", "Unpaid", "In Progress", "Complete"].map((tab) => (
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
								No visa cases match your filter.
							</div>
						) : (
							filteredApps.map((app) => {
								const isSelected = selectedApp?.appId === app.appId;
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
											borderLeft: isSelected ? "4px solid #06b6d4" : "4px solid transparent",
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
														{visaStepLabel(app.visaStage)}
													</span>
												</div>
												<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{app.applicantName}</p>
												<p style={{ fontSize: "var(--text-xs)", opacity: 0.65, marginTop: "0.15rem" }}>
													{app.university} {"\u00b7"} {app.program}
												</p>
												<div style={{ display: "flex", gap: "0.75rem", fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>
													<span>{app.visaInvoicePaid ? "Invoice paid" : "Invoice unpaid"}</span>
													<span>{"\u00b7"}</span>
													<span>{app.assignedStaff || "Unassigned"}</span>
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
					border: "1px solid var(--border)",
					background: "var(--background)",
				}}>
					{!active ? (
						<div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
							<span style={{ fontSize: "2.5rem", opacity: 0.15, marginBottom: "1rem" }}>{"\u2708"}</span>
							<p className="muted" style={{ fontSize: "var(--text-sm)", textAlign: "center" }}>
								Select a case from the list to view visa tracking and take action.
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
								{/* Visa Invoice */}
								<div className="card" style={{ background: "var(--muted)" }}>
									<p className="eyebrow mb-1">Visa Invoice</p>
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap", gap: "0.75rem" }}>
										<div>
											<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
												{active.visaInvoicePaid ? "Invoice paid" : "Invoice unpaid"}
											</p>
											<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
												{active.visaInvoicePaid
													? "Visa processing can proceed."
													: "Applicant must pay the visa invoice before processing begins."}
											</p>
										</div>
										{!active.visaInvoicePaid && (
											<button
												onClick={() => setVisaInvoicePaid(active.appId)}
												className="btn btn--primary"
												style={{ whiteSpace: "nowrap" }}
											>
												{"\u2713"} Mark paid
											</button>
										)}
									</div>
								</div>

								{/* Visa Tracking Steps */}
								<div className="card">
									<p className="eyebrow mb-3">Visa Tracking</p>
									<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
										{VISA_STEPS.map((s, i) => {
											const curIdx = active.visaStage ? VISA_ORDER.indexOf(active.visaStage) : -1;
											const stepIdx = VISA_ORDER.indexOf(s.id);
											const done = curIdx >= stepIdx && active.visaStage !== "locked";
											const current = active.visaStage === s.id;
											return (
												<div
													key={s.id}
													style={{
														display: "flex",
														alignItems: "center",
														gap: "0.75rem",
														padding: "0.6rem 0.75rem",
														border: "1px solid var(--border-light)",
														opacity: done ? 1 : 0.5,
													}}
												>
													<span style={{
														width: "28px",
														height: "28px",
														flexShrink: 0,
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														fontSize: "0.72rem",
														fontWeight: 700,
														fontFamily: "var(--font-mono)",
														border: "2px solid",
														borderColor: done ? "#22c55e" : current ? "#06b6d4" : "var(--border)",
														borderRadius: "50%",
														color: done ? "#fff" : current ? "#06b6d4" : "var(--muted-foreground)",
														background: done ? "#22c55e" : "transparent",
													}}>
														{done ? "\u2713" : i + 1}
													</span>
													<div style={{ flex: 1 }}>
														<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.label}</p>
													</div>
													{current && active.visaStage !== "complete" && (
														<button
															onClick={() => advanceVisa(active)}
															className="btn btn--ghost btn--sm"
															style={{ fontSize: "var(--text-xs)", padding: "0.2rem 0.6rem" }}
														>
															{"\u2192"} {VISA_STEPS[i + 1]?.label ?? "next"}
														</button>
													)}
												</div>
											);
										})}
									</div>
								</div>

								{/* Counselor Note */}
								<div className="card">
									<p className="eyebrow mb-2">Counselor Note</p>
									{active.visaCounselorNote && !editingNote ? (
										<div>
											<p style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{active.visaCounselorNote}</p>
											<button
												onClick={() => { setEditingNote(true); setNoteDraft(active.visaCounselorNote ?? ""); }}
												className="btn btn--ghost btn--sm"
												style={{ marginTop: "0.5rem", fontSize: "var(--text-xs)" }}
											>
												Edit note
											</button>
										</div>
									) : (
										<div>
											<textarea
												value={noteDraft}
												onChange={(e) => setNoteDraft(e.target.value)}
												placeholder="Add a counselor note..."
												rows={3}
												className="input"
												style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
											/>
											<div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
												<button
													onClick={saveNote}
													className="btn btn--primary btn--sm"
													disabled={!noteDraft.trim()}
												>
													Save note
												</button>
												{editingNote && (
													<button
														onClick={() => { setEditingNote(false); setNoteDraft(""); }}
														className="btn btn--ghost btn--sm"
													>
														Cancel
													</button>
												)}
											</div>
										</div>
									)}
								</div>

						{active.visaStage === "complete" && active.stage === "visa_processing" && (
							<div className="card" style={{ background: "#dcfce7", borderColor: "#86efac" }}>
								<p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "#166534" }}>Visa approved</p>
								<p style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem", color: "#166534" }}>
									Use the Workflow board to advance this case to Payment Execution.
								</p>
							</div>
						)}

							{/* Case Meta */}
								<div className="card">
									<p className="eyebrow mb-2">Case Info</p>
									<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Institution</p><p>{active.university}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Program</p><p>{active.program}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Assigned Staff</p><p>{active.assignedStaff}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Branch</p><p>{branchName(active.branch)}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Funding Track</p><p>{active.fundingTrack}</p></div>
										<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Submitted Date</p><p>{active.submittedDate}</p></div>
									</div>
								</div>

								{/* Staff Notes */}
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
