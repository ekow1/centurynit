import { describe, expect, it } from "vitest";
import { API_PREFIX } from "century-nit-shared";
import { createApp } from "./app.js";

/**
 * The published API reference is a document assembled from two generators, and
 * neither of them fails loudly when it stops contributing.
 *
 * Better Auth serves its own routes and its own schema. Before `/api/openapi.json`
 * merged them in, the reference described an API with no way to sign in — 52
 * endpoints that existed and worked but could not be found or tried from
 * `/api/docs`. The merge is wrapped in a try/catch so a docs page can never take
 * the API down, which also means a broken merge degrades silently to exactly the
 * document we had before. That is precisely the regression these tests catch:
 * the type checker sees nothing wrong either way.
 */

async function fetchDocument() {
	const res = await createApp().request("/api/openapi.json");
	expect(res.status).toBe(200);
	return (await res.json()) as {
		paths: Record<string, Record<string, { tags?: string[] }>>;
		tags: { name: string }[];
		components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
	};
}

describe("/api/openapi.json", () => {
	it("documents the authentication routes clients and staff actually sign in through", async () => {
		const doc = await fetchDocument();

		// One per flow the product promises: password, social, the two one-time-code
		// channels, and staff second factor.
		for (const path of [
			"/api/auth/sign-in/email",
			"/api/auth/sign-up/email",
			"/api/auth/sign-in/social",
			"/api/auth/email-otp/send-verification-otp",
			"/api/auth/phone-number/send-otp",
			"/api/auth/two-factor/enable",
			"/api/auth/two-factor/verify-totp",
		]) {
			expect(doc.paths, `${path} is missing from the API reference`).toHaveProperty([path]);
		}
	});

	it("mounts the auth paths where Better Auth is actually served", async () => {
		const doc = await fetchDocument();
		const authPaths = Object.keys(doc.paths).filter((p) => p.startsWith("/api/auth/"));

		// Better Auth generates paths relative to its basePath, so an unprefixed
		// merge yields a document whose "Test request" button posts into the void.
		expect(authPaths.length).toBeGreaterThan(20);
		expect(Object.keys(doc.paths).some((p) => p === "/sign-in/email")).toBe(false);
	});

	it("documents the one route that creates the first super administrator", async () => {
		const doc = await fetchDocument();

		// Staff cannot self-register and invitations need an inviter, so if this
		// route is undiscoverable a fresh deployment has no documented way in.
		const bootstrap = doc.paths[`${API_PREFIX}/staff/bootstrap`];
		expect(bootstrap, "bootstrap is missing — a fresh deployment has no documented way in").toBeDefined();
		expect(bootstrap).toHaveProperty("post");
	});

	it("groups every operation under a declared tag", async () => {
		const doc = await fetchDocument();
		const declared = new Set(doc.tags.map((t) => t.name));

		const untagged: string[] = [];
		for (const [path, operations] of Object.entries(doc.paths)) {
			for (const [method, operation] of Object.entries(operations)) {
				const tag = operation.tags?.[0];
				// An untagged operation lands in an unnamed "default" bucket in the
				// reference, below everything else — present but effectively unfindable.
				if (!tag || !declared.has(tag)) untagged.push(`${method.toUpperCase()} ${path}`);
			}
		}

		expect(untagged).toEqual([]);
	});

	it("uses OpenAPI path templating, not Hono's colon syntax", async () => {
		const doc = await fetchDocument();

		// `/bookings/:id` is valid Hono and invalid OpenAPI: the reference renders
		// it as a literal path with no id field to fill in, so it cannot be tried.
		expect(Object.keys(doc.paths).filter((p) => p.includes(":"))).toEqual([]);
	});

	it("carries the security schemes its operations reference", async () => {
		const doc = await fetchDocument();
		const refs = new Set<string>();

		(function walk(node: unknown) {
			if (!node || typeof node !== "object") return;
			const ref = (node as { $ref?: unknown }).$ref;
			if (typeof ref === "string") refs.add(ref);
			for (const value of Object.values(node)) walk(value);
		})(doc);

		const dangling = [...refs].filter((ref) => {
			if (!ref.startsWith("#/")) return true;
			let cursor: unknown = doc;
			for (const segment of ref.slice(2).split("/")) {
				cursor = (cursor as Record<string, unknown> | undefined)?.[segment];
				if (cursor === undefined) return true;
			}
			return false;
		});

		expect(dangling).toEqual([]);
		expect(Object.keys(doc.components?.securitySchemes ?? {}).length).toBeGreaterThan(0);
	});
});
