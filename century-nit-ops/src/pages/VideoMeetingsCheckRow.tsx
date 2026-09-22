import { useCallback, useEffect, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Meeting-provider health — the live answer to "why did the join button
 * fail". Saved credentials only prove a value exists; this row proves the
 * server can actually authenticate against LiveKit / Daily with them. The
 * probe is a read-only API call (list rooms), so a healthy stack answers
 * instantly and a bad secret surfaces here instead of inside a live call.
 */

type ProviderCheck = {
	configured: boolean;
	reachable: boolean | null;
	probeError: string | null;
	sources: Record<string, string>;
};

type VideoCheck = {
	activeProvider: string | null;
	livekit: ProviderCheck & { url: string | null; apiKey: string | null };
	daily: ProviderCheck & { domain: string | null };
};

const PROVIDER_LABELS: Record<string, string> = {
	livekit: "LiveKit (in-app calls)",
	daily: "Daily",
	google_meet: "Google Meet",
};

function pill(label: string, on: boolean | null) {
	return (
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
}

export function VideoMeetingsCheckRow() {
	const [check, setCheck] = useState<VideoCheck | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<VideoCheck>(`${API_PREFIX}/settings/video-check`);
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
				Checking meeting providers…
			</div>
		);
	}

	const providerRow = (
		name: string,
		detail: string,
		p: ProviderCheck,
	) => (
		<div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
			<strong style={{ fontSize: "0.85rem" }}>{name}</strong>
			{p.configured
				? pill(p.reachable ? "Working" : p.reachable === false ? "Credentials rejected" : "Checking…", p.reachable)
				: pill("Not configured", null)}
			<span className="muted mono" style={{ fontSize: "0.75rem" }}>{detail}</span>
			{p.configured && p.reachable === false && p.probeError && (
				<span className="ops-modal__error" style={{ fontSize: "0.78rem" }}>{p.probeError}</span>
			)}
		</div>
	);

	const lk = check?.livekit;
	const dy = check?.daily;
	const anyBroken =
		(lk?.configured && lk.reachable === false) || (dy?.configured && dy.reachable === false);

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
				gap: "0.55rem",
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
					<strong style={{ fontSize: "0.9rem" }}>Meeting providers</strong>
					{check?.activeProvider && (
						<span className="muted mono" style={{ fontSize: "0.75rem" }}>
							active: {PROVIDER_LABELS[check.activeProvider] ?? check.activeProvider}
						</span>
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

			{lk && providerRow(
				"LiveKit",
				`${lk.url ?? "no URL"} · key: ${lk.apiKey ?? "—"}`,
				lk,
			)}
			{dy && providerRow(
				"Daily",
				`domain: ${dy.domain ?? "—"}`,
				dy,
			)}

			{lk?.configured && lk.reachable === false && (
				<p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
					LiveKit rejected the stored credentials — joins will keep failing until the key
					and secret match the project again (cloud.livekit.io → Settings → Keys), or
					clear the LiveKit fields so the next provider takes over.
				</p>
			)}
			{dy?.configured && dy.reachable === false && (
				<p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
					Daily rejected the stored API key — re-check it in dashboard.daily.co →
					Developers → API keys.
				</p>
			)}
			{check && !anyBroken && !lk?.configured && !dy?.configured && (
				<p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
					No token provider is configured — generated rooms fall back to Google Meet
					if a company calendar is connected, otherwise staff paste links by hand.
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
