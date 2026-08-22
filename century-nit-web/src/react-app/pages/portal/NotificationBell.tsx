import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../../context/AppState";

function NotifIcon({ type, read }: { type: string; read: boolean }) {
	const opacity = read ? 0.4 : 1;
	const common = {
		width: 16,
		height: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
		style: { opacity, flexShrink: 0 },
	};

	switch (type) {
		case "stage":
			return (
				<svg {...common}>
					<path d="M12 2L2 7l10 5 10-5-10-5z" />
					<path d="M2 17l10 5 10-5" />
					<path d="M2 12l10 5 10-5" />
				</svg>
			);
		case "invoice":
		case "payment":
			return (
				<svg {...common}>
					<rect x="2" y="5" width="20" height="14" rx="2" />
					<line x1="2" y1="10" x2="22" y2="10" />
				</svg>
			);
		case "document":
			return (
				<svg {...common}>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
				</svg>
			);
		case "visa":
			return (
				<svg {...common}>
					<circle cx="12" cy="12" r="10" />
					<path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
				</svg>
			);
		case "message":
			return (
				<svg {...common}>
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
	const [filter, setFilter] = useState<"all" | "unread">("all");
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

	function normalizeLink(link: string): string {
		if (link === "/portal/chat") return "/portal/support";
		return link;
	}

	function handleNotifClick(id: string, link?: string) {
		markNotificationRead(id);
		setOpen(false);
		if (link) nav(normalizeLink(link));
	}

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
					transition: "background 0.2s ease, transform 0.2s ease",
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
							fontFamily: "system-ui, -apple-system, sans-serif",
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
						width: "380px",
						maxHeight: "500px",
						overflowY: "auto",
						background: "#ffffff",
						border: "1px solid #e4e4e7",
						boxShadow: "0 10px 40px -10px rgba(0,0,0,0.15)",
						zIndex: 100,
					borderRadius: 0,
					fontFamily: "system-ui, -apple-system, sans-serif",
					}}
				>
					<div
						style={{
							padding: "1rem 1.25rem",
							borderBottom: "1px solid #f4f4f5",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
							<p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#18181b" }}>
								Notifications
							</p>
							<div style={{ display: "flex", gap: 0, marginLeft: "0.5rem" }}>
								{(["all", "unread"] as const).map((f) => (
									<button
										key={f}
										type="button"
										onClick={() => setFilter(f)}
										style={{
											fontSize: "0.65rem",
											fontWeight: 600,
											padding: "0.1rem 0.4rem",
											cursor: "pointer",
											background: filter === f ? "#18181b" : "transparent",
											color: filter === f ? "#ffffff" : "#71717a",
											border: "none",
											borderRight: f === "all" ? "1px solid #e4e4e7" : "none",
											transition: "all 0.15s ease",
										}}
									>
										{f === "all" ? "All" : "Unread"}
									</button>
								))}
							</div>
						</div>
						{unreadCount > 0 ? (
							<button
								type="button"
								onClick={markAllNotificationsRead}
								style={{
									fontSize: "0.75rem",
									fontWeight: 600,
									color: "#71717a",
									cursor: "pointer",
									background: "none",
									border: "none",
									padding: 0,
									transition: "color 0.2s ease",
								}}
								onMouseEnter={(e) => (e.currentTarget.style.color = "#18181b")}
								onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}
							>
							Mark all read
						</button>
					) : null}
					<button
						type="button"
						onClick={pushPermission === "granted" ? pushUnsubscribe : pushSubscribe}
						style={{
							fontSize: "0.7rem",
							fontWeight: 600,
							color: pushPermission === "granted" ? "#ffffff" : "#71717a",
							cursor: "pointer",
							background: pushPermission === "granted" ? "#18181b" : "none",
							border: pushPermission === "granted" ? "1px solid #18181b" : "none",
							padding: pushPermission === "granted" ? "0.15rem 0.5rem" : 0,
							transition: "all 0.2s ease",
						}}
					>
						{pushPermission === "granted" ? "Notifications on" : "Enable alerts"}
					</button>
				</div>

					{(() => {
						const filtered = filter === "unread" ? notifications.filter((n) => !n.read) : notifications;
						return filtered.length === 0 ? (
							<div
								style={{
									padding: "3rem 1rem",
									textAlign: "center",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									gap: "0.75rem",
								}}
							>
								<svg
									width="32"
									height="32"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth={1.5}
									strokeLinecap="round"
									strokeLinejoin="round"
									style={{ opacity: 0.3, color: "#71717a" }}
								>
									<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
									<path d="M13.73 21a2 2 0 0 1-3.46 0" />
								</svg>
								<p style={{ fontSize: "0.85rem", color: "#71717a", margin: 0 }}>
									{filter === "unread" ? "No unread notifications" : "No notifications yet"}
								</p>
							</div>
						) : (
							<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
								{filtered.slice(0, 20).map((n) => (
								<li
									key={n.id}
									style={{
										borderBottom: "1px solid #f4f4f5",
										cursor: "pointer",
										transition: "background 0.2s ease",
										background: "transparent",
									}}
									onClick={() => handleNotifClick(n.id, n.link)}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "#fafafa";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "transparent";
									}}
								>
									<div
										style={{
											padding: "1rem 1.25rem",
											display: "flex",
											gap: "0.85rem",
											alignItems: "flex-start",
										}}
									>
										<span
											style={{
												marginTop: "0.1rem",
												color: n.read ? "#a1a1aa" : "#18181b",
											}}
										>
											<NotifIcon type={n.type} read={n.read} />
										</span>
										<div style={{ flex: 1, minWidth: 0 }}>
											<p
												style={{
													fontWeight: n.read ? 500 : 700,
													fontSize: "0.85rem",
													lineHeight: 1.3,
													color: n.read ? "#52525b" : "#18181b",
													margin: 0,
												}}
											>
												{n.title}
											</p>
											<p
												style={{
													fontSize: "0.8rem",
													lineHeight: 1.4,
													marginTop: "0.25rem",
													color: "#71717a",
													margin: 0,
												}}
											>
												{n.body}
											</p>
											<p
												style={{
													fontSize: "0.7rem",
													color: "#71717a",
													marginTop: "0.4rem",
													margin: 0,
												}}
											>
												{new Date(n.at).toLocaleString([], {
													hour: "2-digit",
													minute: "2-digit",
													day: "numeric",
													month: "short",
												})}
											</p>
										</div>
										{!n.read ? (
											<span
												style={{
													width: "8px",
													height: "8px",
													borderRadius: "50%",
													background: "#18181b",
													flexShrink: 0,
													marginTop: "0.3rem",
												}}
											/>
										) : null}
									</div>
								</li>
							))}
						</ul>
					);
					})()}
				</div>
			) : null}
		</div>
	);
}
