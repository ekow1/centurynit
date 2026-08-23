import { useEffect, useRef } from "react";
import { API_PREFIX, type ChatRealtimeEvent } from "century-nit-shared";

/**
 * Shared SSE subscription for ops events.
 *
 * The ops console already has `/api/v1/events/stream` for notifications — the
 * backend now publishes `chat.message`, `chat.conversation.created`, and
 * `chat.read` events to the same channel. This hook keeps a single
 * `EventSource` per tab and dispatches typed events to every subscriber,
 * so opening five chat widgets doesn't open five SSE connections.
 *
 * `EventSource` auto-reconnects with backoff on drop; we don't need to retry
 * manually. Auth is via the session cookie (same-origin), same as every
 * other request — no token in the URL.
 */

type ChatSSEEvent = ChatRealtimeEvent;

type Listener = (event: ChatSSEEvent) => void;
type AnyEventListener = (event: { type: string; [key: string]: unknown }) => void;

const listeners = new Set<Listener>();
const anyListeners = new Set<AnyEventListener>();
let es: EventSource | null = null;
let refCount = 0;

function ensureOpen() {
	if (es || refCount === 0) return;
	try {
		es = new EventSource(`${API_PREFIX}/events/stream`, { withCredentials: true });
		// The backend relays every Redis pub/sub message under the
		// `notification` SSE event name (see events.ts writeSSE), so chat
		// events arrive here too — we filter by the payload's `type` field.
		es.addEventListener("notification", (ev) => {
			try {
				const parsed = JSON.parse((ev as MessageEvent).data) as ChatSSEEvent;
				// Dispatch to all-events listeners (used by useCasesApi for
				// real-time refresh on case-relevant notifications).
				for (const fn of anyListeners) {
					try {
						fn(parsed);
					} catch {
						// ignore
					}
				}
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

/**
 * Subscribe to ALL SSE events (not just chat) for the lifetime of the
 * calling component. Used by `useCasesApi` to auto-refresh when a
 * case-relevant notification arrives (e.g. `booking.new`, `stage.changed`,
 * `assessment.complete`, `lead.new`, etc.) without opening a second
 * EventSource — reuses the same singleton connection as `useChatStream`.
 */
export function useOpsSSE(listener: AnyEventListener): void {
	const ref = useRef(listener);
	ref.current = listener;

	useEffect(() => {
		const stable: AnyEventListener = (e) => ref.current(e);
		anyListeners.add(stable);
		refCount += 1;
		ensureOpen();
		return () => {
			anyListeners.delete(stable);
			refCount -= 1;
			maybeClose();
		};
	}, []);
}
