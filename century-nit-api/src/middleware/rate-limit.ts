import type { Context, Next } from "hono";
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


export async function rateLimit(c: Context, next: Next) {
	const ip = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "unknown-ip";
	
	let routePath = c.req.routePath;
	if (routePath === "/*" || routePath === "/api/auth/*" || routePath === "*") {
		routePath = c.req.path;
	}
	
	let limit = 0;
	let windowSeconds = 60;

	// Assign limits based on the actual path
	if (routePath.includes("/sign-in/")) {
		limit = 10;
	} else if (routePath.includes("/sign-up/")) {
		limit = 5;
	} else if (routePath.includes("/phone-number/send-otp") || routePath.includes("/email-otp/send-verification-otp")) {
		limit = 3;
	} else if (routePath.includes("/forget-password")) {
		limit = 3;
	} else if (routePath.includes("/reset-password")) {
		limit = 5;
	}

	// If no limit is defined for this route, allow it without rate limiting
	if (limit === 0) {
		return next();
	}

	const key = `ratelimit:${routePath}:${ip}`;

	try {
		// Race the Redis op against a short timeout. If Redis is unreachable,
		// ioredis with maxRetriesPerRequest: null retries forever and the promise
		// never settles — the try/catch below only catches thrown errors, not a
		// hang, so without this the entire auth flow deadlocks on every request.
		const current = await Promise.race([
			connection.incr(key),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("RATE_LIMIT_REDIS_TIMEOUT")), 2_000),
			),
		]);
		if (current === 1) {
			await connection.expire(key, windowSeconds).catch(() => {});
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
		// Redis error or timeout — fail open so auth still works.
		console.error("[RateLimit] Redis unavailable, failing open:", e);
	}

	await next();
}
