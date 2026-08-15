import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAppState } from "../../context/AppState";
import { Sheet } from "century-nit-core/ui";
import { MENU_GROUPS } from "./navLinks";
import {
	IconCompass,
	IconExternal,
	IconHome,
	IconLogout,
	IconMenu,
	IconSpark,
	IconUser,
} from "../ui/Icons";

/** Paths that should keep the "Explore" tab lit */
const EXPLORE_PATHS = [
	"/destinations",
	"/universities",
	"/programs",
	"/scholarships",
];

function tabClass({ isActive }: { isActive: boolean }) {
	return `tabbar__item${isActive ? " tabbar__item--active" : ""}`;
}

/**
 * Fixed bottom navigation for phones and small tablets.
 * Replaces the hamburger below 1024px - five thumb-reachable destinations,
 * with the primary journey CTA raised in the centre.
 */
export function MobileTabBar() {
	const [menuOpen, setMenuOpen] = useState(false);
	const [profileOpen, setProfileOpen] = useState(false);
	const profileRef = useRef<HTMLDivElement>(null);
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { isAuthenticated, authUser, signOut } = useAppState();

	const exploreActive = EXPLORE_PATHS.some((p) => pathname.startsWith(p));

	const initials = authUser
		? authUser.name
				.split(" ")
				.map((w) => w[0])
				.slice(0, 2)
				.join("")
				.toUpperCase()
		: "";

	// Close the profile dropdown on outside taps
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
				setProfileOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	return (
		<>
			<nav className="tabbar" aria-label="Mobile primary">
				<NavLink to="/" end className={tabClass}>
					<IconHome />
					<span className="tabbar__label">Home</span>
				</NavLink>

				<NavLink
					to="/destinations"
					className={({ isActive }) => tabClass({ isActive: isActive || exploreActive })}
				>
					<IconCompass />
					<span className="tabbar__label">Explore</span>
				</NavLink>

				<Link to="/start" className="tabbar__item tabbar__item--cta" aria-label="Start your journey">
					<span className="tabbar__cta-disc">
						<IconSpark size={20} />
					</span>
					<span className="tabbar__label">Start</span>
				</Link>

				{isAuthenticated && authUser ? (
					<div className="tabbar__profile" ref={profileRef}>
						<button
							type="button"
							className={`tabbar__item${profileOpen ? " tabbar__item--active" : ""}`}
							onClick={() => setProfileOpen((v) => !v)}
							aria-expanded={profileOpen}
							aria-haspopup="menu"
							aria-label="Open profile menu"
						>
							<span className="tabbar__avatar">{initials}</span>
							<span className="tabbar__label">Profile</span>
						</button>
						{profileOpen ? (
							<div className="nav__dropdown nav__dropdown--profile nav__dropdown--tabbar">
								<div className="nav__dropdown-head">
									<div>
										<p className="display" style={{ fontSize: "0.95rem", margin: 0 }}>
											{authUser.name}
										</p>
										<p className="mono muted" style={{ fontSize: "0.7rem", margin: "0.15rem 0 0" }}>
											{authUser.email}
										</p>
									</div>
								</div>
								<Link to="/portal/home" className="nav__dropdown-link" onClick={() => setProfileOpen(false)}>
									Applicant Dashboard
								</Link>
								<Link to="/portal/journey" className="nav__dropdown-link" onClick={() => setProfileOpen(false)}>
									My Journey
								</Link>
								<Link to="/portal/profile" className="nav__dropdown-link" onClick={() => setProfileOpen(false)}>
									Profile Settings
								</Link>
								<hr className="nav__dropdown-rule" />
								<button
									type="button"
									className="nav__dropdown-link nav__dropdown-link--danger"
									onClick={() => {
										signOut();
										setProfileOpen(false);
										navigate("/");
									}}
								>
									Sign Out
								</button>
							</div>
						) : null}
					</div>
				) : (
					<NavLink to="/start" className={tabClass}>
						<IconUser />
						<span className="tabbar__label">Login</span>
					</NavLink>
				)}

				<button
					type="button"
					className={`tabbar__item${menuOpen ? " tabbar__item--active" : ""}`}
					onClick={() => setMenuOpen(true)}
					aria-expanded={menuOpen}
					aria-haspopup="dialog"
				>
					<IconMenu />
					<span className="tabbar__label">Menu</span>
				</button>
			</nav>

			<Sheet
				open={menuOpen}
				onClose={() => setMenuOpen(false)}
				title="Menu"
				size="tall"
				closeOnLink
			>
				{isAuthenticated && authUser ? (
					<Link to="/portal/home" className="sheet-account">
						<span className="sheet-account__avatar">{initials}</span>
						<span className="sheet-account__meta">
							<span className="sheet-account__name">{authUser.name}</span>
							<span className="sheet-account__sub mono">{authUser.email}</span>
						</span>
						<span className="sheet-account__go" aria-hidden>
							→
						</span>
					</Link>
				) : (
					<Link to="/start" className="btn btn--primary btn--block sheet__cta">
						Start your journey →
					</Link>
				)}

				{MENU_GROUPS.map((group) => (
					<section key={group.title} className="sheet-group">
						<h3 className="sheet-group__title">{group.title}</h3>
						<div className="sheet-group__links">
							{group.links.map((l) => (
								<Link
									key={l.to}
									to={l.to}
									className={`sheet-link${pathname === l.to ? " sheet-link--active" : ""}`}
								>
									{l.label}
									<span aria-hidden>→</span>
								</Link>
							))}
						</div>
					</section>
				))}

				<div className="sheet-footer">
					{isAuthenticated ? (
						<button
							type="button"
							className="sheet-link sheet-link--danger"
							onClick={() => {
								signOut();
								setMenuOpen(false);
								navigate("/");
							}}
						>
							Sign out
							<IconLogout size={18} />
						</button>
					) : null}
					<a
						className="sheet-link"
						href="mailto:hello@centurynit.com"
					>
						Contact us
						<IconExternal size={18} />
					</a>
				</div>
			</Sheet>
		</>
	);
}
