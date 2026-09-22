import type { ReactNode } from "react";
import { publicSiteUrl } from "../lib/publicSite";

/**
 * The shared split-screen frame every console auth screen lives in.
 *
 * Aside (dark): wordmark + screen chip on top, ONE context block in the
 * middle (a statement or a stepper — never feature marketing), a ruled
 * footer. Stage (paper): a thin bar carrying the screen's position, then
 * a hard-bordered card with an amber rule on top and a footer strip for
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
						<div className="ops-login__cardrule" />
						<div className="ops-login__cardinner">
							<div className="ops-login__card">{children}</div>
						</div>
						{card?.foot ? <div className="ops-login__cardfoot">{card.foot}</div> : null}
					</div>
				</div>
			</div>
		</div>
	);
}
