import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
	listRoles,
	createRole,
	updateRole,
	deleteRole,
} from "../services/roles.js";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireMfa,
	requireRole,
	type AuthVariables,
} from "../middleware/auth.js";
import { opsModuleSchema, type OpsModule } from "century-nit-shared";

export const rolesRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const roleSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	isSystem: z.boolean(),
	permissions: z.array(opsModuleSchema),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const listRolesResponse = z.object({
	roles: z.array(roleSchema),
});

const createRoleBody = z.object({
	id: z.string().min(2).max(64),
	name: z.string().min(2).max(128),
	description: z.string().optional(),
	permissions: z.array(opsModuleSchema),
});

const updateRoleBody = z.object({
	name: z.string().min(2).max(128).optional(),
	description: z.string().optional(),
	permissions: z.array(opsModuleSchema).optional(),
});

/* ── GET /api/v1/roles ────────────────────────────────────────────────────── */

rolesRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Roles"],
		summary: "List all roles and their granular permissions",
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: listRolesResponse } },
				description: "List of all system and custom roles",
			},
		},
	}),
	async (c) => {
		const roles = await listRoles();
		return c.json({ roles });
	},
);

/* ── POST /api/v1/roles ───────────────────────────────────────────────────── */

rolesRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["Roles"],
		summary: "Create a custom role",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin")] as const,
		request: {
			body: {
				content: { "application/json": { schema: createRoleBody } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: roleSchema } },
				description: "The created role",
			},
			400: { description: "Validation error" },
		},
	}),
	async (c) => {
		const body = c.req.valid("json" as never) as z.infer<typeof createRoleBody>;
		try {
			const role = await createRole({
				id: body.id,
				name: body.name,
				description: body.description,
				permissions: body.permissions as OpsModule[],
			});
			return c.json(role, 201);
		} catch (err) {
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				err instanceof Error ? err.message : "Could not create role",
			);
		}
	},
);

/* ── PUT /api/v1/roles/:id ────────────────────────────────────────────────── */

rolesRouter.openapi(
	createRoute({
		method: "put",
		path: "/{id}",
		tags: ["Roles"],
		summary: "Update role permissions or metadata",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin")] as const,
		request: {
			params: z.object({ id: z.string() }),
			body: {
				content: { "application/json": { schema: updateRoleBody } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: roleSchema } },
				description: "The updated role",
			},
			400: { description: "Validation error" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param" as never) as { id: string };
		const body = c.req.valid("json" as never) as z.infer<typeof updateRoleBody>;
		try {
			const role = await updateRole(id, {
				name: body.name,
				description: body.description,
				permissions: body.permissions as OpsModule[] | undefined,
			});
			return c.json(role);
		} catch (err) {
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				err instanceof Error ? err.message : "Could not update role",
			);
		}
	},
);

/* ── DELETE /api/v1/roles/:id ─────────────────────────────────────────────── */

rolesRouter.openapi(
	createRoute({
		method: "delete",
		path: "/{id}",
		tags: ["Roles"],
		summary: "Delete a custom role",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin")] as const,
		request: {
			params: z.object({ id: z.string() }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
				description: "Role deleted successfully",
			},
			400: { description: "Cannot delete role" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param" as never) as { id: string };
		try {
			await deleteRole(id);
			return c.json({ ok: true });
		} catch (err) {
			throw new HttpError(
				400,
				"VALIDATION_ERROR",
				err instanceof Error ? err.message : "Could not delete role",
			);
		}
	},
);
