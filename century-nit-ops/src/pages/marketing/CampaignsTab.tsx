import { useCallback, useEffect, useState } from "react";
import { del, fmtDate, get, pct, post, put } from "./mkt";
import type { Campaign, CampaignReport, EmailBlock, MailingList, Recipient, Segment } from "./mkt";
import { Composer } from "./Composer";
import { ConfirmDialog, Toast } from "../OpsDialogs";

const STATUS_FILTERS = ["all", "draft", "scheduled", "sending", "sent"] as const;

export function CampaignsTab() {
	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [lists, setLists] = useState<MailingList[]>([]);
	const [segments, setSegments] = useState<Segment[]>([]);
	const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
	const [loading, setLoading] = useState(true);
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);

	const [report, setReport] = useState<{ campaign: Campaign; data: CampaignReport } | null>(null);
	const [recipients, setRecipients] = useState<Recipient[]>([]);
	const [recipientFilter, setRecipientFilter] = useState("all");

	const [compose, setCompose] = useState<null | {
		id: string | null;
		name: string;
		listId: string;
		segmentId: string;
		subject: string;
		blocks: EmailBlock[];
		preheader: string;
		fromName: string;
		replyTo: string;
	}>(null);
	const [composeBusy, setComposeBusy] = useState(false);
	const [schedulingId, setSchedulingId] = useState<string | null>(null);
	const [scheduleAt, setScheduleAt] = useState("");
	const [confirm, setConfirm] = useState<null | { title: string; message: string; danger?: boolean; action: () => void }>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [c, l, s] = await Promise.all([
				get<{ campaigns: Campaign[] }>("/campaigns"),
				get<{ lists: MailingList[] }>("/mailing-lists"),
				get<{ segments: Segment[] }>("/segments"),
			]);
			setCampaigns(c.campaigns);
			setLists(l.lists);
			setSegments(s.segments);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => void load(), [load]);

	const visible = campaigns.filter((c) => statusFilter === "all" || c.status === statusFilter);
	const audienceName = (c: Campaign) =>
		c.segmentId
			? `Segment · ${segments.find((s) => s.id === c.segmentId)?.name ?? "live"}`
			: c.mailingListId
				? lists.find((l) => l.id === c.mailingListId)?.name ?? "List"
				: (c.audience ?? "—");

	async function openReport(campaign: Campaign) {
		const data = await get<CampaignReport>(`/campaigns/${campaign.id}/report`);
		setReport({ campaign, data });
		const r = await get<{ recipients: Recipient[] }>(`/campaigns/${campaign.id}/recipients?limit=200`);
		setRecipients(r.recipients);
		setRecipientFilter("all");
	}

	async function sendNow(c: Campaign, scheduleFor?: string | null) {
		setBusyId(c.id);
		try {
			await post(`/campaigns/${c.id}/send`, { scheduleFor: scheduleFor ?? null });
			setToast({ type: "success", message: scheduleFor ? "Scheduled." : "Send queued." });
			load();
		} catch (e) {
			setToast({ type: "error", message: e instanceof Error ? e.message : "Send failed" });
		} finally {
			setBusyId(null);
		}
	}

	function startCompose(c?: Campaign) {
		setCompose(
			c
				? {
						id: c.id,
						name: c.name,
						listId: c.mailingListId ?? "",
						segmentId: c.segmentId ?? "",
						subject: c.subject ?? "",
						blocks: c.blocks ?? [{ type: "paragraph", text: c.body && !c.body.includes("<") ? c.body : "" }],
						preheader: c.preheader ?? "",
						fromName: c.fromName ?? "",
						replyTo: c.replyTo ?? "",
					}
				: { id: null, name: "", listId: "", segmentId: "", subject: "", blocks: [], preheader: "", fromName: "", replyTo: "" },
		);
	}

	async function saveCompose() {
		if (!compose) return;
		setComposeBusy(true);
		try {
			const payload = {
				name: compose.name,
				type: "campaign",
				subject: compose.subject,
				body: "blocks",
				blocks: compose.blocks,
				mailingListId: compose.listId || null,
				segmentId: compose.segmentId || null,
				preheader: compose.preheader || null,
				fromName: compose.fromName || null,
				replyTo: compose.replyTo || null,
			};
			if (compose.id) await put(`/campaigns/${compose.id}`, payload);
			else await post("/campaigns", payload);
			setCompose(null);
			setToast({ type: "success", message: "Campaign saved." });
			load();
		} catch (e) {
			setToast({ type: "error", message: e instanceof Error ? e.message : "Save failed" });
		} finally {
			setComposeBusy(false);
		}
	}

	async function cancelScheduled(c: Campaign) {
		setBusyId(c.id);
		try {
			await post(`/campaigns/${c.id}/cancel`, {});
			setToast({ type: "success", message: "Schedule cancelled — back to draft." });
			load();
		} catch (e) {
			setToast({ type: "error", message: e instanceof Error ? e.message : "Cancel failed" });
		} finally {
			setBusyId(null);
		}
	}

	async function testSend(c: Campaign) {
		const to = window.prompt("Send a test to which address?");
		if (!to) return;
		try {
			await post(`/campaigns/${c.id}/test`, { to });
			setToast({ type: "success", message: `Test sent to ${to}` });
		} catch (e) {
			setToast({ type: "error", message: e instanceof Error ? e.message : "Test failed" });
		}
	}

	const shownRecipients = recipients.filter((r) => recipientFilter === "all" || r.status === recipientFilter);

	return (
		<>
			<div className="mkt-toolbar">
				<div className="mkt-chips">
					{STATUS_FILTERS.map((f) => (
						<button key={f} type="button" className={`mkt-chip${statusFilter === f ? " mkt-chip--on" : ""}`} onClick={() => setStatusFilter(f)}>
							{f === "all" ? "All" : f}
						</button>
					))}
				</div>
				<button type="button" className="btn btn--primary" onClick={() => startCompose()}>+ New campaign</button>
			</div>

			<div className="card ops-table-wrap">
				<table className="admin-table">
					<thead>
						<tr>
							<th>Campaign</th>
							<th>Audience</th>
							<th>Status</th>
							<th>Delivered</th>
							<th>Opens</th>
							<th>Clicks</th>
							<th>When</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{loading && <tr><td colSpan={8}>Loading…</td></tr>}
						{!loading && visible.length === 0 && <tr><td colSpan={8}>No campaigns here yet.</td></tr>}
						{visible.map((c) => (
							<tr key={c.id}>
								<td><strong>{c.name}</strong></td>
								<td>{audienceName(c)}</td>
								<td><span className={`mkt-chip mkt-chip--${c.status}`}>{c.status}</span></td>
								<td>{c.deliveredCount}/{c.recipientCount}</td>
								<td><OpenRate id={c.id} delivered={c.deliveredCount} /></td>
								<td><ClickRate id={c.id} delivered={c.deliveredCount} /></td>
								<td>{c.sentAt ? fmtDate(c.sentAt) : c.scheduledAt ? `⏱ ${fmtDate(c.scheduledAt)}` : "—"}</td>
								<td className="mkt-rowops">
									{(c.status === "sent" || c.status === "sending") && (
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => openReport(c)}>Report</button>
									)}
									{c.status === "draft" && (
										<>
											<button type="button" className="btn btn--ghost btn--sm" onClick={() => startCompose(c)}>Edit</button>
											<button type="button" className="btn btn--ghost btn--sm" onClick={() => testSend(c)}>Test</button>
											<button type="button" className="btn btn--primary btn--sm" disabled={busyId === c.id} onClick={() => sendNow(c)}>Send</button>
										<button type="button" className="btn btn--ghost btn--sm" title="Schedule" onClick={() => { setSchedulingId(schedulingId === c.id ? null : c.id); setScheduleAt(""); }}>⏱</button>
											<button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm({ title: "Delete campaign?", message: `“${c.name}” and its recipient ledger are removed.`, danger: true, action: async () => { await del(`/campaigns/${c.id}`); load(); } })}>×</button>
										</>
									)}
									{c.status === "scheduled" && (
										<button type="button" className="btn btn--ghost btn--sm" disabled={busyId === c.id} onClick={() => cancelScheduled(c)}>Cancel send</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* ── Schedule bar ── */}
			{schedulingId && (
				<div className="card" style={{ marginTop: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
					<span className="muted">Send {campaigns.find((c) => c.id === schedulingId)?.name ?? ""} at — your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
					<input type="datetime-local" className="input" style={{ maxWidth: 230 }} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
					<button
						type="button"
						className="btn btn--primary btn--sm"
						disabled={!scheduleAt || new Date(scheduleAt).getTime() <= Date.now()}
						onClick={() => {
							const c = campaigns.find((x) => x.id === schedulingId);
							if (!c) return;
							setSchedulingId(null);
							void sendNow(c, new Date(scheduleAt).toISOString());
						}}
					>
						Schedule send
					</button>
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => setSchedulingId(null)}>Cancel</button>
				</div>
			)}

			{/* ── Report pane ── */}
			{report && (
				<div className="mkt-report card">
					<div className="mkt-report__head">
						<div>
							<h3>{report.campaign.name} — report</h3>
							<p className="muted">Sent {fmtDate(report.campaign.sentAt)} · {audienceName(report.campaign)}</p>
						</div>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setReport(null)}>Close</button>
					</div>
					<div className="mkt-ratetiles">
						<RateTile label="Delivered" value={`${report.data.totals.sent}`} sub={pct(report.data.totals.sent, report.data.totals.recipients)} />
						<RateTile label="Opened" value={pct(report.data.totals.opened, report.data.totals.sent)} sub={`${report.data.totals.opened}`} />
						<RateTile label="Clicked" value={pct(report.data.totals.clicked, report.data.totals.sent)} sub={`${report.data.totals.clicked}`} />
						<RateTile label="Bounced" value={pct(report.data.totals.bounced, report.data.totals.sent)} sub={`${report.data.totals.bounced}`} />
						<RateTile label="Skipped" value={`${report.data.totals.skipped}`} sub="suppressed/unsub" />
						<RateTile label="Failed" value={`${report.data.totals.failed}`} sub="" />
					</div>
					{report.data.topLinks.length > 0 && (
						<div className="mkt-toplinks">
							<div className="label">Top links</div>
							{report.data.topLinks.map((l) => (
								<div key={l.url} className="mkt-toplink">
									<span className="mkt-toplink__url">{l.url}</span>
									<strong>{l.clicks}</strong>
								</div>
							))}
						</div>
					)}
					<div className="mkt-chips" style={{ marginTop: 12 }}>
						{["all", "sent", "failed", "skipped", "pending"].map((f) => (
							<button key={f} type="button" className={`mkt-chip${recipientFilter === f ? " mkt-chip--on" : ""}`} onClick={() => setRecipientFilter(f)}>{f}</button>
						))}
						{report.campaign.status === "sent" && (
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								style={{ marginLeft: "auto" }}
								onClick={() => setConfirm({ title: "Retry failed recipients?", message: "Only rows marked failed are re-queued — delivered recipients are never resent.", action: async () => { await post(`/campaigns/${report.campaign.id}/retry-failed`, {}); openReport(report.campaign); load(); } })}
							>
								Retry failed
							</button>
						)}
					</div>
					<div className="ops-table-wrap" style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}>
						<table className="admin-table">
							<thead>
								<tr><th>Recipient</th><th>Status</th><th>Sent</th><th>Opened</th><th>Clicked</th><th>Error</th></tr>
							</thead>
							<tbody>
								{shownRecipients.map((r) => (
									<tr key={r.id}>
										<td>{r.name ? `${r.name} · ` : ""}{r.email}</td>
										<td><span className={`mkt-chip mkt-chip--${r.status}`}>{r.status}</span></td>
										<td>{fmtDate(r.sentAt)}</td>
										<td>{r.openedAt ? "✓" : "—"}</td>
										<td>{r.clickedAt ? `✓ ${r.clickedUrl ? "" : ""}` : "—"}</td>
										<td className="muted">{r.error ?? ""}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* ── Compose sheet ── */}
			{compose && (
				<div className="mkt-sheet" role="dialog" aria-label="Compose campaign">
					<div className="mkt-sheet__panel">
						<div className="mkt-report__head">
							<h3>{compose.id ? "Edit campaign" : "New campaign"}</h3>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setCompose(null)}>Close</button>
						</div>
						<div className="composer__sendgrid" style={{ marginBottom: 12 }}>
							<label className="label">
								Name
								<input className="input" value={compose.name} onChange={(e) => setCompose({ ...compose, name: e.target.value })} placeholder="October intake push" />
							</label>
							<label className="label">
								Audience — list
								<select className="input" value={compose.listId} onChange={(e) => setCompose({ ...compose, listId: e.target.value, segmentId: e.target.value ? "" : compose.segmentId })}>
									<option value="">— none —</option>
									{lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.confirmedCount})</option>)}
								</select>
							</label>
							<label className="label">
								or live segment
								<select className="input" value={compose.segmentId} onChange={(e) => setCompose({ ...compose, segmentId: e.target.value, listId: e.target.value ? "" : compose.listId })}>
									<option value="">— none —</option>
									{segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.entity})</option>)}
								</select>
							</label>
						</div>
						<Composer
							blocks={compose.blocks}
							onChange={(blocks) => setCompose({ ...compose, blocks })}
							subject={compose.subject}
							onSubject={(subject) => setCompose({ ...compose, subject })}
							preheader={compose.preheader}
							onPreheader={(preheader) => setCompose({ ...compose, preheader })}
							showSendFields
							fromName={compose.fromName}
							onFromName={(fromName) => setCompose({ ...compose, fromName })}
							replyTo={compose.replyTo}
							onReplyTo={(replyTo) => setCompose({ ...compose, replyTo })}
						/>
						<div className="mkt-sheet__foot">
							<button type="button" className="btn btn--primary" disabled={composeBusy || !compose.name || !compose.subject || (!compose.listId && !compose.segmentId)} onClick={saveCompose}>
								{composeBusy ? "Saving…" : "Save campaign"}
							</button>
							<span className="muted">Send and schedule from the queue once saved.</span>
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

function RateTile({ label, value, sub }: { label: string; value: string; sub: string }) {
	return (
		<div className="mkt-ratetile">
			<div className="mkt-ratetile__label">{label}</div>
			<div className="mkt-ratetile__value">{value}</div>
			<div className="mkt-ratetile__sub">{sub}</div>
		</div>
	);
}

/** Per-row open rate — lazy-fetched once per sent campaign. */
function OpenRate({ id, delivered }: { id: string; delivered: number }) {
	const [opened, setOpened] = useState<number | null>(null);
	useEffect(() => {
		if (delivered === 0) return;
		get<CampaignReport>(`/campaigns/${id}/report`).then((r) => setOpened(r.totals.opened)).catch(() => {});
	}, [id, delivered]);
	return <>{delivered === 0 ? "—" : opened === null ? "…" : pct(opened, delivered)}</>;
}

function ClickRate({ id, delivered }: { id: string; delivered: number }) {
	const [clicked, setClicked] = useState<number | null>(null);
	useEffect(() => {
		if (delivered === 0) return;
		get<CampaignReport>(`/campaigns/${id}/report`).then((r) => setClicked(r.totals.clicked)).catch(() => {});
	}, [id, delivered]);
	return <>{delivered === 0 ? "—" : clicked === null ? "…" : pct(clicked, delivered)}</>;
}
