import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env.js";
import { requestId } from "./middleware/requestId.js";
import { errorHandler } from "./middleware/error.js";
import { health } from "./routes/health.js";
import { auth } from "./routes/auth.js";
import { bookingsRouter } from "./routes/bookings.js";
import { calendarRouter } from "./routes/calendar.js";
import { invoicesRouter } from "./routes/invoices.js";
import { staffRouter } from "./routes/staff.js";

export function createApp() {
	const app = new OpenAPIHono<{ Variables: { requestId: string } }>();

	app.use(requestId);
	app.use(logger());
	app.use(secureHeaders());
	app.use(
		cors({
			origin: env.FRONTEND_URL,
			credentials: true,
		}),
	);

	app.onError(errorHandler);

	app.get("/", (c) => c.json({ ok: true, service: "century-nit-api", requestId: c.get("requestId") }));
	app.route("/api/health", health);
	app.route("/api/auth", auth);
	app.route("/api/bookings", bookingsRouter);
	app.route("/api/calendar", calendarRouter);
	app.route("/api/invoices", invoicesRouter);
	app.route("/api/staff", staffRouter);

	app.doc("/api/openapi.json", {
		openapi: "3.1.0",
		info: {
			title: "Century NIT API",
			version: "1.0.0",
			description: "Backend API for Century NIT web and ops applications",
		},
	});

	app.get(
		"/api/docs",
		apiReference({
			spec: {
				url: "/api/openapi.json",
			},
		}),
	);

	app.notFound((c) => {
		const requestId = c.get("requestId");
		return c.json(
			{
				error: {
					code: "NOT_FOUND",
					message: "Not found",
				},
				requestId,
				timestamp: new Date().toISOString(),
			},
			404,
		);
	});

	return app;
}
