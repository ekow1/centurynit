import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { servicePackages } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireModule,
	type AuthVariables,
} from "../middleware/auth.js";
import {
	servicePackageSchema,
	createServicePackageSchema,
	updateServicePackageSchema,
	packageCodeSchema,
} from "century-nit-shared";

const packagesRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const packageListResponseSchema = z.object({
	packages: z.array(servicePackageSchema),
});

const packageResponseSchema = z.object({
	package: servicePackageSchema,
});

const packageParamsSchema = z.object({
	code: packageCodeSchema,
});

/* ── GET /api/v1/packages (public / authed browse) ────────────────────────── */

packagesRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Packages"],
		summary: "List active service packages",
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: {
					"application/json": { schema: packageListResponseSchema },
				},
				description: "Active packages, sorted by sort order",
			},
		},
	}),
	async (c) => {
		const rows = await db
			.select()
			.from(servicePackages)
			.where(eq(servicePackages.active, true))
			.orderBy(servicePackages.sortOrder, desc(servicePackages.createdAt));
		return c.json({
			packages: rows.map((r) => ({
				id: r.id,
				code: r.code,
				name: r.name,
				tagline: r.tagline,
				priceCents: r.priceCents,
				currency: r.currency,
				features: r.features,
				exclusions: r.exclusions,
				includedFeeKeys: r.includedFeeKeys,
				maxSchools: r.maxSchools,
				sortOrder: r.sortOrder,
				active: r.active,
				createdAt: r.createdAt.toISOString(),
				updatedAt: r.updatedAt.toISOString(),
			})),
		});
	},
);

/* ── GET /api/v1/packages/:code ───────────────────────────────────────────── */

packagesRouter.openapi(
	createRoute({
		method: "get",
		path: "/:code",
		tags: ["Packages"],
		summary: "Get a single package",
		middleware: [requireAuth] as const,
		request: {
			params: packageParamsSchema,
		},
		responses: {
			200: {
				content: {
					"application/json": { schema: packageResponseSchema },
				},
				description: "Package found",
			},
			404: { description: "Package not found" },
		},
	}),
	async (c) => {
		const { code } = c.req.valid("param" as never) as z.infer<typeof packageParamsSchema>;
		const [row] = await db
			.select()
			.from(servicePackages)
			.where(eq(servicePackages.code, code))
			.limit(1);
		if (!row) throw new HttpError(404, "PACKAGE_NOT_FOUND", "Package not found");
		return c.json({
			package: {
				id: row.id,
				code: row.code,
				name: row.name,
				tagline: row.tagline,
				priceCents: row.priceCents,
				currency: row.currency,
				features: row.features,
				exclusions: row.exclusions,
				includedFeeKeys: row.includedFeeKeys,
				maxSchools: row.maxSchools,
				sortOrder: row.sortOrder,
				active: row.active,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
			},
		});
	},
);

/* ── POST /api/v1/packages (staff create) ─────────────────────────────────── */

packagesRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["Packages"],
		summary: "Create or replace a service package",
		middleware: [requireAuth, requireModule("packages")] as const,
		request: {
			body: {
				content: { "application/json": { schema: createServicePackageSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: packageResponseSchema } },
				description: "Package created",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json" as never) as z.infer<typeof createServicePackageSchema>;
		const [existing] = await db
			.select({ id: servicePackages.id })
			.from(servicePackages)
			.where(eq(servicePackages.code, body.code))
			.limit(1);

		let row;
		if (existing) {
			[row] = await db
				.update(servicePackages)
				.set({
					...body,
					updatedAt: new Date(),
				})
				.where(eq(servicePackages.id, existing.id))
				.returning();
		} else {
			[row] = await db
				.insert(servicePackages)
				.values({ ...body })
				.returning();
		}

		return c.json({
			package: {
				id: row.id,
				code: row.code,
				name: row.name,
				tagline: row.tagline,
				priceCents: row.priceCents,
				currency: row.currency,
				features: row.features,
				exclusions: row.exclusions,
				includedFeeKeys: row.includedFeeKeys,
				maxSchools: row.maxSchools,
				sortOrder: row.sortOrder,
				active: row.active,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
			},
		});
	},
);

/* ── PUT /api/v1/packages/:code (staff update) ────────────────────────────── */

packagesRouter.openapi(
	createRoute({
		method: "put",
		path: "/:code",
		tags: ["Packages"],
		summary: "Update a service package",
		middleware: [requireAuth, requireModule("packages")] as const,
		request: {
			params: packageParamsSchema,
			body: {
				content: { "application/json": { schema: updateServicePackageSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: packageResponseSchema } },
				description: "Package updated",
			},
			404: { description: "Package not found" },
		},
	}),
	async (c) => {
		const { code } = c.req.valid("param" as never) as z.infer<typeof packageParamsSchema>;
		const body = c.req.valid("json" as never) as z.infer<typeof updateServicePackageSchema>;
		const [row] = await db
			.update(servicePackages)
			.set({ ...body, updatedAt: new Date() })
			.where(eq(servicePackages.code, code))
			.returning();
		if (!row) throw new HttpError(404, "PACKAGE_NOT_FOUND", "Package not found");
		return c.json({
			package: {
				id: row.id,
				code: row.code,
				name: row.name,
				tagline: row.tagline,
				priceCents: row.priceCents,
				currency: row.currency,
				features: row.features,
				exclusions: row.exclusions,
				includedFeeKeys: row.includedFeeKeys,
				maxSchools: row.maxSchools,
				sortOrder: row.sortOrder,
				active: row.active,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
			},
		});
	},
);

/* ── DELETE /api/v1/packages/:code (staff soft-delete) ────────────────────── */

packagesRouter.openapi(
	createRoute({
		method: "delete",
		path: "/:code",
		tags: ["Packages"],
		summary: "Deactivate a service package",
		middleware: [requireAuth, requireModule("packages")] as const,
		request: {
			params: packageParamsSchema,
		},
		responses: {
			200: { description: "Package deactivated" },
			404: { description: "Package not found" },
		},
	}),
	async (c) => {
		const { code } = c.req.valid("param" as never) as z.infer<typeof packageParamsSchema>;
		const [row] = await db
			.update(servicePackages)
			.set({ active: false, updatedAt: new Date() })
			.where(eq(servicePackages.code, code))
			.returning();
		if (!row) throw new HttpError(404, "PACKAGE_NOT_FOUND", "Package not found");
		return c.json({ ok: true });
	},
);

export { packagesRouter };
