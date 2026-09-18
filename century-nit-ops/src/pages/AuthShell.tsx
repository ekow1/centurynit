import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { publicSiteUrl } from "../lib/publicSite";

/**
 * The shared split-screen frame every console auth screen lives in: brand
 * panel on the left, card on the right. Login, MFA challenge, MFA setup,
 * invite acceptance, forgot and reset all render inside this so a staff
 * member sees one continuous surface instead of five unrelated pages.
 */

const SHIELD_SVG =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
const SEARCH_SVG =
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const CHECK_SVG =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

export type AuthFeature = { icon: string; title: string; desc: string };

const DEFAULT_FEATURES: AuthFeature[] = [
	{
		icon: SHIELD_SVG,
		title: "Secure Access",
		desc: "Role-based permissions across every module",
	},
	{
		icon: SEARCH_SVG,
		title: "Unified Workspace",
		desc: "CRM, workflow, finance, and cases in one place",
	},
	{
		icon: CHECK_SVG,
		title: "Real-time Pipeline",
		desc: "Track every application from lead to enrollment",
	},
];

export function AuthShell({
	children,
	features = DEFAULT_FEATURES,
}: {
	children: ReactNode;
	features?: AuthFeature[];
}) {
	return (
		<div className="ops-login">
			<div className="ops-login__aside">
				<div className="ops-login__brand">
					<Link to="/" className="ops-login__logo">
						Century NIT
					</Link>
					<p className="ops-login__tagline">Operations Center</p>
				</div>

				{features.length > 0 && (
					<div className="ops-login__features">
						{features.map((f) => (
							<div className="ops-login__feature" key={f.title}>
								<span
									className="ops-login__feature-icon"
									dangerouslySetInnerHTML={{ __html: f.icon }}
								/>
								<div>
									<p className="ops-login__feature-title">{f.title}</p>
									<p className="ops-login__feature-desc">{f.desc}</p>
								</div>
							</div>
						))}
					</div>
				)}

				<p className="ops-login__copy">
					Century NIT &copy; {new Date().getFullYear()} &middot; Operations Center
				</p>
			</div>

			<div className="ops-login__main">
				<div className="ops-login__card">{children}</div>
				<a href={publicSiteUrl()} className="ops-login__home">
					&larr; Back to public site
				</a>
			</div>
		</div>
	);
}
