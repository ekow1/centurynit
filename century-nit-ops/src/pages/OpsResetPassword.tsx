import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, resetPassword } from "../lib/api";
import { AuthShell } from "./AuthShell";
import { PasswordField, PASSWORD_MIN_LENGTH } from "./PasswordField";

const LOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

/**
 * Staff reset-password — set a new password using the token from the email.
 *
 * Better Auth verifies the token when the email link is clicked, then redirects
 * here with `?token=...`. The token is single-use and short-lived, so a missing
 * or already-consumed token is surfaced as a prompt to request a fresh link
 * rather than a raw error.
 */
export function OpsResetPassword() {
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const token = params.get("token") ?? "";

	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	const mismatch = confirm.length > 0 && password !== confirm;
	const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (password.length < PASSWORD_MIN_LENGTH) {
			setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
			return;
		}
		if (password !== confirm) {
			setError("Passwords don't match.");
			return;
		}
		setError(null);
		setLoading(true);
		try {
			await resetPassword(token, password);
			setDone(true);
		} catch (err) {
			if (err instanceof ApiError && err.status === 429) {
				setError("Too many attempts. Wait a minute and try again.");
			} else if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
				setError("This reset link is invalid or has expired. Request a new one.");
			} else {
				setError(err instanceof Error ? err.message : "Could not reset password. Try again.");
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell
			aside={{
				chip: "Recovery",
				label: "Password reset",
				title: <>Choose a password you haven't used <em>elsewhere</em>.</>,
				body: (
					<>
						This link works once. Saving a new password <strong>ends every other
						session</strong> on this account — including this one.
					</>
				),
			}}
			card={{
				barLeft: "Console access",
				barRight: "Recovery",
				foot: (
					<>
						<span />
						<Link to="/login">Back to sign in</Link>
					</>
				),
			}}
		>
			<div className="ops-login__head">
				<h1 className="ops-login__title">Set a new password</h1>
				<p className="ops-login__subtitle">
					{done
						? "Your password has been updated."
						: token
							? "Choose a new password for your operations account."
							: "Use the link from your reset email to choose a new password."}
				</p>
			</div>

			{done ? (
				<div className="ops-login__form">
					<p className="ops-login__subtitle" style={{ marginBottom: "1rem" }}>
						Sign in with your new password.
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
			) : !token ? (
				<div className="ops-login__form">
					<p className="ops-login__subtitle" style={{ marginBottom: "1rem" }}>
						The reset link may have expired or already been used.
					</p>
					<Link to="/forgot-password" className="btn btn--primary ops-login__submit" style={{ textDecoration: "none" }}>
						<span>Request a new link</span>
						<span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />
					</Link>
					<Link to="/login" className="ops-login__back" style={{ margin: 0 }}>
						&larr; Back to sign in
					</Link>
				</div>
			) : (
				<form onSubmit={handleSubmit} className="ops-login__form">
					<PasswordField
						label={<><span dangerouslySetInnerHTML={{ __html: LOCK_SVG }} />New password</>}
						value={password}
						onChange={setPassword}
						placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
						autoComplete="new-password"
						autoFocus
						showStrength
					/>
					<PasswordField
						label={<><span dangerouslySetInnerHTML={{ __html: LOCK_SVG }} />Confirm password</>}
						value={confirm}
						onChange={setConfirm}
						placeholder="Re-enter your new password"
						autoComplete="new-password"
						matchWith={password}
					/>

					{error ? (
						<p className="ops-login__error" role="alert">{error}</p>
					) : null}

					<button type="submit" disabled={loading || !password || !confirm || tooShort || mismatch} className="btn btn--primary ops-login__submit">
						<span>{loading ? "Saving…" : "Reset password"}</span>
						{loading ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
					</button>

					<Link to="/login" className="ops-login__back" style={{ margin: 0 }}>
						&larr; Back to sign in
					</Link>
				</form>
			)}
		</AuthShell>
	);
}
