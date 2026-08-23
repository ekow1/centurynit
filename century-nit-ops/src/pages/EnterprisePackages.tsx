import { useEffect, useMemo, useState } from "react";
import { PACKAGE_CODE_LABELS, type PackageCode, type ServicePackage } from "century-nit-shared";
import { apiFetch } from "../lib/api";

function formatCents(cents: number, currency = "USD") {
	const symbol = currency === "GHS" ? "GH₵" : "$";
	return `${symbol}${(cents / 100).toFixed(2)}`;
}

function strToArr(s: string): string[] {
	return s.split("\n").map((l) => l.trim()).filter(Boolean);
}

function arrToStr(a: string[]): string {
	return a.join("\n");
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
			const res = await apiFetch<{ packages: ServicePackage[] }>("/api/v1/packages");
			setPackages(res.packages);
			setError(null);
		} catch (err: any) {
			setError(err.message || "Could not load packages");
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
			code: form.code,
			name: form.name,
			tagline: form.tagline,
			priceCents: form.priceCents,
			currency: form.currency,
			features: strToArr(form.features),
			exclusions: strToArr(form.exclusions),
			includedFeeKeys: strToArr(form.includedFeeKeys),
			maxSchools: form.maxSchools,
			sortOrder: form.sortOrder,
			active: form.active,
		};
		const path = editingCode ? `/api/v1/packages/${editingCode}` : "/api/v1/packages";
		try {
			await apiFetch(path, { method: editingCode ? "PUT" : "POST", body: JSON.stringify(payload) });
			await load();
			reset();
		} catch (err: any) {
			setError(err.message || "Could not save package");
		} finally {
			setSaving(false);
		}
	}

	async function deactivate(code: string) {
		if (!confirm(`Deactivate package ${code}?`)) return;
		try {
			await apiFetch(`/api/v1/packages/${code}`, { method: "DELETE" });
			await load();
		} catch (err: any) {
			setError(err.message || "Could not deactivate package");
		}
	}

	const sorted = useMemo(() => [...packages].sort((a, b) => a.sortOrder - b.sortOrder), [packages]);

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
							<tr key={p.code} style={{ borderBottom: "1px solid #e5e5e5" }}>
								<td style={{ padding: "0.5rem" }}>{PACKAGE_CODE_LABELS[p.code]}</td>
								<td style={{ padding: "0.5rem" }}>{p.name}</td>
								<td style={{ textAlign: "right", padding: "0.5rem" }}>
									{formatCents(p.priceCents, p.currency)}
								</td>
								<td style={{ textAlign: "center", padding: "0.5rem" }}>{p.active ? "Yes" : "No"}</td>
								<td style={{ textAlign: "right", padding: "0.5rem" }}>
									<button type="button" onClick={() => startEdit(p)} style={{ border: "1px solid #000", background: "transparent", padding: "0.25rem 0.5rem", marginRight: "0.5rem", cursor: "pointer" }}>Edit</button>
									<button type="button" onClick={() => deactivate(p.code)} style={{ border: "1px solid #000", background: "transparent", padding: "0.25rem 0.5rem", cursor: "pointer" }}>Deactivate</button>
								</td>
							</tr>
						))}
						</tbody>
					</table>
				)}

			<h2 className="page-title" style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>{editingCode ? "Edit Package" : "Create Package"}</h2>
			<form onSubmit={submit} style={{ display: "grid", gap: "1rem", maxWidth: "640px" }}>
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
					<div>
						<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Code</label>
						<select value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value as PackageCode }))} disabled={Boolean(editingCode)} className="input" style={{ width: "100%" }}>
							<option value="non_scholarship">Non-Scholarship</option>
							<option value="hybrid">Hybrid</option>
							<option value="scholarship">Scholarship</option>
						</select>
					</div>
					<div>
						<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Currency</label>
						<input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} className="input" style={{ width: "100%" }} maxLength={3} />
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
						<label style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", marginBottom: "0.35rem" }}>Price (cents)</label>
						<input type="number" value={form.priceCents} onChange={(e) => setForm((f) => ({ ...f, priceCents: Number(e.target.value) || 0 }))} className="input" style={{ width: "100%" }} required />
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
		</div>
	);
}
