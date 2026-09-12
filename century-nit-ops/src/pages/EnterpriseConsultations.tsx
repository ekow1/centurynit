import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { CaseScaffold } from "./case/CaseScaffold";
import { ConsultationDetail } from "./case/ConsultationDetail";
import { StatusPill } from "century-nit-core/ui";
import { Toast } from "./OpsDialogs";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import type { MockConsultation } from "century-nit-core/ops";
import { StaffChatBadge } from "./StaffChatBadge";

/** Placeholder values shouldn't be joined into a meta line as bare em-dashes */
function isKnown(v: string | undefined | null): v is string {
	const s = (v ?? "").trim();
	return s !== "" && s !== "-" && s !== "-";
}

export function EnterpriseConsultations() {
	const [searchParams] = useSearchParams();
	const { opsRole, opsUser, canSeeAllBranches, canAssignWork, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { consultations, assignees, error: casesError } = useCases();
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedConsultation, setSelectedConsultation] = useState<MockConsultation | null>(null);

	const queryId = searchParams.get("id");
	useEffect(() => {
		if (queryId) {
			const match = consultations.find((c) => c.id === queryId);
			if (match) setSelectedConsultation(match);
		}
	}, [queryId, consultations]);
	const [branchFilter, setBranchFilter] = useState("all");
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const showToast = (type: "error" | "success", message: string) => setToast({ type, message });
	/* Date, slot and reason now live inside ReschedulePanel */

	const canSeeAll = canSeeAllBranches;
	const reviewCount = consultations.filter((c) => c.status === "Under Review").length;

	const roleScopedConsultations = useMemo(
		() =>
			scopeRecords(
				consultations,
				(c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
			),
		[scopeRecords, consultations, opsUser],
	);

	const filteredConsultations = roleScopedConsultations.filter((c) => {
		if (branchFilter !== "all" && c.branch !== branchFilter) return false;
		const matchesSearch =
			c.applicantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			c.ref.toLowerCase().includes(searchQuery.toLowerCase()) ||
			c.targetCountry.toLowerCase().includes(searchQuery.toLowerCase()) ||
			c.assignedOfficer.toLowerCase().includes(searchQuery.toLowerCase());
		if (!matchesSearch) return false;
		if (statusFilter === "All") return true;
		if (statusFilter === "Unassigned") return !c.assignedOfficer;
		return c.status === statusFilter;
	});

	const liveSelected = selectedConsultation
		? consultations.find((c) => c.id === selectedConsultation.id) ?? selectedConsultation
		: null;


	const opsUserIdByEmail = (email: string) => assignees.find((c) => c.email === email)?.opsUserId;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem" }}>
				<div>
					<h1 className="page-title">Consultations</h1>
					<p className="lead mt-1">
						Bookings arrive from the client portal. {canAssignWork ? "Assign to a consultant to begin the assessment." : "You see the ones assigned to you."}
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{reviewCount > 0 && canAssignWork && (
						<span className="portal-pill" style={{ background: "#fef3c7", color: "#92400e", whiteSpace: "nowrap" }}>
							{reviewCount} awaiting assignment
						</span>
					)}
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
						{/* Manager sees every branch; the coordinator is scoped to their
						    own branch; the consultant to their assignments. */}
						{canSeeAll
							? `All ${roleScopedConsultations.length} consultations · ${opsRole ? ROLE_LABELS[opsRole] : "Staff"} scope`
							: requiresAssignmentScope
								? `${roleScopedConsultations.length} assigned to you`
								: `${branchName(opsUser?.branch ?? "")} branch · ${roleScopedConsultations.length} consultations`}
					</p>
				</div>
				<span className="portal-pill" style={canSeeAll ? { background: "var(--background)", color: "var(--foreground)", border: "none" } : undefined}>
					{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
				</span>
			</div>

			<CaseScaffold
				onClose={() => setSelectedConsultation(null)}
				emptyHint="Select a consultation from the list to view the full assessment workflow."
				list={
					<>
						<div className="cn-scaffold__filters">
							<div className="cn-scaffold__chips">
								{(canAssignWork
									? ["All", "Under Review", "Assigned", "Confirmed", "In Assessment", "Completed", "Cancelled"]
									: ["All", "Assigned", "Confirmed", "In Assessment", "Completed", "Cancelled"]
								).map((tab) => (
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
								placeholder="Search applicant, ref, country..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="input input--sm"
							/>
						</div>
						<div className="cn-scaffold__rows">
							{filteredConsultations.length === 0 ? (
								<div className="cn-scaffold__none">No consultations match your filter.</div>
							) : (
								filteredConsultations.map((c) => {
									const isSelected = selectedConsultation?.id === c.id;
									const requested = c.requestedDocuments?.length ?? 0;
									return (
										<div
											key={c.id}
											role="button"
											tabIndex={0}
											onClick={() => setSelectedConsultation(c)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") setSelectedConsultation(c);
											}}
											className={`cn-row${isSelected ? " cn-row--selected" : ""}`}
										>
											<div className="cn-row__main">
												<div className="cn-row__top">
													<span className="cn-row__ref">{c.ref}</span>
													<StatusPill tone={c.status === "Completed" ? "done" : c.status === "Cancelled" ? "void" : c.status === "Under Review" ? "waiting" : "current"}>
														{c.status}
													</StatusPill>
												</div>
												<p className="cn-row__name">{c.applicantName}</p>
												<p className="cn-row__sub">{[c.dateTime, c.targetCountry, c.type].filter(isKnown).join(" · ")}</p>
												<div className="cn-row__meta">
													{c.assignedOfficer ? (
														<StaffChatBadge opsUserId={opsUserIdByEmail(c.assignedOfficerEmail)} name={c.assignedOfficer} email={c.assignedOfficerEmail} />
													) : (
														<span>Unassigned</span>
													)}
													{c.coordinatorName && (
														<span>
															{" · "}Coord: <StaffChatBadge opsUserId={c.coordinatorEmail} name={c.coordinatorName} email={c.coordinatorEmail} />
														</span>
													)}
													{requested > 0 && <span> · {requested} document{requested === 1 ? "" : "s"} requested</span>}
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
				detail={
					liveSelected ? (
						<ConsultationDetail consultation={liveSelected} onToast={showToast} onClosed={() => setSelectedConsultation(null)} />
					) : null
				}
			/>
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
