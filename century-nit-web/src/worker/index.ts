import { Hono } from "hono";

/**
 * Edge AI chat for the Century NIT portal.
 *
 * The web Worker already reverse-proxies `/api/*` to the Hono backend on the
 * VPS. This route — `/ai/chat` — stays on the edge and talks to the Workers AI
 * binding directly, so inference happens in Cloudflare's network with no VPS
 * round-trip. It is deliberately outside `/api/*` so the proxy never sees it.
 *
 * The portal's two AI surfaces (FloatingChat and CommunicationCenter) post the
 * conversation history here; the worker prepends a per-surface system prompt and
 * streams LLM tokens back as Server-Sent Events. Auth is the portal's
 * session cookie — the surfaces are behind `RequireAuth` in the SPA, and the
 * assistant only answers general knowledge questions, so no extra verification
 * is needed at the edge.
 */

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

type ChatRole = "user" | "assistant";
interface IncomingMessage {
	role: ChatRole;
	content: string;
}

type Surface = "portal-floating" | "portal-comm";

/** Keep only the most recent turns so the prompt fits the model's context window. */
const MAX_HISTORY = 8;
/** Hard ceiling on a single message to bound prompt size. */
const MAX_MESSAGE_CHARS = 2000;
/** Cap the assistant's response length. */
const MAX_TOKENS = 512;

const COMPANY_FACTS = [
	"Century NIT Consult is a licensed Ghanaian immigration & education consultancy, founded in 2011, based in Accra and Kumasi.",
	"Offices: Accra — Mile 7 Aku Link, Pentecost Junction; Kumasi — Santasi, adjacent the Post Office. Hours: Mon–Fri 8am–5pm, Sat 9am–12pm.",
	"Study destinations include the UK, USA, Canada, Germany, Australia and others.",
	"Standard documents: international passport, degree/WASSCE certificates, official transcripts, statement of purpose, two reference letters, and an updated CV.",
	"IELTS: most universities ask for 6.5 overall (no band below 6.0); competitive programmes may require 7.0–7.5.",
	"Visa processing typically takes 4–8 weeks depending on the country.",
	"Payments are taken securely via Paystack in GHS or USD; flexible post-arrival installment plans are available for agency fees after successful visa issuance.",
	"The applicant journey has 5 stages: I Consultation & Eligibility, II School Package/Shortlisting/Application, III Visa Processing, IV Financial Settlement & Post-Arrival, V Pre-Departure & Travel Clearance.",
].join(" ");

const SYSTEM_PROMPTS: Record<Surface, string> = {
	"portal-floating": [
		"You are the Century NIT AI Assistant inside an applicant's portal chat widget.",
		"Answer concisely (2–4 short sentences), in a friendly, professional tone.",
		"You help with general questions about study destinations, programmes, document requirements, IELTS, timelines and the application journey.",
		"You do NOT have access to this user's account, documents, invoices or booking details — for anything account-specific, tell them to use the Consultant or Support tabs in the same chat, or their portal pages.",
		"Stick to facts about Century NIT and studying abroad. If unsure, say so and suggest speaking with a consultant.",
		`Company facts: ${COMPANY_FACTS}`,
	].join(" "),
	"portal-comm": [
		"You are CENTURY AI, the knowledge assistant in the applicant Communication Hub.",
		"Answer concisely and accurately about university admissions, visa requirements, scholarships, required documents, payments and the application stages.",
		"You are a knowledge assistant only — you cannot see this user's case, route messages, or reach staff. For anything needing a person, tell the user to switch to the SUPPORT or OFFICER channel in the same hub.",
		"Stay on-brand and factual; never invent fees, deadlines or university-specific requirements you are not sure of.",
		`Company facts: ${COMPANY_FACTS}`,
	].join(" "),
};

const encoder = new TextEncoder();

function badRequest(message: string) {
	return Response.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 });
}

const app = new Hono<{ Bindings: Env }>();

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

	if (surface !== "portal-floating" && surface !== "portal-comm") {
		return badRequest("`surface` must be 'portal-floating' or 'portal-comm'.");
	}
	if (!Array.isArray(messages) || messages.length === 0) {
		return badRequest("`messages` must be a non-empty array.");
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
			systemPrompt.push(`Applicant context (for personalisation only — still keep it general):`, ctxLines.join("\n"));
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
			// Workers' ReadableStream is async-iterable; each chunk is an
			// AiTextGenerationOutput `{ response?: string }`.
			for await (const chunk of aiStream as unknown as AsyncIterable<{ response?: string }>) {
				const delta = chunk?.response ?? "";
				if (delta) {
					await writer.write(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
				}
			}
			await writer.write(encoder.encode("data: [DONE]\n\n"));
		} catch (err) {
			const message = err instanceof Error ? err.message : "stream interrupted";
			try {
				await writer.write(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
			} catch {
				// writer already closed — nothing more to do
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

/** Hop-by-hop headers — meaningful to one connection, never to be forwarded. */
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
			// Not a URL we can parse — pass it through untouched.
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
