import { useCallback, useEffect, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Company Google Calendar connect/disconnect card.
 *
 * One company Google account creates every consultation Meet link, so
 * consultants never need to connect their own calendar. The admin starts the
 * OAuth flow here; the backend stores the tokens in platform settings.
 */

interface CompanyStatus {
	connected: boolean;
	accountEmail: string | null;
	calendarId: string | null;
	configured: boolean;
}

export function CompanyGoogleCalendarCard() {
	const [status, setStatus] = useState<CompanyStatus | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

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
		void load();
	}, [load]);

	async function connect() {
		setLoading(true);
		setError(null);
		try {
			// Redirect to the backend consent URL; the backend redirects to Google.
			window.location.href = `${API_PREFIX}/calendar/company/consent`;
		} catch (err) {
			setError(err instanceof ApiError ? err.message : String(err));
			setLoading(false);
		}
	}

	async function disconnect() {
		setLoading(true);
		setError(null);
		try {
			await apiFetch(`${API_PREFIX}/calendar/company/disconnect`, {
				method: "POST",
			});
			setConfirmingDisconnect(false);
			await load();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}

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
						are added as attendees — they never need to connect their own calendar. Configure the
						Google Calendar Client ID, Secret, and Callback URL below first, then click Connect.
					</p>
				</div>
				<span
					className="portal-pill"
					style={{
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
			</div>

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
					Google Calendar Client ID, Secret, and Callback URL are not set. Add them in the
					"Google Calendar" group below before connecting.
				</div>
			)}

			{status.connected && status.accountEmail && (
				<div style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
					<span className="muted">Connected account:</span>{" "}
					<code className="mono">{status.accountEmail}</code>
					{status.calendarId && (
						<>
							{" · "}
							<span className="muted">Calendar:</span>{" "}
							<code className="mono">{status.calendarId}</code>
						</>
					)}
				</div>
			)}

			<div style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
				{status.connected ? (
					confirmingDisconnect ? (
						<>
							<span style={{ fontSize: "0.9rem", alignSelf: "center" }}>
								Disconnect? Existing Meet links stay valid, but no new ones will be created.
							</span>
							<button
								type="button"
								className="btn btn--primary btn--sm"
								onClick={() => void disconnect()}
								disabled={loading}
							>
								{loading ? "Disconnecting…" : "Confirm disconnect"}
							</button>
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={() => setConfirmingDisconnect(false)}
								disabled={loading}
							>
								Cancel
							</button>
						</>
					) : (
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							onClick={() => setConfirmingDisconnect(true)}
						>
							Disconnect
						</button>
					)
				) : (
					<button
						type="button"
						className="btn btn--primary btn--sm"
						onClick={() => void connect()}
						disabled={loading || !status.configured}
						title={!status.configured ? "Add Google Calendar credentials first" : undefined}
					>
						{loading ? "Redirecting…" : "Connect Google Calendar"}
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
	);
}
