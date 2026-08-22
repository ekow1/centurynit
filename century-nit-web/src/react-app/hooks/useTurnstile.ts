import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile widget lifecycle for the public web chat.
 *
 * Loads the Turnstile script once and renders a widget explicitly (so we can
 * reset it after each submit — tokens are single-use). The portal surfaces do
 * not use this; only the public, unauthenticated EnquiryWidget does.
 *
 * @returns `containerRef` to attach to the widget's host element and the current
 *          `token` (null until solved/expired), plus `reset()` to mint a fresh
 *          token after a submit attempt.
 */

interface TurnstileWindow {
	turnstile?: {
		render: (el: HTMLElement, opts: Record<string, unknown>) => string;
		reset: (id: string) => void;
		remove: (id: string) => void;
	};
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
	if (typeof window === "undefined") return Promise.resolve();
	const w = window as unknown as TurnstileWindow;
	if (w.turnstile) return Promise.resolve();
	if (scriptPromise) return scriptPromise;
	scriptPromise = new Promise<void>((resolve, reject) => {
		const s = document.createElement("script");
		s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
		s.async = true;
		s.defer = true;
		s.onload = () => resolve();
		s.onerror = () => {
			scriptPromise = null;
			reject(new Error("Failed to load Turnstile"));
		};
		document.head.appendChild(s);
	});
	return scriptPromise;
}

export function useTurnstile(sitekey: string, action: string, enabled: boolean) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const widgetIdRef = useRef<string | null>(null);
	const [token, setToken] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled || !sitekey) return;
		let cancelled = false;

		loadTurnstileScript()
			.then(() => {
				if (cancelled || !containerRef.current) return;
				const ts = (window as unknown as TurnstileWindow).turnstile;
				if (!ts) return;
				widgetIdRef.current = ts.render(containerRef.current, {
					sitekey,
					action,
					theme: "light",
					callback: (t: string) => setToken(t),
					"expired-callback": () => setToken(null),
					"error-callback": () => setToken(null),
				});
			})
			.catch(() => {
				// script failed to load — token stays null, send stays disabled
			});

		return () => {
			cancelled = true;
			const ts = (window as unknown as TurnstileWindow).turnstile;
			if (ts && widgetIdRef.current) {
				try {
					ts.remove(widgetIdRef.current);
				} catch {
					// widget already gone
				}
				widgetIdRef.current = null;
			}
			setToken(null);
		};
	}, [enabled, sitekey, action]);

	const reset = useCallback(() => {
		const ts = (window as unknown as TurnstileWindow).turnstile;
		if (ts && widgetIdRef.current) {
			setToken(null);
			try {
				ts.reset(widgetIdRef.current);
			} catch {
				// ignore
			}
		}
	}, []);

	return { containerRef, token, reset };
}
