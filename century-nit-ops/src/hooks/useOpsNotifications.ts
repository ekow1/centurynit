import { useState, useEffect, useCallback } from "react";
import { notificationsApi, type OpsNotification } from "century-nit-core/api";
import { useOpsSSE } from "./useChatStream";

export type { OpsNotification };

/**
 * Real-time ops notifications.
 *
 * Source of truth is the server's `/notifications/ops` collection. We seed it on
 * mount, poll every 30s as a fallback (SSE connections drop, tabs sleep, etc.),
 * and listen to the shared `/events/stream` singleton (useOpsSSE) for
 * `notification` pushes — prepending any new item so the bell reacts instantly
 * without waiting on the poll.
 *
 * This hook used to open its own EventSource; now it rides the same single
 * stream as chat and the case-refresh listener, so a tab holds one SSE
 * connection no matter how many widgets subscribe.
 */
export function useOpsNotifications() {
	const [notifications, setNotifications] = useState<OpsNotification[]>([]);

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
		return () => clearInterval(poll);
	}, [refresh]);

	// Live push over the shared stream. Real notifications carry a database
	// `id`; domain events (case.updated, payment.recorded…) don't, so they
	// pass through this filter untouched — the surfaces that care about them
	// have their own useOpsSSE listeners.
	useOpsSSE((event) => {
		const data = event as unknown as OpsNotification;
		if (!data?.id) return;
		setNotifications((prev) => {
			if (prev.some((n) => n.id === data.id)) return prev;
			return [data, ...prev];
		});
	});

	const unreadCount = notifications.filter((n) => !n.read).length;

	return { notifications, unreadCount, markRead, markAllRead, refresh };
}
