import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOpsState } from "./OpsStateContext";
import { useOpsAuth } from "./OpsAuthContext";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import { fmtBoth, fmtGhs, fmtUsd, money } from "./currency";


const RANGES = [
	{ id: "30", label: "30 days", days: 30 },
	{ id: "90", label: "90 days", days: 90 },
	{ id: "365", label: "12 months", days: 365 },
	{ id: "all", label: "All time", days: null },
] as const;

export function EnterpriseFinance() {
	const { applicants, liveCase } = useOpsState();
	const { invoices } = useInvoiceApi();
	const { opsRole } = useOpsAuth();
	const [branchFilter, setBranchFilter] = useState("all");
	const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
	const [cutoff, setCutoff] = useState<number | null>(null);

	const canConfigSchedules = opsRole === "manager" || opsRole === "finance";


	const scopedInvoices = useMemo(() => {
		if (cutoff === null) return invoices;
		return invoices.filter((i) => new Date(i.issuedAt).getTime() >= cutoff);
	}, [invoices, cutoff]);

	const scopedApplicants = useMemo(
		() =>
			branchFilter === "all"
				? applicants
				: applicants.filter((a) => a.branch === branchFilter),
		[applicants, branchFilter],
	);

	const totals = useMemo(() => {
		const outstanding = scopedApplicants.reduce((n, a) => n + money(a.financials.outstanding), 0);
		const collected = scopedApplicants.reduce((n, a) => n + money(a.financials.paidAmount), 0);
		const billed = scopedApplicants.reduce((n, a) => n + money(a.financials.totalAmount), 0);
		return { outstanding, collected, billed };
	}, [scopedApplicants]);

	const analytics = useMemo(() => {
		const settled = scopedApplicants.filter((a) => money(a.financials.outstanding) === 0).length;
		const collectionRate = totals.billed > 0 ? Math.round((totals.collected / totals.billed) * 100) : 0;
		const avgAccount = scopedApplicants.length > 0 ? Math.round(totals.billed / scopedApplicants.length) : 0;
		const byBranch = new Map<string, { billed: number; collected: number; outstanding: number; count: number }>();
		for (const a of scopedApplicants) {
			const entry = byBranch.get(a.branch) ?? { billed: 0, collected: 0, outstanding: 0, count: 0 };
			entry.billed += money(a.financials.totalAmount);
			entry.collected += money(a.financials.paidAmount);
			entry.outstanding += money(a.financials.outstanding);
			entry.count += 1;
			byBranch.set(a.branch, entry);
		}
		return { settled, collectionRate, avgAccount, byBranch };
	}, [scopedApplicants, totals]);

	const revenueByType = useMemo(() => {
		const map = new Map<string, { count: number; billed: number; collected: number; outstanding: number }>();
		for (const inv of scopedInvoices) {
			const entry = map.get(inv.type) ?? { count: 0, billed: 0, collected: 0, outstanding: 0 };
			entry.count += 1;
			entry.billed += inv.subtotal;
			if (inv.status === "paid") entry.collected += inv.subtotal;
			else entry.outstanding += inv.subtotal;
			map.set(inv.type, entry);
		}
		return [...map.entries()].sort((a, b) => b[1].billed - a[1].billed);
	}, [scopedInvoices]);

	const revenueByLineItem = useMemo(() => {
		const map = new Map<string, { count: number; amount: number; types: Set<string> }>();
		for (const inv of scopedInvoices) {
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
	}, [scopedInvoices]);





	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem", gap: "1rem", flexWrap: "wrap" }}>
				<div>
					<h1 className="page-title">Finance Reports</h1>
					<p className="lead mt-2">Build invoices, track balances, and review payment history.</p>
				</div>
				<div className="fin-filters">
					<div className="admin-env-tabs">
						{RANGES.map((r) => (
							<button
								key={r.id}
								className={`admin-env-tab${range === r.id ? " admin-env-tab--active" : ""}`}
								onClick={() => {
									setRange(r.id);
									setCutoff(r.days === null ? null : Date.now() - r.days * 86_400_000);
								}}
							>
								{r.label}
							</button>
						))}
					</div>
					<BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />
				</div>
			</div>


			{/* Live applicant billing */}
			{liveCase?.present ? (
				<div className="card" style={{ marginBottom: "2rem", border: "2px solid var(--foreground)" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
						<div>
							<p className="eyebrow" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
								<span className="ops-live-dot" aria-hidden style={{ display: "inline-block" }} />
								Live applicant · billing
							</p>
							<p style={{ fontWeight: 700, fontSize: "1.1rem", marginTop: "0.3rem" }}>{liveCase.name}</p>
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
								{liveCase.email}
								{liveCase.consultationRef ? ` · ${liveCase.consultationRef}` : ""}
								{liveCase.applicationId ? ` · ${liveCase.applicationId}` : ""}
							</p>
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>
								Stage: {liveCase.stageLabel}
								{liveCase.fundingTrack ? ` · ${liveCase.fundingTrack}` : ""}
								{liveCase.schools.length ? ` · ${liveCase.schools.length} school(s)` : ""}
							</p>
						</div>
						<Link to="/ops/invoices" className="btn btn--ghost btn--sm" style={{ whiteSpace: "nowrap" }}>
							Open invoices →
						</Link>
					</div>

					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
						<div className="card" style={{ padding: "0.85rem 1rem" }}>
							<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Consultation</p>
							<p className="mono" style={{ fontWeight: 600, fontSize: "var(--text-sm)", marginTop: "0.2rem" }}>
								{liveCase.consultationPaid ? fmtGhs(liveCase.consultationAmount) : "Not raised"}
							</p>
							<span className={`inv-status ${liveCase.consultationPaid ? "inv-status--paid" : "inv-status--issued"}`} style={{ fontSize: "var(--text-xs)", marginTop: "0.3rem", display: "inline-block" }}>
								{liveCase.consultationPaid ? "Paid" : "Pending"}
							</span>
						</div>
						<div className="card" style={{ padding: "0.85rem 1rem" }}>
							<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Application inv.</p>
							<p className="mono" style={{ fontWeight: 600, fontSize: "var(--text-sm)", marginTop: "0.2rem" }}>
								{liveCase.appInvoiceAmount ? fmtGhs(liveCase.appInvoiceAmount) : "Not raised"}
							</p>
							<span className={`inv-status ${liveCase.appInvoiceStatus === "paid" ? "inv-status--paid" : liveCase.appInvoiceStatus === "raised" ? "inv-status--issued" : "inv-status--issued"}`} style={{ fontSize: "var(--text-xs)", marginTop: "0.3rem", display: "inline-block" }}>
								{liveCase.appInvoiceStatus === "paid" ? "Paid" : liveCase.appInvoiceStatus === "raised" ? "Issued" : "Pending"}
							</span>
						</div>
						<div className="card" style={{ padding: "0.85rem 1rem" }}>
							<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Visa inv.</p>
							<p className="mono" style={{ fontWeight: 600, fontSize: "var(--text-sm)", marginTop: "0.2rem" }}>
								{liveCase.visaInvoiceAmount ? fmtGhs(liveCase.visaInvoiceAmount) : "Not raised"}
							</p>
							<span className={`inv-status ${liveCase.visaInvoiceStatus === "paid" ? "inv-status--paid" : liveCase.visaInvoiceStatus === "raised" ? "inv-status--issued" : "inv-status--issued"}`} style={{ fontSize: "var(--text-xs)", marginTop: "0.3rem", display: "inline-block" }}>
								{liveCase.visaInvoiceStatus === "paid" ? "Paid" : liveCase.visaInvoiceStatus === "raised" ? "Issued" : "Pending"}
							</span>
						</div>
						<div className="card" style={{ padding: "0.85rem 1rem" }}>
							<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>Agency fee</p>
							<p className="mono" style={{ fontWeight: 600, fontSize: "var(--text-sm)", marginTop: "0.2rem" }}>
								{liveCase.agencyTotal > 0 ? fmtGhs(liveCase.agencyTotal) : "Not set"}
							</p>
							<span className={`inv-status ${liveCase.agencySettled ? "inv-status--paid" : liveCase.agencyTotal > 0 ? "inv-status--partial" : "inv-status--issued"}`} style={{ fontSize: "var(--text-xs)", marginTop: "0.3rem", display: "inline-block" }}>
								{liveCase.agencySettled ? "Settled" : liveCase.agencyTotal > 0 ? `${Math.round((liveCase.agencyPaid / liveCase.agencyTotal) * 100)}% paid` : "Pending"}
							</span>
						</div>
					</div>
				</div>
			) : null}

			{/* Totals */}
			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.5rem", marginBottom: "2rem" }}>
				<div className="card" style={{ background: "var(--foreground)", color: "var(--background)" }}>
					<p className="eyebrow" style={{ color: "var(--muted)" }}>Total Outstanding</p>
					<p className="page-title mt-1" style={{ color: "var(--background)" }}>{fmtGhs(totals.outstanding)}</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>≈ {fmtUsd(totals.outstanding)} USD</p>
				</div>
				<div className="card">
					<p className="eyebrow">Collected</p>
					<p className="page-title mt-1">{fmtGhs(totals.collected)}</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>≈ {fmtUsd(totals.collected)} USD</p>
				</div>
				<div className="card">
					<p className="eyebrow">Total Billed</p>
					<p className="page-title mt-1">{fmtGhs(totals.billed)}</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>≈ {fmtUsd(totals.billed)} USD</p>
				</div>
			</div>

			{/* Financial Analytics */}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }}>
				<div className="card">
					<p className="eyebrow">Collection Rate</p>
					<p className="page-title mt-1">{analytics.collectionRate}%</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>{analytics.settled} of {scopedApplicants.length} accounts settled</p>
				</div>
				<div className="card">
					<p className="eyebrow">Avg. Account Value</p>
					<p className="page-title mt-1">{fmtGhs(analytics.avgAccount)}</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>≈ {fmtUsd(analytics.avgAccount)} USD · {scopedApplicants.length} active accounts</p>
				</div>
				<div className="card">
					<p className="eyebrow">Outstanding Ratio</p>
					<p className="page-title mt-1">{totals.billed > 0 ? Math.round((totals.outstanding / totals.billed) * 100) : 0}%</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>{fmtBoth(totals.outstanding)} of {fmtBoth(totals.billed)}</p>
				</div>
			</div>

			{/* Revenue by Branch */}
			<div className="card" style={{ marginBottom: "2rem" }}>
				<h2 className="section-title mb-3">Revenue by Branch</h2>
				{[...analytics.byBranch.entries()].length === 0 ? (
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No branch data yet.</p>
				) : (
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
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
								{[...analytics.byBranch.entries()].map(([branch, d]) => {
									const rate = d.billed > 0 ? Math.round((d.collected / d.billed) * 100) : 0;
									return (
										<tr key={branch} style={{ borderBottom: "1px solid var(--border-light)" }}>
											<td style={{ padding: "0.75rem", fontWeight: 500 }}>{branchName(branch)}</td>
											<td style={{ padding: "0.75rem" }}>{d.count}</td>
											<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{fmtBoth(d.billed)}</td>
											<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{fmtBoth(d.collected)}</td>
											<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600 }}>{fmtBoth(d.outstanding)}</td>
											<td style={{ padding: "0.75rem" }}><span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{rate}%</span></td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Revenue by Service Type */}
			<div className="card" style={{ marginBottom: "2rem" }}>
				<h2 className="section-title mb-3">Revenue by Service Type</h2>
				{revenueByType.length === 0 ? (
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No invoice data yet.</p>
				) : (
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "0.75rem" }}>Service Type</th>
									<th style={{ padding: "0.75rem" }}>Invoices</th>
									<th style={{ padding: "0.75rem" }}>Billed</th>
									<th style={{ padding: "0.75rem" }}>Collected</th>
									<th style={{ padding: "0.75rem" }}>Outstanding</th>
									<th style={{ padding: "0.75rem" }}>Collected %</th>
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
											<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600 }}>{fmtBoth(d.outstanding)}</td>
											<td style={{ padding: "0.75rem" }}><span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{rate}%</span></td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Revenue by Line Item */}
			<div className="card" style={{ marginBottom: "2rem" }}>
				<h2 className="section-title mb-3">Revenue by Line Item</h2>
				{revenueByLineItem.length === 0 ? (
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No line item data yet.</p>
				) : (
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "0.75rem" }}>Line Item</th>
									<th style={{ padding: "0.75rem" }}>Occurrences</th>
									<th style={{ padding: "0.75rem" }}>Total Revenue</th>
									<th style={{ padding: "0.75rem" }}>Avg. per Invoice</th>
									<th style={{ padding: "0.75rem" }}>Service Types</th>
								</tr>
							</thead>
							<tbody>
								{revenueByLineItem.map((item) => (
									<tr key={item.label} style={{ borderBottom: "1px solid var(--border-light)" }}>
										<td style={{ padding: "0.75rem", fontWeight: 500 }}>{item.label}</td>
										<td style={{ padding: "0.75rem" }}>{item.count}</td>
										<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", fontWeight: 600 }}>{fmtBoth(item.amount)}</td>
										<td style={{ padding: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{fmtBoth(Math.round(item.amount / item.count))}</td>
										<td style={{ padding: "0.75rem" }}>
											{item.types.map((t) => (
												<span key={t} className="portal-pill" style={{ fontSize: "var(--text-xs)", marginRight: "0.25rem" }}>{t}</span>
											))}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{canConfigSchedules ? (
				<div className="card" style={{ marginBottom: "2rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
					<div>
						<h2 className="section-title">Payment Configuration</h2>
						<p className="muted mt-1" style={{ fontSize: "var(--text-sm)" }}>
							Manage post-arrival payment schedule options available to applicants.
						</p>
					</div>
					<Link to="/ops/payment-config" className="btn btn--ghost btn--sm" style={{ whiteSpace: "nowrap" }}>
						Configure →
					</Link>
				</div>
			) : null}

		</div>
	);
}

