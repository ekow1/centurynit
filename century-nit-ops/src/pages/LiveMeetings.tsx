import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, bookingsApi } from "century-nit-core/api";
import type { Booking } from "century-nit-shared";

/**
 * Live meetings widget — shows online consultations currently in progress.
 *
 * Reads `GET /bookings/meetings/live`, which returns bookings where
 * `meetingActive` is true (the meeting-status poller flips this when someone
 * joins the Meet space). Auto-refreshes every 60s to match the poller cadence.
 *
 * Used both on the dashboard (compact) and the dedicated `/live-meetings`
 * page (full list). Pass `compact` to render just the count + top 3.
 */
export function LiveMeetings({ compact = false }: { compact?: boolean }) {
	const [meetings, setMeetings] = useState<Booking[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastChecked, setLastChecked] = useState<Date | null>(null);

	const refresh = useCallback(async () => {
		try {
			const res = await bookingsApi.liveMeetings();
			setMeetings(res.bookings);
			setLastChecked(new Date());
			setError(null);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not load live meetings.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const id = setInterval(refresh, 60_000);
		return () => clearInterval(id);
	}, [refresh]);

	if (loading && meetings.length === 0) {
		return (
			<div className="card">
				<h2 className="section-title mb-3">Live Meetings</h2>
				<p className="muted" style={{ fontSize: "var(--text-sm)" }}>Loading…</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="card">
				<h2 className="section-title mb-3">Live Meetings</h2>
				<p className="muted" style={{ fontSize: "var(--text-sm)", color: "var(--danger)" }}>{error}</p>
			</div>
		);
	}

	const shown = compact ? meetings.slice(0, 3) : meetings;

	return (
		<div className="card">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
				<h2 className="section-title" style={{ margin: 0 }}>
					Live Meetings
					{meetings.length > 0 && (
						<span style={{
							marginLeft: "0.5rem",
							background: "var(--success)",
							color: "white",
							borderRadius: "999px",
							padding: "0.1rem 0.5rem",
							fontSize: "var(--text-xs)",
						}}>
							{meetings.length}
						</span>
					)}
				</h2>
				{lastChecked && (
					<span className="muted mono" style={{ fontSize: "var(--text-xs)" }}>
						checked {formatRelative(lastChecked)}
					</span>
				)}
			</div>

			{meetings.length === 0 ? (
				<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
					No meetings in progress right now.
				</p>
			) : (
				<ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
					{shown.map((b) => (
						<LiveMeetingRow key={b.id} booking={b} />
					))}
				</ul>
			)}

			{compact && meetings.length > 3 && (
				<div style={{ marginTop: "1rem" }}>
					<Link to="/live-meetings" className="btn btn--ghost btn--sm">
						View all {meetings.length} →
					</Link>
				</div>
			)}
		</div>
	);
}

function LiveMeetingRow({ booking }: { booking: Booking }) {
	const start = new Date(booking.startsAt);
	const elapsed = Date.now() - start.getTime();
	return (
		<li style={{
			display: "flex",
			justifyContent: "space-between",
			alignItems: "center",
			gap: "1rem",
			padding: "0.75rem",
			background: "var(--muted)",
			borderRadius: "0.5rem",
		}}>
			<div style={{ minWidth: 0, flex: 1 }}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
					<span style={{
						width: "0.5rem",
						height: "0.5rem",
						borderRadius: "999px",
						background: "var(--success)",
						display: "inline-block",
						flexShrink: 0,
					}} aria-hidden />
					<span style={{ fontWeight: 600, fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
						{booking.clientName}
					</span>
				</div>
				<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
					{booking.employeeName ?? "Unassigned"} · started {formatElapsed(elapsed)}
				</span>
			</div>
			{booking.meetingUrl && (
				<a
					href={booking.meetingUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="btn btn--primary btn--sm"
					style={{ whiteSpace: "nowrap", flexShrink: 0 }}
				>
					Join →
				</a>
			)}
		</li>
	);
}

function formatElapsed(ms: number): string {
	if (ms < 0) return "soon";
	const mins = Math.floor(ms / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	const hrs = Math.floor(mins / 60);
	return `${hrs}h ${mins % 60}m ago`;
}

function formatRelative(d: Date): string {
	const secs = Math.floor((Date.now() - d.getTime()) / 1000);
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.floor(secs / 60);
	return `${mins}m ago`;
}
