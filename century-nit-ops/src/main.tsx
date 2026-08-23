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
