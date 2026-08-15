import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Platform Settings — integration credentials managed from the ops UI.
 *
 * Replaces the mock `SystemConfig`. Talks to the real `/api/v1/settings`
 * endpoints, which are super_admin-only and require a fresh TOTP code on every
 * write. Values are masked server-side; secrets never come back in plaintext.
 */

type SettingSource = "database" | "env" | "unset";

interface SettingView {
	key: string;
	label: string;
	group: string;
	secret: boolean;
	description: string;
	valueMasked: string | null;
	source: SettingSource;
	updatedAt: string | null;
}

interface AuditEntry {
	id: string;
	key: string;
	actorEmail: string | null;
	oldValueMasked: string | null;
	newValueMasked: string | null;
	at: string;
}

type LoadState = "idle" | "loading" | "error" | "ready";

const GROUP_ORDER = ["Email", "Storage", "Google", "Booking"] as const;

function groupRank(group: string): number {
	const i = (GROUP_ORDER as readonly string[]).indexOf(group);
	return i === -1 ? GROUP_ORDER.length : i;
}

function sourceLabel(source: SettingSource): string {
	switch (source) {
		case "database":
			return "Database";
		case "env":
			return "Env var";
		case "unset":
			return "Not set";
	}
}

function sourceTone(source: SettingSource): string {
	switch (source) {
		case "database":
			return "ok";
		case "env":
			return "warn";
		case "unset":
			return "danger";
	}
}

function formatDate(iso: string | null): string {
	if (!iso) return "—";
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

export function PlatformSettings() {
	const [settings, setSettings] = useState<SettingView[]>([]);
	const [audit, setAudit] = useState<AuditEntry[]>([]);
	const [loadState, setLoadState] = useState<LoadState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState<SettingView | null>(null);

	const loadAll = useCallback(async () => {
		setLoadState("loading");
		setError(null);
		try {
			const [list, auditRes] = await Promise.all([
				apiFetch<{ settings: SettingView[] }>(`${API_PREFIX}/settings`),
				apiFetch<{ entries: AuditEntry[] }>(`${API_PREFIX}/settings/audit`),
			]);
			setSettings(list.settings);
			setAudit(auditRes.entries);
			setLoadState("ready");
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : String(err);
			setError(msg);
			setLoadState("error");
		}
	}, []);

	useEffect(() => {
		void loadAll();
	}, [loadAll]);

	const grouped = useMemo(() => {
		const map = new Map<string, SettingView[]>();
		for (const s of settings) {
			const arr = map.get(s.group) ?? [];
			arr.push(s);
			map.set(s.group, arr);
		}
		return [...map.entries()].sort((a, b) => groupRank(a[0]) - groupRank(b[0]));
	}, [settings]);

	return (
		<>
			<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
				<div>
					<h2 className="section-title">Platform Settings</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Integration credentials stored encrypted in the database. Editing requires a
						fresh authenticator code. Infrastructure secrets (database, auth, encryption key)
						stay in environment variables.
					</p>
				</div>
				<button
					type="button"
					className="btn btn--ghost"
					onClick={() => void loadAll()}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? "Refreshing…" : "Refresh"}
				</button>
			</div>

			{error && (
				<div className="card" style={{ marginBottom: "1.5rem", borderColor: "var(--danger, #c0392b)" }}>
					<strong>Couldn’t load settings.</strong>
					<p className="muted" style={{ marginTop: "0.5rem" }}>
						{error}
					</p>
				</div>
			)}

			{grouped.map(([group, items]) => (
				<div key={group} className="card" style={{ marginBottom: "1.5rem" }}>
					<h3 className="section-title" style={{ fontSize: "1.05rem", marginBottom: "1rem" }}>
						{group}
					</h3>
					<div className="admin-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Setting</th>
									<th>Value</th>
									<th>Source</th>
									<th>Updated</th>
									<th aria-label="actions" />
								</tr>
							</thead>
							<tbody>
								{items.map((s) => (
									<tr key={s.key}>
										<td>
											<div style={{ fontWeight: 600 }}>{s.label}</div>
											<div className="muted" style={{ fontSize: "0.85rem" }}>
												{s.description}
											</div>
										</td>
										<td className="mono">
											{s.valueMasked ?? <span className="muted">—</span>}
										</td>
										<td>
											<span className={`admin-status-pill admin-status-pill--${sourceTone(s.source)}`}>
												{sourceLabel(s.source)}
											</span>
										</td>
										<td className="muted">{formatDate(s.updatedAt)}</td>
										<td>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => setEditing(s)}
											>
												Edit
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			))}

			{editing && (
				<EditSettingModal
					setting={editing}
					onClose={() => setEditing(null)}
					onSaved={() => {
						setEditing(null);
						void loadAll();
					}}
				/>
			)}

			<div className="card">
				<h3 className="section-title" style={{ fontSize: "1.05rem", marginBottom: "1rem" }}>
					Audit Log
				</h3>
				{audit.length === 0 ? (
					<p className="muted">No changes recorded yet.</p>
				) : (
					<div className="admin-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>When</th>
									<th>Key</th>
									<th>By</th>
									<th>Old</th>
									<th>New</th>
								</tr>
							</thead>
							<tbody>
								{audit.map((e) => (
									<tr key={e.id}>
										<td className="muted">{formatDate(e.at)}</td>
										<td className="mono">{e.key}</td>
										<td>{e.actorEmail ?? "—"}</td>
										<td className="mono">{e.oldValueMasked ?? "—"}</td>
										<td className="mono">{e.newValueMasked ?? "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</>
	);
}

function EditSettingModal({
	setting,
	onClose,
	onSaved,
}: {
	setting: SettingView;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [value, setValue] = useState("");
	const [totpCode, setTotpCode] = useState("");
	const [clear, setClear] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Pre-fill non-secrets so the admin can see and tweak the current value.
	// Secrets are never sent back — leave blank to keep, or type a new value.
	useEffect(() => {
		if (!setting.secret && setting.valueMasked) {
			setValue(setting.valueMasked);
		}
	}, [setting]);

	async function save() {
		setSaving(true);
		setError(null);
		try {
			await apiFetch(`${API_PREFIX}/settings`, {
				method: "PUT",
				body: JSON.stringify({
					key: setting.key,
					value: clear ? null : value,
					totpCode,
				}),
			});
			onSaved();
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : String(err);
			setError(msg);
			setSaving(false);
		}
	}

	return (
		<div
			className="modal-backdrop"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-labelledby="edit-setting-title"
		>
			<div className="modal-card" onClick={(e) => e.stopPropagation()}>
				<h3 id="edit-setting-title" className="section-title">
					Edit {setting.label}
				</h3>
				<p className="muted" style={{ marginTop: "0.25rem", marginBottom: "1rem" }}>
					{setting.description}
				</p>

				<label className="field">
					<span className="field__label">
						{setting.secret ? "New value" : "Value"}
						{setting.secret && (
							<span className="muted" style={{ fontWeight: 400 }}>
								{" — leave blank to keep the current value"}
							</span>
						)}
					</span>
					<input
						type={setting.secret ? "password" : "text"}
						className="input"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder={setting.secret ? "••••••••••••" : ""}
						autoComplete="off"
					/>
				</label>

				<label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
				<input
					type="checkbox"
					checked={clear}
					onChange={(e) => setClear(e.target.checked)}
				/>
				<span className="field__label" style={{ margin: 0 }}>
						Clear stored value (revert to env var)
					</span>
				</label>

				<label className="field">
					<span className="field__label">Authenticator code</span>
					<input
						type="text"
						className="input"
						value={totpCode}
						onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
						placeholder="6 digits"
						inputMode="numeric"
						autoComplete="one-time-code"
					/>
				</label>

				{error && (
					<p style={{ color: "var(--danger, #c0392b)", marginTop: "0.5rem" }}>{error}</p>
				)}

				<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
					<button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
						Cancel
					</button>
					<button
						type="button"
						className="btn btn--primary"
						onClick={() => void save()}
						disabled={saving || (!clear && !value) || totpCode.length !== 6}
					>
						{saving ? "Saving…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}
