import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";

/**
 * The Turnstile secret is a Worker secret (`wrangler secret put TURNSTILE_SECRET`),
 * so it is not part of the generated `Env`. Declared here to merge with the
 * generated binding types.
 */
declare global {
	interface Env {
		TURNSTILE_SECRET?: string;
	}
}

/**
 * Edge AI chat for the Century NIT portal.
 *
 * The web Worker already reverse-proxies `/api/*` to the Hono backend on the
 * VPS. This route, `/ai/chat`, stays on the edge and talks to the Workers AI
 * binding directly, so inference happens in Cloudflare's network with no VPS
 * round-trip. It is deliberately outside `/api/*` so the proxy never sees it.
 *
 * The portal's two AI surfaces (FloatingChat and CommunicationCenter) post the
 * conversation history here; the worker prepends a per-surface system prompt and
 * streams LLM tokens back as Server-Sent Events. Auth is the portal's
 * session cookie. The surfaces are behind `RequireAuth` in the SPA, and the
 * assistant only answers general knowledge questions, so no extra verification
 * is needed at the edge.
 */

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

type ChatRole = "user" | "assistant";
interface IncomingMessage {
	role: ChatRole;
	content: string;
}

type Surface = "portal-floating" | "portal-comm" | "web";

/** Action string embedded in the first-visit Turnstile widget and verified server-side. */
const WEB_ACTION = "site_verify";

/** Keep only the most recent turns so the prompt fits the model's context window. */
const MAX_HISTORY = 8;
/** Hard ceiling on a single message to bound prompt size. */
const MAX_MESSAGE_CHARS = 2000;
/** Cap the assistant's response length. */
const MAX_TOKENS = 512;

/**
 * The portal's own route map, given to the signed-in tiers so the assistant
 * can link straight into the client's account. Tier 0 (public web) never
 * sees this list — and is instructed never to emit links at all.
 */
const PORTAL_MAP = [
	"Portal pages you may link to (path · what it is):",
	"- /portal/home · dashboard: what is happening now, the next action",
	"- /portal/documents · document vault: upload + verification status",
	"- /portal/financial · payments: invoices, fees, balances, payment plans",
	"- /portal/appointments · consultations: book, reschedule, join online",
	"- /portal/profile · account details and notification settings",
	"- /portal/consultation · stage I, the consultation",
	"- /portal/package · stage II, enrolment: plan, services, fees",
	"- /portal/application · stage III, applications to universities",
	"- /portal/tracking · application tracking",
	"- /portal/visa · stage IV, visa guidance and checklist",
	"- /portal/pre-departure · stage V, travel, papers and preparation",
	"- /portal/complete · stage VI, journey complete",
].join("\n");

const SYSTEM_PROMPTS: Record<Surface, string> = {
	"portal-floating": [
		"You are the AI Assistant inside the Century NIT client portal — the first point of support for a signed-in applicant.",
		"Concentrate ONLY on Century NIT: destinations, programmes, document requirements, IELTS, visa processing and the applicant journey as Century NIT runs it. No generic study-abroad advice, no other agencies.",
		"The applicant context block below carries their real journey state — stage, next step, invoice status. Use it to answer THEIR question, not a generic one, and to pick the right page.",
		PORTAL_MAP,
		"You MAY link to those portal pages — write them as 'Open Documents → /portal/documents'. Never link anywhere else, never invent a URL, and never expose staff console pages.",
		"Answer concisely (2–4 short sentences plus a link when one helps). If the request needs a person — a complaint, a refund, a decision — say so and point them to the Support or Officer tab, which reaches the desk with your transcript.",
		"Never invent fees, deadlines or university-specific requirements you are not sure of; if unsure, say so and suggest the consultant.",
	].join("\n"),
	"portal-comm": [
		"You are CENTURY AI inside the applicant Communication Hub — the first point of support for a signed-in client of Century NIT, a Ghanaian immigration & education consultancy.",
		"Concentrate ONLY on Century NIT: admissions, visa requirements, scholarships, documents, payments and the application stages as Century NIT handles them. No generic advice, no other providers.",
		"The applicant context block below carries their real journey state — stage, next step, invoice status. Use it to answer THEIR question, not a generic one, and to pick the right page.",
		PORTAL_MAP,
		"You MAY link to those portal pages — write them as 'Open Payments → /portal/financial'. Never link anywhere else, never invent a URL, and never expose staff console pages.",
		"You cannot route messages or reach staff yourself. For anything needing a person, tell the user to switch to the SUPPORT or OFFICER channel in this hub — the handoff carries this transcript.",
		"Never invent fees, deadlines or university-specific requirements; if unsure, say so and point them to a consultant.",
	].join("\n"),
	web: [
		"You are the website assistant for Century NIT Consult, a Ghanaian immigration & education consultancy, talking to a visitor who is NOT signed in.",
		"Concentrate ONLY on Century NIT: destinations, programmes, document requirements, IELTS, visa processing, scholarships and timelines. No generic study-abroad advice, no other agencies.",
		"You are Tier 0 — general guidance only. Describe the process in plain words (a consultation first, then a portal account, then documents, payments and stages unlock in order).",
		"HARD RULE: never include a link, URL, path, or 'go to X' direction in a reply — not to portal pages, not to external sites, not even to this site's own pages. If they ask for a link, explain that account pages only exist after signing in, and invite them to start their journey or sign in first.",
		"Never quote prices or exact fees to a signed-out visitor — describe that pricing is confirmed at consultation.",
		"Answer concisely (2–4 short sentences), warm and helpful. For anything specific, point them to the WhatsApp / Email tabs or to starting their journey.",
		"Never invent fees, deadlines or university-specific requirements; if unsure, say so and invite them to contact Century NIT.",
	].join("\n"),
};

const encoder = new TextEncoder();

function badRequest(message: string) {
	return Response.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 });
}

/**
 * Signed "visitor verified" cookie. Issued once after a real Turnstile token is
 * validated at `POST /turnstile/verify`, then trusted by `POST /ai/chat` for the
 * public `web` surface so the chat itself doesn't re-challenge on every message.
 *
 * The value is `base64url(payload).base64url(hmac-sha256(payload))`, signed with
 * the Turnstile secret. Stateless, no KV/D1 needed.
 */
const VERIFY_COOKIE = "cnit_v";
const VERIFY_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = "";
	for (const b of view) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
	const padded = value.length % 4 ? value + "=".repeat(4 - (value.length % 4)) : value;
	const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
		"verify",
	]);
}

async function issueVerified(secret: string): Promise<string> {
	const payload = b64urlEncode(encoder.encode(JSON.stringify({ exp: Date.now() + VERIFY_MAX_AGE * 1000 })));
	const key = await hmacKey(secret);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
	return `${payload}.${b64urlEncode(sig)}`;
}

async function isVerified(value: string | undefined, secret: string | undefined): Promise<boolean> {
	if (!value || !secret) return false;
	const dot = value.lastIndexOf(".");
	if (dot < 1) return false;
	const payload = value.slice(0, dot);
	const sig = value.slice(dot + 1);
	if (!payload || !sig) return false;
	try {
		const key = await hmacKey(secret);
		const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), encoder.encode(payload));
		if (!ok) return false;
		const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { exp?: number };
		return typeof parsed.exp === "number" && parsed.exp > Date.now();
	} catch {
		return false;
	}
}

const app = new Hono<{ Bindings: Env }>();

/** Public config for the frontend (sitekey only. The secret stays server-side). */
app.get("/ai/config", (c) => {
	return Response.json({ turnstileSitekey: c.env.TURNSTILE_SITEKEY ?? "" });
});

/** Has this visitor already passed the first-visit Turnstile gate? */
app.get("/turnstile/status", async (c) => {
	const secret = c.env.TURNSTILE_SECRET;
	const verified = await isVerified(getCookie(c, VERIFY_COOKIE), secret);
	// `configured` lets the frontend avoid showing a gate that can never resolve.
	return Response.json({ configured: !!secret, verified });
});

/**
 * First-visit verification: validate a fresh Turnstile token, then set a signed
 * HttpOnly cookie so the rest of the public site (including `POST /ai/chat` for
 * the `web` surface) trusts the visitor without re-challenging.
 */
app.post("/turnstile/verify", async (c) => {
	const secret = c.env.TURNSTILE_SECRET;
	if (!secret) {
		return Response.json(
			{ error: { code: "TURNSTILE_NOT_CONFIGURED", message: "Bot protection is not configured yet." } },
			{ status: 503 },
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return badRequest("Request body must be valid JSON.");
	}
	const token = (body as { cfTurnstileResponse?: string } | null)?.cfTurnstileResponse;
	if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
		return c.json({ error: { code: "FORBIDDEN", message: "Verification required." } }, { status: 403 });
	}

	const failure = await verifyTurnstile(c, token);
	if (failure) return failure;

	const value = await issueVerified(secret);
	return Response.json(
		{ ok: true },
		{
			headers: {
				"Set-Cookie": `${VERIFY_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${VERIFY_MAX_AGE}`,
			},
		},
	);
});

/**
 * Canonical server-side Turnstile siteverify for the public `web` surface.
 * The portal surfaces are behind the SPA's `RequireAuth`, so they skip this.
 *
 * Fail closed: any network/parse error or field mismatch → 403.
 */
async function verifyTurnstile(c: Context, token: string): Promise<Response | null> {
	const secret = c.env.TURNSTILE_SECRET;
	if (!secret) {
		return Response.json(
			{ error: { code: "TURNSTILE_NOT_CONFIGURED", message: "Bot protection is not configured yet." } },
			{ status: 503 },
		);
	}

	const allowedHosts = new Set(
		(c.env.TURNSTILE_HOSTNAMES ?? "")
			.split(",")
			.map((h: string) => h.trim())
			.filter(Boolean),
	);
	if (allowedHosts.size === 0) {
		return Response.json(
			{ error: { code: "TURNSTILE_NOT_CONFIGURED", message: "Bot protection is not configured yet." } },
			{ status: 503 },
		);
	}

	const remoteIp = c.req.header("cf-connecting-ip") ?? undefined;

	let result: { success?: boolean; action?: string; hostname?: string } | null = null;
	try {
		const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				secret,
				response: token,
				...(remoteIp ? { remoteip: remoteIp } : {}),
			}).toString(),
		});
		if (!res.ok) return c.json({ error: { code: "FORBIDDEN", message: "Verification failed." } }, { status: 403 });
		result = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
	} catch {
		return c.json({ error: { code: "FORBIDDEN", message: "Verification failed." } }, { status: 403 });
	}

	const hostOk =
		!!result.hostname &&
		[...allowedHosts].some((h) => result.hostname === h || result.hostname!.endsWith(`.${h}`));
	if (!result?.success || result.action !== WEB_ACTION || !hostOk) {
		return c.json({ error: { code: "FORBIDDEN", message: "Verification failed." } }, { status: 403 });
	}
	return null;
}

app.post("/ai/chat", async (c) => {
	if (!c.env.AI) {
		return Response.json(
			{ error: { code: "AI_UNAVAILABLE", message: "Workers AI binding is not configured." } },
			{ status: 503 },
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return badRequest("Request body must be valid JSON.");
	}

	const surface = (body as { surface?: string } | null)?.surface;
	const messages = (body as { messages?: IncomingMessage[] } | null)?.messages;
	const context = (body as { context?: Record<string, string> } | null)?.context;

	if (surface !== "portal-floating" && surface !== "portal-comm" && surface !== "web") {
		return badRequest("`surface` must be 'portal-floating', 'portal-comm' or 'web'.");
	}
	if (!Array.isArray(messages) || messages.length === 0) {
		return badRequest("`messages` must be a non-empty array.");
	}

	// The public web surface must have passed the first-visit Turnstile gate
	// (signed `cnit_v` cookie). The authed portal surfaces do not.
	if (surface === "web") {
		const secret = c.env.TURNSTILE_SECRET;
		if (!secret) {
			return c.json(
				{ error: { code: "TURNSTILE_NOT_CONFIGURED", message: "Bot protection is not configured yet." } },
				{ status: 503 },
			);
		}
		const verified = await isVerified(getCookie(c, VERIFY_COOKIE), secret);
		if (!verified) {
			return c.json(
				{ error: { code: "VERIFICATION_REQUIRED", message: "Please complete the verification first." } },
				{ status: 403 },
			);
		}
	}

	// Portal surfaces are journey-aware and may link into the account — that
	// tier must be earned server-side, not claimed by the request body. Forward
	// the session cookie to the API's session probe, the same check the ops
	// worker makes for staff.
	if (surface !== "web") {
		const apiBase = c.env.API_BASE_URL || "http://localhost:3000";
		try {
			const me = await fetch(`${apiBase}/api/auth/me`, {
				headers: { cookie: c.req.header("cookie") ?? "" },
			});
			const session = (await me.json()) as { user?: unknown } | null;
			if (!me.ok || !session?.user) {
				return c.json(
					{ error: { code: "UNAUTHORIZED", message: "Sign in to use the portal assistant." } },
					{ status: 401 },
				);
			}
		} catch {
			return c.json(
				{ error: { code: "AUTH_UNAVAILABLE", message: "Could not verify the portal session." } },
				{ status: 503 },
			);
		}
	}

	const trimmed = messages
		.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
		.slice(-MAX_HISTORY)
		.map((m) => ({
			role: m.role,
			content: m.content.slice(0, MAX_MESSAGE_CHARS),
		}));

	if (trimmed.length === 0) {
		return badRequest("`messages` contained no usable turns.");
	}

	const systemPrompt = [SYSTEM_PROMPTS[surface]];
	if (context && typeof context === "object") {
		const ctxLines = Object.entries(context)
			.filter(([, v]) => typeof v === "string" && v.trim())
			.map(([k, v]) => `- ${k}: ${v}`)
			.slice(0, 6);
		if (ctxLines.length) {
			systemPrompt.push(`Applicant journey context (their real state — answer THEIR situation):`, ctxLines.join("\n"));
		}
	}

	const payload = {
		messages: [
			{ role: "system", content: systemPrompt.join("\n\n") },
			...trimmed,
		],
		stream: true,
		max_tokens: MAX_TOKENS,
	};

	let aiStream: ReadableStream;
	try {
		aiStream = (await c.env.AI.run(AI_MODEL, payload)) as unknown as ReadableStream;
	} catch (err) {
		const message = err instanceof Error ? err.message : "AI inference failed.";
		console.error("[AI_FAILED]", message, err instanceof Error ? err.stack : err);
		return Response.json(
			{ error: { code: "AI_FAILED", message } },
			{ status: 502 },
		);
	}

	/**
	 * Re-encode the model's token stream as SSE. Each event carries either
	 * `{ delta }` with a text fragment, or `{ error }`, and the stream closes
	 * with a sentinel `data: [DONE]`.
	 */
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();

	// Fire the stream pump in the background; the returned `readable` stays
	// open until the writer closes, so the browser receives tokens as they
	// arrive.
	(async () => {
		try {
			// The Workers AI stream for this model is a raw SSE byte stream in
			// OpenAI chat-completion shape (`choices[0].delta.content`). Parse it
			// and re-emit as our own compact `{ delta }` SSE so the frontend hook
			// stays format-agnostic.
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
							await writer.write(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
						}
					} catch {
						// ignore a malformed event boundary
					}
				}
			}
			await writer.write(encoder.encode("data: [DONE]\n\n"));
		} catch (err) {
			const message = err instanceof Error ? err.message : "stream interrupted";
			try {
				await writer.write(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
			} catch {
				// writer already closed. Nothing more to do
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

/** Hop-by-hop headers. Meaningful to one connection, never to be forwarded. */
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

/**
 * Reverse-proxy all `/api/*` requests to the Hono backend.
 *
 * This keeps the frontend on the same origin for cookies/CORS while the actual
 * API runs on the VPS.
 *
 * Two details matter here:
 *
 *  - `redirect: "manual"`. Workers' fetch follows redirects by default, which
 *    silently breaks OAuth: the Google callback answers 302 with a Set-Cookie,
 *    and a followed redirect hands the browser the *final page body* while the
 *    session cookie is dropped somewhere in the middle. The browser has to see
 *    the 3xx itself.
 *
 *  - The response is rebuilt rather than returned as-is, because a Response
 *    from fetch has immutable headers and the Location header of a backend
 *    redirect has to be rewritten back onto this origin.
 */
app.all("/api/*", async (c) => {
	const apiBase = c.env.API_BASE_URL || "http://localhost:3000";
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

	const upstream = await fetch(
		new Request(target, {
			method: c.req.raw.method,
			headers,
			body: c.req.raw.body,
			redirect: "manual",
		}),
	);

	const responseHeaders = new Headers(upstream.headers);
	for (const h of HOP_BY_HOP) responseHeaders.delete(h);

	// Rewrite backend-origin redirects onto this origin so the browser stays
	// same-origin and keeps sending the session cookie.
	const location = responseHeaders.get("location");
	if (location) {
		try {
			const resolved = new URL(location, apiBase);
			if (resolved.origin === new URL(apiBase).origin) {
				responseHeaders.set("location", resolved.pathname + resolved.search + resolved.hash);
			}
		} catch {
			// Not a URL we can parse. Pass it through untouched.
		}
	}

	// 101/204/205/304 must not carry a body.
	const bodylessStatus = upstream.status === 101 || upstream.status === 204 || upstream.status === 205 || upstream.status === 304;

	return new Response(bodylessStatus ? null : upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
});

export default app;
