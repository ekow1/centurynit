import { useCallback, useEffect, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Document storage health — the live answer to "why did that document not
 * open". The settings table only proves a value exists; this row proves the
 * server can actually resolve it, reach Supabase, and sign a download URL.
 * The probe signs a deliberately-nonexistent key, so a healthy stack reports
 * "not found" — the error only fires when credentials or the bucket are wrong.
 */

type StorageCheck = {
	configured: boolean;
	supabaseUrl: string | null;
	bucket: string | null;
	sources: Record<string, string>;
	reachable: boolean | null;
	probeError: string | null;
};

export function StorageCheckRow() {
	const [check, setCheck] = useState<StorageCheck | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<StorageCheck>(`${API_PREFIX}/settings/storage-check`);
			setCheck(res);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	if (!check && !error) {
		return (
			<div style={{ marginBottom: "1rem", fontSize: "0.85rem" }} className="muted">
				Checking document storage…
			</div>
		);
	}

	const ok = Boolean(check?.configured && check.reachable);
	const pill = (label: string, on: boolean | null) => (
		<span
			style={{
				fontSize: "0.75rem",
				padding: "0.15rem 0.5rem",
				borderRadius: "999px",
				border: "1px solid var(--foreground)",
				background: on ? "var(--foreground)" : "transparent",
				color: on ? "var(--background)" : "var(--foreground)",
				opacity: on === false ? 0.85 : 1,
			}}
		>
			{label}
		</span>
	);

	return (
		<div
			style={{
				marginBottom: "1rem",
				padding: "0.85rem 1rem",
				background: "var(--surface-subtle, #fcfcfc)",
				border: "var(--thin)",
				borderRadius: "6px",
				display: "flex",
				flexDirection: "column",
				gap: "0.6rem",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
					<strong style={{ fontSize: "0.9rem" }}>Document storage</strong>
					{check && (
						<>
							{pill(ok ? "Working" : "Not working", ok)}
							<span className="muted mono" style={{ fontSize: "0.75rem" }}>
								{check.supabaseUrl ?? "no URL"} · bucket: {check.bucket ?? "—"}
							</span>
						</>
					)}
				</div>
				<button
					type="button"
					className="btn btn--ghost btn--sm"
					onClick={() => void load()}
					disabled={loading}
				>
					{loading ? "Checking…" : "Re-check"}
				</button>
			</div>

			{check && (
				<div className="muted" style={{ fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}>
					url: {check.sources.SUPABASE_URL} · key: {check.sources.SUPABASE_SERVICE_ROLE_KEY} · bucket: {check.sources.SUPABASE_STORAGE_BUCKET}
				</div>
			)}

			{check && !check.configured && (
				<p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
					No Supabase URL or service-role key resolved — document uploads and downloads are
					disabled. Fill the values below; a row stuck on “Environment” or “Default” usually
					means the stored value could not be decrypted (ENCRYPTION_KEY changed) — re-save it.
				</p>
			)}
			{check?.configured && check.reachable === false && (
				<p className="ops-modal__error" style={{ margin: 0, fontSize: "0.8rem" }}>
					Storage is configured but the bucket did not answer: {check.probeError}
				</p>
			)}
			{error && (
				<p className="ops-modal__error" style={{ margin: 0, fontSize: "0.85rem" }}>
					{error}
				</p>
			)}
		</div>
	);
}
