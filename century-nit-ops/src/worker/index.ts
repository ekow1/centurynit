import { Hono } from "hono";

declare global {
	interface Env {
		/** Origin of the Hono API, e.g. https://api.centurynit.com */
		API_BASE_URL: string;
		/** Built SPA assets. */
		ASSETS: Fetcher;
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
