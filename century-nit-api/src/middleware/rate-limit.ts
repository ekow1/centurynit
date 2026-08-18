import type { MiddlewareHandler } from "hono";
import { connection } from "../worker/queues.js";
import { HttpError } from "./error.js";

/**
 * A highly performant rate limiter backed by Redis.
 * 
 * If Redis is temporarily unavailable, this will fail open (allow the request)
 * to prevent a cache failure from taking down the entire authentication system.
 *
 * @param limit Maximum number of requests allowed in the window.
 * @param windowSeconds Time window in seconds.
 */
export function rateLimit(limit: number, windowSeconds: number): MiddlewareHandler {
	return async (c, next) => {
		const ip = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "unknown-ip";
		
		// Better Auth routes might be deeply nested in the catch-all
		// To properly isolate them, we'll parse the raw path if it's inside /api/auth
		let routePath = c.req.routePath;
		if (routePath === "/*" || routePath === "/api/auth/*") {
			routePath = c.req.path;
		}
		
		const key = `ratelimit:${routePath}:${ip}`;

		try {
			const current = await connection.incr(key);
			if (current === 1) {
				await connection.expire(key, windowSeconds);
			}

			if (current > limit) {
				throw new HttpError(
					429,
					"TOO_MANY_REQUESTS",
					"Too many requests. Please try again later."
				);
			}
		} catch (e) {
			if (e instanceof HttpError) {
				throw e;
			}
			// Redis failure: log it and fail open
			console.error("[RateLimit] Error:", e);
		}

		await next();
	};
}
