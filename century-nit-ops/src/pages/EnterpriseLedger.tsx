import { useEffect, useMemo, useState } from "react";
import { useOpsState } from "./OpsStateContext";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { branchName } from "century-nit-core/ops";
import { fmtBoth, fmtUsd, money } from "./currency";
import {
	invoiceBalance,
	invoiceAgeDays,
	type LedgerEntry,
	type InstallmentRow,
} from "century-nit-core/ops";
import { POST_ARRIVAL_SCHEDULES } from "century-nit-core";

/**
 * Client Ledger — a per-applicant financial journal.
 *
 * Shows every financial event (invoice issued, payment, credit, void) as a
 * chronological entry with a running balance, plus an installment schedule
 * view and aging breakdown.
 */
export function EnterpriseLedger() {
	const { applicants, liveCase } = useOpsState();
	const { invoices } = useInvoiceApi();
	const [branchFilter, setBranchFilter] = useState("all");
	const [search, setSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(id);
	}, []);

	const scopedApplicants = useMemo(
		() =>
			branchFilter === "all"
				? applicants
				: applicants.filter((a) => a.branch === branchFilter),
		[applicants, branchFilter],
	);

	const filteredApplicants = useMemo(() => {
		if (!search) return scopedApplicants;
		const q = search.toLowerCase();
		return scopedApplicants.filter(
			(a) =>
				a.name.toLowerCase().includes(q) ||
				a.email.toLowerCase().includes(q) ||
				a.applicantId.toLowerCase().includes(q),
		);
	}, [scopedApplicants, search]);

	// Include live case if present
	const liveApplicant = liveCase?.present
		? {
				id: liveCase.applicationId ?? liveCase.consultationRef ?? "live",
				name: liveCase.name,
				email: liveCase.email ?? "",
				branch: "",
				applicantId: liveCase.applicationId ?? liveCase.consultationRef ?? "live",
				financials: {
					totalAmount: String(liveCase.agencyTotal),
					paidAmount: String(liveCase.agencyPaid),
					outstanding: String(liveCase.agencyTotal - liveCase.agencyPaid),
					plan: liveCase.paymentPlanId ?? "",
				},
			}
		: null;

	const allClients = liveApplicant ? [liveApplicant, ...filteredApplicants] : filteredApplicants;

	const selected = allClients.find((a) => a.id === selectedId) ?? null;

	// Derive ledger entries for the selected client
	const ledger = useMemo<LedgerEntry[]>(() => {
		if (!selected) return [];
		const clientInvoices = invoices.filter(
			(i) => i.applicantId === selected.id || i.applicantName === selected.name,
		);

		const entries: Array<Omit<LedgerEntry, "balance">> = [];

		for (const inv of clientInvoices) {
			// Invoice issued = debit
			entries.push({
				id: `led-${inv.id}-iss`,
				date: inv.issuedAt,
				type: "invoice_issued",
				description: `${inv.type} invoice ${inv.invoiceNumber}`,
				reference: inv.invoiceNumber,
				debit: inv.status === "void" ? 0 : inv.subtotal,
				credit: 0,
			});

			// Payments = credit
			for (const p of inv.payments ?? []) {
				entries.push({
					id: `led-${p.id}`,
					date: p.at,
					type: "payment",
					description: `Payment received — ${p.method}${p.reference ? ` · ${p.reference}` : ""}`,
					reference: p.reference || p.id,
					debit: 0,
					credit: p.amount,
				});
			}

			// Credit note
			if (inv.creditedAmount && inv.creditedAmount > 0) {
				entries.push({
					id: `led-${inv.id}-cr`,
					date: inv.voidedAt ?? inv.issuedAt,
					type: "credit",
					description: `Credit note — ${inv.invoiceNumber}`,
					reference: inv.invoiceNumber,
					debit: 0,
					credit: inv.creditedAmount,
				});
			}

			// Void
			if (inv.status === "void" && inv.voidedAt) {
				entries.push({
					id: `led-${inv.id}-void`,
					date: inv.voidedAt,
					type: "void",
					description: `Voided — ${inv.voidReason ?? "No reason given"}`,
					reference: inv.invoiceNumber,
					debit: 0,
					credit: 0,
				});
			}
		}

		// Sort chronologically
		entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

		// Compute running balance (debit increases what they owe, credit reduces it)
		let running = 0;
		return entries.map((e) => {
			running += e.debit - e.credit;
			return { ...e, balance: Math.max(0, running) };
		});
	}, [selected, invoices]);

	// Derive installment schedule for the selected client
	const installments = useMemo<InstallmentRow[]>(() => {
		if (!selected) return [];
		const live = liveCase?.present && selected.id === (liveCase.applicationId ?? liveCase.consultationRef ?? "live")
			? liveCase
			: null;

		const scheduleId = live?.postArrivalSchedule ?? null;
		if (!scheduleId) return [];

		const schedule = POST_ARRIVAL_SCHEDULES.find((s) => s.id === scheduleId);
		if (!schedule) return [];

		const total = money(selected.financials.totalAmount);
		const postArrivalTotal = Math.round(total * 0.4);
		const perPayment = Math.round(postArrivalTotal / schedule.payments);
		const paidIndex = live?.postArrivalPaymentIndex ?? 0;

		const rows: InstallmentRow[] = [];
		for (let i = 0; i < schedule.payments; i++) {
			const dueDate = new Date(now + (schedule.graceDays + i * schedule.intervalDays) * 86_400_000).toISOString();
			const isPaid = i < paidIndex;
			const isOverdue = !isPaid && new Date(dueDate).getTime() < now;
			rows.push({
				index: i + 1,
				dueDate,
				amount: perPayment,
				status: isPaid ? "paid" : isOverdue ? "overdue" : "pending",
				paidDate: isPaid ? new Date(now - (schedule.intervalDays * (paidIndex - i - 1)) * 86_400_000).toISOString() : null,
			});
		}
		return rows;
	}, [selected, liveCase, now]);

	// Aging breakdown
	const aging = useMemo(() => {
		if (!selected) return { current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
		const clientInvoices = invoices.filter(
			(i) =>
				(i.applicantId === selected.id || i.applicantName === selected.name) &&
				i.status !== "void",
		);
		let current = 0, d30 = 0, d60 = 0, d90 = 0;
		for (const inv of clientInvoices) {
			const bal = invoiceBalance(inv);
			if (bal <= 0) continue;
			const age = invoiceAgeDays(inv);
			if (age === null || age <= 0) current += bal;
			else if (age <= 30) d30 += bal;
			else if (age <= 60) d60 += bal;
			else d90 += bal;
		}
		return { current, d30, d60, d90, total: current + d30 + d60 + d90 };
	}, [selected, invoices]);

	// Summary stats
	const summary = useMemo(() => {
		if (!selected) return { billed: 0, paid: 0, balance: 0 };
		return {
			billed: money(selected.financials.totalAmount),
			paid: money(selected.financials.paidAmount),
			balance: money(selected.financials.outstanding),
		};
	}, [selected]);

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<h1 className="page-title">Client Ledger</h1>
				<p className="lead mt-2">Per-client financial journal — invoices, payments, credits, and installment schedules.</p>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.5rem", alignItems: "start" }}>
				{/* Client list */}
				<div className="card" style={{ padding: 0 }}>
					<div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border-light)" }}>
						<input
							type="text"
							className="input"
							placeholder="Search clients..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							style={{ marginBottom: "0.75rem" }}
						/>
						<BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />
					</div>
					<div style={{ maxHeight: "600px", overflowY: "auto" }}>
						{allClients.length === 0 ? (
							<p style={{ padding: "1.5rem", color: "var(--muted-foreground)", fontSize: "var(--text-sm)" }}>
								No clients found.
							</p>
						) : (
							allClients.map((a) => {
								const isActive = selectedId === a.id;
								const bal = money(a.financials.outstanding);
								return (
									<button
										key={a.id}
										type="button"
										onClick={() => setSelectedId(a.id)}
										style={{
											width: "100%",
											textAlign: "left",
											padding: "0.75rem 1.25rem",
											border: "none",
											borderBottom: "1px solid var(--border-light)",
											background: isActive ? "var(--muted)" : "transparent",
											cursor: "pointer",
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											gap: "0.5rem",
										}}
									>
										<div style={{ minWidth: 0 }}>
											<p style={{ fontWeight: 600, fontSize: "var(--text-sm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
												{a.name}
											</p>
											<p style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
												{a.applicantId}
											</p>
										</div>
										<span
											className="portal-pill"
											style={{
												fontSize: "var(--text-xs)",
												whiteSpace: "nowrap",
												color: bal > 0 ? "var(--foreground)" : "#10b981",
												background: bal > 0 ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
											}}
										>
											{fmtUsd(bal)}
										</span>
									</button>
								);
							})
						)}
					</div>
				</div>

				{/* Ledger detail */}
				{!selected ? (
					<div className="card" style={{ padding: "3rem", textAlign: "center" }}>
						<p style={{ color: "var(--muted-foreground)" }}>Select a client to view their ledger.</p>
					</div>
				) : (
					<div>
						{/* Client header */}
						<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
								<div>
									<h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>{selected.name}</h2>
									<p style={{ color: "var(--muted-foreground)", fontSize: "var(--text-sm)", marginTop: "0.25rem" }}>
										{selected.email} · {selected.applicantId}
										{selected.branch ? ` · ${branchName(selected.branch)}` : ""}
									</p>
								</div>
								<div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: "1.5rem" }}>
									<div>
										<p className="eyebrow">Billed</p>
										<p className="mono" style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{fmtBoth(summary.billed)}</p>
									</div>
									<div>
										<p className="eyebrow">Paid</p>
										<p className="mono" style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "#10b981" }}>{fmtBoth(summary.paid)}</p>
									</div>
									<div>
										<p className="eyebrow">Outstanding</p>
										<p className="mono" style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: summary.balance > 0 ? "#ef4444" : "#10b981" }}>{fmtBoth(summary.balance)}</p>
									</div>
								</div>
							</div>
						</div>

						{/* Aging breakdown */}
						{aging.total > 0 && (
							<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem" }}>
								<h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>Aging Breakdown</h3>
								<div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
									{[
										{ label: "Current", value: aging.current, color: "var(--foreground)" },
										{ label: "1–30 days", value: aging.d30, color: "#f59e0b" },
										{ label: "31–60 days", value: aging.d60, color: "#f97316" },
										{ label: "60+ days", value: aging.d90, color: "#ef4444" },
									].map((b) => (
										<div key={b.label} style={{ textAlign: "center" }}>
											<p className="eyebrow" style={{ fontSize: "var(--text-xs)" }}>{b.label}</p>
											<p className="mono" style={{ fontWeight: 600, fontSize: "var(--text-sm)", marginTop: "0.25rem", color: b.color }}>
												{fmtUsd(b.value)}
											</p>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Installment schedule */}
						{installments.length > 0 && (
							<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem" }}>
								<h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>Installment Schedule</h3>
								<div className="ops-table-wrap">
									<table className="admin-table">
										<thead>
											<tr>
												<th>#</th>
												<th>Due Date</th>
												<th>Amount</th>
												<th>Status</th>
												<th>Paid Date</th>
											</tr>
										</thead>
										<tbody>
											{installments.map((row) => (
												<tr key={row.index}>
													<td style={{ fontWeight: 600 }}>{row.index}</td>
													<td style={{ color: "var(--muted-foreground)" }}>{new Date(row.dueDate).toLocaleDateString()}</td>
													<td className="mono" style={{ fontSize: "var(--text-xs)" }}>{fmtBoth(row.amount)}</td>
													<td>
														<span
															className="portal-pill"
															style={{
																fontSize: "var(--text-xs)",
																color: row.status === "paid" ? "#10b981" : row.status === "overdue" ? "#ef4444" : "var(--muted-foreground)",
																background: row.status === "paid" ? "rgba(16, 185, 129, 0.1)" : row.status === "overdue" ? "rgba(239, 68, 68, 0.1)" : "var(--muted)",
															}}
														>
															{row.status === "paid" ? "Paid" : row.status === "overdue" ? "Overdue" : "Pending"}
														</span>
													</td>
													<td style={{ color: "var(--muted-foreground)" }}>
														{row.paidDate ? new Date(row.paidDate).toLocaleDateString() : "—"}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						)}

						{/* Journal entries */}
						<div className="card" style={{ padding: "1.5rem" }}>
							<h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>Journal Entries</h3>
							{ledger.length === 0 ? (
								<p style={{ color: "var(--muted-foreground)", fontSize: "var(--text-sm)", padding: "1rem", background: "var(--muted)", borderRadius: "6px" }}>
									No financial activity yet for this client.
								</p>
							) : (
								<div className="ops-table-wrap">
									<table className="admin-table">
										<thead>
											<tr>
												<th>Date</th>
												<th>Type</th>
												<th>Description</th>
												<th>Reference</th>
												<th style={{ textAlign: "right" }}>Debit</th>
												<th style={{ textAlign: "right" }}>Credit</th>
												<th style={{ textAlign: "right" }}>Balance</th>
											</tr>
										</thead>
										<tbody>
											{ledger.map((e) => (
												<tr key={e.id}>
													<td style={{ color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{new Date(e.date).toLocaleDateString()}</td>
													<td>
														<span
															className="portal-pill"
															style={{
																fontSize: "var(--text-xs)",
																color: e.type === "payment" ? "#10b981" : e.type === "void" ? "#ef4444" : e.type === "credit" ? "#8b5cf6" : "var(--primary)",
																background: e.type === "payment" ? "rgba(16, 185, 129, 0.1)" : e.type === "void" ? "rgba(239, 68, 68, 0.1)" : e.type === "credit" ? "rgba(139, 92, 246, 0.1)" : "rgba(59, 130, 246, 0.1)",
															}}
														>
															{e.type === "invoice_issued" ? "Invoice" : e.type === "payment" ? "Payment" : e.type === "credit" ? "Credit" : "Void"}
														</span>
													</td>
													<td style={{ fontSize: "var(--text-sm)" }}>{e.description}</td>
													<td style={{ color: "var(--muted-foreground)", fontSize: "var(--text-xs)" }}>{e.reference}</td>
													<td className="mono" style={{ textAlign: "right", fontSize: "var(--text-xs)" }}>{e.debit > 0 ? fmtUsd(e.debit) : "—"}</td>
													<td className="mono" style={{ textAlign: "right", fontSize: "var(--text-xs)", color: "#10b981" }}>{e.credit > 0 ? fmtUsd(e.credit) : "—"}</td>
													<td className="mono" style={{ textAlign: "right", fontSize: "var(--text-xs)", fontWeight: 600 }}>{fmtUsd(e.balance)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
