import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, bookingsApi } from "century-nit-core/api";
import { occupiesSlot, type Booking } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { useJoinMeeting } from "./case/ConsultationCall";
import { useUrlParam } from "../hooks/useUrlParam";
import { useNow } from "../hooks/useNow";

/**
 * Calls today — the live-meetings board.
 *
 * One fetch of today's bookings, banded three ways: what's running now
 * (`meetingActive` — the meeting-status poller flips it when someone joins),
 * what's still ahead of us, and what already wrapped. A booking whose slot
 * ended with nobody ever joining reads as a likely no-show — an inference,
 * labelled as one.
 *
 * The dashboard still gets the compact widget: count + top 3 live.
 */
export function LiveMeetings({ compact = false }: { compact?: boolean }) {
	const { canSeeAllBranches } = useOpsAuth();
	const [branchFilter, setBranchFilter] = useUrlParam("branch");
	const [meetings, setMeetings] = useState<Booking[]>([]);
	const [dayBookings, setDayBookings] = useState<Booking[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastChecked, setLastChecked] = useState<Date | null>(null);
	const now = useNow();

	const refresh = useCallback(async () => {
		const scope = branchFilter ? { branchId: branchFilter } : undefined;
		try {
			const [live, day] = await Promise.all([
				bookingsApi.liveMeetings(scope),
				compact ? Promise.resolve({ bookings: [] as Booking[], total: 0 }) : bookingsApi.list(scope),
			]);
			setMeetings(live.bookings);
			setDayBookings(day.bookings);
			setLastChecked(new Date());
			setError(null);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not load live meetings.");
		} finally {
			setLoading(false);
		}
	}, [branchFilter, compact]);

	useEffect(() => {
		void refresh();
		const id = setInterval(refresh, 60_000);
		return () => clearInterval(id);
	}, [refresh]);

	// Today's bookings, banded. `live` leads the page even when its slot date
	// isn't today — a running call is a running call.
	const bands = useMemo(() => {
		const dayKey = new Date().toDateString();
		const today = dayBookings.filter((b) => new Date(b.startsAt).toDateString() === dayKey);
		const liveIds = new Set(meetings.map((b) => b.id));
		const next = today
			.filter((b) => occupiesSlot(b.status) && new Date(b.endsAt).getTime() > now && !liveIds.has(b.id))
			.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
		const wrapped = today
			.filter((b) => !occupiesSlot(b.status) || new Date(b.endsAt).getTime() <= now)
			.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
		const live = [...meetings].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
		return { live, next, wrapped };
	}, [meetings, dayBookings, now]);

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

	if (compact) {
		const shown = meetings.slice(0, 3);
		return (
			<div className="card">
				<BoardHead meetings={meetings.length} lastChecked={lastChecked} canSeeAllBranches={canSeeAllBranches} branchFilter={branchFilter} onBranch={setBranchFilter} />
				{meetings.length === 0 ? (
					<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No meetings in progress right now.</p>
				) : (
					<ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
						{shown.map((b) => <LiveMeetingRow key={b.id} booking={b} now={now} />)}
					</ul>
				)}
				{meetings.length > 3 && (
					<div style={{ marginTop: "1rem" }}>
						<Link to="/live-meetings" className="btn btn--ghost btn--sm">View all {meetings.length} →</Link>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="fade-in">
			<div className="hdr-row">
				<div>
					<h1 className="page-title">Calls today</h1>
					<p className="lead mt-1">What's running, what's next, what already wrapped — and who never showed.</p>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
					{lastChecked && <span className="muted mono" style={{ fontSize: "var(--text-xs)" }}>checked {formatRelative(lastChecked)}</span>}
					{canSeeAllBranches && <BranchScopeFilter value={branchFilter || "all"} onChange={(v) => setBranchFilter(v === "all" ? null : v)} />}
					<button type="button" className="btn btn--sm btn--ghost" onClick={() => void refresh()} title="Refresh">↻</button>
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span className="dash-day__cut"><strong>{bands.live.length}</strong> live now</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{bands.next.length}</strong> still to come</span>
				<span className="dash-day__sep">·</span>
				<span className="dash-day__cut"><strong>{bands.wrapped.length}</strong> wrapped</span>
				{bands.wrapped.some(isLikelyNoShow) && (
					<>
						<span className="dash-day__sep">·</span>
						<span className="dash-day__cut"><strong>{bands.wrapped.filter(isLikelyNoShow).length}</strong> likely no-show</span>
					</>
				)}
			</div>

			<Band title="Live now" empty="No calls running right now.">
				{bands.live.map((b) => <LiveMeetingRow key={b.id} booking={b} now={now} />)}
			</Band>

			<Band title="Up next" empty="Nothing else scheduled today.">
				{bands.next.map((b) => <UpNextRow key={b.id} booking={b} now={now} />)}
			</Band>

			<Band title="Wrapped" empty="Nothing finished yet today.">
				{bands.wrapped.map((b) => <WrappedRow key={b.id} booking={b} now={now} />)}
			</Band>
		</div>
	);
}

function BoardHead({
	meetings,
	lastChecked,
	canSeeAllBranches,
	branchFilter,
	onBranch,
}: {
	meetings: number;
	lastChecked: Date | null;
	canSeeAllBranches: boolean;
	branchFilter: string;
	onBranch: (v: string) => void;
}) {
	return (
		<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
			<h2 className="section-title" style={{ margin: 0 }}>
				Live Meetings
				{meetings > 0 && (
					<span style={{ marginLeft: "0.5rem", background: "var(--success)", color: "white", borderRadius: "999px", padding: "0.1rem 0.5rem", fontSize: "var(--text-xs)" }}>
						{meetings}
					</span>
				)}
			</h2>
			<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
				{lastChecked && <span className="muted mono" style={{ fontSize: "var(--text-xs)" }}>checked {formatRelative(lastChecked)}</span>}
				{canSeeAllBranches && <BranchScopeFilter value={branchFilter || "all"} onChange={(v) => onBranch(v === "all" ? "" : v)} />}
			</div>
		</div>
	);
}

function Band({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
	return (
		<section style={{ marginBottom: "1.5rem" }}>
			<h2 className="section-title" style={{ marginBottom: "0.5rem" }}>{title}</h2>
			{children.length === 0 ? (
				<p className="muted" style={{ fontSize: "var(--text-sm)" }}>{empty}</p>
			) : (
				<ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
					{children}
				</ul>
			)}
		</section>
	);
}

/** The slot ended, nobody ever joined, and it was never marked complete. */
function isLikelyNoShow(b: Booking): boolean {
	return occupiesSlot(b.status) && new Date(b.endsAt).getTime() <= Date.now() && b.meetingParticipants === 0 && !b.meetingActive;
}

function LiveMeetingRow({ booking: b, now }: { booking: Booking; now: number }) {
	const { join, joining, error: joinError, overlay } = useJoinMeeting();
	const start = new Date(b.startsAt).getTime();
	const end = new Date(b.endsAt).getTime();
	const pct = Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100));
	return (
		<li style={{ padding: "0.75rem", background: "var(--muted)", borderRadius: "0.5rem" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
				<div style={{ minWidth: 0, flex: 1 }}>
					<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
						<span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "999px", background: "var(--success)", display: "inline-block", flexShrink: 0 }} aria-hidden />
						<span style={{ fontWeight: 600, fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
							{b.clientName}
						</span>
						{b.meetingParticipants > 0 && (
							<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>{b.meetingParticipants} in</span>
						)}
					</div>
					<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
						host {b.employeeName ?? "unassigned"} · running {formatElapsed(now - start)}
						{b.meetingProvider ? ` · ${b.meetingProvider}` : ""}
					</span>
				</div>
				{b.meetingUrl || b.meetingProvider ? (
					<button
						type="button"
						disabled={joining}
						onClick={() => void join(b.id, `Consultation · ${b.reference ?? b.clientName}`)}
						className="btn btn--primary btn--sm"
						style={{ whiteSpace: "nowrap", flexShrink: 0 }}
					>
						{joining ? "Joining…" : "Join →"}
					</button>
				) : null}
			</div>
			{/* elapsed through the booked window */}
			<div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Elapsed in the booked slot"
				style={{ marginTop: "0.5rem", height: "3px", background: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
				<div style={{ width: `${pct}%`, height: "100%", background: "var(--foreground)", transition: "width 15s linear" }} />
			</div>
			{joinError && <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{joinError}</span>}
			{overlay}
		</li>
	);
}

function UpNextRow({ booking: b, now }: { booking: Booking; now: number }) {
	const { join, joining, error: joinError, overlay } = useJoinMeeting();
	const start = new Date(b.startsAt);
	const startsIn = start.getTime() - now;
	const late = startsIn < 0; // in-window but nobody joined yet
	return (
		<li style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", padding: "0.75rem", border: "1px solid var(--border-light)", borderRadius: "0.5rem" }}>
			<div style={{ minWidth: 0, flex: 1 }}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
					<span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{b.clientName}</span>
					<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
						{start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
					</span>
				</div>
				<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
					{b.employeeName ?? "unassigned"} · {b.durationMinutes}m · {b.type === "online" ? `◉ ${b.meetingProvider ?? "online"}` : "◎ in person"}
					{late ? " · slot started — nobody in yet" : ` · starts ${formatElapsed(startsIn)}`}
				</span>
			</div>
			<div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
				<Link to="/consultations" className="btn btn--ghost btn--sm">Prep →</Link>
				<button
					type="button"
					disabled={joining}
					onClick={() => void join(b.id, `Consultation · ${b.reference ?? b.clientName}`)}
					className="btn btn--sm"
					style={{ whiteSpace: "nowrap" }}
				>
					{joining ? "…" : late ? "Join →" : "Join"}
				</button>
			</div>
			{joinError && <span className="muted" style={{ fontSize: "var(--text-xs)" }}>{joinError}</span>}
			{overlay}
		</li>
	);
}

function WrappedRow({ booking: b }: { booking: Booking; now: number }) {
	const noShow = isLikelyNoShow(b);
	const statusLabel =
		b.status === "COMPLETED" ? "completed" :
		b.status === "NO_SHOW" ? "no-show" :
		b.status === "CANCELLED" ? "cancelled" :
		noShow ? "likely no-show" : "ended";
	return (
		<li style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border-light)" }}>
			<div style={{ minWidth: 0, flex: 1 }}>
				<span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{b.clientName}</span>
				<span className="muted" style={{ fontSize: "var(--text-xs)", marginLeft: "0.6rem" }}>
					{new Date(b.startsAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
					{" · "}{b.employeeName ?? "unassigned"}
					{b.meetingParticipants > 0 ? ` · ${b.meetingParticipants} joined` : ""}
				</span>
			</div>
			<span
				className="portal-pill"
				style={noShow ? { textDecoration: "underline", textDecorationThickness: 2, fontWeight: 700 } : undefined}
				title={noShow ? "Slot ended, nobody joined, still not marked complete — probably a no-show" : undefined}
			>
				{statusLabel}
			</span>
		</li>
	);
}

function formatElapsed(ms: number): string {
	if (ms < 0) {
		const mins = Math.ceil(-ms / 60_000);
		if (mins < 60) return `in ${mins} min`;
		const hrs = Math.floor(mins / 60);
		return `in ${hrs}h ${mins % 60}m`;
	}
	const mins = Math.floor(ms / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min`;
	const hrs = Math.floor(mins / 60);
	return `${hrs}h ${mins % 60}m`;
}

function formatRelative(d: Date): string {
	const secs = Math.floor((Date.now() - d.getTime()) / 1000);
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.floor(secs / 60);
	return `${mins}m ago`;
}
