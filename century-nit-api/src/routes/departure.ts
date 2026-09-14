import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { validationHook } from "../middleware/error.js";
import { z } from "zod";
import { preDepartureTemplateSchema } from "century-nit-shared";
import { requireAuth, requireCapability, requireMfa, type AuthVariables } from "../middleware/auth.js";
import {
	defaultPreDepartureTemplate,
	destinationDepartureTasks,
	preDepartureTemplate,
	saveDestinationDepartureTasks,
	savePreDepartureTemplate,
} from "../services/preDeparture.js";

/**
 * The pre-departure checklist template — the global list every case is
 * seeded with, and each destination's own items. Read by any staff; edited
 * with manage_settings.
 */
const router = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

router.openapi(
	createRoute({
		method: "get",
		path: "/template",
		tags: ["Departure"],
		middleware: [requireAuth, requireMfa] as const,
		responses: {
			200: {
				content: { "application/json": { schema: preDepartureTemplateSchema.extend({ defaults: preDepartureTemplateSchema.shape.items }) } },
				description: "The global template, and the code defaults to reset to",
			},
		},
	}),
	async (c) => c.json({ items: await preDepartureTemplate(), defaults: defaultPreDepartureTemplate() }),
);

router.openapi(
	createRoute({
		method: "put",
		path: "/template",
		tags: ["Departure"],
		middleware: [requireAuth, requireMfa, requireCapability("manage_settings")] as const,
		request: { body: { content: { "application/json": { schema: preDepartureTemplateSchema } }, required: true } },
		responses: {
			200: { content: { "application/json": { schema: preDepartureTemplateSchema } }, description: "The template as saved" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const items = await savePreDepartureTemplate(c.req.valid("json").items, { opsUserId: staff.opsUserId, email: staff.email });
		return c.json({ items });
	},
);

router.openapi(
	createRoute({
		method: "get",
		path: "/destinations/{id}",
		tags: ["Departure"],
		middleware: [requireAuth, requireMfa] as const,
		request: { params: z.object({ id: z.string().min(1).max(64) }) },
		responses: {
			200: { content: { "application/json": { schema: preDepartureTemplateSchema } }, description: "This destination's own items" },
		},
	}),
	async (c) => c.json({ items: await destinationDepartureTasks(c.req.valid("param").id) }),
);

router.openapi(
	createRoute({
		method: "put",
		path: "/destinations/{id}",
		tags: ["Departure"],
		middleware: [requireAuth, requireMfa, requireCapability("manage_settings")] as const,
		request: {
			params: z.object({ id: z.string().min(1).max(64) }),
			body: { content: { "application/json": { schema: preDepartureTemplateSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: preDepartureTemplateSchema } }, description: "The destination's items as saved" },
		},
	}),
	async (c) => c.json({ items: await saveDestinationDepartureTasks(c.req.valid("param").id, c.req.valid("json").items) }),
);

export const departureRouter = router;
