import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The staff assistant — streams from this Worker's own `/ai/chat` route,
 * which verifies the staff session against the API before it answers.
 *
 * Same request/stream contract as the portal's useAiChat: history is
 * client-only and replayed each turn; one request per send.
 */

export type OpsAiMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	at: string;
};

const WELCOME =
	"Ops AI online. Ask about the console — where a setting lives, how a workflow runs, which queue owns what — or about the platform itself.";

const ERROR_REPLY =
	"I couldn't generate a reply right now. Try again, or flag it in the helpdesk.";

export function useOpsAiChat(options: { getContext?: () => Record<string, string> } = {}) {
	const [messages, setMessages] = useState<OpsAiMessage[]>([
		{ id: "ops-ai-welcome", role: "assistant", content: WELCOME, at: new Date().toISOString() },
	]);
	const [typing, setTyping] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const busyRef = useRef(false);
	const messagesRef = useRef(messages);
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);
	const ctxRef = useRef(options.getContext);
	ctxRef.current = options.getContext;

	const send = useCallback(async (text: string) => {
		const trimmed = text.trim();
		if (!trimmed || busyRef.current) return;
		busyRef.current = true;

		const now = Date.now().toString(36);
		const userMsg: OpsAiMessage = { id: `u-${now}`, role: "user", content: trimmed, at: new Date().toISOString() };
		const assistantId = `a-${now}`;
		const outgoing = [...messagesRef.current, userMsg].map((m) => ({ role: m.role, content: m.content }));

		setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "", at: new Date().toISOString() }]);
		setTyping(true);
		setError(null);

		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const res = await fetch("/ai/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				signal: controller.signal,
				body: JSON.stringify({ surface: "ops", messages: outgoing, context: ctxRef.current?.() ?? undefined }),
			});

			if (!res.ok || !res.body) {
				let detail = `Request failed (${res.status})`;
				try {
					const b = await res.json();
					if (b?.error?.message) detail = b.error.message;
				} catch {
					// non-JSON error body
				}
				setError(detail);
				setMessages((p) => p.map((m) => (m.id === assistantId ? { ...m, content: ERROR_REPLY } : m)));
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
					const data = raw.slice(5).trim();
					if (!data || data === "[DONE]") continue;
					try {
						const event = JSON.parse(data) as { delta?: string; error?: string };
						if (event.delta) {
							acc += event.delta;
							setMessages((p) => p.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)));
						} else if (event.error) {
							setError(event.error);
						}
					} catch {
						// malformed event
					}
				}
			}
			setMessages((p) => p.map((m) => (m.id === assistantId && !m.content ? { ...m, content: ERROR_REPLY } : m)));
		} catch (err) {
			if ((err as Error)?.name === "AbortError") return;
			setError(err instanceof Error ? err.message : "Network error.");
			setMessages((p) => p.map((m) => (m.id === assistantId ? { ...m, content: ERROR_REPLY } : m)));
		} finally {
			setTyping(false);
			abortRef.current = null;
			busyRef.current = false;
		}
	}, []);

	const reset = useCallback(() => {
		abortRef.current?.abort();
		busyRef.current = false;
		setMessages([{ id: "ops-ai-welcome", role: "assistant", content: WELCOME, at: new Date().toISOString() }]);
		setTyping(false);
		setError(null);
	}, []);

	useEffect(() => () => abortRef.current?.abort(), []);

	return { messages, typing, error, send, reset };
}
