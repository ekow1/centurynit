import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../../context/AppState";
import type { AppNotification } from "century-nit-core";

type NotifCategory = "money" | "docs" | "chat" | "journey";
type IconKind = NotifCategory | "visa" | "default";
type Filter = "all" | "unread" | NotifCategory;

/**
 * Server types arrive raw (`invoice_issued`, `chat.reply`, `visa.stage_changed`)
 * even though AppNotification declares a narrow union. Normalise `_` to `.`
 * and match on prefixes so real payloads land in the right bucket.
 */
function notifCategory(type: string): NotifCategory {
	const t = type.replace(/_/g, ".");
	if (t.startsWith("invoice") || t.startsWith("payment") || t.startsWith("receipt")) return "money";
	if (t.startsWith("document")) return "docs";
	if (t.startsWith("chat") || t === "message" || t === "support") return "chat";
	return "journey";
}

function iconKind(type: string): IconKind {
	const t = type.replace(/_/g, ".");
	if (t.startsWith("visa")) return "visa";
	if (!t) return "default";
	return notifCategory(type);
}

const FILTERS: { id: Filter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "unread", label: "Unread" },
	{ id: "money", label: "Money" },
	{ id: "docs", label: "Docs" },
	{ id: "journey", label: "Journey" },
	{ id: "chat", label: "Messages" },
];

const DAY_ORDER = ["Today", "Yesterday", "Earlier"] as const;

function dayGroup(at: string): (typeof DAY_ORDER)[number] {
	const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const diff = day(new Date()) - day(new Date(at));
	if (diff <= 0) return "Today";
	if (diff <= 86_400_000) return "Yesterday";
	return "Earlier";
}

function relTime(at: string): string {
	const then = new Date(at).getTime();
	if (Number.isNaN(then)) return "";
	const mins = Math.floor((Date.now() - then) / 60_000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "Yesterday";
	if (days < 7) return new Date(then).toLocaleDateString([], { weekday: "short" });
	return new Date(then).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Where the notification takes you, derived from its link + type. */
function actionLabel(n: AppNotification): string | null {
	const link = n.link ?? "";
	const t = n.type.replace(/_/g, ".");
	if (link.includes("chat=") || t.startsWith("chat") || t === "message") return "Reply →";
	if (link.includes("/financial")) {
		if (t.startsWith("invoice")) {
			return t.includes("issued") || t.includes("created") ? "Pay now →" : "View invoice →";
		}
		return "View receipt →";
	}
	if (link.includes("/documents")) return "Open documents →";
	if (link.includes("/tracking")) return "Track →";
	if (link.includes("/consultation")) return "View booking →";
	if (link.includes("/application")) return "Open case →";
	if (link.includes("/pre-departure")) return "Checklist →";
	if (link.includes("/travel")) return "Details →";
	if (link) return "Open →";
	return null;
}

function NotifIcon({ kind }: { kind: IconKind }) {
	const common = {
		width: 13,
		height: 13,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
	};

	switch (kind) {
		case "money":
			return (
				<svg {...common}>
					<rect x="2" y="5" width="20" height="14" />
					<line x1="2" y1="10" x2="22" y2="10" />
				</svg>
			);
		case "docs":
			return (
				<svg {...common}>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
				</svg>
			);
		case "chat":
			return (
				<svg {...common}>
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
				</svg>
			);
		case "visa":
			return (
				<svg {...common}>
					<circle cx="12" cy="12" r="10" />
					<path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10z" />
				</svg>
			);
		case "journey":
			return (
				<svg {...common}>
					<path d="M12 2L2 7l10 5 10-5-10-5z" />
					<path d="M2 17l10 5 10-5" />
					<path d="M2 12l10 5 10-5" />
				</svg>
			);
		default:
			return (
				<svg {...common}>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
			);
	}
}

export function NotificationBell() {
	const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead, pushPermission, pushSubscribe, pushUnsubscribe } =
		useAppState();
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState<Filter>("all");
	const ref = useRef<HTMLDivElement>(null);
	const nav = useNavigate();

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) {
			document.addEventListener("mousedown", handleClickOutside);
			return () => document.removeEventListener("mousedown", handleClickOutside);
		}
	}, [open]);

	const counts = useMemo(() => {
		const c: Record<NotifCategory | "unread", number> = { unread: 0, money: 0, docs: 0, journey: 0, chat: 0 };
		for (const n of notifications) {
			if (!n.read) c.unread += 1;
			c[notifCategory(n.type)] += 1;
		}
		return c;
	}, [notifications]);

	const filtered = useMemo(() => {
		if (filter === "all") return notifications;
		if (filter === "unread") return notifications.filter((n) => !n.read);
		return notifications.filter((n) => notifCategory(n.type) === filter);
	}, [notifications, filter]);

	function normalizeLink(link: string): string {
		// /portal/support was removed. Support is now the floating chat on /portal/home.
		if (link === "/portal/chat" || link === "/portal/support") return "/portal/home";
		return link;
	}

	function handleNotifClick(id: string, link?: string) {
		markNotificationRead(id);
		setOpen(false);
		if (link === "/portal/chat" || link === "/portal/support") {
			const channel = link === "/portal/support" ? "support" : "officer";
			window.dispatchEvent(new CustomEvent("open-chat", { detail: { channel } }));
		}
		if (link) nav(normalizeLink(link));
	}

	const pushOn = pushPermission === "granted";
	const pushCopy = (() => {
		if (pushOn) return { strong: "Browser alerts on.", rest: "You will be alerted even when this tab is closed." };
		if (pushPermission === "denied") return { strong: "Alerts blocked.", rest: "Allow notifications in the browser's site settings to turn them on." };
		if (pushPermission === "unsupported") return { strong: "Not supported.", rest: "This browser cannot show notifications." };
		return { strong: "Browser alerts off.", rest: "Get a notification even when this tab is closed." };
	})();

	return (
		<div ref={ref} className="notif" style={{ position: "relative" }}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				style={{
					cursor: "pointer",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: "40px",
					height: "40px",
					background: open ? "#f4f4f5" : "transparent",
					border: "none",
					borderRadius: 0,
					color: "#18181b",
					transition: "background 0.2s ease",
					position: "relative",
				}}
				aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
				onMouseEnter={(e) => {
					if (!open) e.currentTarget.style.background = "#f4f4f5";
				}}
				onMouseLeave={(e) => {
					if (!open) e.currentTarget.style.background = "transparent";
				}}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
					<path d="M13.73 21a2 2 0 0 1-3.46 0" />
				</svg>
				{unreadCount > 0 ? (
					<span
						style={{
							position: "absolute",
							top: "2px",
							right: "2px",
							background: "#18181b",
							color: "#ffffff",
							fontSize: "0.6rem",
							fontWeight: 700,
							padding: "0.15rem 0.35rem",
							borderRadius: 0,
							minWidth: "16px",
							textAlign: "center",
							lineHeight: 1,
							fontFamily: "var(--font-mono)",
							border: "2px solid #ffffff",
						}}
					>
						{unreadCount}
					</span>
				) : null}
			</button>

			{open ? (
				<div
					className="notif__panel"
					style={{
						position: "absolute",
						top: "calc(100% + 0.75rem)",
						right: 0,
						width: "400px",
						maxHeight: "520px",
						overflowY: "auto",
						background: "#ffffff",
						border: "1px solid #e4e4e7",
						boxShadow: "0 10px 40px -10px rgba(0,0,0,0.15)",
						zIndex: 100,
						borderRadius: 0,
						fontFamily: "var(--font-display)",
					}}
				>
					<div className="notif-panel__head">
						<p className="notif-panel__title">
							Notifications
							<span className="notif-panel__chip">
								{unreadCount > 0 ? `${unreadCount} unread` : "all read"}
							</span>
						</p>
						{unreadCount > 0 ? (
							<button type="button" className="notif-panel__link" onClick={markAllNotificationsRead}>
								Mark all read
							</button>
						) : null}
					</div>

					<div className="notif-panel__filters">
						{FILTERS.map((f) => {
							const count = f.id === "all" ? 0 : counts[f.id] ?? 0;
							return (
								<button
									key={f.id}
									type="button"
									className={`notif-panel__filter${filter === f.id ? " notif-panel__filter--on" : ""}`}
									onClick={() => setFilter(f.id)}
								>
									{f.label}
									{count > 0 ? <span className="notif-panel__fnum">{count}</span> : null}
								</button>
							);
						})}
					</div>

					{filtered.length === 0 ? (
						<div className="notif-panel__empty">
							{filter === "unread" ? "Nothing unread." : "Nothing here."}
						</div>
					) : (
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{DAY_ORDER.map((day) => {
								const rows = filtered.filter((n) => dayGroup(n.at) === day).slice(0, 25);
								if (rows.length === 0) return null;
								return (
									<li key={day}>
										<p className="notif-panel__day">{day}</p>
										<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
											{rows.map((n) => {
												const act = actionLabel(n);
												return (
													<li key={n.id}>
														<div
															className={`notif-item ${n.read ? "notif-item--read" : "notif-item--unread"}`}
															onClick={() => handleNotifClick(n.id, n.link)}
														>
															<span className="notif-item__ic">
																<NotifIcon kind={iconKind(n.type)} />
															</span>
															<div style={{ flex: 1, minWidth: 0 }}>
																<p className="notif-item__t">{n.title}</p>
																{n.body ? <p className="notif-item__b">{n.body}</p> : null}
																<div className="notif-item__meta">
																	<span className="notif-item__when">{relTime(n.at)}</span>
																	{act ? <span className="notif-item__act">{act}</span> : null}
																</div>
															</div>
															{!n.read ? (
																<button
																	type="button"
																	className="notif-item__tick"
																	onClick={(e) => {
																		e.stopPropagation();
																		markNotificationRead(n.id);
																	}}
																>
																	read
																</button>
															) : null}
														</div>
													</li>
												);
											})}
										</ul>
									</li>
								);
							})}
						</ul>
					)}

					<div className="notif-panel__push">
						<span className={`notif-panel__dot ${pushOn ? "notif-panel__dot--on" : "notif-panel__dot--off"}`} />
						<p>
							<strong>{pushCopy.strong}</strong> {pushCopy.rest}
						</p>
						{pushPermission === "granted" || pushPermission === "default" ? (
							<button
								type="button"
								className="notif-panel__link"
								onClick={() => (pushOn ? void pushUnsubscribe() : void pushSubscribe())}
							>
								{pushOn ? "Turn off" : "Turn on"}
							</button>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
