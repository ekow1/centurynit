import { env } from "../env.js";

/**
 * Which browser origins this API answers to.
 *
 * There were two lists before, and they disagreed. Hono's CORS middleware
 * allowed exactly `[FRONTEND_URL, CONSOLE_URL]`, while Better Auth's
 * `trustedOrigins` allowed those plus `http://localhost:5173`, `:5174` and
 * `:3000` — hardcoded, so a production deployment trusted three localhost
 * origins for sign-in and callback-URL validation. Neither list could be
 * extended without editing source, which is the wrong shape for a value that
 * changes when a domain does.
 *
 * So it is computed once, here, and both consumers read it.
 *
 * ## Adding a domain
 *
 * `ALLOWED_ORIGINS` is a comma-separated list, added to the three URLs the API
 * already knows about. It is what an apex/www pair needs, and what a staging or
 * preview deployment needs:
 *
 *   ALLOWED_ORIGINS=https://centurynit.com,https://www.centurynit.com
 *
 * ## What counts as an origin
 *
 * Scheme, host and port — never a path. `https://example.com/app` is not an
 * origin, and a browser will never send one in an `Origin` header, so left
 * as-is it would match nothing.
 *
 * Entries go through `URL`, which forgives the near-misses: a trailing slash,
 * surrounding whitespace, or a pasted-in path all reduce to the right origin.
 * What it cannot parse at all is dropped with a warning at startup, because the
 * alternative is discovering it later as a CORS failure that presents as a
 * network fault.
 */

/** Normalise to scheme://host[:port], or null if it is not a usable origin. */
function toOrigin(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		return new URL(trimmed).origin;
	} catch {
		return null;
	}
}

/**
 * Local development origins.
 *
 * Only outside production. These were previously present in every environment,
 * which meant a live deployment would honour a callback URL pointing at the
 * developer's own machine.
 */
const DEV_ORIGINS = [
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:3000",
	"http://127.0.0.1:5173",
	"http://127.0.0.1:5174",
];

function build(): string[] {
	const configured = [
		env.BETTER_AUTH_URL,
		env.FRONTEND_URL,
		env.CONSOLE_URL,
		...env.ALLOWED_ORIGINS,
	];

	const rejected: string[] = [];
	const origins = new Set<string>();

	for (const value of configured) {
		const origin = toOrigin(value);
		if (origin) origins.add(origin);
		else rejected.push(value);
	}

	if (rejected.length > 0) {
		console.warn(
			`[cors] ignoring ${rejected.length} unusable origin(s): ${rejected.join(", ")}\n` +
				`      An origin is scheme://host[:port] with no path, e.g. https://app.example.com`,
		);
	}

	if (env.NODE_ENV !== "production") {
		for (const origin of DEV_ORIGINS) origins.add(origin);
	}

	return [...origins];
}

export const allowedOrigins = build();

/**
 * Whether a request's `Origin` header is allowed.
 *
 * Exact match on the full origin. No wildcards and no suffix matching:
 * `endsWith(".example.com")` is the classic way to accidentally trust
 * `evil-example.com`, and this list is short enough that it never needs to
 * guess.
 */
export function isAllowedOrigin(origin: string): boolean {
	return allowedOrigins.includes(origin);
}

/**
 * Shout about a production deployment that is reachable over plain HTTP.
 *
 * Called at startup rather than enforced, because a valid deployment can sit
 * behind a proxy that terminates TLS. But cookies for a cross-site session must
 * be `SameSite=None; Secure`, and a browser will not store a `Secure` cookie
 * from an `http://` origin — so this configuration produces a sign-in that
 * appears to succeed and then has no session, which is a miserable thing to
 * debug from the symptom.
 */
export function warnAboutInsecureOrigins(): void {
	if (env.NODE_ENV !== "production") return;

	const insecure = [
		["BETTER_AUTH_URL", env.BETTER_AUTH_URL],
		["FRONTEND_URL", env.FRONTEND_URL],
		["CONSOLE_URL", env.CONSOLE_URL],
	].filter(([, value]) => value.startsWith("http://"));

	for (const [name, value] of insecure) {
		console.warn(
			`[cors] ${name} is http:// in production (${value}). Sessions need ` +
				`Secure cookies, which browsers refuse over plain HTTP. Use the ` +
				`public https:// URL, not the container's address.`,
		);
	}
}
