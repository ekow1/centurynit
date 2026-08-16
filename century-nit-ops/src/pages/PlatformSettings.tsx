import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Platform Settings — integration credentials and fee schedule.
 *
 * Managed from the ops UI with strict super_admin enforcement.
 * Editing requires a fresh TOTP code from an authenticator app.
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

function sourceLabel(source: SettingSource): string {
	switch (source) {
		case "database":
			return "Database";
		case "env":
			return "Environment";
		case "unset":
			return "Default";
	}
}

function formatDate(iso: string | null): string {
	if (!iso) return "—";
	try {
		return new Date(iso).toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

function formatCentsHelper(val: string): string | null {
	const num = Number.parseInt(val, 10);
	if (Number.isNaN(num)) return null;
	return `$${(num / 100).toFixed(2)} USD`;
}

export function PlatformSettings() {
	const [settings, setSettings] = useState<SettingView[]>([]);
	const [audit, setAudit] = useState<AuditEntry[]>([]);
	const [loadState, setLoadState] = useState<LoadState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState<SettingView | null>(null);
	const [selectedGroup, setSelectedGroup] = useState<string>("all");
	const [searchQuery, setSearchQuery] = useState("");

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

	const groups = useMemo(() => {
		const set = new Set<string>();
		for (const s of settings) {
			set.add(s.group);
		}
		return Array.from(set);
	}, [settings]);

	const filteredSettings = useMemo(() => {
		return settings.filter((s) => {
			if (selectedGroup !== "all" && s.group !== selectedGroup) return false;
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				return (
					s.label.toLowerCase().includes(q) ||
					s.key.toLowerCase().includes(q) ||
					s.group.toLowerCase().includes(q) ||
					s.description.toLowerCase().includes(q)
				);
			}
			return true;
		});
	}, [settings, selectedGroup, searchQuery]);

	// Group filtered settings by group name
	const grouped = useMemo(() => {
		const map = new Map<string, SettingView[]>();
		for (const s of filteredSettings) {
			const arr = map.get(s.group) ?? [];
			arr.push(s);
			map.set(s.group, arr);
		}
		return Array.from(map.entries());
	}, [filteredSettings]);

	return (
		<div className="admin-page">
			{/* Page Header */}
			<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
				<div>
					<h2 className="section-title">System Configuration</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Regional defaults, payment keys, integration credentials, and fee schedules.
					</p>
				</div>
				<button
					type="button"
					className="btn btn--ghost btn--sm"
					onClick={() => void loadAll()}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? "Refreshing…" : "Refresh"}
				</button>
			</div>

			{error && (
				<div className="ops-modal__error" style={{ marginBottom: "1.5rem" }}>
					<strong>Could not load settings:</strong> {error}
				</div>
			)}

			{/* Filters & Search Toolbar */}
			<div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
				<div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
						<button
							type="button"
							className={`btn btn--sm ${selectedGroup === "all" ? "btn--primary" : "btn--ghost"}`}
							onClick={() => setSelectedGroup("all")}
						>
							All ({settings.length})
						</button>
						{groups.map((g) => {
							const count = settings.filter((s) => s.group === g).length;
							return (
								<button
									key={g}
									type="button"
									className={`btn btn--sm ${selectedGroup === g ? "btn--primary" : "btn--ghost"}`}
									onClick={() => setSelectedGroup(g)}
								>
									{g} ({count})
								</button>
							);
						})}
					</div>

					<div style={{ minWidth: "14rem" }}>
						<input
							type="search"
							className="input input--full-border"
							placeholder="Search settings…"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							style={{ padding: "0.4rem 0.75rem", fontSize: "var(--text-sm)" }}
						/>
					</div>
				</div>
			</div>

			{/* Grouped Settings Tables */}
			{grouped.length === 0 ? (
				<div className="card" style={{ padding: "2rem", textAlign: "center" }}>
					<p className="muted">No settings match your search or filter.</p>
				</div>
			) : (
				grouped.map(([group, items]) => (
					<div key={group} className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem" }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
							<h3 className="section-title" style={{ fontSize: "1.1rem", margin: 0 }}>
								{group}
							</h3>
							<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
								{items.length} {items.length === 1 ? "setting" : "settings"}
							</span>
						</div>

						<div className="admin-table-wrap">
							<table className="admin-table">
								<thead>
									<tr>
										<th style={{ width: "40%" }}>Setting</th>
										<th style={{ width: "25%" }}>Current Value</th>
										<th style={{ width: "15%" }}>Source</th>
										<th style={{ width: "10%" }}>Updated</th>
										<th style={{ width: "10%", textAlign: "right" }}>Action</th>
									</tr>
								</thead>
								<tbody>
									{items.map((s) => (
										<tr key={s.key}>
											<td>
												<div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.label}</div>
												<div className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.2rem" }}>
													{s.description}
												</div>
												<code className="mono muted" style={{ fontSize: "0.75rem", display: "inline-block", marginTop: "0.25rem" }}>
													{s.key}
												</code>
											</td>
											<td className="mono" style={{ fontSize: "var(--text-sm)" }}>
												{s.valueMasked ? (
													<div>
														<span>{s.valueMasked}</span>
														{s.key.endsWith("_CENTS") && (
															<div className="muted" style={{ fontSize: "var(--text-xs)" }}>
																{formatCentsHelper(s.valueMasked)}
															</div>
														)}
													</div>
												) : (
													<span className="muted">— (Default)</span>
												)}
											</td>
											<td>
												<span
													style={{
														fontFamily: "var(--font-mono)",
														fontSize: "var(--text-xs)",
														textTransform: "uppercase",
														letterSpacing: "0.04em",
														padding: "0.2rem 0.5rem",
														border: "var(--thin)",
														background: s.source === "database" ? "var(--foreground)" : "transparent",
														color: s.source === "database" ? "var(--background)" : "var(--foreground)",
													}}
												>
													{sourceLabel(s.source)}
												</span>
											</td>
											<td className="muted mono" style={{ fontSize: "var(--text-xs)" }}>
												{formatDate(s.updatedAt)}
											</td>
											<td style={{ textAlign: "right" }}>
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
				))
			)}

			{/* Centered Modal Overlay for Editing */}
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

			{/* Audit Log Card */}
			<div className="card" style={{ padding: "1.5rem" }}>
				<h3 className="section-title" style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
					Configuration Audit Log
				</h3>
				{audit.length === 0 ? (
					<p className="muted">No changes recorded yet.</p>
				) : (
					<div className="admin-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>When</th>
									<th>Setting Key</th>
									<th>Changed By</th>
									<th>Old Value</th>
									<th>New Value</th>
								</tr>
							</thead>
							<tbody>
								{audit.map((e) => (
									<tr key={e.id}>
										<td className="muted mono" style={{ fontSize: "var(--text-xs)" }}>
											{formatDate(e.at)}
										</td>
										<td className="mono" style={{ fontSize: "var(--text-xs)" }}>{e.key}</td>
										<td>{e.actorEmail ?? "—"}</td>
										<td className="mono" style={{ fontSize: "var(--text-xs)" }}>{e.oldValueMasked ?? "—"}</td>
										<td className="mono" style={{ fontSize: "var(--text-xs)" }}>{e.newValueMasked ?? "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
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

	// Pre-fill non-secrets so the admin can tweak the current value.
	useEffect(() => {
		if (!setting.secret && setting.valueMasked) {
			setValue(setting.valueMasked);
		}
	}, [setting]);

	const centsHelper = setting.key.endsWith("_CENTS") && value ? formatCentsHelper(value) : null;

	async function save(e: React.FormEvent) {
		e.preventDefault();
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
			className="ops-modal-backdrop"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-labelledby="edit-setting-title"
		>
			<div className="ops-modal" onClick={(e) => e.stopPropagation()}>
				<header className="ops-modal__head">
					<div>
						<p className="invite-card__eyebrow" style={{ margin: 0 }}>
							{setting.group} · {setting.key}
						</p>
						<h2 id="edit-setting-title" className="ops-modal__title" style={{ marginTop: "0.25rem" }}>
							Edit {setting.label}
						</h2>
						<p className="ops-modal__sub">{setting.description}</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
						✕ Close
					</button>
				</header>

				{error && <p className="ops-modal__error">{error}</p>}

				<form onSubmit={save} className="invite-form" style={{ marginTop: "1rem" }}>
					<div className="field">
						<label htmlFor="setting-val-input">
							{setting.secret ? "New Secret Value" : "Value"}
							{setting.secret && (
								<span className="muted" style={{ fontWeight: 400 }}>
									{" (leave blank to keep existing value)"}
								</span>
							)}
						</label>
						<input
							id="setting-val-input"
							type={setting.secret ? "password" : "text"}
							className="input input--full-border"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder={setting.secret ? "••••••••••••••••" : "Enter setting value"}
							autoComplete="off"
							disabled={clear}
							autoFocus
						/>
						{centsHelper && (
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
								Equivalent amount: <strong>{centsHelper}</strong>
							</p>
						)}
					</div>

					<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "0.25rem 0" }}>
						<input
							id="clear-setting-chk"
							type="checkbox"
							checked={clear}
							onChange={(e) => setClear(e.target.checked)}
						/>
						<label htmlFor="clear-setting-chk" style={{ fontSize: "var(--text-sm)", cursor: "pointer", margin: 0 }}>
							Revert to default / environment variable
						</label>
					</div>

					<div className="field" style={{ borderTop: "var(--thin)", paddingTop: "1rem", marginTop: "0.5rem" }}>
						<label htmlFor="totp-code-input">
							Authenticator 6-Digit Code <span style={{ color: "#b00020" }}>*</span>
						</label>
						<input
							id="totp-code-input"
							type="text"
							className="input input--full-border mfa-code"
							style={{ width: "100%", fontSize: "1.25rem", letterSpacing: "0.25em" }}
							value={totpCode}
							onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
							placeholder="000000"
							inputMode="numeric"
							autoComplete="one-time-code"
							required
						/>
						<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>
							Security verification: enter the current 6-digit code from your authenticator app.
						</p>
					</div>

					<div className="cal-actions" style={{ marginTop: "1.25rem" }}>
						<button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={saving}>
							Cancel
						</button>
						<button
							type="submit"
							className="btn btn--primary"
							disabled={saving || (!clear && !value && !setting.secret) || totpCode.length !== 6}
						>
							{saving ? "Saving Changes…" : "Save Configuration"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

