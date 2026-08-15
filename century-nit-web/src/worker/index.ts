import { Hono } from "hono";

declare global {
	interface Env {
		API_BASE_URL: string;
		/** Static assets for both front-end builds — see the /ops handler below. */
		ASSETS: Fetcher;
	}
}

const app = new Hono<{ Bindings: Env }>();

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
