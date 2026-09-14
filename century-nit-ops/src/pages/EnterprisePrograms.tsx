import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useCases } from "../hooks/useCases";
import { useOpsAuth } from "./OpsAuthContext";
import {
	API_PREFIX,
	type CatalogProgram,
	type CatalogScholarship,
	type CatalogUniversity,
	type CatalogProgramUpdate,
	type CatalogScholarshipUpdate,
} from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { ConfirmDialog, Toast } from "./OpsDialogs";

type Tab = "programs" | "scholarships";

type ProgramFormInput = CatalogProgramUpdate & { id?: string };
type ScholarshipFormInput = CatalogScholarshipUpdate & { id?: string };

export function EnterprisePrograms() {
	const { canEditUniversities: canEditPrograms } = useOpsAuth();
	const [tab, setTab] = useState<Tab>("programs");
	const [search, setSearch] = useState("");
	
	const [programs, setPrograms] = useState<CatalogProgram[]>([]);
	const [scholarships, setScholarships] = useState<CatalogScholarship[]>([]);
	const [universities, setUniversities] = useState<CatalogUniversity[]>([]);
	const [loading, setLoading] = useState(true);

	const [editingProg, setEditingProg] = useState<ProgramFormInput | null>(null);
	const [editingSchol, setEditingSchol] = useState<ScholarshipFormInput | null>(null);
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
		if (!editingProg) return;
		setSaving(true);
		try {
			const method = editingProg.id ? "PUT" : "POST";
			const url = editingProg.id ? `${API_PREFIX}/catalog/programs/${editingProg.id}` : `${API_PREFIX}/catalog/programs`;
			
			const payload: Record<string, unknown> = { ...editingProg };
			delete payload.id;
			delete payload.createdAt;
			delete payload.updatedAt;

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
		if (!editingSchol) return;
		setSaving(true);
		try {
			const method = editingSchol.id ? "PUT" : "POST";
			const url = editingSchol.id ? `${API_PREFIX}/catalog/scholarships/${editingSchol.id}` : `${API_PREFIX}/catalog/scholarships`;
			
			const payload: Record<string, unknown> = { ...editingSchol };
			delete payload.id;
			delete payload.createdAt;
			delete payload.updatedAt;

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

	function uniName(uniId: string | null | undefined): string {
		return universities.find((u) => u.id === uniId)?.name ?? uniId ?? "—";
	}
	const { applications } = useCases();
	const [uniCut, setUniCut] = useState<string>("all");
	/** Clients applying to each programme, from the cases' school lines. */
	const applying = useMemo(() => {
		const m = new Map<string, number>();
		for (const a of applications) for (const sa of a.schoolApplications ?? []) if (sa.programId) m.set(sa.programId, (m.get(sa.programId) ?? 0) + 1);
		return m;
	}, [applications]);
	const levels = useMemo(() => [...new Set(programs.map((p) => p.level).filter((l): l is string => Boolean(l)))].sort(), [programs]);
	const [levelCut, setLevelCut] = useState<string>("all");
	const bands = useMemo(() => {
		const list = filteredPrograms
			.filter((pr) => (uniCut === "all" || pr.universityId === uniCut) && (levelCut === "all" || pr.level === levelCut))
			.sort((a, b) => (applying.get(b.id) ?? 0) - (applying.get(a.id) ?? 0) || a.name.localeCompare(b.name));
		const by = new Map<string, typeof list>();
		for (const pr of list) by.set(pr.universityId ?? "", [...(by.get(pr.universityId ?? "") ?? []), pr]);
		return [...by.entries()]
			.map(([uniId, progs]) => ({ uniId, uni: universities.find((u) => u.id === uniId) ?? null, progs }))
			.sort((a, b) => b.progs.reduce((n, pr) => n + (applying.get(pr.id) ?? 0), 0) - a.progs.reduce((n, pr) => n + (applying.get(pr.id) ?? 0), 0) || (a.uni?.name ?? "").localeCompare(b.uni?.name ?? ""));
	}, [filteredPrograms, uniCut, levelCut, applying, universities]);

	return (
		<div className="admin-page fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h2 className="section-title">{tab === "scholarships" ? "Scholarships" : "Programmes"}</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>{tab === "scholarships" ? "The scholarships Century tracks — by university, with the amount and the deadline." : "What clients can study, by university — level, tuition, intake, and who is applying."}</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<div className="cn-scaffold__chips" role="tablist" aria-label="View">
						{([["programs", "Programmes"], ["scholarships", "Scholarships"]] as const).map(([key, label]) => (
							<button key={key} type="button" role="tab" aria-selected={tab === key} className={`btn btn--sm ${tab === key ? "btn--primary" : "btn--ghost"}`} onClick={() => { setTab(key); setSearch(""); }}>
								{label}
							</button>
						))}
					</div>
					{tab === "programs" && canEditPrograms && (
						<button className="btn btn--primary btn--sm" onClick={() => setEditingProg({ name: "" })}>+ Add programme</button>
					)}
					{tab === "scholarships" && canEditPrograms && (
						<button className="btn btn--primary btn--sm" onClick={() => setEditingSchol({ name: "" })}>+ Add scholarship</button>
					)}
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{programs.length}</strong> <span className="dash-day__date">programmes</span>
				</span>
				<span>
					<strong>{new Set(programs.map((pr) => pr.universityId)).size}</strong> <span className="dash-day__date">universities</span>
				</span>
				<span>
					<strong>{scholarships.length}</strong> <span className="dash-day__date">scholarships</span>
				</span>
				<span>
					<strong>{[...applying.values()].reduce((n, x) => n + x, 0)}</strong> <span className="dash-day__date">applications in flight</span>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/universities" className="dash-link">
					Universities →
				</Link>
			</div>

			{loading ? (
				<p className="muted">Loading catalog...</p>
			) : (
				<>
					{tab === "programs" && (
						<>
							<div className="cn-scaffold__filters" style={{ border: "1px solid var(--border-light)", marginBottom: "0.5rem" }}>
								<div className="cn-scaffold__chips" role="tablist" aria-label="Level">
									{[{ id: "all", label: "All levels", n: programs.length }, ...levels.map((l) => ({ id: l, label: l, n: programs.filter((pr) => pr.level === l).length }))].map((c) => {
										const on = levelCut === c.id;
										return (
											<button key={c.id} type="button" role="tab" aria-selected={on} className="ops-pill" onClick={() => setLevelCut(c.id)} style={{ cursor: "pointer", marginLeft: 0, border: "1px solid var(--border)", background: on ? "var(--foreground)" : "transparent", color: on ? "var(--background)" : "var(--foreground)" }}>
												{c.label}
												<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
													{c.n}
												</span>
											</button>
										);
									})}
								</div>
								<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
									<input type="search" className="cn-search" placeholder="Search programme, field…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search programmes" style={{ flex: "1 1 14rem", width: "auto" }} />
									<label className="cn-filter">
										<span className="cn-filter__label">University</span>
										<select className="cn-filter__select" value={uniCut} onChange={(e) => setUniCut(e.target.value)}>
											<option value="all">All universities</option>
											{universities.map((u) => (
												<option key={u.id} value={u.id}>
													{u.name}
												</option>
											))}
										</select>
									</label>
								</div>
							</div>
							{bands.length === 0 ? (
								<p className="ops-people__empty">No programmes match.</p>
							) : (
								<div className="ops-bands" style={{ padding: 0 }}>
									{bands.map(({ uniId, uni, progs }) => (
										<div key={uniId || "none"}>
											<div className="ops-band">
												<span className="ops-band__name">
													{uni?.name ?? "No university"} · {progs.length}
												</span>
												<span className="ops-band__note">{uni ? [uni.city, uni.type].filter(Boolean).join(" · ") : ""}</span>
											</div>
											<div className="ops-people ops-people--three">
												{progs.map((pr) => {
													const n = applying.get(pr.id) ?? 0;
													return (
														<div key={pr.id} className={`ops-uni${pr.isActive === false ? " ops-uni--off" : ""}`}>
															<div className="ops-uni__h">
																<span className="ops-uni__n" title={pr.name}>
																	{pr.name}
																</span>
																<span className="ops-uni__k">{pr.level ?? ""}</span>
															</div>
															<div className="ops-uni__k">{[pr.field, pr.duration, pr.tuition ? `tuition ${pr.tuition}` : null].filter(Boolean).join(" · ") || "—"}</div>
															<div className="ops-uni__s">
																{pr.intake && pr.intake.length > 0 ? `intake ${pr.intake.join(", ")}` : "intake —"}
																{pr.applicationDeadline ? ` · deadline ${pr.applicationDeadline}` : ""}
																{pr.isActive === false ? " · inactive" : ""}
															</div>
															<div className="ops-uni__foot">
																<span>
																	{n} client{n === 1 ? "" : "s"} applying
																</span>
																{canEditPrograms && (
																	<span style={{ display: "flex", gap: "0.6rem" }}>
																		<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setEditingProg(pr)}>
																			edit
																		</button>
																		<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => deleteProgram(pr.id)}>
																			delete
																		</button>
																	</span>
																)}
															</div>
														</div>
													);
												})}
											</div>
										</div>
									))}
								</div>
							)}
						</>
					)}
					{tab === "scholarships" && (
						<>
							<div className="cn-scaffold__filters" style={{ border: "1px solid var(--border-light)", marginBottom: "0.75rem" }}>
								<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
									<input type="search" className="cn-search" placeholder="Search scholarships…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search scholarships" style={{ flex: "1 1 14rem", width: "auto" }} />
								</div>
							</div>
							{filteredScholarships.length === 0 ? (
								<p className="ops-people__empty">No scholarships match.</p>
							) : (
								<div className="ops-people ops-people--three">
									{filteredScholarships.map((sc) => (
										<div key={sc.id} className={`ops-uni${sc.isActive === false ? " ops-uni--off" : ""}`}>
											<div className="ops-uni__h">
												<span className="ops-uni__n" title={sc.name}>
													{sc.name}
												</span>
												<span className="cn-money" style={{ fontSize: "var(--text-xs)", fontWeight: 700 }}>
													{sc.amount ?? "—"}
												</span>
											</div>
											<div className="ops-uni__k">
												{uniName(sc.universityId)}
												{sc.type ? ` · ${sc.type}` : ""}
											</div>
											<div className="ops-uni__s">
												{sc.deadline ? `deadline ${sc.deadline}` : "no deadline"}
												{sc.eligibility ? ` · ${sc.eligibility}` : ""}
											</div>
											{canEditPrograms && (
												<div className="ops-uni__foot">
													<span />
													<span style={{ display: "flex", gap: "0.6rem" }}>
														<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setEditingSchol(sc)}>
															edit
														</button>
														<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => deleteScholarship(sc.id)}>
															delete
														</button>
													</span>
												</div>
											)}
										</div>
									))}
								</div>
							)}
						</>
					)}
				</>
			)}

			{/* Edit Program Modal */}
			{editingProg && (
				<div className="ops-modal-backdrop" onClick={() => setEditingProg(null)} role="dialog" aria-modal="true" aria-label="Program editor">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "34rem" }}>
						<header className="ops-modal__head">
							<div>
								<h2 className="ops-modal__title">{editingProg.id ? "Edit Program" : "Add Program"}</h2>
								<p className="ops-modal__sub">Catalog program record</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingProg(null)}>✕ Close</button>
						</header>
						<form onSubmit={saveProgram} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<label className="field">
								<span className="field-label">Name</span>
								<input className="input" type="text" value={editingProg.name || ""} onChange={(e) => setEditingProg({ ...editingProg, name: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">University</span>
								<select className="select" value={editingProg.universityId || ""} onChange={(e) => setEditingProg({ ...editingProg, universityId: e.target.value })}>
									<option value="">Select university...</option>
									{universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
								</select>
							</label>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<label className="field">
									<span className="field-label">Level</span>
									<input className="input" type="text" value={editingProg.level || ""} onChange={(e) => setEditingProg({ ...editingProg, level: e.target.value })} />
								</label>
								<label className="field">
									<span className="field-label">Tuition</span>
									<input className="input" type="text" value={editingProg.tuition || ""} onChange={(e) => setEditingProg({ ...editingProg, tuition: e.target.value })} />
								</label>
							</div>
							<label className="field">
								<span className="field-label">Application fee override (USD) — leave blank to charge the university's fee</span>
								<input
									className="input"
									inputMode="decimal"
									value={editingProg.applicationFeeCents != null ? String(editingProg.applicationFeeCents / 100) : ""}
									onChange={(e) => {
										const raw = e.target.value.trim();
										const n = Number(raw.replace(/[^0-9.]/g, ""));
										setEditingProg({ ...editingProg, applicationFeeCents: raw === "" ? null : Number.isFinite(n) ? Math.round(n * 100) : null });
									}}
								/>
							</label>
							<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingProg(null)} disabled={saving}>Cancel</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Edit Scholarship Modal */}
			{editingSchol && (
				<div className="ops-modal-backdrop" onClick={() => setEditingSchol(null)} role="dialog" aria-modal="true" aria-label="Scholarship editor">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "28rem" }}>
						<header className="ops-modal__head">
							<div>
								<h2 className="ops-modal__title">{editingSchol.id ? "Edit Scholarship" : "Add Scholarship"}</h2>
								<p className="ops-modal__sub">Catalog scholarship record</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingSchol(null)}>✕ Close</button>
						</header>
						<form onSubmit={saveScholarship} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<label className="field">
								<span className="field-label">Name</span>
								<input className="input" type="text" value={editingSchol.name || ""} onChange={(e) => setEditingSchol({ ...editingSchol, name: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">University</span>
								<select className="select" value={editingSchol.universityId || ""} onChange={(e) => setEditingSchol({ ...editingSchol, universityId: e.target.value })}>
									<option value="">Select university...</option>
									{universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
								</select>
							</label>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<label className="field">
									<span className="field-label">Amount</span>
									<input className="input" type="text" value={editingSchol.amount || ""} onChange={(e) => setEditingSchol({ ...editingSchol, amount: e.target.value })} />
								</label>
								<label className="field">
									<span className="field-label">Deadline</span>
									<input className="input" type="text" value={editingSchol.deadline || ""} onChange={(e) => setEditingSchol({ ...editingSchol, deadline: e.target.value })} />
								</label>
							</div>
							<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingSchol(null)} disabled={saving}>Cancel</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
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
