import { useEffect, useMemo, useState } from "react";
import { Sheet } from "century-nit-core/ui";
import { packagesApi } from "century-nit-core/api";
import { SCHOOL_DEGREE_LEVELS } from "century-nit-core/content";
import {
	DEFAULT_ADMISSIONS_START_PERCENT,
	DEFAULT_SERVICE_FEE_SPLIT,
	DUE_TRIGGER_LABELS,
	PAYMENT_PLAN_LABELS,
	SERVICE_STAGES,
	SERVICE_STAGE_BLURBS,
	SERVICE_STAGE_LABELS,
	milestoneLines,
	normaliseScope,
	quoteTotal,
	scopeLabel,
	type PackageCode,
	type ServicePackage,
	type ServiceStage,
} from "century-nit-shared";
import type { MockApplication } from "century-nit-core/ops";
import { useCases } from "../../hooks/useCases";
import { useFeeCatalogue } from "../../hooks/useFeeCatalogue";
import { ghsPerUsd } from "../currency";

/**
 * Bind the client's plan on their behalf: the track, the stages on it, the
 * degree level and the school allowance. Goes through the same service the
 * portal's builder uses, so the price and the milestones are the ones the
 * client would see. The fee and its milestones are computed here by the
 * shared `quoteTotal` / `milestoneLines` — what this sheet shows is what
 * the invoice will carry.
 *
 * Once money is on the service-fee invoice the plan can only grow: the
 * track locks, stages can be added (an upgrade), not removed.
 */
export function PackageSheet({
	app,
	open,
	onClose,
	onDone,
	/** Open straight into "extend the plan" with these stages pre-ticked. */
	addStages,
}: {
	app: MockApplication;
	open: boolean;
	onClose: () => void;
	onDone?: (message: string) => void;
	addStages?: ServiceStage[];
}) {
	const { selectPackage, updateCaseFacts } = useCases();
	const { catalogue } = useFeeCatalogue();
	const [packages, setPackages] = useState<ServicePackage[] | null>(null);
	const [packageCode, setPackageCode] = useState<PackageCode | "">("");
	const [stages, setStages] = useState<ServiceStage[]>([...SERVICE_STAGES]);
	const [degreeLevel, setDegreeLevel] = useState("");
	const [schools, setSchools] = useState("");
	const [plan, setPlan] = useState("");
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Money on the ledger: the track is fixed and stages can only be added.
	const locked = Boolean(app.depositPaid);
	const current = app.scopeStages ? normaliseScope(app.scopeStages) : app.fundingTrack ? [...SERVICE_STAGES] : [];

	useEffect(() => {
		if (!open) return;
		let alive = true;
		packagesApi
			.list()
			.then((res) => {
				if (alive) setPackages(res.packages.filter((p) => p.active));
			})
			.catch(() => {
				if (alive) setPackages([]);
			});
		return () => {
			alive = false;
		};
	}, [open]);

	// Re-seed the form each time the sheet opens on a case.
	useEffect(() => {
		if (!open) return;
		setPackageCode((app.fundingTrack as PackageCode) || "");
		setStages(normaliseScope([...(app.scopeStages ?? (app.fundingTrack ? SERVICE_STAGES : ["admissions"])), ...(addStages ?? [])]));
		setDegreeLevel(SCHOOL_DEGREE_LEVELS.some((d) => d.id === app.degreeLevel) ? app.degreeLevel : "");
		setSchools(app.targetSchoolCount ? String(app.targetSchoolCount) : "");
		setPlan(app.paymentPlanId || "");
		setReason("");
		setError(null);
	}, [open, app.fundingTrack, app.scopeStages, app.degreeLevel, app.targetSchoolCount, app.paymentPlanId, addStages]);

	const selected = packages?.find((p) => p.code === packageCode) ?? null;
	const quote = useMemo(
		() => (selected ? quoteTotal({ bundleCents: selected.priceCents, stagePrices: selected.stagePrices, stages }) : null),
		[selected, stages],
	);
	const split = {
		depositPercent: catalogue?.serviceFeeSplit.depositPercent ?? DEFAULT_SERVICE_FEE_SPLIT.depositPercent,
		preDeparturePercent: catalogue?.serviceFeeSplit.preDeparturePercent ?? DEFAULT_SERVICE_FEE_SPLIT.preDeparturePercent,
		admissionsStartPercent: catalogue?.admissionsStartPercent ?? DEFAULT_ADMISSIONS_START_PERCENT,
	};
	const lines = quote ? milestoneLines(quote, split, plan || app.paymentPlanId || null) : [];
	const added = stages.filter((s) => !current.includes(s));
	const removed = current.filter((s) => !stages.includes(s));
	const extending = locked && added.length > 0;
	const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
	const ghs = (c: number) => `GH₵ ${((c / 100) * ghsPerUsd()).toLocaleString("en-GH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

	function toggle(stage: ServiceStage) {
		if (stage === "admissions") return;
		if (locked && current.includes(stage)) return;
		setStages((prev) => {
			const next = prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage];
			return normaliseScope(next);
		});
	}

	async function submit() {
		if (!packageCode || !degreeLevel) return;
		setBusy(true);
		setError(null);
		try {
			await selectPackage(app.appId, {
				packageCode,
				degreeLevel,
				targetSchoolCount: schools ? Number(schools) : undefined,
				stages,
				reason: reason.trim() || undefined,
			});
			if (plan && plan !== app.paymentPlanId) {
				await updateCaseFacts(app.appId, { paymentPlanId: plan });
			}
			onDone?.(
				extending
					? `Plan extended — ${added.map((s) => SERVICE_STAGE_LABELS[s]).join(" + ")} added to the service-fee invoice.`
					: `Plan recorded · ${scopeLabel(stages)} — a fresh service-fee invoice was raised.`,
			);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not record the plan");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onClose={onClose} title={extending ? "Extend the plan" : "Record the plan"}>
			<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
				{locked
					? "Payments are recorded on this plan, so the track is fixed and stages can be added, not removed. Added stages join the existing service-fee invoice; completing the full journey applies the bundle price."
					: "Bind the client's track and the stages on their plan. This sets the funding track and school allowance and raises the service-fee invoice — the same as if the client chose it themselves."}
			</p>
			{packages === null ? (
				<p className="muted text-sm">Loading packages…</p>
			) : (
				<div className="cn-stack">
					<div>
						<p className="muted text-xs mb-1">Track</p>
						<select className="input" value={packageCode} disabled={locked} onChange={(e) => setPackageCode(e.target.value as PackageCode | "")}>
							<option value="">Choose…</option>
							{packages.map((p) => (
								<option key={p.code} value={p.code}>
									{p.name}
									{p.maxSchools ? ` · up to ${p.maxSchools} schools` : ""}
								</option>
							))}
						</select>
						{selected?.tagline && <p className="muted mt-1 text-xs">{selected.tagline}</p>}
					</div>

					<div>
						<p className="muted text-xs mb-1">Stages on the plan</p>
						<div className="cn-stack" style={{ gap: "0.35rem" }}>
							{SERVICE_STAGES.map((st) => {
								const on = stages.includes(st);
								const fixed = st === "admissions" || (locked && current.includes(st));
								const needsVisa = st === "departure" && !stages.includes("visa");
								const price = selected ? (selected.stagePrices ? selected.stagePrices[st] : quoteTotal({ bundleCents: selected.priceCents, stagePrices: null, stages: [st, "visa"] }).stageLines.find((l) => l.stage === st)?.amountCents ?? 0) : 0;
								return (
									<label
										key={st}
										style={{
											display: "grid",
											gridTemplateColumns: "auto 1fr auto",
											gap: "0.6rem",
											alignItems: "start",
											border: "1px solid var(--border-light)",
											padding: "0.55rem 0.7rem",
											background: on ? "var(--muted)" : undefined,
											opacity: needsVisa ? 0.55 : 1,
											cursor: fixed || needsVisa ? "default" : "pointer",
										}}
									>
										<input type="checkbox" checked={on} disabled={fixed || needsVisa} onChange={() => toggle(st)} aria-label={SERVICE_STAGE_LABELS[st]} style={{ marginTop: "0.2rem" }} />
										<span>
											<span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
												{SERVICE_STAGE_LABELS[st]}
												{st === "admissions" && <span className="muted text-xs"> · always on</span>}
												{locked && current.includes(st) && st !== "admissions" && <span className="muted text-xs"> · on the invoice</span>}
												{needsVisa && <span className="muted text-xs"> · needs Visa</span>}
											</span>
											<span className="muted text-xs" style={{ display: "block", lineHeight: 1.45 }}>{SERVICE_STAGE_BLURBS[st]}</span>
										</span>
										<span className="mono text-xs" style={{ whiteSpace: "nowrap" }}>{selected ? usd(price) : "—"}</span>
									</label>
								);
							})}
						</div>
					</div>

					{quote && (
						<div style={{ border: "1px solid var(--border)", padding: "0.7rem 0.8rem" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
								<span style={{ fontWeight: 700 }}>{scopeLabel(stages)}</span>
								<span className="mono">
									{usd(quote.totalCents)} <span className="muted text-xs">≈ {ghs(quote.totalCents)}</span>
								</span>
							</div>
							{quote.bundleDiscountCents > 0 && (
								<p className="muted text-xs" style={{ margin: "0.2rem 0 0" }}>
									À la carte {usd(quote.alaCarteCents)} · bundle saves {usd(quote.bundleDiscountCents)}
								</p>
							)}
							{!extending && lines.length > 0 && (
								<div className="cn-detail__rows" style={{ marginTop: "0.5rem" }}>
									{lines.map((l) => (
										<div key={l.position} className="cn-detail__row">
											<span>
												{l.label}
												<span className="cn-detail__row-note" style={{ display: "block" }}>{DUE_TRIGGER_LABELS[l.dueOn]}</span>
											</span>
											<span className="mono text-xs">{usd(l.amountCents)}</span>
										</div>
									))}
								</div>
							)}
							{extending && (
								<p className="muted text-xs" style={{ margin: "0.4rem 0 0" }}>
									Adds {added.map((s) => SERVICE_STAGE_LABELS[s]).join(" + ")} to the existing invoice
									{quote.full && quote.bundleDiscountCents > 0 ? ` at the bundle price (−${usd(quote.bundleDiscountCents)} on the last line)` : ""}.
								</p>
							)}
							{!quote.full && (
								<p className="muted text-xs" style={{ margin: "0.4rem 0 0" }}>
									A plan that stops short has no post-arrival instalments — there is no arrival. Stages can be added later at the à-la-carte price.
								</p>
							)}
						</div>
					)}

					{removed.length > 0 && locked && <p className="cn-assign__error">Stages on the invoice cannot be removed: {removed.map((s) => SERVICE_STAGE_LABELS[s]).join(", ")}.</p>}

					<div>
						<p className="muted text-xs mb-1">Degree level</p>
						<select className="input" value={degreeLevel} onChange={(e) => setDegreeLevel(e.target.value)}>
							<option value="">Choose…</option>
							{SCHOOL_DEGREE_LEVELS.map((d) => (
								<option key={d.id} value={d.id}>
									{d.name}
								</option>
							))}
						</select>
					</div>
					<div>
						<p className="muted text-xs mb-1">Target schools</p>
						<input className="input" type="number" min={1} max={10} placeholder={selected?.maxSchools ? String(selected.maxSchools) : "3"} value={schools} onChange={(e) => setSchools(e.target.value)} />
						{selected != null && selected.maxSchools > 0 && Number(schools) > selected.maxSchools && (
							<p className="muted mt-1 text-xs" style={{ fontWeight: 600 }}>
								Above the {selected.name} allowance of {selected.maxSchools} — confirm before saving.
							</p>
						)}
					</div>
					{quote?.full && (
						<div>
							<p className="muted text-xs mb-1">Payment plan (optional)</p>
							<select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
								<option value="">Decide later</option>
								{Object.entries(PAYMENT_PLAN_LABELS).map(([id, label]) => (
									<option key={id} value={id}>
										{label}
									</option>
								))}
							</select>
						</div>
					)}
					<div>
						<p className="muted text-xs mb-1">Reason · goes on the case timeline</p>
						<input className="input" value={reason} placeholder="e.g. signed in office, chose over the phone" onChange={(e) => setReason(e.target.value)} maxLength={500} />
					</div>
					{error && <p className="cn-assign__error">{error}</p>}
					<div className="cn-assign__row">
						<button type="button" className="btn btn--sm btn--primary" disabled={busy || !packageCode || !degreeLevel || (locked && removed.length > 0)} onClick={() => void submit()}>
							{busy ? "Saving…" : extending ? "Extend plan" : "Record plan"}
						</button>
						<button type="button" className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
							Cancel
						</button>
					</div>
				</div>
			)}
		</Sheet>
	);
}
