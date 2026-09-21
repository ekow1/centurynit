import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
	API_PREFIX,
	DEFAULT_ADMISSIONS_START_PERCENT,
	DUE_TRIGGER_LABELS,
	FEE_KIND_LABELS,
	SERVICE_STAGES,
	SERVICE_STAGE_LABELS,
	defaultStagePrices,
	milestoneLines,
	quoteTotal,
	scopeLabel,
	type ServiceStage,
	type DestinationTariff,
	type FeeCatalogue,
	type FeeItem,
	type UpdateFeeItem,
} from "century-nit-shared";
import { Sheet } from "century-nit-core/ui";
import { packagesApi } from "century-nit-core/api";
import type { ServicePackage } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { useOpsAuth } from "./OpsAuthContext";
import { Toast } from "./OpsDialogs";

/**
 * The fee schedule — what finance owns, and only that.
 *
 * Century's fee is the package's service fee (edited under Packages) plus
 * the items here: the consultation and a short list of add-ons. Everything
 * else the client pays through Century is a third-party cost recovered at
 * cost: a university's application fee (on the university), a country's
 * visa and biometrics fees (below), and the optional at-cost items. The
 * exchange rate and the milestone split close the page — every surface
 * prices from this same payload (`GET /api/v1/fees`).
 */

const CHAPTER_LABELS: Record<string, string> = { consult: "Consultation", apply: "Applications", visa: "Visa", depart: "Departure" };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const toCents = (dollars: string): number => {
	const n = Number(dollars.replace(/[^0-9.]/g, ""));
	return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function EnterpriseFeeSchedule() {
	const { hasCapability } = useOpsAuth();
	const canEdit = hasCapability("manage_settings");
	const [cat, setCat] = useState<FeeCatalogue | null>(null);
	const [items, setItems] = useState<FeeItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [toast, setToast] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);
	const say = (type: "error" | "success" | "info", message: string) => setToast({ type, message });

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [catalogue, all] = await Promise.all([apiFetch<FeeCatalogue>(`${API_PREFIX}/fees`), apiFetch<{ items: FeeItem[] }>(`${API_PREFIX}/fees/items`)]);
			setCat(catalogue);
			setItems(all.items);
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : "Could not load the fee schedule");
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	// ── item editor ─────────────────────────────────────────────────────
	const [editing, setEditing] = useState<FeeItem | null>(null);
	const [draft, setDraft] = useState<{ name: string; clientLabel: string; description: string; amount: string; optional: boolean; active: boolean }>({
		name: "",
		clientLabel: "",
		description: "",
		amount: "",
		optional: false,
		active: true,
	});
	const [saving, setSaving] = useState(false);
	const [sheetError, setSheetError] = useState<string | null>(null);
	function openItem(item: FeeItem) {
		setDraft({ name: item.name, clientLabel: item.clientLabel, description: item.description ?? "", amount: (item.amountCents / 100).toFixed(2), optional: item.optional, active: item.active });
		setSheetError(null);
		setEditing(item);
	}
	async function saveItem() {
		if (!editing) return;
		setSaving(true);
		setSheetError(null);
		try {
			const patch: UpdateFeeItem = {
				name: draft.name.trim(),
				clientLabel: draft.clientLabel.trim(),
				description: draft.description.trim() || null,
				amountCents: toCents(draft.amount),
				optional: draft.optional,
				active: draft.active,
			};
			await apiFetch(`${API_PREFIX}/fees/items/${editing.key}`, { method: "PUT", body: JSON.stringify(patch) });
			say("success", `${patch.name} saved.`);
			setEditing(null);
			await load();
		} catch (err) {
			setSheetError(err instanceof ApiError ? err.message : "Could not save the item");
		} finally {
			setSaving(false);
		}
	}

	// ── destination tariffs (inline) ────────────────────────────────────
	const [tariffDraft, setTariffDraft] = useState<Record<string, { visa: string; biometrics: string }>>({});
	const tariffValue = (d: DestinationTariff) => tariffDraft[d.id] ?? { visa: (d.visaFeeCents / 100).toFixed(2), biometrics: (d.biometricsFeeCents / 100).toFixed(2) };
	async function saveTariff(d: DestinationTariff) {
		const v = tariffValue(d);
		try {
			await apiFetch(`${API_PREFIX}/fees/destinations/${d.id}`, {
				method: "PUT",
				body: JSON.stringify({ visaFeeCents: toCents(v.visa), biometricsFeeCents: toCents(v.biometrics) }),
			});
			say("success", `${d.name} saved.`);
			setTariffDraft((prev) => {
				const next = { ...prev };
				delete next[d.id];
				return next;
			});
			await load();
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : `Could not save ${d.name}`);
		}
	}

	// ── exchange rate + split (settings) ────────────────────────────────
	const [rate, setRate] = useState<string>("");
	useEffect(() => {
		if (!cat) return;
		setRate(String(cat.exchangeRate));
	}, [cat]);
	// The packages, for the worked example — the service fee is theirs.
	const [packages, setPackages] = useState<ServicePackage[]>([]);
	useEffect(() => {
		packagesApi
			.list()
			.then((res) => setPackages(res.packages.filter((x) => x.active)))
			.catch(() => setPackages([]));
	}, []);
	const [examplePackage, setExamplePackage] = useState<string>("");
	const [exampleScope, setExampleScope] = useState<"admissions" | "visa" | "departure">("departure");
	const [exampleDestination, setExampleDestination] = useState<string>("");
	async function putSetting(key: string, value: string) {
		await apiFetch(`${API_PREFIX}/settings`, { method: "PUT", body: JSON.stringify({ key, value }) });
	}
	async function saveRate() {
		const r = Number(rate);
		if (!Number.isFinite(r) || r <= 0) return say("error", "The exchange rate must be a positive number.");
		try {
			await putSetting("PLATFORM_EXCHANGE_RATE", String(r));
			say("success", "Exchange rate saved — new invoices price from it.");
			await load();
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : "Could not save");
		}
	}

	const century = items.filter((i) => i.kind === "century");
	const passThrough = items.filter((i) => i.kind === "pass_through");
	const ghs = (cents: number) => (cat ? `GH₵ ${((cents / 100) * cat.exchangeRate).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : usd(cents));
	const whenLabel = (i: FeeItem) => (!i.active ? "off" : i.optional ? "when ticked" : "automatic");

	function ItemRows({ rows, empty }: { rows: FeeItem[]; empty: string }) {
		if (rows.length === 0) return <p className="ops-panel__muted" style={{ padding: "0.75rem 1rem" }}>{empty}</p>;
		return (
			<>
				{rows.map((i) => (
					<div key={i.key} className="ops-item" style={{ opacity: i.active ? 1 : 0.55 }}>
						<div>
							<div className="ops-item__k">
								{FEE_KIND_LABELS[i.kind]} · {CHAPTER_LABELS[i.chapter] ?? i.chapter}
							</div>
							<div className="ops-item__n">{i.name}</div>
							<div className="ops-item__s">
								Client reads: “{i.clientLabel}”{i.description ? ` · ${i.description}` : ""}
							</div>
						</div>
						<span className="cn-money" style={{ fontSize: "var(--text-sm)", fontWeight: 700, textAlign: "right" }}>
							{ghs(i.amountCents)}
							<span className="ops-item__s" style={{ display: "block", fontWeight: 400 }}>{usd(i.amountCents)}</span>
						</span>
						<span className="ops-item__k" style={{ textAlign: "right", minWidth: "7rem" }}>
							{whenLabel(i)}
							{canEdit && (
								<>
									<br />
									<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => openItem(i)}>
										edit
									</button>
								</>
							)}
						</span>
					</div>
				))}
			</>
		);
	}

	// The worked example: one package, one country, the items that apply.
	const pkg = packages.find((x) => x.id === examplePackage) ?? packages[0] ?? null;
	const dest = cat?.destinations.find((d) => d.id === exampleDestination) ?? cat?.destinations[0] ?? null;
	const centuryLines = century.filter((i) => i.active && !i.optional);
	const passLines = passThrough.filter((i) => i.active && !i.optional);
	const exampleStages: ServiceStage[] = exampleScope === "admissions" ? ["admissions"] : exampleScope === "visa" ? ["admissions", "visa"] : ["admissions", "visa", "departure"];
	// The same function the portal builder and the raise use — the example can never drift from the invoice.
	const flatOf = (key: string) => items.find((i) => i.key === key && i.active && i.amountCents > 0)?.amountCents;
	const examplePrices = pkg
		? (() => {
				const base = pkg.stagePrices ?? defaultStagePrices(pkg.priceCents);
				return { admissions: base.admissions, visa: flatOf("stage_visa") ?? base.visa, departure: flatOf("stage_departure") ?? base.departure };
			})()
		: null;
	const quote = pkg && examplePrices ? quoteTotal({ bundleCents: pkg.priceCents, stagePrices: examplePrices, stages: exampleStages }) : null;
	const visaInScope = exampleStages.includes("visa");
	const departureInScope = exampleStages.includes("departure");
	const centuryTotal = (quote?.totalCents ?? 0) + centuryLines.reduce((n, i) => n + i.amountCents, 0);
	const passTotal = (dest && visaInScope ? dest.visaFeeCents + dest.biometricsFeeCents : 0) + passLines.reduce((n, i) => n + i.amountCents, 0);
	const split = cat?.serviceFeeSplit;
	const exampleMilestones =
		quote && split
			? milestoneLines(quote, { depositPercent: split.depositPercent, preDeparturePercent: split.preDeparturePercent, admissionsStartPercent: cat?.admissionsStartPercent ?? DEFAULT_ADMISSIONS_START_PERCENT }, "installment")
			: [];

	return (
		<div className="admin-page">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h2 className="section-title">Fee schedule</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>What a client pays — Century's fee, and what is paid on their behalf at cost. Prices are set in USD; the client is charged in GHS at the rate on the right.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
					<Link to="/packages" className="btn btn--sm btn--ghost">
						Packages →
					</Link>
					<Link to="/universities" className="btn btn--sm btn--ghost">
						Universities →
					</Link>
					<Link to="/payment-config" className="btn btn--sm btn--ghost">
						Payment plans →
					</Link>
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{cat ? cat.exchangeRate.toFixed(2) : "—"}</strong> <span className="dash-day__date">GHS per USD</span>
				</span>
				<span>
					<strong>{century.length}</strong> <span className="dash-day__date">Century item{century.length === 1 ? "" : "s"}</span>
				</span>
				<span>
					<strong>{passThrough.length}</strong> <span className="dash-day__date">pass-through item{passThrough.length === 1 ? "" : "s"}</span>
				</span>
				<span>
					<strong>{cat?.destinations.length ?? 0}</strong> <span className="dash-day__date">countries priced</span>
				</span>
				<span>
					<strong>{packages.length}</strong> <span className="dash-day__date">package{packages.length === 1 ? "" : "s"}</span>
				</span>
			</div>

			{loading && !cat ? (
				<div className="route-loading" role="status" aria-live="polite">
					<span className="route-loading__spinner" aria-hidden="true" />
				</div>
			) : (
				<div className="ops-fees">
					<div className="cn-stack" style={{ gap: "1rem" }}>
						<section style={{ border: "1px solid var(--border-light)" }}>
							<div className="ops-band hd-band" style={{ borderTop: "none" }}>
								<span className="ops-band__name">Century's fee · {century.length + 2}</span>
								<span className="ops-band__note">ours · in the service fee or on top</span>
							</div>
							{SERVICE_STAGES.map((st) => {
								// Visa and Departure are the flat `stage_visa` / `stage_departure` items, listed with the other Century items below.
								if (st !== "admissions") return null;
								const prices = packages.map((x) => (x.stagePrices ?? defaultStagePrices(x.priceCents))[st]);
								const lo = prices.length ? Math.min(...prices) : 0;
								const hi = prices.length ? Math.max(...prices) : 0;
								return (
									<div key={st} className="ops-item">
										<div>
											<div className="ops-item__k">Century · service fee · {SERVICE_STAGE_LABELS[st]}</div>
											<div className="ops-item__n">{SERVICE_STAGE_LABELS[st]} stage</div>
											<div className="ops-item__s">
												By track — {packages.length > 0 ? packages.map((x) => `${x.name} ${ghs((x.stagePrices ?? defaultStagePrices(x.priceCents))[st])}`).join(" · ") : "no active packages"} · edited under Packages
											</div>
										</div>
										<span className="cn-money" style={{ fontSize: "var(--text-sm)", fontWeight: 700, textAlign: "right" }}>
											{lo === hi ? ghs(lo) : `${ghs(lo)} – ${ghs(hi)}`}
										</span>
										<span className="ops-item__k" style={{ textAlign: "right", minWidth: "7rem" }}>
											{st === "admissions" ? "always on" : "if on the plan"}
											<br />
											<Link to="/packages" className="dash-link">
												packages →
											</Link>
										</span>
									</div>
								);
							})}
							<div className="ops-item">
								<div>
									<div className="ops-item__k">Century · service fee · bundle</div>
									<div className="ops-item__n">Full journey — all three stages</div>
									<div className="ops-item__s">{packages.length > 0 ? packages.map((x) => `${x.name} ${ghs(x.priceCents)}`).join(" · ") : "no active packages"} · cheaper than the stages added up</div>
								</div>
								<span className="cn-money" style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>
									by track
								</span>
								<span className="ops-item__k" style={{ textAlign: "right", minWidth: "7rem" }}>
									in milestones
								</span>
							</div>
							<ItemRows rows={century} empty="No items." />
						</section>

						<section style={{ border: "1px solid var(--border-light)" }}>
							<div className="ops-band hd-band" style={{ borderTop: "none" }}>
								<span className="ops-band__name">Paid on the client's behalf · {passThrough.length + 3}</span>
								<span className="ops-band__note">at cost · ticked when the invoice is raised</span>
							</div>
							<div className="ops-item">
								<div>
									<div className="ops-item__k">Pass-through · Applications</div>
									<div className="ops-item__n">University application fee</div>
									<div className="ops-item__s">Set on each university · billed per school chosen</div>
								</div>
								<span className="cn-money" style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>
									per university
								</span>
								<span className="ops-item__k" style={{ textAlign: "right", minWidth: "7rem" }}>
									when schools are chosen
									<br />
									<Link to="/universities" className="dash-link">
										universities →
									</Link>
								</span>
							</div>
							<div className="ops-item">
								<div>
									<div className="ops-item__k">Pass-through · Visa</div>
									<div className="ops-item__n">Visa fee &amp; biometrics</div>
									<div className="ops-item__s">By country — below · the visa invoice takes the accepted school's country</div>
								</div>
								<span className="cn-money" style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>
									per country
								</span>
								<span className="ops-item__k" style={{ textAlign: "right", minWidth: "7rem" }}>
									when the visa opens
								</span>
							</div>
							<div className="ops-item">
								<div>
									<div className="ops-item__k">Pass-through · Departure</div>
									<div className="ops-item__n">Flight ticket</div>
									<div className="ops-item__s">The quote, as booked</div>
								</div>
								<span className="cn-money" style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>
									as quoted
								</span>
								<span className="ops-item__k" style={{ textAlign: "right", minWidth: "7rem" }}>
									after the fee milestone
								</span>
							</div>
							<ItemRows rows={passThrough} empty="No optional items." />
						</section>

						<section style={{ border: "1px solid var(--border-light)", padding: "0 1rem 1rem" }}>
							<div className="ops-band hd-band" style={{ borderTop: "none", margin: "0 -1rem" }}>
								<span className="ops-band__name">Visa costs by country · {cat?.destinations.length ?? 0}</span>
								<span className="ops-band__note">USD · the client pays the GHS at the rate</span>
							</div>
							{cat && cat.destinations.length > 0 ? (
								<div className="ops-tariffs">
									{cat.destinations.map((d) => {
										const v = tariffValue(d);
										const dirty = Boolean(tariffDraft[d.id]);
										return (
											<div key={d.id} className={`ops-tariff${dirty ? " ops-tariff--dirty" : ""}`}>
												<span className="ops-tariff__n">{d.name}</span>
												<label className="ops-tariff__row">
													<span>Visa fee</span>
													<input className="ops-tariff__in" inputMode="decimal" value={v.visa} disabled={!canEdit} onChange={(e) => setTariffDraft({ ...tariffDraft, [d.id]: { ...v, visa: e.target.value } })} aria-label={`${d.name} visa fee`} />
												</label>
												<label className="ops-tariff__row">
													<span>Biometrics</span>
													<input className="ops-tariff__in" inputMode="decimal" value={v.biometrics} disabled={!canEdit} onChange={(e) => setTariffDraft({ ...tariffDraft, [d.id]: { ...v, biometrics: e.target.value } })} aria-label={`${d.name} biometrics fee`} />
												</label>
												<div className="ops-tariff__foot">
													<span className="ops-item__s">{ghs(d.visaFeeCents + d.biometricsFeeCents)} together</span>
													{canEdit && dirty && (
														<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveTariff(d)}>
															Save
														</button>
													)}
												</div>
											</div>
										);
									})}
								</div>
							) : (
								<p className="muted text-sm" style={{ marginTop: "0.75rem" }}>No destinations in the catalogue yet.</p>
							)}
						</section>
					</div>

					<div className="cn-stack" style={{ gap: "1rem" }}>
						<section className="ops-bill">
							<p className="cn-detail__eyebrow" style={{ marginBottom: "0.5rem" }}>What a client pays · example</p>
							<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
								<select className="cn-filter__select" value={pkg?.id ?? ""} onChange={(e) => setExamplePackage(e.target.value)} aria-label="Example package">
									{packages.map((x) => (
										<option key={x.id} value={x.id}>
											{x.name}
										</option>
									))}
									{packages.length === 0 && <option value="">No package</option>}
								</select>
								<select className="cn-filter__select" value={exampleScope} onChange={(e) => setExampleScope(e.target.value as typeof exampleScope)} aria-label="Example scope">
									<option value="admissions">Admissions only</option>
									<option value="visa">Admissions + Visa</option>
									<option value="departure">Full journey</option>
								</select>
								<select className="cn-filter__select" value={dest?.id ?? ""} onChange={(e) => setExampleDestination(e.target.value)} aria-label="Example country">
									{(cat?.destinations ?? []).map((d) => (
										<option key={d.id} value={d.id}>
											{d.name}
										</option>
									))}
									{(cat?.destinations.length ?? 0) === 0 && <option value="">No country</option>}
								</select>
							</div>
							<div className="ops-bill__row ops-bill__row--head">
								<span>Century</span>
							</div>
							{quote &&
								SERVICE_STAGES.map((st) => {
									const line = quote.stageLines.find((l) => l.stage === st);
									const price = examplePrices ? examplePrices[st] : 0;
									return (
										<div key={st} className="ops-bill__row" style={line ? undefined : { opacity: 0.5, textDecoration: "line-through" }}>
											<span>
												{SERVICE_STAGE_LABELS[st]}
												{pkg ? ` · ${pkg.name}` : ""}
												<small>{line ? (st === "admissions" ? `${cat?.admissionsStartPercent ?? DEFAULT_ADMISSIONS_START_PERCENT}% on acceptance · rest on the first offer` : DUE_TRIGGER_LABELS[st === "visa" ? "visa_open" : "visa_approved"]) : "not on the plan"}</small>
											</span>
											<span className="cn-money">{ghs(price)}</span>
										</div>
									);
								})}
							{quote && quote.bundleDiscountCents > 0 && (
								<div className="ops-bill__row">
									<span>
										Full-journey bundle
										{split && <small>collected as deposit {split.depositPercent}% · pre-departure {split.preDeparturePercent}% · post-arrival {split.postArrivalPercent}%</small>}
									</span>
									<span className="cn-money">−{ghs(quote.bundleDiscountCents)}</span>
								</div>
							)}
							{quote && !quote.full && (
								<div className="ops-bill__row">
									<span>
										Service fee · {scopeLabel(exampleStages)}
										<small>{exampleMilestones.map((l) => `${l.label} ${ghs(l.amountCents)}`).join(" · ")}</small>
									</span>
									<span className="cn-money">{ghs(quote.totalCents)}</span>
								</div>
							)}
							{centuryLines.map((i) => (
								<div key={i.key} className="ops-bill__row">
									<span>{i.clientLabel}</span>
									<span className="cn-money">{ghs(i.amountCents)}</span>
								</div>
							))}
							<div className="ops-bill__row ops-bill__row--head">
								<span>On the client's behalf</span>
							</div>
							<div className="ops-bill__row">
								<span>
									Application fees<small>per university · set on each university</small>
								</span>
								<span className="cn-money">at cost</span>
							</div>
							{dest && visaInScope && (
								<>
									<div className="ops-bill__row">
										<span>Visa fee · {dest.name}</span>
										<span className="cn-money">{ghs(dest.visaFeeCents)}</span>
									</div>
									<div className="ops-bill__row">
										<span>Biometrics · {dest.name}</span>
										<span className="cn-money">{ghs(dest.biometricsFeeCents)}</span>
									</div>
								</>
							)}
							{passLines.map((i) => (
								<div key={i.key} className="ops-bill__row">
									<span>{i.clientLabel}</span>
									<span className="cn-money">{ghs(i.amountCents)}</span>
								</div>
							))}
							{departureInScope && (
								<div className="ops-bill__row">
									<span>
										Flight ticket<small>as quoted</small>
									</span>
									<span className="cn-money">—</span>
								</div>
							)}
							<div className="ops-bill__row ops-bill__row--total">
								<span>Before application fees and the ticket</span>
								<span className="cn-money">
									{ghs(centuryTotal + passTotal)} <small style={{ display: "inline", fontWeight: 400 }}>≈ {usd(centuryTotal + passTotal)}</small>
								</span>
							</div>
							<p className="cn-detailhead__meta" style={{ marginTop: "0.75rem" }}>
								Century keeps {ghs(centuryTotal)} · {ghs(passTotal)} passes through
							</p>
						</section>

						<section className="card cn-now">
							<p className="cn-detail__eyebrow">Exchange rate</p>
							<label className="ops-rule">
								<span>
									GHS per USD<small>the client is charged at this</small>
								</span>
								<input className="ops-tariff__in" style={{ width: "100%" }} inputMode="decimal" value={rate} disabled={!canEdit} onChange={(e) => setRate(e.target.value)} />
							</label>
							<p className="cn-detailhead__meta" style={{ marginTop: "0.5rem" }}>Changes apply to invoices raised from now on; drafts and issued invoices keep their figures.</p>
							{canEdit && (
								<div className="cn-now__actions">
									<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveRate()}>
										Save rate
									</button>
								</div>
							)}
							{split && (
								<p className="cn-detailhead__meta" style={{ marginTop: "0.75rem" }}>
									The service fee is collected {split.depositPercent}% · {split.preDeparturePercent}% · {split.postArrivalPercent}% —{" "}
									<Link to="/payment-config" style={{ textDecoration: "underline" }}>
										set under Payment plans
									</Link>
									.
								</p>
							)}
						</section>
					</div>
				</div>
			)}

			<Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `Edit · ${editing.name}` : "Edit"}>
				{editing && (
					<div className="cn-stack">
						<p className="muted text-sm">
							{FEE_KIND_LABELS[editing.kind]} · {CHAPTER_LABELS[editing.chapter] ?? editing.chapter} · key <code>{editing.key}</code>
						</p>
						<label>
							<span className="muted text-xs">Name (ops)</span>
							<input className="input input--sm" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
						</label>
						<label>
							<span className="muted text-xs">What the client reads on the invoice</span>
							<input className="input input--sm" value={draft.clientLabel} onChange={(e) => setDraft({ ...draft, clientLabel: e.target.value })} />
						</label>
						<label>
							<span className="muted text-xs">Description (ops)</span>
							<input className="input input--sm" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
						</label>
						<label>
							<span className="muted text-xs">Amount (USD)</span>
							<input className="input input--sm" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
						</label>
						<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
							<input type="checkbox" checked={draft.optional} onChange={(e) => setDraft({ ...draft, optional: e.target.checked })} />
							<span className="text-sm">Offered as a tick-box when raising or approving (otherwise added automatically)</span>
						</label>
						<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
							<input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
							<span className="text-sm">Active</span>
						</label>
						<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(null)} disabled={saving}>
								Cancel
							</button>
							<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveItem()} disabled={saving || !draft.name.trim() || !draft.clientLabel.trim()}>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
						{sheetError && <p className="cn-assign__error">{sheetError}</p>}
					</div>
				)}
			</Sheet>

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
