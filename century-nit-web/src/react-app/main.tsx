import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
/* Cascade order is load-bearing: shared base, then this app's own layer, then
 * the mobile refinements on top of both. */
import "century-nit-core/styles/base.css";
import "./styles/app.css";
import "century-nit-core/styles/base.mobile.css";
import "./styles/app.mobile.css";
import "./styles/appointments.css";
import App from "./App.tsx";
import { getHealth } from "./lib/api.ts";

// Smoke test: verify the Hono API is reachable on the same origin.
getHealth()
	.then((res) => console.info("[century-nit] API health:", res))
	.catch((err) => console.error("[century-nit] API health check failed:", err));

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

// PWA service worker registration (production / supported browsers)
if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {
			/* silent - prototype may run without SW in some environments */
		});
	});
}
