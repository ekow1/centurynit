import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Real, streaming AI chat backed by the Workers AI edge endpoint `POST /ai/chat`
 * (see `src/worker/index.ts`). The portal's two AI surfaces — FloatingChat and
 * CommunicationCenter — both use this hook, passing a different `surface` so the
 * worker picks the right system prompt.
 *
 * State is client-only: history lives in React state and is replayed to the
 * endpoint each turn, matching the previous "AI is local-only" design. There is
 * no server persistence and no SSE reconnect — every send is one request/stream.
 */

export type AiChatSurface = "portal-floating" | "portal-comm";

export type AiChatRole = "user" | "assistant";

export type AiChatMessage = {
	id: string;
	role: AiChatRole;
	content: string;
	at: string;
};

type StreamEvent =
	| { delta: string }
	| { error: string };

type UseAiChatOptions = {
	/** Optional profile context sent to personalise the system prompt. */
	getContext?: () => Record<string, string>;
};

const WELCOME: Record<AiChatSurface, string> = {
	"portal-floating":
		"Hi! I'm your Century NIT AI assistant. I can answer questions about study destinations, document requirements, timelines, IELTS and more. How can I help you today?",
	"portal-comm":
		"Century NIT AI Advisor online. Ask about university admissions, visa requirements, scholarships, required documents, payments or application stages.",
};

function sseLine(data: string): StreamEvent | null {
	if (!data || data === "[DONE]") return null;
	try {
		return JSON.parse(data) as StreamEvent;
	} catch {
		return null;
	}
}

export function useAiChat(surface: AiChatSurface, options: UseAiChatOptions = {}) {
	const [messages, setMessages] = useState<AiChatMessage[]>(() => [
		{
			id: `${surface}-welcome`,
			role: "assistant",
			content: WELCOME[surface],
			at: new Date(Date.now() - 60_000).toISOString(),
		},
	]);
	const [typing, setTyping] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	// Keep the latest getContext without re-creating send on every render.
	const ctxRef = useRef(options.getContext);
	ctxRef.current = options.getContext;

	const send = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (!trimmed || typing) return;

			const userMsg: AiChatMessage = {
				id: `${surface}-u-${Date.now().toString(36)}`,
				role: "user",
				content: trimmed,
				at: new Date().toISOString(),
			};

			// Build the outgoing history from current state synchronously.
			setMessages((prev) => {
				const outgoing = [...prev, userMsg].map((m) => ({ role: m.role, content: m.content }));
				// Defer the request so we can read `prev` cleanly without an extra
				// render cycle; fire-and-forget below uses this snapshot.
				void (async () => {
					const controller = new AbortController();
					abortRef.current = controller;
					setTyping(true);
					setError(null);

					const assistantId = `${surface}-a-${Date.now().toString(36)}`;
					setMessages((p) => [
						...p,
						{ id: assistantId, role: "assistant", content: "", at: new Date().toISOString() },
					]);

					try {
						const res = await fetch("/ai/chat", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							signal: controller.signal,
							body: JSON.stringify({
								surface,
								messages: outgoing,
								context: ctxRef.current?.() ?? undefined,
							}),
						});

						if (!res.ok || !res.body) {
							let detail = `Request failed (${res.status})`;
							try {
								const body = await res.json();
								if (body?.error?.message) detail = body.error.message;
							} catch {
								// non-JSON error body — keep the status text
							}
							setError(detail);
							setMessages((p) =>
								p.map((m) =>
									m.id === assistantId
										? { ...m, content: "Sorry, I couldn't generate a reply right now. Please try again or use the Support tab." }
										: m,
								),
							);
							return;
						}

						const reader = res.body.getReader();
						const decoder = new TextDecoder();
						let buffer = "";
						let acc = "";

						for (;;) {
							const { done, value } = await reader.read();
							if (done) break;
							buffer += decoder.decode(value, { stream: true });

							let nl: number;
							while ((nl = buffer.indexOf("\n\n")) !== -1) {
								const raw = buffer.slice(0, nl).trimStart();
								buffer = buffer.slice(nl + 2);
								if (!raw.startsWith("data:")) continue;
								const event = sseLine(raw.slice(5).trim());
								if (!event) continue;
								if ("delta" in event && event.delta) {
									acc += event.delta;
									setMessages((p) =>
										p.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
									);
								} else if ("error" in event) {
									setError(event.error);
								}
							}
						}

						setMessages((p) =>
							p.map((m) =>
								m.id === assistantId && !m.content
									? { ...m, content: "Sorry, I couldn't generate a reply right now. Please try again or use the Support tab." }
									: m,
							),
						);
					} catch (err) {
						if ((err as Error)?.name === "AbortError") return;
						const detail = err instanceof Error ? err.message : "Network error.";
						setError(detail);
						setMessages((p) =>
							p.map((m) =>
								m.id === assistantId
									? { ...m, content: "Sorry, I couldn't reach the assistant right now. Please try again shortly." }
									: m,
							),
						);
					} finally {
						setTyping(false);
						abortRef.current = null;
					}
				})();
				return [...prev, userMsg];
			});
		},
		[surface, typing],
	);

	const reset = useCallback(() => {
		abortRef.current?.abort();
		setMessages([
			{
				id: `${surface}-welcome`,
				role: "assistant",
				content: WELCOME[surface],
				at: new Date().toISOString(),
			},
		]);
		setTyping(false);
		setError(null);
	}, [surface]);

	useEffect(() => () => abortRef.current?.abort(), []);

	return { messages, typing, error, send, reset };
}
