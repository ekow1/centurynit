import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { useFeeCatalogue } from "../hooks/useFeeCatalogue";
import { useOpsAuth } from "./OpsAuthContext";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { CaseScaffold } from "./case/CaseScaffold";
import { branchName, invoiceAgeDays, invoiceBalance, invoicePaid, type Invoice, type LedgerEntry } from "century-nit-core/ops";
import { JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";
import { fmtGhs, fmtUsd, money } from "./currency";

/**
 * Client ledger — one account per client: every invoice, payment and
 * credit as a journal with a running balance, the service fee read as its
 * milestones, and how old what they owe is. Owing accounts first, largest
 * first; settled folded away.
 */

type Cut = "all" | "owing" | "overdue" | "installment" | "settled";
const CUTS: { id: Cut; label: string; strong?: boolean }[] = [
	{ id: "all", label: "All" },
	{ id: "owing", label: "Owing", strong: true },
	{ id: "overdue", label: "Overdue", strong: true },
	{ id: "installment", label: "Instalment" },
	{ id: "settled", label: "Settled" },
];

const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");
const ENTRY_LABEL: Record<LedgerEntry["type"], string> = {
	invoice_issued: "Invoice issued",
	payment: "Payment",
	credit: "Credit note",
	void: "Voided",
};

export function EnterpriseLedger() {
	const { canSeeAllBranches } = useOpsAuth();
	const { applicants, applications } = useCases();
	const { invoices } = useInvoiceApi();
	const { catalogue } = useFeeCatalogue();
	const [branchFilter, setBranchFilter] = useState("all");
	const [cut, setCut] = useState<Cut>("all");
	const [search, setSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [showSettled, setShowSettled] = useState(false);

	/** One account per client: the figures, the plan, how late they are. */
	const accounts = useMemo(() => {
		return applicants
			.filter((a) => branchFilter === "all" || a.branch === branchFilter)
			.map((a) => {
				const app = applications.find((x) => x.applicantId === a.id) ?? null;
				const mine = invoices.filter((i) => i.applicantId === a.id || i.applicantName === a.name);
				const overdueDays = mine.reduce((max, i) => {
					if (i.status === "void" || invoiceBalance(i) <= 0) return max;
					const age = invoiceAgeDays(i);
					return age !== null && age > 0 ? Math.max(max, age) : max;
				}, 0);
				const plan = app?.paymentPlanId ?? (a.financials.plan.toLowerCase().includes("instal") ? "installment" : a.financials.plan ? "full" : null);
				return {
					a,
					app,
					invoices: mine,
					billed: money(a.financials.totalAmount),
					paid: money(a.financials.paidAmount),
					balance: money(a.financials.outstanding),
					overdueDays,
					plan,
				};
			});
	}, [applicants, applications, invoices, branchFilter]);

	const counts = useMemo(
		() => ({
			all: accounts.length,
			owing: accounts.filter((x) => x.balance > 0).length,
			overdue: accounts.filter((x) => x.overdueDays > 0).length,
			installment: accounts.filter((x) => x.plan === "installment" && x.balance > 0).length,
			settled: accounts.filter((x) => x.balance <= 0).length,
		}),
		[accounts],
	);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return accounts.filter((x) => {
			if (cut === "owing" && x.balance <= 0) return false;
			if (cut === "overdue" && x.overdueDays <= 0) return false;
			if (cut === "installment" && x.plan !== "installment") return false;
			if (cut === "settled" && x.balance > 0) return false;
			return !q || x.a.name.toLowerCase().includes(q) || x.a.email.toLowerCase().includes(q) || x.a.applicantId.toLowerCase().includes(q);
		});
	}, [accounts, cut, search]);
	const owing = filtered.filter((x) => x.balance > 0).sort((p, q) => q.overdueDays - p.overdueDays || q.balance - p.balance);
	const settledList = filtered.filter((x) => x.balance <= 0).sort((p, q) => p.a.name.localeCompare(q.a.name));
	const totals = useMemo(
		() => ({
			outstanding: accounts.reduce((n, x) => n + x.balance, 0),
			owing: counts.owing,
			installment: accounts.filter((x) => x.plan === "installment").length,
			overdue: counts.overdue,
		}),
		[accounts, counts],
	);

	const selected = accounts.find((x) => x.a.id === selectedId) ?? null;

	/** The journal: every money event, in order, with the running balance. */
	const ledger = useMemo<(LedgerEntry & { invoiceId: string })[]>(() => {
		if (!selected) return [];
		const entries: Array<Omit<LedgerEntry, "balance"> & { invoiceId: string }> = [];
		for (const inv of selected.invoices) {
			entries.push({ id: `led-${inv.id}-iss`, invoiceId: inv.id, date: inv.issuedAt, type: "invoice_issued", description: inv.lines.length === 1 ? inv.lines[0].label : `${inv.type} · ${inv.lines.length} lines`, reference: inv.invoiceNumber, debit: inv.status === "void" ? 0 : inv.subtotal, credit: 0 });
			for (const p of inv.payments ?? []) {
				entries.push({ id: `led-${p.id}`, invoiceId: inv.id, date: p.at, type: "payment", description: `${p.method}${p.reference ? ` · ${p.reference}` : ""}`, reference: inv.invoiceNumber, debit: 0, credit: p.amount });
			}
			if (inv.creditedAmount && inv.creditedAmount > 0) {
				entries.push({ id: `led-${inv.id}-cr`, invoiceId: inv.id, date: inv.voidedAt ?? inv.issuedAt, type: "credit", description: inv.voidReason ?? "credit note", reference: inv.invoiceNumber, debit: 0, credit: inv.creditedAmount });
			}
			if (inv.status === "void" && inv.voidedAt) {
				entries.push({ id: `led-${inv.id}-void`, invoiceId: inv.id, date: inv.voidedAt, type: "void", description: inv.voidReason ?? "no reason given", reference: inv.invoiceNumber, debit: 0, credit: 0 });
			}
		}
		entries.sort((p, q) => new Date(p.date).getTime() - new Date(q.date).getTime());
		let running = 0;
		return entries.map((e) => {
			running += e.debit - e.credit;
			return { ...e, balance: Math.max(0, running) };
		});
	}, [selected]);

	const aging = useMemo(() => {
		const b = [0, 0, 0, 0];
		for (const inv of selected?.invoices ?? []) {
			if (inv.status === "void") continue;
			const bal = invoiceBalance(inv);
			if (bal <= 0) continue;
			const age = invoiceAgeDays(inv);
			b[age === null || age <= 0 ? 0 : age <= 30 ? 1 : age <= 60 ? 2 : 3] += bal;
		}
		return b;
	}, [selected]);

	/** The service fee as milestones: the Agency invoices, in the order they fall due. */
	const milestones = useMemo(() => {
		if (!selected) return [];
		const split = catalogue?.serviceFeeSplit;
		const agency = selected.invoices.filter((i) => i.type === "Agency" && i.status !== "void").sort((p, q) => p.issuedAt.localeCompare(q.issuedAt));
		const pick = (re: RegExp) => agency.find((i) => re.test(`${i.lines.map((l) => l.label).join(" ")} ${i.note}`));
		const rows: { key: string; label: string; pct: number | null; inv: Invoice | undefined }[] = [
			{ key: "deposit", label: "Deposit", pct: split?.depositPercent ?? null, inv: pick(/deposit/i) },
			{ key: "pre", label: "Pre-departure", pct: split?.preDeparturePercent ?? null, inv: pick(/pre-?departure|milestone/i) },
			{ key: "post", label: "Post-arrival", pct: split?.postArrivalPercent ?? null, inv: pick(/post-?arrival|balance|remainder/i) },
		];
		if (selected.plan === "full") rows.splice(1, 2, { key: "balance", label: "Balance", pct: split ? 100 - split.depositPercent : null, inv: pick(/balance|pre-?departure|remainder/i) });
		return rows;
	}, [selected, catalogue]);
	const stageIdx = selected?.app?.agencyStageIndex ?? 0;

	function downloadStatement() {
		if (!selected) return;
		const head = ["Date", "Entry", "Description", "Reference", "Debit", "Credit", "Balance"];
		const body = ledger.map((e) => [new Date(e.date).toISOString().slice(0, 10), ENTRY_LABEL[e.type], `"${e.description.replace(/"/g, '""')}"`, e.reference, e.debit.toFixed(2), e.credit.toFixed(2), e.balance.toFixed(2)]);
		const csv = [head.join(","), ...body.map((r) => r.join(","))].join("\n");
		const a = document.createElement("a");
		a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
		a.download = `statement-${selected.a.applicantId}-${new Date().toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	const firstOpen = selected?.invoices.find((i) => i.status !== "paid" && i.status !== "void" && i.status !== "proforma" && invoiceBalance(i) > 0) ?? null;

	const row = (x: (typeof accounts)[number]) => {
		const on = selectedId === x.a.id;
		return (
			<button key={x.a.id} type="button" className={`ops-payrow${on ? " ops-payrow--on" : ""}${x.overdueDays > 0 ? " ops-payrow--late" : ""}`} onClick={() => setSelectedId(on ? null : x.a.id)}>
				<span className="ops-payrow__main">
					<span className="ops-payrow__kicker">
						{x.a.applicantId}
						{x.plan ? ` · ${x.plan === "installment" ? "Instalment" : "Full"}` : ""}
					</span>
					<span className="ops-payrow__name">{x.a.name}</span>
				</span>
				<span className="ops-payrow__side">
					{x.balance > 0 ? <span className="ops-payrow__amt">{fmtGhs(x.balance)}</span> : <span className="ops-payrow__net">settled</span>}
					{x.overdueDays > 0 && <span className="ops-payrow__late">{x.overdueDays} d overdue</span>}
				</span>
			</button>
		);
	};

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Client ledger</h1>
					<p className="lead mt-2">One account per client — every invoice, payment and credit, with the plan it sits on.</p>
				</div>
				{canSeeAllBranches && <BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />}
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{fmtGhs(totals.outstanding)}</strong> <span className="dash-day__date">outstanding</span>
				</span>
				<span>
					<strong>{totals.owing}</strong> <span className="dash-day__date">account{totals.owing === 1 ? "" : "s"} owing</span>
				</span>
				<span>
					<strong>{totals.installment}</strong> <span className="dash-day__date">on an instalment plan</span>
				</span>
				<span>
					<strong>{totals.overdue}</strong> <span className="dash-day__date">overdue</span>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/invoices" className="dash-link">
					Invoices →
				</Link>
			</div>

			<CaseScaffold
				bare
				onClose={() => setSelectedId(null)}
				emptyHint="Pick a client to read their account — the journal, the milestones, and how old what they owe is."
				bar={
					selected ? (
						<>
							<span className="cn-filter__label">Account · {selected.a.applicantId}</span>
							{firstOpen && (
								<Link to={`/invoices?open=${firstOpen.id}`} className="btn btn--ghost btn--sm">
									Record a payment
								</Link>
							)}
							<button type="button" className="btn btn--ghost btn--sm" onClick={downloadStatement} disabled={ledger.length === 0}>
								Statement ⤓
							</button>
							{selected.app && (
								<Link to={`/applications?id=${selected.app.id}`} className="btn btn--ghost btn--sm">
									Open case
								</Link>
							)}
						</>
					) : null
				}
				list={
					<>
						<div className="cn-scaffold__filters">
							<div className="cn-scaffold__chips" role="tablist" aria-label="Accounts">
								{CUTS.map((c) => {
									const n = counts[c.id];
									const on = cut === c.id;
									return (
										<button
											key={c.id}
											type="button"
											role="tab"
											aria-selected={on}
											className="ops-pill"
											onClick={() => setCut(c.id)}
											style={{
												cursor: "pointer",
												marginLeft: 0,
												border: "1px solid var(--border)",
												background: on ? "var(--foreground)" : "transparent",
												color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
												fontWeight: c.strong && n > 0 && !on ? 700 : 500,
											}}
										>
											{c.label}
											<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
												{n}
											</span>
										</button>
									);
								})}
							</div>
							<input type="search" className="cn-search" placeholder="Search client…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search clients" />
						</div>
						<div className="cn-scaffold__rows">
							{filtered.length === 0 ? (
								<p className="ops-people__empty">No clients match.</p>
							) : (
								<>
									{owing.length > 0 && (
										<div>
											<div className="ops-band hd-band">
												<span className="ops-band__name">Owing · {owing.length}</span>
												<span className="ops-band__note">latest first</span>
											</div>
											{owing.map(row)}
										</div>
									)}
									{settledList.length > 0 && (
										<div>
											<div
												className="ops-band hd-band ops-band--toggle"
												role="button"
												tabIndex={0}
												onClick={() => setShowSettled((v) => !v)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														setShowSettled((v) => !v);
													}
												}}
											>
												<span className="ops-band__name">Settled · {settledList.length}</span>
												<span className="ops-band__note">{showSettled || cut === "settled" ? "hide" : "show ▸"}</span>
											</div>
											{(showSettled || cut === "settled") && settledList.map(row)}
										</div>
									)}
								</>
							)}
						</div>
					</>
				}
				detail={
					selected ? (
						<div className="cn-detail">
							<div className="card cn-now">
								<span className="cn-detailhead__kicker">
									{selected.plan === "installment" ? "Instalment plan" : selected.plan === "full" ? "Full payment" : "No plan yet"}
									{selected.app?.university ? ` · ${selected.app.university}` : ""}
									{selected.app?.assignedStaff ? ` · ${selected.app.assignedStaff}` : ""}
									{canSeeAllBranches ? ` · ${branchName(selected.a.branch)}` : ""}
								</span>
								<h3 className="cn-detailhead__title">{selected.a.name}</h3>
								<p className="cn-detailhead__sub">
									{selected.app ? `${selected.app.appId} · ${JOURNEY_STAGE_LABELS[selected.app.stage as JourneyStage] ?? selected.app.stage}` : selected.a.applicantId}
									{" · "}
									{selected.a.email}
								</p>
								<div className="ops-figs" style={{ marginTop: "0.75rem" }}>
									<div className="ops-fig">
										<span className="ops-fig__l">Billed</span>
										<span className="ops-fig__v">{fmtGhs(selected.billed)}</span>
									</div>
									<div className="ops-fig">
										<span className="ops-fig__l">Paid</span>
										<span className="ops-fig__v">{fmtGhs(selected.paid)}</span>
									</div>
									<div className={`ops-fig${selected.balance > 0 ? " ops-fig--on" : ""}`}>
										<span className="ops-fig__l">Outstanding</span>
										<span className="ops-fig__v">{fmtGhs(selected.balance)}</span>
									</div>
								</div>
								{aging.some((x) => x > 0) && (
									<>
										<div className="ops-aging" aria-hidden>
											{aging.map((x, i) => (x > 0 ? <span key={i} className={`ops-aging__seg ops-aging__seg--${i + 1}`} style={{ flex: x }} /> : null))}
										</div>
										<div className="ops-aging__l">
											<span>current {aging[0] > 0 ? fmtGhs(aging[0]) : "—"}</span>
											<span>30 {aging[1] > 0 ? fmtGhs(aging[1]) : "—"}</span>
											<span>60 {aging[2] > 0 ? fmtGhs(aging[2]) : "—"}</span>
											<span>90+ {aging[3] > 0 ? fmtGhs(aging[3]) : "—"}</span>
										</div>
									</>
								)}
							</div>

							{selected.plan && (
								<div className="card cn-now">
									<p className="cn-detail__eyebrow">The service fee, in milestones</p>
									<div className="ops-msteps">
										{milestones.map((m, i) => {
											const inv = m.inv;
											const paid = inv ? invoicePaid(inv) : 0;
											const due = inv ? invoiceBalance(inv) : 0;
											const done = inv ? inv.status === "paid" : i < stageIdx;
											const cur = !done && (inv ? true : i === stageIdx);
											return (
												<div key={m.key} className={`ops-mstep${done ? " ops-mstep--done" : cur ? " ops-mstep--cur" : ""}`}>
													<span className="ops-mstep__l">
														{m.label}
														{m.pct !== null ? ` · ${m.pct}%` : ""}
													</span>
													<span className="ops-mstep__v">{inv ? fmtGhs(inv.subtotal) : "—"}</span>
													<span className="ops-mstep__s">
														{inv
															? inv.status === "paid"
																? `paid ${shortDate(inv.payments?.[inv.payments.length - 1]?.at ?? inv.issuedAt)}`
																: `${paid > 0 ? `${fmtGhs(paid)} paid · ` : ""}${fmtGhs(due)} due${inv.dueAt ? ` ${shortDate(inv.dueAt)}` : ""}`
															: done
																? "paid"
																: "not raised yet"}
													</span>
												</div>
											);
										})}
									</div>
								</div>
							)}

							<div className="card cn-now">
								<p className="cn-detail__eyebrow">Journal</p>
								{ledger.length === 0 ? (
									<p className="ops-panel__muted">Nothing on this account yet.</p>
								) : (
									<div className="ops-table-wrap">
										<table className="ops-table ops-ledger">
											<thead>
												<tr>
													<th>Date</th>
													<th>Entry</th>
													<th>Reference</th>
													<th className="ops-ledger__r">Debit</th>
													<th className="ops-ledger__r">Credit</th>
													<th className="ops-ledger__r">Balance</th>
												</tr>
											</thead>
											<tbody>
												{[...ledger].reverse().map((e) => (
													<tr key={e.id}>
														<td className="cn-money">{shortDate(e.date)}</td>
														<td>
															{ENTRY_LABEL[e.type]}
															<div className="ops-ledger__k">{e.description}</div>
														</td>
														<td>
															<Link to={`/invoices?open=${e.invoiceId}`} className="cn-money" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
																{e.reference}
															</Link>
														</td>
														<td className="ops-ledger__r cn-money">{e.debit > 0 ? e.debit.toFixed(2) : ""}</td>
														<td className="ops-ledger__r cn-money">{e.credit > 0 ? e.credit.toFixed(2) : ""}</td>
														<td className="ops-ledger__r cn-money">{e.balance.toFixed(2)}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
								<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>
									GH₵ · {fmtUsd(selected.balance)} outstanding at the platform rate
								</p>
							</div>
						</div>
					) : null
				}
			/>
		</div>
	);
}
