import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { OpsNotificationBell } from "./OpsNotificationBell";
import { Sheet } from "century-nit-core/ui";
import { useOpsAuth, ROLE_LABELS, ROLE_HOME, type OpsRole } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import { ICONS } from "./opsIcons";

export type OpsNavItem = {
	to: string;
	label: string;
	blurb: string;
	icon: string;
};

/**
 * Mobile shell for the Operations Center - the same pattern the public site and
 * the applicant portal use: a compact app bar plus a fixed bottom tab bar,
 * with everything that doesn't fit in a sheet.
 *
 * Ops has up to twenty destinations against the portal's five, so the tab bar
 * carries the four the current role reaches for most and "More" opens the full,
 * grouped list.
 */

function NavIcon({ name }: { name: string }) {
	return (
		<span
			className="ops-tab-icon"
			dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.dashboard }}
		/>
	);
}

/** Destinations that earn a permanent tab, in preference order, per role */
const TAB_PREFERENCE: Record<OpsRole, string[]> = {
	// Reaches everything, so lead with the platform console and the two views a
	// super admin actually opens: who has access, and what the system is doing.
	super_admin: ["/system", "/users", "/dashboard", "/settings"],
	manager: ["/dashboard", "/consultations", "/applications", "/workflow"],
	coordinator: ["/dashboard", "/consultations", "/appointments", "/applicants"],
	consultant: ["/dashboard", "/consultations", "/applicants", "/documents"],
	finance: ["/dashboard", "/finance", "/packages", "/reports"],
	admin: ["/system", "/users", "/cms", "/settings"],
};

/** Pick up to four permitted tabs, falling back to whatever the role can reach */
export function pickTabs(all: OpsNavItem[], role: OpsRole | null): OpsNavItem[] {
	const preferred = role ? TAB_PREFERENCE[role] : [];
	const chosen: OpsNavItem[] = [];

	for (const path of preferred) {
		const hit = all.find((i) => i.to === path);
		if (hit) chosen.push(hit);
	}
	for (const item of all) {
		if (chosen.length >= 4) break;
		if (!chosen.some((c) => c.to === item.to)) chosen.push(item);
	}
	return chosen.slice(0, 4);
}

export function OpsAppBar({
	title,
	operationsNav,
	platformNav,
}: {
	title: string;
	operationsNav: OpsNavItem[];
	platformNav: OpsNavItem[];
}) {
	const { opsUser, opsRole } = useOpsAuth();
	const { openCommandPalette } = useOpsState();
	const { pathname } = useLocation();

	const current = [...operationsNav, ...platformNav].find((i) => pathname.startsWith(i.to));

	const initials = opsUser
		? opsUser.name
				.split(" ")
				.map((w) => w[0])
				.slice(0, 2)
				.join("")
				.toUpperCase()
		: "··";

	return (
		<header className="pbar pbar--ops">
			<Link
				to={opsRole ? ROLE_HOME[opsRole] : "/"}
				className="pbar__mark"
				aria-label="Operations home"
			>
				CN
			</Link>

			<div className="pbar__titles">
				<span className="pbar__title">{current?.label ?? title}</span>
				<span className="pbar__sub mono">
					{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
				</span>
			</div>

			<div className="pbar__actions">
				<button
					type="button"
					className="pbar__icon-btn"
					onClick={openCommandPalette}
					aria-label="Search everywhere"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="11" cy="11" r="8" />
						<line x1="21" y1="21" x2="16.65" y2="16.65" />
					</svg>
				</button>

				<OpsNotificationBell />

				<span className="pbar__avatar" aria-hidden>
					{initials}
				</span>
			</div>
		</header>
	);
}

export function OpsTabBar({
	operationsNav,
	platformNav,
	onRoleSwitch,
	switchableRoles,
	onReset,
}: {
	operationsNav: OpsNavItem[];
	platformNav: OpsNavItem[];
	onRoleSwitch: (role: OpsRole) => void;
	switchableRoles: OpsRole[];
	onReset: () => void;
}) {
	const [moreOpen, setMoreOpen] = useState(false);
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { opsUser, opsRole, opsSignOut } = useOpsAuth();

	const all = [...operationsNav, ...platformNav];
	const tabs = pickTabs(all, opsRole);
	const tabPaths = new Set(tabs.map((t) => t.to));
	const moreActive = !tabPaths.has(pathname) && !moreOpen;

	return (
		<>
			<nav className="tabbar tabbar--ops" aria-label="Operations sections">
				{tabs.map((tab) => (
					<NavLink
						key={tab.to}
						to={tab.to}
						className={({ isActive }) => `tabbar__item${isActive ? " tabbar__item--active" : ""}`}
					>
						<NavIcon name={tab.icon} />
						<span className="tabbar__label">{shortLabel(tab.label)}</span>
					</NavLink>
				))}

				<button
					type="button"
					className={`tabbar__item${moreOpen || moreActive ? " tabbar__item--active" : ""}`}
					onClick={() => setMoreOpen(true)}
					aria-expanded={moreOpen}
					aria-haspopup="dialog"
				>
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
						<path d="M4 7h16M4 12h16M4 17h16" />
					</svg>
					<span className="tabbar__label">More</span>
				</button>
			</nav>

			<Sheet
				open={moreOpen}
				onClose={() => setMoreOpen(false)}
				title="Operations"
				size="tall"
				closeOnLink
			>
				{opsUser ? (
					<div className="sheet-account sheet-account--static">
						<span className="sheet-account__avatar">
							{opsUser.name
								.split(" ")
								.map((w) => w[0])
								.slice(0, 2)
								.join("")
								.toUpperCase()}
						</span>
						<span className="sheet-account__meta">
							<span className="sheet-account__name">{opsUser.name}</span>
							<span className="sheet-account__sub mono">
								{opsRole ? ROLE_LABELS[opsRole] : "Staff"}
							</span>
						</span>
					</div>
				) : null}

				{operationsNav.length > 0 ? (
					<section className="sheet-group">
						<h3 className="sheet-group__title">Operations</h3>
						<div className="sheet-group__links">
							{operationsNav.map((item) => (
								<Link
									key={item.to}
									to={item.to}
									className={`sheet-link${pathname.startsWith(item.to) ? " sheet-link--active" : ""}`}
								>
									<span className="sheet-link__text">
										{item.label}
										<span className="sheet-link__blurb">{item.blurb}</span>
									</span>
									<span aria-hidden>→</span>
								</Link>
							))}
						</div>
					</section>
				) : null}

				{platformNav.length > 0 ? (
					<section className="sheet-group">
						<h3 className="sheet-group__title">Platform</h3>
						<div className="sheet-group__links">
							{platformNav.map((item) => (
								<Link
									key={item.to}
									to={item.to}
									className={`sheet-link${pathname.startsWith(item.to) ? " sheet-link--active" : ""}`}
								>
									<span className="sheet-link__text">
										{item.label}
										<span className="sheet-link__blurb">{item.blurb}</span>
									</span>
									<span aria-hidden>→</span>
								</Link>
							))}
						</div>
					</section>
				) : null}

				<section className="sheet-group">
					<h3 className="sheet-group__title">Prototype</h3>
					<label className="sheet-select">
						<span>View as</span>
						<select
							value={opsRole ?? "admin"}
							onChange={(e) => {
								onRoleSwitch(e.target.value as OpsRole);
								setMoreOpen(false);
							}}
						>
							{switchableRoles.map((r) => (
								<option key={r} value={r}>
									{ROLE_LABELS[r]}
								</option>
							))}
						</select>
					</label>
					<div className="sheet-group__links">
						<button
							type="button"
							className="sheet-link"
							onClick={() => {
								onReset();
								setMoreOpen(false);
							}}
						>
							Reset prototype data
							<span aria-hidden>↺</span>
						</button>
						<Link to="/" className="sheet-link">
							Public site
							<span aria-hidden>↗</span>
						</Link>
						<button
							type="button"
							className="sheet-link sheet-link--danger"
							onClick={() => {
								opsSignOut();
								setMoreOpen(false);
								navigate("/login");
							}}
						>
							Sign out
							<span aria-hidden>→</span>
						</button>
					</div>
				</section>
			</Sheet>
		</>
	);
}

/** Tab labels have ~70px - trim the long module names */
function shortLabel(label: string) {
	const map: Record<string, string> = {
		Dashboard: "Home",
		Applications: "Cases",
		Consultations: "Consults",
		Appointments: "Calendar",
		"System Overview": "System",
		"Users & Roles": "Users",
		"Content (CMS)": "Content",
		"System Config": "Config",
		Universities: "Schools",
	};
	return map[label] ?? label;
}
