import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, checkStaffEmail, requestPasswordReset } from "../lib/api";
import { publicSiteUrl } from "../lib/publicSite";

const MAIL_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

type EmailCheck = "idle" | "checking" | "ok" | "not-staff" | "error";

const NOT_STAFF_MESSAGE =
	"That email isn't linked to a Century NIT staff account. Check for typos, or ask your administrator to invite you.";

/**
 * Staff forgot-password — request a reset email.
 *
 * Better Auth's `sendResetPassword` callback (configured in the API) emails a
 * one-time link. The link resolves through the API, which verifies the token
 * and redirects to `/reset-password?token=...` on this same console origin, so
 * the reset page can collect a new password.
 *
 * The email field is checked against `/api/auth/check-staff-email` as the user
 * types (debounced) so a non-staff address is flagged before submit. The check
 * is a UX aid; the API's `sendResetPassword` callback remains the authority.
 */
export function OpsForgotPassword() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState(false);
	const [emailCheck, setEmailCheck] = useState<EmailCheck>("idle");

	// The check is debounced per keystroke and late responses are dropped so a
	// fast typist never has a stale verdict overwrite a newer one.
	const queryIdRef = useRef(0);
	useEffect(() => {
		const id = ++queryIdRef.current;
		const value = email.trim().toLowerCase();
		if (!/^[^@\s]+@[^@\s]+$/.test(value)) {
			setEmailCheck("idle");
			return;
		}
		setEmailCheck("checking");
		const timer = setTimeout(() => {
			checkStaffEmail(value)
				.then((res) => {
					if (queryIdRef.current !== id) return;
					setEmailCheck(res.isStaff ? "ok" : "not-staff");
				})
				.catch(() => {
					if (queryIdRef.current !== id) return;
					setEmailCheck("error");
				});
		}, 600);
		return () => clearTimeout(timer);
	}, [email]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = email.trim().toLowerCase();
		if (!trimmed.includes("@")) {
			setError("Enter a valid email address.");
			return;
		}
		if (emailCheck === "not-staff") {
			setError(NOT_STAFF_MESSAGE);
			return;
		}
		setError(null);
		setLoading(true);
		try {
			const redirectTo = `${window.location.origin}/reset-password`;
			await requestPasswordReset(trimmed, redirectTo);
			setSent(true);
		} catch (err) {
			if (err instanceof ApiError && err.status === 429) {
				setError("Too many attempts. Wait a minute and try again.");
			} else {
				setError(err instanceof Error ? err.message : "Could not send reset email. Try again.");
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="ops-login">
			<div className="ops-login__aside">
				<div className="ops-login__brand">
					<Link to="/" className="ops-login__logo">
						Century NIT
					</Link>
					<p className="ops-login__tagline">Operations Center</p>
				</div>
				<p className="ops-login__copy">Century NIT &copy; 2026 &middot; Operations Center</p>
			</div>

			<div className="ops-login__main">
				<div className="ops-login__card">
					<div className="ops-login__head">
						<h1 className="ops-login__title">Reset your password</h1>
						<p className="ops-login__subtitle">
							{sent
								? "Check your inbox for a reset link."
								: "Enter your staff email and we'll send a reset link."}
						</p>
					</div>

					{sent ? (
						<div className="ops-login__form">
							<p className="ops-login__subtitle" style={{ marginBottom: "1rem" }}>
								A reset link is on its way to <strong>{email}</strong>.
								The link expires shortly, and only works once.
							</p>
							<button
								type="button"
								onClick={() => navigate("/login")}
								className="btn btn--primary ops-login__submit"
							>
								<span>Back to sign in</span>
								<span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />
							</button>
						</div>
					) : (
						<form onSubmit={handleSubmit} className="ops-login__form">
							<div className="ops-login__field">
								<label className="ops-login__label">
									<span dangerouslySetInnerHTML={{ __html: MAIL_SVG }} />
									Email
								</label>
								<input
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="you@century-nit.com"
									className="ops-login__input"
									required
									autoFocus
								/>
								{emailCheck === "checking" ? (
									<p className="ops-login__hint">Checking…</p>
								) : emailCheck === "not-staff" ? (
									<p className="ops-login__error" role="alert">{NOT_STAFF_MESSAGE}</p>
								) : null}
							</div>

							{error ? (
								<p className="ops-login__error" role="alert">{error}</p>
							) : null}

							<button type="submit" disabled={loading} className="btn btn--primary ops-login__submit">
								<span>{loading ? "Sending…" : "Send reset link"}</span>
								{loading ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
							</button>

							<div style={{ marginTop: "1rem", fontSize: "var(--text-xs)" }}>
								<Link to="/login" className="ops-login__back" style={{ margin: 0 }}>
									&larr; Back to sign in
								</Link>
							</div>
						</form>
					)}
				</div>

				<a href={publicSiteUrl()} className="ops-login__home">
					&larr; Back to public site
				</a>
			</div>
		</div>
	);
}
