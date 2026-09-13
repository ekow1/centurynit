import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { opsRoles, opsUsers, settingsAudit } from "../db/schema.js";
import {
	SYSTEM_ROLES,
	ROLE_RANKS,
	DEFAULT_CUSTOM_ROLE_RANK,
	defaultPermissionsOf,
	permissionsGrant,
	type Capability,
	type OpsModule,
	type SystemRole,
} from "century-nit-shared";

export interface RoleRecord {
	id: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	/** Modules and capabilities, together. */
	permissions: string[];
	rank: number;
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

let cachedPermissions = new Map<string, string[]>();
let cachedRanks = new Map<string, number>();
let permissionsCacheLoadedAt = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Ensures every built-in system role exists. Runs once at startup.
 *
 * It only ever inserts. The database is the source of truth for a role's
 * permissions once it exists: `ROLE_PERMISSIONS` is the starting point and
 * the "reset to defaults" action, not a value the server keeps forcing back.
 * (It used to re-apply the defaults on every cache refresh, which silently
 * undid every edit made to a system role in the console.)
 */
export async function seedSystemRoles(): Promise<void> {
	for (const roleKey of SYSTEM_ROLES) {
		const [existing] = await db
			.select({ id: opsRoles.id })
			.from(opsRoles)
			.where(eq(opsRoles.id, roleKey))
			.limit(1);
		if (existing) continue;
		const meta = ROLE_LABELS[roleKey];
		await db
			.insert(opsRoles)
			.values({
				id: roleKey,
				name: meta.name,
				description: meta.description,
				isSystem: true,
				permissions: defaultPermissionsOf(roleKey),
				rank: ROLE_RANKS[roleKey],
			})
			.onConflictDoNothing();
	}
}

/** The built-in default for a system role — what "reset to defaults" restores. */
export function defaultPermissionsFor(roleId: string): string[] | null {
	return (SYSTEM_ROLES as readonly string[]).includes(roleId) ? defaultPermissionsOf(roleId as SystemRole) : null;
}

/** Whether a role id names a role that exists (system or custom). */
export async function roleExists(id: string): Promise<boolean> {
	const [row] = await db.select({ id: opsRoles.id }).from(opsRoles).where(eq(opsRoles.id, id)).limit(1);
	return Boolean(row);
}

function rememberRole(row: { id: string; permissions: string[] | null; rank?: number }): void {
	cachedPermissions.set(row.id, row.permissions ?? []);
	if (row.rank !== undefined) cachedRanks.set(row.id, row.rank);
}

/**
 * In-memory cached permissions map for high-throughput route checks.
 */
export async function getRolePermissionsMap(force = false): Promise<Map<string, string[]>> {
	if (!force && Date.now() - permissionsCacheLoadedAt < CACHE_TTL_MS && cachedPermissions.size > 0) {
		return cachedPermissions;
	}

	try {
		const rows = await db.select().from(opsRoles);
		const next = new Map<string, string[]>();
		const ranks = new Map<string, number>();
		for (const row of rows) {
			next.set(row.id, row.permissions ?? []);
			ranks.set(row.id, row.rank);
		}
		cachedPermissions = next;
		cachedRanks = ranks;
		permissionsCacheLoadedAt = Date.now();
	} catch (err) {
		console.error("[Roles] Failed to load roles from DB, using fallback:", err);
		// Fallback to the built-in defaults
		for (const k of SYSTEM_ROLES) {
			cachedPermissions.set(k, defaultPermissionsOf(k));
			cachedRanks.set(k, ROLE_RANKS[k]);
		}
	}

	return cachedPermissions;
}

/**
 * Check if a role has access to a specific module.
 */
export async function checkRolePermission(role: string, module: OpsModule): Promise<boolean> {
	return checkRoleGrant(role, module);
}

/** Whether a role has a capability — the same lookup, the same list. */
export async function checkRoleCapability(role: string, capability: Capability): Promise<boolean> {
	return checkRoleGrant(role, capability);
}

async function checkRoleGrant(role: string, wanted: string): Promise<boolean> {
	if (role === "super_admin") return true;
	const map = await getRolePermissionsMap();
	const perms = map.get(role);
	if (!perms) {
		return (SYSTEM_ROLES as readonly string[]).includes(role)
			? permissionsGrant(role, defaultPermissionsOf(role as SystemRole), wanted)
			: false;
	}
	return perms.includes(wanted);
}

/** The permission list of a role, for a request's staff context. */
export async function permissionsOfRole(role: string): Promise<string[]> {
	const map = await getRolePermissionsMap();
	const perms = map.get(role);
	if (perms) return perms;
	return (SYSTEM_ROLES as readonly string[]).includes(role) ? defaultPermissionsOf(role as SystemRole) : [];
}

/** A role's rank; unknown roles rank lowest. */
export async function rankOfRole(role: string): Promise<number> {
	await getRolePermissionsMap();
	const r = cachedRanks.get(role);
	if (r !== undefined) return r;
	return (ROLE_RANKS as Record<string, number | undefined>)[role] ?? 0;
}

/** The live permission map as a plain object, for the shared helpers. */
export async function livePermissions(): Promise<Record<string, string[]>> {
	return Object.fromEntries(await getRolePermissionsMap());
}

/**
 * List all roles for administration display.
 */
export async function listRoles(): Promise<RoleRecord[]> {
	const rows = await db.select().from(opsRoles).orderBy(desc(opsRoles.isSystem), opsRoles.name);
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		description: r.description,
		isSystem: r.isSystem,
		permissions: r.permissions ?? [],
		rank: r.rank,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
	}));
}

export type RoleActor = { opsUserId: string | null; email: string | null };

/**
 * Role changes go on the same audit trail as settings changes, so the
 * Administration → Audit page answers "who changed which permission".
 */
async function auditRole(actor: RoleActor, roleId: string, before: string[] | null, after: string[] | null): Promise<void> {
	await db.insert(settingsAudit).values({
		key: `role:${roleId}`.slice(0, 64),
		actorId: actor.opsUserId,
		actorEmail: actor.email,
		oldValueMasked: before === null ? null : before.length ? [...before].sort().join(", ") : "(none)",
		newValueMasked: after === null ? null : after.length ? [...after].sort().join(", ") : "(none)",
	});
}

/**
 * Create a custom role.
 */
export async function createRole(input: {
	id: string;
	name: string;
	description?: string;
	permissions: string[];
	rank?: number;
	actor: RoleActor;
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
			rank: input.rank ?? DEFAULT_CUSTOM_ROLE_RANK,
		})
		.returning();

	rememberRole(created);
	await auditRole(input.actor, created.id, null, created.permissions ?? []);

	return {
		id: created.id,
		name: created.name,
		description: created.description,
		isSystem: created.isSystem,
		permissions: created.permissions ?? [],
		rank: created.rank,
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
		permissions?: string[];
		rank?: number;
		actor: RoleActor;
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
			rank: input.rank !== undefined ? input.rank : existing.rank,
			updatedAt: new Date(),
		})
		.where(eq(opsRoles.id, id))
		.returning();

	// This process sees the change at once; the others within the cache TTL.
	rememberRole(updated);
	if (input.permissions !== undefined) {
		await auditRole(input.actor, id, existing.permissions ?? [], updated.permissions ?? []);
	}

	return {
		id: updated.id,
		name: updated.name,
		description: updated.description,
		isSystem: updated.isSystem,
		permissions: updated.permissions ?? [],
		rank: updated.rank,
		createdAt: updated.createdAt.toISOString(),
		updatedAt: updated.updatedAt.toISOString(),
	};
}

/**
 * Delete a custom role.
 */
export async function deleteRole(id: string, actor: RoleActor): Promise<void> {
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
	cachedPermissions.delete(id);
	await auditRole(actor, id, existing.permissions ?? [], null);
}
