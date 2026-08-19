import { useEffect, useRef } from "react";
import { API_PREFIX } from "century-nit-shared";

/**
 * Shared SSE subscription for chat events.
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

type ChatSSEEvent =
	| { type: "chat.message"; conversationId: string; message: import("../lib/api").ChatMessage }
	| { type: "chat.conversation.created"; conversationId: string }
	| { type: "chat.read"; conversationId: string };

type Listener = (event: ChatSSEEvent) => void;

const listeners = new Set<Listener>();
let es: EventSource | null = null;
let refCount = 0;

function ensureOpen() {
	if (es || refCount === 0) return;
	try {
		es = new EventSource(`${API_PREFIX}/events/stream`, { withCredentials: true });
		es.onmessage = (ev) => {
			// The backend publishes chat events as raw JSON on the default
			// message channel (no `event:` field), so they arrive here.
			try {
				const parsed = JSON.parse(ev.data) as ChatSSEEvent;
				if (!parsed?.type) return;
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
		};
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
