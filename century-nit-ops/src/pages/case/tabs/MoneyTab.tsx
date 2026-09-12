import { useState } from "react";
import { Link } from "react-router-dom";

import { useCases } from "../../../hooks/useCases";
import { InvoiceCard } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";
import type { Flash, Fail } from "./types";

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
	flash,
	fail,
}: {
	app: MockApplication;
	caseInvoices: ApiInvoice[];
	canWork: boolean;
	canIssueInvoices: boolean;
	/** Why the case cannot be marked complete yet, or null. */
	completeBlock: string | null;
	flash: Flash;
	fail: Fail;
}) {
	const { setApplicationStage, setPaymentPlan } = useCases();
	const [planDraft, setPlanDraft] = useState<"" | "full" | "installment">("");
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
					Paid state follows the ledger: record payments against the invoice below and these figures update.
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
			{caseInvoices.length === 0 ? (
				<div className="card"><p className="muted text-sm">No invoices on this case yet.</p></div>
			) : (
				caseInvoices.map((inv) => (
					<div className="card" key={inv.id}>
						<InvoiceCard
							compact
							title={`${INVOICE_TYPE_TITLES[inv.type] ?? inv.type} invoice`}
							invoice={inv}
							actions={
								canIssueInvoices ? (
									<Link to={`/invoices?open=${inv.id}`} className="btn btn--sm btn--ghost">
										{inv.status === "proforma" ? "Review & issue" : "Open in Invoices →"}
									</Link>
								) : undefined
							}
						/>
					</div>
				))
			)}
		</>
	);
}
