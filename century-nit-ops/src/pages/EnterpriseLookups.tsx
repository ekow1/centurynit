import { useState, useEffect, useCallback, useMemo } from "react";
import { API_PREFIX, LookupValue } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { ConfirmDialog, Toast } from "./OpsDialogs";

type LoadState = "idle" | "loading" | "error" | "ready";

export function EnterpriseLookups() {
	const [lookups, setLookups] = useState<LookupValue[]>([]);
	const [loadState, setLoadState] = useState<LoadState>("idle");
	const [error, setError] = useState<string | null>(null);

	const [editing, setEditing] = useState<Partial<LookupValue> | null>(null);
	const [saving, setSaving] = useState(false);

	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const showToast = (type: "error" | "success", message: string) => setToast({ type, message });

	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

	const loadAll = useCallback(async () => {
		setLoadState("loading");
		setError(null);
		try {
			const res = await apiFetch<{ lookups: LookupValue[] }>(`${API_PREFIX}/lookups/all`);
			setLookups(res.lookups);
			setLoadState("ready");
		} catch (err) {
			setError(err instanceof ApiError ? err.message : String(err));
			setLoadState("error");
		}
	}, []);

	useEffect(() => {
		void loadAll();
	}, [loadAll]);

	const categories = useMemo(() => {
		const set = new Set<string>();
		for (const l of lookups) set.add(l.category);
		// Add default categories in case they are empty
		set.add("highestEducation");
		set.add("employmentStatus");
		set.add("englishTest");
		set.add("preferredLevel");
		set.add("gender");
		return Array.from(set).sort();
	}, [lookups]);

	async function handleSave(e: React.FormEvent) {
		e.preventDefault();
		if (!editing || !editing.category || !editing.value || !editing.label) return;

		setSaving(true);
		try {
			const payload = {
				category: editing.category,
				value: editing.value,
				label: editing.label,
				sortOrder: editing.sortOrder ?? 0,
				isActive: editing.isActive ?? true,
			};

			if (editing.id) {
				await apiFetch(`${API_PREFIX}/lookups/${editing.id}`, {
					method: "PUT",
					body: JSON.stringify(payload),
				});
			} else {
				await apiFetch(`${API_PREFIX}/lookups`, {
					method: "POST",
					body: JSON.stringify(payload),
				});
			}
			setEditing(null);
			void loadAll();
		} catch (err) {
			showToast("error", err instanceof ApiError ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete(id: string) {
		setConfirmAction(() => async () => {
			try {
				await apiFetch(`${API_PREFIX}/lookups/${id}`, { method: "DELETE" });
				void loadAll();
			} catch (err) {
				showToast("error", err instanceof ApiError ? err.message : String(err));
			}
		});
		setConfirmOpen(true);
	}

	return (
		<div className="fade-in">
			<div className="admin-section-head" style={{ marginBottom: "2rem" }}>
				<div>
					<h2 className="section-title">Form Options Catalogue</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Manage dynamic dropdown options for the applicant portal Assessment form.
					</p>
				</div>
				<button
					className="btn btn--primary"
					onClick={() => setEditing({ category: categories[0], isActive: true, sortOrder: 0 })}
				>
					+ Add Option
				</button>
			</div>

			{loadState === "error" && (
				<div className="ops-alert ops-alert--error mb-4">
					<p>{error}</p>
					<button className="btn btn--sm mt-2" onClick={() => void loadAll()}>Retry</button>
				</div>
			)}

			{loadState === "loading" && <p className="muted">Loading catalogue...</p>}

			{loadState === "ready" && (
				<div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
					{categories.map((cat) => {
						const items = lookups.filter((l) => l.category === cat);
						return (
							<div key={cat} className="card p-0">
								<div style={{ padding: "1.25rem", borderBottom: "1px solid var(--border-light)", background: "var(--surface-subtle)" }}>
									<h3 style={{ margin: 0, fontSize: "1.1rem", fontFamily: "var(--font-mono)" }}>{cat}</h3>
								</div>
								<table className="ops-table">
									<thead>
										<tr>
											<th style={{ width: "60px" }}>Order</th>
											<th style={{ width: "150px" }}>Value (ID)</th>
											<th>Label (Display)</th>
											<th style={{ width: "100px" }}>Status</th>
											<th style={{ width: "120px", textAlign: "right" }}>Actions</th>
										</tr>
									</thead>
									<tbody>
										{items.length === 0 ? (
											<tr>
												<td colSpan={5} className="muted" style={{ textAlign: "center", padding: "2rem" }}>
													No options configured for this category.
												</td>
											</tr>
										) : (
											items.map((item) => (
												<tr key={item.id} style={{ opacity: item.isActive ? 1 : 0.6 }}>
													<td>{item.sortOrder}</td>
													<td style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>{item.value}</td>
													<td style={{ fontWeight: 500 }}>{item.label}</td>
													<td>
														{item.isActive ? (
															<span className="portal-pill portal-pill--green">Active</span>
														) : (
															<span className="portal-pill">Inactive</span>
														)}
													</td>
													<td style={{ textAlign: "right" }}>
														<button
															className="btn btn--ghost btn--sm"
															style={{ padding: "0.25rem 0.5rem" }}
															onClick={() => setEditing(item)}
														>
															Edit
														</button>
														<button
															className="btn btn--ghost btn--sm"
															style={{ padding: "0.25rem 0.5rem", color: "var(--danger)" }}
															onClick={() => void handleDelete(item.id)}
														>
															Del
														</button>
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
						);
					})}
				</div>
			)}

			{editing && (
				<div className="modal-backdrop">
					<div className="modal-content" style={{ maxWidth: "500px" }}>
						<div className="modal-header">
							<h3>{editing.id ? "Edit Option" : "New Option"}</h3>
							<button className="btn-close" onClick={() => setEditing(null)}>×</button>
						</div>
						<form onSubmit={(e) => void handleSave(e)}>
							<div className="modal-body form-grid">
								<div className="field">
									<label>Category</label>
									<select
										className="select"
										value={editing.category ?? ""}
										onChange={(e) => setEditing({ ...editing, category: e.target.value })}
										required
									>
										{categories.map((c) => (
											<option key={c} value={c}>{c}</option>
										))}
									</select>
								</div>
								<div className="field">
									<label>Internal Value (ID)</label>
									<input
										className="input"
										value={editing.value ?? ""}
										onChange={(e) => setEditing({ ...editing, value: e.target.value })}
										placeholder="e.g. high_school"
										required
										pattern="^[a-zA-Z0-9_]+$"
										title="Only letters, numbers, and underscores"
									/>
									<p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Must be unique within category. No spaces.</p>
								</div>
								<div className="field">
									<label>Display Label</label>
									<input
										className="input"
										value={editing.label ?? ""}
										onChange={(e) => setEditing({ ...editing, label: e.target.value })}
										placeholder="e.g. High School / WASSCE"
										required
									/>
								</div>
								<div className="field">
									<label>Sort Order</label>
									<input
										type="number"
										className="input"
										value={editing.sortOrder ?? 0}
										onChange={(e) => setEditing({ ...editing, sortOrder: Number.parseInt(e.target.value) || 0 })}
										required
									/>
									<p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Lower numbers appear first.</p>
								</div>
								<div className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
									<input
										type="checkbox"
										id="l-active"
										checked={editing.isActive ?? true}
										onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
									/>
									<label htmlFor="l-active" style={{ margin: 0 }}>Active (visible to applicants)</label>
								</div>
							</div>
							<div className="modal-footer">
								<button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>Cancel</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>
									{saving ? "Saving..." : "Save Option"}
								</button>
							</div>
						</form>
					</div>
				</div>
		)}

			<ConfirmDialog
				open={confirmOpen}
				title="Delete Lookup"
				message="Are you sure you want to delete this lookup option?"
				danger
				confirmLabel="Delete"
				onConfirm={() => { confirmAction?.(); setConfirmOpen(false); setConfirmAction(null); }}
				onCancel={() => { setConfirmOpen(false); setConfirmAction(null); }}
			/>
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
