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
 */

const VERSION = "v3";
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

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.protocol !== "http:" && url.protocol !== "https:") return;

	// Cross-origin requests are none of our business.
	if (url.origin !== self.location.origin) return;

	// Rule 1 — the API is never cached, in either direction.
	if (isBypassed(url)) return;

	// Rule 2 — navigations are network-first so deploys land immediately.
	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response && response.ok) {
						const clone = response.clone();
						caches.open(CACHE).then((cache) => cache.put(request, clone));
					}
					return response;
				})
				// Offline: fall back to this document, then to the app shell.
				.catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
		);
		return;
	}

	// Static assets — cache-first, revalidating in the background. Build output
	// is content-hashed, so a stale hit here is a hit on a file that never changes.
	event.respondWith(
		caches.match(request).then((cached) => {
			const fetched = fetch(request)
				.then((response) => {
					if (response && response.status === 200 && response.type === "basic") {
						const clone = response.clone();
						caches.open(CACHE).then((cache) => cache.put(request, clone));
					}
					return response;
				})
				.catch(() => cached);
			return cached || fetched;
		}),
	);
});

/* ── Web Push ─────────────────────────────────────────────────────────────── */

self.addEventListener("push", (event) => {
	let payload;
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = { title: "Century NIT", body: event.data ? event.data.text() : "" };
	}

	const title = payload.title || "Century NIT";
	const options = {
		body: payload.body || "",
		icon: "/favicon.svg",
		badge: "/favicon.svg",
		tag: payload.id || undefined,
		data: {
			link: payload.link || "/",
		},
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();

	const link = event.notification.data?.link || "/";

	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					if (client.url.includes(self.location.origin) && "focus" in client) {
						client.navigate(link);
						return client.focus();
					}
				}
				if (self.clients.openWindow) {
					return self.clients.openWindow(link);
				}
			}),
	);
});
