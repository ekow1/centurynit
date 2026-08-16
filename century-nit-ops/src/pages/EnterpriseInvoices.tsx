import { useMemo, useState } from "react";
import { useOpsAuth } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { InvoiceBuilder } from "./InvoiceBuilder";
import { fmtBoth, fmtGhs, fmtUsd, money } from "./currency";
import {
	INVOICE_STATUS_LABELS,
	invoiceAgeDays,
	invoiceBalance,
	invoicePaid,
	type Invoice,
	type InvoiceStatus,
	type InvoiceType,
	type OpsInvoiceLine,
} from "century-nit-core/ops";
import {
	APP_INVOICE_BASE,
	APP_INVOICE_PER_SCHOOL,
	APP_DOC_VERIFY_FEE,
	APP_MATCH_REVIEW_FEE,
	VISA_INVOICE_AMOUNT,
	VISA_BIOMETRICS_FEE,
	VISA_TRANSLATION_FEE,
	CONSULTATION_FEE_AMOUNT,
} from "century-nit-core";

/**
 * Invoices — the transactional half of finance.
 *
 * Split out from the reports page, which mixed raising and chasing invoices
 * (daily, per-applicant) with revenue analytics (monthly, aggregate). This is
 * where a finance officer works: two views of the same money — by document and
 * by person — and the invoice detail that previously did not exist anywhere.
 */

const STATUS_TABS: ("all" | InvoiceStatus)[] = ["all", "issued", "partial", "overdue", "paid", "void"];

export function EnterpriseInvoices() {
	const { opsUser } = useOpsAuth();
	const {
		applicants,
		liveCase,
		packages,
	} = useOpsState();
	const {
		invoices,
		loading,
		error: invoiceError,
		createInvoice: apiCreateInvoice,
		recordPayment: apiRecordPayment,
		voidInvoice: apiVoidInvoice,
		creditInvoice: apiCreditInvoice,
	} = useInvoiceApi();

	const [view, setView] = useState<"invoices" | "accounts">("invoices");
	const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
	const [search, setSearch] = useState("");
	const [openId, setOpenId] = useState<string | null>(null);
	const [building, setBuilding] = useState<{ applicantId: string; applicantName: string; type: InvoiceType } | null>(null);
	const [flash, setFlash] = useState<string | null>(null);

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

	const totals = useMemo(() => {
		let outstanding = 0;
		let overdue = 0;
		let collected = 0;
		for (const r of rows) {
			outstanding += r.balance;
			if (r.derived === "overdue") overdue += r.balance;
			collected += invoicePaid(r.inv);
		}
		return { outstanding, overdue, collected };
	}, [rows]);

	/** Per-applicant roll-up — the chase list, worst first */
	const accounts = useMemo(() => {
		const map = new Map<string, { name: string; billed: number; paid: number; balance: number; overdue: number; count: number }>();
		for (const r of rows) {
			if (r.inv.status === "void") continue;
			const e = map.get(r.inv.applicantId) ?? {
				name: r.inv.applicantName,
				billed: 0,
				paid: 0,
				balance: 0,
				overdue: 0,
				count: 0,
			};
			e.billed += r.inv.subtotal;
			e.paid += invoicePaid(r.inv);
			e.balance += r.balance;
			if (r.derived === "overdue") e.overdue = Math.max(e.overdue, r.age ?? 0);
			e.count += 1;
			map.set(r.inv.applicantId, e);
		}
		return [...map.entries()]
			.map(([id, v]) => ({ id, ...v }))
			.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
	}, [rows]);

	const liveApplicant = liveCase?.present
		? {
				id: liveCase.applicationId ?? liveCase.consultationRef ?? "live",
				name: liveCase.name,
				pkg: liveCase.fundingTrack ?? "",
				schools: liveCase.schools.length,
			}
		: null;

	return (
		<div className="page-content fade-in">
			<div className="inv-head">
				<div>
					<h1 className="page-title">Invoices</h1>
					<p className="lead mt-2">Raise, chase, and settle. Revenue analytics live under Reports.</p>
				</div>
				<button
					type="button"
					className="btn btn--primary"
					disabled={!liveApplicant && applicants.length === 0}
					onClick={() => {
						const target = liveApplicant ?? { id: applicants[0].id, name: applicants[0].name };
						setBuilding({ applicantId: target.id, applicantName: target.name, type: "Application" });
					}}
				>
					+ New invoice
				</button>
			</div>

			{flash ? <div className="inv-flash">✓ {flash}</div> : null}
		{invoiceError ? <div className="inv-flash" style={{ background: "var(--danger-bg, #fee)" }}>⚠ {invoiceError}</div> : null}
		{loading ? <div className="route-loading" role="status" aria-live="polite"><span className="route-loading__spinner" aria-hidden="true" /></div> : null}

			{/* Live applicant billing summary */}
			{liveCase?.present ? (
				<div className="card" style={{ marginBottom: "2rem", border: "2px solid var(--foreground)" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
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
					</div>

					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
						{/* Consultation invoice */}
						<LiveBillingRow
							label="Consultation invoice"
							status={liveCase.consultationPaid ? "paid" : "not_raised"}
							amount={liveCase.consultationPaid ? liveCase.consultationAmount : CONSULTATION_FEE_AMOUNT}
							onRaise={liveCase.consultationPaid ? undefined : () => setBuilding({ applicantId: liveApplicant!.id, applicantName: liveApplicant!.name, type: "Consultation" })}
						/>

						{/* Application invoice */}
						<LiveBillingRow
							label="Application invoice"
							status={liveCase.appInvoiceStatus === "paid" ? "paid" : liveCase.appInvoiceStatus === "raised" ? "raised" : "not_raised"}
							amount={liveCase.appInvoiceAmount || (APP_INVOICE_BASE + APP_INVOICE_PER_SCHOOL * Math.max(1, liveCase.schools.length) + APP_DOC_VERIFY_FEE + APP_MATCH_REVIEW_FEE)}
							onRaise={liveCase.appInvoiceStatus === "none" ? () => setBuilding({ applicantId: liveApplicant!.id, applicantName: liveApplicant!.name, type: "Application" }) : undefined}
						/>

						{/* Visa invoice */}
						<LiveBillingRow
							label="Visa invoice"
							status={liveCase.visaInvoiceStatus === "paid" ? "paid" : liveCase.visaInvoiceStatus === "raised" ? "raised" : "not_raised"}
							amount={liveCase.visaInvoiceAmount || (VISA_INVOICE_AMOUNT + VISA_BIOMETRICS_FEE + VISA_TRANSLATION_FEE)}
							onRaise={liveCase.visaInvoiceStatus === "none" ? () => setBuilding({ applicantId: liveApplicant!.id, applicantName: liveApplicant!.name, type: "Visa" }) : undefined}
						/>

						{/* Agency service fee */}
						<LiveBillingRow
							label="Agency service fee"
							status={liveCase.agencySettled ? "paid" : liveCase.agencyTotal > 0 ? "partial" : "not_raised"}
							amount={liveCase.agencyTotal}
							paid={liveCase.agencyPaid}
							plan={liveCase.paymentPlanId ?? undefined}
							schedule={liveCase.postArrivalSchedule ?? undefined}
						/>
					</div>
				</div>
			) : null}

			<div className="inv-stats">
				<Stat label="Outstanding" primary={fmtGhs(totals.outstanding)} sub={fmtUsd(totals.outstanding)} />
				<Stat label="Overdue" primary={fmtGhs(totals.overdue)} sub={fmtUsd(totals.overdue)} urgent={totals.overdue > 0} />
				<Stat label="Collected" primary={fmtGhs(totals.collected)} sub={fmtUsd(totals.collected)} inverted />
			</div>

			<div className="inv-tabs" role="tablist" aria-label="Invoice views">
				{(["invoices", "accounts"] as const).map((v) => (
					<button
						key={v}
						role="tab"
						aria-selected={view === v}
						className={`inv-tab${view === v ? " inv-tab--on" : ""}`}
						onClick={() => setView(v)}
					>
						{v === "invoices" ? "By invoice" : "By account"}
						<span className="inv-tab__count">{v === "invoices" ? rows.length : accounts.length}</span>
					</button>
				))}
			</div>

			{view === "invoices" ? (
				<>
					<div className="inv-filters">
						<input
							type="search"
							className="input input--sm"
							placeholder="Search number, applicant, type…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
						<div className="admin-env-tabs">
							{STATUS_TABS.map((t) => (
								<button
									key={t}
									className={`admin-env-tab${status === t ? " admin-env-tab--active" : ""}`}
									onClick={() => setStatus(t)}
								>
									{t === "all" ? "All" : INVOICE_STATUS_LABELS[t]}
								</button>
							))}
						</div>
					</div>

					<div className="inv-split">
						<div className="inv-list">
							{filtered.length === 0 ? (
								<p className="inv-none muted">No invoices match that filter.</p>
							) : (
								filtered.map(({ inv, derived, age, balance }) => (
									<button
										key={inv.id}
										type="button"
										className={`inv-row${openId === inv.id ? " inv-row--on" : ""}`}
										onClick={() => setOpenId(inv.id)}
									>
										<span className="inv-row__top">
											<span className="inv-row__num mono">{inv.invoiceNumber}</span>
											<span className={`inv-status inv-status--${derived}`}>
												{INVOICE_STATUS_LABELS[derived]}
											</span>
										</span>
										<span className="inv-row__who">{inv.applicantName}</span>
										<span className="inv-row__meta mono">
											{inv.type} · {new Date(inv.issuedAt).toLocaleDateString()}
											{derived === "overdue" && age ? ` · ${age}d overdue` : ""}
										</span>
										<span className="inv-row__amt mono">
											{fmtGhs(inv.subtotal)}
											{balance > 0 && balance !== inv.subtotal ? (
												<span className="inv-row__bal"> · {fmtGhs(balance)} due</span>
											) : null}
										</span>
									</button>
								))
							)}
						</div>

						<div className="inv-detail">
							{active ? (
								<InvoiceDetail
									row={active}
									by={by}
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
							) : (
								<div className="inv-blank">
									<p className="inv-blank__title display">Select an invoice</p>
									<p className="muted">
										Line items, payment history, and the actions available on it appear here.
									</p>
								</div>
							)}
						</div>
					</div>
				</>
			) : (
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Applicant</th>
								<th>Invoices</th>
								<th style={{ textAlign: "right" }}>Billed</th>
								<th style={{ textAlign: "right" }}>Paid</th>
								<th style={{ textAlign: "right" }}>Outstanding</th>
								<th>Aging</th>
								<th style={{ textAlign: "right" }}>Action</th>
							</tr>
						</thead>
						<tbody>
							{accounts.length === 0 ? (
								<tr>
									<td colSpan={7} className="muted" style={{ padding: "2rem", textAlign: "center" }}>
										No accounts with invoices yet.
									</td>
								</tr>
							) : (
								accounts.map((acc) => (
									<tr key={acc.id}>
										<td style={{ fontWeight: 500 }}>{acc.name}</td>
										<td className="muted">{acc.count}</td>
										<td style={{ textAlign: "right" }} className="admin-table__mono">{fmtGhs(acc.billed)}</td>
										<td style={{ textAlign: "right" }} className="admin-table__mono">{fmtGhs(acc.paid)}</td>
										<td style={{ textAlign: "right" }} className="admin-table__mono">
											<strong>{fmtGhs(acc.balance)}</strong>
										</td>
										<td>
											{acc.overdue > 0 ? (
												<span className="inv-aging">{acc.overdue}d overdue</span>
											) : (
												<span className="muted">Current</span>
											)}
										</td>
										<td style={{ textAlign: "right" }}>
											<button
												className="btn btn--ghost btn--sm"
												onClick={() => setBuilding({ applicantId: acc.id, applicantName: acc.name, type: "Application" })}
											>
												New invoice
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			)}

			{building ? (
				<InvoiceBuilder
					applicantId={building.applicantId}
					applicantName={building.applicantName}
					type={building.type}
					packages={packages}
					applicantPackage={liveApplicant?.pkg ?? ""}
					schoolCount={liveApplicant?.schools ?? 1}
					onCancel={() => setBuilding(null)}
					onIssue={async (lines: OpsInvoiceLine[], note: string, type: InvoiceType) => {
						const subtotal = lines.reduce((n, l) => n + l.amount, 0);
						try {
							const match = applicants.find((a) => a.id === building.applicantId);
							const applicantEmail =
								match?.email ||
								(liveCase?.email && liveCase.name === building.applicantName
									? liveCase.email
									: undefined);
							await apiCreateInvoice({
								applicantName: building.applicantName,
								applicantEmail,
								type,
								lines,
								note,
							});
							say(`${type} invoice issued — ${fmtBoth(subtotal)} to ${building.applicantName}.`);
							setBuilding(null);
						} catch (e) {
							say(e instanceof Error ? e.message : "Failed to create invoice");
						}
					}}
				/>
			) : null}
		</div>
	);
}

/* ─── Invoice detail ─── */

function InvoiceDetail({
	row,
	by,
	onPay,
	onVoid,
	onCredit,
	onResend,
}: {
	row: { inv: Invoice; derived: InvoiceStatus; age: number | null; balance: number };
	by: string;
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
			<header className="inv-doc__head">
				<div>
					<p className="inv-doc__num mono">{inv.invoiceNumber}</p>
					<p className="inv-doc__who display">{inv.applicantName}</p>
					<p className="mono muted inv-doc__meta">
						{inv.type} · issued {new Date(inv.issuedAt).toLocaleDateString()} by {inv.issuedBy}
						{inv.dueAt ? ` · due ${new Date(inv.dueAt).toLocaleDateString()}` : ""}
					</p>
				</div>
				<span className={`inv-status inv-status--${derived}`}>{INVOICE_STATUS_LABELS[derived]}</span>
			</header>

			<div className="inv-doc__lines">
				{inv.lines.map((l) => (
					<div key={l.id} className="inv-doc__line">
						<span className="inv-doc__line-label">
							{l.label}
							{l.detail ? <span className="inv-doc__line-detail">{l.detail}</span> : null}
						</span>
						<span className="inv-doc__line-amt mono">{fmtGhs(l.amount)}</span>
					</div>
				))}
			</div>

			<div className="inv-doc__totals">
				<Row label="Subtotal" value={fmtBoth(inv.subtotal)} />
				{paid > 0 ? <Row label="Paid" value={`− ${fmtBoth(paid)}`} /> : null}
				{inv.creditedAmount ? <Row label="Credited" value={`− ${fmtBoth(inv.creditedAmount)}`} /> : null}
				<Row label="Balance due" value={fmtBoth(balance)} strong />
			</div>

			{inv.note ? <p className="inv-doc__note">{inv.note}</p> : null}

			{inv.voidReason ? (
				<p className="inv-doc__void">Voided — {inv.voidReason}</p>
			) : null}

			{/* Actions */}
			<div className="inv-doc__actions">
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

			{/* Audit trail */}
			{inv.history?.length ? (
				<div className="inv-doc__history">
					<p className="eyebrow">History</p>
					<ul>
						{[...inv.history].reverse().map((h, i) => (
							<li key={`${h.at}-${i}`}>
								<span className="mono inv-doc__hist-at">{new Date(h.at).toLocaleDateString()}</span>
								<span className="inv-doc__hist-act">{h.action}</span>
								<span className="inv-doc__hist-detail muted">
									{h.detail ? `${h.detail} · ` : ""}
									{h.by}
								</span>
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

function Stat({ label, primary, sub, inverted, urgent }: { label: string; primary: string; sub: string; inverted?: boolean; urgent?: boolean }) {
	return (
		<div className={`inv-stat${inverted ? " inv-stat--inverted" : ""}${urgent ? " inv-stat--urgent" : ""}`}>
			<p className="eyebrow">{label}</p>
			<p className="inv-stat__value">{primary}</p>
			<p className="inv-stat__sub mono">≈ {sub} USD</p>
		</div>
	);
}

function LiveBillingRow({
	label,
	status,
	amount,
	paid,
	plan,
	schedule,
	onRaise,
}: {
	label: string;
	status: "paid" | "raised" | "partial" | "not_raised";
	amount: number;
	paid?: number;
	plan?: string;
	schedule?: string;
	onRaise?: () => void;
}) {
	const statusLabel =
		status === "paid" ? "Paid" :
		status === "raised" ? "Issued" :
		status === "partial" ? "Partial" :
		"Not yet issued";

	const statusClass =
		status === "paid" ? "inv-status--paid" :
		status === "raised" ? "inv-status--issued" :
		status === "partial" ? "inv-status--partial" :
		"inv-status--issued";

	return (
		<div className="card" style={{ padding: "1rem 1.25rem" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
				<span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{label}</span>
				<span className={`inv-status ${statusClass}`} style={{ fontSize: "var(--text-xs)" }}>{statusLabel}</span>
			</div>
			<p className="mono" style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
				{fmtGhs(amount)}
				<span className="muted" style={{ fontWeight: 400, fontSize: "var(--text-xs)", marginLeft: "0.4rem" }}>≈ {fmtUsd(amount)}</span>
			</p>
			{paid !== undefined && paid > 0 && paid < amount ? (
				<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
					Paid {fmtGhs(paid)} · Balance {fmtGhs(amount - paid)}
				</p>
			) : null}
			{plan ? (
				<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
					Plan: {plan === "full" ? "Full payment" : "Installment"}
					{schedule ? ` · ${schedule}` : ""}
				</p>
			) : null}
			{onRaise ? (
				<button
					type="button"
					className="btn btn--primary btn--sm"
					style={{ marginTop: "0.6rem", width: "100%" }}
					onClick={onRaise}
				>
					Raise invoice
				</button>
			) : null}
		</div>
	);
}
