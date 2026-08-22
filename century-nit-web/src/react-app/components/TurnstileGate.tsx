import { useEffect, useState } from "react";
import { useTurnstile } from "../hooks/useTurnstile";

/**
 * One-time, first-visit bot gate for the public site.
 *
 * A visitor who has not yet verified sees a non-dismissable overlay with a
 * Cloudflare Turnstile widget. Solving it POSTs the token to
 * `/turnstile/verify`, which validates it and sets a signed `cnit_v` cookie
 * (see `src/worker/index.ts`). Once verified, the overlay is gone for the
 * session and the public AI chat works without any per-message challenge.
 *
 * The authed portal (`/portal/*`, `/start/*`) never renders this gate — it is
 * mounted only on the public chrome (see `App.tsx`).
 */
export function TurnstileGate() {
	const [status, setStatus] = useState<"loading" | "unverified" | "verified">("loading");
	const [sitekey, setSitekey] = useState("");
	const { containerRef, token } = useTurnstile(sitekey, "site_verify", status === "unverified" && !!sitekey);

	// Check current verification status + fetch the sitekey once on mount.
	useEffect(() => {
		let cancelled = false;
		Promise.all([
			fetch("/turnstile/status")
				.then((r) => r.json())
				.then((b: { verified?: boolean; configured?: boolean }) => ({
					verified: b.verified === true,
					configured: b.configured !== false,
				}))
				.catch(() => ({ verified: false, configured: false })),
			fetch("/ai/config")
				.then((r) => r.json())
				.then((b: { turnstileSitekey?: string }) => b.turnstileSitekey ?? "")
				.catch(() => ""),
		]).then(([{ verified, configured }, key]) => {
			if (cancelled) return;
			setSitekey(key);
			// Don't show a gate that can never resolve (Turnstile not configured yet)
			// — the public AI chat will return 503 until the secret is set, but the
			// rest of the site stays fully usable.
			setStatus(!configured || verified ? "verified" : "unverified");
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// As soon as the widget produces a token, exchange it for the verified cookie.
	useEffect(() => {
		if (!token || status !== "unverified") return;
		let cancelled = false;
		fetch("/turnstile/verify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cfTurnstileResponse: token }),
		})
			.then((r) => r.ok)
			.then((ok) => {
				if (!cancelled && ok) setStatus("verified");
			})
			.catch(() => {
				// leave overlay up; the widget will reset and the visitor can retry
			});
		return () => {
			cancelled = true;
		};
	}, [token, status]);

	if (status !== "unverified" || !sitekey) return null;

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Verifying you are human"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 9999,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(15, 23, 42, 0.55)",
				backdropFilter: "blur(2px)",
			}}
		>
			<div
				style={{
					background: "var(--card, #fff)",
					color: "var(--foreground, #0f172a)",
					padding: "1.75rem 2rem",
					maxWidth: "92vw",
					width: "360px",
					textAlign: "center",
					borderRadius: "0",
					boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
				}}
			>
				<p style={{ fontWeight: 700, fontSize: "0.95rem", margin: 0 }}>Century NIT</p>
				<p className="muted" style={{ fontSize: "0.78rem", margin: "0.35rem 0 1rem" }}>
					Verifying you are human so we can keep bots away. This only happens once.
				</p>
				<div
					ref={containerRef}
					style={{ display: "flex", justifyContent: "center", minHeight: "65px" }}
				/>
			</div>
		</div>
	);
}
