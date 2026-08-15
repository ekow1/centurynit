import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS, ROLE_HOME, ROLE_PERMISSIONS, type OpsRole, type OpsModule } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import { OpsCommandPalette } from "./OpsCommandPalette";
import { useLivePortalCase } from "./useLivePortalCase";
import { staffBranchName } from "century-nit-core/ops";
import { ICONS } from "./opsIcons";
import { OpsAppBar, OpsTabBar, type OpsNavItem } from "./OpsMobileNav";

type NavItem = { to: string; module: OpsModule; label: string; blurb: string; icon: string };
type NavGroup = { group: string; icon: string; blurb: string; children: NavItem[] };
type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
	return "group" in entry;
}

function flattenNav(entries: NavEntry[]): OpsNavItem[] {
	return entries.flatMap((e) => (isGroup(e) ? e.children.map(({ to, label, blurb, icon }) => ({ to, label, blurb, icon })) : [{ to: e.to, label: e.label, blurb: e.blurb, icon: e.icon }]));
}

function Icon({ name }: { name: string }) {
	return <span className="ops-nav-icon" dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.dashboard }} />;
}

/** Business operations - manager and consultant. */
const OPERATIONS_NAV: NavEntry[] = [
	{ to: "/ops/dashboard", module: "dashboard", label: "Dashboard", blurb: "Mission control", icon: "dashboard" },
	{
		group: "Cases",
		icon: "applications",
		blurb: "Client work & progression",
		children: [
			{ to: "/ops/applications", module: "applications", label: "Applications", blurb: "Active applications", icon: "applications" },
			{ to: "/ops/consultations", module: "consultations", label: "Consultations", blurb: "Meetings & assessments", icon: "consultations" },
			{ to: "/ops/visa", module: "visa", label: "Visa Processing", blurb: "Visa tracking & sub-steps", icon: "applications" },
			{ to: "/ops/travel", module: "travel", label: "Travel Assistance", blurb: "Pre-departure & clearance", icon: "applications" },
			{ to: "/ops/applicants", module: "applicants", label: "Applicants", blurb: "Client records", icon: "applicants" },
			{ to: "/ops/workflow", module: "workflow", label: "Workflow", blurb: "Visual pipeline", icon: "workflow" },
		],
	},
	{
		group: "Customer Service",
		icon: "crm",
		blurb: "Leads, internal tickets & marketing",
		children: [
			{ to: "/ops/leads", module: "leads", label: "Leads", blurb: "Lead management", icon: "leads" },
			{ to: "/ops/appointments", module: "appointments", label: "Appointments", blurb: "Calendar", icon: "appointments" },
			{ to: "/ops/helpdesk", module: "helpdesk", label: "Helpdesk", blurb: "Support tickets & requests", icon: "helpdesk" },
			{ to: "/ops/marketing", module: "marketing", label: "Marketing", blurb: "Email & SMS campaigns", icon: "marketing" },
		],
	},
	{
		group: "Catalog",
		icon: "universities",
		blurb: "Schools, programs & tiers",
		children: [
			{ to: "/ops/universities", module: "universities", label: "Universities", blurb: "Schools & countries", icon: "universities" },
			{ to: "/ops/programs", module: "programs", label: "Programs", blurb: "Study programs", icon: "programs" },
			{ to: "/ops/packages", module: "packages", label: "Packages", blurb: "Service tiers", icon: "packages" },
		],
	},
	{
		group: "Reports",
		icon: "reports",
		blurb: "Finance & analytics",
		children: [
			{ to: "/ops/invoices", module: "invoices", label: "Invoices", blurb: "Raise, chase & settle", icon: "finance" },
			{ to: "/ops/ledger", module: "ledger", label: "Client Ledger", blurb: "Per-client journal & installments", icon: "finance" },
			{ to: "/ops/payments", module: "payments", label: "Payments Log", blurb: "All incoming payments", icon: "finance" },
			{ to: "/ops/payment-config", module: "payment-config", label: "Payment Config", blurb: "Schedule options & plans", icon: "finance" },
			{ to: "/ops/finance", module: "finance", label: "Finance Reports", blurb: "Revenue & payments", icon: "finance" },
			{ to: "/ops/reports", module: "reports", label: "Analytics Reports", blurb: "Operations & performance", icon: "reports" },
		],
	},
	{ to: "/ops/documents", module: "documents", label: "Documents", blurb: "Review queue", icon: "documents" },
];

/** Running the platform - administrator only. No applicant data here. */
const PLATFORM_NAV: NavEntry[] = [
	{ to: "/ops/system", module: "system", label: "System Overview", blurb: "Platform health", icon: "system" },
	{
		group: "Access & Security",
		icon: "users",
		blurb: "Staff & sign-in",
		children: [
			{ to: "/ops/users", module: "users", label: "Users & Roles", blurb: "Staff & access", icon: "users" },
			{ to: "/ops/auth", module: "auth", label: "Authentication", blurb: "Sign-in & sessions", icon: "auth" },
		],
	},
	{
		group: "Content",
		icon: "cms",
		blurb: "Pages & branding",
		children: [
			{ to: "/ops/cms", module: "cms", label: "Content (CMS)", blurb: "Pages & posts", icon: "cms" },
			{ to: "/ops/site", module: "site", label: "Site & UI", blurb: "Branding & nav", icon: "site" },
		],
	},
	{
		group: "Configuration",
		icon: "settings",
		blurb: "Integrations & defaults",
		children: [
			{ to: "/ops/notifications", module: "notifications", label: "Notifications", blurb: "Templates & triggers", icon: "notifications" },
			{ to: "/ops/settings", module: "settings", label: "System Config", blurb: "Integrations & defaults", icon: "settings" },
		],
	},
];

function MainNavItem({
	to,
	label,
	blurb,
	icon,
}: {
	to: string;
	label: string;
	blurb: string;
	icon: string;
}) {
	return (
		<NavLink
			to={to}
			className={({ isActive }) =>
				`portal-nav__item${isActive ? " portal-nav__item--active" : ""}`
			}
		>
			<Icon name={icon} />
			<span className="portal-nav__meta">
				<span className="portal-nav__label">{label}</span>
				<span className="portal-nav__blurb">{blurb}</span>
			</span>
		</NavLink>
	);
}

function MainNavGroup({
	group,
	icon,
	blurb,
	children,
	defaultOpen,
}: {
	group: string;
	icon: string;
	blurb: string;
	children: NavItem[];
	defaultOpen: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const { pathname } = useLocation();
	const hasActiveChild = children.some((c) => pathname.startsWith(c.to));

	return (
		<div className="portal-nav__group">
			<button
				type="button"
				className={`portal-nav__group-btn${hasActiveChild ? " portal-nav__group-btn--active" : ""}`}
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
			>
				<Icon name={icon} />
				<span className="portal-nav__meta">
					<span className="portal-nav__label">{group}</span>
					<span className="portal-nav__blurb">{blurb}</span>
				</span>
				<span className={`portal-nav__chevron${open ? " portal-nav__chevron--open" : ""}`} aria-hidden>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
				</span>
			</button>
			{open && (
				<div className="portal-nav__sub">
					{children.map((child) => (
						<MainNavItem key={child.to} {...child} />
					))}
				</div>
			)}
		</div>
	);
}

const SWITCHABLE_ROLES: OpsRole[] = ["manager", "coordinator", "consultant", "finance", "admin"];

/**
 * Mirrors the applicant portal's localStorage into the ops store so staff see
 * the live portal session alongside the seeded records. Read-only - see
 * useLivePortalCase.
 */
function LiveCaseSync() {
	const live = useLivePortalCase();
	const { publishLiveCase } = useOpsState();

	useEffect(() => {
		publishLiveCase(live);
	}, [live, publishLiveCase]);

	return null;
}

/** Path → module mapping for permission checks on role switch. */
const PATH_MODULE: Record<string, OpsModule> = {
	"/ops/dashboard": "dashboard",
	"/ops/applications": "applications",
	"/ops/consultations": "consultations",
	"/ops/applicants": "applicants",
	"/ops/leads": "leads",
	"/ops/workflow": "workflow",
	"/ops/documents": "documents",
	"/ops/invoices": "invoices",
	"/ops/finance": "finance",
	"/ops/appointments": "appointments",
	"/ops/universities": "universities",
	"/ops/programs": "programs",
	"/ops/packages": "packages",
	"/ops/reports": "reports",
	"/ops/helpdesk": "helpdesk",
	"/ops/marketing": "marketing",
	"/ops/inbox": "dashboard",
	"/ops/system": "system",
	"/ops/users": "users",
	"/ops/auth": "auth",
	"/ops/cms": "cms",
	"/ops/site": "site",
	"/ops/notifications": "notifications",
	"/ops/settings": "settings",
};

export function EnterpriseLayout() {
	const { opsUser, opsRole, opsSignIn, opsSignOut, hasPermission } = useOpsAuth();
	const { openCommandPalette, liveCase, resetOpsState } = useOpsState();
	const navigate = useNavigate();
	const location = useLocation();

	const operationsNav = OPERATIONS_NAV.filter((entry) => {
		if (isGroup(entry)) return entry.children.some((c) => hasPermission(c.module));
		return hasPermission(entry.module);
	});
	const platformNav = PLATFORM_NAV.filter((entry) => {
		if (isGroup(entry)) return entry.children.some((c) => hasPermission(c.module));
		return hasPermission(entry.module);
	});
	const roleName = opsRole ? ROLE_LABELS[opsRole] : "Staff";

	const { consultations } = useOpsState();

	const unreadCount = useMemo(() => {
		if (!opsUser) return 0;
		let count = 0;
		for (const c of consultations) {
			if (c.status === "Under Review" && !c.assignedOfficer) count++;
			if (c.assignedOfficer === opsUser.name && c.status === "Assigned" && !c.slotConfirmed) count++;
		}
		return count;
	}, [consultations, opsUser]);

	function handleRoleSwitch(role: OpsRole) {
		opsSignIn(role);
		const currentPath = location.pathname;
		const requiredModule = PATH_MODULE[currentPath];
		if (requiredModule) {
			const allowed = ROLE_PERMISSIONS[role].includes(requiredModule);
			if (!allowed) {
				navigate(ROLE_HOME[role], { replace: true });
				return;
			}
		}
		if (currentPath === "/ops/inbox" && role === "admin") {
			navigate(ROLE_HOME[role], { replace: true });
		}
	}

	return (
		<div className="portal">
			<LiveCaseSync />
			<OpsCommandPalette />

			<aside className="portal__aside">
				<div className="portal__brand">
					<Link to={opsRole ? ROLE_HOME[opsRole] : "/ops"} className="nav__logo">
						Century NIT <span>Operations</span>
					</Link>
					<p className="portal__tagline">Mission Control</p>
				</div>

				<nav className="portal-nav" aria-label="Enterprise modules">
					{operationsNav.length > 0 && (
						<>
							<p className="eyebrow" style={{ padding: "0 0 0.4rem", opacity: 0.8, fontSize: "0.6rem" }}>
								Operations
							</p>
							{operationsNav.map((entry) =>
								isGroup(entry) ? (
									<MainNavGroup key={entry.group} group={entry.group} icon={entry.icon} blurb={entry.blurb} children={entry.children.filter((c) => hasPermission(c.module))} defaultOpen={entry.children.some((c) => location.pathname.startsWith(c.to))} />
								) : (
									<MainNavItem key={entry.to} to={entry.to} label={entry.label} blurb={entry.blurb} icon={entry.icon} />
								),
							)}
						</>
					)}
					{platformNav.length > 0 && (
						<>
							<p
								className="eyebrow"
								style={{
									padding: operationsNav.length ? "1rem 0 0.4rem" : "0 0 0.4rem",
									opacity: 0.8,
									fontSize: "0.6rem",
								}}
							>
								Platform
							</p>
							{platformNav.map((entry) =>
								isGroup(entry) ? (
									<MainNavGroup key={entry.group} group={entry.group} icon={entry.icon} blurb={entry.blurb} children={entry.children.filter((c) => hasPermission(c.module))} defaultOpen={entry.children.some((c) => location.pathname.startsWith(c.to))} />
								) : (
									<MainNavItem key={entry.to} to={entry.to} label={entry.label} blurb={entry.blurb} icon={entry.icon} />
								),
							)}
						</>
					)}
				</nav>

				<div className="portal__user">
					{opsUser && (
						<>
							<div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
								<span style={{
									width: "32px",
									height: "32px",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									background: "#fff",
									color: "#000",
									fontSize: "var(--text-xs)",
									fontFamily: "var(--font-mono)",
									fontWeight: 600,
									flexShrink: 0,
								}}>
									{opsUser.avatar}
								</span>
								<div style={{ minWidth: 0 }}>
									<p className="portal__user-name">{opsUser.name}</p>
									<p className="portal__user-email">{roleName}</p>
								</div>
							</div>
							<p style={{ fontSize: "var(--text-xs)", opacity: 0.8, color: "#fff" }}>{staffBranchName(opsUser.branch)}</p>
							<div className="ops-sidebar-role-switch">
								<span className="eyebrow" style={{ fontSize: "0.6rem", opacity: 0.8, color: "#fff" }}>View as</span>
								<select
									className="ops-sidebar-role-select"
									value={opsRole ?? "admin"}
									onChange={(e) => handleRoleSwitch(e.target.value as OpsRole)}
								>
									{SWITCHABLE_ROLES.map((r) => (
										<option key={r} value={r}>{ROLE_LABELS[r]}</option>
									))}
								</select>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={opsSignOut} style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem" }}>
								Sign out
							</button>
						</>
					)}
					<Link to="/" className="link-arrow portal__home">
						← Public site
					</Link>
				</div>
			</aside>

			<div className="portal__main">
				{/* Below 960px the sidebar is hidden - the app bar and bottom tabs
				    take over, exactly as they do on the portal and public site. */}
				<OpsAppBar
					title={roleName}
					operationsNav={flattenNav(operationsNav)}
					platformNav={flattenNav(platformNav)}
					unreadCount={unreadCount}
				/>

				<header className="portal__topbar">
					<div className="portal__topbar-left">
						<p className="eyebrow">{roleName}</p>
						<p className="portal__welcome">
							{opsUser ? `${opsUser.name.split(" ")[0]}'s Command Center` : "Operations"}
						</p>
					</div>
					<div className="portal__topbar-right">
						{/* Live portal session indicator */}
						{liveCase?.present && opsRole !== "admin" && (
							<span className="ops-live-badge" title={`Live portal session · ${liveCase.email}`}>
								<span className="ops-live-dot" aria-hidden />
								LIVE · {liveCase.name.split(" ")[0]} · {liveCase.stageLabel}
							</span>
						)}

						<button
							type="button"
							onClick={openCommandPalette}
							className="ops-search-trigger"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
							<span>Search everywhere...</span>
							<kbd>⌘K</kbd>
						</button>

						{/* Notification bell */}
						{opsRole !== "admin" && (
							<Link to="/ops/inbox" className="ops-bell-btn" aria-label="Notifications">
								<span dangerouslySetInnerHTML={{ __html: ICONS.notifications }} />
								{unreadCount > 0 && <span className="ops-bell-badge">{unreadCount}</span>}
							</Link>
						)}

						{/* Prototype reset */}
						<button
							type="button"
							className="btn btn--ghost btn--sm ops-reset-btn"
							onClick={() => {
								if (confirm("Reset all operations data back to the original seed state? This cannot be undone.")) {
									resetOpsState();
								}
							}}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
							Reset
						</button>
					</div>
				</header>
				<div className="portal__content">
					<Outlet />
				</div>
			</div>

			<OpsTabBar
				operationsNav={flattenNav(operationsNav)}
				platformNav={flattenNav(platformNav)}
				switchableRoles={SWITCHABLE_ROLES}
				onRoleSwitch={handleRoleSwitch}
				onReset={() => {
					if (confirm("Reset all operations data back to the original seed state? This cannot be undone.")) {
						resetOpsState();
					}
				}}
			/>
		</div>
	);
}
