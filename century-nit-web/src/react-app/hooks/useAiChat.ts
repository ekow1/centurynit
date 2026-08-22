import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Real, streaming AI chat backed by the Workers AI edge endpoint `POST /ai/chat`
 * (see `src/worker/index.ts`). The portal's two AI surfaces — FloatingChat and
 * CommunicationCenter — and the public EnquiryWidget all use this hook, passing
 * a different `surface` so the worker picks the right system prompt (and, for
 * the public `web` surface, enforces Turnstile).
 *
 * State is client-only: history lives in React state and is replayed to the
 * endpoint each turn, matching the previous "AI is local-only" design. There is
 * no server persistence and no SSE reconnect — every send is one request/stream.
 */

export type AiChatSurface = "portal-floating" | "portal-comm" | "web";

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
	web: "Hi! I'm the Century NIT assistant. Ask me about study destinations, programmes, visas, scholarships, or anything about studying abroad. How can I help?",
};

const ERROR_REPLY =
	"Sorry, I couldn't generate a reply right now. Please try again, or reach the team via the Support / WhatsApp tabs.";

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
	const busyRef = useRef(false);

	// Snapshot of the latest committed messages, read inside the async send.
	const messagesRef = useRef(messages);
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	// Keep the latest getContext without re-creating send on every render.
	const ctxRef = useRef(options.getContext);
	ctxRef.current = options.getContext;

	const send = useCallback(
		async (text: string, extra?: Record<string, unknown>) => {
			const trimmed = text.trim();
			if (!trimmed || busyRef.current) return;
			busyRef.current = true;

			const now = Date.now().toString(36);
			const userMsg: AiChatMessage = {
				id: `${surface}-u-${now}`,
				role: "user",
				content: trimmed,
				at: new Date().toISOString(),
			};
			const assistantId = `${surface}-a-${now}`;

			// Snapshot the conversation for the request from the ref, then update UI.
			const outgoing = [...messagesRef.current, userMsg].map((m) => ({
				role: m.role,
				content: m.content,
			}));

			setMessages((prev) => [...prev, userMsg]);
			setMessages((prev) => [
				...prev,
				{ id: assistantId, role: "assistant", content: "", at: new Date().toISOString() },
			]);
			setTyping(true);
			setError(null);

			const controller = new AbortController();
			abortRef.current = controller;

			try {
				const res = await fetch("/ai/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					signal: controller.signal,
					body: JSON.stringify({
						surface,
						messages: outgoing,
						context: ctxRef.current?.() ?? undefined,
						...extra,
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
						p.map((m) => (m.id === assistantId ? { ...m, content: ERROR_REPLY } : m)),
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
					p.map((m) => (m.id === assistantId && !m.content ? { ...m, content: ERROR_REPLY } : m)),
				);
			} catch (err) {
				if ((err as Error)?.name === "AbortError") return;
				const detail = err instanceof Error ? err.message : "Network error.";
				setError(detail);
				setMessages((p) =>
					p.map((m) => (m.id === assistantId ? { ...m, content: ERROR_REPLY } : m)),
				);
			} finally {
				setTyping(false);
				abortRef.current = null;
				busyRef.current = false;
			}
		},
		[surface],
	);

	const reset = useCallback(() => {
		abortRef.current?.abort();
		busyRef.current = false;
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
