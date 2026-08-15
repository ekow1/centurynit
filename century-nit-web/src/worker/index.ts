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

/**
 * Serve the Operations Center, which is a **separate application**
 * (`century-nit-ops`) with its own build, emitted into `dist/client/ops/`.
 *
 * Two SPAs share one assets directory, so the built-in
 * `not_found_handling: "single-page-application"` is not enough on its own: for
 * an unmatched path it falls back to the root `/index.html`, which would hand a
 * staff member the public site's bundle. `run_worker_first` routes `/ops/*`
 * here instead, and this picks the right shell.
 *
 * Same origin is the whole point. Every link between the two apps — the live
 * portal case, ops directives, the CMS overlay, shared support tickets — is a
 * `localStorage` handshake, and `localStorage` is scoped per origin. A separate
 * hostname for ops severs all four at once.
 */
app.all("/ops/*", serveOpsApp);
app.all("/ops", serveOpsApp);

async function serveOpsApp(c: { req: { url: string; raw: Request }; env: Env }) {
	const url = new URL(c.req.url);

	// A path with a file extension is a real asset (/ops/assets/index-a1b2.js).
	// Anything else is a client route, so it gets the ops shell.
	if (/\.[a-z0-9]+$/i.test(url.pathname)) {
		return c.env.ASSETS.fetch(c.req.raw);
	}

	const shell = new URL("/ops/index.html", url.origin);
	const response = await c.env.ASSETS.fetch(new Request(shell, { headers: c.req.raw.headers }));

	// The shell is one file behind many URLs; let the browser revalidate it so a
	// deploy is picked up rather than pinned. Also keep the staff tool out of
	// search indexes even if a route is ever linked publicly.
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-cache");
	headers.set("x-robots-tag", "noindex, nofollow");

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default app;
