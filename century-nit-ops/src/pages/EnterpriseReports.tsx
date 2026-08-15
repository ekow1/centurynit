import { useMemo, useState } from "react";
import { useOpsAuth } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import { branchName } from "century-nit-core/ops";
import { LEAD_STAGE_LABELS, LEAD_STAGE_ORDER } from "century-nit-core";
import { fmtBoth, fmtGhs, fmtUsd, money } from "./currency";

function downloadCSV(filename: string, rows: string[][]) {
	const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
	const blob = new Blob([csv], { type: "text/csv" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function BarRow({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0;
	return (
		<div style={{ marginBottom: "0.75rem" }}>
			<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
				<span style={{ fontSize: "var(--text-sm)" }}>{label}</span>
				<span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
					{value}{suffix ?? ""}
				</span>
			</div>
			<div style={{ width: "100%", height: "8px", background: "var(--muted)", border: "1px solid var(--border-light)" }}>
				<div style={{ width: `${pct}%`, height: "100%", background: "var(--foreground)", transition: "width 0.6s ease" }} />
			</div>
		</div>
	);
}

function KPICard({ label, value, note, inverted }: { label: string; value: string; note: string; inverted?: boolean }) {
	return (
		<div className="card" style={inverted ? { background: "var(--foreground)", color: "var(--background)" } : undefined}>
			<p className="eyebrow" style={inverted ? { color: "var(--muted-foreground)" } : undefined}>{label}</p>
			<p className="page-title mt-1" style={inverted ? { color: "var(--background)" } : undefined}>{value}</p>
			<p className="muted mt-2" style={inverted ? { color: "var(--muted-foreground)" } : undefined}>{note}</p>
		</div>
	);
}

export function EnterpriseReports() {
	const { opsUser, scopeRecords } = useOpsAuth();
	const { consultations, applications, applicants, leads, packages, invoices } = useOpsState();
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [branchFilter, setBranchFilter] = useState("all");

	const role = opsUser?.role ?? "manager";
	const isManager = role === "manager";
	const isFinance = role === "finance";
	const isConsultant = role === "consultant";
	const isCoordinator = role === "coordinator";
	const showFinancial = isManager || isFinance;
	const showOperational = isManager || isConsultant || isCoordinator;
	const showTeam = isManager;
	const me = opsUser?.name ?? "";

	const scopedConsultations = useMemo(
		() => scopeRecords(consultations, (c) => c.assignedOfficer === me),
		[scopeRecords, consultations, me],
	);
	const scopedApplications = useMemo(
		() => scopeRecords(applications, (a) => a.assignedStaff === me),
		[scopeRecords, applications, me],
	);
	const scopedApplicants = useMemo(
		() => scopeRecords(applicants, (a) => a.assignedOfficer === me),
		[scopeRecords, applicants, me],
	);
	const scopedLeads = useMemo(
		() => scopeRecords(leads, (l) => l.assignedTo === me),
		[scopeRecords, leads, me],
	);
	const myConsultations = scopedConsultations;
	const myApplications = scopedApplications;
	const myApplicants = scopedApplicants;

	const branches = useMemo(() => {
		const set = new Set<string>();
		applicants.forEach((a) => set.add(a.branch));
		consultations.forEach((c) => set.add(c.branch));
		applications.forEach((a) => set.add(a.branch));
		return [...set].sort();
	}, [applicants, consultations, applications]);

	const filteredApplicants = useMemo(
		() =>
			(showFinancial ? applicants : myApplicants).filter(
				(a) => branchFilter === "all" || a.branch === branchFilter,
			),
		[applicants, myApplicants, showFinancial, branchFilter],
	);

	const financial = useMemo(() => {
		const pool = showFinancial ? applicants : myApplicants;
		const billed = pool.reduce((n, a) => n + money(a.financials.totalAmount), 0);
		const collected = pool.reduce((n, a) => n + money(a.financials.paidAmount), 0);
		const outstanding = pool.reduce((n, a) => n + money(a.financials.outstanding), 0);
		const collectionRate = billed > 0 ? Math.round((collected / billed) * 100) : 0;
		const avgAccount = pool.length > 0 ? Math.round(billed / pool.length) : 0;
		return { billed, collected, outstanding, collectionRate, avgAccount };
	}, [applicants, myApplicants, showFinancial]);

	const revenueByPackage = useMemo(() => {
		const pool = showFinancial ? applicants : myApplicants;
		const map = new Map<string, { count: number; revenue: number }>();
		for (const a of pool) {
			const entry = map.get(a.package) ?? { count: 0, revenue: 0 };
			entry.count += 1;
			entry.revenue += money(a.financials.totalAmount);
			map.set(a.package, entry);
		}
		return [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
	}, [applicants, myApplicants, showFinancial]);

	const consultationStats = useMemo(() => {
		const pool = myConsultations;
		const byStatus = new Map<string, number>();
		for (const c of pool) {
			byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
		}
		const completed = byStatus.get("Completed") ?? 0;
		const total = pool.length;
		const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
		return { byStatus, completed, total, completionRate };
	}, [myConsultations]);

	const applicationStats = useMemo(() => {
		const pool = myApplications;
		const byStage = new Map<string, number>();
		for (const a of pool) {
			byStage.set(a.stage, (byStage.get(a.stage) ?? 0) + 1);
		}
		const accepted = pool.filter((a) => a.status === "Accepted").length;
		const acceptanceRate = pool.length > 0 ? Math.round((accepted / pool.length) * 100) : 0;
		return { byStage, accepted, acceptanceRate, total: pool.length };
	}, [myApplications]);

	const leadFunnel = useMemo(() => {
		const byStage = (stage: string) => scopedLeads.filter((l) => l.stage === stage).length;
		const total = scopedLeads.length;
		const converted = byStage("converted");
		const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;
		return {
			stages: LEAD_STAGE_ORDER.map((s) => ({ label: LEAD_STAGE_LABELS[s], count: byStage(s) })),
			total,
			converted,
			conversionRate,
		};
	}, [scopedLeads]);

	const teamPerformance = useMemo(() => {
		const map = new Map<string, { consultations: number; completedConsults: number; applications: number; acceptedApps: number }>();
		for (const c of consultations) {
			if (!c.assignedOfficer) continue;
			const entry = map.get(c.assignedOfficer) ?? { consultations: 0, completedConsults: 0, applications: 0, acceptedApps: 0 };
			entry.consultations += 1;
			if (c.status === "Completed") entry.completedConsults += 1;
			map.set(c.assignedOfficer, entry);
		}
		for (const a of applications) {
			if (!a.assignedStaff) continue;
			const entry = map.get(a.assignedStaff) ?? { consultations: 0, completedConsults: 0, applications: 0, acceptedApps: 0 };
			entry.applications += 1;
			if (a.status === "Accepted") entry.acceptedApps += 1;
			map.set(a.assignedStaff, entry);
		}
		return [...map.entries()].sort((a, b) => b[1].consultations + b[1].applications - a[1].consultations - a[1].applications);
	}, [consultations, applications]);

	const invoiceStats = useMemo(() => {
		const total = invoices.length;
		const paid = invoices.filter((i) => i.status === "paid").length;
		const outstanding = invoices.filter((i) => i.status === "issued" || i.status === "overdue").length;
		const totalAmount = invoices.reduce((n, i) => n + i.subtotal, 0);
		return { total, paid, outstanding, totalAmount };
	}, [invoices]);

	const revenueByType = useMemo(() => {
		const map = new Map<string, { count: number; billed: number; collected: number; outstanding: number }>();
		for (const inv of invoices) {
			const entry = map.get(inv.type) ?? { count: 0, billed: 0, collected: 0, outstanding: 0 };
			entry.count += 1;
			entry.billed += inv.subtotal;
			if (inv.status === "paid") entry.collected += inv.subtotal;
			else entry.outstanding += inv.subtotal;
			map.set(inv.type, entry);
		}
		return [...map.entries()].sort((a, b) => b[1].billed - a[1].billed);
	}, [invoices]);

	const revenueByLineItem = useMemo(() => {
		const map = new Map<string, { count: number; amount: number; types: Set<string> }>();
		for (const inv of invoices) {
			for (const line of inv.lines) {
				const entry = map.get(line.label) ?? { count: 0, amount: 0, types: new Set<string>() };
				entry.count += 1;
				entry.amount += line.amount;
				entry.types.add(inv.type);
				map.set(line.label, entry);
			}
		}
		return [...map.entries()]
			.map(([label, d]) => ({ label, count: d.count, amount: d.amount, types: [...d.types] }))
			.sort((a, b) => b.amount - a.amount);
	}, [invoices]);

	const docStats = useMemo(() => {
		const pool = myApplicants;
		const allDocs = pool.flatMap((a) => a.documents);
		const verified = allDocs.filter((d) => d.status === "Verified").length;
		const pending = allDocs.filter((d) => d.status === "Pending Review").length;
		const rejected = allDocs.filter((d) => d.status === "Rejected").length;
		const total = allDocs.length;
		const rate = total > 0 ? Math.round((verified / total) * 100) : 0;
		return { verified, pending, rejected, total, rate };
	}, [myApplicants]);

	const maxPkgRevenue = Math.max(1, ...revenueByPackage.map(([, v]) => v.revenue));
	const maxFunnel = Math.max(1, ...leadFunnel.stages.map((s) => s.count));

	const subtitle = isFinance
		? "Financial health, revenue, and invoice analytics."
		: isConsultant
			? "Your consultation and application performance."
			: isCoordinator
				? "Pipeline flow, lead conversion, and processing metrics."
				: "Cross-platform performance, financial health, and pipeline conversion.";

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem", gap: "1rem", flexWrap: "wrap" }}>
				<div>
					<h1 className="page-title">Analytics Reports</h1>
					<p className="lead mt-2">{subtitle}</p>
				</div>
				{showFinancial && (
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
						<input type="date" className="input input--sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From" />
						<span className="muted" style={{ fontSize: "var(--text-xs)" }}>to</span>
						<input type="date" className="input input--sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To" />
						<select className="input input--sm" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
							<option value="all">All Branches</option>
							{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}
						</select>
						<button
							className="btn btn--ghost btn--sm"
							onClick={() => {
								const rows: string[][] = [["Metric", "Value (GHS)", "Value (USD)"]];
								rows.push(["Total Billed", fmtGhs(financial.billed), fmtUsd(financial.billed)]);
								rows.push(["Collected", fmtGhs(financial.collected), fmtUsd(financial.collected)]);
								rows.push(["Outstanding", fmtGhs(financial.outstanding), fmtUsd(financial.outstanding)]);
								rows.push(["Collection Rate", `${financial.collectionRate}%`, ""]);
								rows.push(["Invoices Issued", String(invoiceStats.total), ""]);
								rows.push(["Invoices Paid", String(invoiceStats.paid), ""]);
								rows.push([]);
								rows.push(["--- Revenue by Invoice Type ---", "", ""]);
								rows.push(["Type", "Invoices", "Billed (GHS)"]);
								for (const [type, d] of revenueByType) {
									rows.push([type, String(d.count), fmtGhs(d.billed)]);
								}
								rows.push([]);
								rows.push(["--- Top Earning Services ---", "", ""]);
								rows.push(["Line Item", "Occurrences", "Revenue (GHS)"]);
								for (const item of revenueByLineItem) {
									rows.push([item.label, String(item.count), fmtGhs(item.amount)]);
								}
								downloadCSV("financial-report.csv", rows);
							}}
						>
							Export CSV
						</button>
					</div>
				)}
			</div>

			{/* ─── Financial Reports (finance + manager) ─── */}
			{showFinancial && (<>
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", marginBottom: "2.5rem" }}>
					<KPICard label="Total Billed" value={fmtGhs(financial.billed)} note={`${filteredApplicants.length} accounts · ≈ ${fmtUsd(financial.billed)}`} inverted />
					<KPICard label="Collected" value={fmtGhs(financial.collected)} note={`${financial.collectionRate}% collection rate · ≈ ${fmtUsd(financial.collected)}`} />
					<KPICard label="Outstanding" value={fmtGhs(financial.outstanding)} note={`Awaiting payment · ≈ ${fmtUsd(financial.outstanding)}`} />
					<KPICard label="Avg. Account" value={fmtGhs(financial.avgAccount)} note={`Per active applicant · ≈ ${fmtUsd(financial.avgAccount)}`} />
				</div>

				{/* Revenue by Package */}
				<div className="card" style={{ marginBottom: "2rem" }}>
					<h2 className="section-title mb-3">Revenue by Service Package</h2>
					{revenueByPackage.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No package revenue data yet.</p>
					) : (
						<>
							{revenueByPackage.map(([pkg, data]) => (
								<BarRow key={pkg} label={pkg} value={data.revenue} max={maxPkgRevenue} suffix={` · ${data.count} account${data.count !== 1 ? "s" : ""}`} />
							))}
						</>
					)}
				</div>

				{/* Invoice Summary */}
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }}>
					<KPICard label="Invoices Issued" value={String(invoiceStats.total)} note={`${fmtBoth(invoiceStats.totalAmount)} total billed`} />
					<KPICard label="Paid Invoices" value={String(invoiceStats.paid)} note="Settled accounts" />
					<KPICard label="Outstanding Invoices" value={String(invoiceStats.outstanding)} note="Awaiting payment" />
				</div>

				{/* Revenue by Invoice Type */}
				<div className="card" style={{ marginBottom: "2rem" }}>
					<h2 className="section-title mb-3">Revenue by Invoice Type</h2>
					{revenueByType.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No invoice data yet.</p>
					) : (
						<div className="ops-table-wrap">
							<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "var(--text-sm)" }}>
								<thead>
									<tr style={{ borderBottom: "2px solid var(--border)" }}>
										<th style={{ padding: "0.75rem" }}>Type</th>
										<th style={{ padding: "0.75rem" }}>Invoices</th>
										<th style={{ padding: "0.75rem" }}>Billed</th>
										<th style={{ padding: "0.75rem" }}>Collected</th>
										<th style={{ padding: "0.75rem" }}>Outstanding</th>
										<th style={{ padding: "0.75rem" }}>Rate</th>
									</tr>
								</thead>
								<tbody>
									{revenueByType.map(([type, d]) => {
										const rate = d.billed > 0 ? Math.round((d.collected / d.billed) * 100) : 0;
										return (
											<tr key={type} style={{ borderBottom: "1px solid var(--border-light)" }}>
												<td style={{ padding: "0.75rem", fontWeight: 500 }}>
													<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{type}</span>
												</td>
												<td style={{ padding: "0.75rem" }}>{d.count}</td>
												<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{fmtBoth(d.billed)}</td>
												<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{fmtBoth(d.collected)}</td>
												<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-xs)" }}>{fmtBoth(d.outstanding)}</td>
												<td style={{ padding: "0.75rem" }}><span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{rate}%</span></td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>

				{/* Top Earning Services */}
				<div className="card" style={{ marginBottom: "2rem" }}>
					<h2 className="section-title mb-3">Top Earning Services</h2>
					{revenueByLineItem.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No line item data yet.</p>
					) : (
						<>
							{revenueByLineItem.slice(0, 8).map((item) => {
								const maxAmt = revenueByLineItem[0]?.amount ?? 1;
								return (
									<BarRow
										key={item.label}
										label={`${item.label} · ${item.types.join(", ")}`}
										value={item.amount}
										max={maxAmt}
										suffix={` · ${item.count}x`}
									/>
								);
							})}
						</>
					)}
				</div>

				{/* Branch Financial Performance */}
				<div className="card" style={{ marginBottom: "2rem" }}>
					<h2 className="section-title mb-3">Branch Financial Performance</h2>
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "var(--text-sm)" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "0.75rem" }}>Branch</th>
									<th style={{ padding: "0.75rem" }}>Accounts</th>
									<th style={{ padding: "0.75rem" }}>Billed</th>
									<th style={{ padding: "0.75rem" }}>Collected</th>
									<th style={{ padding: "0.75rem" }}>Outstanding</th>
									<th style={{ padding: "0.75rem" }}>Rate</th>
								</tr>
							</thead>
							<tbody>
							{branches.map((b) => {
								const bApps = scopedApplicants.filter((a) => a.branch === b);
								const bBilled = bApps.reduce((n, a) => n + money(a.financials.totalAmount), 0);
								const bCollected = bApps.reduce((n, a) => n + money(a.financials.paidAmount), 0);
								const bOutstanding = bApps.reduce((n, a) => n + money(a.financials.outstanding), 0);
								const bRate = bBilled > 0 ? Math.round((bCollected / bBilled) * 100) : 0;
								return (
									<tr key={b} style={{ borderBottom: "1px solid var(--border-light)" }}>
										<td style={{ padding: "0.75rem", fontWeight: 500 }}>{branchName(b)}</td>
											<td style={{ padding: "0.75rem" }}>{bApps.length}</td>
											<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{fmtBoth(bBilled)}</td>
											<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{fmtBoth(bCollected)}</td>
											<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-xs)" }}>{fmtBoth(bOutstanding)}</td>
											<td style={{ padding: "0.75rem" }}><span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{bRate}%</span></td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			</>)}

			{/* ─── Operational Reports (consultant, coordinator, manager) ─── */}
			{showOperational && (<>
				{/* KPI row */}
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem", marginBottom: "2.5rem" }}>
					<KPICard label={isConsultant ? "My Consultations" : "Consultations"} value={String(consultationStats.total)} note={`${consultationStats.completionRate}% completion`} inverted />
					<KPICard label={isConsultant ? "My Applications" : "Applications"} value={String(applicationStats.total)} note={`${applicationStats.acceptanceRate}% acceptance`} />
					<KPICard label="Consultation Completion" value={`${consultationStats.completionRate}%`} note={`${consultationStats.completed}/${consultationStats.total} completed`} />
					<KPICard label="Application Acceptance" value={`${applicationStats.acceptanceRate}%`} note={`${applicationStats.accepted}/${applicationStats.total} accepted`} />
					{(isManager || isCoordinator) && (
						<KPICard label="Lead Conversion" value={`${leadFunnel.conversionRate}%`} note={`${leadFunnel.converted}/${leadFunnel.total} converted`} />
					)}
				</div>

				<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
					{/* Consultation Pipeline */}
					<div className="card">
						<h2 className="section-title mb-3">{isConsultant ? "My Consultation Pipeline" : "Consultation Pipeline"}</h2>
						{[...consultationStats.byStatus.entries()].length === 0 ? (
							<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No consultations yet.</p>
						) : (
							[...consultationStats.byStatus.entries()].map(([status, count]) => (
								<BarRow key={status} label={status} value={count} max={consultationStats.total} />
							))
						)}
					</div>

					{/* Application Pipeline */}
					<div className="card">
						<h2 className="section-title mb-3">{isConsultant ? "My Application Pipeline" : "Application Pipeline"}</h2>
						{[...applicationStats.byStage.entries()].length === 0 ? (
							<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No applications yet.</p>
						) : (
							[...applicationStats.byStage.entries()].map(([stage, count]) => (
								<BarRow key={stage} label={stage} value={count} max={applicationStats.total} />
							))
						)}
					</div>
				</div>

				{/* Lead Conversion Funnel (coordinator + manager) */}
				{(isManager || isCoordinator) && (
					<div className="card" style={{ marginBottom: "2rem" }}>
						<h2 className="section-title mb-3">Lead Conversion Funnel</h2>
						{leadFunnel.total === 0 ? (
							<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No leads yet.</p>
						) : (
							leadFunnel.stages.map((s) => (
								<BarRow key={s.label} label={s.label} value={s.count} max={maxFunnel} />
							))
						)}
					</div>
				)}

				{/* Processing Time + Document Verification */}
				<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
					<div className="card">
						<h2 className="section-title mb-3">Processing Time Metrics</h2>
						<div className="ops-table-wrap">
							<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "var(--text-sm)" }}>
								<thead>
									<tr style={{ borderBottom: "2px solid var(--border)" }}>
										<th style={{ padding: "0.6rem" }}>Stage</th>
										<th style={{ padding: "0.6rem" }}>Avg. Days</th>
										<th style={{ padding: "0.6rem" }}>Min</th>
										<th style={{ padding: "0.6rem" }}>Max</th>
									</tr>
								</thead>
								<tbody>
									{[
										{ stage: "Consultation → Assessment", avg: 3, min: 1, max: 7 },
										{ stage: "Assessment → Application", avg: 5, min: 2, max: 14 },
										{ stage: "Document Verification", avg: 4, min: 1, max: 10 },
										{ stage: "School Submission", avg: 7, min: 3, max: 21 },
										{ stage: "Offer Letter → Visa", avg: 12, min: 5, max: 30 },
										{ stage: "Visa Processing", avg: 21, min: 7, max: 60 },
									].map((r) => (
										<tr key={r.stage} style={{ borderBottom: "1px solid var(--border-light)" }}>
											<td style={{ padding: "0.6rem" }}>{r.stage}</td>
											<td style={{ padding: "0.6rem", fontWeight: 600 }}>{r.avg}</td>
											<td style={{ padding: "0.6rem" }} className="muted">{r.min}</td>
											<td style={{ padding: "0.6rem" }} className="muted">{r.max}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>

					<div className="card">
						<h2 className="section-title mb-3">Document Verification Stats</h2>
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
							<div>
								<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Total Documents</p>
								<p style={{ fontWeight: 600, fontSize: "var(--text-lg)", marginTop: "0.2rem" }}>{docStats.total}</p>
							</div>
							<div>
								<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Verified</p>
								<p style={{ fontWeight: 600, fontSize: "var(--text-lg)", marginTop: "0.2rem" }}>{docStats.verified} ({docStats.rate}%)</p>
							</div>
							<div>
								<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Pending</p>
								<p style={{ fontWeight: 600, fontSize: "var(--text-lg)", marginTop: "0.2rem", color: "var(--muted-foreground)" }}>{docStats.pending}</p>
							</div>
							<div>
								<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Rejected</p>
								<p style={{ fontWeight: 600, fontSize: "var(--text-lg)", marginTop: "0.2rem", color: "var(--muted-foreground)" }}>{docStats.rejected}</p>
							</div>
						</div>
						<BarRow label="Verification Rate" value={docStats.rate} max={100} suffix="%" />
						<BarRow label="Pending Review" value={docStats.pending} max={docStats.total} />
						<BarRow label="Rejected" value={docStats.rejected} max={docStats.total} />
					</div>
				</div>

				{/* Branch Operational Performance (coordinator + manager) */}
				{(isManager || isCoordinator) && (
					<div className="card" style={{ marginBottom: "2rem" }}>
						<h2 className="section-title mb-3">Branch Operational Performance</h2>
						<div className="ops-table-wrap">
							<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "var(--text-sm)" }}>
								<thead>
									<tr style={{ borderBottom: "2px solid var(--border)" }}>
										<th style={{ padding: "0.75rem" }}>Branch</th>
										<th style={{ padding: "0.75rem" }}>Consultations</th>
										<th style={{ padding: "0.75rem" }}>Applications</th>
										<th style={{ padding: "0.75rem" }}>Accepted</th>
										<th style={{ padding: "0.75rem" }}>Acceptance Rate</th>
									</tr>
								</thead>
								<tbody>
								{branches.filter((b) =>
									scopedConsultations.some((c) => c.branch === b) ||
									scopedApplications.some((a) => a.branch === b),
								).map((b) => {
									const bCons = scopedConsultations.filter((c) => c.branch === b).length;
									const bApps = scopedApplications.filter((a) => a.branch === b);
									const bAccepted = bApps.filter((a) => a.status === "Accepted").length;
									const bRate = bApps.length > 0 ? Math.round((bAccepted / bApps.length) * 100) : 0;
									return (
										<tr key={b} style={{ borderBottom: "1px solid var(--border-light)" }}>
											<td style={{ padding: "0.75rem", fontWeight: 500 }}>{branchName(b)}</td>
												<td style={{ padding: "0.75rem" }}>{bCons}</td>
												<td style={{ padding: "0.75rem" }}>{bApps.length}</td>
												<td style={{ padding: "0.75rem" }}>{bAccepted}</td>
												<td style={{ padding: "0.75rem" }}><span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{bRate}%</span></td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
				)}
			</>)}

			{/* ─── Team Performance (manager only) ─── */}
			{showTeam && (<>
				<div className="card" style={{ marginBottom: "2rem" }}>
					<h2 className="section-title mb-3">Team Performance</h2>
					{teamPerformance.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No assigned work yet.</p>
					) : (
						<div className="ops-table-wrap">
							<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
								<thead>
									<tr style={{ borderBottom: "2px solid var(--border)" }}>
										<th style={{ padding: "0.75rem" }}>Consultant</th>
										<th style={{ padding: "0.75rem" }}>Consultations</th>
										<th style={{ padding: "0.75rem" }}>Completed</th>
										<th style={{ padding: "0.75rem" }}>Applications</th>
										<th style={{ padding: "0.75rem" }}>Accepted</th>
										<th style={{ padding: "0.75rem" }}>Completion</th>
									</tr>
								</thead>
								<tbody>
									{teamPerformance.map(([name, d]) => {
										const rate = d.consultations > 0 ? Math.round((d.completedConsults / d.consultations) * 100) : 0;
										return (
											<tr key={name} style={{ borderBottom: "1px solid var(--border-light)" }}>
												<td style={{ padding: "0.75rem", fontWeight: 500 }}>{name}</td>
												<td style={{ padding: "0.75rem" }}>{d.consultations}</td>
												<td style={{ padding: "0.75rem" }}>{d.completedConsults}</td>
												<td style={{ padding: "0.75rem" }}>{d.applications}</td>
												<td style={{ padding: "0.75rem" }}>{d.acceptedApps}</td>
												<td style={{ padding: "0.75rem" }}>
													<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{rate}%</span>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>

				{/* Package Catalogue Status */}
				<div className="card">
					<h2 className="section-title mb-3">Package Catalogue Status</h2>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
						{packages.map((pkg) => (
							<div key={pkg.id} style={{ padding: "0.75rem", border: "1px solid var(--border-light)", opacity: pkg.active ? 1 : 0.55 }}>
								<p style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{pkg.name}</p>
								<p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>{fmtBoth(pkg.price)}</p>
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
									{pkg.active ? "Active" : "Retired"} · {pkg.services.length} services
								</p>
							</div>
						))}
					</div>
				</div>
			</>)}

			{/* ─── No Access fallback ─── */}
			{!showFinancial && !showOperational && !showTeam && (
				<div className="card">
					<p className="muted">No reports available for your role.</p>
				</div>
			)}
		</div>
	);
}
