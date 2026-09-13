import { useEffect, useMemo, useState } from "react";
import { PACKAGE_CODE_LABELS, FEE_KIND_LABELS, type FeeItem, type PackageCode, type ServicePackage } from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { DOCUMENT_TYPES, DEFAULT_REQUIRED_DOCUMENT_IDS, documentCategory } from "century-nit-core";
import { Sheet } from "century-nit-core/ui";
import { useFeeCatalogue } from "../hooks/useFeeCatalogue";
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

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
				<div>
					<h1 className="page-title">Service Packages</h1>
					<p className="lead mt-2">Manage the bundles applicants choose after consultation.</p>
				</div>
				{availableCodes.length > 0 && (
					<button type="button" className="btn btn--primary" onClick={() => { setError(null); setForm(emptyForm(availableCodes[0])); }}>
						New package
					</button>
				)}
			</div>

			{error && !form && (
				<div className="card" style={{ border: "1px solid #000", padding: "1rem", marginBottom: "1.5rem" }}>
					{error}
				</div>
			)}

			{loading ? (
				<p className="muted">Loading packages…</p>
			) : (
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
					<thead>
						<tr style={{ borderBottom: "1px solid #000" }}>
							<th style={{ textAlign: "left", padding: "0.5rem" }}>Code</th>
							<th style={{ textAlign: "left", padding: "0.5rem" }}>Name</th>
							<th style={{ textAlign: "right", padding: "0.5rem" }}>Price</th>
							<th style={{ textAlign: "center", padding: "0.5rem" }}>Active</th>
							<th style={{ textAlign: "right", padding: "0.5rem" }} />
						</tr>
					</thead>
					<tbody>
						{sorted.map((p) => (
							<tr key={p.code} style={{ borderBottom: "1px solid #e5e5e5", opacity: p.active ? 1 : 0.5 }}>
								<td style={{ padding: "0.5rem" }}>{PACKAGE_CODE_LABELS[p.code]}</td>
								<td style={{ padding: "0.5rem" }}>{p.name}{!p.active && <span className="muted"> (deactivated)</span>}</td>
								<td style={{ textAlign: "right", padding: "0.5rem" }}>
									{formatCents(p.priceCents, p.currency)}
								</td>
								<td style={{ textAlign: "center", padding: "0.5rem" }}>{p.active ? "Yes" : "No"}</td>
								<td style={{ textAlign: "right", padding: "0.5rem" }}>
									<button type="button" onClick={() => { setError(null); setForm(formFromPackage(p)); }} style={{ border: "1px solid #000", background: "transparent", padding: "0.25rem 0.5rem", marginRight: "0.5rem", cursor: "pointer" }}>Edit</button>
									{p.active ? (
										<button type="button" onClick={() => deactivate(p.code)} style={{ border: "1px solid #000", background: "transparent", padding: "0.25rem 0.5rem", cursor: "pointer" }}>Deactivate</button>
									) : (
										<button type="button" onClick={() => reactivate(p.code)} style={{ border: "1px solid #000", background: "transparent", padding: "0.25rem 0.5rem", cursor: "pointer" }}>Reactivate</button>
									)}
								</td>
							</tr>
						))}
						</tbody>
					</table>
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
