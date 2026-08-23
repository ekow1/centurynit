import { useCallback, useState } from "react";

/**
 * Web Push subscription for the Operations Console — STUB.
 *
 * The server-side push endpoints (`/api/v1/push/*`) were removed when the
 * notification pipeline was taken offline, so the real implementation here
 * produced nothing but console noise: a 404 on every load for returning
 * staff who had previously granted permission, plus failed subscription
 * attempts from the bell button.
 *
 * This stub keeps the exact same interface so `EnterpriseLayout` is untouched,
 * reports `"unsupported"`/no-subscription so the UI shows its "off" state,
 * and makes subscribe/unsubscribe deliberate no-ops until the pipeline is
 * restored.
 */

export type PushSubscriptionLike = {
	endpoint: string;
	keys?: {
		p256dh: string;
		auth: string;
	};
};

export type UsePushNotificationsResult = {
	permission: NotificationPermission | "unsupported";
	subscription: PushSubscriptionLike | null;
	subscribe: () => Promise<void>;
	unsubscribe: () => Promise<void>;
};

export function usePushNotifications(
	_options: { isAuthenticated: boolean },
): UsePushNotificationsResult {
	const [permission] = useState<NotificationPermission | "unsupported">("unsupported");
	const [subscription] = useState<PushSubscriptionLike | null>(null);

	const subscribe = useCallback(async () => {
		// Stub: no-op until live notification stream is restored.
	}, []);

	const unsubscribe = useCallback(async () => {
		// Stub: no-op until live notification stream is restored.
	}, []);

	return { permission, subscription, subscribe, unsubscribe };
}
