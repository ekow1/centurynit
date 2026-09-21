import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch } from "../lib/api";

type Status =
	| "loading"
	| "confirmed"
	| "already_confirmed"
	| "unsubscribed"
	| "already_unsubscribed"
	| "not_found"
	| "error";

/**
 * /newsletter/confirm?token=...
 *
 * The second leg of double opt-in. The visitor clicked the confirmation link
 * in the email; we call the API to flip their subscription to `confirmed`.
 * No auth. The token is the credential.
 */
export function NewsletterConfirm() {
	const [params] = useSearchParams();
	const token = params.get("token");
	const [status, setStatus] = useState<Status>("loading");

	useEffect(() => {
		if (!token) {
			setStatus("not_found");
			return;
		}
		setStatus("loading");
		apiFetch<{ ok: boolean; status: "confirmed" | "already_confirmed" | "not_found" }>(
			`${API_PREFIX}/newsletter/confirm?token=${encodeURIComponent(token)}`,
		)
			.then((res) => setStatus(res.status))
			.catch(() => setStatus("error"));
	}, [token]);

	return (
		<section className="newsletter-status-page">
			<div className="newsletter-status-card">
				{status === "loading" && (
					<>
						<div className="newsletter-status-spinner" aria-hidden="true" />
						<h1>Confirming your subscription…</h1>
						<p>One moment while we verify your email.</p>
					</>
				)}
				{status === "confirmed" && (
					<>
						<div className="newsletter-status-icon newsletter-status-icon--ok">&#10003;</div>
						<h1>You're subscribed!</h1>
						<p>
							Thanks for confirming. Watch your inbox for intake deadlines, scholarship alerts,
							and visa updates from Century NIT.
						</p>
						<Link to="/" className="newsletter-status-link">
							Back to home
						</Link>
					</>
				)}
				{status === "already_confirmed" && (
					<>
						<div className="newsletter-status-icon newsletter-status-icon--ok">&#10003;</div>
						<h1>Already subscribed</h1>
						<p>You're all set. We already have you on the list.</p>
						<Link to="/" className="newsletter-status-link">
							Back to home
						</Link>
					</>
				)}
				{(status === "not_found" || status === "error") && (
					<>
						<div className="newsletter-status-icon newsletter-status-icon--err">!</div>
						<h1>This link isn't valid</h1>
						<p>
							The confirmation link may have expired or already been used. Try subscribing again
							from the popup on our homepage.
						</p>
						<Link to="/" className="newsletter-status-link">
							Back to home
						</Link>
					</>
				)}
			</div>
		</section>
	);
}

/**
 * /newsletter/unsubscribe?token=...
 *
 * One-click unsubscribe from campaign emails. The token is the same
 * `confirm_token` issued at subscribe time and included in every campaign
 * footer. No auth, no form. One click and they're off the list.
 */
export function NewsletterUnsubscribe() {
	const [params] = useSearchParams();
	const token = params.get("token");
	const email = params.get("email");
	const key = params.get("key");
	const [status, setStatus] = useState<Status>("loading");

	useEffect(() => {
		// Two credentials: the per-contact token, or email + key for people
		// who reached us through a segment and have no list row.
		const query = token
			? `token=${encodeURIComponent(token)}`
			: email && key
				? `email=${encodeURIComponent(email)}&key=${encodeURIComponent(key)}`
				: null;
		if (!query) {
			setStatus("not_found");
			return;
		}
		setStatus("loading");
		apiFetch<{ ok: boolean; status: "unsubscribed" | "already_unsubscribed" | "not_found" }>(
			`${API_PREFIX}/newsletter/unsubscribe?${query}`,
		)
			.then((res) => setStatus(res.status))
			.catch(() => setStatus("error"));
	}, [token, email, key]);

	return (
		<section className="newsletter-status-page">
			<div className="newsletter-status-card">
				{status === "loading" && (
					<>
						<div className="newsletter-status-spinner" aria-hidden="true" />
						<h1>Unsubscribing…</h1>
						<p>One moment while we remove you from the list.</p>
					</>
				)}
				{status === "unsubscribed" && (
					<>
						<div className="newsletter-status-icon newsletter-status-icon--ok">&#10003;</div>
						<h1>You're unsubscribed</h1>
						<p>
							You won't receive any more emails from us. If this was a mistake, you can subscribe
							again anytime from the popup on our homepage.
						</p>
						<Link to="/" className="newsletter-status-link">
							Back to home
						</Link>
					</>
				)}
				{status === "already_unsubscribed" && (
					<>
						<div className="newsletter-status-icon newsletter-status-icon--ok">&#10003;</div>
						<h1>Already unsubscribed</h1>
						<p>You're not on our list. No further action needed.</p>
						<Link to="/" className="newsletter-status-link">
							Back to home
						</Link>
					</>
				)}
				{(status === "not_found" || status === "error") && (
					<>
						<div className="newsletter-status-icon newsletter-status-icon--err">!</div>
						<h1>This link isn't valid</h1>
						<p>
							The unsubscribe link may have expired or been tampered with. Reply to any of our
							emails and we'll remove you manually.
						</p>
						<Link to="/" className="newsletter-status-link">
							Back to home
						</Link>
					</>
				)}
			</div>
		</section>
	);
}

type Prefs = {
	email: string;
	optedIn: boolean;
	source: string | null;
	lists: { name: string; status: string }[];
};

/**
 * /newsletter/preferences?email=...&key=...
 *
 * The person-level consent surface — every campaign footer links here.
 * The key is an HMAC of the address, so the link itself is the credential;
 * no login required. From here a reader can see what they're on and switch
 * marketing mail back on (off happens through the one-click unsubscribe).
 */
export function NewsletterPreferences() {
	const [params] = useSearchParams();
	const email = params.get("email");
	const key = params.get("key");
	const [prefs, setPrefs] = useState<Prefs | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "invalid" | "error" | "saving" | "saved">("loading");

	useEffect(() => {
		if (!email || !key) {
			setState("invalid");
			return;
		}
		apiFetch<Prefs>(
			`${API_PREFIX}/newsletter/preferences?email=${encodeURIComponent(email)}&key=${encodeURIComponent(key)}`,
		)
			.then((res) => {
				setPrefs(res);
				setState("ready");
			})
			.catch(() => setState("error"));
	}, [email, key]);

	async function resubscribe() {
		if (!email || !key) return;
		setState("saving");
		try {
			await apiFetch(`${API_PREFIX}/newsletter/preferences`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email, key, optedIn: true }),
			});
			setPrefs((p) => (p ? { ...p, optedIn: true } : p));
			setState("saved");
		} catch {
			setState("error");
		}
	}

	return (
		<section className="newsletter-status-page">
			<div className="newsletter-status-card">
				{state === "loading" && (
					<>
						<div className="newsletter-status-spinner" aria-hidden="true" />
						<h1>Loading your preferences…</h1>
					</>
				)}
				{(state === "invalid" || state === "error") && (
					<>
						<div className="newsletter-status-icon newsletter-status-icon--err">!</div>
						<h1>This link isn't valid</h1>
						<p>Preferences links are personal — open the one from your most recent email.</p>
						<Link to="/" className="newsletter-status-link">Back to home</Link>
					</>
				)}
				{(state === "ready" || state === "saving" || state === "saved") && prefs && (
					<>
						<h1>Email preferences</h1>
						<p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{prefs.email}</p>
						<p>
							{prefs.optedIn
								? "You're opted in to Century NIT updates."
								: "You're not receiving Century NIT updates."}
							{prefs.source ? ` (source: ${prefs.source.replace(/_/g, " ")})` : ""}
						</p>
						{prefs.lists.length > 0 && (
							<ul style={{ textAlign: "left", margin: "16px auto", maxWidth: 320, fontSize: 14, lineHeight: 1.8 }}>
								{prefs.lists.map((l) => (
									<li key={l.name}>
										{l.name} — {l.status}
									</li>
								))}
							</ul>
						)}
						{!prefs.optedIn && state !== "saved" && (
							<button
								type="button"
								className="newsletter-status-link"
								style={{ border: "none", cursor: "pointer" }}
								onClick={resubscribe}
								disabled={state === "saving"}
							>
								{state === "saving" ? "Saving…" : "Turn emails back on"}
							</button>
						)}
						{state === "saved" && <p>Done — updates are back on.</p>}
						<p style={{ marginTop: 16, fontSize: 13, color: "#666" }}>
							To stop all email, use the unsubscribe link in any message footer.
						</p>
						<Link to="/" className="newsletter-status-link">Back to home</Link>
					</>
				)}
			</div>
		</section>
	);
}
