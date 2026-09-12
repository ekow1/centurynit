import { Link } from "react-router-dom";

import { InvoiceCard, StatusPill } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";

import { DECISION_LABELS, PAYMENT_PLAN_LABELS, decisionOf } from "century-nit-shared";


/** Enrolment — the client's four steps: confirmed, package & plan, deposit, consultant. */
export function EnrolmentTab({ app, caseInvoices, canIssueInvoices }: { app: MockApplication; caseInvoices: ApiInvoice[]; canIssueInvoices: boolean }) {
	return (
		<>
			{/* Enrolment — the four steps the client takes on one page: confirm, package & plan, deposit, consultant. */}
			<div className="card">
				<p className="eyebrow mb-2">Enrolment</p>
				<ol style={{ listStyle: "none", padding: 0, margin: "0 0 0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
					{[
						{ label: "Confirmed", done: app.proceedStatus === "accepted" },
						{ label: "Package & plan", done: Boolean(app.fundingTrack) && Boolean(app.paymentPlanId) },
						{ label: "Deposit paid", done: Boolean(app.depositPaid) },
						{ label: "Consultant assigned", done: Boolean(app.assignedStaff) },
					].map((st, i, all) => {
						const cur = !st.done && all.slice(0, i).every((x) => x.done);
						return (
							<li key={st.label}>
								<StatusPill tone={st.done ? "done" : cur ? "current" : "neutral"} dot={st.done || cur}>
									{i + 1} · {st.label}
								</StatusPill>
							</li>
						);
					})}
				</ol>
				<div className="ops-grid cn-facts">
					<div>
						<p className="muted text-xs">Decision</p>
						<p>
							{(() => {
								const d = decisionOf(app.applicationConsent?.decision ?? app.proceedStatus);
								return d ? DECISION_LABELS[d] : "Awaiting the client";
							})()}
							{app.applicationConsent?.reason ? ` — “${app.applicationConsent.reason}”` : ""}
						</p>
					</div>
					<div><p className="muted text-xs">Package</p><p>{app.fundingTrack || "Not chosen"}</p></div>
					<div><p className="muted text-xs">Payment plan</p><p>{PAYMENT_PLAN_LABELS[app.paymentPlanId ?? ""] ?? "Not chosen"}</p></div>
					<div><p className="muted text-xs">Target schools</p><p>{app.targetSchoolCount ? `${app.targetSchoolCount} institution${app.targetSchoolCount === 1 ? "" : "s"}` : "Not specified"}</p></div>
					<div><p className="muted text-xs">Deposit (10%)</p><p>{app.depositPaid ? "Paid" : "Not paid"}</p></div>
					<div><p className="muted text-xs">Consultant</p><p>{app.assignedStaff || "Unassigned"}</p></div>
				</div>
				{caseInvoices.find((i) => i.type === "agency") && (
					<div className="mt-3">
						<InvoiceCard
							compact
							title="Service fee invoice"
							invoice={caseInvoices.find((i) => i.type === "agency")!}
							actions={
								canIssueInvoices ? (
									<Link to={`/invoices?open=${caseInvoices.find((i) => i.type === "agency")!.id}`} className="btn btn--sm btn--ghost">
										Open in Invoices →
									</Link>
								) : undefined
							}
						/>
					</div>
				)}
			</div>
		</>
	);
}
