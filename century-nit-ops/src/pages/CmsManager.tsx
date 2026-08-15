import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import {
	CMS_COLLECTIONS,
	cmsKey,
	diffValues,
	resolveRecord,
	type CmsCollectionId,
	type CmsRecord,
	type CmsStatus,
} from "century-nit-core";

/**
 * Content management, driven by the site's actual collections.
 *
 * The previous version listed a five-row hardcoded array with inert Edit and
 * New Entry buttons. This reads the real destinations, universities, programs,
 * scholarships, services, articles, events and FAQs, and writes edits into the
 * persisted `cmsOverlay` - so a change survives reload and, once a record is
 * set to Draft, the public site stops rendering it.
 */

const STATUSES: CmsStatus[] = ["Published", "Draft", "Scheduled"];

export function CmsManager() {
	const { opsUser } = useOpsAuth();
	const { cmsOverlay, saveCmsRecord, setCmsStatus, revertCmsRecord } = useOpsState();

	const [collectionId, setCollectionId] = useState<CmsCollectionId>("destinations");
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | CmsStatus>("all");
	const [editing, setEditing] = useState<CmsRecord | null>(null);
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [draftStatus, setDraftStatus] = useState<CmsStatus>("Published");
	const [flash, setFlash] = useState<string | null>(null);

	const by = opsUser?.name ?? "Administrator";
	const collection = CMS_COLLECTIONS.find((c) => c.id === collectionId)!;

	const rows = useMemo(() => {
		return collection.records().map((record) => ({
			record,
			...resolveRecord(collection.id, record, cmsOverlay),
		}));
	}, [collection, cmsOverlay]);

	const filtered = rows.filter((r) => {
		if (statusFilter !== "all" && r.status !== statusFilter) return false;
		if (!search) return true;
		const hay = `${r.values[collection.fields[0].key] ?? r.record.title} ${r.record.subtitle}`;
		return hay.toLowerCase().includes(search.toLowerCase());
	});

	/** Totals across every collection, not just the one on screen */
	const totals = useMemo(() => {
		let all = 0;
		let drafts = 0;
		let scheduled = 0;
		let edited = 0;
		for (const c of CMS_COLLECTIONS) {
			for (const rec of c.records()) {
				all++;
				const r = resolveRecord(c.id, rec, cmsOverlay);
				if (r.status === "Draft") drafts++;
				if (r.status === "Scheduled") scheduled++;
				if (r.edited) edited++;
			}
		}
		return { all, drafts, scheduled, edited, published: all - drafts - scheduled };
	}, [cmsOverlay]);

	function openEditor(record: CmsRecord) {
		const resolved = resolveRecord(collection.id, record, cmsOverlay);
		setEditing(record);
		setDraft(resolved.values);
		setDraftStatus(resolved.status);
	}

	function save() {
		if (!editing) return;
		// Store only what differs from the seed
		const changed = diffValues(editing.values, draft);
		saveCmsRecord(collection.id, editing.id, editing.title, changed, draftStatus, by);
		setFlash(`Saved “${draft[collection.fields[0].key] ?? editing.title}” · ${draftStatus}`);
		setEditing(null);
		window.setTimeout(() => setFlash(null), 3500);
	}

	function revert() {
		if (!editing) return;
		revertCmsRecord(collection.id, editing.id, editing.title, by);
		setFlash(`Reverted “${editing.title}” to the published seed`);
		setEditing(null);
		window.setTimeout(() => setFlash(null), 3500);
	}

	const dirty =
		editing !== null &&
		(Object.keys(diffValues(editing.values, draft)).length > 0 ||
			draftStatus !== resolveRecord(collection.id, editing, cmsOverlay).status);

	return (
		<>
			{flash ? (
				<div className="cms-flash" role="status">
					✓ {flash}
				</div>
			) : null}

			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.75rem" }}>
				<Stat label="Live entries" value={String(totals.published)} note={`of ${totals.all} across ${CMS_COLLECTIONS.length} collections`} />
				<Stat label="Drafts" value={String(totals.drafts)} note="Hidden from the public site" />
				<Stat label="Scheduled" value={String(totals.scheduled)} note="Queued to publish" />
				<Stat label="Edited" value={String(totals.edited)} note="Differ from the seed" inverted />
			</div>

			{/* Collection switcher */}
			<div className="cms-tabs" role="tablist" aria-label="Content collections">
				{CMS_COLLECTIONS.map((c) => {
					const count = c.records().length;
					return (
						<button
							key={c.id}
							role="tab"
							aria-selected={c.id === collectionId}
							className={`cms-tab${c.id === collectionId ? " cms-tab--active" : ""}`}
							onClick={() => {
								setCollectionId(c.id);
								setEditing(null);
							}}
						>
							{c.label}
							<span className="cms-tab__count">{count}</span>
						</button>
					);
				})}
			</div>

			<div className="admin-section-head" style={{ margin: "1.25rem 0" }}>
				<input
					type="search"
					placeholder={`Search ${collection.label.toLowerCase()}…`}
					className="input input--sm"
					style={{ maxWidth: "260px" }}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<div className="admin-section-head__actions">
					<div className="admin-env-tabs">
						{(["all", ...STATUSES] as const).map((s) => (
							<button
								key={s}
								className={`admin-env-tab${statusFilter === s ? " admin-env-tab--active" : ""}`}
								onClick={() => setStatusFilter(s)}
							>
								{s === "all" ? "All" : s}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="card" style={{ padding: 0, overflow: "hidden" }}>
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>{collection.noun === "FAQ" ? "Question" : "Title"}</th>
								<th>Detail</th>
								<th>Status</th>
								<th>Last edit</th>
								<th style={{ textAlign: "right" }}>Action</th>
							</tr>
						</thead>
						<tbody>
							{filtered.length === 0 ? (
								<tr>
									<td colSpan={5} className="muted" style={{ padding: "2rem", textAlign: "center" }}>
										Nothing matches that filter.
									</td>
								</tr>
							) : (
								filtered.map(({ record, values, status, edited, override }) => (
									<tr key={cmsKey(collection.id, record.id)}>
										<td style={{ fontWeight: 500 }}>
											{values[collection.fields[0].key] ?? record.title}
											{edited ? <span className="cms-edited" title="Differs from the seed">edited</span> : null}
										</td>
										<td className="muted">{record.subtitle}</td>
										<td>
											<span className={`cms-status cms-status--${status.toLowerCase()}`}>{status}</span>
										</td>
										<td className="admin-table__mono">
											{override ? new Date(override.updatedAt).toLocaleDateString() : "-"}
										</td>
										<td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
											<button
												className="btn btn--ghost btn--sm"
												onClick={() =>
													setCmsStatus(
														collection.id,
														record.id,
														record.title,
														status === "Published" ? "Draft" : "Published",
														by,
													)
												}
											>
												{status === "Published" ? "Unpublish" : "Publish"}
											</button>
											<button className="btn btn--ghost btn--sm" onClick={() => openEditor(record)}>
												Edit
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>

			{/* Editor */}
			{editing ? (
				<div className="card admin-form-card cms-editor">
					<div className="admin-section-head" style={{ marginBottom: "1.25rem" }}>
						<div>
							<h2 className="admin-form-card__title" style={{ margin: 0 }}>
								Edit {collection.noun}
							</h2>
							<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
								{cmsKey(collection.id, editing.id)}
							</p>
						</div>
						<Link
							to={collection.route(editing.id)}
							target="_blank"
							rel="noreferrer"
							className="btn btn--ghost btn--sm"
						>
							View on site ↗
						</Link>
					</div>

					{collection.fields.map((f) => (
						<div key={f.key} style={{ marginBottom: "1.1rem" }}>
							<label className="eyebrow" htmlFor={`cms-${f.key}`} style={{ display: "block", marginBottom: "0.4rem", fontSize: "var(--text-xs)" }}>
								{f.label}
							</label>
							{f.kind === "text" ? (
								<input
									id={`cms-${f.key}`}
									className="input input--full-border"
									value={draft[f.key] ?? ""}
									onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
								/>
							) : (
								<textarea
									id={`cms-${f.key}`}
									className="input input--full-border"
									rows={f.kind === "richtext" ? 6 : 3}
									value={draft[f.key] ?? ""}
									onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
									style={{ resize: "vertical" }}
								/>
							)}
							<div className="cms-field-foot">
								{f.hint ? <span className="muted">{f.hint}</span> : <span />}
								{editing.values[f.key] !== draft[f.key] ? (
									<button
										type="button"
										className="cms-reset-field"
										onClick={() => setDraft({ ...draft, [f.key]: editing.values[f.key] ?? "" })}
									>
										Reset field
									</button>
								) : null}
							</div>
						</div>
					))}

					<div style={{ marginBottom: "1.25rem" }}>
						<label className="eyebrow" htmlFor="cms-status" style={{ display: "block", marginBottom: "0.4rem", fontSize: "var(--text-xs)" }}>
							Status
						</label>
						<select
							id="cms-status"
							className="input input--full-border"
							value={draftStatus}
							onChange={(e) => setDraftStatus(e.target.value as CmsStatus)}
						>
							{STATUSES.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.35rem" }}>
							Draft and Scheduled records are hidden from the public site.
						</p>
					</div>

					<div className="admin-form-card__actions">
						<button className="btn btn--primary btn--sm" onClick={save} disabled={!dirty}>
							{dirty ? "Save changes" : "No changes"}
						</button>
						<button className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
							Cancel
						</button>
						<button className="btn btn--ghost btn--sm cms-revert" onClick={revert}>
							Revert to seed
						</button>
					</div>
				</div>
			) : null}
		</>
	);
}

function Stat({ label, value, note, inverted }: { label: string; value: string; note: string; inverted?: boolean }) {
	return (
		<div className="card" style={inverted ? { background: "var(--foreground)", color: "var(--background)" } : undefined}>
			<p className="eyebrow" style={inverted ? { color: "var(--muted)" } : undefined}>
				{label}
			</p>
			<p className="page-title mt-1" style={{ fontSize: "1.75rem", ...(inverted ? { color: "var(--background)" } : {}) }}>
				{value}
			</p>
			<p className="muted mt-1" style={{ fontSize: "var(--text-xs)", ...(inverted ? { color: "var(--muted)" } : {}) }}>
				{note}
			</p>
		</div>
	);
}
