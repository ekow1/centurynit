import { useState, useEffect } from "react";
import { useOpsAuth } from "./OpsAuthContext";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { ConfirmDialog, Toast } from "./OpsDialogs";
import { EnterpriseLookups } from "./EnterpriseLookups";

type Tab = "universities" | "countries" | "form-dropdowns";

export function EnterpriseUniversities() {
	const { canEditUniversities } = useOpsAuth();
	const [tab, setTab] = useState<Tab>("universities");
	const [search, setSearch] = useState("");
	
	const [universities, setUniversities] = useState<any[]>([]);
	const [destinations, setDestinations] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);

	const [editingUni, setEditingUni] = useState<any | null>(null);
	const [editingDest, setEditingDest] = useState<any | null>(null);
	const [saving, setSaving] = useState(false);

	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const showToast = (type: "error" | "success", message: string) => setToast({ type, message });

	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

	useEffect(() => {
		loadData();
	}, []);

	async function loadData() {
		setLoading(true);
		try {
			const [uniRes, destRes] = await Promise.all([
				apiFetch<{ universities: any[] }>(`${API_PREFIX}/catalog/universities`),
				apiFetch<{ destinations: any[] }>(`${API_PREFIX}/catalog/destinations`)
			]);
			setUniversities(uniRes.universities);
			setDestinations(destRes.destinations);
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	}

	async function saveUniversity(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		try {
			const method = editingUni.id ? "PUT" : "POST";
			const url = editingUni.id ? `${API_PREFIX}/catalog/universities/${editingUni.id}` : `${API_PREFIX}/catalog/universities`;
			
			// ensure id exists for POST
			const payload = { ...editingUni };
			if (!payload.id) payload.id = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

			await apiFetch(url, {
				method,
				body: JSON.stringify(payload)
			});
			setEditingUni(null);
			loadData();
		} catch (err) {
			showToast("error", err instanceof ApiError ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	async function saveDestination(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		try {
			const method = editingDest.id ? "PUT" : "POST";
			const url = editingDest.id ? `${API_PREFIX}/catalog/destinations/${editingDest.id}` : `${API_PREFIX}/catalog/destinations`;
			
			const payload = { ...editingDest };
			if (!payload.id) payload.id = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

			await apiFetch(url, {
				method,
				body: JSON.stringify(payload)
			});
			setEditingDest(null);
			loadData();
		} catch (err) {
			showToast("error", err instanceof ApiError ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	async function deleteUniversity(id: string) {
		setConfirmAction(() => async () => {
			try {
				await apiFetch(`${API_PREFIX}/catalog/universities/${id}`, { method: "DELETE" });
				loadData();
			} catch (err) {
				showToast("error", err instanceof ApiError ? err.message : String(err));
			}
		});
		setConfirmOpen(true);
	}

	async function deleteDestination(id: string) {
		setConfirmAction(() => async () => {
			try {
				await apiFetch(`${API_PREFIX}/catalog/destinations/${id}`, { method: "DELETE" });
				loadData();
			} catch (err) {
				showToast("error", err instanceof ApiError ? err.message : String(err));
			}
		});
		setConfirmOpen(true);
	}

	const q = search.toLowerCase();

	const filteredUnis = universities.filter((u) => {
		if (q && !u.name.toLowerCase().includes(q) && !u.city?.toLowerCase().includes(q)) return false;
		return true;
	});

	const filteredDestinations = destinations.filter((d) => {
		if (q && !d.name.toLowerCase().includes(q) && !d.region.toLowerCase().includes(q)) return false;
		return true;
	});

	function destName(destId: string): string {
		return destinations.find((d) => d.id === destId)?.name ?? destId;
	}

	return (
		<div className="admin-page fade-in">
			<div className="admin-section-head" style={{ marginBottom: "2rem" }}>
				<div>
					<h2 className="section-title">Universities & Countries</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Manage the academic catalog schools and destinations.
					</p>
				</div>
				<div>
					{tab === "universities" && canEditUniversities && (
						<button className="btn btn--primary" onClick={() => setEditingUni({ name: "" })}>+ Add University</button>
					)}
					{tab === "countries" && canEditUniversities && (
						<button className="btn btn--primary" onClick={() => setEditingDest({ name: "", region: "" })}>+ Add Country</button>
					)}
				</div>
			</div>

			{/* Tabs */}
			<div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid var(--border-light)", overflowX: "auto", whiteSpace: "nowrap", paddingBottom: "2px" }}>
				{([["universities", "Universities"], ["countries", "Countries"], ["form-dropdowns", "Form Dropdowns"]] as const).map(([key, label]) => (
					<button
						key={key}
						onClick={() => { setTab(key); setSearch(""); }}
						className={`btn btn--ghost ${tab === key ? '' : 'muted'}`}
						style={{ borderBottom: tab === key ? "2px solid var(--foreground)" : "2px solid transparent", borderRadius: 0, paddingBottom: "0.5rem" }}
					>
						{label}
					</button>
				))}
			</div>

			{/* Filters */}
			{tab !== "form-dropdowns" && (
			<div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
				<input
					type="search"
					placeholder={tab === "countries" ? "Search countries, regions..." : "Search universities, cities..."}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					style={{ maxWidth: "400px" }}
				/>
			</div>
			)}

			{loading ? (
				<p className="muted">Loading catalog...</p>
			) : (
				<>
					{/* Universities Tab */}
					{tab === "universities" && (
						<div className="card">
							<div className="ops-table-wrap">
								<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
									<thead>
										<tr style={{ borderBottom: "2px solid var(--border)" }}>
											<th style={{ padding: "1rem" }}>University</th>
											<th style={{ padding: "1rem" }}>Country</th>
											<th style={{ padding: "1rem" }}>City</th>
											<th style={{ padding: "1rem" }}>Type</th>
											<th style={{ padding: "1rem" }}>Acceptance</th>
											{canEditUniversities && <th style={{ padding: "1rem", textAlign: "right" }}>Actions</th>}
										</tr>
									</thead>
									<tbody>
										{filteredUnis.length === 0 ? (
											<tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center" }} className="muted">No universities found.</td></tr>
										) : filteredUnis.map((uni) => (
											<tr key={uni.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
												<td style={{ padding: "1rem" }}>
													<div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{uni.name}</div>
													{uni.ranking && <div className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>Ranking: {uni.ranking}</div>}
												</td>
												<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{destName(uni.destinationId)}</td>
												<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{uni.city}</td>
												<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{uni.type}</td>
												<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{uni.acceptance}</td>
												{canEditUniversities && (
													<td style={{ padding: "1rem", textAlign: "right" }}>
														<button className="btn btn--ghost" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setEditingUni(uni)}>Edit</button>
														<button className="btn btn--ghost" style={{ padding: "0.25rem 0.5rem", color: "var(--danger)" }} onClick={() => deleteUniversity(uni.id)}>Del</button>
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{/* Countries Tab */}
					{tab === "countries" && (
						<div className="card">
							<div className="ops-table-wrap">
								<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
									<thead>
										<tr style={{ borderBottom: "2px solid var(--border)" }}>
											<th style={{ padding: "1rem" }}>Country</th>
											<th style={{ padding: "1rem" }}>Region</th>
											<th style={{ padding: "1rem" }}>Tagline</th>
											{canEditUniversities && <th style={{ padding: "1rem", textAlign: "right" }}>Actions</th>}
										</tr>
									</thead>
									<tbody>
										{filteredDestinations.length === 0 ? (
											<tr><td colSpan={4} style={{ padding: "2rem", textAlign: "center" }} className="muted">No destinations found.</td></tr>
										) : filteredDestinations.map((dest) => (
											<tr key={dest.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
												<td style={{ padding: "1rem", fontWeight: 600, fontSize: "var(--text-sm)" }}>{dest.name}</td>
												<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{dest.region}</td>
												<td style={{ padding: "1rem", fontSize: "var(--text-sm)", fontStyle: "italic" }}>{dest.tagline}</td>
												{canEditUniversities && (
													<td style={{ padding: "1rem", textAlign: "right" }}>
														<button className="btn btn--ghost" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setEditingDest(dest)}>Edit</button>
														<button className="btn btn--ghost" style={{ padding: "0.25rem 0.5rem", color: "var(--danger)" }} onClick={() => deleteDestination(dest.id)}>Del</button>
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{/* Form Dropdowns Tab */}
					{tab === "form-dropdowns" && (
						<EnterpriseLookups />
					)}
				</>
			)}

			{/* Edit University Modal */}
			{editingUni && (
				<div className="modal-overlay" onClick={() => setEditingUni(null)}>
					<div className="modal-content" style={{ maxWidth: "500px" }} onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<h3 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{editingUni.id ? "Edit University" : "Add University"}</h3>
							<button className="modal-close" onClick={() => setEditingUni(null)}>×</button>
						</div>
						<form onSubmit={saveUniversity} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<label className="field">
								<span className="field-label">Name</span>
								<input type="text" value={editingUni.name || ""} onChange={(e) => setEditingUni({ ...editingUni, name: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">Destination</span>
								<select value={editingUni.destinationId || ""} onChange={(e) => setEditingUni({ ...editingUni, destinationId: e.target.value })}>
									<option value="">Select country...</option>
									{destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
								</select>
							</label>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<label className="field">
									<span className="field-label">City</span>
									<input type="text" value={editingUni.city || ""} onChange={(e) => setEditingUni({ ...editingUni, city: e.target.value })} />
								</label>
								<label className="field">
									<span className="field-label">Type (e.g. Public)</span>
									<input type="text" value={editingUni.type || ""} onChange={(e) => setEditingUni({ ...editingUni, type: e.target.value })} />
								</label>
							</div>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<label className="field">
									<span className="field-label">Acceptance Rate</span>
									<input type="text" value={editingUni.acceptance || ""} onChange={(e) => setEditingUni({ ...editingUni, acceptance: e.target.value })} />
								</label>
								<label className="field">
									<span className="field-label">Ranking</span>
									<input type="text" value={editingUni.ranking || ""} onChange={(e) => setEditingUni({ ...editingUni, ranking: e.target.value })} />
								</label>
							</div>
							<div className="modal-actions" style={{ marginTop: "1rem" }}>
								<button type="button" className="btn btn--ghost" onClick={() => setEditingUni(null)}>Cancel</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Edit Destination Modal */}
			{editingDest && (
				<div className="modal-overlay" onClick={() => setEditingDest(null)}>
					<div className="modal-content" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<h3 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{editingDest.id ? "Edit Country" : "Add Country"}</h3>
							<button className="modal-close" onClick={() => setEditingDest(null)}>×</button>
						</div>
						<form onSubmit={saveDestination} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<label className="field">
								<span className="field-label">Name (e.g. Canada)</span>
								<input type="text" value={editingDest.name || ""} onChange={(e) => setEditingDest({ ...editingDest, name: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">Region (e.g. North America)</span>
								<input type="text" value={editingDest.region || ""} onChange={(e) => setEditingDest({ ...editingDest, region: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">Tagline</span>
								<input type="text" value={editingDest.tagline || ""} onChange={(e) => setEditingDest({ ...editingDest, tagline: e.target.value })} />
							</label>
							<div className="modal-actions" style={{ marginTop: "1rem" }}>
								<button type="button" className="btn btn--ghost" onClick={() => setEditingDest(null)}>Cancel</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
							</div>
						</form>
					</div>
				</div>
		)}

			<ConfirmDialog
				open={confirmOpen}
				title="Confirm Delete"
				message="Are you sure you want to delete this item?"
				danger
				confirmLabel="Delete"
				onConfirm={() => { confirmAction?.(); setConfirmOpen(false); setConfirmAction(null); }}
				onCancel={() => { setConfirmOpen(false); setConfirmAction(null); }}
			/>
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
