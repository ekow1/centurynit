import { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useOpsAuth, ROLE_LABELS, ROLE_HOME, type OpsModule } from "./OpsAuthContext";
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
import { useFeeCatalogue } from "../hooks/useFeeCatalogue";
import { useWorkQueue } from "../hooks/useWorkQueue";
import { useChatConversations } from "../hooks/useChatApi";
import { documentsApi } from "century-nit-core/api";
import { roleCanAccess, type ChatConversation } from "century-nit-shared";
import { isDueToday, isOverdue } from "../lib/pendingTasks";

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

/**
 * The nav, in sections by how often you go there: TODAY is the work that
 * comes to you and carries a live count; WORK is what you go and do; SETUP
 * is what you configure. PLATFORM is the admin's.
 */
type NavSection = { title: string; entries: NavEntry[] };
const SECTIONS: NavSection[] = [
	{
		title: "Today",
		entries: [
			{ to: "/workspace", module: "dashboard", label: "Workspace", blurb: "Action queue & today's work", icon: "dashboard" },
			{ to: "/inbox", module: "dashboard", label: "Inbox", blurb: "What happened", icon: "inbox" },
			{ to: "/helpdesk", module: "helpdesk", label: "Helpdesk", blurb: "Client conversations", icon: "helpdesk" },
			{ to: "/documents", module: "documents", label: "Documents", blurb: "Review queue", icon: "documents" },
		],
	},
	{
		title: "Work",
		entries: [
			{ to: "/dashboard", module: "dashboard", label: "Dashboard", blurb: "The numbers", icon: "dashboard" },
			{
				group: "Cases",
				icon: "applications",
				blurb: "Consultations, cases & clients",
				children: [
					{ to: "/consultations", module: "consultations", label: "Consultations", blurb: "Meetings, assessments & documents", icon: "consultations" },
					{ to: "/applications", module: "applications", label: "Cases", blurb: "Every client's journey — list & board", icon: "applications" },
					{ to: "/applicants", module: "applicants", label: "Clients", blurb: "Client records", icon: "applicants" },
				],
			},
			{ to: "/crm", module: "crm", label: "Leads", blurb: "Every enquiry on the desk", icon: "leads" },
			{ to: "/appointments", module: "appointments", label: "Appointments", blurb: "The week's consultations", icon: "appointments" },
			{ to: "/live-meetings", module: "appointments", label: "Live meetings", blurb: "In-progress video calls", icon: "appointments" },
		],
	},
	{
		title: "Setup",
		entries: [
			{
				group: "Catalogue",
				icon: "universities",
				blurb: "Schools, programmes & packages",
				children: [
					{ to: "/universities", module: "universities", label: "Universities", blurb: "Schools & countries", icon: "universities" },
					{ to: "/programs", module: "programs", label: "Programmes", blurb: "Study programmes", icon: "programs" },
					{ to: "/packages", module: "packages", label: "Packages", blurb: "Service packages & fees", icon: "packages" },
					{ to: "/departure-checklist", module: "applications", label: "Departure checklist", blurb: "What every case does before flying", icon: "packages" },
				],
			},
			{
				group: "Billing",
				icon: "finance",
				blurb: "Invoices, client accounts & fees",
				children: [
					{ to: "/invoices", module: "invoices", label: "Invoices", blurb: "Raise, chase & settle", icon: "finance" },
					{ to: "/ledger", module: "ledger", label: "Client ledger", blurb: "Per-client journal & instalments", icon: "finance" },
					{ to: "/payments", module: "payments", label: "Payments", blurb: "All incoming payments", icon: "finance" },
					{ to: "/fee-schedule", module: "finance", label: "Fee schedule", blurb: "Service fee & third-party fees", icon: "finance" },
					{ to: "/payment-config", module: "payment-config", label: "Payment plans", blurb: "Instalment schedules", icon: "finance" },
				],
			},
			{
				group: "Reports",
				icon: "reports",
				blurb: "Money & operations",
				children: [
					{ to: "/finance", module: "finance", label: "Finance reports", blurb: "Revenue & collections", icon: "finance" },
					{ to: "/reports", module: "reports", label: "Analytics", blurb: "Operations & performance", icon: "reports" },
				],
			},
			{ to: "/scheduling", module: "scheduling", label: "Scheduling", blurb: "The week the branch offers", icon: "appointments" },
			{ to: "/my-calendar", module: "dashboard", label: "My availability", blurb: "Working hours & calendar sync", icon: "appointments" },
			{ to: "/marketing", module: "marketing", label: "Marketing", blurb: "Email & SMS campaigns", icon: "marketing" },
		],
	},
	{
		title: "Platform",
		entries: [
			{ to: "/system", module: "system", label: "System overview", blurb: "Platform health", icon: "system" },
			{
				group: "Access & security",
				icon: "users",
				blurb: "Staff, clients, sign-in & audit",
				children: [
					{ to: "/users", module: "users", label: "Staff & roles", blurb: "Staff directory & matrix", icon: "users" },
					{ to: "/clients", module: "users", label: "Clients directory", blurb: "Accounts, status & ban", icon: "users" },
					{ to: "/auth", module: "auth", label: "Authentication", blurb: "Sign-in & sessions", icon: "auth" },
					{ to: "/audit", module: "system", label: "Audit logs", blurb: "Security & admin trail", icon: "security" },
				],
			},
			{
				group: "Content",
				icon: "cms",
				blurb: "Pages, posts & the site",
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
					{ to: "/settings", module: "settings", label: "System config", blurb: "Integrations & defaults", icon: "settings" },
				],
			},
		],
	},
];

/** The count a TODAY item carries — and whether it is the kind that wants a hand. */
type Counts = Record<string, { n: number; hot: boolean } | undefined>;

function MainNavItem({
	to,
	label,
	blurb,
	icon,
	count,
}: {
	to: string;
	label: string;
	blurb: string;
	icon: string;
	count?: { n: number; hot: boolean };
}) {
	return (
		<NavLink
			to={to}
			title={blurb}
			className={({ isActive }) =>
				`portal-nav__item${isActive ? " portal-nav__item--active" : ""}`
			}
		>
			<Icon name={icon} />
			<span className="portal-nav__meta">
				<span className="portal-nav__label">{label}</span>
			</span>
			{count && count.n > 0 && <span className={`portal-nav__count${count.hot ? " portal-nav__count--hot" : ""}`}>{count.n}</span>}
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
	const { pathname } = useLocation();
	const hasActiveChild = children.some((c) => pathname.startsWith(c.to));
	// Auto-open when a child is active so deep links never hide the active item.
	const [userToggled, setUserToggled] = useState(false);
	const [userOpen, setUserOpen] = useState(defaultOpen);
	const open = userToggled ? userOpen : hasActiveChild || defaultOpen;
	const panelId = `nav-group-${group.toLowerCase().replace(/\s+/g, "-")}`;

	return (
		<div className="portal-nav__group">
			<button
				type="button"
				className={`portal-nav__group-btn${hasActiveChild ? " portal-nav__group-btn--active" : ""}`}
				title={blurb}
				onClick={() => { setUserToggled(true); setUserOpen((v) => !v); }}
				aria-expanded={open}
				aria-controls={panelId}
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
				<div className="portal-nav__sub" id={panelId}>
					{children.map((child) => (
						<MainNavItem key={child.to} {...child} />
					))}
				</div>
			)}
		</div>
	);
}

export function EnterpriseLayout() {
	return (
		<CasesProvider>
			<ChatHubProvider>
				<OpsShell />
			</ChatHubProvider>
		</CasesProvider>
	);
}

/** The signals the shell shows: the queue's counts, the live meeting, the next slot. */
function useShellSignals() {
	const { opsUser, opsRole, canAssignWork, canSeeAllBranches } = useOpsAuth();
	const queue = useWorkQueue();
	const canChat = roleCanAccess(opsRole as never, "chat");
	const { conversations } = useChatConversations(canChat);
	const [pendingDocs, setPendingDocs] = useState(0);
	useEffect(() => {
		let alive = true;
		const load = () =>
			documentsApi
				.list()
				.then((res) => alive && setPendingDocs(res.documents.filter((d) => d.status === "UPLOADED").length))
				.catch(() => {});
		void load();
		const id = setInterval(load, 5 * 60_000);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, []);
	const now = new Date();
	const due = queue.items.filter((t) => isDueToday(t, now) || isOverdue(t, now)).length;
	const awaiting = (conversations as ChatConversation[]).filter((c) => ["applicant", "support", "case", "stage", "entity"].includes(c.type) && c.status === "open" && (Boolean(c.lastMessage?.senderUserId) || (c.unreadCount || 0) > 0)).length;
	const newLeads = queue.leads.filter((l) => l.stage === "new").length;
	const mine = (b: { employeeEmail: string | null; employeeId: string | null }) => Boolean(opsUser) && (b.employeeEmail === opsUser!.email || b.employeeId === opsUser!.opsUserId);
	const inScope = (b: { branchId: string }) => canSeeAllBranches || !opsUser?.branch || b.branchId === opsUser.branch;
	const live = queue.liveBookings.find(mine) ?? (canAssignWork ? queue.liveBookings.find(inScope) : undefined) ?? null;
	const next = queue.items
		.filter((t) => t.kind === "consultation" && t.due && !t.isLive && isDueToday(t, now) && new Date(t.due).getTime() >= now.getTime() - 15 * 60_000)
		.sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime())[0] ?? null;
	const counts: Counts = {
		"/workspace": { n: due, hot: due > 0 },
		"/helpdesk": { n: awaiting, hot: awaiting > 0 },
		"/documents": { n: pendingDocs, hot: pendingDocs > 0 },
		"/crm": { n: newLeads, hot: false },
		"/live-meetings": { n: queue.liveBookings.length, hot: queue.liveBookings.length > 0 },
	};
	const liveMinutes = live ? Math.max(0, Math.round((now.getTime() - new Date(live.startsAt).getTime()) / 60_000)) : 0;
	return { counts, live, liveMinutes, next, liveCount: queue.liveBookings.length };
}

function OpsShell() {
	const { opsUser, opsRole, opsSignOut, hasPermission } = useOpsAuth();
	// Loads the fee catalogue once, which also sets the rate every GHS figure renders at.
	useFeeCatalogue();
	const signals = useShellSignals();
	const [inboxUnread, setInboxUnread] = useState(0);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setMenuOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [menuOpen]);
	const isDev = import.meta.env.DEV;
	const { openCommandPalette, resetOpsState } = useOpsState();
	const location = useLocation();
	const [confirmReset, setConfirmReset] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
	const cmdKey = isMac ? "⌘" : "Ctrl";

	const allowed = (entry: NavEntry) => (isGroup(entry) ? entry.children.some((c) => hasPermission(c.module)) : hasPermission(entry.module));
	const sections = SECTIONS.map((sec) => ({ ...sec, entries: sec.entries.filter(allowed).map((e) => (isGroup(e) ? { ...e, children: e.children.filter((c) => hasPermission(c.module)) } : e)) })).filter((sec) => sec.entries.length > 0);
	const operationsNav = sections.filter((sec) => sec.title !== "Platform").flatMap((sec) => sec.entries);
	const platformNav = sections.filter((sec) => sec.title === "Platform").flatMap((sec) => sec.entries);
	const roleName = opsRole ? ROLE_LABELS[opsRole] : "Staff";
	const counts: Counts = { ...signals.counts, "/inbox": { n: inboxUnread, hot: inboxUnread > 0 } };
	// Breadcrumb: the group (or section) the page sits in, then the page.
	const allNav = [...operationsNav, ...platformNav];
	const breadcrumb = allNav
		.flatMap((e) => (isGroup(e) ? e.children.map((c) => ({ ...c, group: e.group })) : [{ ...e, group: null as string | null }]))
		.find((item) => location.pathname.startsWith(item.to));
	const crumbGroup = breadcrumb?.group ?? sections.find((sec) => sec.entries.some((e) => !isGroup(e) && breadcrumb && e.to === breadcrumb.to))?.title ?? null;

	// The bell badge reflects the real, server-side notification count — not a
	// heuristic derived from polled leads/consultations. Those still get polled
	// by their own pages (inbox, consultations, leads) for their own lists.


	// Silent Web Push subscription — active while a staff member is signed in.
	// The permission prompt is never shown automatically; this only resubscribes
	// returning staff who previously granted permission.
	const pushState = usePushNotifications({ isAuthenticated: Boolean(opsUser) });

	const renderUserMenu = (placement: "up" | "down") => (
			<div className={`ops-menu ops-menu--${placement}`} role="menu">
				<div className="ops-menu__head">
					<div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{opsUser?.name}</div>
					<div className="ops-menu__k">
						{opsUser?.email} · {roleName}
						{opsUser?.branch ? ` · ${staffBranchName(opsUser.branch)}` : ""}
					</div>
				</div>
				<Link to="/my-calendar" className="ops-menu__row" role="menuitem" onClick={() => setMenuOpen(false)}>
					<span>My availability</span>
					<span className="ops-menu__k">hours &amp; calendar</span>
				</Link>
				<button type="button" className="ops-menu__row" role="menuitem" onClick={pushState.subscription ? pushState.unsubscribe : pushState.subscribe}>
					<span>Push alerts on this device</span>
					<span className="ops-menu__k">{pushState.subscription ? "on" : "off"}</span>
				</button>
				<a href={publicSiteUrl()} className="ops-menu__row" role="menuitem">
					<span>Public site</span>
					<span className="ops-menu__k">↗</span>
				</a>
				{isDev && (
					<button type="button" className="ops-menu__row" role="menuitem" onClick={() => { setMenuOpen(false); setConfirmReset(true); }}>
						<span>Reset operations data</span>
						<span className="ops-menu__k">dev</span>
					</button>
				)}
				<button type="button" className="ops-menu__row" role="menuitem" onClick={opsSignOut}>
					<span>Sign out</span>
					<span className="ops-menu__k" />
				</button>
			</div>
	);

	return (
		<div className={`portal${sidebarCollapsed ? " portal--collapsed" : ""}`}>
			<OpsCommandPalette />

			<aside className="portal__aside">
				<div className="portal__brand">
					<Link to={opsRole ? ROLE_HOME[opsRole] : "/"} className="nav__logo">
						Century NIT <span>Operations</span>
					</Link>
					{opsUser && !sidebarCollapsed && (
						<p className="portal__tagline">
							{staffBranchName(opsUser.branch)} · {roleName}
						</p>
					)}
					<button
						type="button"
						className="portal__collapse-btn"
						onClick={() => setSidebarCollapsed((v) => !v)}
						aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
						title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
					</button>
				</div>

				<nav className="portal-nav" aria-label="Console">
					{sections.map((sec, i) => (
						<div key={sec.title} className="portal-nav__section-block">
							<p className={`portal-nav__section${i > 0 ? " portal-nav__section--spaced" : ""}`}>{sec.title}</p>
							{sec.entries.map((entry) =>
								isGroup(entry) ? (
									<MainNavGroup key={entry.group} group={entry.group} icon={entry.icon} blurb={entry.blurb} children={entry.children} defaultOpen={entry.children.some((c) => location.pathname.startsWith(c.to))} />
								) : (
									<MainNavItem key={entry.to} to={entry.to} label={entry.label} blurb={entry.blurb} icon={entry.icon} count={counts[entry.to]} />
								),
							)}
						</div>
					))}
				</nav>

				{opsUser && (
					<div className="portal__user ops-shell__user" ref={sidebarCollapsed ? undefined : menuRef}>
						<button type="button" className="ops-shell__me" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} title={`${opsUser.name} · ${roleName}`}>
							<span className="ops-shell__ini" aria-hidden>
								{opsUser.avatar}
							</span>
							{!sidebarCollapsed && (
								<span className="ops-shell__who">
									<span className="ops-shell__name">{opsUser.name}</span>
									<span className="ops-shell__role">
										{roleName} · {staffBranchName(opsUser.branch)} · online
									</span>
								</span>
							)}
							{!sidebarCollapsed && (
								<span className="ops-shell__more" aria-hidden>
									⋯
								</span>
							)}
						</button>
						{menuOpen && !sidebarCollapsed && renderUserMenu("up")}
					</div>
				)}
			</aside>
			<div className="portal__main">
				{/* Below 960px the sidebar is hidden - the app bar and bottom tabs
				    take over, exactly as they do on the portal and public site. */}
				<OpsAppBar
					title={breadcrumb?.label ?? roleName}
					operationsNav={flattenNav(operationsNav)}
					platformNav={flattenNav(platformNav)}
				/>

				<header className="portal__topbar" style={{ position: "relative" }}>
					<div className="portal__topbar-left">
						<nav className="ops-breadcrumb" aria-label="Breadcrumb">
							{crumbGroup && (
								<>
									<span className="ops-breadcrumb__root">{crumbGroup}</span>
									<span className="ops-breadcrumb__sep" aria-hidden>/</span>
								</>
							)}
							<span className="ops-breadcrumb__current" aria-current="page">{breadcrumb?.label ?? roleName}</span>
						</nav>
					</div>
					<div className="portal__topbar-right">
						<button
							type="button"
							onClick={openCommandPalette}
							className="ops-search-trigger"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
							<span>Search everywhere</span>
							<kbd>{cmdKey}K</kbd>
						</button>

						{/* Now — the live consultation from any page; else the next slot today. */}
						{signals.live ? (
							<a className="ops-live" href={signals.live.meetingUrl ?? "/live-meetings"} target={signals.live.meetingUrl ? "_blank" : undefined} rel={signals.live.meetingUrl ? "noreferrer" : undefined} title="Join the live meeting">
								<span className="cn-now__dot" style={{ background: "currentColor" }} aria-hidden />
								Live · {signals.live.clientName} · {signals.liveMinutes} min{signals.live.meetingUrl ? " · join" : ""}
							</a>
						) : signals.next ? (
							<Link className="ops-live ops-live--next" to={signals.next.linkTo} title="Your next consultation today">
								<span className="cn-now__dot cn-now__dot--hollow" aria-hidden />
								Next {new Date(signals.next.due!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {signals.next.title}
							</Link>
						) : null}

						<OpsNotificationBell onUnread={setInboxUnread} />

						{opsUser && (
							<div className="portal__topbar-user" ref={sidebarCollapsed ? menuRef : undefined}>
								<button type="button" className="ops-shell__topuser" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} title={opsUser.name}>
									<span className="portal__topbar-avatar" aria-hidden>
										{opsUser.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
									</span>
									<span className="portal__topbar-user-name">{opsUser.name.split(" ")[0]}</span>
									<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
								</button>
								{menuOpen && sidebarCollapsed && renderUserMenu("down")}
							</div>
						)}
					</div>
				</header>
				<div className="portal__content" id="main-content" tabIndex={-1}>
					<Outlet />
				</div>
			</div>

		<OpsTabBar
			operationsNav={flattenNav(operationsNav)}
			platformNav={flattenNav(platformNav)}
		/>

			{/* In-app confirm for the dev-only data reset — no native dialogs. */}
			{confirmReset && (
				<ConfirmResetDialog
					onCancel={() => setConfirmReset(false)}
					onConfirm={() => { setConfirmReset(false); resetOpsState(); }}
				/>
			)}

			{/* Floating communication hub — context-aware case chat (§6) */}
			{hasPermission("chat") && <CommunicationHub />}
		</div>
	);
}

/** Dev-only reset confirm dialog with proper focus trap, Escape, and restore. */
function ConfirmResetDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const previouslyFocused = document.activeElement as HTMLElement | null;
		const dialog = dialogRef.current;
		const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

		const trapFocus = (e: KeyboardEvent) => {
			if (e.key === "Escape") { onCancel(); return; }
			if (e.key !== "Tab" || !dialog) return;
			const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault(); last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault(); first.focus();
			}
		};

		cancelRef.current?.focus();
		document.addEventListener("keydown", trapFocus);
		return () => {
			document.removeEventListener("keydown", trapFocus);
			previouslyFocused?.focus?.();
		};
	}, [onCancel]);

	return (
		<div
			className="ops-modal-backdrop"
			onClick={onCancel}
		>
			<div
				ref={dialogRef}
				className="ops-modal"
				role="dialog"
				aria-modal="true"
				aria-label="Confirm reset"
				style={{ maxWidth: "420px" }}
				onClick={(e) => e.stopPropagation()}
			>
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">Reset operations data?</h2>
						<p className="ops-modal__sub">This cannot be undone</p>
					</div>
				</header>
				<p className="muted" style={{ fontSize: "var(--text-sm)" }}>
					This resets all operations data back to the original seed state.
				</p>
				<div className="cal-actions" style={{ marginTop: "1.5rem" }}>
					<button type="button" ref={cancelRef} className="btn btn--ghost btn--sm" onClick={onCancel}>
						Cancel
					</button>
					<button type="button" className="btn btn--sm ops-btn--danger" onClick={onConfirm}>
						Reset Data
					</button>
				</div>
			</div>
		</div>
	);
}
