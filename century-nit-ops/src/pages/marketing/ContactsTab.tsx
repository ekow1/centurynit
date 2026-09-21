import { useCallback, useEffect, useState } from "react";
import { fmtDate, get, MKT, post } from "./mkt";
import type { MailingList, Person, PersonDetail } from "./mkt";
import { Toast } from "../OpsDialogs";

/**
 * Contacts — the person, not the list row. One row per address; "In the
 * suite as" shows the identity the business knows (applicant + case, lead,
 * or plain contact). Lists are memberships; segment membership is computed
 * and shown on the detail. Consent is read-only here — the only writes are
 * the two honest doors in Add contact.
 */

const CONSENT_FILTERS = [
	{ id: "all", label: "All" },
	{ id: "opted_in", label: "Opted in" },
	{ id: "never_asked", label: "Never asked" },
	{ id: "unsubscribed", label: "Unsubscribed" },
	{ id: "suppressed", label: "Suppressed" },
] as const;

const CONSENT_LABEL: Record<string, string> = {
	opted_in: "Opted in",
	never_asked: "Never asked",
	unsubscribed: "Unsubscribed",
	suppressed: "Suppressed",
};

export function ContactsTab() {
	const [people, setPeople] = useState<Person[]>([]);
	const [total, setTotal] = useState(0);
	const [breakdown, setBreakdown] = useState<Record<string, number>>({});
	const [filter, setFilter] = useState<(typeof CONSENT_FILTERS)[number]["id"]>("all");
	const [dupesOnly, setDupesOnly] = useState(false);
	const [q, setQ] = useState("");
	const [loading, setLoading] = useState(true);
	const [lists, setLists] = useState<MailingList[]>([]);
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);

	const [detail, setDetail] = useState<PersonDetail | null>(null);
	const [adding, setAdding] = useState(false);
	const [importing, setImporting] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (q) params.set("q", q);
			if (filter !== "all") params.set("consent", filter);
			if (dupesOnly) params.set("duplicates", "1");
			params.set("limit", "200");
			const res = await get<{ contacts: Person[]; total: number; breakdown: Record<string, number> }>(`/contacts?${params}`);
			setPeople(res.contacts);
			setTotal(res.total);
			setBreakdown(res.breakdown);
		} finally {
			setLoading(false);
		}
	}, [q, filter, dupesOnly]);

	useEffect(() => {
		const t = setTimeout(load, 250);
		return () => clearTimeout(t);
	}, [load]);

	useEffect(() => {
		get<{ mailingLists: MailingList[] }>("/mailing-lists").then((r) => setLists(r.mailingLists)).catch(() => {});
	}, []);

	async function openDetail(email: string) {
		setDetail(await get<PersonDetail>(`/contacts/${encodeURIComponent(email)}`));
	}

	return (
		<>
			<div className="mkt-toolbar">
				<div className="mkt-chips">
					{CONSENT_FILTERS.map((f) => (
						<button key={f.id} type="button" className={`mkt-chip${filter === f.id ? " mkt-chip--on" : ""}`} onClick={() => setFilter(f.id)}>
							{f.label}{breakdown[f.id] !== undefined ? ` ${breakdown[f.id]}` : ""}
						</button>
					))}
					<button type="button" className={`mkt-chip${dupesOnly ? " mkt-chip--on" : ""}`} onClick={() => setDupesOnly(!dupesOnly)}>Duplicates</button>
				</div>
				<div style={{ display: "flex", gap: 8 }}>
					<input className="input" style={{ maxWidth: 220 }} placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
					<button type="button" className="btn" onClick={() => setImporting(true)}>Import CSV</button>
					<a className="btn" href={`${MKT}/contacts-export`} download>Export</a>
					<button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>+ Add contact</button>
				</div>
			</div>

			<div className="card ops-table-wrap">
				<table className="admin-table">
					<thead>
						<tr><th>Contact</th><th>In the suite as</th><th>Consent</th><th>Member of</th><th>Last engagement</th><th /></tr>
					</thead>
					<tbody>
						{loading && <tr><td colSpan={6}>Loading…</td></tr>}
						{!loading && people.length === 0 && <tr><td colSpan={6}>Nobody matches — {total} people on file.</td></tr>}
						{people.map((p) => (
							<tr key={p.email}>
								<td>
									<strong>{p.name ?? p.email}</strong>
									{p.name && <div className="muted">{p.email}</div>}
									{p.rowCount > 1 && <span className="mkt-chip" title="This address sits on several list rows — one person, merged view.">{p.rowCount} rows → 1</span>}
								</td>
								<td>
									{p.identity === "applicant" && <>Applicant{p.caseRef ? ` · ${p.caseRef}` : ""}{p.chapter ? <div className="muted">{p.chapter.replace(/_/g, " ")}</div> : null}</>}
									{p.identity === "lead" && <>Lead{p.chapter ? <div className="muted">{p.chapter}</div> : null}</>}
									{p.identity === "contact" && "Contact"}
								</td>
								<td>
									<span className={`mkt-chip mkt-chip--consent-${p.consent}`}>{CONSENT_LABEL[p.consent] ?? p.consent}</span>
									{p.consentSource && <div className="muted">{p.consentSource.replace(/_/g, " ")}</div>}
								</td>
								<td className="muted">{p.lists.join(" · ") || "—"}</td>
								<td className="muted">{fmtDate(p.lastEngagement)}</td>
								<td><button type="button" className="btn btn--ghost btn--sm" onClick={() => openDetail(p.email)}>History</button></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* ── Contact detail ── */}
			{detail && (
				<div className="mkt-sheet" role="dialog" aria-label="Contact detail">
					<div className="mkt-sheet__panel">
						<div className="mkt-report__head">
							<div>
								<h3>{detail.person.name ?? detail.person.email}</h3>
								<p className="muted">
									{detail.person.email} · {detail.person.identity}
									{detail.person.caseRef ? ` · ${detail.person.caseRef}` : ""}
									{detail.person.branch ? ` · ${detail.person.branch}` : ""}
								</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setDetail(null)}>Close</button>
						</div>

						<div className="mkt-ratetiles">
							<div className="mkt-ratetile"><div className="mkt-ratetile__label">Consent</div><div className="mkt-ratetile__value" style={{ fontSize: 16 }}>{CONSENT_LABEL[detail.person.consent] ?? detail.person.consent}</div></div>
							<div className="mkt-ratetile"><div className="mkt-ratetile__label">Campaigns received</div><div className="mkt-ratetile__value">{detail.campaigns.filter((c) => c.status === "sent").length}</div></div>
							<div className="mkt-ratetile"><div className="mkt-ratetile__label">Opened</div><div className="mkt-ratetile__value">{detail.campaigns.filter((c) => c.openedAt).length}</div></div>
							<div className="mkt-ratetile"><div className="mkt-ratetile__label">Clicked</div><div className="mkt-ratetile__value">{detail.campaigns.filter((c) => c.clickedAt).length}</div></div>
						</div>

						<div className="mkt-detailgrid">
							<div>
								<div className="label">Lists — assigned</div>
								{detail.person.lists.length === 0 ? <p className="muted">On no list.</p> : detail.person.lists.map((l) => <div key={l} className="mkt-chip" style={{ marginRight: 6 }}>{l}</div>)}
							</div>
							<div>
								<div className="label">Consent &amp; suppression</div>
								{detail.optin && <p>Opted in — {detail.optin.source.replace(/_/g, " ")}{detail.optin.note ? ` · “${detail.optin.note}”` : ""} · {new Date(detail.optin.createdAt).toLocaleDateString()}</p>}
								{detail.suppression && <p>Suppressed — {detail.suppression.reason}{detail.suppression.detail ? ` · ${detail.suppression.detail}` : ""} · {new Date(detail.suppression.createdAt).toLocaleDateString()}</p>}
								{!detail.optin && !detail.suppression && <p className="muted">Never asked — no consent on record.</p>}
							</div>
						</div>

						<div className="label" style={{ marginTop: 16 }}>Every campaign received</div>
						<div className="ops-table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
							<table className="admin-table">
								<thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Opened</th><th>Clicked</th></tr></thead>
								<tbody>
									{detail.campaigns.length === 0 && <tr><td colSpan={5}>Nothing sent to this address yet.</td></tr>}
									{detail.campaigns.map((c) => (
										<tr key={c.campaignId}>
											<td>{c.name}</td>
											<td><span className={`mkt-chip mkt-chip--${c.status}`}>{c.status}</span></td>
											<td>{fmtDate(c.sentAt)}</td>
											<td>{c.openedAt ? "✓" : "—"}</td>
											<td>{c.clickedAt ? "✓" : "—"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			)}

			{adding && <AddContactSheet lists={lists} onClose={() => setAdding(false)} onDone={(msg) => { setAdding(false); setToast({ type: "success", message: msg }); load(); }} />}
			{importing && <ImportSheet lists={lists} onClose={() => setImporting(false)} onDone={(msg) => { setImporting(false); setToast({ type: "success", message: msg }); load(); }} />}

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</>
	);
}

/* ── Add contact — two honest consent doors, no silent confirmed ────────── */

function AddContactSheet({ lists, onClose, onDone }: { lists: MailingList[]; onClose: () => void; onDone: (msg: string) => void }) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [consent, setConsent] = useState<"confirm_email" | "offline">("confirm_email");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [exists, setExists] = useState<boolean | null>(null);
	const [err, setErr] = useState("");

	useEffect(() => {
		if (!email.includes("@")) { setExists(null); return; }
		const t = setTimeout(async () => {
			try {
				const r = await get<{ contacts: Person[] }>(`/contacts?q=${encodeURIComponent(email)}&limit=1`);
				setExists(r.contacts.some((p) => p.email.toLowerCase() === email.toLowerCase()));
			} catch { setExists(null); }
		}, 400);
		return () => clearTimeout(t);
	}, [email]);

	async function submit() {
		setBusy(true);
		setErr("");
		try {
			const res = await post<{ outcome: string; existing: boolean }>("/contacts", {
				name: name || null,
				email,
				listIds: picked,
				consent: consent === "offline" ? { method: "offline", note } : { method: "confirm_email" },
			});
			onDone(
				res.outcome === "opted_in"
					? `${email} added — opted in (offline consent).`
					: `${email} added — confirmation email sent, pending until they click.`,
			);
		} catch (e) {
			setErr(e instanceof Error ? e.message : "Add failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mkt-sheet" role="dialog" aria-label="Add contact">
			<div className="mkt-sheet__panel" style={{ maxWidth: 460 }}>
				<div className="mkt-report__head">
					<h3>Add contact</h3>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
				</div>

				<label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
				<label className="label">
					Email
					<input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ama@example.com" />
				</label>
				{exists === true && <p className="muted">This address is already on file — you'll be adding a membership to the existing person, not a duplicate row.</p>}
				{exists === false && <p className="muted">✓ Not on any list — a new person.</p>}

				<div className="label">Add to lists</div>
				{lists.map((l) => (
					<label key={l.id} className="mkt-check">
						<input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
						{l.name}
					</label>
				))}
				<p className="muted">Segments can't be picked by hand — membership is computed from their filters.</p>

				<div className="label" style={{ marginTop: 12 }}>Consent — required</div>
				<label className="mkt-check">
					<input type="radio" name="consent" checked={consent === "confirm_email"} onChange={() => setConsent("confirm_email")} />
					Send a confirmation email — they land <em>Pending</em>, become opted in on the click.
				</label>
				<label className="mkt-check">
					<input type="radio" name="consent" checked={consent === "offline"} onChange={() => setConsent("offline")} />
					They consented offline — record the proof:
				</label>
				{consent === "offline" && (
					<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. signed form at Kumasi fair, Sep 20" />
				)}
				<p className="muted">There is no silent “confirmed” — an address is opted in only by their click or a logged note.</p>

				{err && <p className="mkt-err">{err}</p>}
				<div className="mkt-sheet__foot">
					<button type="button" className="btn btn--primary" disabled={busy || !email.includes("@") || (consent === "offline" && note.trim().length < 5)} onClick={submit}>
						{busy ? "Adding…" : "Add contact"}
					</button>
				</div>
			</div>
		</div>
	);
}

/* ── CSV import — same consent door, dry-run style report after ─────────── */

function ImportSheet({ lists, onClose, onDone }: { lists: MailingList[]; onClose: () => void; onDone: (msg: string) => void }) {
	const [listId, setListId] = useState(lists[0]?.id ?? "");
	const [text, setText] = useState("");
	const [consent, setConsent] = useState<"confirm_email" | "offline">("confirm_email");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [report, setReport] = useState<null | { added: number; duplicates: number; invalid: number }>(null);
	const [err, setErr] = useState("");

	const rows = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => {
			const [a, b] = l.includes(",") ? l.split(",").map((s) => s.trim()) : [l, ""];
			// Tolerate either order: find the side with the @.
			return a.includes("@") ? { email: a, name: b || null } : { email: b, name: a || null };
		});

	async function submit() {
		setBusy(true);
		setErr("");
		try {
			const res = await post<{ added: number; duplicates: number; invalid: number }>("/contacts/import", {
				listId,
				rows,
				consent: consent === "offline" ? { method: "offline", note } : { method: "confirm_email" },
			});
			setReport(res);
		} catch (e) {
			setErr(e instanceof Error ? e.message : "Import failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mkt-sheet" role="dialog" aria-label="Import contacts">
			<div className="mkt-sheet__panel" style={{ maxWidth: 480 }}>
				<div className="mkt-report__head">
					<h3>Import CSV</h3>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>Close</button>
				</div>
				{!report ? (
					<>
						<label className="label">
							Into list
							<select className="input" value={listId} onChange={(e) => setListId(e.target.value)}>
								{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
							</select>
						</label>
						<label className="label">
							Paste rows — <span className="muted">email,name or name,email · one per line</span>
							<textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"ama@example.com, Ama Serwaa\nkofi@example.com, Kofi Boateng"} />
						</label>
						<p className="muted">{rows.length} row{rows.length === 1 ? "" : "s"} parsed.</p>

						<div className="label">Consent for the batch — required</div>
						<label className="mkt-check">
							<input type="radio" name="iconsent" checked={consent === "confirm_email"} onChange={() => setConsent("confirm_email")} />
							Send confirmation emails — each lands <em>Pending</em>.
						</label>
						<label className="mkt-check">
							<input type="radio" name="iconsent" checked={consent === "offline"} onChange={() => setConsent("offline")} />
							They consented offline — record the proof:
						</label>
						{consent === "offline" && <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. expo signup sheet, Accra · Oct 4" />}

						{err && <p className="mkt-err">{err}</p>}
						<div className="mkt-sheet__foot">
							<button type="button" className="btn btn--primary" disabled={busy || rows.length === 0 || !listId || (consent === "offline" && note.trim().length < 5)} onClick={submit}>
								{busy ? "Importing…" : `Import ${rows.length} rows`}
							</button>
						</div>
					</>
				) : (
					<>
						<div className="mkt-ratetiles">
							<div className="mkt-ratetile"><div className="mkt-ratetile__label">New</div><div className="mkt-ratetile__value">{report.added}</div></div>
							<div className="mkt-ratetile"><div className="mkt-ratetile__label">Duplicates merged</div><div className="mkt-ratetile__value">{report.duplicates}</div></div>
							<div className="mkt-ratetile"><div className="mkt-ratetile__label">Invalid</div><div className="mkt-ratetile__value">{report.invalid}</div></div>
						</div>
						<p className="muted">{consent === "offline" ? "Marked opted in with your note." : "Confirmation emails queued — they opt in on the click."}</p>
						<div className="mkt-sheet__foot">
							<button type="button" className="btn btn--primary" onClick={() => onDone(`${report.added} imported, ${report.duplicates} dupes, ${report.invalid} invalid`)}>Done</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
