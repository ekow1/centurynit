import { useCallback, useEffect, useMemo, useState } from "react";
import { del, get, post, put } from "./mkt";
import type { MailingList, Segment, SegmentFilter, Suppression } from "./mkt";
import { ConfirmDialog, Toast } from "../OpsDialogs";

/**
 * Audiences — saved live segments over the suite's own data, the mailing
 * lists external subscribers sit on, and the global suppression list.
 * Segments are evaluated at send time; the preview here runs the same
 * evaluator so the count an operator sees is the count a campaign gets.
 */

const ENTITY_FIELDS: Record<string, { field: string; label: string; ops: string[]; values?: string[] }[]> = {
	applicants: [
		{ field: "stage", label: "Chapter / stage", ops: ["is", "is_not"], values: ["document_verification", "school_submission", "offer_letter_review", "visa_processing", "travel_assistance", "payment_execution", "completed"] },
		{ field: "branch", label: "Branch", ops: ["is", "is_not"] },
		{ field: "country", label: "Target country", ops: ["is", "is_not"] },
		{ field: "offer", label: "Offer status", ops: ["is"], values: ["has_accepted", "has_offer", "none"] },
		{ field: "unpaidMilestone", label: "Has unpaid milestone", ops: ["is"], values: ["yes", "no"] },
		{ field: "departureWindow", label: "Departure within (days)", ops: ["within_days"], values: ["30", "60", "90"] },
		{ field: "lastActivity", label: "Last activity", ops: ["within_days", "older_than_days"], values: ["7", "30", "90"] },
	],
	leads: [
		{ field: "stage", label: "Lead stage", ops: ["is", "is_not"], values: ["New Lead", "Consultation Booked", "Assessment Complete", "Enrolled", "Lost"] },
		{ field: "source", label: "Source", ops: ["is", "is_not"] },
		{ field: "country", label: "Target country", ops: ["is", "is_not"] },
		{ field: "converted", label: "Has a case", ops: ["is"], values: ["yes", "no"] },
		{ field: "lost", label: "Marked lost", ops: ["is"], values: ["yes", "no"] },
		{ field: "lastTouch", label: "Last touch", ops: ["within_days", "older_than_days"], values: ["7", "30", "90"] },
		{ field: "created", label: "Created", ops: ["within_days", "older_than_days"], values: ["7", "30", "90"] },
	],
	contacts: [
		{ field: "list", label: "On list", ops: ["is"] },
		{ field: "status", label: "Contact status", ops: ["is", "is_not"], values: ["pending", "confirmed", "unsubscribed"] },
		{ field: "engagement", label: "Engagement", ops: ["is"], values: ["opened", "clicked", "cold"] },
		{ field: "created", label: "Added", ops: ["within_days", "older_than_days"], values: ["7", "30", "90"] },
	],
};

const OP_LABEL: Record<string, string> = { is: "is", is_not: "is not", within_days: "within days", older_than_days: "older than (days)" };

export function AudiencesTab() {
	const [segments, setSegments] = useState<Segment[]>([]);
	const [lists, setLists] = useState<MailingList[]>([]);
	const [suppressions, setSuppressions] = useState<Suppression[]>([]);
	const [counts, setCounts] = useState<Record<string, { matched: number; optedIn: number }>>({});
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const [confirm, setConfirm] = useState<null | { title: string; message: string; danger?: boolean; action: () => void }>(null);

	const [building, setBuilding] = useState<null | { id: string | null; name: string; entity: string; filters: SegmentFilter[] }>(null);
	const [preview, setPreview] = useState<null | { matched: number; optedIn: number; neverAsked: number; suppressed: number; sample: { email: string; name: string | null; state: string }[] }>(null);
	const [previewBusy, setPreviewBusy] = useState(false);

	const [newList, setNewList] = useState(false);
	const [listName, setListName] = useState("");
	const [listDesc, setListDesc] = useState("");
	const [newSuppression, setNewSuppression] = useState("");

	const load = useCallback(async () => {
		const [s, l, sup] = await Promise.all([
			get<{ segments: Segment[] }>("/segments"),
			get<{ mailingLists: MailingList[] }>("/mailing-lists"),
			get<{ suppressions: Suppression[] }>("/suppressions"),
		]);
		setSegments(s.segments);
		setLists(l.mailingLists);
		setSuppressions(sup.suppressions);
		for (const seg of s.segments) {
			post<{ matched: number; optedIn: number }>("/segments/preview", { entity: seg.entity, filters: seg.filters })
				.then((r) => setCounts((m) => ({ ...m, [seg.id]: { matched: r.matched, optedIn: r.optedIn } })))
				.catch(() => {});
		}
	}, []);

	useEffect(() => void load(), [load]);

	async function runPreview() {
		if (!building) return;
		setPreviewBusy(true);
		try {
			setPreview(await post("/segments/preview", { entity: building.entity, filters: building.filters }));
		} finally {
			setPreviewBusy(false);
		}
	}

	async function saveSegment() {
		if (!building) return;
		try {
			if (building.id) await put(`/segments/${building.id}`, { name: building.name, entity: building.entity, filters: building.filters });
			else await post("/segments", { name: building.name, entity: building.entity, filters: building.filters });
			setBuilding(null);
			setPreview(null);
			setToast({ type: "success", message: "Segment saved." });
			load();
		} catch (e) {
			setToast({ type: "error", message: e instanceof Error ? e.message : "Save failed" });
		}
	}

	const fields = useMemo(() => ENTITY_FIELDS[building?.entity ?? "applicants"] ?? [], [building?.entity]);

	return (
		<>
			<div className="mkt-toolbar">
				<h3 className="mkt-h">Live segments</h3>
				<button type="button" className="btn btn--primary" onClick={() => setBuilding({ id: null, name: "", entity: "applicants", filters: [] })}>+ New segment</button>
			</div>
			<div className="card ops-table-wrap">
				<table className="admin-table">
					<thead><tr><th>Segment</th><th>Entity</th><th>Conditions</th><th>Live count</th><th /></tr></thead>
					<tbody>
						{segments.length === 0 && <tr><td colSpan={5}>No segments yet — build one over applicants, leads or contacts.</td></tr>}
						{segments.map((s) => (
							<tr key={s.id}>
								<td><strong>{s.name}</strong></td>
								<td>{s.entity}</td>
								<td className="muted">{s.filters.map((f) => `${f.field} ${OP_LABEL[f.op] ?? f.op} ${String(f.value ?? "")}`).join(" · ") || "everyone"}</td>
								<td>{counts[s.id] ? `${counts[s.id].optedIn} sendable / ${counts[s.id].matched} matched` : "…"}</td>
								<td className="mkt-rowops">
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => { setBuilding({ id: s.id, name: s.name, entity: s.entity, filters: s.filters }); setPreview(null); }}>Edit</button>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm({ title: "Delete segment?", message: `“${s.name}” — campaigns already sent keep their ledger.`, danger: true, action: async () => { await del(`/segments/${s.id}`); load(); } })}>×</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="mkt-toolbar" style={{ marginTop: 24 }}>
				<h3 className="mkt-h">Mailing lists</h3>
				<button type="button" className="btn" onClick={() => setNewList(true)}>+ New list</button>
			</div>
			<div className="card ops-table-wrap">
				<table className="admin-table">
					<thead><tr><th>List</th><th>Confirmed</th><th>Pending</th><th>Unsubscribed</th><th /></tr></thead>
					<tbody>
						{lists.map((l) => (
							<tr key={l.id}>
								<td><strong>{l.name}</strong>{l.isNewsletter ? " · newsletter" : ""}<div className="muted">{l.description ?? ""}</div></td>
								<td>{l.confirmedCount}</td>
								<td>{l.pendingCount}</td>
								<td>{l.unsubscribedCount}</td>
								<td />
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="mkt-toolbar" style={{ marginTop: 24 }}>
				<h3 className="mkt-h">Suppressed addresses</h3>
				<div style={{ display: "flex", gap: 8 }}>
					<input className="input" style={{ maxWidth: 260 }} placeholder="email@example.com" value={newSuppression} onChange={(e) => setNewSuppression(e.target.value)} />
					<button type="button" className="btn" disabled={!newSuppression.includes("@")} onClick={async () => { await post("/suppressions", { email: newSuppression }); setNewSuppression(""); load(); }}>Suppress</button>
				</div>
			</div>
			<div className="card ops-table-wrap">
				<table className="admin-table">
					<thead><tr><th>Address</th><th>Reason</th><th>Detail</th><th>Since</th><th /></tr></thead>
					<tbody>
						{suppressions.length === 0 && <tr><td colSpan={5}>Nobody suppressed — bounces, complaints and unsubscribes land here automatically.</td></tr>}
						{suppressions.map((s) => (
							<tr key={s.email}>
								<td>{s.email}</td>
								<td><span className="mkt-chip">{s.reason}</span></td>
								<td className="muted">{s.detail ?? ""}</td>
								<td>{new Date(s.createdAt).toLocaleDateString()}</td>
								<td><button type="button" className="btn btn--ghost btn--sm" onClick={async () => { await del(`/suppressions/${encodeURIComponent(s.email)}`); load(); }}>Lift</button></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* ── Segment builder sheet ── */}
			{building && (
				<div className="mkt-sheet" role="dialog" aria-label="Segment builder">
					<div className="mkt-sheet__panel">
						<div className="mkt-report__head">
							<h3>{building.id ? "Edit segment" : "New segment"}</h3>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setBuilding(null)}>Close</button>
						</div>
						<label className="label">
							Name
							<input className="input" value={building.name} onChange={(e) => setBuilding({ ...building, name: e.target.value })} placeholder="UK-bound, departing in 60 days" />
						</label>
						<div className="mkt-chips" style={{ margin: "8px 0 12px" }}>
							{(["applicants", "leads", "contacts"] as const).map((e) => (
								<button key={e} type="button" className={`mkt-chip${building.entity === e ? " mkt-chip--on" : ""}`} onClick={() => setBuilding({ ...building, entity: e, filters: [] })}>{e}</button>
							))}
						</div>

						<div className="label">Conditions — all must match</div>
						{building.filters.map((f, i) => {
							const def = fields.find((d) => d.field === f.field);
							return (
								<div key={i} className="mkt-condrow">
									<select className="input" value={f.field} onChange={(e) => {
										const nf = fields.find((d) => d.field === e.target.value);
										const next = [...building.filters];
										next[i] = { field: e.target.value, op: nf?.ops[0] ?? "is", value: nf?.values?.[0] ?? "" };
										setBuilding({ ...building, filters: next });
									}}>
										<option value="">field…</option>
										{fields.map((d) => <option key={d.field} value={d.field}>{d.label}</option>)}
									</select>
									<select className="input" value={f.op} onChange={(e) => {
										const next = [...building.filters];
										next[i] = { ...f, op: e.target.value };
										setBuilding({ ...building, filters: next });
									}}>
										{(def?.ops ?? ["is"]).map((o) => <option key={o} value={o}>{OP_LABEL[o] ?? o}</option>)}
									</select>
									{def?.values ? (
										<select className="input" value={String(f.value ?? "")} onChange={(e) => {
											const next = [...building.filters];
											next[i] = { ...f, value: e.target.value };
											setBuilding({ ...building, filters: next });
										}}>
											{def.values.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
										</select>
									) : (
										<input className="input" value={String(f.value ?? "")} onChange={(e) => {
											const next = [...building.filters];
											next[i] = { ...f, value: e.target.value };
											setBuilding({ ...building, filters: next });
										}} placeholder="value" />
									)}
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => setBuilding({ ...building, filters: building.filters.filter((_, j) => j !== i) })}>×</button>
								</div>
							);
						})}
						<button type="button" className="btn" onClick={() => setBuilding({ ...building, filters: [...building.filters, { field: "", op: "is", value: "" }] })}>+ Condition</button>

						<div className="mkt-sheet__foot" style={{ marginTop: 16 }}>
							<button type="button" className="btn" disabled={previewBusy || !building.entity} onClick={runPreview}>{previewBusy ? "Counting…" : "Count audience"}</button>
							<button type="button" className="btn btn--primary" disabled={!building.name} onClick={saveSegment}>Save segment</button>
						</div>

						{preview && (
							<div className="mkt-preview">
								<div className="mkt-ratetiles">
									<div className="mkt-ratetile"><div className="mkt-ratetile__label">Matched</div><div className="mkt-ratetile__value">{preview.matched}</div></div>
									<div className="mkt-ratetile"><div className="mkt-ratetile__label">Opted in</div><div className="mkt-ratetile__value">{preview.optedIn}</div></div>
									<div className="mkt-ratetile"><div className="mkt-ratetile__label">Never asked</div><div className="mkt-ratetile__value">{preview.neverAsked}</div></div>
									<div className="mkt-ratetile"><div className="mkt-ratetile__label">Suppressed</div><div className="mkt-ratetile__value">{preview.suppressed}</div></div>
								</div>
								<p className="muted">Only opted-in, unsuppressed people are mailed — evaluated again at send time.</p>
								{preview.sample.length > 0 && (
									<div className="mkt-sample">
										{preview.sample.map((s) => (
											<div key={s.email} className="mkt-samplerow"><span>{s.name ?? s.email}</span><span className="mkt-chip">{s.state.replace(/_/g, " ")}</span></div>
										))}
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			)}

			{/* ── New list sheet ── */}
			{newList && (
				<div className="mkt-sheet" role="dialog" aria-label="New list">
					<div className="mkt-sheet__panel" style={{ maxWidth: 420 }}>
						<div className="mkt-report__head">
							<h3>New mailing list</h3>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setNewList(false)}>Close</button>
						</div>
						<label className="label">Name<input className="input" value={listName} onChange={(e) => setListName(e.target.value)} /></label>
						<label className="label">Description<input className="input" value={listDesc} onChange={(e) => setListDesc(e.target.value)} /></label>
						<div className="mkt-sheet__foot">
							<button type="button" className="btn btn--primary" disabled={!listName} onClick={async () => { await post("/mailing-lists", { name: listName, description: listDesc || null }); setNewList(false); setListName(""); setListDesc(""); load(); }}>Create list</button>
						</div>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={confirm !== null}
				title={confirm?.title ?? ""}
				message={confirm?.message ?? ""}
				danger={confirm?.danger}
				onCancel={() => setConfirm(null)}
				onConfirm={() => { const a = confirm?.action; setConfirm(null); void a?.(); }}
			/>
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</>
	);
}
