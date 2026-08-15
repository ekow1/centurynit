import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { healthResponseSchema } from "century-nit-shared";

const health = new OpenAPIHono();

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

export { health };
