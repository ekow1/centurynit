import { useCallback, useEffect, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Company Google Calendar — connect/disconnect.
 *
 * One company Google account creates every consultation Meet link, so
 * consultants never need to connect their own calendar. The admin starts the
 * OAuth flow here; the backend stores the tokens in platform settings.
 *
 * `CompanyConnectRow` is the compact version inlined into the "Google Calendar"
 * settings group. `CompanyGoogleCalendarCard` is the standalone full card.
 */

interface CompanyStatus {
	connected: boolean;
	accountEmail: string | null;
	calendarId: string | null;
	configured: boolean;
}

function useCompanyStatus() {
	const [status, setStatus] = useState<CompanyStatus | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);

	const load = useCallback(async () => {
		setError(null);
		try {
			const res = await apiFetch<CompanyStatus>(`${API_PREFIX}/calendar/company/status`);
			setStatus(res);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("google_connected") === "1") {
			const email = params.get("email");
			setSuccessMsg(email ? `Connected as ${email}` : "Company Google account connected successfully!");
			params.delete("google_connected");
			params.delete("email");
			const cleanQuery = params.toString() ? `?${params.toString()}` : "";
			window.history.replaceState({}, "", `${window.location.pathname}${cleanQuery}`);
		}
		void load();
	}, [load]);

	async function disconnect() {
		setLoading(true);
		setError(null);
		setSuccessMsg(null);
		try {
			await apiFetch(`${API_PREFIX}/calendar/company/disconnect`, { method: "POST" });
			await load();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}

	function connect() {
		setLoading(true);
		window.location.href = `${API_PREFIX}/calendar/company/consent`;
	}

	return { status, loading, error, successMsg, load, connect, disconnect };
}

/**
 * Compact connect/disconnect row for inlining inside the "Google Calendar"
 * settings group card. Shows status pill, account email, and the action
 * buttons — no duplicate credentials, no separate card.
 */
export function CompanyConnectRow() {
	const { status, loading, error, successMsg, load, connect, disconnect } = useCompanyStatus();
	const [confirming, setConfirming] = useState(false);

	if (!status) {
		return (
			<div style={{ marginBottom: "1rem", fontSize: "0.85rem" }} className="muted">
				Loading company connection…
			</div>
		);
	}

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
					<strong style={{ fontSize: "0.9rem" }}>Company Google account</strong>
					<span
						style={{
							fontSize: "0.75rem",
							padding: "0.15rem 0.5rem",
							borderRadius: "999px",
							background: status.connected
								? "var(--success-bg, #ecfdf5)"
								: "var(--warn-bg, #fffbeb)",
							color: status.connected
								? "var(--success-fg, #065f46)"
								: "var(--warn-fg, #92400e)",
							border: `1px solid ${status.connected ? "var(--success-fg, #065f46)" : "var(--warn-fg, #92400e)"}`,
						}}
					>
						{status.connected ? "Connected" : "Not connected"}
					</span>
					{status.connected && status.accountEmail && (
						<span className="muted" style={{ fontSize: "0.85rem" }}>
							<code className="mono">{status.accountEmail}</code>
						</span>
					)}
				</div>
				<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
					{status.connected ? (
						confirming ? (
							<>
								<button
									type="button"
									className="btn btn--primary btn--sm"
									onClick={() => void disconnect()}
									disabled={loading}
								>
									{loading ? "Disconnecting…" : "Confirm"}
								</button>
								<button
									type="button"
									className="btn btn--ghost btn--sm"
									onClick={() => setConfirming(false)}
									disabled={loading}
								>
									Cancel
								</button>
							</>
						) : (
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={() => setConfirming(true)}
							>
								Disconnect
							</button>
						)
					) : (
						<button
							type="button"
							className="btn btn--primary btn--sm"
							onClick={() => connect()}
							disabled={loading || !status.configured}
							title={!status.configured ? "Add the Client ID, Secret, and Callback URL above first" : undefined}
						>
							{loading ? "Redirecting…" : "Connect"}
						</button>
					)}
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						onClick={() => void load()}
						disabled={loading}
					>
						Refresh
					</button>
				</div>
			</div>

			{!status.configured && (
				<p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
					Set the Client ID, Secret, and Callback URL in the table below, then click Connect.
				</p>
			)}

			{successMsg && (
				<p style={{ margin: 0, fontSize: "0.85rem", color: "var(--success-fg, #065f46)", fontWeight: 500 }}>
					✓ {successMsg}
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

/** Standalone full card. Kept for placements outside the settings group. */
export function CompanyGoogleCalendarCard() {
	const { status, loading, error, successMsg, load, connect, disconnect } = useCompanyStatus();
	const [confirming, setConfirming] = useState(false);

	if (!status) {
		return (
			<div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
				<p className="muted">Loading company Google Calendar status…</p>
			</div>
		);
	}

	return (
		<div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
				<div>
					<h3 className="section-title" style={{ fontSize: "1.1rem", margin: 0 }}>
						Company Google Calendar
					</h3>
					<p className="muted" style={{ marginTop: "0.4rem", fontSize: "0.9rem", maxWidth: "40rem" }}>
						One company Google account creates every consultation Google Meet link. Consultants
						are added as attendees — they never need to connect their own calendar.
					</p>
				</div>
				<span
					style={{
						background: status.connected ? "var(--success-bg, #ecfdf5)" : "var(--warn-bg, #fffbeb)",
						color: status.connected ? "var(--success-fg, #065f46)" : "var(--warn-fg, #92400e)",
						border: `1px solid ${status.connected ? "var(--success-fg, #065f46)" : "var(--warn-fg, #92400e)"}`,
						padding: "0.2rem 0.6rem",
						borderRadius: "999px",
						fontSize: "0.8rem",
					}}
				>
					{status.connected ? "Connected" : "Not connected"}
				</span>
			</div>

			{successMsg && (
				<div
					style={{
						marginTop: "1rem",
						padding: "0.75rem 1rem",
						background: "var(--success-bg, #ecfdf5)",
						border: "1px solid var(--success-fg, #065f46)",
						borderRadius: "6px",
						fontSize: "0.85rem",
						color: "var(--success-fg, #065f46)",
						fontWeight: 500,
					}}
				>
					✓ {successMsg}
				</div>
			)}

			{error && (
				<div className="ops-modal__error" style={{ marginTop: "1rem" }}>
					{error}
				</div>
			)}

			{!status.configured && (
				<div
					style={{
						marginTop: "1rem",
						padding: "0.75rem 1rem",
						background: "var(--warn-bg, #fffbeb)",
						border: "1px solid var(--warn-fg, #92400e)",
						borderRadius: "6px",
						fontSize: "0.85rem",
						color: "var(--warn-fg, #92400e)",
					}}
				>
					Google Calendar Client ID, Secret, and Callback URL are not set.
				</div>
			)}

			{status.connected && status.accountEmail && (
				<div style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
					<span className="muted">Connected account:</span>{" "}
					<code className="mono">{status.accountEmail}</code>
				</div>
			)}

			<div style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
				{status.connected ? (
					confirming ? (
						<>
							<button type="button" className="btn btn--primary btn--sm" onClick={() => void disconnect()} disabled={loading}>
								{loading ? "Disconnecting…" : "Confirm disconnect"}
							</button>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(false)} disabled={loading}>
								Cancel
							</button>
						</>
					) : (
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(true)}>
							Disconnect
						</button>
					)
				) : (
					<button
						type="button"
						className="btn btn--primary btn--sm"
						onClick={() => connect()}
						disabled={loading || !status.configured}
					>
						{loading ? "Redirecting…" : "Connect Google Calendar"}
					</button>
				)}
				<button type="button" className="btn btn--ghost btn--sm" onClick={() => void load()} disabled={loading}>
					Refresh
				</button>
			</div>
		</div>
	);
}
