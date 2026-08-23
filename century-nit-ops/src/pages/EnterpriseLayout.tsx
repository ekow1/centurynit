import { useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS, ROLE_HOME, type OpsRole, type OpsModule } from "./OpsAuthContext";
import { roleCanAccess } from "century-nit-shared";
import { useOpsState } from "./OpsStateContext";

import { usePushNotifications } from "../hooks/usePushNotifications";
import { CasesProvider } from "../hooks/useCases";
import { OpsCommandPalette } from "./OpsCommandPalette";
import { CommunicationHub } from "./CommunicationHub";
import { ChatHubProvider } from "./ChatHubContext";
import { staffBranchName } from "century-nit-core/ops";
import { ICONS } from "./opsIcons";
import { OpsNotificationBell } from "./OpsNotificationBell";
import { OpsAppBar, OpsTabBar, type OpsNavItem } from "./OpsMobileNav";
import { publicSiteUrl } from "../lib/publicSite";

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
	{ to: "/dashboard", module: "dashboard", label: "Dashboard", blurb: "Mission control", icon: "dashboard" },
	{
		group: "Cases",
		icon: "applications",
		blurb: "Client work & progression",
		children: [
			{ to: "/clients", module: "applicants", label: "Clients Directory", blurb: "Accounts, status & access", icon: "users" },
			{ to: "/applications", module: "applications", label: "Applications", blurb: "Active applications", icon: "applications" },
			{ to: "/consultations", module: "consultations", label: "Consultations", blurb: "Meetings & assessments", icon: "consultations" },
			{ to: "/visa", module: "visa", label: "Visa Processing", blurb: "Visa tracking & sub-steps", icon: "applications" },
			{ to: "/travel", module: "travel", label: "Travel Assistance", blurb: "Pre-departure & clearance", icon: "applications" },
			{ to: "/applicants", module: "applicants", label: "Applicants", blurb: "Client records", icon: "applicants" },
			{ to: "/workflow", module: "workflow", label: "Workflow", blurb: "Visual pipeline", icon: "workflow" },
		],
	},
	{
		group: "Customer Service",
		icon: "crm",
		blurb: "Leads, internal tickets & marketing",
		children: [
			{ to: "/leads", module: "leads", label: "Leads", blurb: "Lead management", icon: "leads" },
			{ to: "/appointments", module: "appointments", label: "Appointments", blurb: "Calendar", icon: "appointments" },
			{ to: "/helpdesk", module: "helpdesk", label: "Helpdesk", blurb: "Support tickets & requests", icon: "helpdesk" },
			{ to: "/marketing", module: "marketing", label: "Marketing", blurb: "Email & SMS campaigns", icon: "marketing" },
		],
	},
	{
		group: "Catalog",
		icon: "universities",
		blurb: "Schools, programs & tiers",
		children: [
			{ to: "/universities", module: "universities", label: "Universities", blurb: "Schools & countries", icon: "universities" },
			{ to: "/programs", module: "programs", label: "Programs", blurb: "Study programs", icon: "programs" },
			{ to: "/packages", module: "packages", label: "Packages", blurb: "Service tiers", icon: "packages" },
		],
	},
	{
		group: "Finance",
		icon: "finance",
		blurb: "Invoicing, payments & pricing",
		children: [
			{ to: "/invoices", module: "invoices", label: "Invoices", blurb: "Raise, chase & settle", icon: "finance" },
			{ to: "/ledger", module: "ledger", label: "Client Ledger", blurb: "Per-client journal & installments", icon: "finance" },
			{ to: "/payments", module: "payments", label: "Payments Log", blurb: "All incoming payments", icon: "finance" },
			{ to: "/fee-schedule", module: "finance", label: "Fee Schedule", blurb: "Official service pricing", icon: "finance" },
			{ to: "/payment-config", module: "payment-config", label: "Payment Config", blurb: "Schedule options & plans", icon: "finance" },
		],
	},
	{
		group: "Reports",
		icon: "reports",
		blurb: "Workload & analytics",
		children: [
			{ to: "/finance", module: "finance", label: "Finance Reports", blurb: "Revenue & payments", icon: "finance" },
			{ to: "/reports", module: "reports", label: "Analytics Reports", blurb: "Operations & performance", icon: "reports" },
			{ to: "/team", module: "reports", label: "Team Assignments", blurb: "Track staff workload", icon: "reports" },
		],
	},
	{ to: "/documents", module: "documents", label: "Documents", blurb: "Review queue", icon: "documents" },
	{ to: "/my-calendar", module: "dashboard", label: "My Calendar", blurb: "Google Calendar sync", icon: "appointments" },
];

/** Running the platform - administrator only. No applicant data here. */
const PLATFORM_NAV: NavEntry[] = [
	{ to: "/system", module: "system", label: "System Overview", blurb: "Platform health", icon: "system" },
	{
		group: "Access & Security",
		icon: "users",
		blurb: "Staff & sign-in",
		children: [
			{ to: "/users", module: "users", label: "Staff & Roles", blurb: "Staff directory & matrix", icon: "users" },
			{ to: "/clients", module: "users", label: "Clients Directory", blurb: "Accounts, status & ban", icon: "users" },
			{ to: "/auth", module: "auth", label: "Authentication", blurb: "Sign-in & sessions", icon: "auth" },
			{ to: "/audit", module: "system", label: "Audit Logs", blurb: "Security & admin trail", icon: "security" },
		],
	},
	{
		group: "Content",
		icon: "cms",
		blurb: "Pages & branding",
		children: [
			{ to: "/cms", module: "cms", label: "Content (CMS)", blurb: "Pages & posts", icon: "cms" },
			{ to: "/site", module: "site", label: "Site & UI", blurb: "Branding & nav", icon: "site" },
		],
	},
	{
		group: "Configuration",
		icon: "settings",
		blurb: "Integrations & defaults",
		children: [
			{ to: "/notifications", module: "notifications", label: "Notifications", blurb: "Templates & triggers", icon: "notifications" },
			{ to: "/settings", module: "settings", label: "System Config", blurb: "Integrations & defaults", icon: "settings" },
		],
	},
];

function MainNavItem({
	to,
	label,
	blurb: _blurb,
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
			</span>
		</NavLink>
	);
}

function MainNavGroup({
	group,
	icon,
	blurb: _blurb,
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

export function EnterpriseLayout() {
	const { opsUser, opsRole, opsSignOut, hasPermission } = useOpsAuth();
	const isDev = import.meta.env.DEV;
	const { openCommandPalette, resetOpsState } = useOpsState();
	const location = useLocation();
	const [confirmReset, setConfirmReset] = useState(false);

	const operationsNav = OPERATIONS_NAV.filter((entry) => {
		if (isGroup(entry)) return entry.children.some((c) => hasPermission(c.module));
		return hasPermission(entry.module);
	});
	const platformNav = PLATFORM_NAV.filter((entry) => {
		if (isGroup(entry)) return entry.children.some((c) => hasPermission(c.module));
		return hasPermission(entry.module);
	});
	const roleName = opsRole ? ROLE_LABELS[opsRole] : "Staff";

	// The bell badge reflects the real, server-side notification count — not a
	// heuristic derived from polled leads/consultations. Those still get polled
	// by their own pages (inbox, consultations, leads) for their own lists.


	// Silent Web Push subscription — active while a staff member is signed in.
	// The permission prompt is never shown automatically; this only resubscribes
	// returning staff who previously granted permission.
	const pushState = usePushNotifications({ isAuthenticated: Boolean(opsUser) });

	return (
		<CasesProvider>
		<ChatHubProvider>
		<div className="portal">
			<OpsCommandPalette />

			<aside className="portal__aside">
				<div className="portal__brand">
					<Link to={opsRole ? ROLE_HOME[opsRole] : "/"} className="nav__logo">
						Century NIT <span>Operations</span>
					</Link>
					<p className="portal__tagline">Mission Control</p>
				</div>

				<nav className="portal-nav" aria-label="Enterprise modules">
					{operationsNav.length > 0 && (
						<>
							<p className="portal-nav__section">Operations</p>
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
							<p className={`portal-nav__section${operationsNav.length ? " portal-nav__section--spaced" : ""}`}>
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
						<div className="portal__user-card">
							<div className="portal__user-avatar">
								<span>{opsUser.avatar}</span>
								<span className="portal__user-status-dot" title="Active Ops Session" />
							</div>
							<div className="portal__user-info">
								<p className="portal__user-name" title={opsUser.name}>{opsUser.name}</p>
								<div className="portal__user-role-badge">
									{roleName} · {staffBranchName(opsUser.branch)}
								</div>
							</div>
						</div>
					)}

					<div className="portal__user-actions">
						<a
							href={publicSiteUrl()}
							className="portal__user-action-btn"
							title="Open Public Site"
						>
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
							<span>Public Site</span>
						</a>
						<button
							type="button"
							onClick={opsSignOut}
							className="portal__user-action-btn portal__user-action-btn--signout"
							title="Sign Out of Operations Console"
						>
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
							<span>Sign out</span>
						</button>
					</div>

					<div className="portal__user-brand-stamp">
						<span>Century NIT Consult</span>
						<span>•</span>
						<span>Ops Center</span>
					</div>
				</div>
			</aside>

			<div className="portal__main">
				{/* Below 960px the sidebar is hidden - the app bar and bottom tabs
				    take over, exactly as they do on the portal and public site. */}
				<OpsAppBar
					title={roleName}
					operationsNav={flattenNav(operationsNav)}
					platformNav={flattenNav(platformNav)}
				/>

				<header className="portal__topbar">
					<div className="portal__topbar-left">
						<p className="eyebrow">{roleName}</p>
						<p className="portal__welcome">
							{opsUser
								? `${opsUser.name.includes("@") ? opsUser.name.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : opsUser.name.split(" ")[0]}'s Command Center`
								: "Operations"}
						</p>
					</div>
					<div className="portal__topbar-right">
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
						<OpsNotificationBell />

						<button
							type="button"
							onClick={pushState.subscription ? pushState.unsubscribe : pushState.subscribe}
							style={{
								fontSize: "0.65rem",
								fontWeight: 600,
								color: pushState.subscription ? "#ffffff" : "#52525b",
								cursor: "pointer",
								background: pushState.subscription ? "#18181b" : "transparent",
								border: pushState.subscription ? "1px solid #18181b" : "1px solid #e4e4e7",
								padding: "0.2rem 0.5rem",
								transition: "all 0.2s ease",
								whiteSpace: "nowrap",
							}}
							title={pushState.subscription ? "Stop receiving push alerts on this device" : "Enable push alerts on this device"}
						>
							{pushState.subscription ? "Alerts on" : "Enable alerts"}
						</button>

						{isDev ? (
						<button
							type="button"
							className="btn btn--ghost btn--sm ops-reset-btn"
							onClick={() => setConfirmReset(true)}
						>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
							Reset
						</button>
						) : null}
					</div>
				</header>
				<div className="portal__content">
					<Outlet />
				</div>
			</div>

		<OpsTabBar
			operationsNav={flattenNav(operationsNav)}
			platformNav={flattenNav(platformNav)}
			onRoleSwitch={() => {}}
			switchableRoles={[]}
			onReset={() => {
				// Reset is a dev-only tool — same gate as the header button.
				if (isDev) setConfirmReset(true);
			}}
		/>

			{/* In-app confirm for the dev-only data reset — no native dialogs. */}
			{confirmReset && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Confirm reset"
					style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
					onClick={() => setConfirmReset(false)}
				>
					<div
						style={{ background: "var(--background)", border: "1px solid var(--border-light)", padding: "1.5rem", maxWidth: "420px", width: "90%" }}
						onClick={(e) => e.stopPropagation()}
					>
						<h2 style={{ fontSize: "var(--text-base)", fontWeight: 700, marginBottom: "0.5rem" }}>Reset operations data?</h2>
						<p style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", marginBottom: "1rem" }}>
							This resets all operations data back to the original seed state. This cannot be undone.
						</p>
						<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(false)}>
								Cancel
							</button>
							<button
								type="button"
								className="btn btn--sm"
								style={{ color: "#991b1b", borderColor: "#fca5a5" }}
								onClick={() => { setConfirmReset(false); resetOpsState(); }}
							>
								Reset Data
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Floating communication hub — context-aware case chat (§6) */}
			{roleCanAccess(opsRole as OpsRole, "chat") && <CommunicationHub />}
		</div>
		</ChatHubProvider>
		</CasesProvider>
	);
}
