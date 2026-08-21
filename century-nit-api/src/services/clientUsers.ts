import { desc, eq, gt, ilike, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";

export interface ClientUserView {
	id: string;
	name: string;
	email: string;
	phoneNumber: string | null;
	emailVerified: boolean;
	banned: boolean;
	banReason: string | null;
	bannedAt: string | null;
	bannedBy: string | null;
	activeSessionsCount: number;
	lastActiveAt: string;
	status: "active" | "inactive" | "banned" | "unverified" | "registered";
	leadStage: string | null;
	applicantStatus: string | null;
	createdAt: string;
	updatedAt: string;
}

export async function listClientUsers(query?: {
	status?: "all" | "active" | "inactive" | "banned" | "unverified";
	search?: string;
}): Promise<{ clients: ClientUserView[]; metrics: { total: number; active: number; inactive: number; banned: number } }> {
	// 1. Get all staff emails to exclude internal staff
	const staffRows = await db.query.opsUsers.findMany();
	const staffEmails = new Set(staffRows.map((s) => s.email.toLowerCase().trim()));

	// 2. Fetch all users
	let whereClause;
	if (query?.search?.trim()) {
		const pattern = `%${query.search.trim()}%`;
		whereClause = or(
			ilike(users.name, pattern),
			ilike(users.email, pattern),
			ilike(users.phoneNumber, pattern),
		);
	}

	const allUsers = await db.query.users.findMany({
		where: whereClause,
		orderBy: [desc(users.createdAt)],
	});

	// Filter out staff
	const clientUsersList = allUsers.filter((u) => !staffEmails.has(u.email.toLowerCase().trim()));

	const userIds = clientUsersList.map((u) => u.id);
	const userEmails = clientUsersList.map((u) => u.email.toLowerCase().trim());

	// 3. Fetch active sessions (expiresAt > now)
	const now = new Date();
	const activeSessions = userIds.length > 0
		? await db.query.sessions.findMany({
				where: gt(sessions.expiresAt, now),
		  })
		: [];

	const sessionsByUser = new Map<string, typeof activeSessions>();
	for (const s of activeSessions) {
		const list = sessionsByUser.get(s.userId) ?? [];
		list.push(s);
		sessionsByUser.set(s.userId, list);
	}

	// 4. Fetch leads
	const leadsRows = userEmails.length > 0
		? await db.query.leads.findMany()
		: [];
	const leadsByEmail = new Map<string, (typeof leadsRows)[0]>();
	for (const l of leadsRows) {
		leadsByEmail.set(l.email.toLowerCase().trim(), l);
	}

	// 5. Fetch applicants
	const applicantRows = userIds.length > 0
		? await db.query.applicants.findMany()
		: [];
	const applicantsByUserId = new Map<string, (typeof applicantRows)[0]>();
	for (const a of applicantRows) {
		if (a.userId) {
			applicantsByUserId.set(a.userId, a);
		}
	}

	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

	let totalCount = 0;
	let activeCount = 0;
	let inactiveCount = 0;
	let bannedCount = 0;

	const mappedClients: ClientUserView[] = clientUsersList.map((u) => {
		const userSessions = sessionsByUser.get(u.id) ?? [];
		const activeSessionsCount = userSessions.length;
		const userLead = leadsByEmail.get(u.email.toLowerCase().trim());
		const userApplicant = applicantsByUserId.get(u.id);

		// Compute last active date
		let lastActiveDate = u.updatedAt || u.createdAt;
		for (const s of userSessions) {
			if (s.updatedAt && s.updatedAt > lastActiveDate) {
				lastActiveDate = s.updatedAt;
			}
		}

		let status: ClientUserView["status"] = "registered";
		if (u.banned) {
			status = "banned";
			bannedCount++;
		} else if (activeSessionsCount > 0) {
			status = "active";
			activeCount++;
		} else if (lastActiveDate < thirtyDaysAgo) {
			status = "inactive";
			inactiveCount++;
		} else if (!u.emailVerified && !u.phoneNumberVerified) {
			status = "unverified";
		} else {
			status = "registered";
		}

		totalCount++;

		return {
			id: u.id,
			name: u.name || u.email.split("@")[0].replace(/[._-]/g, " "),
			email: u.email,
			phoneNumber: u.phoneNumber || null,
			emailVerified: u.emailVerified,
			banned: u.banned,
			banReason: u.banReason || null,
			bannedAt: u.bannedAt ? u.bannedAt.toISOString() : null,
			bannedBy: u.bannedBy || null,
			activeSessionsCount,
			lastActiveAt: lastActiveDate.toISOString(),
			status,
			leadStage: userLead?.stage || null,
			applicantStatus: userApplicant ? "Applicant" : null,
			createdAt: u.createdAt.toISOString(),
			updatedAt: u.updatedAt.toISOString(),
		};
	});

	// Filter by status if requested
	let filtered = mappedClients;
	if (query?.status && query.status !== "all") {
		filtered = mappedClients.filter((c) => c.status === query.status);
	}

	return {
		clients: filtered,
		metrics: {
			total: totalCount,
			active: activeCount,
			inactive: inactiveCount,
			banned: bannedCount,
		},
	};
}

/**
 * Revoke all active sessions for a given user (force logout).
 */
export async function revokeClientSessions(userId: string): Promise<{ revokedCount: number }> {
	const deleted = await db
		.delete(sessions)
		.where(eq(sessions.userId, userId))
		.returning({ id: sessions.id });

	console.log(`[Auth/Security] Revoked ${deleted.length} sessions for user ${userId}`);
	return { revokedCount: deleted.length };
}

/**
 * Suspend/Ban a client user and terminate all active sessions.
 */
export async function banClientUser(
	userId: string,
	reason: string,
	actorName: string,
): Promise<{ success: boolean; user: ClientUserView | null }> {
	const [updated] = await db
		.update(users)
		.set({
			banned: true,
			banReason: reason.trim(),
			bannedAt: new Date(),
			bannedBy: actorName,
			updatedAt: new Date(),
		})
		.where(eq(users.id, userId))
		.returning();

	if (!updated) {
		return { success: false, user: null };
	}

	// Invalidate all active sessions immediately
	await db.delete(sessions).where(eq(sessions.userId, userId));

	console.log(`[Auth/Security] User ${userId} (${updated.email}) BANNED by ${actorName}. Reason: ${reason}`);

	return {
		success: true,
		user: {
			id: updated.id,
			name: updated.name || updated.email,
			email: updated.email,
			phoneNumber: updated.phoneNumber || null,
			emailVerified: updated.emailVerified,
			banned: updated.banned,
			banReason: updated.banReason || null,
			bannedAt: updated.bannedAt ? updated.bannedAt.toISOString() : null,
			bannedBy: updated.bannedBy || null,
			activeSessionsCount: 0,
			lastActiveAt: updated.updatedAt.toISOString(),
			status: "banned",
			leadStage: null,
			applicantStatus: null,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
		},
	};
}

/**
 * Unban a client user and restore access.
 */
export async function unbanClientUser(
	userId: string,
	actorName: string,
): Promise<{ success: boolean; user: ClientUserView | null }> {
	const [updated] = await db
		.update(users)
		.set({
			banned: false,
			banReason: null,
			bannedAt: null,
			bannedBy: null,
			updatedAt: new Date(),
		})
		.where(eq(users.id, userId))
		.returning();

	if (!updated) {
		return { success: false, user: null };
	}

	console.log(`[Auth/Security] User ${userId} (${updated.email}) UNBANNED by ${actorName}`);

	return {
		success: true,
		user: {
			id: updated.id,
			name: updated.name || updated.email,
			email: updated.email,
			phoneNumber: updated.phoneNumber || null,
			emailVerified: updated.emailVerified,
			banned: updated.banned,
			banReason: null,
			bannedAt: null,
			bannedBy: null,
			activeSessionsCount: 0,
			lastActiveAt: updated.updatedAt.toISOString(),
			status: "registered",
			leadStage: null,
			applicantStatus: null,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
		},
	};
}

/**
 * Permanently delete a client user and all their auth-related data.
 *
 * The `users` table has `ON DELETE CASCADE` on sessions, accounts,
 * verifications, documents, and two-factor rows, so removing the user row
 * cleans those up automatically. Rows that should survive (bookings,
 * applicants, conversations) have `ON DELETE SET NULL` on their
 * `user_id` / `client_user_id` FKs and persist with a null reference.
 */
export async function deleteClientUser(userId: string): Promise<{ success: boolean }> {
	const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
	if (!existing) return { success: false };

	await db.delete(users).where(eq(users.id, userId));

	console.log(`[Auth/Security] Client user ${userId} permanently deleted`);
	return { success: true };
}
