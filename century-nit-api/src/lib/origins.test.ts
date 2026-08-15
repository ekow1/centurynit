import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { allowedOrigins, isAllowedOrigin } from "./origins.js";

/**
 * CORS is a rule the server enforces and the browser reports, and when it goes
 * wrong nobody sees a useful error: the request is refused correctly, so the
 * server logs nothing, and the browser reports an opaque network failure. That
 * asymmetry is why this is tested rather than eyeballed.
 *
 * The list is computed once at module load from the environment, so these run
 * against the development defaults — localhost frontends, no ALLOWED_ORIGINS.
 * What is being checked is the matching behaviour, which does not vary by
 * environment.
 */

/** Read the header a browser actually decides on. */
async function allowOriginFor(origin: string): Promise<string | null> {
	const res = await createApp().request("/api/health", { headers: { Origin: origin } });
	return res.headers.get("access-control-allow-origin");
}

describe("origin matching", () => {
	it("allows the configured frontends", async () => {
		expect(await allowOriginFor("http://localhost:5173")).toBe("http://localhost:5173");
		expect(await allowOriginFor("http://localhost:5174")).toBe("http://localhost:5174");
	});

	it("refuses an origin that is not on the list", async () => {
		// No header at all is the refusal — the browser blocks the response.
		expect(await allowOriginFor("https://evil.com")).toBeNull();
	});

	it("refuses a lookalike host", async () => {
		// A subdomain of an attacker's domain: the trap for a naive `startsWith`
		// or a bare substring check.
		expect(isAllowedOrigin("http://localhost:5173.evil.com")).toBe(false);
		expect(await allowOriginFor("https://localhost:5173.evil.com")).toBeNull();

		// A host that merely *ends with* an allowed one: the trap for `endsWith`,
		// which is the usual way a domain allowlist gets quietly widened. Nothing
		// stops somebody registering `evilcenturynit.com`.
		expect(isAllowedOrigin("http://xlocalhost:5173")).toBe(false);
		expect(await allowOriginFor("http://xlocalhost:5173")).toBeNull();
	});

	it("refuses the right host on the wrong scheme or port", async () => {
		// An origin is scheme, host AND port. http and https are different
		// origins, and so are two ports on the same machine.
		expect(isAllowedOrigin("https://localhost:5173")).toBe(false);
		expect(isAllowedOrigin("http://localhost:9999")).toBe(false);
	});

	it("never answers a wildcard", () => {
		// `*` and `credentials: true` are mutually exclusive in every browser, so
		// a wildcard here would not loosen the policy — it would break sign-in.
		expect(allowedOrigins).not.toContain("*");
	});
});

describe("preflight", () => {
	it("answers an allowed origin with the methods and headers the apps use", async () => {
		const res = await createApp().request("/api/v1/documents", {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:5174",
				"Access-Control-Request-Method": "DELETE",
				"Access-Control-Request-Headers": "content-type",
			},
		});

		expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");

		// PATCH and DELETE are not in Hono's defaults for this header, and the ops
		// app cancels, reschedules and assigns with them.
		const methods = res.headers.get("access-control-allow-methods") ?? "";
		for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
			expect(methods).toContain(method);
		}
		expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
	});

	it("withholds the origin from a preflight it does not trust", async () => {
		const res = await createApp().request("/api/v1/documents", {
			method: "OPTIONS",
			headers: {
				Origin: "https://evil.com",
				"Access-Control-Request-Method": "DELETE",
			},
		});
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});

describe("development origins", () => {
	it("includes localhost outside production", () => {
		// These used to be hardcoded into Better Auth's trustedOrigins in every
		// environment, so a live deployment honoured callback URLs pointing at a
		// developer's machine. They belong here, conditional on NODE_ENV.
		expect(allowedOrigins).toContain("http://localhost:5173");
		expect(allowedOrigins).toContain("http://127.0.0.1:5173");
	});
});
