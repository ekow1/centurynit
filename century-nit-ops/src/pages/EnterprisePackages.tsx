import { useEffect, useMemo, useState } from "react";
import { PACKAGE_CODE_LABELS, FEE_KIND_LABELS, type FeeItem, type PackageCode, type ServicePackage } from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { DOCUMENT_TYPES, DEFAULT_REQUIRED_DOCUMENT_IDS, documentCategory } from "century-nit-core";
import { Sheet } from "century-nit-core/ui";
import { useFeeCatalogue } from "../hooks/useFeeCatalogue";
import { useCases } from "../hooks/useCases";
import { Link } from "react-router-dom";
import { ghsPerUsd } from "./currency";

function formatCents(cents: number, currency = "USD") {
	if (currency === "GHS") {
		const ghs = (cents / 100).toFixed(2);
		const usd = (cents / 100 / ghsPerUsd()).toFixed(2);
		return `GH₵ ${ghs} (≈ $${usd} USD)`;
	}
	const usd = (cents / 100).toFixed(2);
	const ghs = Math.round((cents / 100) * ghsPerUsd()).toLocaleString();
	return `GH₵ ${ghs} ($${usd} USD)`;
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

type PackageForm = {
	/** The code being edited, or null when creating. */
	editing: PackageCode | null;
	code: PackageCode;
	name: string;
	tagline: string;
	priceCents: number;
	currency: string;
	features: string[];
	exclusions: string[];
	includedFeeKeys: string[];
	requiredDocuments: string[];
	maxSchools: number;
	sortOrder: number;
	active: boolean;
};

function emptyForm(code: PackageCode): PackageForm {
	return {
		editing: null,
		code,
		name: "",
		tagline: "",
		priceCents: 0,
		currency: "USD",
		features: [],
		exclusions: [],
		includedFeeKeys: [],
		requiredDocuments: [...DEFAULT_REQUIRED_DOCUMENT_IDS] as string[],
		maxSchools: 1,
		sortOrder: 0,
		active: true,
	};
}

function formFromPackage(pkg: ServicePackage): PackageForm {
	return {
		editing: pkg.code,
		code: pkg.code,
		name: pkg.name,
		tagline: pkg.tagline ?? "",
		priceCents: pkg.priceCents,
		currency: pkg.currency,
		features: [...pkg.features],
		exclusions: [...pkg.exclusions],
		includedFeeKeys: [...pkg.includedFeeKeys],
		requiredDocuments: pkg.requiredDocuments ?? [],
		maxSchools: pkg.maxSchools,
		sortOrder: pkg.sortOrder,
		active: pkg.active,
	};
}

const fieldLabel = { display: "block", fontSize: "0.75rem", marginBottom: "0.35rem" } as const;
const fieldLabelEl = (text: string) => <p className="muted text-xs" style={fieldLabel}>{text}</p>;

/**
 * One editable line per item — no "one per line" newline discipline to get
 * wrong; blanks are dropped on save.
 */
function StringListField({
	label,
	items,
	onChange,
	placeholder,
}: {
	label: string;
	items: string[];
	onChange: (next: string[]) => void;
	placeholder?: string;
}) {
	return (
		<div>
			{fieldLabelEl(label)}
			<div style={{ display: "grid", gap: "0.4rem" }}>
				{items.map((v, i) => (
					<div key={i} style={{ display: "flex", gap: "0.4rem" }}>
						<input
							className="input"
							style={{ flex: 1 }}
							value={v}
							placeholder={placeholder}
							onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
						/>
						<button
							type="button"
							className="btn btn--sm btn--ghost"
							aria-label="Remove"
							onClick={() => onChange(items.filter((_, j) => j !== i))}
						>
							×
						</button>
					</div>
				))}
				<div>
					<button type="button" className="btn btn--sm" onClick={() => onChange([...items, ""])}>
						+ Add
					</button>
				</div>
			</div>
		</div>
	);
}

export function EnterprisePackages() {
	const [packages, setPackages] = useState<ServicePackage[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [form, setForm] = useState<PackageForm | null>(null);
	const { catalogue } = useFeeCatalogue();

	async function load() {
		setLoading(true);
		try {
			const res = await apiFetch<{ packages: ServicePackage[] }>("/api/v1/packages/all");
			setPackages(res.packages);
			setError(null);
		} catch (err) {
			setError(errMsg(err) || "Could not load packages");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		load();
	}, []);

	/** Sellable codes not already taken — `undecided` is the assessment escape hatch, never a package. */
	const availableCodes = useMemo(() => {
		const taken = new Set(packages.map((p) => p.code));
		return (Object.keys(PACKAGE_CODE_LABELS) as PackageCode[]).filter((c) => c !== "undecided" && !taken.has(c));
	}, [packages]);

	/** The code a create would actually use — the form's selection, or the first free one. */
	const createCode = form && !form.editing
		? availableCodes.includes(form.code) ? form.code : availableCodes[0]
		: form?.code;

	/** The checklist grouped like the Document Vault, for scanning. */
	const documentGroups = useMemo(() => {
		const groups = new Map<string, typeof DOCUMENT_TYPES[number][]>();
		for (const d of DOCUMENT_TYPES) {
			const cat = documentCategory(d.id);
			groups.set(cat, [...(groups.get(cat) ?? []), d]);
		}
		return [...groups.entries()];
	}, []);

	/** Fee items for the picker, grouped by kind; plus any selected keys the catalogue no longer knows. */
	const feeKeyGroups = useMemo(() => {
		const items = catalogue?.items ?? [];
		const groups = new Map<FeeItem["kind"], FeeItem[]>();
		for (const i of items) {
			groups.set(i.kind, [...(groups.get(i.kind) ?? []), i]);
		}
		return [...groups.entries()];
	}, [catalogue]);
	const knownKeys = useMemo(() => new Set((catalogue?.items ?? []).map((i) => i.key)), [catalogue]);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!form || !createCode) return;
		setSaving(true);
		const payload = {
			code: createCode,
			name: form.name,
			tagline: form.tagline,
			priceCents: form.priceCents,
			currency: form.currency,
			features: form.features.map((s) => s.trim()).filter(Boolean),
			exclusions: form.exclusions.map((s) => s.trim()).filter(Boolean),
			includedFeeKeys: form.includedFeeKeys,
			requiredDocuments: form.requiredDocuments,
			maxSchools: form.maxSchools,
			sortOrder: form.sortOrder,
			active: form.active,
		};
		const path = form.editing ? `/api/v1/packages/${form.editing}` : "/api/v1/packages";
		try {
			await apiFetch(path, { method: form.editing ? "PUT" : "POST", body: JSON.stringify(payload) });
			await load();
			setForm(null);
		} catch (err) {
			setError(errMsg(err) || "Could not save package");
		} finally {
			setSaving(false);
		}
	}

	async function deactivate(code: string) {
		if (!confirm(`Deactivate package ${code}?`)) return;
		try {
			await apiFetch(`/api/v1/packages/${code}`, { method: "DELETE" });
			await load();
		} catch (err) {
			setError(errMsg(err) || "Could not deactivate package");
		}
	}

	async function reactivate(code: string) {
		try {
			await apiFetch(`/api/v1/packages/${code}`, { method: "PUT", body: JSON.stringify({ active: true }) });
			await load();
		} catch (err) {
			setError(errMsg(err) || "Could not reactivate package");
		}
	}

	const sorted = useMemo(() => [...packages].sort((a, b) => a.sortOrder - b.sortOrder), [packages]);
	// Who chose what — the case records the package's name as its funding track.
	const { applications } = useCases();
	const onPackage = useMemo(() => {
		const m = new Map<string, number>();
		for (const a of applications) if (a.fundingTrack) m.set(a.fundingTrack, (m.get(a.fundingTrack) ?? 0) + 1);
		return m;
	}, [applications]);
	const clientsOn = (pkg: ServicePackage) => onPackage.get(pkg.name) ?? onPackage.get(pkg.code) ?? 0;
	const [showOff, setShowOff] = useState(false);
	const split = catalogue?.serviceFeeSplit;
	const ghsOf = (cents: number) => `GH₵ ${((cents / 100) * ghsPerUsd()).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const active = sorted.filter((p) => p.active);
	const inactive = sorted.filter((p) => !p.active);
	const mostChosen = [...active].sort((a, b) => clientsOn(b) - clientsOn(a))[0] ?? null;
	const chosenMax = Math.max(1, ...sorted.map(clientsOn));
	const includedNames = (pkg: ServicePackage) => pkg.includedFeeKeys.map((k) => (catalogue?.items ?? []).find((i) => i.key === k)?.name ?? k);

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Packages</h1>
					<p className="lead mt-2">The bundles a client chooses after consultation — the service fee lives here.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<Link to="/fee-schedule" className="btn btn--ghost btn--sm">
						Fee schedule →
					</Link>
					{availableCodes.length > 0 && (
						<button type="button" className="btn btn--primary btn--sm" onClick={() => { setError(null); setForm(emptyForm(availableCodes[0])); }}>
							+ New package
						</button>
					)}
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{active.length}</strong> <span className="dash-day__date">active</span>
				</span>
				{inactive.length > 0 && (
					<span>
						<strong>{inactive.length}</strong> <span className="dash-day__date">deactivated</span>
					</span>
				)}
				<span>
					<strong>{[...onPackage.values()].reduce((n, x) => n + x, 0)}</strong> <span className="dash-day__date">clients on a package</span>
				</span>
				{mostChosen && (
					<span>
						<strong>{ghsOf(mostChosen.priceCents)}</strong> <span className="dash-day__date">most chosen · {mostChosen.name}</span>
					</span>
				)}
			</div>

			{error && !form && <p className="ops-modal__error">{error}</p>}
			{loading ? (
				<p className="muted">Loading packages…</p>
			) : sorted.length === 0 ? (
				<p className="ops-people__empty">No packages yet — add the first one.</p>
			) : (
				<>
					<div className="ops-plans">
						{active.map((p) => {
							const n = clientsOn(p);
							const inc = includedNames(p);
							return (
								<section key={p.code} className={`ops-plan${mostChosen?.code === p.code ? " ops-plan--on" : ""}`}>
									<div className="ops-plan__head">
										<span className="ops-plan__name">{p.name}</span>
										<span className="ops-plan__n">{PACKAGE_CODE_LABELS[p.code]}</span>
									</div>
									<span className="ops-pkg__price">
										{ghsOf(p.priceCents)}
										<small>{formatCents(p.priceCents, p.currency)}</small>
									</span>
									{p.tagline && <p className="cn-detailhead__sub" style={{ margin: 0 }}>{p.tagline}</p>}
									<div className="cn-detail__rows">
										<div className="cn-detail__row">
											<span>Target schools</span>
											<span className="cn-detail__row-note">{p.maxSchools > 0 ? p.maxSchools : "no cap"}</span>
										</div>
										{p.features.slice(0, 5).map((f) => (
											<div key={f} className="cn-detail__row">
												<span>{f}</span>
												<span className="cn-detail__row-note">included</span>
											</div>
										))}
										{inc.map((f) => (
											<div key={f} className="cn-detail__row">
												<span>{f}</span>
												<span className="cn-detail__row-note">in the fee</span>
											</div>
										))}
										{p.exclusions.slice(0, 3).map((f) => (
											<div key={f} className="cn-detail__row">
												<span>{f}</span>
												<span className="cn-detail__row-note">not included</span>
											</div>
										))}
									</div>
									<div className="ops-uni__foot" style={{ borderTop: "none", paddingTop: "0.25rem" }}>
										<span>
											{n} client{n === 1 ? "" : "s"} on it · {p.requiredDocuments.length} document{p.requiredDocuments.length === 1 ? "" : "s"} required
										</span>
										<span style={{ display: "flex", gap: "0.6rem" }}>
											<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => { setError(null); setForm(formFromPackage(p)); }}>
												edit
											</button>
											<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => deactivate(p.code)}>
												deactivate
											</button>
										</span>
									</div>
								</section>
							);
						})}
					</div>

					{inactive.length > 0 && (
						<div style={{ marginTop: "1rem" }}>
							<div className="ops-band ops-band--toggle" role="button" tabIndex={0} onClick={() => setShowOff((v) => !v)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowOff((v) => !v); } }}>
								<span className="ops-band__name">Deactivated · {inactive.length}</span>
								<span className="ops-band__note">{showOff ? "hide" : "show ▸"}</span>
							</div>
							{showOff && (
								<div className="ops-plans" style={{ marginTop: "0.75rem" }}>
									{inactive.map((p) => (
										<section key={p.code} className="ops-plan" style={{ opacity: 0.6, borderStyle: "dashed" }}>
											<div className="ops-plan__head">
												<span className="ops-plan__name">{p.name}</span>
												<span className="ops-plan__n">{PACKAGE_CODE_LABELS[p.code]} · deactivated</span>
											</div>
											<span className="ops-pkg__price">
												{ghsOf(p.priceCents)}
												<small>{formatCents(p.priceCents, p.currency)}</small>
											</span>
											<div className="ops-uni__foot" style={{ borderTop: "none", paddingTop: "0.25rem" }}>
												<span>{clientsOn(p)} client{clientsOn(p) === 1 ? "" : "s"} still on it</span>
												<span style={{ display: "flex", gap: "0.6rem" }}>
													<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => { setError(null); setForm(formFromPackage(p)); }}>
														edit
													</button>
													<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => reactivate(p.code)}>
														reactivate
													</button>
												</span>
											</div>
										</section>
									))}
								</div>
							)}
						</div>
					)}

					<div className="dash-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "1rem" }}>
						<section className="dash-panel">
							<header className="dash-panel__head">
								<h2 className="dash-panel__title">Collected, in milestones</h2>
								<Link to="/payment-config" className="dash-link">
									Payment plans →
								</Link>
							</header>
							{split && mostChosen ? (
								<div className="ops-msteps">
									<div className="ops-mstep">
										<span className="ops-mstep__l">Deposit · {split.depositPercent}%</span>
										<span className="ops-mstep__v">{ghsOf((mostChosen.priceCents * split.depositPercent) / 100)}</span>
										<span className="ops-mstep__s">at enrolment</span>
									</div>
									<div className="ops-mstep">
										<span className="ops-mstep__l">Pre-departure · {split.preDeparturePercent}%</span>
										<span className="ops-mstep__v">{ghsOf((mostChosen.priceCents * split.preDeparturePercent) / 100)}</span>
										<span className="ops-mstep__s">after the visa</span>
									</div>
									<div className="ops-mstep">
										<span className="ops-mstep__l">Post-arrival · {split.postArrivalPercent}%</span>
										<span className="ops-mstep__v">{ghsOf((mostChosen.priceCents * split.postArrivalPercent) / 100)}</span>
										<span className="ops-mstep__s">instalment plan</span>
									</div>
								</div>
							) : (
								<p className="dash-empty">The split is set under Payment plans.</p>
							)}
							<p className="cn-detailhead__meta">{mostChosen ? `On ${mostChosen.name} at ${ghsOf(mostChosen.priceCents)}` : ""}</p>
						</section>
						<section className="dash-panel">
							<header className="dash-panel__head">
								<h2 className="dash-panel__title">Who chose what</h2>
								<Link to="/reports" className="dash-link">
									Reports →
								</Link>
							</header>
							{sorted.map((p) => (
								<div key={p.code} className="ops-hbar">
									<span>{p.name}</span>
									<span className="ops-hbar__t">
										<span style={{ width: `${Math.round((clientsOn(p) / chosenMax) * 100)}%` }} />
									</span>
									<span className="ops-hbar__v">{clientsOn(p)}</span>
								</div>
							))}
						</section>
					</div>
				</>
			)}

			<Sheet open={form !== null} onClose={() => setForm(null)} title={form?.editing ? `Edit ${form.name || PACKAGE_CODE_LABELS[form.editing]}` : "New package"} size="tall">
				{form && (
					<form onSubmit={submit} className="cn-stack">
						{error && <p className="cn-assign__error">{error}</p>}
						<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
							<div>
								{fieldLabelEl("Code")}
								<select value={createCode} onChange={(e) => setForm((f) => f && ({ ...f, code: e.target.value as PackageCode }))} disabled={Boolean(form.editing)} className="input" style={{ width: "100%" }}>
									{(form.editing ? [form.code] : availableCodes).map((c) => (
										<option key={c} value={c}>{PACKAGE_CODE_LABELS[c]}</option>
									))}
								</select>
								{!form.editing && <p className="muted mt-1 text-xs">Only unused codes are listed — a taken code would overwrite the live package.</p>}
							</div>
							<div>
								{fieldLabelEl("Currency")}
								<select value={form.currency} onChange={(e) => setForm((f) => f && ({ ...f, currency: e.target.value }))} className="input" style={{ width: "100%" }}>
									<option value="USD">USD</option>
									<option value="GHS">GHS</option>
								</select>
							</div>
						</div>
						<div>
							{fieldLabelEl("Name")}
							<input value={form.name} onChange={(e) => setForm((f) => f && ({ ...f, name: e.target.value }))} className="input" style={{ width: "100%" }} required />
						</div>
						<div>
							{fieldLabelEl("Tagline")}
							<input value={form.tagline} onChange={(e) => setForm((f) => f && ({ ...f, tagline: e.target.value }))} className="input" style={{ width: "100%" }} />
						</div>
						<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
							<div>
								{fieldLabelEl(`Price (${form.currency})`)}
								<input type="number" min="0" step="0.01" value={form.priceCents / 100} onChange={(e) => setForm((f) => f && ({ ...f, priceCents: Math.round((Number(e.target.value) || 0) * 100) }))} className="input" style={{ width: "100%" }} required />
								<p className="mono mt-1" style={{ fontSize: "var(--text-xs)" }}>{formatCents(form.priceCents, form.currency)}</p>
							</div>
							<div>
								{fieldLabelEl("Max schools")}
								<input type="number" value={form.maxSchools} onChange={(e) => setForm((f) => f && ({ ...f, maxSchools: Number(e.target.value) || 0 }))} className="input" style={{ width: "100%" }} required />
							</div>
							<div>
								{fieldLabelEl("Sort order")}
								<input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => f && ({ ...f, sortOrder: Number(e.target.value) || 0 }))} className="input" style={{ width: "100%" }} />
							</div>
						</div>
						<StringListField label="Features" items={form.features} placeholder="e.g. Document review & credential verification" onChange={(v) => setForm((f) => f && ({ ...f, features: v }))} />
						<StringListField label="Exclusions" items={form.exclusions} placeholder="e.g. School / university direct application fees" onChange={(v) => setForm((f) => f && ({ ...f, exclusions: v }))} />
						<div>
							{fieldLabelEl("Included fee items")}
							{feeKeyGroups.length === 0 && form.includedFeeKeys.length === 0 ? (
								<p className="muted text-xs">Loading the fee catalogue…</p>
							) : (
								<>
									{feeKeyGroups.map(([kind, items]) => (
										<fieldset key={kind} style={{ border: "1px solid var(--border-light)", padding: "0.6rem 0.75rem 0.75rem", margin: 0, marginBottom: "0.5rem" }}>
											<legend className="muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 0.35rem" }}>{FEE_KIND_LABELS[kind]}</legend>
											<div style={{ display: "grid", gap: "0.3rem" }}>
												{items.map((i) => (
													<label key={i.key} style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "var(--text-sm)", opacity: i.active ? 1 : 0.5 }}>
														<input
															type="checkbox"
															checked={form.includedFeeKeys.includes(i.key)}
															onChange={(e) =>
																setForm((f) => f && ({
																	...f,
																	includedFeeKeys: e.target.checked
																		? [...f.includedFeeKeys, i.key]
																		: f.includedFeeKeys.filter((x) => x !== i.key),
																}))
															}
														/>
														<span>{i.name}{!i.active && " (inactive)"}</span>
														<span className="muted mono" style={{ fontSize: "0.7rem", marginLeft: "auto" }}>{i.key}</span>
													</label>
												))}
											</div>
										</fieldset>
									))}
									{form.includedFeeKeys.filter((k) => !knownKeys.has(k)).length > 0 && (
										<fieldset style={{ border: "1px solid var(--border-light)", padding: "0.6rem 0.75rem 0.75rem", margin: 0 }}>
											<legend className="muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 0.35rem" }}>Not in the catalogue</legend>
											<div style={{ display: "grid", gap: "0.3rem" }}>
												{form.includedFeeKeys.filter((k) => !knownKeys.has(k)).map((k) => (
													<label key={k} style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "var(--text-sm)" }}>
														<input
															type="checkbox"
															checked
															onChange={() => setForm((f) => f && ({ ...f, includedFeeKeys: f.includedFeeKeys.filter((x) => x !== k) }))}
														/>
														<span className="mono">{k}</span>
													</label>
												))}
											</div>
										</fieldset>
									)}
								</>
							)}
						</div>
						<div>
							{fieldLabelEl("Required documents")}
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.5rem" }}>
								Collected and verified during the Consultation chapter. Applications cannot be invoiced until every one is verified.
							</p>
							{documentGroups.map(([category, docs]) => (
								<fieldset key={category} style={{ border: "1px solid var(--border-light)", padding: "0.6rem 0.75rem 0.75rem", margin: 0, marginBottom: "0.5rem" }}>
									<legend className="muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 0.35rem" }}>{category}</legend>
									<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))", gap: "0.3rem 1rem" }}>
										{docs.map((d) => (
											<label key={d.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "var(--text-sm)" }} title={d.hint}>
												<input
													type="checkbox"
													checked={form.requiredDocuments.includes(d.id)}
													onChange={(e) =>
														setForm((f) => f && ({
															...f,
															requiredDocuments: e.target.checked
																? [...f.requiredDocuments, d.id]
																: f.requiredDocuments.filter((x) => x !== d.id),
														}))
													}
												/>
												<span>{d.name}</span>
											</label>
										))}
									</div>
								</fieldset>
							))}
						</div>
						<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
							<input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => f && ({ ...f, active: e.target.checked }))} />
							Active
						</label>
						<div className="cn-assign__row">
							<button type="submit" className="btn btn--sm btn--primary" disabled={saving}>{saving ? "Saving…" : form.editing ? "Update" : "Create"}</button>
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
						</div>
					</form>
				)}
			</Sheet>
		</div>
	);
}
