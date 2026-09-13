import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOpsNotifications, type OpsNotification } from "../hooks/useOpsNotifications";

/**
 * Inbox — what happened. One feed of the events the API pushes to this
 * user (assignments, stage moves, bookings, documents, payments, leads),
 * grouped by day, unread first by ink not colour. Things *to do* are the
 * Workspace's; this page never re-lists them.
 */

type Category = "assignments" | "cases" | "bookings" | "documents" | "payments" | "leads" | "messages" | "system";
const CATEGORIES: { id: "all" | "unread" | Category; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "unread", label: "Unread" },
	{ id: "assignments", label: "Assignments" },
	{ id: "cases", label: "Cases" },
	{ id: "bookings", label: "Bookings" },
	{ id: "payments", label: "Payments" },
	{ id: "documents", label: "Documents" },
	{ id: "leads", label: "Leads" },
	{ id: "messages", label: "Messages" },
	{ id: "system", label: "System" },
];

/** The event type as the API names it ("stage.changed") → where it files. */
function categoryOf(type: string): Category {
	const t = type.toLowerCase();
	if (/^assignment\.|\.assigned$|needs_handler|awaiting_assignment|handoff/.test(t)) return "assignments";
	if (/^(stage|case|visa|assessment|application)\./.test(t)) return "cases";
	if (/^booking\.|^consultation\./.test(t)) return "bookings";
	if (/^document\./.test(t)) return "documents";
	if (/^(payment|invoice|finance|agency)\b/.test(t)) return "payments";
	if (/^lead\./.test(t)) return "leads";
	if (/^chat\./.test(t)) return "messages";
	return "system";
}

const KICKERS: Record<string, string> = {
	"case.assigned": "Owner assigned · Case",
	"consultation.assigned": "Assigned · Consultation",
	"booking.assigned": "Assigned · Booking",
	"assignment.released": "Owner released · Case",
	"assignment.handoff_resolved": "Handoff resolved · Case",
	"stage.needs_handler": "Needs a handler · Stage",
	"application.awaiting_assignment": "Awaiting assignment · Case",
	"stage.changed": "Stage moved · Case",
	"visa.stage_changed": "Visa · Stage moved",
	"case.updated": "Updated · Case",
	"assessment.complete": "Assessment complete · Consultation",
	"booking.new": "New booking",
	"booking.rescheduled": "Rescheduled · Booking",
	"booking.cancelled": "Cancelled · Booking",
	"booking.slot_confirmed": "Slot confirmed · Booking",
	"booking.meeting_link": "Meeting link · Booking",
	"document.uploaded": "Uploaded · Document",
	"document.requested": "Requested · Document",
	"lead.new": "New lead",
	"chat.message": "Message",
	"roles.changed": "Roles changed · System",
	"email.failed": "Email failed · System",
};
function kickerOf(type: string): string {
	if (KICKERS[type]) return KICKERS[type];
	const [head, ...rest] = type.split(".");
	const tail = rest.join(" ").replace(/_/g, " ");
	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
	return tail ? `${cap(tail)} · ${cap(head)}` : cap(head);
}

const hm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Today · Yesterday · Earlier this week · a dated group beyond that. */
function dayGroup(iso: string, now: Date): { key: string; label: string; order: number } {
	const d = new Date(iso);
	if (sameDay(d, now)) return { key: "today", label: `Today · ${now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`, order: 0 };
	const y = new Date(now);
	y.setDate(y.getDate() - 1);
	if (sameDay(d, y)) return { key: "yesterday", label: "Yesterday", order: 1 };
	if (now.getTime() - d.getTime() < 7 * 86_400_000) return { key: "week", label: "Earlier this week", order: 2 };
	const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
	return { key: `m-${d.getFullYear()}-${d.getMonth()}`, label, order: 3 + (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) };
}

function whenLabel(iso: string, now: Date): string {
	const d = new Date(iso);
	if (sameDay(d, now)) return hm(iso);
	if (now.getTime() - d.getTime() < 7 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + hm(iso);
	return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function linkLabel(n: OpsNotification): string {
	const c = categoryOf(n.type);
	if (c === "documents") return "Review →";
	if (c === "payments") return "Ledger →";
	if (c === "messages") return "Reply →";
	return "Open →";
}

export function EnterpriseInbox() {
	const { notifications, unreadCount, markRead, markAllRead } = useOpsNotifications();
	const [chip, setChip] = useState<"all" | "unread" | Category>("all");
	const [search, setSearch] = useState("");
	const navigate = useNavigate();
	const now = new Date();

	const counts = useMemo(() => {
		const c: Record<string, number> = { all: notifications.length, unread: unreadCount };
		for (const n of notifications) {
			const k = categoryOf(n.type);
			c[k] = (c[k] ?? 0) + 1;
		}
		return c;
	}, [notifications, unreadCount]);

	const todayCount = notifications.filter((n) => sameDay(new Date(n.createdAt), now)).length;

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return notifications.filter((n) => {
			if (chip === "unread" && n.read) return false;
			if (chip !== "all" && chip !== "unread" && categoryOf(n.type) !== chip) return false;
			if (q && !`${n.title} ${n.body} ${n.type}`.toLowerCase().includes(q)) return false;
			return true;
		});
	}, [notifications, chip, search]);

	const groups = useMemo(() => {
		const map = new Map<string, { label: string; order: number; rows: OpsNotification[] }>();
		for (const n of filtered) {
			const g = dayGroup(n.createdAt, now);
			const cur = map.get(g.key) ?? { label: g.label, order: g.order, rows: [] };
			cur.rows.push(n);
			map.set(g.key, cur);
		}
		return [...map.values()].sort((a, b) => a.order - b.order);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is this render's clock
	}, [filtered]);

	function open(n: OpsNotification) {
		if (!n.read) void markRead(n.id);
		if (n.link) navigate(n.link);
	}

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Inbox</h1>
					<p className="lead mt-2">What happened — assignments, moves, bookings, payments, documents. Things to do live in the Workspace.</p>
				</div>
				{unreadCount > 0 && (
					<button type="button" className="btn btn--ghost btn--sm" onClick={() => void markAllRead()}>
						Mark all read
					</button>
				)}
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{unreadCount}</strong> <span className="dash-day__date">unread</span>
				</span>
				<span>
					<strong>{todayCount}</strong> <span className="dash-day__date">today</span>
				</span>
				<span>
					<strong>{notifications.length}</strong> <span className="dash-day__date">kept</span>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/workspace" className="dash-link">
					Open the Worklist →
				</Link>
			</div>

			<div className="cn-scaffold__filters" style={{ border: "1px solid var(--border-light)" }}>
				<div className="cn-scaffold__chips" role="tablist" aria-label="Inbox">
					{CATEGORIES.map((c) => {
						const n = counts[c.id] ?? 0;
						if (n === 0 && c.id !== "all" && c.id !== "unread") return null;
						const on = chip === c.id;
						return (
							<button
								key={c.id}
								type="button"
								role="tab"
								aria-selected={on}
								className="ops-pill"
								onClick={() => setChip(c.id)}
								style={{
									cursor: "pointer",
									marginLeft: 0,
									border: "1px solid var(--border)",
									background: on ? "var(--foreground)" : "transparent",
									color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
									fontWeight: c.id === "unread" && n > 0 && !on ? 700 : 500,
								}}
							>
								{c.label}
								<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
									{n}
								</span>
							</button>
						);
					})}
				</div>
				<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
					<input type="search" className="cn-search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search notifications" style={{ flex: "1 1 14rem", width: "auto" }} />
				</div>
			</div>

			<div className="ops-inbox">
				{groups.length === 0 ? (
					<p className="ops-people__empty">{notifications.length === 0 ? "Nothing yet — events land here as they happen." : "Nothing matches."}</p>
				) : (
					groups.map((g) => (
						<div key={g.label}>
							<div className="ops-inbox__day">
								<span>{g.label}</span>
								<span className="ops-inbox__day-n">{g.rows.length}</span>
							</div>
							{g.rows.map((n) => (
								<div
									key={n.id}
									className={`ops-ib${n.read ? " ops-ib--read" : " ops-ib--unread"}`}
									role={n.link ? "button" : undefined}
									tabIndex={n.link ? 0 : undefined}
									onClick={() => open(n)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											open(n);
										}
									}}
								>
									<span className={`ops-ib__mark${n.read ? " ops-ib__mark--read" : ""}`} aria-hidden />
									<div style={{ minWidth: 0 }}>
										<div className="ops-ib__kicker">{kickerOf(n.type)}</div>
										<div className="ops-ib__title">{n.title}</div>
										{n.body && <div className="ops-ib__body">{n.body}</div>}
									</div>
									<div className="ops-ib__side">
										<span className="ops-ib__when" title={new Date(n.createdAt).toLocaleString()}>
											{whenLabel(n.createdAt, now)}
										</span>
										{n.link ? (
											<span className="dash-link">{linkLabel(n)}</span>
										) : !n.read ? (
											<button
												type="button"
												className="dash-link"
												style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}
												onClick={(e) => {
													e.stopPropagation();
													void markRead(n.id);
												}}
											>
												Mark read
											</button>
										) : null}
									</div>
								</div>
							))}
						</div>
					))
				)}
			</div>
		</div>
	);
}
