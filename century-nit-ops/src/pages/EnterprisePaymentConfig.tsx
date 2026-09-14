import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PAYMENT_PLANS, POST_ARRIVAL_SCHEDULES } from "century-nit-core";
import { invoiceAgeDays, invoiceBalance } from "century-nit-core/ops";
import { API_PREFIX } from "century-nit-shared";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { useFeeCatalogue } from "../hooks/useFeeCatalogue";
import { useOpsAuth } from "./OpsAuthContext";
import { apiFetch, ApiError } from "../lib/api";
import { Toast } from "./OpsDialogs";
import { fmtGhs } from "./currency";

/**
 * Payment plans — when the service fee is paid. The fee schedule says what
 * is charged; this page says how it is split over the journey (deposit,
 * the pre-departure milestone, the remainder after arrival), which plan
 * each client is on, and who is behind on a milestone.
 *
 * The two plans and the post-arrival schedules are the platform's
 * vocabulary (PAYMENT_PLANS, POST_ARRIVAL_SCHEDULES); the split is a
 * setting and is edited here.
 */

const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

export function EnterprisePaymentConfig() {
	const { hasCapability } = useOpsAuth();
	const canEdit = hasCapability("manage_settings");
	const { applications } = useCases();
	const { invoices } = useInvoiceApi();
	const { catalogue, reload } = useFeeCatalogue();
	const [deposit, setDeposit] = useState("");
	const [preDeparture, setPreDeparture] = useState("");
	const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!catalogue) return;
		setDeposit(String(catalogue.serviceFeeSplit.depositPercent));
		setPreDeparture(String(catalogue.serviceFeeSplit.preDeparturePercent));
	}, [catalogue]);

	const d = Number.parseInt(deposit, 10);
	const p = Number.parseInt(preDeparture, 10);
	const post = Number.isInteger(d) && Number.isInteger(p) ? 100 - d - p : NaN;
	const validSplit = Number.isInteger(d) && Number.isInteger(p) && d >= 1 && p >= 1 && post >= 1;

	async function saveSplit() {
		if (!validSplit) {
			setToast({ tone: "error", text: "Deposit and pre-departure must be whole percentages that leave something for after arrival." });
			return;
		}
		setSaving(true);
		try {
			await apiFetch(`${API_PREFIX}/settings`, { method: "PUT", body: JSON.stringify({ key: "SERVICE_FEE_DEPOSIT_PERCENT", value: String(d) }) });
			await apiFetch(`${API_PREFIX}/settings`, { method: "PUT", body: JSON.stringify({ key: "SERVICE_FEE_PRE_DEPARTURE_PERCENT", value: String(p) }) });
			await reload();
			setToast({ tone: "success", text: "The split is saved — invoices raised from now on use it." });
		} catch (err) {
			setToast({ tone: "error", text: err instanceof ApiError ? err.message : "Could not save the split." });
		} finally {
			setSaving(false);
		}
	}

	/** Who is on which plan, and who is behind. */
	const facts = useMemo(() => {
		const withPlan = applications.filter((a) => a.paymentPlanId);
		const full = withPlan.filter((a) => a.paymentPlanId === "full");
		const inst = withPlan.filter((a) => a.paymentPlanId === "installment");
		// A service-fee invoice past its due date with a balance — the client is behind on that milestone.
		const behind = invoices
			.filter((i) => i.type === "Agency" && i.status !== "void" && i.status !== "proforma" && invoiceBalance(i) > 0)
			.map((i) => ({ inv: i, age: invoiceAgeDays(i) ?? 0 }))
			.filter((x) => x.age > 0)
			.sort((a, b) => b.age - a.age);
		// Post-arrival: instalment plans past the pre-departure milestone and not settled.
		const postArrival = inst.filter((a) => (a.agencyStageIndex ?? 0) >= 2 && !a.agencySettled);
		return { withPlan, full, inst, behind, postArrival, none: applications.length - withPlan.length };
	}, [applications, invoices]);

	const example = 500; // GH₵ 5.00 — the test-price service fee, as a worked example
	const pct = (n: number) => (Number.isFinite(n) ? `${n} %` : "—");
	const of = (n: number) => (Number.isFinite(n) ? fmtGhs((example * n) / 100 / 100) : "—");

	return (
		<div className="page-content fade-in">
			{toast && <Toast type={toast.tone} message={toast.text} onDone={() => setToast(null)} />}
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Payment plans</h1>
					<p className="lead mt-2">How the service fee is split over the journey — and which plan each client is on.</p>
				</div>
				<Link to="/fee-schedule" className="btn btn--ghost btn--sm">
					Fee schedule →
				</Link>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{facts.withPlan.length}</strong> <span className="dash-day__date">clients on a plan</span>
				</span>
				<span>
					<strong>{facts.full.length}</strong> <span className="dash-day__date">full payment</span>
				</span>
				<span>
					<strong>{facts.inst.length}</strong> <span className="dash-day__date">instalment plan</span>
				</span>
				<span>
					<strong>{facts.behind.length}</strong> <span className="dash-day__date">behind on a milestone</span>
				</span>
				{facts.none > 0 && (
					<span>
						<strong>{facts.none}</strong> <span className="dash-day__date">not chosen yet</span>
					</span>
				)}
			</div>

			<div className="ops-plans">
				{PAYMENT_PLANS.map((plan) => {
					const inst = plan.id === "installment";
					const n = inst ? facts.inst.length : facts.full.length;
					return (
						<section key={plan.id} className={`ops-plan${inst ? " ops-plan--on" : ""}`}>
							<div className="ops-plan__head">
								<span className="ops-plan__name">{plan.name}</span>
								<span className="ops-plan__n">
									{n} client{n === 1 ? "" : "s"} · {plan.discountLabel.toLowerCase()}
								</span>
							</div>
							<p className="cn-detailhead__sub" style={{ margin: 0 }}>{plan.blurb}</p>
							<div className="ops-msteps">
								<div className="ops-mstep">
									<span className="ops-mstep__l">Deposit</span>
									<span className="ops-mstep__v">{pct(d)}</span>
									<span className="ops-mstep__s">at enrolment · opens the case</span>
								</div>
								{inst ? (
									<>
										<div className="ops-mstep ops-mstep--cur">
											<span className="ops-mstep__l">Pre-departure</span>
											<span className="ops-mstep__v">{pct(p)}</span>
											<span className="ops-mstep__s">after the visa · releases the letter and the ticket</span>
										</div>
										<div className="ops-mstep">
											<span className="ops-mstep__l">Post-arrival</span>
											<span className="ops-mstep__v">{pct(post)}</span>
											<span className="ops-mstep__s">on a schedule the client picks</span>
										</div>
									</>
								) : (
									<div className="ops-mstep ops-mstep--cur">
										<span className="ops-mstep__l">Balance</span>
										<span className="ops-mstep__v">{pct(100 - d)}</span>
										<span className="ops-mstep__s">after the visa, before travel · releases the letter and the ticket</span>
									</div>
								)}
							</div>
							{inst && (
								<>
									<p className="cn-detail__eyebrow" style={{ margin: "0.75rem 0 0" }}>Post-arrival schedules</p>
									<div className="cn-detail__rows">
										{POST_ARRIVAL_SCHEDULES.map((s) => (
											<div key={s.id} className="cn-detail__row">
												<span>{s.label}</span>
												<span className="cn-detail__row-note">
													{s.payments} payments · every {s.intervalDays} d · {s.graceDays} d grace
												</span>
											</div>
										))}
									</div>
								</>
							)}
						</section>
					);
				})}
			</div>

			<div className="ops-plans" style={{ marginTop: "1rem" }}>
				<section className="card cn-now">
					<p className="cn-detail__eyebrow">The split · applies to invoices raised from now on</p>
					<label className="ops-rule">
						<span>
							Deposit<small>paid at enrolment · opens the case</small>
						</span>
						<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="numeric" value={deposit} disabled={!canEdit} onChange={(e) => setDeposit(e.target.value)} aria-label="Deposit percent" />
					</label>
					<label className="ops-rule">
						<span>
							Pre-departure milestone<small>releases the admission letter, visa documents and the ticket</small>
						</span>
						<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="numeric" value={preDeparture} disabled={!canEdit} onChange={(e) => setPreDeparture(e.target.value)} aria-label="Pre-departure percent" />
					</label>
					<div className="ops-rule" style={{ borderBottom: "none" }}>
						<span>
							Post-arrival<small>the remainder · instalment plan only</small>
						</span>
						<span className="cn-money" style={{ textAlign: "right", fontWeight: 700 }}>
							{pct(post)}
						</span>
					</div>
					{canEdit && (
						<div className="cn-now__actions">
							<button type="button" className="btn btn--sm btn--primary" disabled={saving || !validSplit} onClick={() => void saveSplit()}>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
					)}
					<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>
						On a {fmtGhs(example / 100)} fee: deposit {of(d)} · pre-departure {of(p)} · post-arrival {of(post)}
					</p>
				</section>

				<section className="card cn-now">
					<p className="cn-detail__eyebrow">Behind on a milestone · {facts.behind.length}</p>
					{facts.behind.length === 0 ? (
						<p className="ops-panel__muted">Nobody is behind.</p>
					) : (
						<div className="cn-detail__rows">
							{facts.behind.slice(0, 8).map(({ inv, age }) => (
								<Link key={inv.id} to={`/invoices?open=${inv.id}`} className="cn-detail__row">
									<span>
										{inv.applicantName} · {inv.lines[0]?.label ?? inv.invoiceNumber} · {fmtGhs(invoiceBalance(inv))}
									</span>
									<span className="cn-detail__row-note">
										{age} d overdue · due {shortDate(inv.dueAt)}
									</span>
								</Link>
							))}
						</div>
					)}
					<p className="cn-detail__eyebrow" style={{ margin: "1rem 0 0" }}>Post-arrival · {facts.postArrival.length} running</p>
					{facts.postArrival.length === 0 ? (
						<p className="ops-panel__muted">No post-arrival balances running.</p>
					) : (
						<div className="cn-detail__rows">
							{facts.postArrival.slice(0, 8).map((a) => {
								const open = invoices.filter((i) => i.type === "Agency" && i.applicationId === a.id && i.status !== "void" && invoiceBalance(i) > 0);
								const next = open.sort((x, y) => (x.dueAt ?? "9").localeCompare(y.dueAt ?? "9"))[0];
								return (
									<Link key={a.id} to="/ledger" className="cn-detail__row">
										<span>
											{a.applicantName} · {a.appId}
										</span>
										<span className="cn-detail__row-note">{next ? `${fmtGhs(invoiceBalance(next))} due ${shortDate(next.dueAt)}` : "nothing raised yet"}</span>
									</Link>
								);
							})}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
