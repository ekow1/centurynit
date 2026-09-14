import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAppState } from "../../context/AppState";
import { useNotifier } from "../../components/notifier/Notifier";
import { Avatar } from "../../components/ui/Avatar";
import { NotificationBell } from "./NotificationBell";
import {
	IconChevronLeft,
	IconDoc,
	IconHome,
	IconRoute,
	IconWallet,
} from "../../components/ui/Icons";

type PortalTab = {
	to: string;
	label: string;
	short: string;
	icon: React.ReactNode;
};

/** The phone's destinations — Help is the fifth slot, and it opens the chat. */
const PORTAL_TABS: PortalTab[] = [
	{ to: "/portal/home", label: "Home", short: "Home", icon: <IconHome /> },
	{ to: "/portal/journey", label: "Journey", short: "Journey", icon: <IconRoute /> },
	{ to: "/portal/documents", label: "Documents", short: "Files", icon: <IconDoc /> },
	{ to: "/portal/financial", label: "Money", short: "Money", icon: <IconWallet /> },
];

/** Stage pages live under the Journey tab, so Journey stays lit while inside one */
const STAGE_PATHS = [
	"/portal/consultation",
	"/portal/package",
	"/portal/application",
	"/portal/tracking",
	"/portal/visa",
	"/portal/visa/tracking",
	"/portal/payment-execution",
	"/portal/pre-departure",
	"/portal/complete",
];

function isStagePath(pathname: string) {
	return STAGE_PATHS.some((p) => pathname.startsWith(p));
}

function openChat() {
	window.dispatchEvent(new CustomEvent("open-chat", { detail: { channel: "support" } }));
}

/**
 * Compact top app bar for phones — the page's name with its chapter as the
 * kicker, a back affordance on stage pages, the bell, the account menu, and
 * the one thing to do next as a strip under the bar.
 */
export function PortalAppBar({
	title,
	kicker,
	next,
}: {
	title: string;
	kicker: string | null;
	next: { label: string; to: string; detail?: string } | null;
}) {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { authUser, signOut } = useAppState();
	const { toast } = useNotifier();
	const [profileOpen, setProfileOpen] = useState(false);
	const profileRef = useRef<HTMLDivElement>(null);
	const inStage = isStagePath(pathname);

	// Close the account dropdown on outside taps
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
		<header className="pbar pbar--stacked">
			<div className="pbar__row">
				{inStage ? (
					<Link to="/portal/journey" className="pbar__icon-btn" aria-label="Back to journey">
						<IconChevronLeft size={20} />
					</Link>
				) : (
					<Link to="/portal/home" className="pbar__mark" aria-label="Century NIT portal">
						CN
					</Link>
				)}

				<div className="pbar__titles">
					<span className="pbar__title">{title}</span>
					{kicker && <span className="pbar__sub mono">{kicker}</span>}
				</div>

				<div className="pbar__actions">
					<NotificationBell />
					<div className="tabbar__profile" ref={profileRef}>
						<button
							type="button"
							className="pbar__icon-btn"
							onClick={() => setProfileOpen((v) => !v)}
							aria-expanded={profileOpen}
							aria-haspopup="menu"
							aria-label="Account menu"
						>
							<Avatar name={authUser?.name ?? ""} image={authUser?.image} className="tabbar__avatar" />
						</button>
						{profileOpen ? (
							<div className="nav__dropdown nav__dropdown--profile pbar__menu">
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
								<Link to="/portal/profile" className="nav__dropdown-link" onClick={() => setProfileOpen(false)}>
									Profile
								</Link>
								<Link to="/portal/appointments" className="nav__dropdown-link" onClick={() => setProfileOpen(false)}>
									Appointments
								</Link>
								<Link to="/" className="nav__dropdown-link" onClick={() => setProfileOpen(false)}>
									Public site
								</Link>
								<hr className="nav__dropdown-rule" />
								<button
									type="button"
									className="nav__dropdown-link nav__dropdown-link--danger"
									onClick={async () => {
										try {
											await signOut();
										} catch (err) {
											console.error("Sign out failed on the server", err);
											toast.error(
												"Couldn't reach the server to end your session — please try again. Your account is still signed in.",
											);
											return;
										}
										setProfileOpen(false);
										navigate("/");
									}}
								>
									Sign out
								</button>
							</div>
						) : null}
					</div>
				</div>
			</div>
			{next && (
				<Link to={next.to} className="pbar__next" title={next.detail}>
					<span className="pbar__next-k">Next</span>
					<span className="pbar__next-l">{next.label}</span>
					<span aria-hidden>→</span>
				</Link>
			)}
		</header>
	);
}

/** Fixed bottom tab bar: Home · Journey · Files · Money · Help — Help opens the chat. */
export function PortalTabBar() {
	const { pathname } = useLocation();
	const inStage = isStagePath(pathname);

	return (
		<nav className="tabbar tabbar--portal" aria-label="Portal sections">
			{PORTAL_TABS.map((tab) => (
				<NavLink
					key={tab.to}
					to={tab.to}
					className={({ isActive }) => {
						const active = isActive || (tab.to === "/portal/journey" && inStage);
						return `tabbar__item${active ? " tabbar__item--active" : ""}`;
					}}
				>
					{tab.icon}
					<span className="tabbar__label">{tab.short}</span>
				</NavLink>
			))}
			<button type="button" className="tabbar__item" onClick={openChat} aria-label="Message your consultant">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
					<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
				</svg>
				<span className="tabbar__label">Help</span>
			</button>
		</nav>
	);
}
