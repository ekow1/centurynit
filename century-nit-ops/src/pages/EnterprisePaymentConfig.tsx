import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PAYMENT_PLANS } from "century-nit-core";
import { invoiceAgeDays, invoiceBalance, invoicePaid } from "century-nit-core/ops";
import {
	API_PREFIX,
	DEFAULT_POST_ARRIVAL_CATALOGUE,
	POST_ARRIVAL_FREQUENCIES,
	POST_ARRIVAL_FREQUENCY_LABELS,
	feePlanSentences,
	type PostArrivalCatalogue,
	type PostArrivalFrequency,
} from "century-nit-shared";
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
 * The two plans are the platform's vocabulary (PAYMENT_PLANS); the split
 * and the post-arrival catalogue — the durations and frequencies a client
 * may pick, the grace after arrival, the reminder lead — are settings and
 * are edited here. The sentence the client reads is written from them.
 */

const DURATION_CHOICES = [3, 6, 9, 12, 18, 24];

const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

export function EnterprisePaymentConfig() {
	const { hasCapability } = useOpsAuth();
	const canEdit = hasCapability("manage_settings");
	const { applications } = useCases();
	const { invoices } = useInvoiceApi();
	const { catalogue, reload } = useFeeCatalogue();
	const [deposit, setDeposit] = useState("");
	const [preDeparture, setPreDeparture] = useState("");
	const [pa, setPa] = useState<PostArrivalCatalogue>(DEFAULT_POST_ARRIVAL_CATALOGUE);
	const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!catalogue) return;
		setDeposit(String(catalogue.serviceFeeSplit.depositPercent));
		setPreDeparture(String(catalogue.serviceFeeSplit.preDeparturePercent));
		setPa(catalogue.postArrival ?? DEFAULT_POST_ARRIVAL_CATALOGUE);
	}, [catalogue]);

	const toggleDuration = (m: number) =>
		setPa((prev) => ({ ...prev, durations: prev.durations.includes(m) ? prev.durations.filter((x) => x !== m) : [...prev.durations, m].sort((a, b) => a - b) }));
	const toggleFrequency = (f: PostArrivalFrequency) =>
		setPa((prev) => ({ ...prev, frequencies: prev.frequencies.includes(f) ? prev.frequencies.filter((x) => x !== f) : [...prev.frequencies, f] }));
	const validCatalogue = pa.durations.length > 0 && pa.frequencies.length > 0 && pa.graceDays >= 0 && pa.remindDays >= 0;

	async function saveCatalogue() {
		if (!validCatalogue) {
			setToast({ tone: "error", text: "Offer at least one duration and one frequency." });
			return;
		}
		setSaving(true);
		try {
			const put = (key: string, value: string) => apiFetch(`${API_PREFIX}/settings`, { method: "PUT", body: JSON.stringify({ key, value }) });
			await put("POST_ARRIVAL_DURATIONS", pa.durations.join(","));
			await put("POST_ARRIVAL_FREQUENCIES", pa.frequencies.join(","));
			await put("POST_ARRIVAL_GRACE_DAYS", String(pa.graceDays));
			await put("POST_ARRIVAL_REMIND_DAYS", String(pa.remindDays));
			await reload();
			setToast({ tone: "success", text: "The post-arrival catalogue is saved — clients choosing from now on see it." });
		} catch (err) {
			setToast({ tone: "error", text: err instanceof ApiError ? err.message : "Could not save the catalogue." });
		} finally {
			setSaving(false);
		}
	}

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
		// Behind: a dated instalment line whose date has passed and whose
		// cumulative amount the payments have not covered; or, on an invoice
		// with its own due date, a balance past it.
		const today = new Date().getTime();
		const behind: { inv: (typeof invoices)[number]; label: string; amount: number; age: number }[] = [];
		for (const i of invoices) {
			if (i.type !== "Agency" || i.status === "void" || i.status === "proforma" || invoiceBalance(i) <= 0) continue;
			const paid = invoicePaid(i);
			let cum = 0;
			let found = false;
			for (const line of i.lines) {
				cum += line.amount;
				if (!line.dueAt || paid >= cum) continue;
				const age = Math.floor((today - new Date(line.dueAt).getTime()) / 86_400_000);
				if (age > 0) {
					behind.push({ inv: i, label: line.label, amount: Math.min(line.amount, cum - paid), age });
					found = true;
				}
				break;
			}
			if (!found) {
				const age = invoiceAgeDays(i) ?? 0;
				if (age > 0 && !i.lines.some((l) => l.dueAt)) behind.push({ inv: i, label: i.lines[0]?.label ?? i.invoiceNumber, amount: invoiceBalance(i), age });
			}
		}
		behind.sort((a, b) => b.age - a.age);
		// Post-arrival: instalment plans past the pre-departure milestone and not settled.
		const postArrival = inst.filter((a) => (a.agencyStageIndex ?? 0) >= 2 && !a.agencySettled);
		return { withPlan, full, inst, behind, postArrival, none: applications.length - withPlan.length };
	}, [applications, invoices]);

	const example = 500; // GH₵ 5.00 — the test-price service fee, as a worked example
	const pct = (n: number) => (Number.isFinite(n) ? `${n} %` : "—");
	const of = (n: number) => (Number.isFinite(n) ? fmtGhs((example * n) / 100 / 100) : "—");
	const sentences = feePlanSentences(
		{ depositPercent: Number.isInteger(d) ? d : 10, preDeparturePercent: Number.isInteger(p) ? p : 30, postArrivalPercent: Number.isInteger(post) ? post : 60 },
		validCatalogue ? pa : DEFAULT_POST_ARRIVAL_CATALOGUE,
	);
	const listOf = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`);

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
											<span className="ops-mstep__s">after the visa · releases the travel documents</span>
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
										<span className="ops-mstep__s">after the visa · releases the travel documents</span>
									</div>
								)}
							</div>
							{inst && (
								<>
									<p className="cn-detail__eyebrow" style={{ margin: "0.75rem 0 0" }}>Post-arrival · what the client may pick</p>
									<div className="cn-detail__rows">
										<div className="cn-detail__row">
											<span>Over</span>
											<span className="cn-detail__row-note">{listOf(pa.durations.map((m) => `${m} months`))}</span>
										</div>
										<div className="cn-detail__row">
											<span>Paid</span>
											<span className="cn-detail__row-note">{listOf(pa.frequencies.map((f) => POST_ARRIVAL_FREQUENCY_LABELS[f].toLowerCase()))}</span>
										</div>
										<div className="cn-detail__row">
											<span>First instalment</span>
											<span className="cn-detail__row-note">{pa.graceDays} days after arrival · reminder {pa.remindDays} days before each</span>
										</div>
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
							Pre-departure milestone<small>after the visa · releases the admission letter, visa documents and e-ticket</small>
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
					<p className="cn-detail__eyebrow">Post-arrival catalogue · what the client may pick</p>
					<p className="cn-detailhead__meta" style={{ margin: "0.25rem 0 0.5rem" }}>Over</p>
					<div className="ops-togs">
						{DURATION_CHOICES.map((m) => (
							<button key={m} type="button" className={`ops-tog${pa.durations.includes(m) ? " ops-tog--on" : ""}`} disabled={!canEdit} onClick={() => toggleDuration(m)} aria-pressed={pa.durations.includes(m)}>
								<span className="ops-tog__bx" aria-hidden />
								{m} months
							</button>
						))}
					</div>
					<p className="cn-detailhead__meta" style={{ margin: "0.75rem 0 0.5rem" }}>Paid</p>
					<div className="ops-togs">
						{POST_ARRIVAL_FREQUENCIES.map((f) => (
							<button key={f} type="button" className={`ops-tog${pa.frequencies.includes(f) ? " ops-tog--on" : ""}`} disabled={!canEdit} onClick={() => toggleFrequency(f)} aria-pressed={pa.frequencies.includes(f)}>
								<span className="ops-tog__bx" aria-hidden />
								{POST_ARRIVAL_FREQUENCY_LABELS[f]}
							</button>
						))}
					</div>
					<label className="ops-rule" style={{ marginTop: "0.75rem" }}>
						<span>
							Grace after arrival<small>days before the first instalment</small>
						</span>
						<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="numeric" value={String(pa.graceDays)} disabled={!canEdit} onChange={(e) => setPa((prev) => ({ ...prev, graceDays: Number.parseInt(e.target.value, 10) || 0 }))} aria-label="Grace days" />
					</label>
					<label className="ops-rule" style={{ borderBottom: "none" }}>
						<span>
							Remind before<small>days ahead of each instalment</small>
						</span>
						<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="numeric" value={String(pa.remindDays)} disabled={!canEdit} onChange={(e) => setPa((prev) => ({ ...prev, remindDays: Number.parseInt(e.target.value, 10) || 0 }))} aria-label="Remind days" />
					</label>
					{canEdit && (
						<div className="cn-now__actions">
							<button type="button" className="btn btn--sm btn--primary" disabled={saving || !validCatalogue} onClick={() => void saveCatalogue()}>
								{saving ? "Saving…" : "Save catalogue"}
							</button>
						</div>
					)}
				</section>

				<section className="card cn-now">
					<p className="cn-detail__eyebrow">The plans, in the client's words · written from the settings</p>
					<p className="ops-sentence"><b>Instalments.</b> {sentences.installment}</p>
					<p className="ops-sentence"><b>Full payment.</b> {sentences.full}</p>
					<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>This is the text on the portal's plan cards and its Fees chapter. Nothing else spells a number.</p>
				</section>

				<section className="card cn-now">
					<p className="cn-detail__eyebrow">Behind · an instalment past its date · {facts.behind.length}</p>
					{facts.behind.length === 0 ? (
						<p className="ops-panel__muted">Nobody is behind.</p>
					) : (
						<div className="cn-detail__rows">
							{facts.behind.slice(0, 8).map(({ inv, label, amount, age }) => (
								<Link key={inv.id} to={`/invoices?open=${inv.id}`} className="cn-detail__row">
									<span>
										{inv.applicantName} · {label} · {fmtGhs(amount)}
									</span>
									<span className="cn-detail__row-note">
										{age} d late
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
