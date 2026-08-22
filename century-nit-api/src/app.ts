import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { API_PREFIX, API_VERSION } from "century-nit-shared";
import { isAllowedOrigin } from "./lib/origins.js";
import { requestId } from "./middleware/requestId.js";
import { errorHandler } from "./middleware/error.js";
import { health } from "./routes/health.js";
import { auth, getAuthInstance } from "./routes/auth.js";
import { bookingsRouter } from "./routes/bookings.js";
import { calendarFeedsRouter } from "./routes/calendarFeeds.js";
import { invoicesRouter } from "./routes/invoices.js";
import { staffRouter } from "./routes/staff.js";
import { documentsRouter } from "./routes/documents.js";
import { avatarRouter } from "./routes/avatar.js";
import { settingsRouter } from "./routes/settings.js";
import { lookupsRouter } from "./routes/lookups.js";
import { catalogRoutes } from "./routes/catalog.js";
import { webhooksRouter } from "./routes/webhooks.js";
import {
	applicantsRouter,
	applicationsRouter,
	consultationsRouter,
	meRouter,
} from "./routes/cases.js";
import { meSchoolsRouter, opsSchoolsRouter } from "./routes/schools.js";
import { opsTicketsRouter } from "./routes/tickets.js";
import { paymentsRouter } from "./routes/payments.js";
import { rolesRouter } from "./routes/roles.js";
import { leadsRouter } from "./routes/leads.js";
import { notificationsRouter } from "./routes/notifications.js";
import { clientUsersRouter } from "./routes/clientUsers.js";
import { chatRouter } from "./routes/chat.js";
import { meCommunicationRouter, communicationRouter } from "./routes/communication.js";
import { authSettings } from "./routes/auth-settings.js";
import { marketingRouter } from "./routes/marketing.js";
import { newsletterRouter } from "./routes/newsletter.js";
import { eventsRouter } from "./routes/events.js";
import { pushRouter } from "./routes/push.js";


/**
 * Just enough of the OpenAPI shape to merge two documents.
 *
 * Both sides have precise types of their own that disagree in the details, and
 * nothing here needs those details — only paths, their operations' tags, and the
 * component schemas.
 */
type OpenApiish = {
	paths?: Record<string, Record<string, { tags?: string[] }>>;
	components?: {
		schemas?: Record<string, unknown>;
		securitySchemes?: Record<string, unknown>;
	};
};

export function createApp() {
	const app = new OpenAPIHono<{ Variables: { requestId: string } }>();

	app.use(requestId);
	app.use(logger());
	app.use(secureHeaders());
	/*
	 * CORS.
	 *
	 * The origin list is shared with Better Auth's `trustedOrigins` so the two
	 * cannot drift (lib/origins.ts). It previously named only FRONTEND_URL and
	 * CONSOLE_URL, which left no way to allow an apex and its www twin, or a
	 * staging deployment, without changing source.
	 *
	 * `credentials: true` is the reason this has to be an explicit list: a
	 * browser refuses to send cookies to a response that answers `*`, and the
	 * session here is a cookie. `allowHeaders` is named rather than reflected —
	 * echoing whatever a caller asks for makes the preflight a formality.
	 *
	 * In normal use the frontends reach the API same-origin, through each
	 * Worker's `/api/*` proxy, so no preflight happens at all. This matters for
	 * the cases that are genuinely cross-origin: the API reference's "Test
	 * request" button, and local development against a deployed API.
	 */
	app.use(
		cors({
			origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
			credentials: true,
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
			exposeHeaders: ["X-Request-Id"],
			maxAge: 86_400,
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
	app.route("/api/webhooks", webhooksRouter);

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
	app.route(`${API_PREFIX}/calendar`, calendarFeedsRouter);
	app.route(`${API_PREFIX}/invoices`, invoicesRouter);
	app.route(`${API_PREFIX}/staff`, staffRouter);
	app.route(`${API_PREFIX}/auth-settings`, authSettings);
	app.route(`${API_PREFIX}/documents`, documentsRouter);
	app.route(`${API_PREFIX}/settings`, settingsRouter);
	app.route(`${API_PREFIX}/lookups`, lookupsRouter);
	app.route(`${API_PREFIX}/catalog`, catalogRoutes);
	app.route(`${API_PREFIX}/consultations`, consultationsRouter);
	app.route(`${API_PREFIX}/applications`, applicationsRouter);
	app.route(`${API_PREFIX}/applicants`, applicantsRouter);
	app.route(`${API_PREFIX}/me/schools`, meSchoolsRouter);
	app.route(`${API_PREFIX}/schools`, opsSchoolsRouter);
	app.route(`${API_PREFIX}/tickets`, opsTicketsRouter);
	app.route(`${API_PREFIX}/payments`, paymentsRouter);
	app.route(`${API_PREFIX}/roles`, rolesRouter);
	app.route(`${API_PREFIX}/leads`, leadsRouter);
	app.route(`${API_PREFIX}/client-users`, clientUsersRouter);
	app.route(`${API_PREFIX}/chat`, chatRouter);
	app.route(`${API_PREFIX}/communication`, communicationRouter);
	app.route(`${API_PREFIX}/me/communication`, meCommunicationRouter);
	app.route(`${API_PREFIX}/me`, meRouter);
	app.route(`${API_PREFIX}/me`, avatarRouter);
	app.route(`${API_PREFIX}/notifications`, notificationsRouter);
	app.route(`${API_PREFIX}/events`, eventsRouter);
	app.route(`${API_PREFIX}/marketing`, marketingRouter);
	app.route(`${API_PREFIX}/newsletter`, newsletterRouter);
	app.route(`${API_PREFIX}/push`, pushRouter);


	const openApiInfo = {
		openapi: "3.1.0" as const,
		info: {
			title: "Century NIT API",
			version: `${API_VERSION}.0.0`,
			description:
				`Backend API for Century NIT web and ops applications.\n\n` +
				`Resource routes are served under \`${API_PREFIX}\`. \`/api/health\` and ` +
				`\`/api/auth\` are deliberately unversioned — health is monitoring rather ` +
				`than contract, and \`/api/auth\` is Better Auth's own surface with its own ` +
				`compatibility story.\n\n` +
				`**First run:** create the first super administrator with ` +
				`\`POST ${API_PREFIX}/staff/bootstrap\` using the server's \`BOOTSTRAP_TOKEN\`. ` +
				`It refuses once any staff member exists. Every later account arrives by ` +
				`invitation — there is no staff sign-up endpoint.`,
		},
		/*
		 * Declared explicitly so the reference lists groups in a deliberate order
		 * rather than in whatever order the routers happen to be mounted.
		 * Authentication leads because it is the first thing an integrator needs.
		 */
		tags: [
			{
				name: "Authentication",
				description:
					"Better Auth. Email/password, Google, and one-time codes by email or " +
					"phone for clients; two-factor enrolment and verification for staff, " +
					"who are required to hold a second factor. Served unversioned at " +
					"`/api/auth`.",
			},
			{
				name: "Bookings",
				description: "Appointment booking, assignment, rescheduling and cancellation.",
			},
		{
			name: "Calendar",
			description:
				"Staff iCal/ICS availability mirror (read-only feed paste) and weekly working hours.",
		},
			{
				name: "Staff",
				description:
					"Super-admin bootstrap, invitations and the staff directory. " +
					"`POST /staff/bootstrap` is the only way to create the first account.",
			},
			{
				name: "Consultations",
				description: "Assessment cases. Created automatically when a booking is made.",
			},
			{
				name: "Applications",
				description: "School-application files opened after a successful assessment.",
			},
			{
				name: "Applicants",
				description: "Client profiles shared by consultations, applications and the portal.",
			},
			{
				name: "Documents",
				description: "Applicant document upload, review and download via signed URLs.",
			},
			{ name: "Invoices", description: "Invoicing, payments, voids and credit notes." },
			{
				name: "Settings",
				description: "Platform integration credentials, managed from the ops console.",
			},
			{
				name: "Webhooks",
				description:
					"Provider event delivery. Unversioned — Paystack points a fixed URL " +
					"at this Worker and retries failures, so the contract must not move.",
			},
			{
				name: "Health",
				description: "Liveness and readiness. Unversioned — monitoring, not contract.",
			},
		{
			name: "Chat",
			description:
				"Internal staff-to-staff messaging. Conversations, messages, " +
				"@mentions, and unread counts. All staff roles have access.",
		},
		{
			name: "Notifications",
			description:
				"Real-time in-app notifications via Server-Sent Events, plus " +
				"Web Push subscription management. Each authenticated user gets " +
				"a personal SSE stream at /events/stream.",
		},
	{
		name: "Web Push",
		description:
			"Browser push notifications. Subscribe a browser, fetch the VAPID " +
			"public key, and unsubscribe.",
	},
	{ name: "Schools", description: "School-application management and scholarships." },
	{ name: "Tickets", description: "Client support tickets and messages." },
	{ name: "Payments", description: "Paystack checkout initiation, verification and webhooks." },
	{ name: "Roles", description: "Staff role definitions and permissions." },
	{ name: "CRM Leads", description: "Lead capture, events and pipeline management." },
	{
		name: "Client Directory & Access Control",
		description: "Client-user accounts, bans and session revocation.",
	},
	{ name: "Communication", description: "Staff presence, routing and conversation context." },
	{ name: "Marketing", description: "Campaigns, mailing lists and reusable templates." },
	],
	};

	/**
	 * One document covering both halves of the API.
	 *
	 * Better Auth serves its own routes and its own schema, so sign-in, sign-up,
	 * phone and email one-time codes, and two-factor enrolment were absent from
	 * this document entirely — 52 endpoints that exist and work but could not be
	 * found or tried from `/api/docs`. Anyone reading the reference to integrate
	 * would conclude the API had no authentication at all.
	 *
	 * So the two are merged at request time rather than maintained by hand: this
	 * app's routes from `getOpenAPIDocument`, Better Auth's from its generator,
	 * with its paths prefixed onto the basePath it is actually mounted at and its
	 * operations tagged so they group separately in the UI.
	 *
	 * Generated per request, not cached — this is a documentation endpoint hit by
	 * humans, and staleness would be a worse trade than the cost.
	 */
	app.get("/api/openapi.json", async (c) => {
		const doc = app.getOpenAPIDocument(openApiInfo) as unknown as OpenApiish & {
			paths: NonNullable<OpenApiish["paths"]>;
		};

		try {
			const authSchemaRaw: unknown = await (await getAuthInstance()).api.generateOpenAPISchema();
			const authSchema = authSchemaRaw as OpenApiish;

			for (const [path, operations] of Object.entries(authSchema.paths ?? {})) {
				for (const operation of Object.values(operations)) {
					// Better Auth tags everything "Default"; retag so the reference does
					// not present 52 auth endpoints as untagged siblings of ours.
					operation.tags = ["Authentication"];
				}
				doc.paths[`/api/auth${path}`] = operations;
			}

			if (authSchema.components) {
				doc.components ??= {};
				doc.components.schemas = {
					...authSchema.components.schemas,
					// Ours win on a name collision — this document describes our contract.
					...(doc.components.schemas ?? {}),
				};
				// Its operations carry `security` referencing these by name; without
				// them the auth half of the document has dangling references.
				doc.components.securitySchemes = {
					...authSchema.components.securitySchemes,
					...(doc.components.securitySchemes ?? {}),
				};
			}
		} catch (err) {
			// A docs page must not be the thing that takes the API down.
			console.error("[openapi] could not merge the Better Auth schema:", err);
		}

		return c.json(doc);
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
