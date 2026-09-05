import { and, desc, eq, gt, ilike, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	applicants,
	applicantDocuments,
	applications,
	caseComments,
	communicationEvents,
	conversations,
	consultations,
	messageAttachments,
	messages,
	sessions,
	users,
} from "../db/schema.js";
import { getDocumentStorage } from "./storage/index.js";

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
 * Permanently erase a client user and the personal data tied to them.
 *
 * What is removed:
 *   - The Better Auth `users` row and its cascades (sessions, accounts,
 *     two-factors, notification preferences, in-app notifications, reactions).
 *   - The `applicants` row and its cascades (applications, school applications,
 *     consultations, case/stage assignments, applicant document DB rows).
 *   - `bookings` for this client (the FK is CASCADE, not SET NULL).
 *   - Case comments and communication events linked to the applicant's records.
 *   - Conversations owned by the client or linked to their applications /
 *     consultations, plus the messages and attachments inside them.
 *   - Uploaded files in R2 / Supabase Storage: documents, message attachments,
 *     and the avatar object if it lives in our bucket.
 *
 * What is intentionally retained:
 *   - Invoices and payment transactions (accounting/legal requirement). The
 *     client-user link is nulled and the name/email snapshots stay as-is.
 *   - Notification delivery log and broad audit trails that do not depend on
 *     the user row.
 */
export async function deleteClientUser(
	userId: string,
	actorName?: string,
): Promise<{ success: boolean; storageErrors?: string[] }> {
	// Load the user + every entity whose storage key we must collect before
	// the DB rows disappear.
	const [user] = await db
		.select({ id: users.id, image: users.image })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!user) return { success: false };

	const applicantRows = await db
		.select({ id: applicants.id })
		.from(applicants)
		.where(eq(applicants.userId, userId));
	const applicantIds = applicantRows.map((a) => a.id);

	const applicationRows = applicantIds.length
		? await db
				.select({ id: applications.id })
				.from(applications)
				.where(inArray(applications.applicantId, applicantIds))
		: [];
	const applicationIds = applicationRows.map((a) => a.id);

	const consultationRows = applicantIds.length
		? await db
				.select({ id: consultations.id })
				.from(consultations)
				.where(inArray(consultations.applicantId, applicantIds))
		: [];
	const consultationIds = consultationRows.map((c) => c.id);

	const conversationConditions = [eq(conversations.userId, userId)];
	if (applicationIds.length) {
		conversationConditions.push(
			and(
				eq(conversations.linkedEntityType, "application"),
				inArray(conversations.linkedEntityId, applicationIds),
			)!,
		);
	}
	if (consultationIds.length) {
		conversationConditions.push(
			and(
				eq(conversations.linkedEntityType, "consultation"),
				inArray(conversations.linkedEntityId, consultationIds),
			)!,
		);
	}
	const conversationRows = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(or(...conversationConditions));
	const conversationIds = conversationRows.map((c) => c.id);

	// Collect every storage key that must be deleted after the DB transaction.
	const storageKeySet = new Set<string>();

	// Avatar stored in our bucket (Better Auth itself may hold a public URL).
	if (user.image && !/^https?:\/\//i.test(user.image)) {
		storageKeySet.add(user.image);
	}

	// Applicant documents.
	const documentRows = await db
		.select({ storageKey: applicantDocuments.storageKey })
		.from(applicantDocuments)
		.where(eq(applicantDocuments.ownerUserId, userId));
	for (const d of documentRows) storageKeySet.add(d.storageKey);

	// Message attachments in conversations we are about to delete.
	const attachmentsInDeletedConversations = conversationIds.length
		? await db
				.select({ storageKey: messageAttachments.storageKey })
				.from(messageAttachments)
				.innerJoin(messages, eq(messageAttachments.messageId, messages.id))
				.where(inArray(messages.conversationId, conversationIds))
		: [];
	for (const a of attachmentsInDeletedConversations) storageKeySet.add(a.storageKey);

	// Message attachments uploaded by the user in group conversations that
	// survive the user deletion (their row is SET NULL, so we delete explicitly).
	const attachmentsUploadedByUser = await db
		.select({ id: messageAttachments.id, storageKey: messageAttachments.storageKey })
		.from(messageAttachments)
		.where(eq(messageAttachments.uploadedByUserId, userId));
	for (const a of attachmentsUploadedByUser) storageKeySet.add(a.storageKey);

	const storageKeys = Array.from(storageKeySet).filter(Boolean);
	const attachmentIdsToDelete = attachmentsUploadedByUser.map((a) => a.id);

	// Database transaction: delete child records that have no FK cascade or
	// that we want gone before the user/applicant cascades fire.
	await db.transaction(async (tx) => {
		if (consultationIds.length) {
			await tx
				.delete(caseComments)
				.where(
					and(
						eq(caseComments.targetType, "consultation"),
						inArray(caseComments.targetId, consultationIds),
					),
				);
		}
		if (applicationIds.length) {
			await tx
				.delete(caseComments)
				.where(
					and(
						eq(caseComments.targetType, "application"),
						inArray(caseComments.targetId, applicationIds),
					),
				);
		}

		// Communication events: remove those tied to the user as actor or to
		// applications we are deleting.
		const eventConditions = [eq(communicationEvents.actorUserId, userId)];
		if (applicationIds.length) {
			eventConditions.push(inArray(communicationEvents.applicationId, applicationIds));
		}
		await tx.delete(communicationEvents).where(or(...eventConditions));

		// Remove any message attachments the user uploaded outside their own
		// conversations; this prevents broken attachment rows after the user FK
		// is nulled.
		if (attachmentIdsToDelete.length) {
			await tx
				.delete(messageAttachments)
				.where(inArray(messageAttachments.id, attachmentIdsToDelete));
		}

		// Delete conversations owned by or linked to this client. This cascades
		// to messages, message reactions, conversation participants, and
		// communication events linked by conversation_id.
		if (conversationIds.length) {
			await tx
				.delete(conversations)
				.where(inArray(conversations.id, conversationIds));
		}

		// Delete the applicant (cascades applications → stage/case assignments
		// → school applications, and consultations → consultation_activities).
		if (applicantIds.length) {
			await tx.delete(applicants).where(inArray(applicants.id, applicantIds));
		}

		// Finally delete the auth user. Cascades: sessions, accounts, two_factors,
		// notification_preferences, notifications, bookings, applicant_documents,
		// message_reactions, conversation_participants, and conversations.userId.
		await tx.delete(users).where(eq(users.id, userId));
	});

	// Best-effort file cleanup after the DB transaction commits.
	const storageErrors: string[] = [];
	const storage = await getDocumentStorage();
	if (storage.enabled) {
		for (const key of storageKeys) {
			try {
				await storage.remove(key);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				storageErrors.push(`${key}: ${message}`);
				console.warn(
					`[eraseClientUser] Failed to remove storage object ${key} for user ${userId}:`,
					message,
				);
			}
		}
	}

	console.log(
		`[Auth/Security] Client user ${userId} permanently erased by ${actorName ?? "system"} ` +
			`(${storageKeys.length} storage object(s); ${storageErrors.length} removal error(s))`,
	);

	return {
		success: true,
		...(storageErrors.length ? { storageErrors } : {}),
	};
}
