import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { healthResponseSchema } from "century-nit-shared";

const health = new OpenAPIHono();

const route = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			description: "API health status",
			content: {
				"application/json": {
					schema: healthResponseSchema,
				},
			},
		},
	},
});

health.openapi(route, async (c) => {
	let dbOk = false;
	try {
		await db.execute(sql`SELECT 1`);
		dbOk = true;
	} catch {
		dbOk = false;
	}

	return c.json({
		status: "ok",
		database: dbOk ? "connected" : "unavailable",
		timestamp: new Date().toISOString(),
	});
});

export { health };
