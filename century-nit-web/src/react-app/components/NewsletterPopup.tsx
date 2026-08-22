import { useEffect, useState, useCallback } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

const STORAGE_KEY = "century-nit-newsletter";
const ONE_HOUR_MS = 60 * 60 * 1000;

type StoredState = {
	firstVisit: number;
	lastDismissed: number | null;
	subscribed: boolean;
};

function loadState(): StoredState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw) as StoredState;
	} catch {
		/* ignore */
	}
	const now = Date.now();
	const fresh: StoredState = { firstVisit: now, lastDismissed: null, subscribed: false };
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
	} catch {
		/* ignore */
	}
	return fresh;
}

function saveState(s: StoredState) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
	} catch {
		/* ignore */
	}
}

export function NewsletterPopup() {
	const [visible, setVisible] = useState(false);
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [state, setState] = useState<StoredState | null>(() => loadState());

	useEffect(() => {
		if (!state || state.subscribed) return;

		const interval = setInterval(() => {
			const now = Date.now();
			const baseline = state.lastDismissed ?? state.firstVisit;
			if (now - baseline >= ONE_HOUR_MS) {
				setVisible(true);
			}
		}, 30_000);
		return () => clearInterval(interval);
	}, [state]);

	const dismiss = useCallback(() => {
		setVisible(false);
		setError(null);
		if (state) {
			const updated = { ...state, lastDismissed: Date.now() };
			setState(updated);
			saveState(updated);
		}
	}, [state]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email.trim() || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await apiFetch<{ ok: boolean; message: string }>(
				`${API_PREFIX}/newsletter/subscribe`,
				{
					method: "POST",
					body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
				},
			);
			setSubmitted(true);
			if (state) {
				const updated = { ...state, subscribed: true };
				setState(updated);
				saveState(updated);
			}
			void res;
			setTimeout(() => {
				setVisible(false);
				setSubmitted(false);
				setEmail("");
				setName("");
			}, 4000);
		} catch (err) {
			if (err instanceof ApiError) {
				// 400 with EMAIL_NOT_CONFIGURED, 429 rate limit, etc.
				try {
					const parsed = JSON.parse(err.message);
					setError(parsed?.message ?? parsed?.error ?? "Something went wrong. Please try again.");
				} catch {
					setError("Something went wrong. Please try again.");
				}
			} else {
				setError("Network error. Please check your connection and try again.");
			}
		} finally {
			setSubmitting(false);
		}
	};

	if (!visible) return null;

	return (
		<div className="newsletter-overlay" role="dialog" aria-modal="true" aria-label="Newsletter signup">
			<div className="newsletter-popup">
				<button
					type="button"
					className="newsletter-popup__close"
					aria-label="Close newsletter popup"
					onClick={dismiss}
				>
					&times;
				</button>

				{submitted ? (
					<div className="newsletter-popup__success">
						<div className="newsletter-popup__success-icon">&#10003;</div>
						<h3>Check your inbox</h3>
						<p>
							We sent a confirmation link to <strong>{email}</strong>. Click it to finish
							subscribing — and watch for intake updates, scholarship alerts, and study abroad tips.
						</p>
					</div>
				) : (
					<>
						<div className="newsletter-popup__hero">
							<div className="newsletter-popup__badge">Century NIT Newsletter</div>
							<h2 className="newsletter-popup__title">
								Study Abroad Insights,<br />Delivered Monthly
							</h2>
							<p className="newsletter-popup__subtitle">
								Get the latest intake deadlines, scholarship opportunities, and visa updates straight to your inbox. Join 5,000+ students planning their journey.
							</p>
						</div>

						<ul className="newsletter-popup__perks">
							<li>
								<span className="newsletter-popup__perk-icon">&#10003;</span>
								Early access to new program listings
							</li>
							<li>
								<span className="newsletter-popup__perk-icon">&#10003;</span>
								Scholarship alerts before anyone else
							</li>
							<li>
								<span className="newsletter-popup__perk-icon">&#10003;</span>
								Visa &amp; application deadline reminders
							</li>
						</ul>

						<form className="newsletter-popup__form" onSubmit={handleSubmit}>
							<input
								type="text"
								className="newsletter-popup__input"
								placeholder="Your name (optional)"
								value={name}
								onChange={(e) => setName(e.target.value)}
								autoComplete="name"
							/>
							<input
								type="email"
								className="newsletter-popup__input"
								placeholder="Enter your email address"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								autoFocus
								autoComplete="email"
							/>
							<button type="submit" className="newsletter-popup__btn" disabled={submitting}>
								{submitting ? "Subscribing…" : "Subscribe Now"}
							</button>
						</form>

						{error && (
							<p className="newsletter-popup__error" role="alert">
								{error}
							</p>
						)}

						<p className="newsletter-popup__fine-print">
							No spam. Unsubscribe anytime. We respect your privacy.
						</p>
					</>
				)}
			</div>
		</div>
	);
}
