import { Hono } from "hono";

declare global {
	interface Env {
		/** Origin of the Hono API, e.g. https://api.centurynit.com */
		API_BASE_URL: string;
		/** Built SPA assets. */
		ASSETS: Fetcher;
		/** Workers AI binding — powers the staff assistant at /ai/chat. */
		AI: {
			run(model: string, input: unknown): Promise<unknown>;
		};
	}
}

const app = new Hono<{ Bindings: Env }>();

/** Hop-by-hop headers — meaningful to one connection, never forwarded. */
const HOP_BY_HOP = [
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
];

/* ── Staff AI assistant ──────────────────────────────────────────────────────
 *
 * The console's Tier-2 assistant: codebase-aware, allowed to link to console
 * routes and name settings, queues and subsystems. Unlike the public web
 * surface this one verifies the caller is staff on every turn by forwarding
 * the session cookie to the API's /api/auth/me — the same check the data
 * routes make — so the ops prompt (which names internals) is never served to
 * a signed-out or portal visitor.
 */

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const AI_MAX_HISTORY = 8;
const AI_MAX_MESSAGE_CHARS = 2000;
const AI_MAX_TOKENS = 640;

/** Console route map — the only links the assistant may emit. */
const OPS_MAP = [
	"Console pages you may link to (path · what it is):",
	"- /workspace · personal desk: action queue, today's work",
	"- /inbox · what happened: notifications",
	"- /helpdesk · client conversations and support requests",
	"- /documents · document review queue",
	"- /dashboard · the aggregate numbers",
	"- /consultations · meetings, assessments, documents",
	"- /applications · every client's journey — list and board",
	"- /applicants · client records",
	"- /crm · every enquiry on the desk",
	"- /appointments · the week's consultations",
	"- /live-meetings · in-progress video calls",
	"- /universities · /programs · the catalogue",
	"- /packages · service packages and pricing",
	"- /departure-checklist · pre-departure items",
	"- /invoices · /ledger · /payments · /fee-schedule · /payment-config · /finance · /reports · the money pages",
	"- /scheduling · availability and booking rules",
	"- /my-calendar · your own availability",
	"- /marketing · campaigns",
	"- /auth · administration → authentication: MFA policy, session and idle-timeout policy",
	"- /users · staff roster and roles",
	"- /clients · the client directory",
	"- /audit · audit log",
	"- /cms · site content",
	"- /notifications · system notifications",
	"- /settings · platform configuration",
].join("\n");

const OPS_SYSTEM_PROMPT = [
	"You are the Ops AI inside the Century NIT Operations console — the first point of support for signed-in staff.",
	"You know how the console works. Answer workflow questions concretely: name the page, the queue, the button. When a link helps, give one — 'Open → /helpdesk' style — but ONLY from this map:",
	OPS_MAP,
	"Never invent a route and never link anywhere outside this map.",
	"Architecture you may reference when asked: the console is a React SPA on a Cloudflare Worker; the API is Hono on the VPS behind /api/*; auth is Better Auth with staff MFA enforced on every sign-in; auth policy (idle timeout, methods) is set under Administration → Authentication and reaches open consoles via /api/auth/me; realtime is SSE; push is Web Push via /api/push/subscribe; case stages run consultation → admissions → visa → departure with per-stage officer assignments.",
	"If asked about a bug or behaviour you are not certain of, describe the likely subsystem rather than inventing a file name or commit.",
	"Concise answers, 2–4 sentences plus a link when useful. For anything that needs a decision or another human, point them to the helpdesk or their manager.",
].join("\n");

const aiEncoder = new TextEncoder();

app.post("/ai/chat", async (c) => {
	if (!c.env.AI) {
		return Response.json(
			{ error: { code: "AI_UNAVAILABLE", message: "Workers AI binding is not configured." } },
			{ status: 503 },
		);
	}
	if (!c.env.API_BASE_URL) {
		return Response.json(
			{ error: { code: "API_NOT_CONFIGURED", message: "API_BASE_URL is not set on this Worker" } },
			{ status: 503 },
		);
	}

	// Staff check — forward the session cookie to the API's session probe.
	// Anything short of an active staff session refuses the ops prompt.
	try {
		const me = await fetch(`${c.env.API_BASE_URL}/api/auth/me`, {
			headers: { cookie: c.req.header("cookie") ?? "" },
		});
		const session = (await me.json()) as { staff?: unknown } | null;
		if (!me.ok || !session?.staff) {
			return Response.json(
				{ error: { code: "UNAUTHORIZED", message: "Staff session required." } },
				{ status: 401 },
			);
		}
	} catch {
		return Response.json(
			{ error: { code: "AUTH_UNAVAILABLE", message: "Could not verify the staff session." } },
			{ status: 503 },
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return Response.json({ error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." } }, { status: 400 });
	}
	const messages = (body as { messages?: { role: string; content: string }[] } | null)?.messages;
	const context = (body as { context?: Record<string, string> } | null)?.context;
	if (!Array.isArray(messages) || messages.length === 0) {
		return Response.json({ error: { code: "BAD_REQUEST", message: "`messages` must be a non-empty array." } }, { status: 400 });
	}

	const trimmed = messages
		.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
		.slice(-AI_MAX_HISTORY)
		.map((m) => ({ role: m.role, content: m.content.slice(0, AI_MAX_MESSAGE_CHARS) }));
	if (trimmed.length === 0) {
		return Response.json({ error: { code: "BAD_REQUEST", message: "`messages` contained no usable turns." } }, { status: 400 });
	}

	const systemPrompt = [OPS_SYSTEM_PROMPT];
	if (context && typeof context === "object") {
		const ctxLines = Object.entries(context)
			.filter(([, v]) => typeof v === "string" && v.trim())
			.map(([k, v]) => `- ${k}: ${v}`)
			.slice(0, 6);
		if (ctxLines.length) {
			systemPrompt.push("Staff context:", ctxLines.join("\n"));
		}
	}

	let aiStream: ReadableStream;
	try {
		aiStream = (await c.env.AI.run(AI_MODEL, {
			messages: [{ role: "system", content: systemPrompt.join("\n\n") }, ...trimmed],
			stream: true,
			max_tokens: AI_MAX_TOKENS,
		})) as unknown as ReadableStream;
	} catch (err) {
		const message = err instanceof Error ? err.message : "AI inference failed.";
		return Response.json({ error: { code: "AI_FAILED", message } }, { status: 502 });
	}

	// Re-encode the model stream as compact `{ delta }` SSE — same contract
	// the web worker's /ai/chat uses, so the client hook stays identical.
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();
	(async () => {
		try {
			const decoder = new TextDecoder();
			let buffer = "";
			for await (const chunk of aiStream as unknown as AsyncIterable<Uint8Array | string>) {
				buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
				let idx: number;
				while ((idx = buffer.indexOf("\n\n")) !== -1) {
					const raw = buffer.slice(0, idx).trim();
					buffer = buffer.slice(idx + 2);
					if (!raw.startsWith("data:")) continue;
					const payload = raw.slice(5).trim();
					if (payload === "[DONE]") continue;
					try {
						const obj = JSON.parse(payload) as {
							choices?: { delta?: { content?: string } }[];
							response?: string;
						};
						const delta = obj?.choices?.[0]?.delta?.content ?? obj?.response ?? "";
						if (delta) {
							await writer.write(aiEncoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
						}
					} catch {
						// ignore a malformed event boundary
					}
				}
			}
			await writer.write(aiEncoder.encode("data: [DONE]\n\n"));
		} catch (err) {
			const message = err instanceof Error ? err.message : "stream interrupted";
			try {
				await writer.write(aiEncoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
			} catch {
				// writer already closed
			}
		} finally {
			try {
				await writer.close();
			} catch {
				// already closed
			}
		}
	})();

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
			Connection: "keep-alive",
		},
	});
});

/**
 * Reverse-proxy `/api/*` to the Hono API.
 *
 * This exists so the browser only ever talks to the console's own origin. That
 * is not a preference — calling the API directly from the page does not work:
 *
 *   - Better Auth's session cookie would be set on the API's origin, making it
 *     third-party to this app. Safari and Firefox block third-party cookies
 *     outright and Chrome is phasing them out, so staff would be signed out on
 *     every navigation regardless of `credentials: "include"`.
 *   - A `Secure` cookie cannot be set over plain HTTP at all, and an HTTPS page
 *     calling an HTTP API is mixed content, which the browser blocks before the
 *     request is even made.
 *   - The API origin would have to be baked into the bundle at build time, so
 *     moving the API would mean rebuilding and redeploying the frontend.
 *
 * Proxying server-side makes the cookie first-party on the console origin, needs
 * no CORS, and keeps the API address a deploy-time variable. It mirrors the
 * proxy in century-nit-web's Worker.
 */
app.all("/api/*", async (c) => {
	const apiBase = c.env.API_BASE_URL;
	if (!apiBase) {
		return c.json(
			{
				error: {
					code: "API_NOT_CONFIGURED",
					message: "API_BASE_URL is not set on this Worker",
				},
			},
			503,
		);
	}

	const source = new URL(c.req.url);
	const target = new URL(source.pathname + source.search, apiBase);

	const headers = new Headers(c.req.raw.headers);
	headers.delete("host");
	for (const h of HOP_BY_HOP) headers.delete(h);

	// Let the API see the real client rather than the Cloudflare edge.
	const clientIp = c.req.header("cf-connecting-ip");
	if (clientIp) {
		headers.set("x-forwarded-for", clientIp);
		headers.set("x-real-ip", clientIp);
	}
	headers.set("x-forwarded-proto", source.protocol.replace(":", ""));
	headers.set("x-forwarded-host", source.host);
	// Marks the request as arriving through the ops console. The API uses it to
	// keep the console staff-only at sign-in: a client credential sign-in here
	// would mint a session cookie on the console host that shadows the staff
	// cookie and 403s every route. Server-set, so a client cannot fake it —
	// the header is overwritten on every proxied call.
	headers.set("x-centry-surface", "ops");

	const upstream = await fetch(
		new Request(target, {
			method: c.req.raw.method,
			headers,
			body: c.req.raw.body,
			// Workers follow redirects by default, which silently breaks OAuth: the
			// callback answers 302 with a Set-Cookie, and following it edge-side
			// drops the cookie and returns the final page body instead.
			redirect: "manual",
		}),
	);

	const responseHeaders = new Headers(upstream.headers);
	for (const h of HOP_BY_HOP) responseHeaders.delete(h);

	// Rewrite API-origin redirects onto this origin so the browser stays
	// same-origin and keeps sending the session cookie.
	const location = responseHeaders.get("location");
	if (location) {
		try {
			const resolved = new URL(location, apiBase);
			if (resolved.origin === new URL(apiBase).origin) {
				responseHeaders.set("location", resolved.pathname + resolved.search + resolved.hash);
			}
		} catch {
			// Not a URL we can parse — pass it through untouched.
		}
	}

	const bodyless =
		upstream.status === 101 ||
		upstream.status === 204 ||
		upstream.status === 205 ||
		upstream.status === 304;

	return new Response(bodyless ? null : upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
});

/**
 * Everything else is the SPA. `not_found_handling: "single-page-application"`
 * on the assets binding serves real files from disk and falls back to
 * index.html so React Router can client-route.
 */
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
