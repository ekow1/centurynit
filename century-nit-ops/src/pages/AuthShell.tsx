import type { ReactNode } from "react";
import { publicSiteUrl } from "../lib/publicSite";

/**
 * The shared split-screen frame every console auth screen lives in.
 *
 * Aside (dark): wordmark + screen chip on top, ONE context block in the
 * middle (a statement or a stepper — never feature marketing), a ruled
 * footer. Stage (paper): a thin bar carrying the screen's position, then
 * the bare form column — no card, no box — with a ruled foot strip for
 * secondary actions.
 */

export type AuthStep = { label: string; hint?: string; state: "done" | "on" | "todo" };

/** ama@centurynit.com → a***@centurynit.com — for "we sent a code" copy. */
export function maskEmail(email: string | null | undefined): string {
	if (!email) return "your email";
	const at = email.indexOf("@");
	if (at <= 0) return "***";
	return `${email[0]}***${email.slice(at)}`;
}

/* ── Stroke icons for the aside — 24×24, square caps, currentColor ── */

const AUTH_ICONS = {
	lock: '<rect x="5" y="11" width="14" height="9"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
	shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9.5 12l2 2 3.5-4"/>',
	mail: '<rect x="3" y="6" width="18" height="12"/><path d="M3 7l9 6 9-6"/>',
	key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8"/><path d="M15 5l3 3"/><path d="M18 2l2 2"/>',
	qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h3v3h-3z"/><path d="M20 14v6h-6"/>',
	clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-5 8-5s6.5 1 8 5"/>',
	pin: '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
	refresh: '<path d="M21 4v6h-6"/><path d="M3 20v-6h6"/><path d="M4 12a8 8 0 0 1 14-5l3 3"/><path d="M20 12a8 8 0 0 1-14 5l-3-3"/>',
	code: '<path d="M8 9l-4 3 4 3"/><path d="M16 9l4 3-4 3"/>',
	eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
} as const;

export type AuthIconName = keyof typeof AUTH_ICONS;

export function AuthIcon({ name }: { name: AuthIconName }) {
	return (
		<svg
			className="ops-login__ic"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="square"
			aria-hidden="true"
			dangerouslySetInnerHTML={{ __html: AUTH_ICONS[name] }}
		/>
	);
}

/** Ruled icon rows for the aside — turns prose context into scannable facts. */
export function AuthFeats({ items }: { items: { icon: AuthIconName; text: ReactNode }[] }) {
	return (
		<div className="ops-login__feats">
			{items.map((it, i) => (
				<div key={i} className="ops-login__feat">
					<span className="ops-login__feat-ic">
						<AuthIcon name={it.icon} />
					</span>
					<span className="ops-login__feat-tx">{it.text}</span>
				</div>
			))}
		</div>
	);
}

export function AuthStepper({ steps }: { steps: AuthStep[] }) {
	return (
		<div className="ops-login__steps">
			{steps.map((s, i) => (
				<div key={s.label} className={`ops-login__step ops-login__step--${s.state}`}>
					<span className="ops-login__step-n">{s.state === "done" ? "✓" : i + 1}</span>
					<span className="ops-login__step-label">{s.label}</span>
					{s.hint ? <span className="ops-login__step-hint">{s.hint}</span> : null}
				</div>
			))}
		</div>
	);
}

export type AuthAsideProps = {
	/** Top-right chip — "Staff only", "Invitation", "Step 2 of 2". */
	chip?: ReactNode;
	/** Mono eyebrow label above the aside statement. */
	label?: ReactNode;
	/** The serif statement — "The code is in your authenticator…". */
	title?: ReactNode;
	/** Supporting copy under the statement. */
	body?: ReactNode;
	/** Stepper rendered under the context block on multi-step flows. */
	steps?: AuthStep[];
	/** Ruled footer — left and right cells. */
	footLeft?: ReactNode;
	footRight?: ReactNode;
};

export type AuthCardProps = {
	/** Stage bar — screen position left, method/step right. */
	barLeft?: ReactNode;
	barRight?: ReactNode;
	/** Footer strip inside the card — secondary actions live here. */
	foot?: ReactNode;
	/** Wider card for QR/code layouts. */
	wide?: boolean;
};

export function AuthShell({
	children,
	aside,
	card,
}: {
	children: ReactNode;
	aside?: AuthAsideProps;
	card?: AuthCardProps;
}) {
	return (
		<div className="ops-login">
			<div className="ops-login__aside">
				<div className="ops-login__top">
					<div className="ops-login__brand">
						<a href={publicSiteUrl()} className="ops-login__logo">
							Century NIT
						</a>
						<p className="ops-login__tagline">Operations Center</p>
					</div>
					{aside?.chip ? <span className="ops-login__chip">{aside.chip}</span> : null}
				</div>

				<div className="ops-login__amid">
					{aside?.label ? <p className="ops-login__ctx-label">{aside.label}</p> : null}
					{aside?.title ? <h3 className="ops-login__ctx-title">{aside.title}</h3> : null}
					{aside?.body ? <div className="ops-login__ctx-body">{aside.body}</div> : null}
					{aside?.steps ? <AuthStepper steps={aside.steps} /> : null}
				</div>

				<div className="ops-login__afoot">
					<span>{aside?.footLeft ?? "Accra · Kumasi"}</span>
					<span>{aside?.footRight ?? "Attempts audited"}</span>
				</div>
			</div>

			<div className="ops-login__main">
				<div className="ops-login__bar">
					<span>{card?.barLeft ?? "Console access"}</span>
					{card?.barRight ? <span className="ops-login__bar-r">{card.barRight}</span> : null}
				</div>
				<div className="ops-login__stage">
					<div className={`ops-login__cardframe${card?.wide ? " ops-login__cardframe--wide" : ""}`}>
						<div className="ops-login__card">{children}</div>
						{card?.foot ? <div className="ops-login__cardfoot">{card.foot}</div> : null}
					</div>
				</div>
			</div>
		</div>
	);
}
