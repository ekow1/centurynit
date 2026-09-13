import { useEffect, useMemo, useState } from "react";
import { PACKAGE_CODE_LABELS, type PackageCode, type ServicePackage } from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { DOCUMENT_TYPES, DEFAULT_REQUIRED_DOCUMENT_IDS, documentCategory } from "century-nit-core";
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

function strToArr(s: string): string[] {
	return s.split("\n").map((l) => l.trim()).filter(Boolean);
}

function arrToStr(a: string[]): string {
	return a.join("\n");
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function emptyForm() {
	return {
		code: "non_scholarship" as PackageCode,
		name: "",
		tagline: "",
		priceCents: 0,
		currency: "USD",
		features: "",
		exclusions: "",
		includedFeeKeys: "",
		requiredDocuments: [...DEFAULT_REQUIRED_DOCUMENT_IDS] as string[],
		maxSchools: 1,
		sortOrder: 0,
		active: true,
	};
}

export function EnterprisePackages() {
	const [packages, setPackages] = useState<ServicePackage[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [form, setForm] = useState(emptyForm());
	const [editingCode, setEditingCode] = useState<string | null>(null);

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

	function startEdit(pkg: ServicePackage) {
		setForm({
			code: pkg.code,
			name: pkg.name,
			tagline: pkg.tagline ?? "",
			priceCents: pkg.priceCents,
			currency: pkg.currency,
			features: arrToStr(pkg.features),
			exclusions: arrToStr(pkg.exclusions),
			includedFeeKeys: arrToStr(pkg.includedFeeKeys),
			requiredDocuments: pkg.requiredDocuments ?? [],
			maxSchools: pkg.maxSchools,
			sortOrder: pkg.sortOrder,
			active: pkg.active,
		});
		setEditingCode(pkg.code);
	}

	function reset() {
		setForm(emptyForm());
		setEditingCode(null);
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		const payload = {
			code: createCode,
			name: form.name,
			tagline: form.tagline,
			priceCents: form.priceCents,
			currency: form.currency,
			features: strToArr(form.features),
			exclusions: strToArr(form.exclusions),
			includedFeeKeys: strToArr(form.includedFeeKeys),
			requiredDocuments: form.requiredDocuments,
			maxSchools: form.maxSchools,
			sortOrder: form.sortOrder,
			active: form.active,
		};
		const path = editingCode ? `/api/v1/packages/${editingCode}` : "/api/v1/packages";
		try {
			await apiFetch(path, { method: editingCode ? "PUT" : "POST", body: JSON.stringify(payload) });
			await load();
			reset();
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

	/** Sellable codes not already taken — `undecided` is the assessment escape hatch, never a package. */
	const availableCodes = useMemo(() => {
		const taken = new Set(packages.map((p) => p.code));
		return (Object.keys(PACKAGE_CODE_LABELS) as PackageCode[]).filter((c) => c !== "undecided" && !taken.has(c));
	}, [packages]);

	/** The code a create would actually use — the form's selection, or the first free one. */
	const createCode = editingCode ? form.code : availableCodes.includes(form.code) ? form.code : availableCodes[0];

	/** The checklist grouped like the Document Vault, for scanning. */
	const documentGroups = useMemo(() => {
		const groups = new Map<string, typeof DOCUMENT_TYPES[number][]>();
		for (const d of DOCUMENT_TYPES) {
			const cat = documentCategory(d.id);
			groups.set(cat, [...(groups.get(cat) ?? []), d]);
		}
		return [...groups.entries()];
	}, []);

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<h1 className="page-title">Service Packages</h1>
				<p className="lead mt-2">Manage the bundles applicants choose after consultation.</p>
			</div>

			{error && (
				<div className="card" style={{ border: "1px solid #000", padding: "1rem", marginBottom: "1.5rem" }}>
					{error}
				</div>
			)}

			{loading ? (
				<p className="muted">Loading packages…</p>
			) : (
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "2rem" }}>
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
									<button type="button" onClick={() => startEdit(p)} style={{ border: "1px solid #000", background: "transparent", padding: "0.25rem 0.5rem", marginRight: "0.5rem", cursor: "pointer" }}>Edit</button>
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

			<h2 className="page-title" style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>{editingCode ? "Edit Package" : "Create Package"}</h2>
			{!editingCode && availableCodes.length === 0 ? (
				<p className="muted" style={{ maxWidth: "640px" }}>
					Every package code is in use — edit a package above. Codes are a fixed set the product and the assessment share, not free text.
				</p>
			) : (
			<form onSubmit={submit} style={{ display: "grid", gap: "1rem", maxWidth: "640px" }}>
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
					<div>
						<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Code</label>
						<select value={createCode} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value as PackageCode }))} disabled={Boolean(editingCode)} className="input" style={{ width: "100%" }}>
							{(editingCode ? [form.code] : availableCodes).map((c) => (
								<option key={c} value={c}>{PACKAGE_CODE_LABELS[c]}</option>
							))}
						</select>
						{!editingCode && <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.35rem" }}>Only unused codes are listed — creating one that's taken would overwrite the live package.</p>}
					</div>
					<div>
						<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Currency</label>
						<select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} className="input" style={{ width: "100%" }}>
							<option value="USD">USD</option>
							<option value="GHS">GHS</option>
						</select>
					</div>
				</div>
				<div>
					<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Name</label>
					<input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input" style={{ width: "100%" }} required />
				</div>
				<div>
					<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Tagline</label>
					<input value={form.tagline} onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} className="input" style={{ width: "100%" }} />
				</div>
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
					<div>
						<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Price ({form.currency})</label>
						<input type="number" min="0" step="0.01" value={form.priceCents / 100} onChange={(e) => setForm((f) => ({ ...f, priceCents: Math.round((Number(e.target.value) || 0) * 100) }))} className="input" style={{ width: "100%" }} required />
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.35rem" }}>{formatCents(form.priceCents, form.currency)}</p>
					</div>
					<div>
						<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Max schools</label>
						<input type="number" value={form.maxSchools} onChange={(e) => setForm((f) => ({ ...f, maxSchools: Number(e.target.value) || 0 }))} className="input" style={{ width: "100%" }} required />
					</div>
					<div>
						<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Sort order</label>
						<input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))} className="input" style={{ width: "100%" }} />
					</div>
				</div>
				<div>
					<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Features (one per line)</label>
					<textarea value={form.features} onChange={(e) => setForm((f) => ({ ...f, features: e.target.value }))} className="input" style={{ width: "100%", minHeight: "80px" }} />
				</div>
				<div>
					<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Exclusions (one per line)</label>
					<textarea value={form.exclusions} onChange={(e) => setForm((f) => ({ ...f, exclusions: e.target.value }))} className="input" style={{ width: "100%", minHeight: "80px" }} />
				</div>
				<div>
					<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Included fee keys (one per line)</label>
					<textarea value={form.includedFeeKeys} onChange={(e) => setForm((f) => ({ ...f, includedFeeKeys: e.target.value }))} className="input" style={{ width: "100%", minHeight: "80px" }} />
				</div>
				<div>
					<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Required documents</label>
					<p className="muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.5rem" }}>
						Collected and verified during the Consultation chapter. Applications cannot be invoiced until every one is verified.
					</p>
					{documentGroups.map(([category, docs]) => (
						<fieldset key={category} style={{ border: "1px solid #e5e5e5", padding: "0.75rem 1rem 1rem", margin: 0, marginBottom: "0.75rem" }}>
							<legend style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 0.35rem" }}>{category}</legend>
							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))", gap: "0.35rem 1rem" }}>
								{docs.map((d) => (
									<label key={d.id} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "var(--text-sm)" }} title={d.hint}>
										<input
											type="checkbox"
											checked={form.requiredDocuments.includes(d.id)}
											onChange={(e) =>
												setForm((f) => ({
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
				<div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
					<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
						<input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
						Active
					</label>
				</div>
				<div style={{ display: "flex", gap: "1rem" }}>
					<button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : editingCode ? "Update" : "Create"}</button>
					{editingCode && <button type="button" onClick={reset} className="btn">Cancel</button>}
				</div>
			</form>
			)}
		</div>
	);
}
