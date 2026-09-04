import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";

/**
 * Shared Better Auth client for the applicant portal.
 *
 * The web Worker reverse-proxies `/api/auth/*` to the Hono backend, so the
 * client can stay same-origin and rely on the browser sending the session
 * cookie automatically.
 */
export const authClient = createAuthClient({
	baseURL: typeof window === "undefined" ? "" : window.location.origin,
	basePath: "/api/auth",
	plugins: [twoFactorClient()],
});
