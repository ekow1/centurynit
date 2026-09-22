import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { publicSiteUrl } from "../lib/publicSite";

/**
 * The shared split-screen frame every console auth screen lives in: brand
 * panel on the left, card on the right. Login, MFA challenge, MFA setup,
 * invite acceptance, forgot and reset all render inside this so a staff
 * member sees one continuous surface instead of five unrelated pages.
 *
 * The aside's middle slot is `context` — per-screen content that answers
 * "what is this screen, who is it for, who do I contact": a context card,
 * a stepper on multi-step flows, or nothing on the simplest screens.
 */

export type AuthStep = { label: string; sub?: string; state: "done" | "on" | "todo" };

/** ama@centurynit.com → a***@centurynit.com — for "we sent a code" copy. */
export function maskEmail(email: string | null | undefined): string {
	if (!email) return "your email";
	const at = email.indexOf("@");
	if (at <= 0) return "***";
	return `${email[0]}***${email.slice(at)}`;
}

export function AuthContextCard({
	title,
	children,
	fine,
}: {
	title: string;
	children: ReactNode;
	fine?: ReactNode;
}) {
	return (
		<div className="ops-login__ctx">
			<p className="ops-login__ctx-title">{title}</p>
			<div className="ops-login__ctx-body">{children}</div>
			{fine ? <p className="ops-login__ctx-fine">{fine}</p> : null}
		</div>
	);
}

export function AuthStepper({ steps }: { steps: AuthStep[] }) {
	return (
		<div className="ops-login__steps">
			{steps.map((s, i) => (
				<div key={s.label} className={`ops-login__step ops-login__step--${s.state}`}>
					<span className="ops-login__step-n">{s.state === "done" ? "✓" : i + 1}</span>
					<span>
						{s.label}
						{s.sub ? <span className="ops-login__step-sub">{s.sub}</span> : null}
					</span>
				</div>
			))}
		</div>
	);
}

export function AuthShell({
	children,
	context,
	copy,
}: {
	children: ReactNode;
	context?: ReactNode;
	copy?: ReactNode;
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

				{context ? <div className="ops-login__aside-mid">{context}</div> : <div />}

				<p className="ops-login__copy">
					{copy ?? (
						<>
							Century NIT &copy; {new Date().getFullYear()} &middot; Operations Center
						</>
					)}
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
