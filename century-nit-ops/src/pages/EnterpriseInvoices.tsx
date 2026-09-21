import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { useCases } from "../hooks/useCases";
import { ApproveInvoiceSheet } from "./case/ApproveInvoiceSheet";
import { CaseScaffold } from "./case/CaseScaffold";
import { getInvoice, type ApiInvoice } from "../lib/api";
import { fmtBoth, fmtGhs, fmtUsd, money } from "./currency";
import {
	INVOICE_STATUS_LABELS,
	invoiceAgeDays,
	invoiceBalance,
	invoicePaid,
	type Invoice,
	type InvoiceStatus,
	type OpsInvoiceLine,
} from "century-nit-core/ops";

/**
 * Invoices — the transactional half of finance.
 *
 * Split out from the reports page, which mixed raising and chasing invoices
 * (daily, per-applicant) with revenue analytics (monthly, aggregate). This is
 * where a finance officer works: two views of the same money — by document and
 * by person — and the invoice detail that previously did not exist anywhere.
 */

/** The agency invoice's note names the plan: "Service package: <name> · <scope>". */
function scopeOf(inv: Invoice): string | null {
	if (inv.type !== "agency") return null;
	const m = /·\s*(Full journey|Admissions \+ Visa|Admissions only)\s*$/.exec(inv.note ?? "");
	return m ? m[1] : null;
}

const TRIGGER_WORDS: Record<string, string> = {
	acceptance: "on acceptance",
	offer: "on the first offer",
	visa_open: "when the visa file opens",
	visa_approved: "on visa approval",
	arrival: "on arrival",
	scheduled: "scheduled",
};

/** Payments cover lines in position order — a line is covered once the running total up to it is paid. */
function coveredLines(lines: OpsInvoiceLine[], paid: number): { line: OpsInvoiceLine; covered: boolean }[] {
	const out: { line: OpsInvoiceLine; covered: boolean }[] = [];
	let cum = 0;
	for (const line of lines) {
		cum += line.amount;
		out.push({ line, covered: paid >= cum - 0.005 });
	}
	return out;
}

/** What a milestone line is waiting for, or when it fell due, or that it is paid. */
function lineDue(l: OpsInvoiceLine, covered: boolean): { text: string; tone: "paid" | "late" | "due" | "waiting" } | null {
	if (!l.dueOn && !l.dueAt) return null;
	if (covered) return { text: "paid", tone: "paid" };
	if (l.dueAt) {
		const at = new Date(l.dueAt);
		const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
		const when = at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
		if (days > 0) return { text: `due ${when} · ${days} d late`, tone: "late" };
		return { text: `due ${when}`, tone: "due" };
	}
	return { text: `waiting · ${TRIGGER_WORDS[l.dueOn ?? ""] ?? l.dueOn}`, tone: "waiting" };
}

const STATUS_CHIPS: { id: "all" | InvoiceStatus; label: string; strong?: boolean }[] = [
	{ id: "all", label: "All" },
	{ id: "proforma", label: "To approve", strong: true },
	{ id: "overdue", label: "Overdue", strong: true },
	{ id: "issued", label: "Issued" },
	{ id: "partial", label: "Partial" },
	{ id: "paid", label: "Paid" },
	{ id: "void", label: "Void" },
];
/** The tone each status takes in a pill — weight and shape, never hue. */
const STATUS_TONE: Record<InvoiceStatus, string> = {
	proforma: "waiting",
	issued: "neutral",
	partial: "neutral",
	overdue: "current",
	paid: "done",
	void: "void",
};
type Band = "approve" | "overdue" | "open" | "settled";
const BAND_LABEL: Record<Band, string> = { approve: "To approve", overdue: "Overdue", open: "Open", settled: "Settled" };
const bandOf = (derived: InvoiceStatus): Band => (derived === "proforma" ? "approve" : derived === "overdue" ? "overdue" : derived === "paid" || derived === "void" ? "settled" : "open");
const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);
/** Aging buckets of an account's open balance, by the oldest unpaid invoice's age. */
function agingOf(rows: { balance: number; age: number | null; derived: InvoiceStatus }[]): [number, number, number, number] {
	const b: [number, number, number, number] = [0, 0, 0, 0];
	for (const r of rows) {
		if (r.balance <= 0 || r.derived === "void") continue;
		const a = r.derived === "overdue" && r.age !== null ? r.age : 0;
		b[a <= 0 ? 0 : a <= 30 ? 1 : a <= 60 ? 2 : 3] += r.balance;
	}
	return b;
}

export function EnterpriseInvoices() {
	const { opsUser } = useOpsAuth();
	// The client's own reference (CN-…) for the account card — invoices carry
	// only the applicant's id, and on older rows that id is the name itself.
	const { applicants } = useCases();
	const refOf = (id: string, name: string) => applicants.find((a) => a.id === id || a.applicantId === id || a.name === name)?.applicantId ?? null;
	const {
		invoices,
		loading,
		error: invoiceError,
		refresh: refreshInvoices,
		recordPayment: apiRecordPayment,
		voidInvoice: apiVoidInvoice,
		creditInvoice: apiCreditInvoice,
	} = useInvoiceApi();


	const [searchParams, setSearchParams] = useSearchParams();
	const [view, setView] = useState<"invoices" | "accounts">("invoices");
	const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
	const [search, setSearch] = useState("");
	const [openId, setOpenId] = useState<string | null>(searchParams.get("open"));
	const [flash, setFlash] = useState<string | null>(null);
	// Approval happens on the case; only an invoice with no case is approved here.
	const [approving, setApproving] = useState<ApiInvoice | null>(null);
	const [showSettled, setShowSettled] = useState(false);
	const [accountCut, setAccountCut] = useState<"all" | "owing" | "overdue" | "settled">("all");

	const by = opsUser?.name ?? "Finance";

	function say(msg: string) {
		setFlash(msg);
		window.setTimeout(() => setFlash(null), 4000);
	}

	/** Overdue is derived from the due date, not stored — so it can't go stale */
	const rows = useMemo(
		() =>
			invoices.map((inv) => {
				const age = invoiceAgeDays(inv);
				const derived: InvoiceStatus =
					inv.status === "overdue" ||
					((inv.status === "issued" || inv.status === "partial") && age !== null && age > 0)
						? "overdue"
						: inv.status;
				return { inv, derived, age, balance: invoiceBalance(inv) };
			}),
		[invoices],
	);

	const filtered = rows.filter((r) => {
		if (status !== "all" && r.derived !== status) return false;
		if (!search) return true;
		const hay = `${r.inv.invoiceNumber} ${r.inv.applicantName} ${r.inv.type}`.toLowerCase();
		return hay.includes(search.toLowerCase());
	});

	const active = rows.find((r) => r.inv.id === openId) ?? null;
	const counts = useMemo(() => {
		const c: Record<InvoiceStatus, number> = { proforma: 0, issued: 0, partial: 0, overdue: 0, paid: 0, void: 0 };
		for (const r of rows) c[r.derived] += 1;
		return c;
	}, [rows]);
	/** Bands by what is needed: approve, chase, wait, done — the queue's order inside each. */
	const bands = useMemo(() => {
		const by: Record<Band, typeof rows> = { approve: [], overdue: [], open: [], settled: [] };
		for (const r of filtered) by[bandOf(r.derived)].push(r);
		by.approve.sort((a, b) => a.inv.issuedAt.localeCompare(b.inv.issuedAt));
		by.overdue.sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
		by.open.sort((a, b) => (a.inv.dueAt ?? "9").localeCompare(b.inv.dueAt ?? "9"));
		by.settled.sort((a, b) => b.inv.issuedAt.localeCompare(a.inv.issuedAt));
		const oldest = by.overdue[0]?.age ?? 0;
		return (
			[
				{ id: "approve" as Band, rows: by.approve, note: "raised by consultants" },
				{ id: "overdue" as Band, rows: by.overdue, note: oldest > 0 ? `oldest ${oldest} d` : "" },
				{ id: "open" as Band, rows: by.open, note: "due soonest first" },
				{ id: "settled" as Band, rows: by.settled, note: `paid ${by.settled.filter((r) => r.derived === "paid").length} · void ${by.settled.filter((r) => r.derived === "void").length} · ${showSettled ? "hide" : "show ▸"}` },
			] as { id: Band; rows: typeof rows; note: string }[]
		).filter((b) => b.rows.length > 0);
	}, [filtered, showSettled]);

	const totals = useMemo(() => {
		let outstanding = 0;
		let overdue = 0;
		let collected = 0;
		let collectedThisWeek = 0;
		const weekAgo = new Date().getTime() - 7 * 86_400_000;
		for (const r of rows) {
			outstanding += r.balance;
			if (r.derived === "overdue") overdue += r.balance;
			collected += invoicePaid(r.inv);
			for (const p of r.inv.payments ?? []) if (new Date(p.at || r.inv.issuedAt).getTime() >= weekAgo) collectedThisWeek += p.amount;
		}
		return { outstanding, overdue, collected, collectedThisWeek };
	}, [rows]);

	/** Per-applicant roll-up — the chase list, worst first */
	const accounts = useMemo(() => {
		const map = new Map<string, { name: string; billed: number; paid: number; balance: number; overdue: number; count: number; rows: typeof rows; toApprove: number; nextDue: string | null }>();
		for (const r of rows) {
			if (r.inv.status === "void") continue;
			const e = map.get(r.inv.applicantId) ?? {
				name: r.inv.applicantName,
				billed: 0,
				paid: 0,
				balance: 0,
				overdue: 0,
				count: 0,
				rows: [] as typeof rows,
				toApprove: 0,
				nextDue: null as string | null,
			};
			e.billed += r.inv.subtotal;
			e.paid += invoicePaid(r.inv);
			e.balance += r.balance;
			if (r.derived === "overdue") e.overdue = Math.max(e.overdue, r.age ?? 0);
			if (r.derived === "proforma") e.toApprove += 1;
			if (r.balance > 0 && r.inv.dueAt && r.derived !== "proforma" && (!e.nextDue || r.inv.dueAt < e.nextDue)) e.nextDue = r.inv.dueAt;
			e.count += 1;
			e.rows.push(r);
			map.set(r.inv.applicantId, e);
		}
		return [...map.entries()]
			.map(([id, v]) => ({ id, ...v }))
			.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
	}, [rows]);

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Invoices</h1>
					<p className="lead mt-2">{view === "invoices" ? "What was raised, chased and settled — the ones that need a hand first." : "By account — who owes what, and how old it is."}</p>
				</div>
				<div className="cn-scaffold__chips" role="tablist" aria-label="View">
					{(["invoices", "accounts"] as const).map((v) => (
						<button key={v} type="button" role="tab" aria-selected={view === v} className={`btn btn--sm ${view === v ? "btn--primary" : "btn--ghost"}`} onClick={() => setView(v)}>
							{v === "invoices" ? "Invoices" : "Accounts"}
						</button>
					))}
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{fmtGhs(totals.outstanding)}</strong> <span className="dash-day__date">outstanding</span>
				</span>
				<span>
					<strong>{fmtGhs(totals.overdue)}</strong> <span className="dash-day__date">overdue · {counts.overdue}</span>
				</span>
				<span>
					<strong>{counts.proforma}</strong> <span className="dash-day__date">to approve</span>
				</span>
				<span>
					<strong>{fmtGhs(totals.collectedThisWeek)}</strong> <span className="dash-day__date">collected this week</span>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/finance" className="dash-link">
					Finance reports →
				</Link>
			</div>

			{flash ? <p className="ops-panel__ok">✓ {flash}</p> : null}
			{invoiceError ? <p className="ops-modal__error">⚠ {invoiceError}</p> : null}
			{loading ? <div className="route-loading" role="status" aria-live="polite"><span className="route-loading__spinner" aria-hidden="true" /></div> : null}

			{view === "invoices" ? (
				<CaseScaffold
					bare
					collapseDetail
					onClose={() => {
						setOpenId(null);
						setSearchParams({});
					}}
					bar={
						active ? (
							<>
								<span className="cn-filter__label">
									{active.inv.invoiceNumber} · {INVOICE_STATUS_LABELS[active.derived]}
								</span>
								{active.inv.applicationId && (
									<Link to={`/applications?id=${active.inv.applicationId}&tab=payments`} className="btn btn--ghost btn--sm">
										Open case
									</Link>
								)}
							</>
						) : null
					}
					list={
						<>
							<div className="cn-scaffold__filters">
								<div className="cn-scaffold__chips" role="tablist" aria-label="Status">
									{STATUS_CHIPS.map((c) => {
										const n = c.id === "all" ? rows.length : counts[c.id];
										const on = status === c.id;
										return (
											<button
												key={c.id}
												type="button"
												role="tab"
												aria-selected={on}
												className="ops-pill"
												onClick={() => setStatus(c.id)}
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
								<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
									<input type="search" className="cn-search" placeholder="Search number, client, type…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" style={{ flex: "1 1 12rem", width: "auto" }} />
								</div>
							</div>
							<div className="cn-scaffold__rows">
								{filtered.length === 0 ? (
									<p className="ops-people__empty">No invoices match that filter.</p>
								) : (
									bands.map((band) => (
										<div key={band.id}>
											<div
												className={`ops-band hd-band${band.id === "settled" ? " ops-band--toggle" : ""}`}
												role={band.id === "settled" ? "button" : undefined}
												tabIndex={band.id === "settled" ? 0 : undefined}
												onClick={band.id === "settled" ? () => setShowSettled((v) => !v) : undefined}
												onKeyDown={
													band.id === "settled"
														? (e) => {
																if (e.key === "Enter" || e.key === " ") {
																	e.preventDefault();
																	setShowSettled((v) => !v);
																}
															}
														: undefined
												}
											>
												<span className="ops-band__name">
													{BAND_LABEL[band.id]} · {band.rows.length}
												</span>
												<span className="ops-band__note">{band.note}</span>
											</div>
											{(band.id !== "settled" || showSettled || status === "paid" || status === "void") &&
												band.rows.map(({ inv, derived, age, balance }) => {
													const on = openId === inv.id;
													const raisedBy = inv.history?.find((h) => /raised|created|proforma/i.test(h.action))?.by ?? inv.issuedBy;
													const story = [
														inv.lines.length === 1 && inv.lines[0]?.label ? inv.lines[0].label : `${inv.lines.length} line${inv.lines.length === 1 ? "" : "s"}`,
														derived === "proforma" ? `raised by ${raisedBy}` : null,
														derived === "proforma" ? shortDate(inv.issuedAt) : inv.dueAt ? `due ${shortDate(inv.dueAt)}` : `issued ${shortDate(inv.issuedAt)}`,
													]
														.filter(Boolean)
														.join(" · ");
													return (
														<button
															key={inv.id}
															type="button"
															className={`ops-payrow${on ? " ops-payrow--on" : ""}${derived === "overdue" ? " ops-payrow--late" : ""}`}
															onClick={() => {
																setOpenId(on ? null : inv.id);
																setSearchParams(on ? {} : { open: inv.id });
															}}
														>
															<span className="ops-payrow__main">
																<span className="ops-payrow__kicker">
																	{inv.invoiceNumber} · {inv.type}
																	{scopeOf(inv) ? ` · ${scopeOf(inv)}` : ""}
																</span>
																<span className="ops-payrow__name">{inv.applicantName}</span>
																<span className="ops-payrow__sub" title={story}>
																	{story}
																</span>
															</span>
															<span className="ops-payrow__side">
																<span className="ops-payrow__amt">{derived === "partial" ? `${fmtGhs(balance)} due` : fmtGhs(inv.subtotal)}</span>
																<span className="ops-payrow__net">{derived === "partial" ? `of ${fmtGhs(inv.subtotal)}` : fmtUsd(inv.subtotal)}</span>
																<span className={`cn-pill cn-pill--${STATUS_TONE[derived]}`}>{INVOICE_STATUS_LABELS[derived]}</span>
																{derived === "overdue" && age ? <span className="ops-payrow__late">{age} d late</span> : null}
															</span>
														</button>
													);
												})}
										</div>
									))
								)}
							</div>
						</>
					}
					detail={
						active ? (
							<InvoiceDetail
								row={active}
								by={by}
								account={accounts.find((a) => a.id === active.inv.applicantId) ?? null}
								onApprove={async () => {
									try {
										setApproving(await getInvoice(active.inv.id));
									} catch (e) {
										say(e instanceof Error ? e.message : "Could not load the invoice");
									}
								}}
								onPay={async (amt, method, ref) => {
									try {
										await apiRecordPayment(active.inv.id, amt, method, ref);
										say(`Payment recorded on ${active.inv.invoiceNumber}.`);
									} catch (e) {
										say(e instanceof Error ? e.message : "Payment failed");
									}
								}}
								onVoid={async (reason) => {
									try {
										await apiVoidInvoice(active.inv.id, reason);
										say(`${active.inv.invoiceNumber} voided.`);
									} catch (e) {
										say(e instanceof Error ? e.message : "Void failed");
									}
								}}
								onCredit={async (amt, reason) => {
									try {
										await apiCreditInvoice(active.inv.id, amt, reason);
										say(`Credit note issued on ${active.inv.invoiceNumber}.`);
									} catch (e) {
										say(e instanceof Error ? e.message : "Credit failed");
									}
								}}
								onResend={() => {
									say(`${active.inv.invoiceNumber} re-sent to ${active.inv.applicantName}.`);
								}}
							/>
						) : null
					}
				/>
			) : (
				<>
					<div className="cn-scaffold__filters" style={{ border: "1px solid var(--border-light)" }}>
						<div className="cn-scaffold__chips" role="tablist" aria-label="Accounts">
							{(
								[
									["all", "All", accounts.length],
									["owing", "Owing", accounts.filter((a) => a.balance > 0).length],
									["overdue", "Overdue", accounts.filter((a) => a.overdue > 0).length],
									["settled", "Settled", accounts.filter((a) => a.balance <= 0).length],
								] as const
							).map(([id, label, n]) => {
								const on = accountCut === id;
								return (
									<button
										key={id}
										type="button"
										role="tab"
										aria-selected={on}
										className="ops-pill"
										onClick={() => setAccountCut(id)}
										style={{
											cursor: "pointer",
											marginLeft: 0,
											border: "1px solid var(--border)",
											background: on ? "var(--foreground)" : "transparent",
											color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
											fontWeight: (id === "owing" || id === "overdue") && n > 0 && !on ? 700 : 500,
										}}
									>
										{label}
										<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
											{n}
										</span>
									</button>
								);
							})}
						</div>
						<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
							<input type="search" className="cn-search" placeholder="Search client…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search accounts" style={{ flex: "1 1 12rem", width: "auto" }} />
						</div>
					</div>
					{(() => {
						const q = search.trim().toLowerCase();
						const list = accounts.filter((a) => {
							if (accountCut === "owing" && a.balance <= 0) return false;
							if (accountCut === "overdue" && a.overdue <= 0) return false;
							if (accountCut === "settled" && a.balance > 0) return false;
							return !q || a.name.toLowerCase().includes(q);
						});
						const owing = list.filter((a) => a.balance > 0);
						const settledList = list.filter((a) => a.balance <= 0);
						const card = (a: (typeof accounts)[number]) => {
							const aging = agingOf(a.rows);
							const total = aging.reduce((n, x) => n + x, 0);
							const foot = [a.count === 1 ? "1 invoice" : `${a.count} invoices`, a.toApprove > 0 ? `${a.toApprove} to approve` : null, a.overdue > 0 ? `${a.overdue} d overdue` : a.nextDue ? `next due ${shortDate(a.nextDue)}` : null]
								.filter(Boolean)
								.join(" · ");
							return (
								<div key={a.id} className={`ops-acct${a.overdue > 0 ? " ops-acct--late" : ""}`}>
									<div className="ops-acct__head">
										<span className="ops-acct__name" title={a.name}>
											{a.name}
										</span>
										{refOf(a.id, a.name) && <span className="ops-acct__ref">{refOf(a.id, a.name)}</span>}
									</div>
									<div className="ops-figs">
										<div className="ops-fig">
											<span className="ops-fig__l">Billed</span>
											<span className="ops-fig__v">{fmtGhs(a.billed)}</span>
										</div>
										<div className="ops-fig">
											<span className="ops-fig__l">Paid</span>
											<span className="ops-fig__v">{fmtGhs(a.paid)}</span>
										</div>
										<div className={`ops-fig${a.balance > 0 ? " ops-fig--on" : ""}`}>
											<span className="ops-fig__l">Outstanding</span>
											<span className="ops-fig__v">{fmtGhs(a.balance)}</span>
										</div>
									</div>
									{total > 0 && (
										<>
											<div className="ops-aging" aria-hidden>
												{aging.map((x, i) => (x > 0 ? <span key={i} className={`ops-aging__seg ops-aging__seg--${i + 1}`} style={{ flex: x }} /> : null))}
											</div>
											<div className="ops-aging__l">
												{(["current", "1–30 d", "31–60 d", "90+ d"] as const).map((label, i) =>
													aging[i] > 0 ? (
														<span key={label}>
															{label} {fmtGhs(aging[i])}
														</span>
													) : null,
												)}
											</div>
										</>
									)}
									<div className="ops-acct__foot">
										<span>{foot}</span>
										<button
											type="button"
											className="btn btn--ghost btn--sm"
											onClick={() => {
												setSearch(a.name);
												setView("invoices");
											}}
										>
											Invoices →
										</button>
									</div>
								</div>
							);
						};
						return list.length === 0 ? (
							<p className="ops-people__empty">No accounts match.</p>
						) : (
							<div className="ops-bands" style={{ padding: 0 }}>
								{owing.length > 0 && (
									<div>
										<div className="ops-band">
											<span className="ops-band__name">Owing · {owing.length}</span>
											<span className="ops-band__note">largest first</span>
										</div>
										<div className="ops-people ops-people--three">{owing.map(card)}</div>
									</div>
								)}
								{settledList.length > 0 && (
									<div>
										<div className="ops-band ops-band--toggle" role="button" tabIndex={0} onClick={() => setShowSettled((v) => !v)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowSettled((v) => !v); } }}>
											<span className="ops-band__name">Settled · {settledList.length}</span>
											<span className="ops-band__note">{showSettled || accountCut === "settled" ? "hide" : "show ▸"}</span>
										</div>
										{(showSettled || accountCut === "settled") && <div className="ops-people ops-people--three">{settledList.map(card)}</div>}
									</div>
								)}
							</div>
						);
					})()}
				</>
			)}

			<ApproveInvoiceSheet
				invoice={approving}
				onClose={() => setApproving(null)}
				onIssued={async (updated) => {
					await refreshInvoices();
					say(`${updated.invoiceNumber} approved and issued.`);
				}}
				onDeclined={async (voided) => {
					await refreshInvoices();
					say(`${voided.invoiceNumber} declined and voided.`);
				}}
			/>
		</div>
	);
}

/* ─── Invoice detail ─── */

function InvoiceDetail({
	row,
	account,
	by,
	onApprove,
	onPay,
	onVoid,
	onCredit,
	onResend,
}: {
	row: { inv: Invoice; derived: InvoiceStatus; age: number | null; balance: number };
	account: { balance: number; overdue: number; count: number; toApprove: number; nextDue: string | null } | null;
	by: string;
	/** Approve here — only for a draft with no case to approve it on. */
	onApprove: () => Promise<void>;
	onPay: (amount: number, method: string, reference: string) => void;
	onVoid: (reason: string) => void;
	onCredit: (amount: number, reason: string) => void;
	onResend: () => void;
}) {
	const { inv, derived, balance } = row;
	const [panel, setPanel] = useState<"none" | "pay" | "void" | "credit">("none");
	const [amount, setAmount] = useState("");
	const [method, setMethod] = useState("Bank Transfer");
	const [reference, setReference] = useState("");
	const [reason, setReason] = useState("");

	const isProforma = inv.status === "proforma";
	const paid = invoicePaid(inv);
	const closed = inv.status === "void" || balance === 0;

	function reset() {
		setPanel("none");
		setAmount("");
		setReference("");
		setReason("");
	}

	return (
		<div className="inv-doc">
			{isProforma ? (
				<div style={{ border: "1px solid var(--foreground)", borderLeftWidth: "4px", padding: "0.85rem 1rem", marginBottom: "1.25rem" }}>
					<strong>Awaiting approval</strong>
					<p className="muted mt-1" style={{ fontSize: "var(--text-xs)" }}>
						Raised by {inv.issuedBy || "—"}. The client cannot see or pay it until it is approved and issued
						{inv.applicationId ? " — on the case." : "."}
					</p>
				</div>
			) : null}

			<header className="inv-doc__head">
				<div>
					<p className="inv-doc__num mono">{inv.invoiceNumber}</p>
					<p className="inv-doc__who display">{inv.applicantName}</p>
					<p className="mono muted inv-doc__meta">
						{inv.type} · {isProforma ? `raised ${new Date(inv.issuedAt).toLocaleDateString()}` : `issued ${new Date(inv.issuedAt).toLocaleDateString()} by ${inv.issuedBy}`}
						{inv.dueAt ? ` · due ${new Date(inv.dueAt).toLocaleDateString()}` : ""}
					</p>
				</div>
				<span className={`inv-status inv-status--${derived}`}>{INVOICE_STATUS_LABELS[derived]}</span>
			</header>

			<div className="inv-doc__lines">
				{coveredLines(inv.lines, paid).map(({ line: l, covered }) => {
						const due = lineDue(l, covered);
						return (
							<div key={l.id} className="inv-doc__line">
								<span className="inv-doc__line-label">
									{l.label}
									{l.detail ? <span className="inv-doc__line-detail">{l.detail}</span> : null}
									{due ? (
										<span className="inv-doc__line-detail mono" style={{ color: due.tone === "late" ? "var(--bad, #b91c1c)" : due.tone === "paid" ? "var(--ok, #0d7a3f)" : undefined }}>
											{due.text}
										</span>
									) : null}
								</span>
								<span className="inv-doc__line-amt mono">{fmtGhs(l.amount)}</span>
							</div>
						);
					})}
			</div>

			<div className="inv-doc__totals">
				<Row label="Subtotal" value={fmtBoth(inv.subtotal)} />
				{paid > 0 ? <Row label="Paid" value={`− ${fmtBoth(paid)}`} /> : null}
				{inv.creditedAmount ? <Row label="Credited" value={`− ${fmtBoth(inv.creditedAmount)}`} /> : null}
				<Row label={isProforma ? "Total to approve" : "Balance due"} value={fmtBoth(balance)} strong />
			</div>

			{inv.note ? <p className="inv-doc__note">{inv.note}</p> : null}

			{inv.voidReason ? (
				<p className="inv-doc__void">Voided — {inv.voidReason}</p>
			) : null}

			{/* Actions */}
			<div className="inv-doc__actions">
				{isProforma ? (
					inv.applicationId ? (
						<Link to={`/applications?id=${inv.applicationId}&tab=payments`} className="btn btn--sm btn--primary">
							Approve on the case →
						</Link>
					) : (
						<button type="button" className="btn btn--sm btn--primary" onClick={() => void onApprove()}>
							Approve & issue
						</button>
					)
				) : (
					<>
						<button type="button" className="btn btn--ghost btn--sm" onClick={onResend}>
							Re-send
						</button>
						{!closed ? (
							<>
								<button
									type="button"
									className={`btn btn--sm ${panel === "pay" ? "btn--primary" : "btn--ghost"}`}
									onClick={() => setPanel(panel === "pay" ? "none" : "pay")}
								>
									Record payment
								</button>
								<button
									type="button"
									className={`btn btn--sm ${panel === "credit" ? "btn--primary" : "btn--ghost"}`}
									onClick={() => setPanel(panel === "credit" ? "none" : "credit")}
								>
									Credit note
								</button>
								<button
									type="button"
									className={`btn btn--sm ${panel === "void" ? "btn--primary" : "btn--ghost"}`}
									onClick={() => setPanel(panel === "void" ? "none" : "void")}
								>
									Void
								</button>
							</>
						) : null}
					</>
				)}
			</div>

			{panel === "pay" ? (
				<form
					className="inv-form"
					onSubmit={(e) => {
						e.preventDefault();
						const n = money(amount);
						if (n <= 0) return;
						onPay(Math.min(n, balance), method, reference.trim());
						reset();
					}}
				>
					<p className="eyebrow">Record a payment</p>
					<div className="inv-form__grid">
						<label>
							<span className="inv-form__label mono">Amount (USD)</span>
							<input className="input input--sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(balance)} />
						</label>
						<label>
							<span className="inv-form__label mono">Method</span>
							<select className="input input--sm" value={method} onChange={(e) => setMethod(e.target.value)}>
								<option>Visa Card</option>
								<option>Mastercard</option>
								<option>Bank Transfer</option>
								<option>Mobile Money</option>
								<option>Direct Debit</option>
							</select>
						</label>
						<label>
							<span className="inv-form__label mono">Reference</span>
							<input className="input input--sm" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
						</label>
					</div>
					<div className="inv-form__foot">
						<button type="submit" className="btn btn--primary btn--sm" disabled={money(amount) <= 0}>
							Record {money(amount) > 0 ? fmtBoth(Math.min(money(amount), balance)) : ""}
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
						<span className="mono muted inv-form__hint">Part payments leave the balance open.</span>
					</div>
				</form>
			) : null}

			{panel === "credit" ? (
				<form
					className="inv-form"
					onSubmit={(e) => {
						e.preventDefault();
						const n = money(amount);
						if (n <= 0 || !reason.trim()) return;
						onCredit(Math.min(n, balance), reason.trim());
						reset();
					}}
				>
					<p className="eyebrow">Issue a credit note</p>
					<div className="inv-form__grid">
						<label>
							<span className="inv-form__label mono">Amount (USD)</span>
							<input className="input input--sm" value={amount} onChange={(e) => setAmount(e.target.value)} />
						</label>
						<label style={{ gridColumn: "span 2" }}>
							<span className="inv-form__label mono">Reason</span>
							<input className="input input--sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shown on the applicant's statement" />
						</label>
					</div>
					<div className="inv-form__foot">
						<button type="submit" className="btn btn--primary btn--sm" disabled={money(amount) <= 0 || !reason.trim()}>
							Issue credit note
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
					</div>
				</form>
			) : null}

			{panel === "void" ? (
				<form
					className="inv-form"
					onSubmit={(e) => {
						e.preventDefault();
						if (!reason.trim()) return;
						onVoid(reason.trim());
						reset();
					}}
				>
					<p className="eyebrow">Void this invoice</p>
					<input className="input input--sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being voided?" />
					<div className="inv-form__foot">
						<button type="submit" className="btn btn--primary btn--sm" disabled={!reason.trim()}>
							Void {inv.invoiceNumber}
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
						<span className="mono muted inv-form__hint">The record is kept — nothing is deleted.</span>
					</div>
				</form>
			) : null}

			{account && (
				<div className="card cn-now" style={{ marginTop: "1rem" }}>
					<p className="cn-detail__eyebrow">The account</p>
					<div className="cn-detail__rows">
						<div className="cn-detail__row">
							<span>
								{account.count} invoice{account.count === 1 ? "" : "s"} · {fmtGhs(account.balance)} outstanding
							</span>
							<span className="cn-detail__row-note">{account.overdue > 0 ? `${account.overdue} d overdue` : account.nextDue ? `next due ${shortDate(account.nextDue)}` : "nothing overdue"}</span>
						</div>
						<Link to="/ledger" className="cn-detail__row">
							<span>Client ledger</span>
							<span className="cn-detail__row-note">journal & milestones →</span>
						</Link>
					</div>
				</div>
			)}
			{inv.history?.length ? (
				<div className="card cn-now" style={{ marginTop: "1rem" }}>
					<p className="cn-detail__eyebrow">History</p>
					<ul className="cn-timeline">
						{[...inv.history].reverse().map((h, i) => (
							<li key={`${h.at}-${i}`} className="cn-timeline__item">
								<div className="cn-timeline__head">
									<span className="cn-timeline__summary">{h.action}</span>
									<span className="cn-timeline__when">{new Date(h.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
								</div>
								<p className="cn-timeline__meta">
									{h.detail ? `${h.detail} · ` : ""}
									{h.by}
								</p>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<p className="mono muted inv-doc__by">Acting as {by}</p>
		</div>
	);
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
	return (
		<div className={`inv-doc__total-row${strong ? " inv-doc__total-row--strong" : ""}`}>
			<span>{label}</span>
			<span className="mono">{value}</span>
		</div>
	);
}

