import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		// Integration tests share one Postgres database and truncate between
		// cases, so they must not run concurrently with each other.
		fileParallelism: false,
		testTimeout: 20_000,
		hookTimeout: 30_000,
	},
});
