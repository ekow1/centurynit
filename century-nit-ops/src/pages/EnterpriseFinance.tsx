import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCases } from "../hooks/useCases";
import { useOpsAuth } from "./OpsAuthContext";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName, invoiceAgeDays, invoiceBalance, type Invoice } from "century-nit-core/ops";
import { INVOICE_TYPE_LABELS, isPassThroughInvoice } from "century-nit-shared";
import { fmtGhs, fmtUsd } from "./currency";

/**
 * Finance reports — what was billed, what came in, and where it is stuck,
 * by period. Every figure comes from the invoices and their payments, so a
 * number here always agrees with the ledger. Century's fee and the money
 * passed through (application fees, visa costs, tickets) are kept apart, so
 * revenue is never inflated by what was only collected on a client's behalf.
 */

type PeriodId = "month" | "last_month" | "quarter" | "year" | "all";
const PERIODS: { id: PeriodId; label: string }[] = [
	{ id: "month", label: "This month" },
	{ id: "last_month", label: "Last month" },
	{ id: "quarter", label: "This quarter" },
	{ id: "year", label: "Last 12 months" },
	{ id: "all", label: "All time" },
];

/** The period's window and the one before it, for the comparison. */
function windowOf(id: PeriodId, now: Date): { from: Date | null; to: Date; prevFrom: Date | null; prevTo: Date | null; label: string } {
	const start = (y: number, m: number) => new Date(y, m, 1);
	const y = now.getFullYear();
	const m = now.getMonth();
	if (id === "month") return { from: start(y, m), to: now, prevFrom: start(y, m - 1), prevTo: start(y, m), label: now.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
	if (id === "last_month") return { from: start(y, m - 1), to: start(y, m), prevFrom: start(y, m - 2), prevTo: start(y, m - 1), label: start(y, m - 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
	if (id === "quarter") {
		const q = Math.floor(m / 3) * 3;
		return { from: start(y, q), to: now, prevFrom: start(y, q - 3), prevTo: start(y, q), label: `Q${Math.floor(m / 3) + 1} ${y}` };
	}
	if (id === "year") return { from: start(y - 1, m + 1), to: now, prevFrom: start(y - 2, m + 1), prevTo: start(y - 1, m + 1), label: "Last 12 months" };
	return { from: null, to: now, prevFrom: null, prevTo: null, label: "All time" };
}
const inWindow = (iso: string | undefined, from: Date | null, to: Date | null) => {
	if (!iso) return false;
	const t = new Date(iso).getTime();
	return (from === null || t >= from.getTime()) && (to === null || t < to.getTime());
};
const pctDelta = (now: number, before: number): string | null => (before > 0 ? `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}%` : null);

export function EnterpriseFinance() {
	const { canSeeAllBranches } = useOpsAuth();
	const { applicants } = useCases();
	const { invoices } = useInvoiceApi();
	const [branchFilter, setBranchFilter] = useState("all");
	const [period, setPeriod] = useState<PeriodId>("month");
	const now = useMemo(() => new Date(), []);
	const win = useMemo(() => windowOf(period, now), [period, now]);

	const branchOf = useMemo(() => {
		const map = new Map<string, string>();
		for (const a of applicants) {
			map.set(a.id, a.branch);
			map.set(a.name, a.branch);
		}
		return (inv: Invoice) => map.get(inv.applicantId) ?? map.get(inv.applicantName) ?? "";
	}, [applicants]);
	const packageOf = useMemo(() => {
		const map = new Map<string, string>();
		for (const a of applicants) {
			if (a.package) {
				map.set(a.id, a.package);
				map.set(a.name, a.package);
			}
		}
		return (inv: Invoice) => map.get(inv.applicantId) ?? map.get(inv.applicantName) ?? "No package";
	}, [applicants]);

	const scoped = useMemo(() => invoices.filter((i) => i.status !== "void" && i.status !== "proforma" && (branchFilter === "all" || branchOf(i) === branchFilter)), [invoices, branchFilter, branchOf]);

	/** The period's money, and the period before it. */
	// The two safety nets under stage billing, surfaced: milestones the daily
	// sweep had to date (an event nobody recorded through its hook), and
	// refunds a reduced plan flagged that finance has not yet credited.
	const nets = useMemo(() => {
		const since = now.getTime() - 7 * 86_400_000;
		let reconciled = 0;
		let refunds = 0;
		for (const inv of invoices) {
			const history = inv.history ?? [];
			reconciled += history.filter((h) => h.action === "due_reconciled" && new Date(h.at).getTime() >= since).length;
			const last = [...history].reverse().find((h) => h.action === "refund_due" || h.action === "credited" || h.action === "voided");
			if (last?.action === "refund_due") refunds += 1;
		}
		return { reconciled, refunds };
	}, [invoices, now]);
	const figures = useMemo(() => {
		const sum = (from: Date | null, to: Date | null) => {
			let billed = 0;
			let collected = 0;
			let century = 0;
			let passThrough = 0;
			let invoicesIssued = 0;
			const accounts = new Set<string>();
			for (const inv of scoped) {
				if (inWindow(inv.issuedAt, from, to)) {
					billed += inv.subtotal;
					invoicesIssued += 1;
					accounts.add(inv.applicantId);
				}
				for (const p of inv.payments ?? []) {
					if (!inWindow(p.at, from, to)) continue;
					collected += p.amount;
					if (isPassThroughInvoice(inv.type)) passThrough += p.amount;
					else century += p.amount;
				}
			}
			return { billed, collected, century, passThrough, invoicesIssued, accounts: accounts.size };
		};
		const cur = sum(win.from, win.to);
		const prev = win.prevFrom ? sum(win.prevFrom, win.prevTo) : null;
		const open = scoped.filter((i) => invoiceBalance(i) > 0);
		const outstanding = open.reduce((n, i) => n + invoiceBalance(i), 0);
		const overdue = open.filter((i) => (invoiceAgeDays(i) ?? 0) > 0);
		const aging = [0, 0, 0, 0];
		for (const i of open) {
			const age = invoiceAgeDays(i) ?? 0;
			aging[age <= 0 ? 0 : age <= 30 ? 1 : age <= 60 ? 2 : 3] += invoiceBalance(i);
		}
		// Gateway fees: mobile money and cards cost 1.95% — the payment log knows the channel; here the method string does.
		const fees = scoped.flatMap((i) => i.payments ?? []).filter((p) => inWindow(p.at, win.from, win.to) && /paystack|momo|mobile|card|visa|mastercard/i.test(p.method)).reduce((n, p) => n + p.amount * 0.0195, 0);
		return {
			cur,
			prev,
			outstanding,
			overdueAmount: overdue.reduce((n, i) => n + invoiceBalance(i), 0),
			overdueCount: overdue.length,
			oldest: overdue.reduce((m, i) => Math.max(m, invoiceAgeDays(i) ?? 0), 0),
			owing: new Set(open.map((i) => i.applicantId)).size,
			aging,
			fees,
			rate: cur.billed > 0 ? Math.round((cur.collected / cur.billed) * 100) : null,
		};
	}, [scoped, win]);

	/** Twelve months, billed and collected. */
	const months = useMemo(() => {
		const out: { key: string; label: string; billed: number; collected: number }[] = [];
		for (let k = 11; k >= 0; k--) {
			const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
			out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: "short" }), billed: 0, collected: 0 });
		}
		const idx = new Map(out.map((m, i) => [m.key, i]));
		const keyOf = (iso: string) => {
			const d = new Date(iso);
			return `${d.getFullYear()}-${d.getMonth()}`;
		};
		for (const inv of scoped) {
			const bi = idx.get(keyOf(inv.issuedAt));
			if (bi !== undefined) out[bi].billed += inv.subtotal;
			for (const p of inv.payments ?? []) {
				const pi = idx.get(keyOf(p.at));
				if (pi !== undefined) out[pi].collected += p.amount;
			}
		}
		return out;
	}, [scoped, now]);
	const monthMax = Math.max(1, ...months.map((m) => Math.max(m.billed, m.collected)));

	const byBranch = useMemo(() => {
		const map = new Map<string, { accounts: Set<string>; billed: number; collected: number; outstanding: number }>();
		for (const inv of scoped) {
			const b = branchOf(inv) || "—";
			const e = map.get(b) ?? { accounts: new Set<string>(), billed: 0, collected: 0, outstanding: 0 };
			e.accounts.add(inv.applicantId);
			if (inWindow(inv.issuedAt, win.from, win.to)) e.billed += inv.subtotal;
			for (const p of inv.payments ?? []) if (inWindow(p.at, win.from, win.to)) e.collected += p.amount;
			e.outstanding += invoiceBalance(inv);
			map.set(b, e);
		}
		return [...map.entries()].map(([b, e]) => ({ branch: b, ...e })).sort((x, y) => y.collected - x.collected);
	}, [scoped, branchOf, win]);

	const byType = useMemo(() => {
		const map = new Map<string, number>();
		for (const inv of scoped) for (const p of inv.payments ?? []) if (inWindow(p.at, win.from, win.to)) map.set(inv.type, (map.get(inv.type) ?? 0) + p.amount);
		return [...map.entries()].sort((a, b) => b[1] - a[1]);
	}, [scoped, win]);
	const byPackage = useMemo(() => {
		const map = new Map<string, { amount: number; accounts: Set<string> }>();
		for (const inv of scoped) {
			if (isPassThroughInvoice(inv.type)) continue;
			for (const p of inv.payments ?? []) {
				if (!inWindow(p.at, win.from, win.to)) continue;
				const k = packageOf(inv);
				const e = map.get(k) ?? { amount: 0, accounts: new Set<string>() };
				e.amount += p.amount;
				e.accounts.add(inv.applicantId);
				map.set(k, e);
			}
		}
		return [...map.entries()].map(([k, e]) => ({ label: k, amount: e.amount, accounts: e.accounts.size })).sort((a, b) => b.amount - a.amount);
	}, [scoped, packageOf, win]);
	const typeMax = Math.max(1, ...byType.map(([, v]) => v));
	const pkgMax = Math.max(1, ...byPackage.map((p) => p.amount));

	function exportCsv() {
		const rows = [["Branch", "Accounts", "Billed", "Collected", "Outstanding", "Rate"], ...byBranch.map((b) => [branchName(b.branch) || b.branch, String(b.accounts.size), b.billed.toFixed(2), b.collected.toFixed(2), b.outstanding.toFixed(2), b.billed > 0 ? `${Math.round((b.collected / b.billed) * 100)}%` : ""])];
		const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
		const a = document.createElement("a");
		a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
		a.download = `finance-${win.label.replace(/\s+/g, "-").toLowerCase()}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	const { cur, prev } = figures;
	const delta = (a: number, b: number | undefined) => (b !== undefined ? pctDelta(a, b) : null);

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Finance reports</h1>
					<p className="lead mt-2">What was billed, what came in, and where it is stuck — by period.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<label className="cn-filter">
						<span className="cn-filter__label">Period</span>
						<select className="cn-filter__select" value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)}>
							{PERIODS.map((p) => (
								<option key={p.id} value={p.id}>
									{p.label}
								</option>
							))}
						</select>
					</label>
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
					<button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv}>
						Export CSV
					</button>
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span className="dash-day__date">{win.label}</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<span>
					<strong>{fmtGhs(cur.collected)}</strong> <span className="dash-day__date">collected</span>
				</span>
				<span>
					<strong>{fmtGhs(cur.billed)}</strong> <span className="dash-day__date">billed</span>
				</span>
				<span>
					<strong>{figures.rate === null ? "—" : `${figures.rate}%`}</strong> <span className="dash-day__date">collection rate</span>
				</span>
				{prev && delta(cur.collected, prev.collected) && (
					<span>
						<strong>{delta(cur.collected, prev.collected)}</strong> <span className="dash-day__date">vs the period before</span>
					</span>
				)}
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/invoices" className="dash-link">
					Invoices →
				</Link>
			</div>

			<div className="dash-kpis">
				<div className="dash-kpi dash-kpi--on">
					<span className="dash-kpi__label">Collected</span>
					<span className="dash-kpi__value">{fmtGhs(cur.collected)}</span>
					<span className="dash-kpi__delta">
						{prev && delta(cur.collected, prev.collected) ? `${delta(cur.collected, prev.collected)} vs before · ` : ""}
						{fmtUsd(cur.collected)}
					</span>
					<span className="dash-kpi__note">
						Century's fee {fmtGhs(cur.century)} · pass-through {fmtGhs(cur.passThrough)}
					</span>
				</div>
				<div className="dash-kpi">
					<span className="dash-kpi__label">Billed</span>
					<span className="dash-kpi__value">{fmtGhs(cur.billed)}</span>
					<span className="dash-kpi__delta">{prev && delta(cur.billed, prev.billed) ? `${delta(cur.billed, prev.billed)} vs before` : fmtUsd(cur.billed)}</span>
					<span className="dash-kpi__note">
						{cur.invoicesIssued} invoice{cur.invoicesIssued === 1 ? "" : "s"} · {cur.accounts} account{cur.accounts === 1 ? "" : "s"}
					</span>
				</div>
				<div className="dash-kpi">
					<span className="dash-kpi__label">Outstanding</span>
					<span className="dash-kpi__value">{fmtGhs(figures.outstanding)}</span>
					<span className="dash-kpi__delta">
						{figures.overdueCount > 0 ? `${fmtGhs(figures.overdueAmount)} overdue · ${figures.overdueCount} invoice${figures.overdueCount === 1 ? "" : "s"}` : "nothing overdue"}
					</span>
					<span className="dash-kpi__note">
						{figures.oldest > 0 ? `oldest ${figures.oldest} d · ` : ""}
						{figures.owing} account{figures.owing === 1 ? "" : "s"} owing
					</span>
				</div>
				<div className="dash-kpi">
					<span className="dash-kpi__label">Safety nets · 7 days</span>
					<span className="dash-kpi__value">{nets.reconciled}</span>
					<span className="dash-kpi__delta">milestone{nets.reconciled === 1 ? "" : "s"} dated by the daily sweep</span>
					<span className="dash-kpi__note">{nets.refunds} refund{nets.refunds === 1 ? "" : "s"} flagged, awaiting a credit note</span>
				</div>
				<div className="dash-kpi">
					<span className="dash-kpi__label">Gateway fees</span>
					<span className="dash-kpi__value">{fmtGhs(figures.fees)}</span>
					<span className="dash-kpi__delta">1.95% on mobile money &amp; cards</span>
					<span className="dash-kpi__note">net to Century {fmtGhs(cur.century - figures.fees)}</span>
				</div>
			</div>

			<div className="dash-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
				<section className="dash-panel">
					<header className="dash-panel__head">
						<h2 className="dash-panel__title">Twelve months · billed ▯ collected ▮</h2>
						<span className="cn-filter__label">GH₵</span>
					</header>
					<div className="ops-months">
						{months.map((m) => (
							<div key={m.key} className="ops-month" title={`${m.label}: billed ${fmtGhs(m.billed)} · collected ${fmtGhs(m.collected)}`}>
								<div className="ops-month__b" style={{ height: `${Math.round((m.collected / monthMax) * 100)}%` }} />
								<div className="ops-month__c" style={{ height: `${Math.round((Math.max(0, m.billed - m.collected) / monthMax) * 100)}%` }} />
							</div>
						))}
					</div>
					<div className="ops-months__l">
						{months.map((m) => (
							<span key={m.key}>{m.label}</span>
						))}
					</div>
				</section>
				<section className="dash-panel">
					<header className="dash-panel__head">
						<h2 className="dash-panel__title">By branch</h2>
						<Link to="/ledger" className="dash-link">
							Client ledger →
						</Link>
					</header>
					{byBranch.length === 0 ? (
						<p className="dash-empty">No invoices yet.</p>
					) : (
						<div className="ops-table-wrap">
							<table className="ops-table ops-ledger">
								<thead>
									<tr>
										<th>Branch</th>
										<th className="ops-ledger__r">Accounts</th>
										<th className="ops-ledger__r">Billed</th>
										<th className="ops-ledger__r">Collected</th>
										<th className="ops-ledger__r">Outstanding</th>
										<th className="ops-ledger__r">Rate</th>
									</tr>
								</thead>
								<tbody>
									{byBranch.map((b) => (
										<tr key={b.branch}>
											<td>{branchName(b.branch) || b.branch}</td>
											<td className="ops-ledger__r cn-money">{b.accounts.size}</td>
											<td className="ops-ledger__r cn-money">{b.billed.toFixed(2)}</td>
											<td className="ops-ledger__r cn-money">{b.collected.toFixed(2)}</td>
											<td className="ops-ledger__r cn-money">{b.outstanding.toFixed(2)}</td>
											<td className="ops-ledger__r cn-money">
												<strong>{b.billed > 0 ? `${Math.round((b.collected / b.billed) * 100)}%` : "—"}</strong>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>

			<div className="dash-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "1rem" }}>
				<section className="dash-panel">
					<header className="dash-panel__head">
						<h2 className="dash-panel__title">By what was charged</h2>
						<span className="cn-filter__label">collected in the period</span>
					</header>
					{byType.length === 0 ? (
						<p className="dash-empty">Nothing collected in this period.</p>
					) : (
						byType.map(([type, v]) => (
							<div key={type} className="ops-hbar">
								<span>
									{INVOICE_TYPE_LABELS[type] ?? type}
									{isPassThroughInvoice(type) && <span className="cn-detail__row-note"> pass-through</span>}
								</span>
								<span className="ops-hbar__t">
									<span style={{ width: `${Math.round((v / typeMax) * 100)}%` }} />
								</span>
								<span className="ops-hbar__v">{fmtGhs(v)}</span>
							</div>
						))
					)}
				</section>
				<section className="dash-panel">
					<header className="dash-panel__head">
						<h2 className="dash-panel__title">Century's fee by package</h2>
						<Link to="/packages" className="dash-link">
							Packages →
						</Link>
					</header>
					{byPackage.length === 0 ? (
						<p className="dash-empty">Nothing collected in this period.</p>
					) : (
						byPackage.map((p) => (
							<div key={p.label} className="ops-hbar">
								<span>{p.label}</span>
								<span className="ops-hbar__t">
									<span style={{ width: `${Math.round((p.amount / pkgMax) * 100)}%` }} />
								</span>
								<span className="ops-hbar__v">
									{fmtGhs(p.amount)} · {p.accounts}
								</span>
							</div>
						))
					)}
					<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>
						Aging of the outstanding: current {fmtGhs(figures.aging[0])} · 1–30 d {fmtGhs(figures.aging[1])} · 31–60 d {fmtGhs(figures.aging[2])} · 90+ d {fmtGhs(figures.aging[3])}
					</p>
				</section>
			</div>
		</div>
	);
}
