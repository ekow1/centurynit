import { useEffect, useMemo, useState } from "react";
import { useOpsState } from "./OpsStateContext";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { fmtBoth, fmtGhs, fmtUsd } from "./currency";
import { type PaymentLogEntry, PAYMENT_METHODS, methodGateway } from "century-nit-core/ops";

const RANGES = [
	{ id: "7", label: "7 days", days: 7 },
	{ id: "30", label: "30 days", days: 30 },
	{ id: "90", label: "90 days", days: 90 },
	{ id: "all", label: "All time", days: null },
] as const;

const METHOD_FILTERS = ["all", ...PAYMENT_METHODS] as const;

/**
 * Payments Log — a flat, filterable log of every incoming payment across all
 * clients. Gives finance officers a "who paid what, when, and how" view.
 */
export function EnterprisePaymentsLog() {
	const { applicants } = useOpsState();
	const { invoices } = useInvoiceApi();
	const [branchFilter, setBranchFilter] = useState("all");
	const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
	const [methodFilter, setMethodFilter] = useState<(typeof METHOD_FILTERS)[number]>("all");
	const [search, setSearch] = useState("");
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(id);
	}, []);

	// Flatten all payments from all invoices into a single log
	const allPayments = useMemo<PaymentLogEntry[]>(() => {
		const entries: PaymentLogEntry[] = [];
		for (const inv of invoices) {
			if (inv.status === "void") continue;
			for (const p of inv.payments ?? []) {
				entries.push({
					id: p.id,
					date: p.at,
					applicantId: inv.applicantId,
					applicantName: inv.applicantName,
					invoiceNumber: inv.invoiceNumber,
					amount: p.amount,
					method: p.method,
					gateway: methodGateway(p.method),
					reference: p.reference,
					recordedBy: p.by,
				});
			}
		}
		return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	}, [invoices]);

	// Apply filters
	const filtered = useMemo(() => {
		const cutoff = range === "all" ? null : now - (RANGES.find((r) => r.id === range)?.days ?? 0) * 86_400_000;

		// Build a set of applicant IDs by branch
		const branchIds = new Set<string>();
		if (branchFilter !== "all") {
			for (const a of applicants) {
				if (a.branch === branchFilter) branchIds.add(a.id);
			}
		}

		return allPayments.filter((p) => {
			if (cutoff !== null && new Date(p.date).getTime() < cutoff) return false;
			if (methodFilter !== "all" && p.method !== methodFilter) return false;
			if (branchFilter !== "all" && !branchIds.has(p.applicantId)) return false;
			if (search) {
				const q = search.toLowerCase();
				const hay = `${p.applicantName} ${p.invoiceNumber} ${p.reference} ${p.method}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}, [allPayments, range, methodFilter, branchFilter, search, applicants, now]);

	// Summary stats
	const totals = useMemo(() => {
		const total = filtered.reduce((n, p) => n + p.amount, 0);
		const byMethod = new Map<string, number>();
		for (const p of filtered) {
			byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
		}
		const today = new Date().toDateString();
		const todayTotal = filtered
			.filter((p) => new Date(p.date).toDateString() === today)
			.reduce((n, p) => n + p.amount, 0);
		return { total, byMethod: [...byMethod.entries()].sort((a, b) => b[1] - a[1]), todayTotal, count: filtered.length };
	}, [filtered]);

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem", gap: "1rem", flexWrap: "wrap" }}>
				<div>
					<h1 className="page-title">Payments Log</h1>
					<p className="lead mt-2">Every incoming payment across all clients — filterable by date, method, and branch.</p>
				</div>
				<div className="fin-filters" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
					<div className="admin-env-tabs">
						{RANGES.map((r) => (
							<button
								key={r.id}
								className={`admin-env-tab${range === r.id ? " admin-env-tab--active" : ""}`}
								onClick={() => setRange(r.id)}
							>
								{r.label}
							</button>
						))}
					</div>
					<BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />
				</div>
			</div>

			{/* Summary cards */}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }}>
				<div className="card" style={{ background: "var(--foreground)", color: "var(--background)" }}>
					<p className="eyebrow" style={{ color: "var(--muted)" }}>Total Received</p>
					<p className="page-title mt-1" style={{ color: "var(--background)" }}>{fmtGhs(totals.total)}</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>≈ {fmtUsd(totals.total)} · {totals.count} payment{totals.count === 1 ? "" : "s"}</p>
				</div>
				<div className="card">
					<p className="eyebrow">Today's Inflow</p>
					<p className="page-title mt-1">{fmtGhs(totals.todayTotal)}</p>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>≈ {fmtUsd(totals.todayTotal)} USD</p>
				</div>
				{totals.byMethod.slice(0, 2).map(([method, amount]) => (
					<div key={method} className="card">
						<p className="eyebrow">{method}</p>
						<p className="page-title mt-1">{fmtGhs(amount)}</p>
						<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>≈ {fmtUsd(amount)} USD</p>
					</div>
				))}
			</div>

			{/* Method breakdown bar */}
			{totals.byMethod.length > 0 && (
				<div className="card" style={{ marginBottom: "2rem", padding: "1.5rem" }}>
					<h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>By Payment Method</h3>
					<div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
						{totals.byMethod.map(([method, amount]) => {
							const pct = totals.total > 0 ? Math.round((amount / totals.total) * 100) : 0;
							return (
								<div key={method} style={{ minWidth: "140px" }}>
									<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
										<span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{method}</span>
										<span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>{pct}%</span>
									</div>
									<div style={{ height: "6px", background: "var(--muted)", borderRadius: "3px", overflow: "hidden" }}>
										<div style={{ height: "100%", width: `${pct}%`, background: "var(--primary)", borderRadius: "3px" }} />
									</div>
									<p className="mono" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem", color: "var(--muted-foreground)" }}>{fmtUsd(amount)}</p>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Filters + table */}
			<div className="card" style={{ padding: 0 }}>
				<div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid var(--border-light)", display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
					<input
						type="text"
						className="input"
						placeholder="Search applicant, invoice, reference..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						style={{ flex: 1, minWidth: "200px" }}
					/>
					<div className="admin-env-tabs">
						{METHOD_FILTERS.map((m) => (
							<button
								key={m}
								className={`admin-env-tab${methodFilter === m ? " admin-env-tab--active" : ""}`}
								onClick={() => setMethodFilter(m)}
							>
								{m === "all" ? "All methods" : m}
							</button>
						))}
					</div>
				</div>

				{filtered.length === 0 ? (
					<p style={{ padding: "2rem", textAlign: "center", color: "var(--muted-foreground)" }}>
						No payments match the current filters.
					</p>
				) : (
					<div className="ops-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Date</th>
									<th>Applicant</th>
									<th>Invoice</th>
									<th style={{ textAlign: "right" }}>Amount</th>
									<th>Method</th>
									<th>Gateway</th>
									<th>Reference</th>
									<th>Recorded By</th>
								</tr>
							</thead>
							<tbody>
								{filtered.map((p) => (
									<tr key={p.id}>
										<td style={{ color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
											{new Date(p.date).toLocaleDateString()}
											<span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginLeft: "0.25rem" }}>
												{new Date(p.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
											</span>
										</td>
										<td style={{ fontWeight: 600 }}>{p.applicantName}</td>
										<td style={{ color: "var(--muted-foreground)", fontSize: "var(--text-xs)" }}>{p.invoiceNumber}</td>
										<td className="mono" style={{ textAlign: "right", fontWeight: 600, fontSize: "var(--text-xs)" }}>{fmtBoth(p.amount)}</td>
										<td>
											<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>{p.method}</span>
										</td>
										<td style={{ color: "var(--muted-foreground)", fontSize: "var(--text-xs)" }}>{p.gateway}</td>
										<td style={{ color: "var(--muted-foreground)", fontSize: "var(--text-xs)" }}>{p.reference || "—"}</td>
										<td style={{ color: "var(--muted-foreground)", fontSize: "var(--text-xs)" }}>{p.recordedBy}</td>
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr style={{ borderTop: "2px solid var(--border)" }}>
									<td colSpan={3} style={{ padding: "0.75rem", fontWeight: 600 }}>Total ({filtered.length} payment{filtered.length === 1 ? "" : "s"})</td>
									<td className="mono" style={{ padding: "0.75rem", textAlign: "right", fontWeight: 700, fontSize: "var(--text-sm)" }}>{fmtBoth(totals.total)}</td>
									<td colSpan={4}></td>
								</tr>
							</tfoot>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
