import { useState, useCallback, useEffect, useRef } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch } from "../lib/api";

export type OpsNotification = {
	id: string;
	type: string;
	read: boolean;
	title: string;
	body: string;
	link: string | null;
	createdAt: string;
};

type ListResponse = {
	notifications: Array<{
		id: string;
		type: string;
		title: string;
		body: string;
		link: string | null;
		read: boolean;
		priority: string;
		entityType: string | null;
		entityId: string | null;
		caseId: string | null;
		createdAt: string;
	}>;
};

const EVENTS = `${API_PREFIX}/events`;

/**
 * Live notifications for the ops console.
 *
 * Mirrors the portal's pattern: REST hydrates the list on mount and every 30s
 * (fallback), SSE pushes new events in real time. Both go through the console
 * Worker's `/api/*` proxy so the Better Auth session cookie stays first-party.
 */
export function useOpsNotifications() {
	const [notifications, setNotifications] = useState<OpsNotification[]>([]);
	const [unreadCount, setUnreadCount] = useState(0);
	const mountedRef = useRef(true);

	const syncFromServer = useCallback(async () => {
		try {
			const [list, unread] = await Promise.all([
				apiFetch<ListResponse>(EVENTS),
				apiFetch<{ unread: number }>(`${EVENTS}/unread-count`),
			]);
			if (!mountedRef.current) return;
			setNotifications(
				(list?.notifications ?? []).map((n) => ({
					id: n.id,
					type: n.type,
					title: n.title,
					body: n.body,
					link: n.link,
					read: n.read,
					createdAt: n.createdAt,
				})),
			);
			setUnreadCount(Number(unread?.unread ?? 0));
		} catch {
			/* keep current state — next poll or SSE will retry */
		}
	}, []);

	const markRead = useCallback((id: string) => {
		setNotifications((prev) =>
			prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
		);
		setUnreadCount((c) => Math.max(0, c - 1));
		void apiFetch<{ ok: boolean }>(`${EVENTS}/${id}/read`, {
			method: "PATCH",
		}).catch(() => {
			/* keep local state — server will reconcile on next sync */
		});
	}, []);

	const markAllRead = useCallback(() => {
		setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
		setUnreadCount(0);
		void apiFetch<{ ok: boolean }>(`${EVENTS}/read-all`, {
			method: "POST",
		}).catch(() => {
			/* keep local state — server will reconcile on next sync */
		});
	}, []);

	// Initial hydrate + 30s poll fallback.
	useEffect(() => {
		mountedRef.current = true;
		void syncFromServer();
		const t = setInterval(() => void syncFromServer(), 30_000);
		return () => {
			mountedRef.current = false;
			clearInterval(t);
		};
	}, [syncFromServer]);

	// SSE stream for real-time delivery.
	useEffect(() => {
		const url = `${EVENTS}/stream`;
		const es = new EventSource(url, { withCredentials: true });

		const upsert = (notif: OpsNotification) => {
			setNotifications((prev) =>
				prev.some((n) => n.id === notif.id) ? prev : [notif, ...prev],
			);
			if (!notif.read) setUnreadCount((c) => c + 1);
		};

		es.addEventListener("notification", (event) => {
			try {
				const data = JSON.parse((event as MessageEvent).data) as {
					id: string;
					type: string;
					title: string;
					body: string;
					link: string | null;
					createdAt: string;
				};
				upsert({
					id: data.id,
					type: data.type,
					title: data.title,
					body: data.body,
					link: data.link,
					read: false,
					createdAt: data.createdAt,
				});
			} catch {
				/* ignore malformed payloads */
			}
		});

		es.addEventListener("error", () => {
			// EventSource auto-reconnects; nothing to do here.
		});

		return () => {
			es.close();
		};
	}, []);

	return { notifications, unreadCount, markRead, markAllRead };
}
