import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useCases } from "../hooks/useCases";
import { useFeeCatalogue } from "../hooks/useFeeCatalogue";
import { useOpsAuth } from "./OpsAuthContext";
import {
	API_PREFIX,
	type CatalogUniversity,
	type CatalogDestination,
	type CatalogUniversityUpdate,
	type CatalogDestinationUpdate,
} from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { ConfirmDialog, Toast } from "./OpsDialogs";
import { EnterpriseLookups } from "./EnterpriseLookups";

type Tab = "universities" | "countries" | "form-dropdowns";

type UniversityFormInput = CatalogUniversityUpdate & { id?: string };
type DestinationFormInput = CatalogDestinationUpdate & { id?: string };

export function EnterpriseUniversities() {
	const { canEditUniversities, hasPermission } = useOpsAuth();
	// Form dropdowns are the admin's (the "lookups" module); no tab for anyone else.
	const canSeeLookups = hasPermission("lookups");
	const [tab, setTab] = useState<Tab>("universities");
	const [search, setSearch] = useState("");
	
	const [universities, setUniversities] = useState<CatalogUniversity[]>([]);
	const [destinations, setDestinations] = useState<CatalogDestination[]>([]);
	const [programs, setPrograms] = useState<{ id: string; universityId?: string | null }[]>([]);
	const [countryCut, setCountryCut] = useState<string>("all");
	const [sort, setSort] = useState<"applied" | "name" | "fee">("applied");
	const { applications } = useCases();
	const { catalogue } = useFeeCatalogue();
	useEffect(() => {
		apiFetch<{ programs: { id: string; universityId?: string | null }[] }>(`${API_PREFIX}/catalog/programs`)
			.then((res) => setPrograms(res.programs ?? []))
			.catch(() => setPrograms([]));
	}, []);
	const [loading, setLoading] = useState(true);

	const [editingUni, setEditingUni] = useState<UniversityFormInput | null>(null);
	const [editingDest, setEditingDest] = useState<DestinationFormInput | null>(null);
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
				apiFetch<{ universities: CatalogUniversity[] }>(`${API_PREFIX}/catalog/universities`),
				apiFetch<{ destinations: CatalogDestination[] }>(`${API_PREFIX}/catalog/destinations`)
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
		if (!editingUni) return;
		setSaving(true);
		try {
			const method = editingUni.id ? "PUT" : "POST";
			const url = editingUni.id ? `${API_PREFIX}/catalog/universities/${editingUni.id}` : `${API_PREFIX}/catalog/universities`;
			
			// Strip audit-only fields; the API sets createdAt/updatedAt and generates an id for POSTs.
			const payload: Record<string, unknown> = { ...editingUni };
			delete payload.id;
			delete payload.createdAt;
			delete payload.updatedAt;

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
		if (!editingDest) return;
		setSaving(true);
		try {
			const method = editingDest.id ? "PUT" : "POST";
			const url = editingDest.id ? `${API_PREFIX}/catalog/destinations/${editingDest.id}` : `${API_PREFIX}/catalog/destinations`;
			
			const payload: Record<string, unknown> = { ...editingDest };
			delete payload.id;
			delete payload.createdAt;
			delete payload.updatedAt;

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
		if (q && !d.name.toLowerCase().includes(q) && !d.region?.toLowerCase().includes(q)) return false;
		return true;
	});

	const rate = catalogue?.exchangeRate ?? 0;
	const ghs = (cents: number) => (rate > 0 ? `GH₵ ${((cents / 100) * rate).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${(cents / 100).toFixed(2)}`);
	const tariffOf = (destId: string) => catalogue?.destinations.find((d) => d.id === destId) ?? null;
	/** Clients with a school application at each university, and programmes per university. */
	const applying = useMemo(() => {
		const m = new Map<string, number>();
		for (const a of applications) for (const sa of a.schoolApplications ?? []) if (sa.universityId) m.set(sa.universityId, (m.get(sa.universityId) ?? 0) + 1);
		return m;
	}, [applications]);
	const programCount = useMemo(() => {
		const m = new Map<string, number>();
		for (const pr of programs) if (pr.universityId) m.set(pr.universityId, (m.get(pr.universityId) ?? 0) + 1);
		return m;
	}, [programs]);
	const missingFee = universities.filter((u) => !u.applicationFeeCents);
	/** Universities by country, in the cut, sorted. */
	const bands = useMemo(() => {
		const list = filteredUnis
			.filter((u) => countryCut === "all" || (countryCut === "missing" ? !u.applicationFeeCents : u.destinationId === countryCut))
			.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "fee" ? (b.applicationFeeCents ?? -1) - (a.applicationFeeCents ?? -1) : (applying.get(b.id) ?? 0) - (applying.get(a.id) ?? 0) || a.name.localeCompare(b.name)));
		const by = new Map<string, CatalogUniversity[]>();
		for (const u of list) by.set(u.destinationId ?? "", [...(by.get(u.destinationId ?? "") ?? []), u]);
		return [...by.entries()]
			.map(([destId, unis]) => ({ destId, dest: destinations.find((d) => d.id === destId) ?? null, unis }))
			.sort((a, b) => b.unis.reduce((n, u) => n + (applying.get(u.id) ?? 0), 0) - a.unis.reduce((n, u) => n + (applying.get(u.id) ?? 0), 0) || (a.dest?.name ?? "").localeCompare(b.dest?.name ?? ""));
	}, [filteredUnis, countryCut, sort, applying, destinations]);

	return (
		<div className="admin-page fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h2 className="section-title">{tab === "countries" ? "Countries" : tab === "form-dropdowns" ? "Form dropdowns" : "Universities"}</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						{tab === "countries" ? "Where Century places clients — each with the visa costs paid on their behalf." : tab === "form-dropdowns" ? "The options the portal's forms offer." : "The schools Century places clients at, by country — with the fee each charges to apply."}
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<div className="cn-scaffold__chips" role="tablist" aria-label="View">
						{([["universities", "Universities"], ["countries", "Countries"], ["form-dropdowns", "Form dropdowns"]] as const)
							.filter(([key]) => key !== "form-dropdowns" || canSeeLookups)
							.map(([key, label]) => (
								<button key={key} type="button" role="tab" aria-selected={tab === key} className={`btn btn--sm ${tab === key ? "btn--primary" : "btn--ghost"}`} onClick={() => { setTab(key); setSearch(""); }}>
									{label}
								</button>
							))}
					</div>
					{tab === "universities" && canEditUniversities && (
						<button className="btn btn--primary btn--sm" onClick={() => setEditingUni({ name: "" })}>+ Add university</button>
					)}
					{tab === "countries" && canEditUniversities && (
						<button className="btn btn--primary btn--sm" onClick={() => setEditingDest({ name: "", region: "" })}>+ Add country</button>
					)}
				</div>
			</div>

			{tab !== "form-dropdowns" && (
				<div className="dash-day" style={{ margin: "0 0 1rem" }}>
					<span>
						<strong>{universities.length}</strong> <span className="dash-day__date">universities</span>
					</span>
					<span>
						<strong>{destinations.length}</strong> <span className="dash-day__date">countries</span>
					</span>
					<span>
						<strong>{programs.length}</strong> <span className="dash-day__date">programmes</span>
					</span>
					<span>
						<strong>{universities.length - missingFee.length}</strong> <span className="dash-day__date">with a fee set</span>
					</span>
					{missingFee.length > 0 && (
						<span>
							<strong>{missingFee.length}</strong> <span className="dash-day__date">missing a fee</span>
						</span>
					)}
					<span className="dash-day__sep" aria-hidden>
						|
					</span>
					<Link to="/fee-schedule" className="dash-link">
						Fee schedule →
					</Link>
				</div>
			)}

			{loading ? (
				<p className="muted">Loading catalog...</p>
			) : (
				<>
					{tab === "universities" && (
						<>
							<div className="cn-scaffold__filters" style={{ border: "1px solid var(--border-light)", marginBottom: "0.5rem" }}>
								<div className="cn-scaffold__chips" role="tablist" aria-label="Country">
									{[{ id: "all", label: "All", n: universities.length }, ...destinations.map((d) => ({ id: d.id, label: d.name, n: universities.filter((u) => u.destinationId === d.id).length })).filter((c) => c.n > 0), { id: "missing", label: "Missing a fee", n: missingFee.length }].map((c) => {
										const on = countryCut === c.id;
										return (
											<button
												key={c.id}
												type="button"
												role="tab"
												aria-selected={on}
												className="ops-pill"
												onClick={() => setCountryCut(c.id)}
												style={{
													cursor: "pointer",
													marginLeft: 0,
													border: "1px solid var(--border)",
													background: on ? "var(--foreground)" : "transparent",
													color: on ? "var(--background)" : c.n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
													fontWeight: c.id === "missing" && c.n > 0 && !on ? 700 : 500,
												}}
											>
												{c.label}
												<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
													{c.n}
												</span>
											</button>
										);
									})}
								</div>
								<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
									<input type="search" className="cn-search" placeholder="Search university, city…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search universities" style={{ flex: "1 1 14rem", width: "auto" }} />
									<label className="cn-filter">
										<span className="cn-filter__label">Sort</span>
										<select className="cn-filter__select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
											<option value="applied">Most applied to</option>
											<option value="name">By name</option>
											<option value="fee">Highest fee first</option>
										</select>
									</label>
								</div>
							</div>
							{bands.length === 0 ? (
								<p className="ops-people__empty">No universities match.</p>
							) : (
								<div className="ops-bands" style={{ padding: 0 }}>
									{bands.map(({ destId, dest, unis }) => {
										const t = destId ? tariffOf(destId) : null;
										return (
											<div key={destId || "none"}>
												<div className="ops-band">
													<span className="ops-band__name">
														{dest?.name ?? "No country"} · {unis.length}
													</span>
													<span className="ops-band__note">
														{t ? `visa ${ghs(t.visaFeeCents)} · biometrics ${ghs(t.biometricsFeeCents)}` : dest ? "no visa costs set" : ""}
														{dest && canEditUniversities && (
															<>
																{" · "}
																<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setEditingDest(dest)}>
																	edit country
																</button>
															</>
														)}
													</span>
												</div>
												<div className="ops-people ops-people--three">
													{unis.map((uni) => {
														const n = applying.get(uni.id) ?? 0;
														const pc = programCount.get(uni.id) ?? 0;
														return (
															<div key={uni.id} className={`ops-uni${uni.isActive === false ? " ops-uni--off" : ""}`}>
																<div className="ops-uni__h">
																	<span className="ops-uni__n" title={uni.name}>
																		{uni.name}
																	</span>
																	<span className="cn-money" style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: uni.applicationFeeCents ? "inherit" : "var(--muted-foreground)" }}>
																		{uni.applicationFeeCents ? ghs(uni.applicationFeeCents) : "no fee set"}
																	</span>
																</div>
																<div className="ops-uni__k">
																	{[uni.city, uni.type, uni.acceptance ? `acceptance ${uni.acceptance}` : null, uni.ranking ? `rank ${uni.ranking}` : null].filter(Boolean).join(" · ") || "—"}
																</div>
																<div className="ops-uni__s">
																	{pc} programme{pc === 1 ? "" : "s"} · {n} client{n === 1 ? "" : "s"} applying
																	{uni.isActive === false ? " · inactive" : ""}
																</div>
																<div className="ops-uni__foot">
																	<span>application fee · at cost</span>
																	<span style={{ display: "flex", gap: "0.6rem" }}>
																		<Link to="/programs" className="dash-link">
																			programmes
																		</Link>
																		{canEditUniversities && (
																			<>
																				<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setEditingUni(uni)}>
																					edit
																				</button>
																				<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => deleteUniversity(uni.id)}>
																					delete
																				</button>
																			</>
																		)}
																	</span>
																</div>
															</div>
														);
													})}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</>
					)}
					{tab === "countries" && (
						<>
							<div className="cn-scaffold__filters" style={{ border: "1px solid var(--border-light)", marginBottom: "0.75rem" }}>
								<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
									<input type="search" className="cn-search" placeholder="Search countries, regions…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search countries" style={{ flex: "1 1 14rem", width: "auto" }} />
								</div>
							</div>
							{filteredDestinations.length === 0 ? (
								<p className="ops-people__empty">No countries match.</p>
							) : (
								<div className="ops-people ops-people--three">
									{filteredDestinations.map((dest) => {
										const t = tariffOf(dest.id);
										const unis = universities.filter((u) => u.destinationId === dest.id);
										const n = unis.reduce((sum, u) => sum + (applying.get(u.id) ?? 0), 0);
										return (
											<div key={dest.id} className="ops-uni">
												<div className="ops-uni__h">
													<span className="ops-uni__n">{dest.name}</span>
													<span className="ops-uni__k">{dest.region}</span>
												</div>
												<div className="ops-uni__k">{t ? `visa ${ghs(t.visaFeeCents)} · biometrics ${ghs(t.biometricsFeeCents)}` : "no visa costs set"}</div>
												<div className="ops-uni__s">
													{unis.length} universit{unis.length === 1 ? "y" : "ies"} · {n} client{n === 1 ? "" : "s"} applying
												</div>
												{dest.tagline && <div className="ops-uni__s" style={{ fontStyle: "italic" }}>{dest.tagline}</div>}
												<div className="ops-uni__foot">
													<Link to="/fee-schedule" className="dash-link">
														visa costs
													</Link>
													{canEditUniversities && (
														<span style={{ display: "flex", gap: "0.6rem" }}>
															<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setEditingDest(dest)}>
																edit
															</button>
															<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => deleteDestination(dest.id)}>
																delete
															</button>
														</span>
													)}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</>
					)}
					{/* Form Dropdowns Tab */}
					{tab === "form-dropdowns" && (
						<EnterpriseLookups />
					)}
				</>
			)}

			{/* Edit University Modal */}
			{editingUni && (
				<div className="ops-modal-backdrop" onClick={() => setEditingUni(null)} role="dialog" aria-modal="true" aria-label="University editor">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "34rem" }}>
						<header className="ops-modal__head">
							<div>
								<h2 className="ops-modal__title">{editingUni.id ? "Edit University" : "Add University"}</h2>
								<p className="ops-modal__sub">Catalog school record</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingUni(null)}>✕ Close</button>
						</header>
						<form onSubmit={saveUniversity} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<label className="field">
								<span className="field-label">Name</span>
								<input className="input" type="text" value={editingUni.name || ""} onChange={(e) => setEditingUni({ ...editingUni, name: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">Destination</span>
								<select className="select" value={editingUni.destinationId || ""} onChange={(e) => setEditingUni({ ...editingUni, destinationId: e.target.value })}>
									<option value="">Select country...</option>
									{destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
								</select>
							</label>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<label className="field">
									<span className="field-label">City</span>
									<input className="input" type="text" value={editingUni.city || ""} onChange={(e) => setEditingUni({ ...editingUni, city: e.target.value })} />
								</label>
								<label className="field">
									<span className="field-label">Type (e.g. Public)</span>
									<input className="input" type="text" value={editingUni.type || ""} onChange={(e) => setEditingUni({ ...editingUni, type: e.target.value })} />
								</label>
							</div>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
								<label className="field">
									<span className="field-label">Acceptance Rate</span>
									<input className="input" type="text" value={editingUni.acceptance || ""} onChange={(e) => setEditingUni({ ...editingUni, acceptance: e.target.value })} />
								</label>
								<label className="field">
									<span className="field-label">Ranking</span>
									<input className="input" type="text" value={editingUni.ranking || ""} onChange={(e) => setEditingUni({ ...editingUni, ranking: e.target.value })} />
								</label>
							</div>
							<label className="field">
								<span className="field-label">Application fee (USD) — the university's own fee, paid on the client's behalf at cost</span>
								<input
									className="input"
									inputMode="decimal"
									value={editingUni.applicationFeeCents != null ? String(editingUni.applicationFeeCents / 100) : ""}
									onChange={(e) => {
										const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
										setEditingUni({ ...editingUni, applicationFeeCents: e.target.value.trim() === "" ? 0 : Number.isFinite(n) ? Math.round(n * 100) : 0 });
									}}
									placeholder="0 when the university charges nothing"
								/>
							</label>
							<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingUni(null)} disabled={saving}>Cancel</button>
								<button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Edit Destination Modal */}
			{editingDest && (
				<div className="ops-modal-backdrop" onClick={() => setEditingDest(null)} role="dialog" aria-modal="true" aria-label="Country editor">
					<div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "28rem" }}>
						<header className="ops-modal__head">
							<div>
								<h2 className="ops-modal__title">{editingDest.id ? "Edit Country" : "Add Country"}</h2>
								<p className="ops-modal__sub">Catalog destination record</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingDest(null)}>✕ Close</button>
						</header>
						<form onSubmit={saveDestination} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<label className="field">
								<span className="field-label">Name (e.g. Canada)</span>
								<input className="input" type="text" value={editingDest.name || ""} onChange={(e) => setEditingDest({ ...editingDest, name: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">Region (e.g. North America)</span>
								<input className="input" type="text" value={editingDest.region || ""} onChange={(e) => setEditingDest({ ...editingDest, region: e.target.value })} required />
							</label>
							<label className="field">
								<span className="field-label">Tagline</span>
								<input className="input" type="text" value={editingDest.tagline || ""} onChange={(e) => setEditingDest({ ...editingDest, tagline: e.target.value })} />
							</label>
							<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingDest(null)} disabled={saving}>Cancel</button>
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
