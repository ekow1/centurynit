import { useEffect, useMemo, useRef, useState } from "react";
import { CaseDetail } from "./CaseDetail";
import { CaseScaffold } from "./case/CaseScaffold";
import { VisaStagePill } from "century-nit-core/ui";
import { useSearchParams } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import type { MockApplication, Invoice } from "century-nit-core/ops";
import { invoiceBalance } from "century-nit-core/ops";
import { fmtBoth } from "./currency";

function visaInvoiceFor(invoices: Invoice[], app: MockApplication): Invoice | undefined {
	return invoices.find(
		(i) => i.type === "Visa" && i.applicationId != null && i.applicationId === app.id,
	);
}

export function EnterpriseVisa() {
	const { opsRole, opsUser, canSeeAllBranches, scopeRecords, requiresAssignmentScope } = useOpsAuth();
	const { applications } = useCases();
	const { invoices: allInvoices } = useInvoiceApi();
	const [statusFilter, setStatusFilter] = useState<string>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedApp, setSelectedApp] = useState<MockApplication | null>(null);
	const [branchFilter, setBranchFilter] = useState("all");

	const canSeeAll = canSeeAllBranches;

	const visaApps = useMemo(() => {
		// "Mine" is the visa specialist (stage assignment) or the case owner.
		const scoped = scopeRecords(
			applications,
			(a) =>
				a.assignedStaffEmail === opsUser?.email ||
				a.assignedStaff === opsUser?.name ||
				(a.stageHandlers ?? []).some((h) => h.stage === "visa_processing" && h.opsUserEmail === opsUser?.email),
		);
		const filtered = branchFilter === "all" ? scoped : scoped.filter((a) => a.branch === branchFilter);
		return filtered.filter(
			(a) =>
				(a.visaStage && a.visaStage !== "locked") ||
				visaInvoiceFor(allInvoices, a) !== undefined ||
				a.stage === "visa_processing" ||
				a.stage === "payment_execution" ||
				a.stage === "travel_assistance" ||
				a.stage === "completed",
		);
	}, [applications, scopeRecords, opsUser, branchFilter, allInvoices]);

	const filteredApps = visaApps.filter((a) => {
		const matchesSearch =
			a.applicantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.appId.toLowerCase().includes(searchQuery.toLowerCase()) ||
			a.university.toLowerCase().includes(searchQuery.toLowerCase());
		if (!matchesSearch) return false;
		if (statusFilter === "All") return true;
		if (statusFilter === "Unpaid") {
			const inv = visaInvoiceFor(allInvoices, a);
			return a.visaStage === "locked" || !!inv && invoiceBalance(inv) > 0;
		}
		if (statusFilter === "In Progress") return a.visaStage !== "complete" && a.visaStage !== "locked";
		if (statusFilter === "Complete") return a.visaStage === "complete";
		return true;
	});

	const liveSelected = selectedApp
		? applications.find((a) => a.appId === selectedApp.appId) ?? selectedApp
		: null;

	const [searchParams, setSearchParams] = useSearchParams();
	const idParam = searchParams.get("id");
	const openedRef = useRef<string | null>(null);
	useEffect(() => {
		if (!idParam || openedRef.current === idParam) return;
		const match = applications.find((a) => a.id === idParam) ?? visaApps.find((a) => a.id === idParam);
		if (match) {
			openedRef.current = idParam;
			setSelectedApp(match);
		}
	}, [idParam, applications, visaApps]);

	function openDetail(app: MockApplication) {
		setSelectedApp(app);
	}

	const active = liveSelected ?? selectedApp;

	return (
		<div className="page-content fade-in">
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

			<CaseScaffold
				onClose={() => {
					setSelectedApp(null);
					setSearchParams({}, { replace: true });
				}}
				emptyHint="Select a visa case from the list to review it and take action."
				list={
					<>
						<div className="cn-scaffold__filters">
							<div className="cn-scaffold__chips">
								{["All", "Unpaid", "In Progress", "Complete"].map((tab) => (
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
								<div className="cn-scaffold__none">No visa cases match your filter.</div>
							) : (
								filteredApps.map((app) => {
									const isSelected = selectedApp?.appId === app.appId;
									const invoice = visaInvoiceFor(allInvoices, app);
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
													<VisaStagePill stage={app.visaStage ?? "locked"} />
												</div>
												<p className="cn-row__name">{app.applicantName}</p>
												<p className="cn-row__sub">
													{app.university} · {app.program}
												</p>
												<div className="cn-row__meta">
													{invoice
														? invoice.status === "void"
															? "Invoice void"
															: invoice.status === "paid"
																? "Invoice paid"
																: invoiceBalance(invoice) > 0
																	? `${invoice.invoiceNumber} · ${fmtBoth(invoiceBalance(invoice))} due`
																	: "Invoice settled"
														: app.visaInvoicePaid
															? "Invoice paid"
															: "No visa invoice"}
													<span> · {app.assignedStaff || "Unassigned"}</span>
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
				detail={active ? <CaseDetail app={active} initialTab="visa" /> : null}
			/>
		</div>
	);
}
