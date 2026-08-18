import { OpenAPIHono } from "@hono/zod-openapi";
import { zValidator } from "@hono/zod-validator";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { lookupValues } from "../db/schema.js";
import { lookupUpsertSchema } from "century-nit-shared";
import { requireModule } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

const router = new OpenAPIHono();

/**
 * [Public] GET /api/v1/lookups
 * Returns all active lookup values for dropdowns (Portal).
 */
router.get("/", async (c) => {
	const all = await db
		.select()
		.from(lookupValues)
		.where(eq(lookupValues.isActive, true))
		.orderBy(asc(lookupValues.category), asc(lookupValues.sortOrder), asc(lookupValues.label));

	return c.json({ lookups: all });
});

/**
 * [Ops] GET /api/v1/lookups/all
 * Returns ALL lookup values including inactive ones.
 */
router.get("/all", requireModule("lookups"), async (c) => {
	const all = await db
		.select()
		.from(lookupValues)
		.orderBy(asc(lookupValues.category), asc(lookupValues.sortOrder), asc(lookupValues.label));

	return c.json({ lookups: all });
});

/**
 * [Ops] POST /api/v1/lookups
 * Create a new lookup value.
 */
router.post(
	"/",
	requireModule("lookups"),
	zValidator("json", lookupUpsertSchema),
	async (c) => {
		const payload = c.req.valid("json");

		const [inserted] = await db
			.insert(lookupValues)
			.values({
				category: payload.category,
				value: payload.value,
				label: payload.label,
				sortOrder: payload.sortOrder,
				isActive: payload.isActive,
			})
			.returning();

		return c.json(inserted);
	}
);

/**
 * [Ops] PUT /api/v1/lookups/:id
 * Update an existing lookup value.
 */
router.put(
	"/:id",
	requireModule("lookups"),
	zValidator("json", lookupUpsertSchema),
	async (c) => {
		const id = c.req.param("id");
		const payload = c.req.valid("json");

		const [updated] = await db
			.update(lookupValues)
			.set({
				category: payload.category,
				value: payload.value,
				label: payload.label,
				sortOrder: payload.sortOrder,
				isActive: payload.isActive,
				updatedAt: new Date(),
			})
			.where(eq(lookupValues.id, id))
			.returning();

		if (!updated) throw new HttpError(404, "NOT_FOUND", "Lookup not found");
		return c.json(updated);
	}
);

/**
 * [Ops] DELETE /api/v1/lookups/:id
 * Delete a lookup value.
 */
router.delete("/:id", requireModule("lookups"), async (c) => {
	const id = c.req.param("id");

	const [deleted] = await db.delete(lookupValues).where(eq(lookupValues.id, id)).returning();
	if (!deleted) throw new HttpError(404, "NOT_FOUND", "Lookup not found");

	return c.json({ success: true });
});

export { router as lookupsRouter };
