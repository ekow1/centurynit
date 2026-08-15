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
	const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } =
		useAppState();
	const [open, setOpen] = useState(false);
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

	function handleNotifClick(id: string, link?: string) {
		markNotificationRead(id);
		setOpen(false);
		if (link) nav(link);
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
					width: "38px",
					height: "38px",
					background: "transparent",
					border: "1px solid var(--border-light)",
					borderRadius: "8px",
					color: "var(--foreground)",
					transition: "border-color 150ms, background 150ms",
					position: "relative",
				}}
				aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
				onMouseEnter={(e) => {
					e.currentTarget.style.borderColor = "var(--border)";
					e.currentTarget.style.background = "var(--muted)";
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.borderColor = "var(--border-light)";
					e.currentTarget.style.background = "transparent";
				}}
			>
				<svg
					width="18"
					height="18"
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
							top: "-4px",
							right: "-4px",
							background: "var(--foreground)",
							color: "var(--background)",
							fontSize: "0.6rem",
							fontWeight: 700,
							padding: "0.1rem 0.35rem",
							borderRadius: "999px",
							minWidth: "16px",
							textAlign: "center",
							lineHeight: 1,
							fontFamily: "var(--font-mono)",
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
						top: "calc(100% + 0.5rem)",
						right: 0,
						width: "380px",
						maxHeight: "500px",
						overflowY: "auto",
						background: "var(--card)",
						border: "1px solid var(--border)",
						boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
						zIndex: 100,
						borderRadius: "8px",
					}}
				>
					<div
						style={{
							padding: "0.85rem 1rem",
							borderBottom: "1px solid var(--border-light)",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
								strokeLinecap="round"
								strokeLinejoin="round"
								style={{ opacity: 0.6 }}
							>
								<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
								<path d="M13.73 21a2 2 0 0 1-3.46 0" />
							</svg>
							<p className="eyebrow" style={{ margin: 0 }}>
								Notifications
							</p>
						</div>
						{unreadCount > 0 ? (
							<button
								type="button"
								onClick={markAllNotificationsRead}
								style={{
									fontFamily: "var(--font-mono)",
									fontSize: "0.65rem",
									textTransform: "uppercase",
									letterSpacing: "0.08em",
									color: "var(--muted-foreground)",
									cursor: "pointer",
									background: "none",
									border: "none",
									padding: 0,
								}}
							>
								Mark all read
							</button>
						) : null}
					</div>

					{notifications.length === 0 ? (
						<div
							style={{
								padding: "2.5rem 1rem",
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
								style={{ opacity: 0.3 }}
							>
								<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
								<path d="M13.73 21a2 2 0 0 1-3.46 0" />
							</svg>
							<p className="muted" style={{ fontSize: "0.85rem" }}>
								No notifications yet
							</p>
						</div>
					) : (
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{notifications.slice(0, 20).map((n) => (
								<li
									key={n.id}
									style={{
										borderBottom: "1px solid var(--border-light)",
										cursor: "pointer",
										transition: "background 100ms",
									}}
									onClick={() => handleNotifClick(n.id, n.link)}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "var(--muted)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "transparent";
									}}
								>
									<div
										style={{
											padding: "0.75rem 1rem",
											display: "flex",
											gap: "0.75rem",
											alignItems: "flex-start",
										}}
									>
										<span
											style={{
												marginTop: "0.1rem",
												color: "var(--muted-foreground)",
											}}
										>
											<NotifIcon type={n.type} read={n.read} />
										</span>
										<div style={{ flex: 1, minWidth: 0 }}>
											<p
												style={{
													fontWeight: n.read ? 400 : 600,
													fontSize: "0.85rem",
													lineHeight: 1.3,
													opacity: n.read ? 0.6 : 1,
												}}
											>
												{n.title}
											</p>
											<p
												className="muted"
												style={{
													fontSize: "0.78rem",
													lineHeight: 1.4,
													marginTop: "0.2rem",
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
												}}
											>
												{n.body}
											</p>
											<p
												className="mono"
												style={{
													fontSize: "0.65rem",
													opacity: 0.5,
													marginTop: "0.3rem",
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
													background: "var(--foreground)",
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
				</div>
			) : null}
		</div>
	);
}
