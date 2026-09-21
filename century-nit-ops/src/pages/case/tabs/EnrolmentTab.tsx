import { useState } from "react";

import { InvoiceCard, StatusPill } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";
import type { Flash, Fail, TabId } from "./types";
import { PackageSheet } from "../PackageSheet";

import { useCases } from "../../../hooks/useCases";
import { caseHandlerName } from "../../../lib/pendingTasks";
import { DECISION_LABELS, PAYMENT_PLAN_LABELS, SERVICE_STAGES, SERVICE_STAGE_LABELS, decisionOf, normaliseScope, scopeLabel, type ServiceStage } from "century-nit-shared";


/** Enrolment — the client's four steps: confirmed, package & plan, deposit, consultant. */
export function EnrolmentTab({ app, caseInvoices, canIssueInvoices, canWork, flash, fail, setTab }: { app: MockApplication; caseInvoices: ApiInvoice[]; canIssueInvoices: boolean; canWork: boolean; flash: Flash; fail: Fail; setTab: (id: TabId) => void }) {
	const { proposeStage } = useCases();
	const [packageOpen, setPackageOpen] = useState(false);
	const [addStages, setAddStages] = useState<ServiceStage[] | undefined>(undefined);
	// The plan's scope. A case that predates scopes bought the full journey.
	// The accepted plan; before acceptance the recommendation is shown as such, never as the plan.
	const accepted = app.scopeStages ? normaliseScope(app.scopeStages) : null;
	const scope = accepted ?? (app.fundingTrack ? normaliseScope(null) : null);
	const missing = scope ? SERVICE_STAGES.filter((st) => !scope.includes(st)) : [];
	// The moment to offer the next stage: an offer is in and Visa is not on the plan.
	const hasOffer = (app.schoolApplications ?? []).some((sc) => sc.outcome === "Admitted");
	const offerUpgrade = canWork && scope != null && !scope.includes("visa") && hasOffer;
	const openSheet = (stages?: ServiceStage[]) => {
		setAddStages(stages);
		setPackageOpen(true);
	};
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
					<div><p className="muted text-xs">Track</p><p>{app.fundingTrack === "undecided" ? "None — no Admissions on the plan" : app.fundingTrack || "Not chosen"}</p></div>
					<div>
						<p className="muted text-xs">Plan</p>
						<p>
							{accepted ? scopeLabel(accepted) : app.plannedStages ? `Recommended: ${scopeLabel(app.plannedStages)}` : "Not chosen"}
							{accepted && missing.length > 0 && <span className="muted text-xs"> · without {missing.map((st) => SERVICE_STAGE_LABELS[st]).join(" & ")}</span>}
							{!accepted && app.plannedStages && <span className="muted text-xs"> · not accepted yet</span>}
						</p>
					</div>
					<div><p className="muted text-xs">Payment plan</p><p>{PAYMENT_PLAN_LABELS[app.paymentPlanId ?? ""] ?? "Not chosen"}</p></div>
					<div><p className="muted text-xs">Target schools</p><p>{app.targetSchoolCount ? `${app.targetSchoolCount} institution${app.targetSchoolCount === 1 ? "" : "s"}` : "Not specified"}</p></div>
					<div><p className="muted text-xs">Deposit (10%)</p><p>{app.depositPaid ? "Paid" : "Not paid"}</p></div>
					<div><p className="muted text-xs">Consultant</p><p>{caseHandlerName(app) || "Unassigned"}</p></div>
				</div>
				{canWork && (!app.fundingTrack || !app.paymentPlanId) && (
					<div className="mt-3" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
						{!app.fundingTrack && (
							<button type="button" className="btn btn--sm btn--primary" onClick={() => openSheet()}>
								Record plan
							</button>
						)}
						{app.fundingTrack && !app.paymentPlanId && (
							// The payment plan prices the plan — it is set in the plan sheet, nowhere else.
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => openSheet()}>
								Choose the payment plan…
							</button>
						)}
					</div>
				)}
				{offerUpgrade && (
					<div className="mt-3" style={{ border: "1.5px solid var(--border)", padding: "0.75rem 0.9rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
						<div>
							<p style={{ fontWeight: 700, margin: 0 }}>An offer is in — the next chapter is not on the plan</p>
							<p className="muted text-xs" style={{ margin: "0.15rem 0 0", lineHeight: 1.5 }}>
								This case is scoped to {scopeLabel(scope)}. The visa stage cannot open until it is added; the client can add it from the portal, or you can record it here.
							</p>
						</div>
						<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
							<button type="button" className="btn btn--sm btn--primary" onClick={() => void proposeStage(app.appId, "visa").then(() => flash("Visa proposed — the client has been told.")).catch((e) => fail(e, "Could not send the proposal"))}>
								Propose Visa →
							</button>
							<button type="button" className="link-arrow" style={{ fontSize: "var(--text-xs)" }} onClick={() => openSheet(["visa"])}>
								record on their behalf…
							</button>
						</div>
					</div>
				)}
				{canWork && app.fundingTrack && (
					<p style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
						<button type="button" className="link-arrow" onClick={() => openSheet()}>
							{app.depositPaid ? (missing.length > 0 ? "Extend the plan…" : "Plan details…") : "Change the plan…"}
						</button>
					</p>
				)}
				<PackageSheet app={app} open={packageOpen} addStages={addStages} onClose={() => setPackageOpen(false)} onDone={flash} />
				{caseInvoices.find((i) => i.type === "agency") && (
					<div className="mt-3">
						<InvoiceCard
							compact
							title="Service fee invoice"
							invoice={caseInvoices.find((i) => i.type === "agency")!}
							actions={
								canIssueInvoices ? (
									<button type="button" className="btn btn--sm btn--ghost" onClick={() => setTab("payments")}>
										Billing →
									</button>
								) : undefined
							}
						/>
					</div>
				)}
			</div>
		</>
	);
}
