import { useState, useCallback } from "react";

export type OpsNotification = {
	id: string;
	type: string;
	read: boolean;
	title: string;
	body: string;
	link: string | null;
	createdAt: string;
};

export function useOpsNotifications() {
	const [notifications] = useState<OpsNotification[]>([]);
	const [unreadCount] = useState(0);

	const markRead = useCallback((_id: string) => {
		// Stub: no-op until live notification stream is restored.
	}, []);

	const markAllRead = useCallback(() => {
		// Stub: no-op until live notification stream is restored.
	}, []);

	return { notifications, unreadCount, markRead, markAllRead };
}
