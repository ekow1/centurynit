import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useAppState } from "../../context/AppState";
import { useNotifier } from "../../components/notifier/Notifier";
import {
	PORTAL_CHAPTERS,
	type PortalChapterId,
	type ProcessStageId,
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
 * Sidebar groups — the four top-level dashboard pages.
 * The stage pages (consultation, package, …) stay as sub-pages under Journey.
 */
const MAIN_NAV = [
	{ to: "/portal/home", label: "Overview", blurb: "What's happening now", Icon: IconHome },
	{ to: "/portal/profile", label: "Profile", blurb: "Your account & data", Icon: IconUser },
	{ to: "/portal/journey", label: "Journey", blurb: "All stages & tracking", Icon: IconRoute },
	{ to: "/portal/appointments", label: "Appointments", blurb: "Book, reschedule, join", Icon: IconRoute },
	{ to: "/portal/documents", label: "Documents", blurb: "Upload & verification", Icon: IconDoc },
	{ to: "/portal/financial", label: "Financial", blurb: "Payments & balances", Icon: IconWallet },
	// Support is now the floating CommunicationCenter chat (bottom-right), not a page.
] as const;

/** Stage pages are sub-pages of the Journey hub */
const STAGE_PATHS = [
	"/portal/consultation",
	"/portal/package",
	"/portal/application",
	"/portal/tracking",
	"/portal/visa",
	"/portal/payment-plan",
	"/portal/agency",
	"/portal/pre-departure",
	"/portal/complete",
];

function MainNavItem({
	to,
	label,
	blurb,
	Icon,
	active,
}: {
	to: string;
	label: string;
	blurb: string;
	Icon: typeof IconHome;
	active: boolean;
}) {
	return (
		<NavLink
			to={to}
			className={({ isActive }) =>
				`portal-nav__item${isActive || active ? " portal-nav__item--active" : ""}`
			}
		>
			<span className="portal-nav__seal portal-nav__seal--open" aria-hidden>
				<span className="portal-nav__icon">
					<Icon size={18} />
				</span>
			</span>
			<span className="portal-nav__meta">
				<span className="portal-nav__label">{label}</span>
				<span className="portal-nav__blurb">{blurb}</span>
			</span>
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
	} = useAppState();
	const { toast } = useNotifier();
	const { pathname } = useLocation();
	const currentStage = journeyPhase.stage;

	// The Journey item stays active on any stage sub-page
	const inJourney = pathname === "/portal/journey" || STAGE_PATHS.some((p) => pathname.startsWith(p));

	const currentRef =
		application.applicationId ?? booking.confirmationId ?? null;

	return (
		<div className="portal">
			<aside className="portal__aside">
				<div className="portal__brand">
					<Link to="/portal/home" className="nav__logo">
						Century NIT <span>Dashboard</span>
					</Link>
					<p className="portal__tagline">Your full application journey</p>
				</div>

				<nav className="portal-nav" aria-label="Applicant pages">
					{MAIN_NAV.map((item) => (
						<MainNavItem
							key={item.to}
							{...item}
							active={item.to === "/portal/journey" ? inJourney : false}
						/>
					))}
				</nav>

				<div className="portal__user">
					{authUser ? (
						<>
							<p className="portal__user-name">{authUser.name}</p>
							<p className="portal__user-email muted">{authUser.email}</p>
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={async () => {
									try {
										await signOut();
									} catch (err) {
										console.error("Sign out failed on the server", err);
										toast.error(
											"Couldn't reach the server to end your session — please try again. Your account is still signed in.",
										);
									}
								}}
							>
								Sign out
							</button>
						</>
					) : null}
					<Link to="/" className="link-arrow portal__home">
						← Public site
					</Link>
				</div>
			</aside>

			<div className="portal__main">
				{/* Phones get a native app bar + bottom tabs instead of the dark sidebar */}
				<PortalAppBar stageLabel={STAGE_SHORT[currentStage]} />

				<header className="portal__topbar">
					<div>
						<p className="eyebrow">Applicant dashboard</p>
						<p className="portal__welcome">
							{authUser ? `Welcome, ${authUser.name.split(" ")[0]}` : "Welcome"}
						</p>
					</div>
					<div className="portal__topbar-status" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
						<NotificationBell />
						<span className="portal-pill">{stagePill(currentStage)}</span>
					</div>
				</header>
				<div className="portal__content">
					<MfaPrompt />
					<Outlet />
				</div>
				<footer className="portal__bottombar">
					<span className="portal__bottombar-stage mono">
						Stage {journeyPhase.phase} · {stagePill(currentStage)}
					</span>
					{currentRef ? (
						<span className="portal__bottombar-ref mono">
							{currentRef}
						</span>
					) : (
						<span className="portal__bottombar-ref mono muted">No reference yet</span>
					)}
				</footer>
			</div>
			<CommunicationCenter />
			<PortalTabBar />
			<OnboardingModal />
		</div>
	);
}

/** Desktop-width stage name. Phones use the shorter STAGE_SHORT names instead. */
function stagePill(s: ProcessStageId) {
	const map: Record<ProcessStageId, string> = {
		consultation: "Consultation",
		eligibility: "Eligibility review",
		school_package: "School package",
		school_select: "School selection",
		application_invoice: "Application invoice",
		school_tracking: "Application tracking",
		visa_invoice: "Visa invoice",
		visa: "Visa tracking",
		pre_departure: "Travel & pre-departure",
		completed: "Completed",
	};
	return map[s];
}

/** Locked stages show a sealed gate until prior step unlocks them */
export function ChapterGate({
	chapter,
	children,
}: {
	chapter: PortalChapterId;
	children: React.ReactNode;
}) {
	const { chapterUnlocks } = useAppState();
	const meta = PORTAL_CHAPTERS.find((c) => c.id === chapter);

	if (chapterUnlocks[chapter]) {
		return <>{children}</>;
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
