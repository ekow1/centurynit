import { OpenAPIHono } from "@hono/zod-openapi";
import { getFeeSchedule } from "../services/invoice.js";

const router = new OpenAPIHono();

/**
 * [Public] GET /api/v1/fees
 * Returns the live fee schedule (USD cents) from platform_settings, falling
 * back to the shared defaults when a key is unset. The portal reads this so
 * the prices it shows match what ops configured, instead of hardcoded values.
 */
router.get("/", async (c) => {
	const fees = await getFeeSchedule();
	return c.json(fees);
});

export const feesRouter = router;
