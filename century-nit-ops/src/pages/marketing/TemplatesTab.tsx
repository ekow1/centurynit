import { useCallback, useEffect, useState } from "react";
import { del, fmtDate, get, post, put } from "./mkt";
import type { Automation, EmailBlock, EmailTemplate } from "./mkt";
import { Composer } from "./Composer";
import { ConfirmDialog, Toast } from "../OpsDialogs";

/**
 * Templates — reusable block emails. Presets are read-only starters that
 * fork on first edit; custom templates warn when a live automation uses
 * them, so nobody edits the copy under a running send.
 */

export function TemplatesTab() {
	const [templates, setTemplates] = useState<EmailTemplate[]>([]);
	const [automations, setAutomations] = useState<Automation[]>([]);
	const [loading, setLoading] = useState(true);
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);
	const [confirm, setConfirm] = useState<null | { title: string; message: string; danger?: boolean; action: () => void }>(null);

	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const [startFrom, setStartFrom] = useState("blank");
	const [usedFor, setUsedFor] = useState("both");

	const [editing, setEditing] = useState<null | {
		id: string | null;
		name: string;
		subject: string;
		blocks: EmailBlock[];
		preheader: string;
		usedFor: string;
	}>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [t, a] = await Promise.all([
				get<{ templates: EmailTemplate[] }>("/templates"),
				get<{ automations: Automation[] }>("/automations"),
			]);
			setTemplates(t.templates);
			setAutomations(a.automations);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => void load(), [load]);

	const usedBy = (id: string) => automations.filter((a) => a.templateId === id);

	function openEditor(t?: EmailTemplate, fork?: EmailTemplate) {
		const src = fork ?? t;
		setEditing({
			id: fork ? null : (t?.id ?? null),
			name: fork ? `${fork.name} (copy)` : (t?.name ?? newName),
			subject: src?.subject ?? "",
			blocks: src?.blocks ?? (src?.body ? [{ type: "paragraph", text: src.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }] : []),
			preheader: src?.preheader ?? "",
			usedFor: src?.usedFor ?? usedFor,
		});
		setCreating(false);
	}

	async function save() {
		if (!editing) return;
		const payload = {
			name: editing.name,
			subject: editing.subject,
			body: "blocks",
			blocks: editing.blocks,
			preheader: editing.preheader || null,
			usedFor: editing.usedFor,
			isCustom: true,
		};
		try {
			if (editing.id) await put(`/templates/${editing.id}`, payload);
			else await post("/templates", payload);
			setEditing(null);
			setToast({ type: "success", message: "Template saved." });
			load();
		} catch (e) {
			setToast({ type: "error", message: e instanceof Error ? e.message : "Save failed" });
		}
	}

	const startOptions = [
		{ id: "blank", label: "Blank" },
		...templates.slice(0, 6).map((t) => ({ id: t.id, label: `Fork · ${t.name}` })),
	];

	return (
		<>
			<div className="mkt-toolbar">
				<h3 className="mkt-h">Templates</h3>
				<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>+ New template</button>
			</div>

			<div className="mkt-tplgrid">
				{loading && <p className="muted">Loading…</p>}
				{templates.map((t) => {
					const used = usedBy(t.id);
					return (
						<div key={t.id} className="mkt-tplcard card">
							<div className="mkt-tplcard__mini">
								<div className="mkt-tplcard__minihead">Century NIT</div>
								<div className="mkt-tplcard__minibody">
									{(t.blocks ?? []).slice(0, 3).map((b, i) =>
										b.type === "heading" ? <strong key={i}>{b.text}</strong>
										: b.type === "paragraph" ? <p key={i}>{b.text.slice(0, 80)}</p>
										: b.type === "button" ? <span key={i} className="mkt-tplcard__minibtn">{b.text}</span>
										: b.type === "divider" ? <hr key={i} />
										: <p key={i} className="muted">two columns</p>,
									)}
									{!t.blocks?.length && <p>{t.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 140)}</p>}
								</div>
								<div className="mkt-tplcard__minifoot">Unsubscribe · Preferences</div>
							</div>
							<div className="mkt-tplcard__meta">
								<strong>{t.name}</strong>
								<div className="muted">
									{t.isPreset ? "Preset · read-only starter" : t.isCustom ? "Custom" : "Starter"}
									{used.length > 0 && ` · used in ${used.length} automation${used.length === 1 ? "" : "s"}`}
									{` · ${fmtDate(t.updatedAt)}`}
								</div>
							</div>
							<div className="mkt-tplcard__ops">
								{t.isPreset ? (
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditor(undefined, t)}>Fork</button>
								) : (
									<>
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditor(t)}>Edit</button>
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditor(undefined, t)}>Duplicate</button>
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm({ title: "Delete template?", message: `“${t.name}”${used.length ? ` — used by ${used.length} automation(s), which will lose their template.` : ""}`, danger: true, action: async () => { await del(`/templates/${t.id}`); load(); } })}>×</button>
									</>
								)}
							</div>
						</div>
					);
				})}
			</div>

			{/* ── New template sheet ── */}
			{creating && (
				<div className="mkt-sheet" role="dialog" aria-label="New template">
					<div className="mkt-sheet__panel" style={{ maxWidth: 440 }}>
						<div className="mkt-report__head">
							<h3>New template</h3>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(false)}>Close</button>
						</div>
						<label className="label">Name<input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Intake reminder" /></label>
						<div className="label">Start from</div>
						<select className="input" value={startFrom} onChange={(e) => setStartFrom(e.target.value)}>
							{startOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
						</select>
						<div className="label" style={{ marginTop: 10 }}>Used for</div>
						<div className="mkt-chips">
							{["campaigns", "automations", "both"].map((u) => (
								<button key={u} type="button" className={`mkt-chip${usedFor === u ? " mkt-chip--on" : ""}`} onClick={() => setUsedFor(u)}>{u}</button>
							))}
						</div>
						<div className="mkt-sheet__foot">
							<button
								type="button"
								className="btn btn--primary"
								disabled={!newName}
								onClick={() => {
									const src = startFrom === "blank" ? undefined : templates.find((t) => t.id === startFrom);
									openEditor(undefined, src);
								}}
							>
								Create &amp; compose
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── Composer sheet ── */}
			{editing && (
				<div className="mkt-sheet" role="dialog" aria-label="Template composer">
					<div className="mkt-sheet__panel">
						<div className="mkt-report__head">
							<h3>{editing.id ? `Edit · ${editing.name}` : `New · ${editing.name}`}</h3>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Close</button>
						</div>
						{editing.id && usedBy(editing.id).some((a) => a.status === "live") && (
							<p className="mkt-warn">This template is used by a running automation — edits apply to the next send.</p>
						)}
						<label className="label">
							Name
							<input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
						</label>
						<Composer
							blocks={editing.blocks}
							onChange={(blocks) => setEditing({ ...editing, blocks })}
							subject={editing.subject}
							onSubject={(subject) => setEditing({ ...editing, subject })}
							preheader={editing.preheader}
							onPreheader={(preheader) => setEditing({ ...editing, preheader })}
						/>
						<div className="mkt-sheet__foot">
							<button type="button" className="btn btn--primary" disabled={!editing.name || !editing.subject} onClick={save}>Save template</button>
							<span className="muted">Header and footer are shared blocks — unsubscribe and preferences links are already in.</span>
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
