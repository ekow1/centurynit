import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { API_PREFIX, API_VERSION } from "century-nit-shared";
import { env } from "./env.js";
import { requestId } from "./middleware/requestId.js";
import { errorHandler } from "./middleware/error.js";
import { health } from "./routes/health.js";
import { auth } from "./routes/auth.js";
import { bookingsRouter } from "./routes/bookings.js";
import { calendarRouter } from "./routes/calendar.js";
import { invoicesRouter } from "./routes/invoices.js";
import { staffRouter } from "./routes/staff.js";
import { documentsRouter } from "./routes/documents.js";
import { settingsRouter } from "./routes/settings.js";

export function createApp() {
	const app = new OpenAPIHono<{ Variables: { requestId: string } }>();

	app.use(requestId);
	app.use(logger());
	app.use(secureHeaders());
	app.use(
		cors({
			origin: [env.FRONTEND_URL, env.CONSOLE_URL],
			credentials: true,
		}),
	);

	app.onError(errorHandler);

	app.get("/", (c) =>
		c.json({
			ok: true,
			service: "century-nit-api",
			apiVersion: API_VERSION,
			requestId: c.get("requestId"),
		}),
	);

	/*
	 * Unversioned on purpose.
	 *
	 * `/api/health` is monitoring, not contract — Dokploy, Traefik and the image's
	 * own HEALTHCHECK all point at it, and it should not move when the API's shape
	 * does.
	 *
	 * `/api/auth` is Better Auth's own surface. It derives every URL it issues
	 * from `baseURL + basePath`, so versioning it would mean re-registering the
	 * authorised redirect URI in Google Cloud and would invalidate password-reset
	 * links already sitting in inboxes. Better Auth manages its own compatibility;
	 * putting our version number on it would claim ownership we do not have.
	 */
	app.route("/api/health", health);
	app.route("/api/auth", auth);

	/*
	 * Everything that is genuinely our contract lives under a version prefix.
	 *
	 * The point is not that a v2 is planned. It is that the frontends are cached
	 * SPA bundles: during a rollout a browser can still be running yesterday's
	 * JavaScript against today's API. A version segment is what lets the old
	 * bundle keep working while the new shape ships alongside it, instead of
	 * every breaking change being a coordinated flag-day.
	 */
	app.route(`${API_PREFIX}/bookings`, bookingsRouter);
	app.route(`${API_PREFIX}/calendar`, calendarRouter);
	app.route(`${API_PREFIX}/invoices`, invoicesRouter);
	app.route(`${API_PREFIX}/staff`, staffRouter);
	app.route(`${API_PREFIX}/documents`, documentsRouter);
	app.route(`${API_PREFIX}/settings`, settingsRouter);

	app.doc("/api/openapi.json", {
		openapi: "3.1.0",
		info: {
			title: "Century NIT API",
			version: `${API_VERSION}.0.0`,
			description:
				`Backend API for Century NIT web and ops applications.\n\n` +
				`Resource routes are served under \`${API_PREFIX}\`. ` +
				`\`/api/health\` and \`/api/auth\` are deliberately unversioned — ` +
				`health is monitoring rather than contract, and \`/api/auth\` is Better Auth's ` +
				`own surface with its own compatibility story.`,
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
