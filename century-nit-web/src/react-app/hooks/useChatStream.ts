import { useEffect, useRef } from "react";
import { API_PREFIX, type ChatRealtimeEvent } from "century-nit-shared";

/**
 * Portal SSE subscription for chat events.
 *
 * Mirrors the ops console's `useChatStream`: a single `EventSource` per tab,
 * shared by every chat surface in the portal. The backend publishes chat
 * events to the applicant's personal Redis channel (`user:{userId}:events`),
 * which the `/events/stream` endpoint relays as `notification` SSE events.
 *
 * `EventSource` auto-reconnects with backoff on drop. Auth is via the session
 * cookie (same-origin), same as every other request.
 */

type Listener = (event: ChatRealtimeEvent) => void;

const listeners = new Set<Listener>();
let es: EventSource | null = null;
let refCount = 0;

function ensureOpen() {
	if (es || refCount === 0) return;
	try {
		es = new EventSource(`${API_PREFIX}/events/stream`, { withCredentials: true });
		es.addEventListener("notification", (ev) => {
			try {
				const parsed = JSON.parse((ev as MessageEvent).data) as ChatRealtimeEvent;
				if (!parsed?.type?.startsWith?.("chat.")) return;
				for (const fn of listeners) {
					try {
						fn(parsed);
					} catch {
						// a listener throwing must not break the others
					}
				}
			} catch {
				// malformed payload — ignore
			}
		});
		es.onerror = () => {
			// EventSource auto-reconnects; nothing to do.
		};
	} catch {
		es = null;
	}
}

function maybeClose() {
	if (refCount > 0) return;
	if (!es) return;
	es.close();
	es = null;
}

/**
 * Subscribe to chat SSE events for the lifetime of the calling component.
 * Pass a stable listener (e.g. wrapped in useCallback) for best results.
 */
export function useChatStream(listener: Listener): void {
	const ref = useRef(listener);
	ref.current = listener;

	useEffect(() => {
		const stable: Listener = (e) => ref.current(e);
		listeners.add(stable);
		refCount += 1;
		ensureOpen();
		return () => {
			listeners.delete(stable);
			refCount -= 1;
			maybeClose();
		};
	}, []);
}
