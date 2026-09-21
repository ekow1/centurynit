import { useEffect, useState } from "react";
import { TRIGGER_WORDS, lineDue } from "../../../lib/invoiceLines";
import { InvoiceDetail } from "../InvoiceDetail";
import { useInvoiceApi } from "../../../hooks/useInvoiceApi";
import { invoiceBalance, invoiceAgeDays } from "century-nit-core/ops";
import { getInvoice } from "../../../lib/api";
import { Link } from "react-router-dom";

import { useCases } from "../../../hooks/useCases";
import { useOpsAuth } from "../../OpsAuthContext";
import { useFeeCatalogue } from "../../../hooks/useFeeCatalogue";
import { InvoiceCard, formatMoney } from "century-nit-core/ui";
import { POST_ARRIVAL_FREQUENCY_LABELS, postArrivalInstalments, postArrivalInterestCents, type LedgerRow, type PostArrivalFrequency } from "century-nit-shared";
import { applicationsApi } from "century-nit-core/api";
import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";
import type { Flash, Fail } from "./types";
import { ApproveInvoiceSheet } from "../ApproveInvoiceSheet";
import { RaiseInvoiceSheet } from "../RaiseInvoiceSheet";

const INVOICE_TYPE_TITLES: Record<string, string> = {
	application: "Application",
	visa: "Visa",
	agency: "Service package",
	travel: "Ticket",
	consultation: "Consultation",
	custom: "Custom",
};


/** Money — plan and milestones, completion, every invoice on the case. */
export function MoneyTab({
	app,
	caseInvoices,
	canWork,
	canIssueInvoices,
	completeBlock,
	onInvoicesChanged,
	flash,
	fail,
}: {
	app: MockApplication;
	caseInvoices: ApiInvoice[];
	canWork: boolean;
	canIssueInvoices: boolean;
	/** Why the case cannot be marked complete yet, or null. */
	completeBlock: string | null;
	/** An invoice was issued or voided here; the parent reloads the case's invoices. */
	onInvoicesChanged: () => void;
	flash: Flash;
	fail: Fail;
}) {
	const { setApplicationStage, setPaymentPlan, refresh } = useCases();
	const { hasCapability, opsUser } = useOpsAuth();
	const { catalogue } = useFeeCatalogue();
	const canApproveSchedules = hasCapability("approve_schedules");
	const interestPct = catalogue?.postArrival?.interestPct ?? 0;
	const [planDraft, setPlanDraft] = useState<"" | "full" | "installment">("");
	const [approving, setApproving] = useState<ApiInvoice | null>(null);
	const [raising, setRaising] = useState(false);
	const [ledger, setLedger] = useState<LedgerRow[]>([]);
	useEffect(() => {
		let cancelled = false;
		applicationsApi
			.ledger(app.id)
			.then((res) => {
				if (!cancelled) setLedger(res.rows);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [app.id, caseInvoices]);
	// The service fee as the ledger carries it — the live agency invoice's
	// lines, each covered or not by the payments so far, dated once the
	// post-arrival schedule is chosen.
	const agencyInv = caseInvoices.filter((i) => i.type === "agency" && i.status !== "void").sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0] ?? null;
	const today = new Date().getTime();
	const feeRows = (() => {
		if (!agencyInv) return [];
		let cum = 0;
		const lastPay = [...agencyInv.payments].sort((x, y) => (x.at < y.at ? 1 : -1))[0];
		return agencyInv.lines.map((l, i) => {
			const before = cum;
			cum += l.amountCents;
			const covered = agencyInv.paidCents >= cum;
			const partly = !covered && agencyInv.paidCents > before;
			const due = l.dueAt ? new Date(l.dueAt).getTime() : null;
			const days = due ? Math.round((due - today) / 86_400_000) : null;
			const late = !covered && days !== null && days < 0;
			const isNext = !covered && agencyInv.paidCents >= before;
			return { l, i, covered, partly, days, late, isNext, paidAt: covered ? (lastPay?.at ?? null) : null };
		});
	})();
	// Per-stage lines (a plan that stops short, or one that grew) carry their own
	// trigger; the full-journey split is still read by position.
	const stageLines = Boolean(agencyInv?.lines.some((l) => l.dueOn && l.dueOn !== "acceptance" && l.dueOn !== "visa_approved" && l.dueOn !== "arrival" && l.dueOn !== "scheduled"));
	// The ledger's own rows for this case — the same adapter and actions the
	// Invoices page uses, so a payment recorded here is the payment.
	const invoiceApi = useInvoiceApi();
	const caseLedger = invoiceApi.invoices.filter((i) => i.applicationId === app.id && i.status !== "void");
	const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
	const openRow = caseLedger.find((i) => i.id === openInvoiceId) ?? null;
	const [schedOpen, setSchedOpen] = useState(false);
	const [schedMonths, setSchedMonths] = useState("6");
	const [schedFreq, setSchedFreq] = useState<PostArrivalFrequency>("monthly");
	const [schedReason, setSchedReason] = useState("");
	const [schedBusy, setSchedBusy] = useState(false);
	const [reviewStart, setReviewStart] = useState("");
	const [reviewDeclining, setReviewDeclining] = useState(false);
	const [reviewReason, setReviewReason] = useState("");
	const [reviewBusy, setReviewBusy] = useState(false);
	const postArrivalPaid = feeRows.some((r) => r.i >= 2 && (r.covered || r.partly));
	const remainderCents = feeRows.filter((r) => r.i >= 2).reduce((n, r) => n + r.l.amountCents, 0);
	const reviewPreview =
		app.postArrivalStatus === "pending" && app.postArrivalMonths && app.postArrivalFrequency && reviewStart
			? postArrivalInstalments({
					amountCents: remainderCents,
					months: app.postArrivalMonths,
					frequency: app.postArrivalFrequency as PostArrivalFrequency,
					anchor: new Date(reviewStart),
					graceDays: 0,
					interestPct,
				})
			: null;
	async function saveSchedule() {
		setSchedBusy(true);
		try {
			await applicationsApi.setPostArrivalSchedule(app.id, { months: Number.parseInt(schedMonths, 10), frequency: schedFreq, reason: schedReason.trim() });
			await refresh();
			onInvoicesChanged();
			setSchedOpen(false);
			setSchedReason("");
			flash("Schedule requested — finance or a manager sets the start date and approves it.");
		} catch (e) {
			fail(e, "Could not set the schedule");
		} finally {
			setSchedBusy(false);
		}
	}
	async function reviewSchedule(approve: boolean) {
		setReviewBusy(true);
		try {
			await applicationsApi.reviewPostArrivalSchedule(
				app.id,
				approve ? { decision: "approve", startAt: new Date(reviewStart).toISOString() } : { decision: "decline", reason: reviewReason.trim() },
			);
			await refresh();
			onInvoicesChanged();
			setReviewStart("");
			setReviewReason("");
			setReviewDeclining(false);
			flash(approve ? "Plan approved — the dated instalments are on the portal." : "Request declined — the client can pick again.");
		} catch (e) {
			fail(e, "Could not review the schedule");
		} finally {
			setReviewBusy(false);
		}
	}
	const fmtDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);
	// Channels in the client's words, not Paystack's codes.
	const channelLabel = (c: string | null | undefined) =>
		!c ? null : c === "paystack-mobile_money" ? "MoMo" : c === "paystack-card" ? "Card" : c === "manual" || c === "cash" ? "Office" : c;
	return (
		<>
			<div className="card">
				<p className="eyebrow mb-2">Payment plan & service fee</p>
				<div className="ops-grid cn-facts">
					<div><p className="muted text-xs">Plan</p><p>{app.paymentPlanId === "full" ? "Full payment" : app.paymentPlanId === "installment" ? "Installments" : "Not chosen"}</p></div>
					<div><p className="muted text-xs">Milestones paid</p><p>{app.agencyStageIndex ?? 0} · {app.agencySettled ? "settled" : "outstanding"}</p></div>
					<div><p className="muted text-xs">Application fee</p><p>{app.appFeePaid ? "Paid" : "Unpaid"}</p></div>
					<div><p className="muted text-xs">Visa invoice</p><p>{app.visaInvoicePaid ? "Paid" : "Unpaid"}</p></div>
				</div>
				<p className="muted mt-3 text-xs">
					Paid state follows the ledger: record payments against the service-fee invoice and these figures update. The pre-departure milestone holds the travel documents, never the flight.
				</p>
				{app.stage === "travel_assistance" && canWork && (
					<div className="mt-3" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
						{!app.paymentPlanId && (
							<>
								<select
									className="select input input--sm"
									value={planDraft}
									onChange={(e) => setPlanDraft(e.target.value as "" | "full" | "installment")}
									aria-label="Payment plan"
									style={{ width: "auto" }}
								>
									<option value="">Payment plan…</option>
									<option value="full">Full payment</option>
									<option value="installment">Installments</option>
								</select>
								<button
									type="button"
									className="btn btn--sm btn--ghost"
									disabled={!planDraft}
									onClick={() =>
										planDraft &&
										void setPaymentPlan(app.appId, planDraft)
											.then(() => { setPlanDraft(""); flash("Payment plan recorded."); })
											.catch((e) => fail(e, "Could not record the plan"))
									}
								>
									Record plan
								</button>
							</>
						)}
						<button
							type="button"
							className="btn btn--sm btn--primary"
							disabled={Boolean(completeBlock)}
							title={completeBlock ?? undefined}
							onClick={() => void setApplicationStage(app.appId, "completed").then(() => flash("Case marked complete.")).catch((e) => fail(e, "Could not complete the case"))}
						>
							Mark case complete
						</button>
						{completeBlock && <span className="muted text-xs">{completeBlock}</span>}
					</div>
				)}
			</div>
			{agencyInv && feeRows.length > 0 && (
				<div className="card">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }} className="mb-2">
						<p className="eyebrow" style={{ margin: 0 }}>
							Service fee · {app.paymentPlanId === "installment" ? "instalment plan" : app.paymentPlanId === "full" ? "full payment" : "plan not chosen"} · {formatMoney(agencyInv.subtotalCents, "ghs")}
						</p>
						<span className="text-xs mono muted">
							paid {formatMoney(agencyInv.paidCents, "ghs")}
							{agencyInv.subtotalCents > 0 ? ` · ${Math.round((agencyInv.paidCents / agencyInv.subtotalCents) * 100)}%` : ""}
						</span>
					</div>
					<div className="cn-fee">
						{feeRows.map(({ l, i, covered, partly, days, late, isNext, paidAt }) => (
							<div key={l.id} className={`cn-fee__r${covered ? " cn-fee__r--paid" : late ? " cn-fee__r--late" : isNext ? " cn-fee__r--due" : ""}`}>
								<span className="cn-fee__i">
									{stageLines
										? (l.dueOn ? TRIGGER_WORDS[l.dueOn] ?? l.dueOn : "—")
										: i === 0 ? "deposit" : i === 1 ? (app.paymentPlanId === "full" ? "balance" : "pre-dep") : `${i - 1} / ${feeRows.length - 2}`}
								</span>
								<span className="cn-fee__d">{fmtDay(l.dueAt) ?? (l.dueOn && !l.dueAt ? "not yet" : i === 0 ? fmtDay(agencyInv.createdAt) : i === 1 ? "after visa" : "after arrival")}</span>
								<span>
									{l.label.replace(/^Service fee · /, "")}
									{l.detail ? <span className="muted"> · {l.detail}</span> : null}
								</span>
								<span className="cn-fee__a">{formatMoney(l.amountCents, "ghs")}</span>
								<span className="cn-fee__s">
									{covered
										? `✓ paid${paidAt ? ` ${fmtDay(paidAt)}` : ""}`
										: partly
											? "part paid"
											: late
												? `${-days!} day${days === -1 ? "" : "s"} late`
												: days !== null
													? days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`
													: (lineDue(l, covered)?.text ?? (isNext ? "due next" : ""))}
								</span>
							</div>
						))}
					</div>
					{app.paymentPlanId === "installment" && (
						<div className="mt-2" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
							<span className="muted text-xs">
								{app.postArrivalStatus === "pending"
									? `Post-arrival request: ${app.postArrivalMonths} months · ${POST_ARRIVAL_FREQUENCY_LABELS[app.postArrivalFrequency as PostArrivalFrequency]?.toLowerCase() ?? app.postArrivalFrequency} — awaiting approval`
									: app.postArrivalStatus === "approved"
										? `Post-arrival plan: ${app.postArrivalMonths} months · ${POST_ARRIVAL_FREQUENCY_LABELS[app.postArrivalFrequency as PostArrivalFrequency]?.toLowerCase() ?? app.postArrivalFrequency}${app.postArrivalStartAt ? ` · from ${fmtDay(app.postArrivalStartAt)}` : ""}${app.postArrivalInterestPct ? ` · +${app.postArrivalInterestPct}% interest` : ""}${app.postArrivalReviewedBy ? ` · approved by ${app.postArrivalReviewedBy}` : ""}`
										: app.postArrivalStatus === "declined"
											? `Post-arrival request declined${app.postArrivalDeclineReason ? ` — ${app.postArrivalDeclineReason}` : ""} — the client can pick again`
											: app.postArrivalMonths && app.postArrivalFrequency
												? `Post-arrival: ${app.postArrivalMonths} months · ${POST_ARRIVAL_FREQUENCY_LABELS[app.postArrivalFrequency as PostArrivalFrequency]?.toLowerCase() ?? app.postArrivalFrequency}`
												: "Post-arrival: the client has not chosen a schedule yet."}
							</span>
							{canWork && !postArrivalPaid && !schedOpen && app.postArrivalStatus !== "approved" && (
								<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSchedOpen(true)}>
									{app.postArrivalMonths ? "Change on their behalf…" : "Set on their behalf…"}
								</button>
							)}
						</div>
					)}
					{app.postArrivalStatus === "pending" && (
						<div className="mt-3" style={{ border: "1.5px solid var(--border)", padding: "0.75rem 0.9rem" }}>
							<p className="eyebrow" style={{ margin: "0 0 0.4rem" }}>Schedule request · needs approval</p>
							<p className="muted text-xs" style={{ margin: "0 0 0.6rem" }}>
								{app.postArrivalMonths} months · {POST_ARRIVAL_FREQUENCY_LABELS[app.postArrivalFrequency as PostArrivalFrequency]?.toLowerCase() ?? app.postArrivalFrequency}
								{" · "}principal {formatMoney(remainderCents, "ghs")}
								{interestPct > 0 && ` · +${interestPct}% interest (${formatMoney(postArrivalInterestCents(remainderCents, interestPct), "ghs")})`}
								{interestPct > 0 && ` · total ${formatMoney(remainderCents + postArrivalInterestCents(remainderCents, interestPct), "ghs")}`}
							</p>
							{canApproveSchedules ? (
								<>
									<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
										<label className="muted text-xs" htmlFor="pa-start">Start date</label>
										<input
											id="pa-start"
											type="date"
											className="input input--sm cn-dt"
											style={{ width: "auto" }}
											value={reviewStart}
											onChange={(e) => setReviewStart(e.target.value)}
											disabled={reviewBusy}
										/>
										{reviewPreview && (
											<span className="muted text-xs">
												{reviewPreview.length} instalments · last {fmtDay(reviewPreview[reviewPreview.length - 1].dueAt)} · {formatMoney(reviewPreview[0].amountCents, "ghs")} each
											</span>
										)}
									</div>
									{!reviewDeclining ? (
										<div className="mt-2" style={{ display: "flex", gap: "0.4rem" }}>
											<button type="button" className="btn btn--sm btn--primary" disabled={reviewBusy || !reviewStart} onClick={() => void reviewSchedule(true)}>
												{reviewBusy ? "Saving…" : "Approve & set plan"}
											</button>
											<button type="button" className="btn btn--sm btn--ghost" disabled={reviewBusy} onClick={() => setReviewDeclining(true)}>
												Decline…
											</button>
										</div>
									) : (
										<div className="mt-2" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
											<input className="input input--sm" style={{ flex: "1 1 14rem" }} value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="Why — e.g. term too long for the balance" disabled={reviewBusy} />
											<button type="button" className="btn btn--sm btn--primary" disabled={reviewBusy || !reviewReason.trim()} onClick={() => void reviewSchedule(false)}>
												{reviewBusy ? "Saving…" : "Decline request"}
											</button>
											<button type="button" className="btn btn--sm btn--ghost" disabled={reviewBusy} onClick={() => setReviewDeclining(false)}>Back</button>
										</div>
									)}
								</>
							) : (
								<p className="muted text-xs" style={{ margin: 0 }}>Finance or a manager approves this request.</p>
							)}
						</div>
					)}
					{schedOpen && (
						<div className="mt-2" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
							<select className="select input input--sm" style={{ width: "auto" }} value={schedMonths} onChange={(e) => setSchedMonths(e.target.value)} aria-label="Months">
								{[3, 6, 9, 12, 18, 24].map((m) => (
									<option key={m} value={String(m)}>{m} months</option>
								))}
							</select>
							<select className="select input input--sm" style={{ width: "auto" }} value={schedFreq} onChange={(e) => setSchedFreq(e.target.value as PostArrivalFrequency)} aria-label="Frequency">
								{(Object.keys(POST_ARRIVAL_FREQUENCY_LABELS) as PostArrivalFrequency[]).map((f) => (
									<option key={f} value={f}>{POST_ARRIVAL_FREQUENCY_LABELS[f]}</option>
								))}
							</select>
							<input className="input input--sm" style={{ flex: "1 1 14rem" }} value={schedReason} onChange={(e) => setSchedReason(e.target.value)} placeholder="Why — e.g. agreed by phone 24 Oct" />
							<button type="button" className="btn btn--sm btn--primary" disabled={schedBusy || !schedReason.trim()} onClick={() => void saveSchedule()}>
								{schedBusy ? "Saving…" : "Set schedule"}
							</button>
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSchedOpen(false)}>Cancel</button>
						</div>
					)}
				</div>
			)}
			{canWork && (
				<div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
					<div>
						<p className="eyebrow" style={{ margin: 0 }}>Invoices on this case</p>
						<p className="muted text-xs">The journey raises its own; anything else is raised here and approved before the client sees it.</p>
					</div>
					<button type="button" className="btn btn--sm btn--ghost" onClick={() => setRaising(true)}>
						+ Raise an invoice
					</button>
				</div>
			)}
			{caseInvoices.length === 0 ? (
				<div className="card"><p className="muted text-sm">No invoices on this case yet.</p></div>
			) : (
				caseInvoices.map((inv) => (
					<div className="card" key={inv.id}>
						<InvoiceCard
							compact
							title={`${INVOICE_TYPE_TITLES[inv.type] ?? inv.type} invoice`}
							invoice={inv}
							hint={inv.status === "proforma" ? "Awaiting approval — the client cannot see or pay it until it is issued." : undefined}
							actions={
								canIssueInvoices ? (
									inv.status === "proforma" ? (
										<button type="button" className="btn btn--sm btn--primary" onClick={() => setApproving(inv)}>
											Approve & issue
										</button>
									) : (
										<Link to={`/invoices?open=${inv.id}`} className="btn btn--sm btn--ghost">
											Open in Billing →
										</Link>
									)
								) : undefined
							}
						/>
					</div>
				))
			)}

			{ledger.length > 0 && (
				<div className="card" style={{ padding: 0, overflow: "hidden" }}>
					<p className="eyebrow" style={{ margin: 0, padding: "0.6rem 0.9rem 0" }}>Transaction ledger</p>
					<table className="ledger">
						<thead>
							<tr>
								<th>Date</th>
								<th>Entry</th>
								<th className="num">Amount</th>
								<th>Status</th>
								<th className="num">Balance</th>
							</tr>
						</thead>
						<tbody>
							{/* Settled and declined first — money that moved. Scheduled charges
							    sit below the divider: they are due, not payments yet. */}
							{ledger.filter((r) => r.status !== "scheduled").map((r) => (
								<tr key={r.id} className={r.status === "declined" ? "failed-row" : undefined}>
									<td className="num">{fmtDay(r.at)}</td>
									<td>
										{r.label}
										<span className="sub">
											{[channelLabel(r.channel), r.reference, r.recordedBy, r.invoiceNumber].filter(Boolean).join(" · ")}
										</span>
									</td>
									<td className="num">{formatMoney(r.amountCents, "ghs")}</td>
									<td>
										{r.status === "settled" ? (
											<span className="st st--paid">settled</span>
										) : r.status === "manual" ? (
											<span className="st st--man">manual</span>
										) : (
											<>
												<span className="st st--failed">declined</span>
												{r.failureReason && <span className="sub">{r.failureReason}</span>}
											</>
										)}
									</td>
									<td className="num">{r.balanceAfterCents != null ? formatMoney(r.balanceAfterCents, "ghs") : "—"}</td>
								</tr>
							))}
							{ledger.some((r) => r.status === "scheduled") && (
								<tr>
									<td colSpan={5} className="ledger__divide">Still to come — nothing leaves until the date</td>
								</tr>
							)}
							{ledger.filter((r) => r.status === "scheduled").map((r) => (
								<tr key={r.id} className="ledger__sched">
									<td className="num">{fmtDay(r.at)}</td>
									<td>
										{r.label}
										<span className="sub">{r.invoiceNumber}</span>
									</td>
									<td className="num">{formatMoney(r.amountCents, "ghs")}</td>
									<td>
										<span className="st st--sched">scheduled</span>
									</td>
									<td className="num">—</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<ApproveInvoiceSheet
				invoice={approving}
				onClose={() => setApproving(null)}
				onIssued={(updated) => {
					onInvoicesChanged();
					flash(`${updated.invoiceNumber} issued — the client can now pay.`);
				}}
				onDeclined={(voided) => {
					onInvoicesChanged();
					flash(`${voided.invoiceNumber} declined and voided.`);
				}}
			/>
			{/* Money is acted on in the case: approve, record a payment, credit,
			    void — the Invoices page's own document, mounted here. */}
			<div className="card">
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
					<p className="eyebrow mb-2">Invoices on this case · {caseLedger.length}</p>
					<Link to="/invoices" className="dash-link">Ledger →</Link>
				</div>
				{caseLedger.length === 0 ? (
					<p className="muted text-sm">Nothing raised yet.</p>
				) : (
					<div className="cn-detail__rows">
						{caseLedger.map((inv) => {
							const bal = invoiceBalance(inv);
							const on = openInvoiceId === inv.id;
							return (
								<button key={inv.id} type="button" className="cn-detail__row" style={{ width: "100%", textAlign: "left", background: on ? "var(--muted)" : undefined, cursor: "pointer" }} onClick={() => setOpenInvoiceId(on ? null : inv.id)} aria-expanded={on}>
									<span>
										{inv.invoiceNumber} · {inv.type}
										<span className="cn-detail__row-note" style={{ display: "block" }}>{inv.lines.length === 1 ? inv.lines[0]?.label : `${inv.lines.length} lines`} · {inv.status}</span>
									</span>
									<span className="mono text-xs">{bal > 0 ? `${formatMoney(Math.round(bal * 100), "ghs")} due` : "settled"}</span>
								</button>
							);
						})}
					</div>
				)}
				{openRow && (
					<div style={{ marginTop: "0.75rem" }}>
						<InvoiceDetail
							row={{ inv: openRow, derived: openRow.status, age: invoiceAgeDays(openRow), balance: invoiceBalance(openRow) }}
							account={null}
							by={opsUser?.name ?? "Staff"}
							onApprove={async () => setApproving(await getInvoice(openRow.id))}
							onPay={async (amt, method, ref) => {
								try {
									await invoiceApi.recordPayment(openRow.id, amt, method, ref);
									onInvoicesChanged();
									flash(`Payment recorded on ${openRow.invoiceNumber}.`);
								} catch (e) {
									fail(e, "Payment failed");
								}
							}}
							onVoid={async (reason) => {
								try {
									await invoiceApi.voidInvoice(openRow.id, reason);
									onInvoicesChanged();
									flash(`${openRow.invoiceNumber} voided.`);
								} catch (e) {
									fail(e, "Void failed");
								}
							}}
							onCredit={async (amt, reason) => {
								try {
									await invoiceApi.creditInvoice(openRow.id, amt, reason);
									onInvoicesChanged();
									flash(`Credit recorded on ${openRow.invoiceNumber}.`);
								} catch (e) {
									fail(e, "Credit failed");
								}
							}}
							onResend={() => flash("Resent to the client.")}
						/>
					</div>
				)}
			</div>

			<RaiseInvoiceSheet
				app={app}
				open={raising}
				onClose={() => setRaising(false)}
				onRaised={(raised) => {
					onInvoicesChanged();
					flash(canIssueInvoices ? `${raised.invoiceNumber} raised — approve it to issue.` : `${raised.invoiceNumber} raised — awaiting approval.`);
				}}
			/>
		</>
	);
}
