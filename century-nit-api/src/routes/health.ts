import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { validationHook } from "../middleware/error.js";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { healthResponseSchema } from "century-nit-shared";

const health = new OpenAPIHono({ defaultHook: validationHook });

/**
 * Readiness, not just liveness.
 *
 * This used to answer 200 with `status: "ok"` whether or not the database was
 * reachable, downgrading only the `database` field in a body that nothing reads.
 * The Docker HEALTHCHECK and Traefik both treat this endpoint as the truth, so a
 * container with bad credentials was reported healthy and kept receiving
 * traffic; the first sign of trouble was a 500 on somebody's request.
 *
 * An API that cannot reach Postgres cannot serve any route worth calling, so it
 * says so with a status code, in the one place the platform is already looking.
 */
const route = createRoute({
	method: "get",
	path: "/",
	tags: ["Health"],
	responses: {
		200: {
			description: "Healthy — the database is reachable",
			content: { "application/json": { schema: healthResponseSchema } },
		},
		503: {
			description: "Unhealthy — the database is not reachable",
			content: { "application/json": { schema: healthResponseSchema } },
		},
	},
});

health.openapi(route, async (c) => {
	let dbOk = false;
	try {
		await db.execute(sql`SELECT 1`);
		dbOk = true;
	} catch (err) {
		// Logged rather than swallowed: when a health check starts failing, the
		// reason should already be in the logs by the time anyone looks.
		console.error("[health] database unreachable:", err instanceof Error ? err.message : err);
	}

	return c.json(
		{
			status: dbOk ? "ok" : "degraded",
			database: dbOk ? "connected" : "unavailable",
			timestamp: new Date().toISOString(),
		},
		dbOk ? 200 : 503,
	);
});

/* ── GET /health/detail ──────────────────────────────────────────────────────
 * The ops System Overview reads this. Unlike `/health` it always answers 200 —
 * it *reports* component state rather than gating traffic on it. Nothing here
 * is declared; every number is measured at request time.
 */

const detailRoute = createRoute({
	method: "get",
	path: "/detail",
	tags: ["Health"],
	responses: {
		200: { description: "Component health report" },
	},
});

health.openapi(detailRoute, async (c) => {
	const started = Date.now();

	let dbMs: number | null = null;
	try {
		const t0 = Date.now();
		await db.execute(sql`SELECT 1`);
		dbMs = Date.now() - t0;
	} catch {
		dbMs = null;
	}

	// Redis + queue depths. BullMQ queues share the one ioredis connection; a
	// ping failure also means the queues cannot drain.
	let redisMs: number | null = null;
	let queues: { name: string; waiting: number; failed: number }[] = [];
	try {
		const { connection, emailQueue, calendarQueue, pushQueue, campaignQueue } = await import("../worker/queues.js");
		const t0 = Date.now();
		await connection.ping();
		redisMs = Date.now() - t0;
		queues = await Promise.all(
			[
				["email", emailQueue],
				["calendar", calendarQueue],
				["push", pushQueue],
				["campaign", campaignQueue],
			] as const,
		).then(async (list) =>
			Promise.all(
				list.map(async ([name, q]) => {
					const counts = await q.getJobCounts("waiting", "delayed", "failed");
					return { name, waiting: counts.waiting + (counts.delayed ?? 0), failed: counts.failed ?? 0 };
				}),
			),
		);
	} catch {
		redisMs = null;
	}

	return c.json({
		status: dbMs !== null ? "ok" : "degraded",
		latencyMs: Date.now() - started,
		components: {
			database: { ok: dbMs !== null, ms: dbMs },
			redis: { ok: redisMs !== null, ms: redisMs },
			queues,
		},
		uptimeSeconds: Math.floor(process.uptime()),
		node: process.version,
		timestamp: new Date().toISOString(),
	});
});

export { health };
