import { useState, useEffect } from "react";
import { useOpsAuth } from "./OpsAuthContext";
import { API_PREFIX, type CatalogProgram, type CatalogScholarship, type CatalogUniversity } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { ConfirmDialog, Toast } from "./OpsDialogs";

type Tab = "programs" | "scholarships";

export function EnterprisePrograms() {
	const { canEditUniversities: canEditPrograms } = useOpsAuth();
	const [tab, setTab] = useState<Tab>("programs");
	const [search, setSearch] = useState("");
	
	const [programs, setPrograms] = useState<any[]>([]);
	const [scholarships, setScholarships] = useState<any[]>([]);
	const [universities, setUniversities] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);

	const [editingProg, setEditingProg] = useState<any | null>(null);
	const [editingSchol, setEditingSchol] = useState<any | null>(null);
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
			const [progRes, scholRes, uniRes] = await Promise.all([
				apiFetch<{ programs: CatalogProgram[] }>(`${API_PREFIX}/catalog/programs`),
				apiFetch<{ scholarships: CatalogScholarship[] }>(`${API_PREFIX}/catalog/scholarships`),
				apiFetch<{ universities: CatalogUniversity[] }>(`${API_PREFIX}/catalog/universities`)
			]);
			setPrograms(progRes.programs);
			setScholarships(scholRes.scholarships);
			setUniversities(uniRes.universities);
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	}

	async function saveProgram(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		try {
			const method = editingProg.id ? "PUT" : "POST";
			const url = editingProg.id ? `${API_PREFIX}/catalog/programs/${editingProg.id}` : `${API_PREFIX}/catalog/programs`;
			
			const payload = { ...editingProg };
			if (!payload.id) payload.id = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

			await apiFetch(url, {
				method,
				body: JSON.stringify(payload)
			});
			setEditingProg(null);
			loadData();
		} catch (err) {
			showToast("error", err instanceof ApiError ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	async function saveScholarship(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		try {
			const method = editingSchol.id ? "PUT" : "POST";
			const url = editingSchol.id ? `${API_PREFIX}/catalog/scholarships/${editingSchol.id}` : `${API_PREFIX}/catalog/scholarships`;
			
			const payload = { ...editingSchol };
			if (!payload.id) payload.id = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

			await apiFetch(url, {
				method,
				body: JSON.stringify(payload)
			});
			setEditingSchol(null);
			loadData();
		} catch (err) {
			showToast("error", err instanceof ApiError ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	async function deleteProgram(id: string) {
		setConfirmAction(() => async () => {
			try {
				await apiFetch(`${API_PREFIX}/catalog/programs/${id}`, { method: "DELETE" });
				loadData();
			} catch (err) {
				showToast("error", err instanceof ApiError ? err.message : String(err));
			}
		});
		setConfirmOpen(true);
	}

	async function deleteScholarship(id: string) {
		setConfirmAction(() => async () => {
			try {
				await apiFetch(`${API_PREFIX}/catalog/scholarships/${id}`, { method: "DELETE" });
				loadData();
			} catch (err) {
				showToast("error", err instanceof ApiError ? err.message : String(err));
			}
		});
		setConfirmOpen(true);
	}

	const q = search.toLowerCase();

	const filteredPrograms = programs.filter((p) => {
		if (q && !p.name.toLowerCase().includes(q) && !p.field?.toLowerCase().includes(q)) return false;
		return true;
	});

	const filteredScholarships = scholarships.filter((s) => {
		if (q && !s.name.toLowerCase().includes(q)) return false;
		return true;
	});

	function uniName(uniId: string): string {
		return universities.find((u) => u.id === uniId)?.name ?? uniId;
	}

	return (
		<div className="admin-page fade-in">
			<div className="admin-section-head" style={{ marginBottom: "2rem" }}>
				<div>
					<h2 className="section-title">Programs & Scholarships</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Manage study programs and available scholarships.
					</p>
				</div>
				<div>
					{tab === "programs" && canEditPrograms && (
						<button className="btn btn--primary" onClick={() => setEditingProg({ name: "" })}>+ Add Program</button>
					)}
					{tab === "scholarships" && canEditPrograms && (
						<button className="btn btn--primary" onClick={() => setEditingSchol({ name: "" })}>+ Add Scholarship</button>
					)}
				</div>
			</div>

			{/* Tabs */}
			<div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid var(--border-light)", overflowX: "auto", whiteSpace: "nowrap", paddingBottom: "2px" }}>
				{([["programs", "Programs"], ["scholarships", "Scholarships"]] as const).map(([key, label]) => (
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
			<div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
				<input
					type="search"
					placeholder={tab === "programs" ? "Search programs, fields..." : "Search scholarships..."}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					style={{ maxWidth: "400px" }}
				/>
			</div>

			{loading ? (
				<p className="muted">Loading catalog...</p>
			) : (
				<>
					{/* Programs Tab */}
					{tab === "programs" && (
						<div className="card">
							<div className="ops-table-wrap">
								<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
									<thead>
										<tr style={{ borderBottom: "2px solid var(--border)" }}>
											<th style={{ padding: "1rem" }}>Program</th>
											<th style={{ padding: "1rem" }}>University</th>
											<th style={{ padding: "1rem" }}>Level</th>
											<th style={{ padding: "1rem" }}>Tuition</th>
											{canEditPrograms && <th style={{ padding: "1rem", textAlign: "right" }}>Actions</th>}
										</tr>
									</thead>
									<tbody>
										{filteredPrograms.length === 0 ? (
											<tr><td colSpan={5} style={{ padding: "2rem", textAlign: "center" }} className="muted">No programs found.</td></tr>
										) : filteredPrograms.map((prog) => (
											<tr key={prog.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
												<td style={{ padding: "1rem", fontWeight: 600, fontSize: "var(--text-sm)" }}>{prog.name}</td>
												<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{uniName(prog.universityId)}</td>
												<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{prog.level}</td>
												<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{prog.tuition}</td>
												{canEditPrograms && (
													<td style={{ padding: "1rem", textAlign: "right" }}>
														<button className="btn btn--ghost" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setEditingProg(prog)}>Edit</button>
														<button className="btn btn--ghost" style={{ padding: "0.25rem 0.5rem", color: "var(--danger)" }} onClick={() => deleteProgram(prog.id)}>Del</button>
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{/* Scholarships Tab */}
					{tab === "scholarships" && (
						<div className="card">
							<div className="ops-table-wrap">
								<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
									<thead>
										<tr style={{ borderBottom: "2px solid var(--border)" }}>
											<th style={{ padding: "1rem" }}>Scholarship</th>
											<th style={{ padding: "1rem" }}>University</th>
											<th style={{ padding: "1rem" }}>Amount</th>
											<th style={{ padding: "1rem" }}>Deadline</th>
											{canEditPrograms && <th style={{ padding: "1rem", textAlign: "right" }}>Actions</th>}
										</tr>
									</thead>
									<tbody>
										{filteredScholarships.length === 0 ? (
											<tr><td colSpan={5} style={{ padding: "2rem", textAlign: "center" }} className="muted">No scholarships found.</td></tr>
										) : filteredScholarships.map((s) => (
											<tr key={s.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
												<td style={{ padding: "1rem", fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.name}</td>
												<td style={{ padding: "1rem", fontSize: "var(--text-sm)" }}>{uniName(s.universityId)}</td>
												<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{s.amount}</td>
												<td style={{ padding: "1rem", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>{s.deadline}</td>
												{canEditPrograms && (
													<td style={{ padding: "1rem", textAlign: "right" }}>
														<button className="btn btn--ghost" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setEditingSchol(s)}>Edit</button>
														<button className="btn btn--ghost" style={{ padding: "0.25rem 0.5rem", color: "var(--danger)" }} onClick={() => deleteScholarship(s.id)}>Del</button>
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}
				</>
			)}

			{/* Edit Program Modal */}
			{editingProg && (
				<div className="modal-overlay" onClick={() => setEditingProg(null)}>
					<div className="modal-content" style={{ maxWidth: "500px" }} onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<h3 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{editingProg.id ? "Edit Program" : "Add Program"}</h3>
							<button className="modal-close" onClick={() => setEditingProg(null)}>×</button>
						</div>
						<form onSubmit={saveProgram} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<label className="field">
								<span className="field-label">Name</span>
								<input type="text" value={editingProg.name || ""} onChange={(e) => setEditingProg({ ...editingProg, name: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">University</span>
								<select value={editingProg.universityId || ""} onChange={(e) => setEditingProg({ ...editingProg, universityId: e.target.value })}>
									<option value="">Select university...</option>
									{universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
								</select>
							</label>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<label className="field">
									<span className="field-label">Level</span>
									<input type="text" value={editingProg.level || ""} onChange={(e) => setEditingProg({ ...editingProg, level: e.target.value })} />
								</label>
								<label className="field">
									<span className="field-label">Tuition</span>
									<input type="text" value={editingProg.tuition || ""} onChange={(e) => setEditingProg({ ...editingProg, tuition: e.target.value })} />
								</label>
							</div>
							<div className="modal-actions" style={{ marginTop: "1rem" }}>
								<button type="button" className="btn btn--ghost" onClick={() => setEditingProg(null)}>Cancel</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Edit Scholarship Modal */}
			{editingSchol && (
				<div className="modal-overlay" onClick={() => setEditingSchol(null)}>
					<div className="modal-content" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<h3 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{editingSchol.id ? "Edit Scholarship" : "Add Scholarship"}</h3>
							<button className="modal-close" onClick={() => setEditingSchol(null)}>×</button>
						</div>
						<form onSubmit={saveScholarship} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<label className="field">
								<span className="field-label">Name</span>
								<input type="text" value={editingSchol.name || ""} onChange={(e) => setEditingSchol({ ...editingSchol, name: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">University</span>
								<select value={editingSchol.universityId || ""} onChange={(e) => setEditingSchol({ ...editingSchol, universityId: e.target.value })}>
									<option value="">Select university...</option>
									{universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
								</select>
							</label>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<label className="field">
									<span className="field-label">Amount</span>
									<input type="text" value={editingSchol.amount || ""} onChange={(e) => setEditingSchol({ ...editingSchol, amount: e.target.value })} />
								</label>
								<label className="field">
									<span className="field-label">Deadline</span>
									<input type="text" value={editingSchol.deadline || ""} onChange={(e) => setEditingSchol({ ...editingSchol, deadline: e.target.value })} />
								</label>
							</div>
							<div className="modal-actions" style={{ marginTop: "1rem" }}>
								<button type="button" className="btn btn--ghost" onClick={() => setEditingSchol(null)}>Cancel</button>
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
