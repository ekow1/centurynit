import { useCallback, useEffect, useState } from "react";
import { fmtDate, get, put } from "./mkt";
import type { Automation, AutomationSend, EmailTemplate, Segment } from "./mkt";
import { Toast } from "../OpsDialogs";

/**
 * Automations — event → segment → template → delay. The six starters arrive
 * as drafts from the migration; staff pick a template (or write subject/body
 * inline) and flip them live. The send log is the per-firing ledger.
 */

const EVENT_LABELS: Record<string, string> = {
	"booking.no_show": "Booking marked no-show",
	"assessment.completed": "Assessment completed",
	"offer.received": "Offer received",
	"visa.approved": "Visa approved",
	"departure.minus_30": "30 days to departure",
	"invoice.overdue": "Invoice overdue (day 3)",
};

const delayLabel = (m: number) =>
	m === 0 ? "immediately" : m < 1440 ? `${Math.round(m / 60)}h later` : `${Math.round(m / 1440)}d later`;

export function AutomationsTab() {
	const [automations, setAutomations] = useState<Automation[]>([]);
	const [templates, setTemplates] = useState<EmailTemplate[]>([]);
	const [segments, setSegments] = useState<Segment[]>([]);
	const [loading, setLoading] = useState(true);
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const [log, setLog] = useState<null | { automation: Automation; sends: AutomationSend[] }>(null);
	const [editing, setEditing] = useState<Automation | null>(null);
	const [editForm, setEditForm] = useState<{ templateId: string; segmentId: string; subject: string; delayMinutes: number }>({ templateId: "", segmentId: "", subject: "", delayMinutes: 0 });

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [a, t, s] = await Promise.all([
				get<{ automations: Automation[] }>("/automations"),
				get<{ templates: EmailTemplate[] }>("/templates"),
				get<{ segments: Segment[] }>("/segments"),
			]);
			setAutomations(a.automations);
			setTemplates(t.templates);
			setSegments(s.segments);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => void load(), [load]);

	async function setStatus(a: Automation, status: string) {
		await put(`/automations/${a.id}`, { status });
		setToast({ type: "success", message: status === "live" ? `${a.name} is live.` : `${a.name} ${status}.` });
		load();
	}

	async function openLog(a: Automation) {
		const res = await get<{ sends: AutomationSend[] }>(`/automations/${a.id}/sends?limit=100`);
		setLog({ automation: a, sends: res.sends });
	}

	const tplName = (id: string | null) => templates.find((t) => t.id === id)?.name ?? "—";
	const segName = (id: string | null) => segments.find((s) => s.id === id)?.name ?? "everyone the event names";

	return (
		<>
			<div className="mkt-toolbar">
				<h3 className="mkt-h">Automations</h3>
				<span className="muted">Starters arrive as drafts — pick a template and flip live.</span>
			</div>

			<div className="card ops-table-wrap">
				<table className="admin-table">
					<thead>
						<tr><th>Automation</th><th>When</th><th>Audience</th><th>Template</th><th>Delay</th><th>Sent</th><th>Status</th><th /></tr>
					</thead>
					<tbody>
						{loading && <tr><td colSpan={8}>Loading…</td></tr>}
						{!loading && automations.length === 0 && <tr><td colSpan={8}>No automations — the six starters seed with migration 0111.</td></tr>}
						{automations.map((a) => (
							<tr key={a.id}>
								<td><strong>{a.name}</strong></td>
								<td className="muted">{EVENT_LABELS[a.event] ?? a.event}</td>
								<td className="muted">{segName(a.segmentId)}</td>
								<td className="muted">{a.templateId ? tplName(a.templateId) : (a.subject ? `inline · ${a.subject.slice(0, 28)}` : "—")}</td>
								<td>{delayLabel(a.delayMinutes)}</td>
								<td>{a.sentCount}/{a.sends}</td>
								<td><span className={`mkt-chip mkt-chip--${a.status}`}>{a.status}</span></td>
								<td className="mkt-rowops">
									{a.status !== "live" ? (
										<button type="button" className="btn btn--primary btn--sm" onClick={() => setStatus(a, "live")}>Go live</button>
									) : (
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => setStatus(a, "paused")}>Pause</button>
									)}
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => { setEditing(a); setEditForm({ templateId: a.templateId ?? "", segmentId: a.segmentId ?? "", subject: a.subject ?? "", delayMinutes: a.delayMinutes }); }}>Edit</button>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => openLog(a)}>Log</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* ── Edit sheet ── */}
			{editing && (
				<div className="mkt-sheet" role="dialog" aria-label="Edit automation">
					<div className="mkt-sheet__panel" style={{ maxWidth: 460 }}>
						<div className="mkt-report__head">
							<h3>{editing.name}</h3>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Close</button>
						</div>
						<p className="muted">Fires on <strong>{EVENT_LABELS[editing.event] ?? editing.event}</strong>.</p>
						<label className="label">
							Template
							<select className="input" value={editForm.templateId} onChange={(e) => setEditForm({ ...editForm, templateId: e.target.value })}>
								<option value="">— inline body instead —</option>
								{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
							</select>
						</label>
						<label className="label">
							Extra segment filter
							<select className="input" value={editForm.segmentId} onChange={(e) => setEditForm({ ...editForm, segmentId: e.target.value })}>
								<option value="">everyone the event names</option>
								{segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.entity})</option>)}
							</select>
						</label>
						{!editForm.templateId && (
							<label className="label">
								Subject (inline)
								<input className="input" value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} />
							</label>
						)}
						<label className="label">
							Delay after event (minutes)
							<input className="input" type="number" min={0} value={editForm.delayMinutes} onChange={(e) => setEditForm({ ...editForm, delayMinutes: Number(e.target.value) || 0 })} />
						</label>
						<div className="mkt-sheet__foot">
							<button
								type="button"
								className="btn btn--primary"
								onClick={async () => {
									await put(`/automations/${editing.id}`, {
										templateId: editForm.templateId || null,
										segmentId: editForm.segmentId || null,
										subject: editForm.templateId ? null : editForm.subject || null,
										delayMinutes: editForm.delayMinutes,
									});
									setEditing(null);
									setToast({ type: "success", message: "Automation saved." });
									load();
								}}
							>
								Save
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── Send log ── */}
			{log && (
				<div className="mkt-sheet" role="dialog" aria-label="Automation log">
					<div className="mkt-sheet__panel">
						<div className="mkt-report__head">
							<h3>{log.automation.name} — send log</h3>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setLog(null)}>Close</button>
						</div>
						<div className="ops-table-wrap" style={{ maxHeight: 400, overflowY: "auto" }}>
							<table className="admin-table">
								<thead><tr><th>Recipient</th><th>Status</th><th>Scheduled</th><th>Sent</th><th>Error</th></tr></thead>
								<tbody>
									{log.sends.length === 0 && <tr><td colSpan={5}>No firings yet — the event hasn't produced recipients, or they were skipped at intake.</td></tr>}
									{log.sends.map((s, i) => (
										<tr key={i}>
											<td>{s.name ? `${s.name} · ` : ""}{s.email}</td>
											<td><span className={`mkt-chip mkt-chip--${s.status}`}>{s.status}</span></td>
											<td>{fmtDate(s.scheduledFor)}</td>
											<td>{fmtDate(s.sentAt)}</td>
											<td className="muted">{s.error ?? ""}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			)}

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</>
	);
}
