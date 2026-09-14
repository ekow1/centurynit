import { useState } from "react";
import { Link } from "react-router-dom";

import { useCases } from "../../../hooks/useCases";
import { InvoiceCard, formatMoney } from "century-nit-core/ui";
import { POST_ARRIVAL_FREQUENCY_LABELS, type PostArrivalFrequency } from "century-nit-shared";
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
	const [planDraft, setPlanDraft] = useState<"" | "full" | "installment">("");
	const [approving, setApproving] = useState<ApiInvoice | null>(null);
	const [raising, setRaising] = useState(false);
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
	const [schedOpen, setSchedOpen] = useState(false);
	const [schedMonths, setSchedMonths] = useState("6");
	const [schedFreq, setSchedFreq] = useState<PostArrivalFrequency>("monthly");
	const [schedReason, setSchedReason] = useState("");
	const [schedBusy, setSchedBusy] = useState(false);
	const postArrivalPaid = feeRows.some((r) => r.i >= 2 && (r.covered || r.partly));
	async function saveSchedule() {
		setSchedBusy(true);
		try {
			await applicationsApi.setPostArrivalSchedule(app.id, { months: Number.parseInt(schedMonths, 10), frequency: schedFreq, reason: schedReason.trim() });
			await refresh();
			onInvoicesChanged();
			setSchedOpen(false);
			setSchedReason("");
			flash("Post-arrival schedule set — the instalments are on the invoice.");
		} catch (e) {
			fail(e, "Could not set the schedule");
		} finally {
			setSchedBusy(false);
		}
	}
	const fmtDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);
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
								<span className="cn-fee__i">{i === 0 ? "deposit" : i === 1 ? (app.paymentPlanId === "full" ? "balance" : "pre-dep") : `${i - 1} / ${feeRows.length - 2}`}</span>
								<span className="cn-fee__d">{fmtDay(l.dueAt) ?? (i === 0 ? fmtDay(agencyInv.createdAt) : i === 1 ? "after visa" : "after arrival")}</span>
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
													: isNext
														? "due next"
														: ""}
								</span>
							</div>
						))}
					</div>
					{app.paymentPlanId === "installment" && (
						<div className="mt-2" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
							<span className="muted text-xs">
								{app.postArrivalMonths && app.postArrivalFrequency
									? `Post-arrival: ${app.postArrivalMonths} months · ${POST_ARRIVAL_FREQUENCY_LABELS[app.postArrivalFrequency as PostArrivalFrequency]?.toLowerCase() ?? app.postArrivalFrequency}${feeRows.some((r) => r.i >= 2 && !r.l.dueAt) ? " · dated once arrival is recorded" : ""}`
									: "Post-arrival: the client has not chosen a schedule yet."}
							</span>
							{canWork && !postArrivalPaid && !schedOpen && (
								<button type="button" className="btn btn--sm btn--ghost" onClick={() => setSchedOpen(true)}>
									{app.postArrivalMonths ? "Change on their behalf…" : "Set on their behalf…"}
								</button>
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
											Open in Money →
										</Link>
									)
								) : undefined
							}
						/>
					</div>
				))
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
