/**
 * Open a fetched URL in a new tab without tripping the popup blocker.
 *
 * `window.open()` must run inside the click's user-activation window. Called
 * after an `await` — the natural shape of "fetch a signed URL, then open it" —
 * the browser treats the tab as unrequested and silently blocks it, which is
 * why clicking a document appeared to do nothing.
 *
 * So the tab is opened synchronously (about:blank) while the activation is
 * live, and navigated once the URL resolves. On failure the tab is closed and
 * the error is rethrown for the caller to surface.
 */
export async function openInNewTab(
	urlPromise: Promise<{ url: string } | string>,
): Promise<void> {
	// No `noopener` in the feature string: the spec makes window.open return
	// null for it, which read as "popup blocked" on every click. Sever the
	// opener by hand once we hold the handle.
	const tab = window.open("", "_blank");
	if (!tab) {
		// Even a synchronous open was refused. Still settle the promise so a
		// rejection isn't unhandled, then tell the caller to surface it.
		void urlPromise.catch(() => {});
		throw new Error("Your browser blocked the new tab — allow pop-ups for this site and try again.");
	}
	tab.opener = null;
	try {
		const resolved = await urlPromise;
		tab.location.href = typeof resolved === "string" ? resolved : resolved.url;
	} catch (err) {
		tab.close();
		throw err;
	}
}
