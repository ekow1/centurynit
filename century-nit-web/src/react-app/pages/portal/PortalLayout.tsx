import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useAppState } from "../../context/AppState";
import { useNotifier } from "../../components/notifier/Notifier";
import {
	PORTAL_CHAPTERS,
	type PortalChapterId,
} from "century-nit-core";
import { STAGE_SHORT } from "../../data/stageLabels";
import {
	IconDoc,
	IconHome,
	IconRoute,
	IconUser,
	IconWallet,
} from "../../components/ui/Icons";
import { NotificationBell } from "./NotificationBell";
import { CommunicationCenter } from "./CommunicationCenter";
import { PortalAppBar, PortalTabBar } from "./PortalMobileNav";
import { OnboardingModal } from "../../components/portal/OnboardingModal";
import { MfaPrompt } from "../../components/portal/MfaPrompt";

/**
 * The sidebar is the journey: the six chapters as the spine — done, current,
 * locked — then the client's files. Home stays a page (the chapter map);
 * support is the floating CommunicationCenter, not a page.
 */
const MAIN_NAV = [
	{ to: "/portal/home", label: "Home", blurb: "What's happening now", Icon: IconHome },
	{ to: "/portal/documents", label: "Documents", blurb: "Upload & verification", Icon: IconDoc },
	{ to: "/portal/financial", label: "Money", blurb: "Invoices, fees & balances", Icon: IconWallet },
	{ to: "/portal/appointments", label: "Appointments", blurb: "Book, reschedule, join", Icon: IconRoute },
	{ to: "/portal/profile", label: "Profile", blurb: "Your account & data", Icon: IconUser },
] as const;

/** The six chapters the client sees, each pointing at its page. V covers both departure pages. */
const CHAPTER_NAV: { numeral: string; label: string; to: string; ids: PortalChapterId[]; prefixes: string[] }[] = [
	{ numeral: "I", label: "Consultation", to: "/portal/consultation", ids: ["consultation"], prefixes: ["/portal/consultation"] },
	{ numeral: "II", label: "Enrolment", to: "/portal/package", ids: ["package"], prefixes: ["/portal/package", "/portal/payment-plan", "/portal/agency"] },
	{ numeral: "III", label: "Applications", to: "/portal/application", ids: ["application", "tracking"], prefixes: ["/portal/application", "/portal/tracking"] },
	{ numeral: "IV", label: "Visa", to: "/portal/visa", ids: ["visa"], prefixes: ["/portal/visa"] },
	{ numeral: "V", label: "Departure", to: "/portal/pre-departure", ids: ["travel_assistance", "payment_execution"], prefixes: ["/portal/pre-departure", "/portal/payment-execution"] },
	{ numeral: "VI", label: "Complete", to: "/portal/complete", ids: ["complete"], prefixes: ["/portal/complete"] },
];

function MainNavItem({
	to,
	label,
	blurb,
	Icon,
	active,
	note,
	hot,
}: {
	to: string;
	label: string;
	blurb: string;
	Icon: typeof IconHome;
	active: boolean;
	note?: string | null;
	hot?: boolean;
}) {
	return (
		<NavLink
			to={to}
			title={blurb}
			className={({ isActive }) =>
				`portal-nav__item${isActive || active ? " portal-nav__item--active" : ""}`
			}
		>
			<span className="portal-nav__icon">
				<Icon size={18} />
			</span>
			<span className="portal-nav__meta">
				<span className="portal-nav__label">{label}</span>
			</span>
			{note && <span className={`portal-nav__count${hot ? " portal-nav__count--hot" : ""}`}>{note}</span>}
		</NavLink>
	);
}

export function PortalLayout() {
	const {
		authUser,
		signOut,
		application,
		booking,
		journeyPhase,
		chapterUnlocks,
		pendingAction,
	} = useAppState();
	const { toast } = useNotifier();
	const { pathname } = useLocation();
	const currentStage = journeyPhase.stage;
	const currentRef = application.appNumber ?? booking.confirmationId ?? null;
	const consultant = application.assignedStaffName ?? booking.consultantName ?? null;

	// The chapters' states: unlocked from the server's journey; done when the
	// next chapter is open; the last open one is current.
	const unlocked = CHAPTER_NAV.map((c) => c.ids.some((id) => chapterUnlocks[id]));
	const lastOpen = unlocked.lastIndexOf(true);
	const chapterState = (i: number): "done" | "current" | "locked" => (!unlocked[i] ? "locked" : i < lastOpen ? "done" : "current");
	const activeChapter = CHAPTER_NAV.findIndex((c) => c.prefixes.some((pre) => pathname.startsWith(pre)));
	const kickerChapter = activeChapter >= 0 ? CHAPTER_NAV[activeChapter] : lastOpen >= 0 ? CHAPTER_NAV[lastOpen] : null;

	let pageTitle = "Home";
	const activeNav = MAIN_NAV.find((n) => pathname.startsWith(n.to));
	if (activeNav) pageTitle = activeNav.label;
	else if (activeChapter >= 0) pageTitle = CHAPTER_NAV[activeChapter].label;
	else if (pathname === "/portal/journey") pageTitle = "Journey";

	// The Documents note: the review's state, not a count — the vault is its own fetch.
	const docsNote = application.docReviewStatus === "rejected" ? "fix" : application.docReviewStatus === "pending" ? "in review" : null;
	const docsHot = application.docReviewStatus === "rejected";

	return (
		<div className="portal">
			<aside className="portal__aside">
				<div className="portal__brand">
					<Link to="/portal/home" className="nav__logo">
						Century NIT <span>Student portal</span>
					</Link>
					<p className="portal__tagline">
						{currentRef ?? "No reference yet"}
						{authUser?.name ? ` · ${authUser.name}` : ""}
					</p>
				</div>

				<nav className="portal-nav" aria-label="Your journey">
					<p className="portal-nav__section">Your journey</p>
					{CHAPTER_NAV.map((c, i) => {
						const state = chapterState(i);
						const on = activeChapter === i;
						const meta = PORTAL_CHAPTERS.find((pc) => pc.id === c.ids[0]);
						return state === "locked" ? (
							<span key={c.numeral} className="portal-ch portal-ch--locked" title={meta?.unlockHint ?? "Locked"} aria-disabled="true">
								<span className="portal-ch__m">{c.numeral}</span>
								<span className="portal-ch__l">{c.label}</span>
								<span className="portal-ch__s">{meta?.unlockHint ? meta.unlockHint.replace(/^Unlocks /i, "") : "locked"}</span>
							</span>
						) : (
							<NavLink key={c.numeral} to={c.to} className={`portal-ch portal-ch--${state}${on ? " portal-ch--on" : ""}`} title={meta?.blurb}>
								<span className="portal-ch__m">{state === "done" ? "✓" : c.numeral}</span>
								<span className="portal-ch__l">{c.label}</span>
								{state === "current" && !on && <span className="portal-ch__s">now</span>}
							</NavLink>
						);
					})}
					<p className="portal-nav__section portal-nav__section--spaced">Your files</p>
					{MAIN_NAV.map((item) => (
						<MainNavItem
							key={item.to}
							to={item.to}
							label={item.label}
							blurb={item.blurb}
							Icon={item.Icon}
							active={false}
							note={item.to === "/portal/documents" ? docsNote : item.to === "/portal/home" && pendingAction ? "1" : null}
							hot={item.to === "/portal/documents" ? docsHot : item.to === "/portal/home" && Boolean(pendingAction)}
						/>
					))}
				</nav>

				<div className="portal__user ops-shell__user">
					{authUser && (
						<div className="ops-shell__me" style={{ cursor: "default" }}>
							<span className="ops-shell__ini" aria-hidden>
								{authUser.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
							</span>
							<span className="ops-shell__who">
								<span className="ops-shell__name">{authUser.name}</span>
								<span className="ops-shell__role">Applicant{consultant ? ` · ${consultant}` : ""}</span>
							</span>
							<button
								type="button"
								className="ops-shell__more"
								onClick={async () => {
									try {
										await signOut();
									} catch (err) {
										console.error("Sign out failed on the server", err);
										toast.error("Couldn't reach the server to end your session — please try again. Your account is still signed in.");
									}
								}}
								title="Sign out"
								aria-label="Sign out"
								style={{ background: "none", border: 0, cursor: "pointer" }}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
							</button>
						</div>
					)}
				</div>
			</aside>

			<div className="portal__main">
				{/* Phones get a native app bar + bottom tabs instead of the dark sidebar */}
				<PortalAppBar
					title={pageTitle}
					kicker={kickerChapter ? `${kickerChapter.numeral} · ${kickerChapter.label}` : STAGE_SHORT[currentStage]}
					next={pendingAction}
				/>
				<header className="portal__topbar">
					<div className="portal__topbar-left">
						<nav className="ops-breadcrumb" aria-label="Where you are">
							{kickerChapter && (
								<>
									<span className="ops-breadcrumb__root">
										{kickerChapter.numeral} · {kickerChapter.label}
									</span>
									<span className="ops-breadcrumb__sep" aria-hidden>/</span>
								</>
							)}
							<span className="ops-breadcrumb__current" aria-current="page">{pageTitle}</span>
						</nav>
					</div>
					<div className="portal__topbar-status" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
						{pendingAction && (
							<Link to={pendingAction.to} className="portal-next" title={pendingAction.detail}>
								Next · {pendingAction.label} →
							</Link>
						)}
						<NotificationBell />
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							onClick={() => window.dispatchEvent(new CustomEvent("open-chat", { detail: { channel: "support" } }))}
						>
							{consultant ? `Message ${consultant.split(" ")[0]}` : "Message us"}
						</button>
					</div>
				</header>
				<div className="portal__content">
					<MfaPrompt />
					<Outlet />
				</div>
			</div>
			<CommunicationCenter />
			<PortalTabBar />
			<OnboardingModal />
		</div>
	);
}

/** Locked stages show a sealed gate until prior step unlocks them */
export function ChapterGate({
	chapter,
	children,
}: {
	chapter: PortalChapterId;
	children: React.ReactNode;
}) {
	const { chapterUnlocks, journeyReady } = useAppState();
	const meta = PORTAL_CHAPTERS.find((c) => c.id === chapter);

	if (chapterUnlocks[chapter]) {
		return <>{children}</>;
	}

	// No answer from the server yet (cold first load, nothing cached): say
	// nothing rather than flash "Stage locked" at someone who may be mid-way.
	if (!journeyReady) {
		return (
			<div className="chapter-gate" aria-busy="true">
				<p className="eyebrow">Loading your journey…</p>
			</div>
		);
	}

	return (
		<div className="chapter-gate">
			<div className="chapter-gate__seal" aria-hidden>
				<span className="chapter-gate__roman">{meta?.step ?? "⌀"}</span>
				<span className="chapter-gate__ring" />
			</div>
			<p className="eyebrow">Stage locked</p>
			<h1 className="page-title mt-1">{meta?.label ?? "Next stage"}</h1>
			<p className="lead mt-2">{meta?.unlockHint ?? "Complete the previous step first."}</p>
			<p className="muted mt-3" style={{ maxWidth: "28rem" }}>
				Finish the open stage, then use <strong>Next</strong> - that unlocks this page in the sidebar.
			</p>
			<div className="row mt-4">
				<Link to="/portal/home" className="btn btn--primary">
					Dashboard home →
				</Link>
			</div>
		</div>
	);
}
