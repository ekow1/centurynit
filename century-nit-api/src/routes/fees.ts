import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	destinationTariffSchema,
	feeCatalogueSchema,
	feeItemSchema,
	updateDestinationTariffSchema,
	updateFeeItemSchema,
} from "century-nit-shared";
import { requireAuth, requireCapability, requireMfa, type AuthVariables } from "../middleware/auth.js";
import { feeCatalogue, listFeeItems, updateDestinationTariff, updateFeeItem } from "../services/fees.js";

const router = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── GET /api/v1/fees — public: what the client will be charged ──────────── */

router.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Fees"],
		summary: "The fee catalogue — items, destination tariffs, exchange rate, service-fee split",
		responses: {
			200: { content: { "application/json": { schema: feeCatalogueSchema } }, description: "The live catalogue" },
		},
	}),
	async (c) => c.json(await feeCatalogue()),
);

/* ── Staff: edit Century's items and the destinations' tariffs ──────────── */

router.openapi(
	createRoute({
		method: "get",
		path: "/items",
		tags: ["Fees"],
		middleware: [requireAuth, requireMfa] as const,
		responses: {
			200: { content: { "application/json": { schema: z.object({ items: z.array(feeItemSchema) }) } }, description: "Every fee item, active or not" },
		},
	}),
	async (c) => c.json({ items: await listFeeItems() }),
);

router.openapi(
	createRoute({
		method: "put",
		path: "/items/{key}",
		tags: ["Fees"],
		middleware: [requireAuth, requireMfa, requireCapability("manage_settings")] as const,
		request: {
			params: z.object({ key: z.string().min(1).max(64) }),
			body: { content: { "application/json": { schema: updateFeeItemSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: feeItemSchema } }, description: "The item as saved" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const updated = await updateFeeItem(c.req.valid("param").key, c.req.valid("json"), { opsUserId: staff.opsUserId, email: staff.email });
		return c.json(updated);
	},
);

router.openapi(
	createRoute({
		method: "put",
		path: "/destinations/{id}",
		tags: ["Fees"],
		middleware: [requireAuth, requireMfa, requireCapability("manage_settings")] as const,
		request: {
			params: z.object({ id: z.string().min(1).max(64) }),
			body: { content: { "application/json": { schema: updateDestinationTariffSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: destinationTariffSchema } }, description: "The destination's tariffs as saved" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const updated = await updateDestinationTariff(c.req.valid("param").id, c.req.valid("json"), { opsUserId: staff.opsUserId, email: staff.email });
		return c.json(updated);
	},
);

export const feesRouter = router;
