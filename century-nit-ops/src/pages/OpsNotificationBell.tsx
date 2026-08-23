import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useOpsNotifications } from "../hooks/useOpsNotifications";
import { useChatHub } from "./ChatHubContext";

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
		case "assignment":
		case "lead":
			return (
				<svg {...common}>
					<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
					<circle cx="8.5" cy="7" r="4" />
					<polyline points="17 11 19 13 23 9" />
				</svg>
			);
		case "consultation":
			return (
				<svg {...common}>
					<path d="M12 2L2 7l10 5 10-5-10-5z" />
					<path d="M2 17l10 5 10-5" />
					<path d="M2 12l10 5 10-5" />
				</svg>
			);
		case "finance":
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
		case "application":
			return (
				<svg {...common}>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<polyline points="14 2 14 8 20 8" />
				</svg>
			);
		case "message":
			return (
				<svg {...common}>
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
				</svg>
			);
		case "system":
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

export function OpsNotificationBell() {
	const { notifications, unreadCount, markRead, markAllRead } = useOpsNotifications();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const nav = useNavigate();
	const { openConversation } = useChatHub();

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

	/**
	 * Normalise a notification link so old rows still in the DB (which used
	 * `/ops/...` prefixes) resolve to the correct route. New rows from the
	 * API already use bare paths like `/applications`, `/documents`, etc.
	 */
	function normalizeLink(link: string): string {
		if (!link.startsWith("/ops/")) return link;
		const segment = link.slice(5); // strip "/ops/"
		if (segment === "cases") return "/applications";
		if (segment === "chat") return "/inbox";
		return `/${segment}`;
	}

	function handleNotifClick(id: string, link?: string | null) {
		void markRead(id);
		setOpen(false);
		if (!link) return;
		// Chat notification links carry the conversation ID as a query param
		// (e.g. "/chat?conversation=abc"). Open the CommunicationHub on that
		// conversation instead of navigating to a non-existent route.
		const chatMatch = link.match(/^\/chat(?:\?conversation=([^&]+))?/);
		if (chatMatch) {
			if (chatMatch[1]) {
				void openConversation(chatMatch[1]);
			} else {
				nav("/inbox");
			}
			return;
		}
		nav(normalizeLink(link));
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
					borderRadius: "50%",
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
							borderRadius: "999px",
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
						borderRadius: "16px",
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
						</div>
						{unreadCount > 0 ? (
							<button
								type="button"
								onClick={() => void markAllRead()}
								style={{
									fontSize: "0.75rem",
									fontWeight: 600,
									color: "#52525b",
									cursor: "pointer",
									background: "none",
									border: "none",
									padding: 0,
									transition: "color 0.2s ease",
								}}
								onMouseEnter={(e) => (e.currentTarget.style.color = "#18181b")}
								onMouseLeave={(e) => (e.currentTarget.style.color = "#52525b")}
							>
								Mark all read
							</button>
						) : null}
					</div>

					{notifications.length === 0 ? (
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
								style={{ opacity: 0.6, color: "#52525b" }}
							>
								<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
								<path d="M13.73 21a2 2 0 0 1-3.46 0" />
							</svg>
							<p style={{ fontSize: "0.85rem", color: "#52525b", margin: 0 }}>
								No notifications yet
							</p>
						</div>
					) : (
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{notifications.slice(0, 20).map((n) => (
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
													color: "#52525b",
													margin: 0,
												}}
											>
												{n.body}
											</p>
											<p
												style={{
													fontSize: "0.7rem",
													color: "#52525b",
													marginTop: "0.4rem",
													margin: 0,
												}}
											>
												{new Date(n.createdAt).toLocaleString([], {
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
					)}
					<div
						style={{
							padding: "0.75rem",
							background: "#f5f5f5",
							borderTop: "1px solid #f4f4f5",
							textAlign: "center",
						}}
					>
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								nav("/inbox");
							}}
							style={{
								background: "none",
								border: "none",
								color: "#18181b",
								fontSize: "0.8rem",
								fontWeight: 600,
								cursor: "pointer",
								padding: "0.25rem 0.5rem",
							}}
						>
							View full inbox →
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
