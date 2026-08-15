import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The Operations Center is served from `/ops/` on the same origin as the public
 * site — same origin because every link between the two halves (live case, ops
 * directives, CMS overlay, shared tickets) is a `localStorage` handshake, and
 * `localStorage` is per-origin.
 *
 * So `base` is `/ops/`: emitted asset URLs must be absolute from `/ops/`, and
 * the router is given the matching basename. The public app's Worker serves
 * this build's `index.html` for any `/ops/*` navigation.
 */
export default defineConfig({
	base: "/ops/",
	plugins: [react()],
	resolve: {
		preserveSymlinks: true,
	},
	server: {
		port: 5174,
		proxy: {
			"/api": {
				target: "http://localhost:3000",
				changeOrigin: true,
				secure: false,
			},
		},
	},
	build: {
		// Emitted into the public app's asset directory under /ops, so one
		// Workers deployment serves both builds from one origin.
		outDir: "../century-nit-web/dist/client/ops",
		emptyOutDir: true,
	},
});
