import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { opsRoles, opsUsers } from "../db/schema.js";
import {
	SYSTEM_ROLES,
	ROLE_PERMISSIONS,
	type OpsModule,
	type SystemRole,
} from "century-nit-shared";

export interface RoleRecord {
	id: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	permissions: OpsModule[];
	createdAt: string;
	updatedAt: string;
}

const ROLE_LABELS: Record<SystemRole, { name: string; description: string }> = {
	super_admin: {
		name: "Super Administrator",
		description: "Full system access across all business operations and platform administration.",
	},
	manager: {
		name: "Operations Manager",
		description: "Coordinates client journey, monitors workflow, and assigns tasks to consultants.",
	},
	coordinator: {
		name: "Coordinator",
		description: "Manages CRM leads, assigns consultants to bookings, and tracks admissions.",
	},
	customer_service: {
		name: "Customer Service",
		description: "Owns the support queue, handles inbound leads, and coordinates client inquiries.",
	},
	consultant: {
		name: "Consultant",
		description: "Advises assigned clients, reviews documentation, and handles visa guidance.",
	},
	finance: {
		name: "Finance Officer",
		description: "Manages invoices, accounting ledger, payments, and financial reports.",
	},
	admin: {
		name: "System Administrator",
		description: "Manages users, authentication policies, CMS content, and system configuration.",
	},
};

let cachedPermissions = new Map<string, OpsModule[]>();
let permissionsCacheLoadedAt = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Ensures built-in system roles exist in the database with their default permissions.
 */
export async function seedSystemRoles(): Promise<void> {
	for (const roleKey of SYSTEM_ROLES) {
		const existing = await db
			.select()
			.from(opsRoles)
			.where(eq(opsRoles.id, roleKey))
			.limit(1);

		if (existing.length === 0) {
			const meta = ROLE_LABELS[roleKey];
			await db.insert(opsRoles).values({
				id: roleKey,
				name: meta.name,
				description: meta.description,
				isSystem: true,
				permissions: ROLE_PERMISSIONS[roleKey],
			});
		}
	}
}

/**
 * In-memory cached permissions map for high-throughput route checks.
 */
export async function getRolePermissionsMap(force = false): Promise<Map<string, OpsModule[]>> {
	if (!force && Date.now() - permissionsCacheLoadedAt < CACHE_TTL_MS && cachedPermissions.size > 0) {
		return cachedPermissions;
	}

	try {
		await seedSystemRoles();
		const rows = await db.select().from(opsRoles);
		const next = new Map<string, OpsModule[]>();
		for (const row of rows) {
			next.set(row.id, (row.permissions ?? []) as OpsModule[]);
		}
		cachedPermissions = next;
		permissionsCacheLoadedAt = Date.now();
	} catch (err) {
		console.error("[Roles] Failed to load roles from DB, using fallback:", err);
		// Fallback to built-in permissions
		for (const [k, v] of Object.entries(ROLE_PERMISSIONS)) {
			cachedPermissions.set(k, v);
		}
	}

	return cachedPermissions;
}

/**
 * Check if a role has access to a specific module.
 */
export async function checkRolePermission(role: string, module: OpsModule): Promise<boolean> {
	if (role === "super_admin") return true;
	const map = await getRolePermissionsMap();
	const perms = map.get(role);
	if (!perms) {
		const fallback = ROLE_PERMISSIONS[role as SystemRole];
		return fallback ? fallback.includes(module) : false;
	}
	return perms.includes(module);
}

/**
 * List all roles for administration display.
 */
export async function listRoles(): Promise<RoleRecord[]> {
	await seedSystemRoles();
	const rows = await db.select().from(opsRoles).orderBy(desc(opsRoles.isSystem), opsRoles.name);
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		description: r.description,
		isSystem: r.isSystem,
		permissions: (r.permissions ?? []) as OpsModule[],
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
	}));
}

/**
 * Create a custom role.
 */
export async function createRole(input: {
	id: string;
	name: string;
	description?: string;
	permissions: OpsModule[];
}): Promise<RoleRecord> {
	const slug = input.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
	if (!slug) throw new Error("A valid unique role key is required (e.g. auditor)");

	const existing = await db
		.select()
		.from(opsRoles)
		.where(eq(opsRoles.id, slug))
		.limit(1);

	if (existing.length > 0) {
		throw new Error(`Role key "${slug}" already exists`);
	}

	const [created] = await db
		.insert(opsRoles)
		.values({
			id: slug,
			name: input.name.trim(),
			description: input.description?.trim() ?? null,
			isSystem: false,
			permissions: input.permissions,
		})
		.returning();

	await getRolePermissionsMap(true);

	return {
		id: created.id,
		name: created.name,
		description: created.description,
		isSystem: created.isSystem,
		permissions: (created.permissions ?? []) as OpsModule[],
		createdAt: created.createdAt.toISOString(),
		updatedAt: created.updatedAt.toISOString(),
	};
}

/**
 * Update role permissions or metadata.
 */
export async function updateRole(
	id: string,
	input: {
		name?: string;
		description?: string;
		permissions?: OpsModule[];
	},
): Promise<RoleRecord> {
	const [existing] = await db
		.select()
		.from(opsRoles)
		.where(eq(opsRoles.id, id))
		.limit(1);

	if (!existing) {
		throw new Error(`Role "${id}" not found`);
	}

	const [updated] = await db
		.update(opsRoles)
		.set({
			name: input.name !== undefined ? input.name.trim() : existing.name,
			description: input.description !== undefined ? input.description.trim() : existing.description,
			permissions: input.permissions !== undefined ? input.permissions : existing.permissions,
			updatedAt: new Date(),
		})
		.where(eq(opsRoles.id, id))
		.returning();

	await getRolePermissionsMap(true);

	return {
		id: updated.id,
		name: updated.name,
		description: updated.description,
		isSystem: updated.isSystem,
		permissions: (updated.permissions ?? []) as OpsModule[],
		createdAt: updated.createdAt.toISOString(),
		updatedAt: updated.updatedAt.toISOString(),
	};
}

/**
 * Delete a custom role.
 */
export async function deleteRole(id: string): Promise<void> {
	const [existing] = await db
		.select()
		.from(opsRoles)
		.where(eq(opsRoles.id, id))
		.limit(1);

	if (!existing) throw new Error(`Role "${id}" not found`);
	if (existing.isSystem) throw new Error("System built-in roles cannot be deleted");

	const inUse = await db
		.select({ id: opsUsers.id })
		.from(opsUsers)
		.where(eq(opsUsers.role, id))
		.limit(1);

	if (inUse.length > 0) {
		throw new Error(`Cannot delete role "${existing.name}" because it is currently assigned to staff users.`);
	}

	await db.delete(opsRoles).where(eq(opsRoles.id, id));
	await getRolePermissionsMap(true);
}
