import { useState } from "react";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { DocPreviewInline, type DocPreviewData } from "./DocPreviewInline";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import type { MockApplicant, VisaStage, PaymentPlanId, PreDepartureTask } from "century-nit-core/ops";
import { fmtFin } from "./currency";

export function EnterpriseApplicants() {
	const { opsRole, opsUser, canSeeAllBranches, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { applicants, error: casesError } = useCases();
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedApplicant, setSelectedApplicant] = useState<MockApplicant | null>(null);
	const [dossierTab, setDossierTab] = useState<"overview" | "timeline" | "documents" | "financials" | "visa" | "messages" | "audit">("overview");
	const [previewingDoc, setPreviewingDoc] = useState<DocPreviewData | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");

	const canSeeAll = canSeeAllBranches;

	const roleScopedApplicants = scopeRecords(
		applicants,
		(a) => a.assignedOfficerEmail === opsUser?.email || a.assignedOfficer === opsUser?.name,
	);

	const filteredApplicants = roleScopedApplicants.filter((a) => {
		if (branchFilter !== "all" && a.branch !== branchFilter) return false;
		const matchesSearch =
			a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.applicantId.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.university.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.assignedOfficer.toLowerCase().includes(searchQuery.toLowerCase());
		if (!matchesSearch) return false;
		if (statusFilter === "All") return true;
		if (statusFilter === "Pre-application") return a.currentStage === "pre_application";
		if (statusFilter === "Pre-Visa") return ["document_verification", "school_submission", "offer_letter_review"].includes(a.currentStage);
		if (statusFilter === "Visa Processing") return a.currentStage === "visa_processing";
		if (statusFilter === "Post-Visa") return ["payment_execution", "travel_assistance"].includes(a.currentStage);
		if (statusFilter === "Completed") return a.currentStage === "completed";
		return a.currentStage === statusFilter;
	});

	function openDossier(applicant: MockApplicant) {
		setSelectedApplicant(applicant);
		setDossierTab("overview");
	}

	return (
		<div className="page-content fade-in" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem" }}>
				<div>
					<h1 className="page-title">Applicants</h1>
					<p className="lead mt-1">Confirmed client records, active dossiers, and journey tracking.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<span className="portal-pill" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
						⚙ System Workflow Pipeline Records
					</span>
					{canSeeAll && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
				</div>
			</div>
			{casesError ? <p className="ops-modal__error" role="alert">{casesError}</p> : null}

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
					<span style={{ fontSize: "1rem" }}>{canSeeAll ? "◱" : "◎"}</span>
					<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						{canSeeAll
							? `All ${roleScopedApplicants.length} applicants · ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: requiresAssignmentScope
								? `${roleScopedApplicants.length} assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch · ${roleScopedApplicants.length} applicants`}
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
							{["All", "Pre-application", "Pre-Visa", "Visa Processing", "Post-Visa", "Completed"].map((tab) => (
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
							placeholder="Search ID, name, university..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="input input--sm"
							style={{ width: "100%" }}
						/>
					</div>

					<div style={{ flex: 1, overflowY: "auto" }}>
						{filteredApplicants.length === 0 ? (
							<div style={{ padding: "3rem 1.5rem", textAlign: "center" }} className="muted">
								No applicants match your filter.
							</div>
						) : (
							filteredApplicants.map((applicant) => {
								const isSelected = selectedApplicant?.id === applicant.id;
								return (
									<div
										key={applicant.id}
										onClick={() => openDossier(applicant)}
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
														{applicant.applicantId}
													</span>
													<span className="portal-pill" style={{
														fontSize: "var(--text-xs)",
														padding: "0.15rem 0.4rem",
														background: isSelected ? "var(--background)" : undefined,
														color: isSelected ? "var(--foreground)" : undefined,
														border: isSelected ? "none" : undefined,
													}}>
														{applicant.status}
													</span>
												</div>
												<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{applicant.name}</p>
												<p style={{ fontSize: "var(--text-xs)", opacity: 0.65, marginTop: "0.15rem" }}>
													{applicant.university} · {applicant.country}
												</p>
												<p style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
													{applicant.stageNumber > 0
														? `Stage ${applicant.stageNumber}/${applicant.totalStages}: ${applicant.currentStage}`
														: "Pre-application"}
												</p>
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
					border: "1px solid var(--border)",
					background: "var(--background)",
				}}>
					{!selectedApplicant ? (
						<div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
							<span style={{ fontSize: "2.5rem", opacity: 0.15, marginBottom: "1rem" }}>◎</span>
							<p className="muted" style={{ fontSize: "var(--text-sm)", textAlign: "center" }}>
								Select an applicant from the list to view their full dossier.
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
											{selectedApplicant.applicantId}
										</span>
										<span className="portal-pill" style={{ background: "var(--background)", color: "var(--foreground)", border: "none", fontSize: "var(--text-xs)" }}>
											{selectedApplicant.status}
										</span>
									</div>
									<h2 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", color: "var(--background)", margin: 0 }}>
										{selectedApplicant.name}
									</h2>
									<p style={{ opacity: 0.75, fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>
										{selectedApplicant.university} · {selectedApplicant.program} ({selectedApplicant.country})
									</p>
								</div>
								<button
									type="button"
									onClick={() => setSelectedApplicant(null)}
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

							{/* Detail Tabs */}
							<div style={{ display: "flex", borderBottom: "1px solid var(--border-light)", background: "var(--muted)", overflowX: "auto", flexShrink: 0 }}>
								{[
									["overview", "Overview"],
									["timeline", "Timeline"],
									["documents", "Documents"],
									["financials", "Payments"],
									["visa", "Visa & Travel"],
									["messages", "Messages"],
									["audit", "Audit Log"],
								].map(([key, label]) => (
									<button
										key={key}
										onClick={() => setDossierTab(key as typeof dossierTab)}
										style={{
											padding: "0.7rem 1rem",
											fontFamily: "var(--font-mono)",
											fontSize: "var(--text-xs)",
											textTransform: "uppercase",
											whiteSpace: "nowrap",
											borderBottom: dossierTab === key ? "2px solid var(--foreground)" : "2px solid transparent",
											fontWeight: dossierTab === key ? 600 : 400,
											background: "none",
											border: "none",
											borderBottomWidth: "2px",
											borderBottomStyle: "solid",
											cursor: "pointer",
											color: "var(--foreground)",
										}}
									>
										{label}
									</button>
								))}
							</div>

							{/* Detail Content */}
							<div style={{ flex: 1, overflowY: "auto", padding: "1.25rem" }}>
								{dossierTab === "overview" && (
									<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
										<div className="card">
											<p className="eyebrow mb-2">Academic Path & Target</p>
											<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target Institution</p><p>{selectedApplicant.university}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Program</p><p>{selectedApplicant.program}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Target Country</p><p>{selectedApplicant.country}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Intake Period</p><p>{selectedApplicant.enrolledDate}</p></div>
											</div>
										</div>
										<div className="card">
											<p className="eyebrow mb-2">Service Package & Assignment</p>
											<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "var(--text-sm)" }}>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Selected Service Package</p><p>{selectedApplicant.package}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Assigned Officer</p><p>{selectedApplicant.assignedOfficer}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Branch Office</p><p>{branchName(selectedApplicant.branch)}</p></div>
												<div><p className="muted" style={{ fontSize: "var(--text-xs)" }}>Contact Email</p><p>{selectedApplicant.email}</p></div>
											</div>
										</div>
									</div>
								)}

								{dossierTab === "timeline" && (
									<div className="card">
										<p className="eyebrow mb-3">Complete Applicant Stage Journey</p>
										<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
											{selectedApplicant.timeline.map((t, idx) => (
												<li key={idx} style={{
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center",
													padding: "0.75rem 0",
													borderBottom: idx < selectedApplicant.timeline.length - 1 ? "1px solid var(--border-light)" : "none",
												}}>
													<div>
														<p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{t.stage}</p>
														<p className="muted" style={{ fontSize: "var(--text-xs)" }}>{t.date}</p>
													</div>
													<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{t.status}</span>
												</li>
											))}
										</ul>
									</div>
								)}

								{dossierTab === "documents" && (
								previewingDoc ? (
									<DocPreviewInline
									doc={previewingDoc}
									isMine={selectedApplicant.assignedOfficerEmail === opsUser?.email}
									applicantName={selectedApplicant.name}
									reference={selectedApplicant.id}
									onBack={() => setPreviewingDoc(null)}
								/>
								) : (
									<div className="card">
										<p className="eyebrow mb-3">Verified Document Repository</p>
										<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
											{selectedApplicant.documents.map((doc, idx) => {
												const docKey = `applicant:${selectedApplicant.id}:${doc.name}`;
												const isLive = Boolean(selectedApplicant.isLive);
												const status = doc.status;
												const settled = status === "Verified" || status === "Rejected";
												return (
													<li key={idx} style={{ padding: "0.75rem 0.5rem", borderBottom: idx < selectedApplicant.documents.length - 1 ? "1px solid var(--border-light)" : "none" }}>
														<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
															<button
																type="button"
																onClick={() => setPreviewingDoc({ name: doc.name, category: doc.category, status, isLive, docKey })}
																style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0 }}
															>
																<span style={{ fontFamily: "var(--font-mono)", fontSize: "1.1rem" }}>≡</span>
																<div style={{ minWidth: 0 }}>
																	<p style={{ fontWeight: 500, fontSize: "var(--text-sm)", textDecoration: "underline", textUnderlineOffset: "3px" }}>{doc.name}</p>
																	<p className="muted" style={{ fontSize: "var(--text-xs)" }}>Category: {doc.category} · Click to inspect →</p>
																</div>
															</button>
															<span className="portal-pill" style={{ fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{status}</span>
														</div>
													{!settled && selectedApplicant.assignedOfficerEmail === opsUser?.email && (
														<div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem", paddingLeft: "1.875rem" }}>
															<a href="/documents" className="btn btn--sm" style={{ padding: "0.25rem 0.6rem", fontSize: "0.72rem" }}>Review queue</a>
														</div>
													)}
													{!settled && selectedApplicant.assignedOfficerEmail !== opsUser?.email && (
														<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem", paddingLeft: "1.875rem" }}>
															Read-only - only the assigned officer can verify documents.
														</p>
													)}
													</li>
												);
											})}
										</ul>
									</div>
								)
							)}

								{dossierTab === "financials" && (
									<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
										<div className="card" style={{ background: "var(--foreground)", color: "var(--background)" }}>
											<p className="eyebrow" style={{ color: "var(--muted)" }}>Financial Balance</p>
											<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginTop: "0.75rem" }}>
												<div>
													<p className="muted" style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Total Fee</p>
													<p style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "#fff" }}>{fmtFin(selectedApplicant.financials.totalAmount)}</p>
												</div>
												<div>
													<p className="muted" style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Paid Amount</p>
													<p style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "#fff" }}>{fmtFin(selectedApplicant.financials.paidAmount)}</p>
												</div>
												<div>
													<p className="muted" style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Balance Due</p>
													<p style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "#fff" }}>{fmtFin(selectedApplicant.financials.outstanding)}</p>
												</div>
											</div>
										</div>
										<div className="card">
											<p className="eyebrow mb-2">Payment Plan Structure</p>
											<p style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{selectedApplicant.financials.plan}</p>
										</div>
									</div>
								)}

								{dossierTab === "visa" && (
									<VisaTravelTab applicant={selectedApplicant} />
								)}

								{dossierTab === "messages" && (
									<div className="card">
										<p className="eyebrow mb-3">Communication Log</p>
										<div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
											{selectedApplicant.messages.map((m, idx) => (
												<div key={idx} style={{ padding: "0.75rem", background: "var(--muted)", border: "1px solid var(--border-light)" }}>
													<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
														<span style={{ fontWeight: 600, fontSize: "var(--text-xs)" }}>{m.sender}</span>
														<span className="muted" style={{ fontSize: "var(--text-xs)" }}>{m.time}</span>
													</div>
													<p style={{ fontSize: "var(--text-sm)" }}>{m.text}</p>
												</div>
											))}
										</div>
									</div>
								)}

								{dossierTab === "audit" && (
									<div className="card">
										<p className="eyebrow mb-3">System Audit Trail</p>
										<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
											{selectedApplicant.auditLog.map((log, idx) => (
												<li key={idx} style={{
													display: "flex",
													justifyContent: "space-between",
													padding: "0.65rem 0",
													borderBottom: idx < selectedApplicant.auditLog.length - 1 ? "1px solid var(--border-light)" : "none",
													fontSize: "var(--text-xs)",
												}}>
													<div>
														<p style={{ fontWeight: 500 }}>{log.action}</p>
														<p className="muted">User: {log.user}</p>
													</div>
													<span className="muted" style={{ fontFamily: "var(--font-mono)" }}>{log.timestamp}</span>
												</li>
											))}
										</ul>
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

const VISA_STEPS: { id: VisaStage; label: string }[] = [
	{ id: "pending", label: "Case opened" },
	{ id: "biometrics", label: "Biometrics" },
	{ id: "decision", label: "Decision" },
	{ id: "complete", label: "Complete" },
];

const VISA_ORDER: VisaStage[] = ["locked", "pending", "biometrics", "decision", "complete"];

const AGENCY_MILESTONES = [
	{ label: "Agency deposit", portion: "30%" },
	{ label: "Agency balance", portion: "70%" },
	{ label: "Clearance", portion: "100%" },
];

const PD_CATEGORIES: Record<PreDepartureTask["category"], { icon: string; label: string }> = {
	travel: { icon: "\u2708", label: "Travel" },
	accommodation: { icon: "\u2302", label: "Accommodation" },
	documents: { icon: "\u2702", label: "Documents" },
	health: { icon: "\u271a", label: "Health" },
	finance: { icon: "\u20b5", label: "Finance" },
	orientation: { icon: "\u2605", label: "Orientation" },
};

function visaStepLabel(stage?: VisaStage): string {
	if (!stage || stage === "locked") return "Awaiting payment";
	const step = VISA_STEPS.find((s) => s.id === stage);
	return step ? step.label : stage;
}

function paymentPlanLabel(plan?: PaymentPlanId): string {
	if (plan === "full") return "Full payment";
	if (plan === "installments") return "Installment plan";
	return "Not selected";
}

function VisaTravelTab({ applicant }: { applicant: MockApplicant }) {
	const hasVisaData = applicant.visaStage || applicant.visaInvoicePaid !== undefined;
	const hasTravelData = applicant.paymentPlanId || applicant.agencyStageIndex !== undefined || applicant.preDepartureTasks || applicant.travelClearance;

	if (!hasVisaData && !hasTravelData) {
		return (
			<div className="card" style={{ textAlign: "center", padding: "2rem" }}>
				<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
					Visa and travel data will appear here once the applicant reaches the visa processing stage.
				</p>
			</div>
		);
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
			{/* Visa Tracking */}
			<div className="card">
				<p className="eyebrow mb-3">Visa Tracking</p>
				{applicant.visaStage ? (
					<>
						<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
							{VISA_STEPS.map((s, i) => {
								const curIdx = applicant.visaStage ? VISA_ORDER.indexOf(applicant.visaStage) : -1;
								const stepIdx = VISA_ORDER.indexOf(s.id);
								const done = curIdx >= stepIdx && applicant.visaStage !== "locked";
								const current = applicant.visaStage === s.id;
								return (
									<div
										key={s.id}
										style={{
											display: "flex",
											alignItems: "center",
											gap: "0.75rem",
											padding: "0.6rem 0.75rem",
											border: "1px solid var(--border-light)",
											background: current ? "var(--muted)" : "transparent",
											opacity: done ? 1 : 0.5,
										}}
									>
										<span
											style={{
												width: "28px",
												height: "28px",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												borderRadius: "50%",
												fontSize: "var(--text-xs)",
												fontWeight: 600,
												background: done ? "var(--foreground)" : "transparent",
												color: done ? "var(--background)" : "var(--foreground)",
												border: done ? "none" : "1px solid var(--border-light)",
												flexShrink: 0,
											}}
										>
											{done ? "\u2713" : i + 1}
										</span>
										<div style={{ flex: 1 }}>
											<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.label}</p>
										</div>
										{current && (
											<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>Current</span>
										)}
									</div>
								);
							})}
						</div>
						<div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
							<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>
								Stage: {visaStepLabel(applicant.visaStage)}
							</span>
							<span className={`portal-pill ${applicant.visaInvoicePaid ? "" : ""}`} style={{ fontSize: "var(--text-xs)", background: applicant.visaInvoicePaid ? "#dcfce7" : "#fef3c7", borderColor: applicant.visaInvoicePaid ? "#86efac" : "#fcd34d" }}>
								Invoice: {applicant.visaInvoicePaid ? "Paid" : "Unpaid"}
							</span>
						</div>
						{applicant.visaCounselorNote && (
							<div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "var(--muted)", border: "1px solid var(--border-light)" }}>
								<p className="eyebrow" style={{ fontSize: "var(--text-xs)", marginBottom: "0.3rem" }}>Counselor Note</p>
								<p style={{ fontSize: "var(--text-sm)" }}>{applicant.visaCounselorNote}</p>
							</div>
						)}
					</>
				) : (
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>Visa processing has not started.</p>
				)}
			</div>

			{/* Payment Plan */}
			{applicant.paymentPlanId !== undefined && (
				<div className="card">
					<p className="eyebrow mb-2">Payment Plan</p>
					<p style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{paymentPlanLabel(applicant.paymentPlanId)}</p>
				</div>
			)}

			{/* Agency Milestones */}
			{applicant.agencyStageIndex !== undefined && (
				<div className="card">
					<p className="eyebrow mb-3">Agency Settlement Milestones</p>
					<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
						{AGENCY_MILESTONES.map((m, i) => {
							const done = applicant.agencySettled || (applicant.agencyStageIndex ?? 0) > i;
							const current = (applicant.agencyStageIndex ?? 0) === i && !applicant.agencySettled;
							return (
								<div
									key={i}
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										padding: "0.6rem 0.75rem",
										border: "1px solid var(--border-light)",
										background: current ? "var(--muted)" : "transparent",
										opacity: done ? 1 : 0.5,
									}}
								>
									<div>
										<p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{m.label}</p>
										<p className="muted" style={{ fontSize: "var(--text-xs)" }}>{m.portion} of agency fee</p>
									</div>
									<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>
										{done ? "\u2713 Done" : current ? "In progress" : "Pending"}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Travel Clearance */}
			{applicant.travelClearance && (
				<div className="card" style={{
					background: applicant.travelClearance === "cleared" ? "#dcfce7" : "#fef3c7",
					borderColor: applicant.travelClearance === "cleared" ? "#86efac" : "#fcd34d",
				}}>
					<p className="eyebrow" style={{ marginBottom: "0.3rem" }}>Travel Clearance</p>
					<p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: applicant.travelClearance === "cleared" ? "#166534" : "#92400e" }}>
						{applicant.travelClearance === "cleared" ? "Cleared for travel" : "Pending clearance"}
					</p>
				</div>
			)}

			{/* Pre-Departure Checklist */}
			{applicant.preDepartureTasks && applicant.preDepartureTasks.length > 0 && (
				<div className="card">
					<p className="eyebrow mb-3">Pre-Departure Checklist</p>
					<div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
						{applicant.preDepartureTasks.map((task) => {
							const cat = PD_CATEGORIES[task.category];
							return (
								<div
									key={task.id}
									style={{
										display: "flex",
										alignItems: "flex-start",
										gap: "0.75rem",
										padding: "0.6rem 0.75rem",
										border: "1px solid var(--border-light)",
										opacity: task.done ? 0.6 : 1,
									}}
								>
									<span style={{ fontSize: "1rem", flexShrink: 0, width: "24px", textAlign: "center" }}>{cat?.icon ?? "\u2022"}</span>
									<div style={{ flex: 1, minWidth: 0 }}>
										<p style={{
											fontWeight: 500,
											fontSize: "var(--text-sm)",
											textDecoration: task.done ? "line-through" : "none",
										}}>
											{task.label}
										</p>
										<p className="muted" style={{ fontSize: "var(--text-xs)" }}>{task.detail}</p>
									</div>
									<span className="portal-pill" style={{
										fontSize: "var(--text-xs)",
										background: task.done ? "#dcfce7" : "var(--muted)",
										borderColor: task.done ? "#86efac" : "var(--border-light)",
										whiteSpace: "nowrap",
									}}>
										{task.done ? "\u2713 Done" : "Pending"}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
