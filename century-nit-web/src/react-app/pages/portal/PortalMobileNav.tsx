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

/** Dashboard destinations for the tab bar - the account avatar owns the Profile slot */
const PORTAL_TABS: PortalTab[] = [
	{ to: "/portal/home", label: "Overview", short: "Home", icon: <IconHome /> },
	{ to: "/portal/journey", label: "Journey", short: "Journey", icon: <IconRoute /> },
	{ to: "/portal/documents", label: "Documents", short: "Docs", icon: <IconDoc /> },
	{ to: "/portal/financial", label: "Financial", short: "Money", icon: <IconWallet /> },
];

/** Stage pages live under the Journey tab, so Journey stays lit while inside one */
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

function isStagePath(pathname: string) {
	return STAGE_PATHS.some((p) => pathname.startsWith(p));
}

/**
 * Compact top app bar for phones - title, back affordance on stage pages,
 * and notifications. The account affordance lives in the tab bar.
 */
export function PortalAppBar({ stageLabel }: { stageLabel: string }) {
	const { pathname } = useLocation();

	const inStage = isStagePath(pathname);
	const activeTab = PORTAL_TABS.find((t) => pathname.startsWith(t.to));
	const title = inStage ? "Journey stage" : (activeTab?.label ?? "Dashboard");

	return (
		<header className="pbar">
			{inStage ? (
				<Link to="/portal/journey" className="pbar__icon-btn" aria-label="Back to journey">
					<IconChevronLeft size={20} />
				</Link>
			) : (
				<Link to="/portal/home" className="pbar__mark" aria-label="Century NIT dashboard">
					CN
				</Link>
			)}

			<div className="pbar__titles">
				<span className="pbar__title">{title}</span>
				<span className="pbar__sub mono">Now · {stageLabel}</span>
			</div>

			<div className="pbar__actions">
				<NotificationBell />
			</div>
		</header>
	);
}

/** Fixed bottom tab bar mirroring the desktop sidebar destinations, with the account avatar in the Profile slot. */
export function PortalTabBar() {
	const [profileOpen, setProfileOpen] = useState(false);
	const profileRef = useRef<HTMLDivElement>(null);
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { authUser, signOut } = useAppState();
	const { toast } = useNotifier();
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
		<nav className="tabbar tabbar--portal" aria-label="Dashboard sections">
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

			<div className="tabbar__profile" ref={profileRef}>
				<button
					type="button"
					className={`tabbar__item${profileOpen ? " tabbar__item--active" : ""}`}
					onClick={() => setProfileOpen((v) => !v)}
					aria-expanded={profileOpen}
					aria-haspopup="menu"
					aria-label="Account menu"
				>
					<Avatar name={authUser?.name ?? ""} image={authUser?.image} className="tabbar__avatar" />
					<span className="tabbar__label">Profile</span>
				</button>
				{profileOpen ? (
					<div className="nav__dropdown nav__dropdown--profile nav__dropdown--tabbar">
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
						<Link
							to="/portal/profile"
							className="nav__dropdown-link"
							onClick={() => setProfileOpen(false)}
						>
							Profile settings
						</Link>
						{/* Support has no tab of its own — it has to be reachable here */}
						<Link
							to="/portal/support"
							className="nav__dropdown-link"
							onClick={() => setProfileOpen(false)}
						>
							Get help
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
		</nav>
	);
}
