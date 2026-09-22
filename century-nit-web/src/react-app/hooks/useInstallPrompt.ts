import { useCallback, useEffect, useRef, useState } from "react";

/** Chromium's deferred install prompt. Not yet in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
	interface WindowEventMap {
		beforeinstallprompt: BeforeInstallPromptEvent;
		appinstalled: Event;
	}
}

function isIOS(): boolean {
	return (
		/iP(hone|ad|od)/.test(navigator.userAgent) ||
		// iPadOS 13+ reports as Mac; multi-touch gives it away.
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}

function isStandalone(): boolean {
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		window.matchMedia("(display-mode: window-controls-overlay)").matches ||
		// iOS Safari has no display-mode media query; it sets this instead.
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

/**
 * The browser's "install this app" affordance, surfaced as state.
 *
 * Chromium fires `beforeinstallprompt` once installability checks pass (a
 * manifest with PNG icons, a service worker with a fetch handler, HTTPS). We
 * capture it and replay it from our own button — the browser's own mini
 * prompt stays suppressed.
 *
 * iOS Safari never fires it: there `ios` is true and callers show the
 * Share → Add to Home Screen steps instead of calling prompt().
 */
export function useInstallPrompt() {
	const deferred = useRef<BeforeInstallPromptEvent | null>(null);
	const [installed, setInstalled] = useState(isStandalone);
	const [promptable, setPromptable] = useState(false);

	useEffect(() => {
		const onBeforeInstall = (e: BeforeInstallPromptEvent) => {
			e.preventDefault();
			deferred.current = e;
			setPromptable(true);
		};
		const onInstalled = () => {
			deferred.current = null;
			setPromptable(false);
			setInstalled(true);
		};
		const standalone = window.matchMedia("(display-mode: standalone)");
		const onMode = (e: MediaQueryListEvent) => {
			if (e.matches) onInstalled();
		};
		window.addEventListener("beforeinstallprompt", onBeforeInstall);
		window.addEventListener("appinstalled", onInstalled);
		standalone.addEventListener("change", onMode);
		return () => {
			window.removeEventListener("beforeinstallprompt", onBeforeInstall);
			window.removeEventListener("appinstalled", onInstalled);
			standalone.removeEventListener("change", onMode);
		};
	}, []);

	const prompt = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
		const e = deferred.current;
		if (!e) return "unavailable";
		// A deferred prompt is single-use; clear it before awaiting the choice.
		deferred.current = null;
		setPromptable(false);
		await e.prompt().catch(() => {});
		const choice = await e.userChoice.catch(() => ({ outcome: "dismissed" as const, platform: "" }));
		if (choice.outcome === "accepted") setInstalled(true);
		return choice.outcome;
	}, []);

	return {
		/** Already running inside the installed app. */
		installed,
		/** Chromium offered a prompt — prompt() opens the real sheet. */
		promptable,
		/** iOS/iPadOS — no programmatic prompt exists; show the steps. */
		ios: isIOS(),
		/** Worth rendering an install control at all. */
		available: !installed && (promptable || isIOS()),
		prompt,
	};
}
