import { useCallback, useState } from "react";

/**
 * Stub while the live push pipeline is restored.
 *
 * Reports `"unsupported"` unconditionally so the portal hides every push
 * affordance instead of offering a subscription action that could never
 * complete — the API endpoints and service worker this used to talk to are
 * currently absent.
 */
export function usePushNotifications(_options: { isAuthenticated: boolean }) {
	const [permission] = useState<NotificationPermission | "unsupported">("unsupported");

	const subscribe = useCallback(async () => {
		// Stub: no-op until live notification stream is restored.
	}, []);

	const unsubscribe = useCallback(async () => {
		// Stub: no-op until live notification stream is restored.
	}, []);

	return { permission, subscribe, unsubscribe };
}
