import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The Operations Center is deployed as its own Cloudflare Worker ("console"),
 * separate from the public web app.
 *
 * `base` is `/` so emitted asset URLs resolve from the assets binding root.
 * The router uses `basename="/ops"` so all existing `/ops/...` links work
 * without rewriting them across the codebase.
 */
export default defineConfig({
	base: "/",
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
				// Same surface marker the ops Worker sets — keeps dev sign-in
				// behaviour identical to production (console is staff-only).
				headers: { "x-centry-surface": "ops" },
			},
		},
	},
	build: {
		outDir: "dist/client",
		emptyOutDir: true,
	},
});
