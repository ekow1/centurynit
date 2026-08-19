/* Century NIT Operations — service worker for the console.
 *
 * The ops console is a separate Cloudflare Worker (a different origin from the
 * public web app), so it needs its own service worker to receive Web Push.
 *
 * Unlike the portal's worker this one does NO caching: the console is a
 * staff-only SPA whose routing is handled client-side, and caching navigations
 * here would pin staff to a stale admin bundle after an ops-only deploy. The
 * only responsibility of this worker is to display push notifications and
 * focus the right tab when they're clicked.
 */

self.addEventListener("install", () => {
	// Activate immediately — no cached shell to wait for.
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

/* ── Fetch (network-only passthrough) ────────────────────────────────────────
 * The ops console does NO caching — staff must always see the latest admin
 * bundle. But Chrome requires a fetch handler to consider the SW a real PWA
 * worker (installability). A passthrough that just calls the network satisfies
 * that without ever serving stale content. */
self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;
	event.respondWith(fetch(event.request));
});

/* ── Web Push ─────────────────────────────────────────────────────────────── */

self.addEventListener("push", (event) => {
	let payload;
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = { title: "Century NIT Operations", body: event.data ? event.data.text() : "" };
	}

	const title = payload.title || "Century NIT Operations";
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
