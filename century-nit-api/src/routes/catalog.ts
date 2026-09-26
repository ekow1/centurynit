import { Hono } from "hono";
import { db } from "../db/index.js";
import { destinations, catalogUniversities, catalogPrograms, catalogScholarships } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { randomUUID } from "node:crypto";
import {
	CatalogDestinationCreateSchema,
	CatalogDestinationUpdateSchema,
	CatalogUniversityCreateSchema,
	CatalogUniversityUpdateSchema,
	CatalogProgramCreateSchema,
	CatalogProgramUpdateSchema,
	CatalogScholarshipCreateSchema,
	CatalogScholarshipUpdateSchema,
} from "century-nit-shared";

export const catalogRoutes = new Hono();

// DESTINATIONS
catalogRoutes.get("/destinations", async (c) => {
	const all = await db.select().from(destinations).where(eq(destinations.isActive, true));
	return c.json({ destinations: all });
});
catalogRoutes.post("/destinations", requireAuth, requireStaff, async (c) => {
	const parsed = CatalogDestinationCreateSchema.parse(await c.req.json());
	const id = parsed.id ?? randomUUID();
	const result = await db.insert(destinations).values({ ...parsed, id }).returning();
	return c.json({ destination: result[0] });
});
catalogRoutes.put("/destinations/:id", requireAuth, requireStaff, async (c) => {
	const parsed = CatalogDestinationUpdateSchema.parse(await c.req.json());
	const result = await db
		.update(destinations)
		.set({ ...parsed, updatedAt: new Date() })
		.where(eq(destinations.id, c.req.param("id")))
		.returning();
	return c.json({ destination: result[0] });
});
catalogRoutes.delete("/destinations/:id", requireAuth, requireStaff, async (c) => {
	await db.delete(destinations).where(eq(destinations.id, c.req.param("id")));
	return c.json({ success: true });
});

// UNIVERSITIES
catalogRoutes.get("/universities", async (c) => {
	const destinationId = c.req.query("destinationId");
	const all = await db
		.select()
		.from(catalogUniversities)
		.where(
			and(
				eq(catalogUniversities.isActive, true),
				destinationId ? eq(catalogUniversities.destinationId, destinationId) : undefined,
			),
		);
	return c.json({ universities: all });
});
catalogRoutes.post("/universities", requireAuth, requireStaff, async (c) => {
	const parsed = CatalogUniversityCreateSchema.parse(await c.req.json());
	const id = parsed.id ?? randomUUID();
	const result = await db.insert(catalogUniversities).values({ ...parsed, id }).returning();
	return c.json({ university: result[0] });
});
catalogRoutes.put("/universities/:id", requireAuth, requireStaff, async (c) => {
	const parsed = CatalogUniversityUpdateSchema.parse(await c.req.json());
	const result = await db
		.update(catalogUniversities)
		.set({ ...parsed, updatedAt: new Date() })
		.where(eq(catalogUniversities.id, c.req.param("id")))
		.returning();
	return c.json({ university: result[0] });
});
catalogRoutes.delete("/universities/:id", requireAuth, requireStaff, async (c) => {
	await db.delete(catalogUniversities).where(eq(catalogUniversities.id, c.req.param("id")));
	return c.json({ success: true });
});

// PROGRAMS
catalogRoutes.get("/programs", async (c) => {
	const universityId = c.req.query("universityId");
	const all = await db
		.select()
		.from(catalogPrograms)
		.where(
			and(
				eq(catalogPrograms.isActive, true),
				universityId ? eq(catalogPrograms.universityId, universityId) : undefined,
			),
		);
	return c.json({ programs: all });
});
catalogRoutes.post("/programs", requireAuth, requireStaff, async (c) => {
	const parsed = CatalogProgramCreateSchema.parse(await c.req.json());
	const id = parsed.id ?? randomUUID();
	const result = await db.insert(catalogPrograms).values({ ...parsed, id }).returning();
	return c.json({ program: result[0] });
});
catalogRoutes.put("/programs/:id", requireAuth, requireStaff, async (c) => {
	const parsed = CatalogProgramUpdateSchema.parse(await c.req.json());
	const result = await db
		.update(catalogPrograms)
		.set({ ...parsed, updatedAt: new Date() })
		.where(eq(catalogPrograms.id, c.req.param("id")))
		.returning();
	return c.json({ program: result[0] });
});
catalogRoutes.delete("/programs/:id", requireAuth, requireStaff, async (c) => {
	await db.delete(catalogPrograms).where(eq(catalogPrograms.id, c.req.param("id")));
	return c.json({ success: true });
});

// SCHOLARSHIPS
catalogRoutes.get("/scholarships", async (c) => {
	const all = await db.select().from(catalogScholarships);
	return c.json({ scholarships: all });
});
catalogRoutes.post("/scholarships", requireAuth, requireStaff, async (c) => {
	const parsed = CatalogScholarshipCreateSchema.parse(await c.req.json());
	const id = parsed.id ?? randomUUID();
	const result = await db.insert(catalogScholarships).values({ ...parsed, id }).returning();
	return c.json({ scholarship: result[0] });
});
catalogRoutes.put("/scholarships/:id", requireAuth, requireStaff, async (c) => {
	const parsed = CatalogScholarshipUpdateSchema.parse(await c.req.json());
	const result = await db
		.update(catalogScholarships)
		.set({ ...parsed, updatedAt: new Date() })
		.where(eq(catalogScholarships.id, c.req.param("id")))
		.returning();
	return c.json({ scholarship: result[0] });
});
catalogRoutes.delete("/scholarships/:id", requireAuth, requireStaff, async (c) => {
	await db.delete(catalogScholarships).where(eq(catalogScholarships.id, c.req.param("id")));
	return c.json({ success: true });
});

