/**
 * The API's version segment.
 *
 * Defined once, here, because three places have to agree on it: the server that
 * mounts the routes, and the two front-end clients that call them. A version
 * prefix that drifts between client and server is worse than no prefix at all —
 * it fails as a 404 with no hint that a version mismatch is the cause.
 *
 * Scope: this covers the resource routes only. `/api/health` and `/api/auth`
 * are deliberately outside it — see the comments in the API's `app.ts`.
 */

export const API_VERSION = "v1";

/** Path prefix for every versioned resource route, e.g. `/api/v1/bookings`. */
export const API_PREFIX = `/api/${API_VERSION}` as const;

/**
 * Routes that sit outside the version prefix, and why.
 *
 * Listed rather than left implicit so the exceptions stay deliberate: anything
 * new added here should have a reason as good as these two.
 */
export const UNVERSIONED_ROUTES = {
	/** Monitoring, not contract. Traefik and the Docker HEALTHCHECK point at it. */
	health: "/api/health",
	/** Better Auth's own surface; it derives its URLs from baseURL + basePath. */
	auth: "/api/auth",
} as const;
