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

	type AuthVariables,
	requireCapability,
} from "../middleware/auth.js";
import { permissionSchema, DEFAULT_CUSTOM_ROLE_RANK } from "century-nit-shared";
import { rankOfRole } from "../services/roles.js";

export const rolesRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const roleSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	isSystem: z.boolean(),
	permissions: z.array(z.string()),
	rank: z.number().int(),
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
	permissions: z.array(permissionSchema),
	/** Never above the creator's own rank; defaults to the lowest tier. */
	rank: z.number().int().min(1).max(99).optional(),
});

const updateRoleBody = z.object({
	name: z.string().min(2).max(128).optional(),
	description: z.string().optional(),
	permissions: z.array(permissionSchema).optional(),
	rank: z.number().int().min(1).max(99).optional(),
});

/* ── GET /api/v1/roles ────────────────────────────────────────────────────── */

rolesRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Roles"],
		summary: "List all roles and their granular permissions",
		// Every signed-in staff member needs their own role's permissions to
		// draw the console; the full matrix is read-only here and the write
		// routes below are admin-only.
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
		middleware: [requireAuth, requireMfa, requireCapability("manage_roles")] as const,
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
		const staff = c.get("staff")!;
		const ceiling = await rankOfRole(staff.role);
		const rank = Math.min(body.rank ?? DEFAULT_CUSTOM_ROLE_RANK, staff.role === "super_admin" ? 99 : Math.max(1, ceiling - 1));
		try {
			const role = await createRole({
				id: body.id,
				name: body.name,
				description: body.description,
				permissions: body.permissions,
				rank,
				actor: { opsUserId: staff.opsUserId, email: staff.email },
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
		middleware: [requireAuth, requireMfa, requireCapability("manage_roles")] as const,
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
		const staff = c.get("staff")!;
		// The root role bypasses every check, so its permission list is not a
		// thing to edit; the console hides the controls, the server refuses too.
		if (id === "super_admin" && body.permissions !== undefined) {
			throw new HttpError(400, "VALIDATION_ERROR", "The super_admin role always has every permission.");
		}
		// A role may not be lifted to or above the editor's own rank.
		const ceiling = await rankOfRole(staff.role);
		if (body.rank !== undefined && staff.role !== "super_admin" && body.rank >= ceiling) {
			throw new HttpError(400, "VALIDATION_ERROR", "A role cannot be ranked at or above your own.");
		}
		try {
			const role = await updateRole(id, {
				name: body.name,
				description: body.description,
				permissions: body.permissions,
				rank: body.rank,
				actor: { opsUserId: staff.opsUserId, email: staff.email },
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
		middleware: [requireAuth, requireMfa, requireCapability("manage_roles")] as const,
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
		const staff = c.get("staff")!;
		try {
			await deleteRole(id, { opsUserId: staff.opsUserId, email: staff.email });
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
