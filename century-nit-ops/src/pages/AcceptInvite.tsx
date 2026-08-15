import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, staffApi } from "century-nit-core/api";
import type { InvitationPreview } from "century-nit-shared";

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

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<{ email: string; mfaRequired: boolean } | null>(null);

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

	// Checked here so the mismatch is visible as you type; the server checks too.
	const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
	const tooShort = password.length > 0 && password.length < 12;

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (tooShort || mismatch) return;
		setSubmitting(true);
		setError(null);
		try {
			const result = await staffApi.acceptInvitation({ token, password, confirmPassword });
			setDone({ email: result.email, mfaRequired: result.mfaRequired });
		} catch (err) {
			const code = err instanceof ApiError ? err.code : "";
			if (FAILURE_COPY[code]) {
				// The invitation died between preview and submit.
				setFailure(FAILURE_COPY[code]);
			} else {
				setError(err instanceof Error ? err.message : "Could not create your account.");
			}
		} finally {
			setSubmitting(false);
		}
	}

	if (loading) {
		return (
			<div className="invite-page">
				<p className="ops-panel__muted">Checking your invitation…</p>
			</div>
		);
	}

	if (failure) {
		return (
			<div className="invite-page">
				<div className="invite-card">
					<h1 className="invite-card__title">{failure.title}</h1>
					<p className="invite-card__body">{failure.body}</p>
					<Link className="btn btn--ghost btn--sm" to="/ops/login">
						Go to sign in
					</Link>
				</div>
			</div>
		);
	}

	if (done) {
		return (
			<div className="invite-page">
				<div className="invite-card">
					<h1 className="invite-card__title">Your account is ready</h1>
					<p className="invite-card__body">
						Sign in as <strong>{done.email}</strong> with the password you just chose.
					</p>
					{done.mfaRequired && (
						<p className="invite-card__body">
							Staff accounts require two-factor authentication. You will be asked to set
							it up with an authenticator app the first time you sign in.
						</p>
					)}
					<button
						type="button"
						className="btn btn--primary"
						onClick={() => navigate("/ops/login")}
					>
						Sign in
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="invite-page">
			<div className="invite-card">
				<p className="invite-card__eyebrow">{preview?.organisation}</p>
				<h1 className="invite-card__title">Set your password</h1>
				<p className="invite-card__body">
					Hello {preview?.name}. You have been invited as{" "}
					<strong>{ROLE_LABEL[preview?.role ?? ""] ?? preview?.role}</strong>
					{preview?.branch ? ` at ${preview.branch}` : ""}.
				</p>
				<p className="invite-card__meta">{preview?.email}</p>

				<form onSubmit={submit} className="invite-form">
					<div className="field">
						<label htmlFor="invite-password">Choose a password</label>
						<input
							id="invite-password"
							type="password"
							className="input input--full-border"
							autoComplete="new-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
						/>
						<p className={`invite-hint ${tooShort ? "invite-hint--bad" : ""}`}>
							At least 12 characters. Nobody else — including whoever invited you — ever
							sees it.
						</p>
					</div>

					<div className="field">
						<label htmlFor="invite-confirm">Confirm password</label>
						<input
							id="invite-confirm"
							type="password"
							className="input input--full-border"
							autoComplete="new-password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							required
						/>
						{mismatch && <p className="invite-hint invite-hint--bad">Passwords do not match.</p>}
					</div>

					{error && <p className="ops-modal__error">{error}</p>}

					<button
						type="submit"
						className="btn btn--primary"
						disabled={submitting || tooShort || mismatch || password.length === 0}
					>
						{submitting ? "Creating your account…" : "Create account"}
					</button>
				</form>
			</div>
		</div>
	);
}
