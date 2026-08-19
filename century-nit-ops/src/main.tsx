import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/* Cascade order is load-bearing: shared base, then this app's own layer, then
 * the mobile refinements on top of both. The public site's styles are not here
 * — staff never download them. */
import "century-nit-core/styles/base.css";
import "./styles/app.css";
import "century-nit-core/styles/base.mobile.css";
import "./styles/app.mobile.css";
import "./styles/scheduling.css";

import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

// Service worker registration — required for Web Push delivery. The ops worker
// (`/sw.js`) only handles `push` and `notificationclick`; it does no caching,
// so registering it never risks serving a stale admin bundle.
if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {
			/* silent — prototype may run without SW in some environments */
		});
	});
}
