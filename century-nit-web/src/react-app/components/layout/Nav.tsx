import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { JourneyButton } from "../ui/JourneyButton";
import { useAppState } from "../../context/AppState";
import { MAIN_LINKS as mainLinks, SECONDARY_LINKS as mobileExtra } from "./navLinks";

export function Nav() {
	const [open, setOpen] = useState(false);
	const [profileOpen, setProfileOpen] = useState(false);
	const [notifOpen, setNotifOpen] = useState(false);
	const location = useLocation();
	const navigate = useNavigate();
	const profileRef = useRef<HTMLDivElement>(null);
	const notifRef = useRef<HTMLDivElement>(null);

	const { isAuthenticated, authUser, signOut, unreadCount, notifications, markAllNotificationsRead } =
		useAppState();

	useEffect(() => {
		const t = setTimeout(() => {
			setOpen(false);
			setProfileOpen(false);
			setNotifOpen(false);
		}, 0);
		return () => clearTimeout(t);
	}, [location.pathname]);

	useEffect(() => {
		document.body.classList.toggle("nav-open", open);
		return () => document.body.classList.remove("nav-open");
	}, [open]);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
				setProfileOpen(false);
			}
			if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
				setNotifOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const linkClass = ({ isActive }: { isActive: boolean }) =>
		`nav__link${isActive ? " nav__link--active" : ""}`;

	const initials = authUser
		? authUser.name
				.split(" ")
				.map((w) => w[0])
				.slice(0, 2)
				.join("")
				.toUpperCase()
		: "";

	return (
		<header className="nav">
			<div className="container nav__inner">
				<Link to="/" className="nav__logo" aria-label="Century NIT home">
					Century NIT <span>International</span>
				</Link>

				<nav className="nav__links" aria-label="Primary">
					{mainLinks.map((l) => (
						<NavLink key={l.to} to={l.to} className={linkClass} style={{ whiteSpace: "nowrap" }}>
							{l.label}
						</NavLink>
					))}
				</nav>

				<div className="nav__actions">
					<JourneyButton size="sm" />

					{isAuthenticated ? (
						<>
							<div className="nav__notif" ref={notifRef}>
								<button
									type="button"
									className="nav__bell"
									aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
									onClick={() => setNotifOpen((v) => !v)}
								>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
										<path d="M13.73 21a2 2 0 0 1-3.46 0" />
									</svg>
									{unreadCount > 0 ? <span className="nav__bell-dot" /> : null}
								</button>
								{notifOpen ? (
									<div className="nav__dropdown nav__dropdown--notif">
										<div className="nav__dropdown-head">
											<span className="mono" style={{ fontSize: "0.7rem", letterSpacing: "0.08em" }}>
												NOTIFICATIONS
											</span>
											{unreadCount > 0 ? (
												<button
													type="button"
													className="nav__dropdown-action"
													onClick={() => markAllNotificationsRead()}
												>
													Mark all read
												</button>
											) : null}
										</div>
										{notifications.length === 0 ? (
											<p className="muted" style={{ fontSize: "0.85rem", padding: "0.75rem 0" }}>
												No notifications yet.
											</p>
										) : (
											notifications.slice(0, 6).map((n) => (
												<div
													key={n.id}
													className="nav__notif-item"
													style={{ opacity: n.read ? 0.5 : 1 }}
												>
													<p style={{ fontSize: "0.85rem", lineHeight: 1.4, margin: 0 }}>
														{n.title}
													</p>
													{n.body ? (
														<p className="muted" style={{ fontSize: "0.75rem", margin: "0.2rem 0 0" }}>
															{n.body}
														</p>
													) : null}
													<p className="mono muted" style={{ fontSize: "0.65rem", margin: "0.3rem 0 0" }}>
														{new Date(n.at).toLocaleDateString()}
													</p>
												</div>
											))
										)}
									</div>
								) : null}
							</div>

							<div className="nav__profile" ref={profileRef}>
								<button
									type="button"
									className="nav__avatar"
									aria-label="Open profile menu"
									onClick={() => setProfileOpen((v) => !v)}
								>
									{initials}
								</button>
								{profileOpen ? (
									<div className="nav__dropdown nav__dropdown--profile">
										<div className="nav__dropdown-head">
											<div>
												<p className="display" style={{ fontSize: "0.95rem", margin: 0 }}>
													{authUser?.name}
												</p>
												<p className="mono muted" style={{ fontSize: "0.7rem", margin: "0.15rem 0 0" }}>
													{authUser?.email}
												</p>
											</div>
										</div>
										<Link to="/portal/home" className="nav__dropdown-link">
											Applicant Dashboard
										</Link>
										<Link to="/portal/journey" className="nav__dropdown-link">
											My Journey
										</Link>
										<Link to="/portal/profile" className="nav__dropdown-link">
											Profile Settings
										</Link>
										<hr className="nav__dropdown-rule" />
										<button
											type="button"
											className="nav__dropdown-link nav__dropdown-link--danger"
											onClick={() => {
												signOut();
												navigate("/");
											}}
										>
											Sign Out
										</button>
									</div>
								) : null}
							</div>
						</>
					) : (
						<Link to="/start" className="nav__signin">
							Login
						</Link>
					)}

					<button
						type="button"
						className="nav__toggle"
						aria-label={open ? "Close menu" : "Open menu"}
						aria-expanded={open}
						onClick={() => setOpen((v) => !v)}
					>
						{open ? "✕" : "☰"}
					</button>
				</div>
			</div>

			<div className={`nav__mobile${open ? " nav__mobile--open" : ""}`} hidden={!open}>
				{[...mainLinks, ...mobileExtra].map((l) => (
					<Link key={l.to} to={l.to}>
						{l.label}
					</Link>
				))}
				{isAuthenticated ? (
					<>
						<Link to="/portal/home">Applicant Dashboard</Link>
						<Button
							type="button"
							variant="secondary"
							block
							onClick={() => {
								signOut();
								navigate("/");
							}}
						>
							Sign Out
						</Button>
					</>
				) : (
					<JourneyButton block arrow />
				)}
			</div>
		</header>
	);
}
