import { useCallback, useEffect, useState } from "react";
import { API_PREFIX, PRE_DEPARTURE_OWNER_LABELS, type PreDepartureTemplateItem } from "century-nit-shared";
import { DOCUMENT_TYPES } from "century-nit-core/content";
import { Link } from "react-router-dom";
import { apiFetch, ApiError } from "../lib/api";
import { useOpsAuth } from "./OpsAuthContext";
import { Toast } from "./OpsDialogs";
import { useFeeCatalogue } from "../hooks/useFeeCatalogue";

/**
 * The pre-departure checklist template — the list every case is seeded with
 * when its visa is approved, plus each country's own items. Edits apply to
 * cases seeded from now on; a case already in Departure keeps its list.
 */

const CATEGORIES: { id: NonNullable<PreDepartureTemplateItem["category"]>; label: string }[] = [
	{ id: "travel", label: "Travel" },
	{ id: "accommodation", label: "Accommodation" },
	{ id: "documents", label: "Documents" },
	{ id: "health", label: "Health" },
	{ id: "finance", label: "Finance" },
	{ id: "orientation", label: "Orientation" },
];
const PROOF_TYPES = DOCUMENT_TYPES.filter((d) => ["insurance", "accommodation_proof", "tb_test", "police_clearance", "flight_receipt", "visa_receipt"].includes(d.id));

function slug(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function ItemEditor({
	items,
	onChange,
	canEdit,
	idPrefix,
}: {
	items: PreDepartureTemplateItem[];
	onChange: (next: PreDepartureTemplateItem[]) => void;
	canEdit: boolean;
	/** New items get `${idPrefix}-${slug}` so ids stay unique across the template and countries. */
	idPrefix: string;
}) {
	const update = (idx: number, patch: Partial<PreDepartureTemplateItem>) => onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
	const move = (idx: number, dir: -1 | 1) => {
		const j = idx + dir;
		if (j < 0 || j >= items.length) return;
		const next = [...items];
		[next[idx], next[j]] = [next[j], next[idx]];
		onChange(next);
	};
	return (
		<div className="cn-stack" style={{ gap: "0.5rem" }}>
			{items.length === 0 && <p className="muted text-sm">No items.</p>}
			{items.map((it, idx) => (
				<div key={it.id} className={`ops-depitem${it.owner === "century" ? " ops-depitem--century" : ""}`}>
					<div className="cn-stack" style={{ gap: "0.4rem" }}>
						<div className="ops-item__k">
							{it.owner === "century" ? "Century" : "The client"}
							{it.category ? ` · ${CATEGORIES.find((c) => c.id === it.category)?.label ?? it.category}` : ""}
							{it.required !== false ? " · required" : " · optional"}
							{it.evidence ? ` · proof: ${PROOF_TYPES.find((d) => d.id === it.evidence)?.name ?? it.evidence}` : ""}
						</div>
						<div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: "0.4rem" }}>
							<input className="input input--sm" value={it.label} disabled={!canEdit} onChange={(e) => update(idx, { label: e.target.value })} placeholder="Item" />
							<input className="input input--sm" value={it.detail ?? ""} disabled={!canEdit} onChange={(e) => update(idx, { detail: e.target.value })} placeholder="What it means for the client" />
						</div>
						<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
							<select className="input input--sm" style={{ width: "auto" }} value={it.owner ?? "client"} disabled={!canEdit} onChange={(e) => update(idx, { owner: e.target.value as PreDepartureTemplateItem["owner"] })} aria-label="Owner">
								<option value="client">{PRE_DEPARTURE_OWNER_LABELS.client} (the client)</option>
								<option value="century">{PRE_DEPARTURE_OWNER_LABELS.century}</option>
							</select>
							<select className="input input--sm" style={{ width: "auto" }} value={it.category ?? ""} disabled={!canEdit} onChange={(e) => update(idx, { category: (e.target.value || undefined) as PreDepartureTemplateItem["category"] })} aria-label="Category">
								<option value="">No category</option>
								{CATEGORIES.map((c) => (
									<option key={c.id} value={c.id}>
										{c.label}
									</option>
								))}
							</select>
							<select
								className="input input--sm"
								style={{ width: "auto" }}
								value={it.evidence ?? ""}
								disabled={!canEdit || it.owner === "century"}
								onChange={(e) => update(idx, { evidence: e.target.value || null })}
								aria-label="Proof"
								title={it.owner === "century" ? "Only the client's items ask for proof" : undefined}
							>
								<option value="">No proof needed</option>
								{PROOF_TYPES.map((d) => (
									<option key={d.id} value={d.id}>
										Proof: {d.name}
									</option>
								))}
							</select>
							<label style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "var(--text-xs)" }}>
								<input type="checkbox" checked={it.required !== false} disabled={!canEdit} onChange={(e) => update(idx, { required: e.target.checked })} />
								Required
							</label>
							<code className="muted" style={{ fontSize: "0.68rem" }}>{it.id}</code>
						</div>
					</div>
					{canEdit && (
						<div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">
								↑
							</button>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} title="Move down">
								↓
							</button>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(items.filter((_, i) => i !== idx))} title="Remove">
								✕
							</button>
						</div>
					)}
				</div>
			))}
			{canEdit && (
				<div>
					<button
						type="button"
						className="btn btn--sm btn--ghost"
						onClick={() => {
							const base = `${idPrefix}-item`;
							let id = base;
							let n = 2;
							while (items.some((x) => x.id === id)) id = `${base}-${n++}`;
							onChange([...items, { id, label: "", detail: "", owner: "client", evidence: null, required: true }]);
						}}
					>
						+ Add item
					</button>
				</div>
			)}
		</div>
	);
}

export function EnterpriseDepartureChecklist() {
	const { hasCapability } = useOpsAuth();
	const canEdit = hasCapability("manage_settings");
	const { catalogue } = useFeeCatalogue();
	const [template, setTemplate] = useState<PreDepartureTemplateItem[]>([]);
	const [defaults, setDefaults] = useState<PreDepartureTemplateItem[]>([]);
	const [dirty, setDirty] = useState(false);
	const [destinationId, setDestinationId] = useState("");
	const [countryItems, setCountryItems] = useState<PreDepartureTemplateItem[]>([]);
	const [countryDirty, setCountryDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [toast, setToast] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);
	const say = (type: "error" | "success" | "info", message: string) => setToast({ type, message });

	const load = useCallback(async () => {
		try {
			const res = await apiFetch<{ items: PreDepartureTemplateItem[]; defaults: PreDepartureTemplateItem[] }>(`${API_PREFIX}/departure/template`);
			setTemplate(res.items);
			setDefaults(res.defaults);
			setDirty(false);
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : "Could not load the template");
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!destinationId) return;
		let alive = true;
		apiFetch<{ items: PreDepartureTemplateItem[] }>(`${API_PREFIX}/departure/destinations/${destinationId}`)
			.then((res) => {
				if (alive) {
					setCountryItems(res.items);
					setCountryDirty(false);
				}
			})
			.catch((err) => say("error", err instanceof ApiError ? err.message : "Could not load the country's items"));
		return () => {
			alive = false;
		};
	}, [destinationId]);

	// Names must be given and ids must not collide with the global list.
	const problems = (items: PreDepartureTemplateItem[], against: PreDepartureTemplateItem[] = []) => {
		const ids = new Set<string>();
		for (const it of items) {
			if (!it.label.trim()) return "Every item needs a name.";
			if (ids.has(it.id)) return `Two items share the id "${it.id}".`;
			ids.add(it.id);
			if (against.some((g) => g.id === it.id)) return `"${it.id}" is already in the global template.`;
		}
		return null;
	};

	async function saveTemplate() {
		const p = problems(template);
		if (p) return say("error", p);
		setSaving(true);
		try {
			// Regenerate ids for fresh items from their names, so the id reads like the item.
			const items = template.map((it) => (it.id.endsWith("-item") || /-item-\d+$/.test(it.id) ? { ...it, id: `pd-${slug(it.label) || "item"}` } : it));
			await apiFetch(`${API_PREFIX}/departure/template`, { method: "PUT", body: JSON.stringify({ items }) });
			say("success", "Template saved — cases reaching Departure from now on get it.");
			await load();
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : "Could not save the template");
		} finally {
			setSaving(false);
		}
	}
	async function saveCountry() {
		const p = problems(countryItems, template);
		if (p) return say("error", p);
		setSaving(true);
		try {
			const items = countryItems.map((it) => (it.id.endsWith("-item") || /-item-\d+$/.test(it.id) ? { ...it, id: `${destinationId}-${slug(it.label) || "item"}` } : it));
			await apiFetch(`${API_PREFIX}/departure/destinations/${destinationId}`, { method: "PUT", body: JSON.stringify({ items }) });
			setCountryItems(items);
			setCountryDirty(false);
			say("success", "Country items saved.");
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : "Could not save the country's items");
		} finally {
			setSaving(false);
		}
	}

	const centuryCount = template.filter((t) => t.owner === "century").length;
	const proofCount = template.filter((t) => t.evidence).length;

	return (
		<div className="admin-page">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h2 className="section-title">Departure checklist</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						What happens before a client flies, seeded when the visa is approved. Century's own deliverables are required and gate completion; the client's arrangements are reminders. Ask for proof only where Century needs to see it.
					</p>
				</div>
				<Link to="/applications?chapter=depart" className="btn btn--ghost btn--sm">
					Cases in Departure →
				</Link>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{template.length}</strong> <span className="dash-day__date">items on every case</span>
				</span>
				<span>
					<strong>{centuryCount}</strong> <span className="dash-day__date">Century's · required</span>
				</span>
				<span>
					<strong>{template.length - centuryCount}</strong> <span className="dash-day__date">the client's own</span>
				</span>
				<span>
					<strong>{proofCount}</strong> <span className="dash-day__date">ask for proof</span>
				</span>
				<span>
					<strong>{(catalogue?.destinations ?? []).length}</strong> <span className="dash-day__date">countries can add their own</span>
				</span>
			</div>
			<div className="cn-stack" style={{ gap: "1.25rem" }}>
				<section className="card">
					<div className="between mb-2" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.75rem" }}>
						<p className="ops-band__name" style={{ margin: 0 }}>
							Every case · {template.length}
						</p>
						<span className="ops-band__note">Century's {centuryCount} · the client's {template.length - centuryCount} · proof {proofCount}</span>
					</div>
					<ItemEditor
						items={template}
						canEdit={canEdit}
						idPrefix="pd"
						onChange={(next) => {
							setTemplate(next);
							setDirty(true);
						}}
					/>
					{canEdit && (
						<div className="mt-3" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
							<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveTemplate()} disabled={saving || !dirty}>
								{saving ? "Saving…" : "Save template"}
							</button>
							<button
								type="button"
								className="btn btn--sm btn--ghost"
								onClick={() => {
									setTemplate(defaults);
									setDirty(true);
								}}
							>
								Reset to the standard list
							</button>
						</div>
					)}
				</section>

				<section className="card">
					<p className="ops-band__name mb-2">By country</p>
					<p className="muted text-xs mb-3">Items only that destination needs — collect the BRP, the SEVIS check-in, the port-of-entry letter. Added on top of the list above for a case bound there.</p>
					<select className="input input--sm mb-3" style={{ width: "auto" }} value={destinationId} onChange={(e) => setDestinationId(e.target.value)} aria-label="Country">
						<option value="">Choose a country…</option>
						{(catalogue?.destinations ?? []).map((d) => (
							<option key={d.id} value={d.id}>
								{d.name}
							</option>
						))}
					</select>
					{destinationId && (
						<>
							<ItemEditor
								items={countryItems}
								canEdit={canEdit}
								idPrefix={destinationId}
								onChange={(next) => {
									setCountryItems(next);
									setCountryDirty(true);
								}}
							/>
							{canEdit && (
								<div className="mt-3">
									<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveCountry()} disabled={saving || !countryDirty}>
										{saving ? "Saving…" : "Save country items"}
									</button>
								</div>
							)}
						</>
					)}
				</section>
			</div>

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
