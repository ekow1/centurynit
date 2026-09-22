import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, staffApi } from "century-nit-core/api";
import type { InvitationPreview } from "century-nit-shared";
import { useOpsAuth } from "./OpsAuthContext";
import { AuthShell, type AuthStep } from "./AuthShell";
import { PasswordField, PASSWORD_MIN_LENGTH } from "./PasswordField";

/**
 * Where an invitation link lands.
 *
 * Public and outside `OpsRequireAuth` — the whole point is that the invitee has
 * no account yet. The token comes from the URL, is exchanged for a preview so
 * they can see what they are accepting, and is only spent when they submit a
 * password of their own choosing.
 *
 * The token is never rendered, logged, or put anywhere it could be shoulder-read
 * or copied out of the page.
 */

const ROLE_LABEL: Record<string, string> = {
	super_admin: "Super Administrator",
	admin: "System Administrator",
	manager: "Manager",
	coordinator: "Coordinator",
	customer_service: "Customer Service",
	consultant: "Consultant",
	finance: "Finance Officer",
};

/** Distinct copy per failure — "invalid" for all three would strand people. */
const FAILURE_COPY: Record<string, { title: string; body: string }> = {
	INVITATION_EXPIRED: {
		title: "This invitation has expired",
		body: "Invitations are valid for seven days. Ask whoever invited you to send a new one.",
	},
	INVITATION_ALREADY_ACCEPTED: {
		title: "This invitation has already been used",
		body: "Your account exists — sign in with the password you chose. If that was not you, contact your administrator.",
	},
	INVITATION_INVALID: {
		title: "This invitation link is not valid",
		body: "It may have been withdrawn, or the link may be incomplete. Check the email and try again.",
	},
};

export function AcceptInvite() {
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const token = params.get("token") ?? "";

	const [preview, setPreview] = useState<InvitationPreview | null>(null);
	const [failure, setFailure] = useState<{ title: string; body: string } | null>(null);
	const [loading, setLoading] = useState(true);

	const { opsSignInWithCredentials } = useOpsAuth();
	const [name, setName] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!token) {
			setFailure(FAILURE_COPY.INVITATION_INVALID);
			setLoading(false);
			return;
		}
		let active = true;
		staffApi
			.previewInvitation(token)
			.then((p) => active && setPreview(p))
			.catch((err: unknown) => {
				if (!active) return;
				const code = err instanceof ApiError ? err.code : "INVITATION_INVALID";
				setFailure(FAILURE_COPY[code] ?? FAILURE_COPY.INVITATION_INVALID);
			})
			.finally(() => active && setLoading(false));
		return () => {
			active = false;
		};
	}, [token]);

	// Prefill once the preview arrives — the input is controlled, so a
	// defaultValue would never apply. Staff can still correct it.
	useEffect(() => {
		if (preview?.name) setName((current) => (current ? current : (preview.name ?? "")));
	}, [preview]);

	// Checked here so the mismatch is visible as you type; the server checks too.
	const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
	const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (tooShort || mismatch) return;
		setSubmitting(true);
		setError(null);
		try {
			const result = await staffApi.acceptInvitation({ token, name: name || (preview?.name ?? ""), password, confirmPassword });
			// The staff profile and password are now live. Sign in right away
			// so the invitee never has to type the password a second time. If
			// that fails — e.g. password sign-in was turned off for staff — the
			// account still exists; send them to the login page to use whatever
			// method is enabled.
			try {
				const signIn = await opsSignInWithCredentials(result.email, password);
				if (signIn.twoFactorRequired) {
					// The pending challenge is already armed — the login page
					// resumes it from the signed two_factor cookie.
					navigate("/login");
				} else if (result.mfaRequired) {
					navigate("/mfa-setup");
				} else {
					navigate("/");
				}
			} catch {
				navigate("/login");
			}
		} catch (err) {
			const code = err instanceof ApiError ? err.code : "";
			if (FAILURE_COPY[code]) {
				// The invitation died between preview and submit.
				setFailure(FAILURE_COPY[code]);
			} else {
				setError(err instanceof Error ? err.message : "Could not create or sign in to your account.");
			}
		} finally {
			setSubmitting(false);
		}
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

	if (failure) {
		return (
			<AuthShell
				aside={{
					chip: "Invitation",
					label: "Invitation",
					title: <>This link can't be used.</>,
					body: "Invitations are single-use and expire after seven days — whoever invited you can send a fresh one from the staff directory.",
					footLeft: "Wrong link? Close the tab",
					footRight: "Audited",
				}}
				card={{
					barLeft: "Invitation",
					foot: (
						<>
							<span />
							<Link to="/login">Go to sign in</Link>
						</>
					),
				}}
			>
				<div className="ops-login__head">
					<h1 className="ops-login__title">{failure.title}</h1>
					<p className="ops-login__subtitle">{failure.body}</p>
				</div>
				<Link className="btn btn--ghost btn--sm" to="/login">
					Go to sign in
				</Link>
			</AuthShell>
		);
	}

	const roleLabel = ROLE_LABEL[preview?.role ?? ""] ?? preview?.role;
	const expires = preview?.expiresAt
		? `link expires ${new Date(preview.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
		: null;

	const steps: AuthStep[] = preview?.hasExistingLogin
		? [
				{ label: "Invitation accepted", state: "done" },
				{ label: "Confirm your password", hint: "now", state: "on" },
				{ label: "You're in", state: "todo" },
			]
		: [
				{ label: "Invitation accepted", state: "done" },
				{ label: "Set your password", hint: "now", state: "on" },
				{ label: "Set up two-factor", state: "todo" },
				{ label: "You're in", state: "todo" },
			];

	return (
		<AuthShell
			aside={{
				chip: "Invitation",
				label: "You're joining as",
				title: <>{preview?.email}</>,
				body: (
					<>
						{roleLabel}
						{preview?.branch ? ` · ${preview.branch}` : ""}
						<br />
						{preview?.organisation}
						{expires ? ` · ${expires}` : ""}
					</>
				),
				steps,
				footLeft: "Wrong person? Close the tab",
				footRight: "Audited",
			}}
			card={{
				barLeft: `Invitation · ${preview?.email ?? ""}`,
				barRight: `Step 2 of ${steps.length}`,
				foot: (
					<>
						<span>Already have access?</span>
						<Link to="/login">Sign in</Link>
					</>
				),
			}}
		>
			<div className="ops-login__head">
				<p className="ops-login__eyebrow">{preview?.hasExistingLogin ? "Join the team" : "Create your password"}</p>
				<h1 className="ops-login__title">
					{preview?.name ? `Welcome, ${preview.name.split(" ")[0]}` : "Accept the invitation"}
				</h1>
				<p className="ops-login__subtitle">
					{preview?.hasExistingLogin
						? "This email already has a login — confirm the password you already use."
						: "One password, then two-factor — the account activates when both are done."}
				</p>
			</div>

			<form onSubmit={submit} className="ops-login__form">
				{error && <p className="ops-login__error" role="alert">{error}</p>}
				<div className="ops-login__field">
					<label className="ops-login__label" htmlFor="invite-name">Your name</label>
					<input
						id="invite-name"
						type="text"
						className="ops-login__input"
						autoComplete="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Enter your full name"
						required
					/>
				</div>
				<PasswordField
					id="invite-password"
					label={preview?.hasExistingLogin ? "Your existing password" : "Choose a password"}
					autoComplete={preview?.hasExistingLogin ? "current-password" : "new-password"}
					value={password}
					onChange={setPassword}
					showStrength={!preview?.hasExistingLogin}
					hint={
						preview?.hasExistingLogin
							? "This email already has a login. Enter the password you already use."
							: `At least ${PASSWORD_MIN_LENGTH} characters. Nobody else — including whoever invited you — ever sees it.`
					}
				/>
				<PasswordField
					id="invite-confirm"
					label="Confirm password"
					autoComplete="new-password"
					value={confirmPassword}
					onChange={setConfirmPassword}
					matchWith={password}
				/>

				<button
					type="submit"
					className="btn btn--primary ops-login__submit"
					disabled={submitting || tooShort || mismatch || password.length === 0}
				>
					{submitting
						? "Setting up…"
						: preview?.hasExistingLogin
							? "Accept invitation"
							: "Continue to two-factor"}
				</button>
			</form>
		</AuthShell>
	);
}
