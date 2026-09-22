import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	getMfaEnrollment,
	sendMfaOtp,
	verifyMfaOtp,
	verifySessionTotp,
	ApiError,
} from "../lib/api";
import { useOpsAuth, ROLE_HOME } from "./OpsAuthContext";
import { AuthShell, AuthContextCard, maskEmail } from "./AuthShell";
import { OtpInput } from "./OtpInput";

const ARROW_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

/**
 * The second-factor challenge for an ESTABLISHED session.
 *
 * Staff who sign in with Google never pass the twoFactor plugin's pending
 * window — the OAuth callback mints a session directly. The API marks such
 * sessions as owing a factor (`challengeRequired` on GET /auth-settings/mfa)
 * and refuses staff data until it is answered; OpsRequireAuth sends them here.
 *
 * TOTP is verified by /auth-settings/mfa/verify-totp, email codes by
 * /auth-settings/mfa/verify-otp — both mark the session on success, so the
 * gate opens for this session only.
 */
export function MfaChallenge() {
	const navigate = useNavigate();
	const { opsUser, opsSignOut } = useOpsAuth();
	const [method, setMethod] = useState<string | null>(null);
	const [email, setEmail] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [otpSent, setOtpSent] = useState(false);
	const [resendCooldown, setResendCooldown] = useState(0);

	const home = opsUser ? ROLE_HOME[opsUser.role] : "/login";

	useEffect(() => {
		let active = true;
		getMfaEnrollment()
			.then(async (s) => {
				if (!active) return;
				if (!s.enrolled || !s.challengeRequired) {
					// Nothing owed — enrolled-and-verified, or no factor at all.
					navigate(home, { replace: true });
					return;
				}
				const m = s.method ?? "totp";
				setMethod(m);
				setLoading(false);
				if (m === "email_otp") {
					setEmail(opsUser?.email ?? null);
					try {
						await sendMfaOtp();
						if (active) setOtpSent(true);
					} catch {
						if (active) setError("Could not send the verification code. Try resending.");
					}
				}
			})
			.catch(() => {
				if (active) navigate("/login", { replace: true });
			});
		return () => {
			active = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (resendCooldown <= 0) return;
		const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
		return () => clearTimeout(t);
	}, [resendCooldown]);

	// Auto-submit once the full 6 digits are typed.
	useEffect(() => {
		if (loading || busy || code.length !== 6) return;
		const form = document.getElementById("mfa-challenge-form") as HTMLFormElement | null;
		form?.requestSubmit?.();
	}, [code, loading, busy]);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (code.length !== 6) return;
		setBusy(true);
		setError(null);
		try {
			if (method === "email_otp") {
				await verifyMfaOtp(code);
			} else {
				await verifySessionTotp(code);
			}
			navigate(home, { replace: true });
		} catch (err) {
			setError(
				err instanceof ApiError && err.code === "MFA_FAILED"
					? err.message
					: "Incorrect code. Try again.",
			);
			setCode("");
		} finally {
			setBusy(false);
		}
	}

	async function resend() {
		setError(null);
		try {
			await sendMfaOtp();
			setOtpSent(true);
			setResendCooldown(30);
		} catch {
			setError("Could not resend code");
		}
	}

	function useDifferentMethod() {
		opsSignOut();
		navigate("/login", { replace: true });
	}

	if (loading) {
		return (
			<AuthShell>
				<div className="route-loading" role="status" aria-live="polite">
					<span className="route-loading__spinner" aria-hidden="true" />
				</div>
			</AuthShell>
		);
	}

	const accountEmail = opsUser?.email ?? email;
	return (
		<AuthShell
			context={
				<AuthContextCard
					title="Two-factor check"
					fine={<>Lost the device? A manager resets MFA from<br />Administration &rarr; Authentication &rarr; MFA roster.</>}
				>
					<p>
						{method === "email_otp"
							? <>A 6-digit code was sent to <strong>{maskEmail(accountEmail)}</strong>. It expires shortly.</>
							: <>The code is in your authenticator app as <strong>Century NIT Ops &middot; {maskEmail(accountEmail)}</strong>. It refreshes every 30 seconds.</>}
					</p>
				</AuthContextCard>
			}
			copy="Sign-ins, failures and lockouts are audited."
		>
			<div className="ops-login__head">
				<span className="ops-login__badge">{method === "email_otp" ? maskEmail(accountEmail) : (accountEmail ?? "Signed in")}</span>
				<h1 className="ops-login__title">Verification code</h1>
				<p className="ops-login__subtitle">
					{method === "email_otp"
						? otpSent
							? `Enter the 6-digit code sent to ${maskEmail(accountEmail)}.`
							: "Sending you a verification code..."
						: "From your authenticator app."}
				</p>
			</div>

			<form id="mfa-challenge-form" onSubmit={submit} className="ops-login__form">
				<OtpInput
					value={code}
					onChange={(v) => {
						if (error) setError(null);
						setCode(v);
					}}
					autoFocus
					disabled={busy}
				/>

				{error ? <p className="ops-login__error" role="alert">{error}</p> : null}

				<button type="submit" disabled={busy || code.length !== 6} className="btn btn--primary ops-login__submit">
					<span>{busy ? "Verifying..." : "Verify & sign in"}</span>
					{busy ? null : <span dangerouslySetInnerHTML={{ __html: ARROW_SVG }} />}
				</button>

				<div className="ops-login__foot">
					{method === "email_otp" ? (
						<button
							type="button"
							disabled={resendCooldown > 0 || busy}
							onClick={resend}
							className="ops-login__footlink"
						>
							{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
						</button>
					) : (
						<span />
					)}
					<button
						type="button"
						onClick={useDifferentMethod}
						className="ops-login__footlink"
					>
						Use a different sign-in method
					</button>
				</div>
			</form>
		</AuthShell>
	);
}
