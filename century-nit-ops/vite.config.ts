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
			},
		},
	},
	build: {
		outDir: "dist/client",
		emptyOutDir: true,
	},
});
