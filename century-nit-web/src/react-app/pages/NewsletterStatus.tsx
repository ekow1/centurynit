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
 * No auth — the token is the credential.
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
						<p>You're all set — we already have you on the list.</p>
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
 * footer. No auth, no form — one click and they're off the list.
 */
export function NewsletterUnsubscribe() {
	const [params] = useSearchParams();
	const token = params.get("token");
	const [status, setStatus] = useState<Status>("loading");

	useEffect(() => {
		if (!token) {
			setStatus("not_found");
			return;
		}
		setStatus("loading");
		apiFetch<{ ok: boolean; status: "unsubscribed" | "already_unsubscribed" | "not_found" }>(
			`${API_PREFIX}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
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
						<p>You're not on our list — no further action needed.</p>
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
