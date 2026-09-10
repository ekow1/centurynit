/* Century NIT — offline shell for the PWA.
 *
 * Two rules this file exists to enforce:
 *
 *  1. NEVER touch /api/*. Auth session responses are per-user and short-lived;
 *     caching them serves a stale (or another user's) session out of the browser
 *     cache. Anything under /api goes straight to the network, uncached.
 *
 *  2. Navigations are network-first. A cache-first document response pins users
 *     to the index.html they first loaded, so a deploy never reaches them until
 *     they hard-refresh. Static hashed assets are safe to serve cache-first
 *     because their filenames change on every build.
 *
 *  respondWith guarantee: the fetch handler must resolve with a Response in
 *  every branch. A rejected promise or a non-Response resolves to
 *  "The FetchEvent ... resulted in a network error response" and
 *  "Failed to convert value to 'Response'", so the last line of defence is a
 *  synthetic 503 Response that can never throw.
 */

const VERSION = "v5";
const CACHE = `century-nit-${VERSION}`;
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg"];

/** Paths the service worker must never read from or write to the cache. */
function isBypassed(url) {
	return (
		url.pathname === "/api" ||
		url.pathname.startsWith("/api/") ||
		// /ops is the Operations Center — a different application on this origin,
		// with its own build and its own deploy cadence. This worker is registered
		// by the public app and must not cache or shell-substitute another app's
		// routes, or staff get served a stale admin bundle after an ops-only deploy.
		url.pathname === "/ops" ||
		url.pathname.startsWith("/ops/") ||
		url.pathname === "/sw.js"
	);
}

/** Fire-and-forget cache write. Must never reject, for the same reason as above. */
function queueCachePut(request, response) {
	caches
		.open(CACHE)
		.then((cache) => cache.put(request, response))
		.catch(() => {});
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			// Individually, so one 404 in PRECACHE cannot fail the whole install.
			.then((cache) => Promise.allSettled(PRECACHE.map((p) => cache.add(p))))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

async function handleFetch(request) {
	// Rule 2 — navigations are network-first so deploys land immediately.
	// Offline: fall back to this document, then to the app shell, then to a
	// synthetic Response so respondWith never gets undefined.
	if (request.mode === "navigate") {
		try {
			const response = await fetch(request);
			if (response && response.ok) {
				queueCachePut(request, response.clone());
			}
			return response;
		} catch {
			const cached = (await caches.match(request)) || (await caches.match("/"));
			return cached || new Response("Offline", { status: 503, statusText: "Offline" });
		}
	}

	// Static assets — cache-first, revalidating in the background. Build output
	// is content-hashed, so a stale hit here is a hit on a file that never changes.
	const cached = await caches.match(request);
	const fetched = fetch(request)
		.then((response) => {
			if (response && response.status === 200 && response.type === "basic") {
				queueCachePut(request, response.clone());
			}
			return response;
		})
		.catch(() => cached || new Response("Offline", { status: 503, statusText: "Offline" }));
	return cached || fetched;
}

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.protocol !== "http:" && url.protocol !== "https:") return;

	// Cross-origin requests are none of our business.
	if (url.origin !== self.location.origin) return;

	// Rule 1 — the API is never cached, in either direction.
	if (isBypassed(url)) return;

	// Final line of defence: handleFetch can theoretically still reject, so the
	// wrap turns any rejection into the same synthetic Response instead of an
	// unhandled FetchEvent error.
	event.respondWith(
		handleFetch(request).catch(() => new Response("Offline", { status: 503, statusText: "Offline" })),
	);
});