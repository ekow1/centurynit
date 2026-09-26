import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PAYMENT_PLANS } from "century-nit-core";
import { invoiceAgeDays, invoiceBalance, invoicePaid } from "century-nit-core/ops";
import {
	API_PREFIX,
	DEFAULT_ADMISSIONS_START_PERCENT,
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
import { fmtGhs, toGhs } from "./currency";

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
	const { hasPermission } = useOpsAuth();
	// The server gates PUT /settings on the `settings` module — mirror it
	// exactly or a custom role sees inputs that always 403.
	const canEdit = hasPermission("settings");
	const { applications } = useCases();
	const { invoices, permitted: invoicesPermitted } = useInvoiceApi();
	const { catalogue, error: catalogueError, reload } = useFeeCatalogue();
	const [deposit, setDeposit] = useState("");
	const [preDeparture, setPreDeparture] = useState("");
	// A plan that stops short of the full journey pays Admissions in two halves.
	const [admissionsStart, setAdmissionsStart] = useState("");
	const [pa, setPa] = useState<PostArrivalCatalogue>(DEFAULT_POST_ARRIVAL_CATALOGUE);
	// The numeric catalogue fields stay strings so a field can be cleared and
	// retyped — coercing on every keystroke made "empty" impossible.
	const [graceDays, setGraceDays] = useState("");
	const [remindDays, setRemindDays] = useState("");
	const [interestPct, setInterestPct] = useState("");
	const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
	const [saving, setSaving] = useState(false);

	/*
	 * Dirty-safe sync: a catalogue reload (e.g. after saving the other card)
	 * must not overwrite an unsaved edit. The baseline remembers what the
	 * last sync wrote; only a field still equal to its baseline is refreshed.
	 */
	const baseline = useRef<{
		deposit: string;
		preDeparture: string;
		admissionsStart: string;
		durations: string;
		frequencies: string;
		grace: string;
		remind: string;
		interest: string;
	} | null>(null);

	useEffect(() => {
		if (!catalogue) return;
		const src = catalogue.postArrival ?? DEFAULT_POST_ARRIVAL_CATALOGUE;
		const next = {
			deposit: String(catalogue.serviceFeeSplit.depositPercent),
			preDeparture: String(catalogue.serviceFeeSplit.preDeparturePercent),
			admissionsStart: String(catalogue.admissionsStartPercent ?? DEFAULT_ADMISSIONS_START_PERCENT),
			pa: src,
			grace: String(src.graceDays),
			remind: String(src.remindDays),
			interest: String(src.interestPct),
		};
		const prev = baseline.current;
		setDeposit((cur) => (prev && cur !== prev.deposit ? cur : next.deposit));
		setPreDeparture((cur) => (prev && cur !== prev.preDeparture ? cur : next.preDeparture));
		setAdmissionsStart((cur) => (prev && cur !== prev.admissionsStart ? cur : next.admissionsStart));
		setPa((cur) =>
			prev && (JSON.stringify(cur.durations) !== prev.durations || JSON.stringify(cur.frequencies) !== prev.frequencies) ? cur : next.pa,
		);
		setGraceDays((cur) => (prev && cur !== prev.grace ? cur : next.grace));
		setRemindDays((cur) => (prev && cur !== prev.remind ? cur : next.remind));
		setInterestPct((cur) => (prev && cur !== prev.interest ? cur : next.interest));
		baseline.current = {
			deposit: next.deposit,
			preDeparture: next.preDeparture,
			admissionsStart: next.admissionsStart,
			durations: JSON.stringify(next.pa.durations),
			frequencies: JSON.stringify(next.pa.frequencies),
			grace: next.grace,
			remind: next.remind,
			interest: next.interest,
		};
	}, [catalogue]);

	const toggleDuration = (m: number) =>
		setPa((prev) => ({ ...prev, durations: prev.durations.includes(m) ? prev.durations.filter((x) => x !== m) : [...prev.durations, m].sort((a, b) => a - b) }));
	const toggleFrequency = (f: PostArrivalFrequency) =>
		setPa((prev) => ({
			...prev,
			// Canonical order regardless of click order — the client's plan
			// sentence lists them as stored.
			frequencies: prev.frequencies.includes(f)
				? prev.frequencies.filter((x) => x !== f)
				: POST_ARRIVAL_FREQUENCIES.filter((x) => prev.frequencies.includes(x) || x === f),
		}));

	const g = Number.parseInt(graceDays, 10);
	const r = Number.parseInt(remindDays, 10);
	const interest = Number(interestPct);
	const graceOk = Number.isInteger(g) && g >= 0 && g <= 180;
	const remindOk = Number.isInteger(r) && r >= 0 && r <= 60;
	const interestOk = Number.isFinite(interest) && interest >= 0 && interest <= 100;
	const validCatalogue = pa.durations.length > 0 && pa.frequencies.length > 0 && graceOk && remindOk && interestOk;
	/** The catalogue as the client would read it — draft values where valid, persisted where not. */
	const shownPa: PostArrivalCatalogue = {
		...pa,
		graceDays: graceOk ? g : pa.graceDays,
		remindDays: remindOk ? r : pa.remindDays,
		interestPct: interestOk ? interest : pa.interestPct,
	};

	const putSettingsBulk = (items: { key: string; value: string }[]) =>
		apiFetch(`${API_PREFIX}/settings/bulk`, { method: "PUT", body: JSON.stringify({ items }) });

	async function saveCatalogue() {
		if (!validCatalogue) {
			setToast({ tone: "error", text: "Check the catalogue — durations and frequencies need a pick each, days and interest must be in range." });
			return;
		}
		setSaving(true);
		try {
			// One atomic write — a mid-sequence failure used to leave a
			// half-applied catalogue.
			await putSettingsBulk([
				{ key: "POST_ARRIVAL_DURATIONS", value: pa.durations.join(",") },
				{ key: "POST_ARRIVAL_FREQUENCIES", value: pa.frequencies.join(",") },
				{ key: "POST_ARRIVAL_GRACE_DAYS", value: String(g) },
				{ key: "POST_ARRIVAL_REMIND_DAYS", value: String(r) },
				{ key: "POST_ARRIVAL_INTEREST_PCT", value: String(interest) },
			]);
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
	const validSplit = Number.isInteger(d) && Number.isInteger(p) && d >= 1 && d <= 98 && p >= 1 && p <= 98 && post >= 1;
	const a = Number.parseInt(admissionsStart, 10);
	const validAdmissions = Number.isInteger(a) && a >= 1 && a <= 99;

	async function saveAdmissionsSplit() {
		if (!validAdmissions) {
			setToast({ tone: "error", text: "The on-acceptance share must be a whole percentage between 1 and 99." });
			return;
		}
		setSaving(true);
		try {
			await apiFetch(`${API_PREFIX}/settings`, { method: "PUT", body: JSON.stringify({ key: "SERVICE_FEE_ADMISSIONS_START_PERCENT", value: String(a) }) });
			await reload();
			setToast({ tone: "success", text: "Saved — plans accepted from now on split Admissions this way." });
		} catch (err) {
			setToast({ tone: "error", text: err instanceof ApiError ? err.message : "Could not save the split." });
		} finally {
			setSaving(false);
		}
	}

	async function saveSplit() {
		if (!validSplit) {
			setToast({ tone: "error", text: "Deposit and pre-departure must be whole percentages between 1 and 98 that leave something for after arrival." });
			return;
		}
		setSaving(true);
		try {
			// One write — a split saved halfway used to leave the server's
			// clamp rewriting a milestone the admin never chose.
			await putSettingsBulk([
				{ key: "SERVICE_FEE_DEPOSIT_PERCENT", value: String(d) },
				{ key: "SERVICE_FEE_PRE_DEPARTURE_PERCENT", value: String(p) },
			]);
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

	const example = 500; // 500 cents — $5.00, the test-price service fee, as a worked example
	const pct = (n: number) => (Number.isInteger(n) && n >= 0 ? `${n} %` : "—");
	/*
	 * The shares are whole cedis of the rounded base — format the total once
	 * and hand out parts that sum to it exactly; rounding each share on its
	 * own made 10/30/60 visibly add to GH₵ 76 on a GH₵ 75 fee.
	 */
	const exampleGhs = toGhs(example / 100);
	const exampleShares = useMemo(() => {
		const parts = [d, p, post].map((x) => (Number.isInteger(x) && x >= 0 ? Math.round((exampleGhs * x) / 100) : NaN));
		if (parts.some((x) => !Number.isFinite(x))) return null;
		const drift = exampleGhs - parts.reduce((a, b) => a + b, 0);
		parts[parts.length - 1] += drift;
		return parts;
	}, [d, p, post, exampleGhs]);
	const shareFmt = (i: number) => (exampleShares ? `GH₵ ${exampleShares[i].toLocaleString()}` : "—");
	const sentences = feePlanSentences(
		{ depositPercent: Number.isInteger(d) && d >= 1 ? d : 10, preDeparturePercent: Number.isInteger(p) && p >= 1 ? p : 30, postArrivalPercent: Number.isInteger(post) && post >= 1 ? post : 60 },
		validCatalogue ? shownPa : DEFAULT_POST_ARRIVAL_CATALOGUE,
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

			{catalogueError && !catalogue && (
				<p className="ops-panel__muted" style={{ margin: "0 0 1rem" }}>
					The fee schedule could not be loaded — {catalogueError}. Figures below are defaults, not live settings.
				</p>
			)}
			{!canEdit && (
				<p className="ops-panel__muted" style={{ margin: "0 0 1rem" }}>
					Read-only for your role — changing the schedule needs the Settings module.
				</p>
			)}

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
											<span className="cn-detail__row-note">{listOf(shownPa.durations.map((m) => `${m} months`))}</span>
										</div>
										<div className="cn-detail__row">
											<span>Paid</span>
											<span className="cn-detail__row-note">{listOf(shownPa.frequencies.map((f) => POST_ARRIVAL_FREQUENCY_LABELS[f].toLowerCase()))}</span>
										</div>
										<div className="cn-detail__row">
											<span>First instalment</span>
											<span className="cn-detail__row-note">{shownPa.graceDays} days after arrival · reminder {shownPa.remindDays} days before each</span>
										</div>
										<div className="cn-detail__row">
											<span>Interest</span>
											<span className="cn-detail__row-note">{shownPa.interestPct} % flat on the remainder, priced into each instalment</span>
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
							{Number.isInteger(post) && post >= 1 ? pct(post) : "—"}
						</span>
					</div>
					{Number.isInteger(d) && Number.isInteger(p) && post < 1 && (
						<p className="cn-detailhead__meta" style={{ margin: 0, color: "#b91c1c" }}>
							Deposit and pre-departure add to {d + p} % — they must leave at least 1 % for after arrival.
						</p>
					)}
					{canEdit ? (
						<div className="cn-now__actions">
							<button type="button" className="btn btn--sm btn--primary" disabled={saving || !validSplit} onClick={() => void saveSplit()}>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
					) : null}
					<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>
						On a {fmtGhs(example / 100)} fee: deposit {shareFmt(0)} · pre-departure {shareFmt(1)} · post-arrival {shareFmt(2)}
					</p>
				</section>

				<section className="card cn-now">
					<p className="cn-detail__eyebrow">A plan that stops short · Admissions on its own</p>
					<p className="muted" style={{ fontSize: "var(--text-xs)", margin: "0 0 0.5rem", lineHeight: 1.5 }}>
						The split above is for the full journey — its post-arrival remainder needs an arrival. A plan scoped to Admissions (or Admissions + Visa) pays each stage as it opens: Admissions in two parts, Visa when its file opens.
					</p>
					<label className="ops-rule">
						<span>
							Admissions · on acceptance<small>the share due when the plan is accepted</small>
						</span>
						<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="numeric" value={admissionsStart} disabled={!canEdit} onChange={(e) => setAdmissionsStart(e.target.value)} aria-label="Admissions on-acceptance percent" />
					</label>
					<div className="ops-rule" style={{ borderBottom: "none" }}>
						<span>
							Admissions · on the first offer<small>the remainder · due when an offer letter is recorded</small>
						</span>
						<span className="cn-money" style={{ textAlign: "right", fontWeight: 700 }}>
							{pct(Number.isInteger(a) ? 100 - a : NaN)}
						</span>
					</div>
					<div className="ops-rule" style={{ borderBottom: "none" }}>
						<span>
							Visa stage<small>if on the plan · due when the visa file opens</small>
						</span>
						<span className="cn-money" style={{ textAlign: "right", fontWeight: 700 }}>
							100%
						</span>
					</div>
					{canEdit && (
						<div className="cn-now__actions">
							<button type="button" className="btn btn--sm btn--primary" disabled={saving || !validAdmissions} onClick={() => void saveAdmissionsSplit()}>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
					)}
				</section>

				<section className="card cn-now">
					<p className="cn-detail__eyebrow">Post-arrival catalogue · what the client may pick</p>
					<p className="cn-detailhead__meta" style={{ margin: "0.25rem 0 0.5rem" }}>Over</p>
					<div className="ops-picks">
						{DURATION_CHOICES.map((m) => (
							<button key={m} type="button" className={`ops-pick${pa.durations.includes(m) ? " ops-pick--on" : ""}`} disabled={!canEdit} onClick={() => toggleDuration(m)} aria-pressed={pa.durations.includes(m)}>
								<span className="ops-pick__bx" aria-hidden />
								{m} months
							</button>
						))}
					</div>
					<p className="cn-detailhead__meta" style={{ margin: "0.75rem 0 0.5rem" }}>Paid</p>
					<div className="ops-picks">
						{POST_ARRIVAL_FREQUENCIES.map((f) => (
							<button key={f} type="button" className={`ops-pick${pa.frequencies.includes(f) ? " ops-pick--on" : ""}`} disabled={!canEdit} onClick={() => toggleFrequency(f)} aria-pressed={pa.frequencies.includes(f)}>
								<span className="ops-pick__bx" aria-hidden />
								{POST_ARRIVAL_FREQUENCY_LABELS[f]}
							</button>
						))}
					</div>
					<label className="ops-rule" style={{ marginTop: "0.75rem" }}>
						<span>
							Grace after arrival<small>days before the first instalment · 0–180</small>
						</span>
						<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="numeric" value={graceDays} disabled={!canEdit} onChange={(e) => setGraceDays(e.target.value)} aria-label="Grace days" aria-invalid={graceDays !== "" && !graceOk} />
					</label>
					<label className="ops-rule">
						<span>
							Remind before<small>days ahead of each instalment · 0–60</small>
						</span>
						<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="numeric" value={remindDays} disabled={!canEdit} onChange={(e) => setRemindDays(e.target.value)} aria-label="Remind days" aria-invalid={remindDays !== "" && !remindOk} />
					</label>
					<label className="ops-rule" style={{ borderBottom: "none" }}>
						<span>
							Interest<small>flat % on the post-arrival remainder · priced into each instalment · 0–100</small>
						</span>
						<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="decimal" value={interestPct} disabled={!canEdit} onChange={(e) => setInterestPct(e.target.value)} aria-label="Interest percent" aria-invalid={interestPct !== "" && !interestOk} />
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
					<p className="cn-detail__eyebrow">Behind · an instalment past its date{invoicesPermitted ? ` · ${facts.behind.length}` : ""}</p>
					{!invoicesPermitted ? (
						<p className="ops-panel__muted">Invoice data is not available to your role — arrears here count only what you can see.</p>
					) : facts.behind.length === 0 ? (
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
					<p className="cn-detail__eyebrow" style={{ margin: "1rem 0 0" }}>Post-arrival{invoicesPermitted ? ` · ${facts.postArrival.length} running` : ""}</p>
					{!invoicesPermitted ? (
						<p className="ops-panel__muted">Not available without the invoices permission.</p>
					) : facts.postArrival.length === 0 ? (
						<p className="ops-panel__muted">No post-arrival balances running.</p>
					) : (
						<div className="cn-detail__rows">
							{facts.postArrival.slice(0, 8).map((a) => {
								const open = invoices.filter((i) => i.type === "Agency" && i.applicationId === a.id && i.status !== "void" && invoiceBalance(i) > 0);
								// Undated first — an invoice with no due date is at least as
								// urgent as one with a date ahead.
								const next = open.sort((x, y) => (x.dueAt ?? "").localeCompare(y.dueAt ?? ""))[0];
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
