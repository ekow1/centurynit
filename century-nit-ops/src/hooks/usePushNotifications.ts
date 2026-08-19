import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { API_PREFIX } from "century-nit-shared";

/**
 * Web Push subscription for the Operations Console.
 *
 * The ops console is deployed as its own Cloudflare Worker (a different origin
 * from the public web app), so it ships its own service worker (`/sw.js`) with
 * push + notificationclick handlers. API calls are still same-origin relative
 * paths — the console Worker proxies `/api/*` to the Hono API (see
 * `src/worker/index.ts`), which keeps the Better Auth session cookie first-party
 * exactly like `apiFetch` / `useOpsNotifications` do.
 *
 * The permission prompt is NEVER shown automatically. The hook only
 * auto-subscribes on mount if the staff member previously granted permission
 * (e.g. they return to the console). Call `subscribe()` from a button to ask
 * the first time.
 */

type PushSubscriptionKeys = {
	p256dh: string;
	auth: string;
};

type PushSubscriptionLike = {
	endpoint: string;
	keys?: PushSubscriptionKeys;
};

type SubscribeBody = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	userAgent?: string;
};

type VapidPublicKeyResponse = {
	publicKey: string;
};

type SubscribeResponse = {
	success: boolean;
};

/** Convert a VAPID base64url public key into the Uint8Array pushManager wants. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	const buffer = new ArrayBuffer(rawData.length);
	const outputArray = new Uint8Array(buffer);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

function supportsPush(): boolean {
	return (
		typeof window !== "undefined" &&
		"Notification" in window &&
		"serviceWorker" in navigator &&
		"PushManager" in window
	);
}

export type UsePushNotificationsOptions = {
	/** Only subscribe while the staff member is signed in. */
	isAuthenticated: boolean;
};

export type UsePushNotificationsResult = {
	permission: NotificationPermission | "unsupported";
	subscription: PushSubscriptionLike | null;
	subscribe: () => Promise<void>;
	unsubscribe: () => Promise<void>;
};

export function usePushNotifications(
	options: UsePushNotificationsOptions,
): UsePushNotificationsResult {
	const { isAuthenticated } = options;
	const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
		() => (supportsPush() ? Notification.permission : "unsupported"),
	);
	const [subscription, setSubscription] = useState<PushSubscriptionLike | null>(null);
	// Guards against the StrictMode double-invoke + overlapping subscribe calls.
	const inFlight = useRef(false);

	/** POST a subscription to the server so it can send pushes to this device. */
	const sendSubscriptionToServer = useCallback(
		async (sub: PushSubscriptionLike): Promise<boolean> => {
			if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return false;
			const body: SubscribeBody = {
				endpoint: sub.endpoint,
				keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
				userAgent: navigator.userAgent,
			};
			try {
				await apiFetch<SubscribeResponse>(`${API_PREFIX}/push/subscribe`, {
					method: "POST",
					body: JSON.stringify(body),
				});
				return true;
			} catch (err) {
				// The subscription still exists in the browser; the server will
				// reconcile on the next subscribe / heartbeat. Log loudly so a
				// silent server-side failure doesn't look like "alerts on" with
				// no deliveries.
				console.error("[push] failed to save subscription on server:", err);
				return false;
			}
		},
		[],
	);

	/** Create a push subscription on the active service worker registration. */
	const createSubscription = useCallback(async (): Promise<PushSubscriptionLike | null> => {
		const reg = await navigator.serviceWorker.ready;
		const res = await apiFetch<VapidPublicKeyResponse>(`${API_PREFIX}/push/vapid-public-key`);
		if (!res?.publicKey) return null;
		const sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(res.publicKey),
		});
		const json = sub.toJSON() as PushSubscriptionLike;
		setSubscription(json);
		return json;
	}, []);

	const subscribe = useCallback(async () => {
		if (!supportsPush()) return;
		if (inFlight.current) return;
		inFlight.current = true;
		try {
			if (Notification.permission !== "granted") {
				const result = await Notification.requestPermission();
				setPermission(result);
				if (result !== "granted") return;
			}
			// If a subscription already exists, resync it to the server rather
			// than creating a duplicate (the browser dedupes by endpoint, but
			// the server may have lost the row).
			const reg = await navigator.serviceWorker.ready;
			const existing = await reg.pushManager.getSubscription();
			const sub = existing ? (existing.toJSON() as PushSubscriptionLike) : await createSubscription();
			if (sub) await sendSubscriptionToServer(sub);
		} finally {
			inFlight.current = false;
		}
	}, [createSubscription, sendSubscriptionToServer]);

	const unsubscribe = useCallback(async () => {
		if (!supportsPush()) return;
		try {
			const reg = await navigator.serviceWorker.ready;
			const existing = await reg.pushManager.getSubscription();
			if (!existing) {
				setSubscription(null);
				return;
			}
			const endpoint = existing.endpoint;
			await existing.unsubscribe();
			setSubscription(null);
			try {
				await apiFetch<SubscribeResponse>(`${API_PREFIX}/push/subscribe`, {
					method: "DELETE",
					body: JSON.stringify({ endpoint }),
				});
			} catch {
				// Already unsubscribed locally; the server row will be pruned by
				// the push service's own delivery failure handling.
			}
		} catch {
			// pushManager unavailable — nothing to undo.
		}
	}, []);

	/**
	 * Auto-subscribe on mount (and when auth flips on) ONLY if the staff member
	 * has already granted notification permission. This handles the "returning
	 * user" case without ever showing a prompt. We deliberately do NOT call
	 * `Notification.requestPermission()` here.
	 */
	useEffect(() => {
		if (!isAuthenticated) return;
		if (!supportsPush()) return;
		if (Notification.permission !== "granted") return;
		if (inFlight.current) return;

		let cancelled = false;
		inFlight.current = true;
		(async () => {
			try {
				const reg = await navigator.serviceWorker.ready;
				const existing = await reg.pushManager.getSubscription();
				if (existing) {
					const json = existing.toJSON() as PushSubscriptionLike;
					if (!cancelled) setSubscription(json);
					// Re-register with the server in case the row was pruned.
					await sendSubscriptionToServer(json);
				} else {
					const sub = await createSubscription();
					if (sub && !cancelled) await sendSubscriptionToServer(sub);
				}
			} catch {
				// Service worker not ready / push blocked — leave state as-is.
			} finally {
				if (!cancelled) inFlight.current = false;
				else inFlight.current = false;
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [isAuthenticated, createSubscription, sendSubscriptionToServer]);

	// Keep `permission` in sync if the user changes it from site settings.
	useEffect(() => {
		if (!supportsPush()) return;
		const update = () => setPermission(Notification.permission);
		// Some browsers fire `navigator.permissions` change events; polling
		// on focus is a lightweight, broadly-supported approximation.
		window.addEventListener("focus", update);
		return () => window.removeEventListener("focus", update);
	}, []);

	return { permission, subscription, subscribe, unsubscribe };
}
