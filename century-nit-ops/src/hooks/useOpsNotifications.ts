import { useState, useEffect, useCallback, useRef } from "react";
import { notificationsApi, type OpsNotification } from "century-nit-core/api";
import { API_PREFIX } from "century-nit-shared";

/**
 * Real-time ops notifications.
 *
 * Source of truth is the server's `/notifications/ops` collection. We seed it on
 * mount, poll every 30s as a fallback (SSE connections drop, tabs sleep, etc.),
 * and listen to the `/events/stream` SSE for `notification` pushes — prepending
 * any new item so the bell reacts instantly without waiting on the poll.
 *
 * The ops console is served same-origin as `/api/*` (the Worker proxies it, see
 * `lib/api.ts`), so the SSE URL is relative and `withCredentials` carries the
 * Better Auth session cookie the same way `apiFetch` does.
 */
export function useOpsNotifications() {
	const [notifications, setNotifications] = useState<OpsNotification[]>([]);
	const esRef = useRef<EventSource | null>(null);

	const refresh = useCallback(async () => {
		try {
			const res = await notificationsApi.opsList();
			if (res?.notifications) setNotifications(res.notifications);
		} catch {
			// offline or 401 — leave existing list intact
		}
	}, []);

	const markRead = useCallback(async (id: string) => {
		setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
		try {
			await notificationsApi.opsMarkRead(id);
		} catch {
			// optimistic — refresh will reconcile
		}
	}, []);

	const markAllRead = useCallback(async () => {
		setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
		try {
			await notificationsApi.opsMarkAllRead();
		} catch {
			// optimistic — refresh will reconcile
		}
	}, []);

	useEffect(() => {
		void refresh();
		const poll = setInterval(refresh, 30000);

		let es: EventSource | null = null;
		try {
			es = new EventSource(`${API_PREFIX}/events/stream`, { withCredentials: true });
			esRef.current = es;
			es.addEventListener("notification", (event) => {
				try {
					const data = JSON.parse((event as MessageEvent).data) as OpsNotification;
					if (!data?.id) return;
					setNotifications((prev) => {
						if (prev.some((n) => n.id === data.id)) return prev;
						return [data, ...prev];
					});
				} catch {
					// malformed payload — ignore, the poll will recover
				}
			});
			// EventSource auto-reconnects on error; nothing to do here.
			es.onerror = () => {};
		} catch {
			// SSE unsupported — the 30s poll is the fallback.
		}

		return () => {
			clearInterval(poll);
			es?.close();
			esRef.current = null;
		};
	}, [refresh]);

	const unreadCount = notifications.filter((n) => !n.read).length;

	return { notifications, unreadCount, markRead, markAllRead, refresh };
}
