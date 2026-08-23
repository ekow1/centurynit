/**
 * Context-Aware Case Communication service.
 *
 * The single authority for "who is the customer's current contact, and how do
 * they reach them" (§21), for idempotent conversation routing that never
 * duplicates threads (§22), and for the entity-based access control that keeps
 * internal staff chatter out of customer-visible timelines (§14, §29).
 *
 * The chat schema already supported `conversations.linkedEntityType` /
 * `linkedEntityId` (added in 0025_applicant_chat) but nothing populated them.
 * This service finally does — one conversation per (case, stage, type),
 * created on demand, never duplicated.
 *
 * See the design doc for the full routing and permission model.
 */

import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
	ChatConversation,
	ChatMessage,
	ChatMessageList,
	CommunicationContext,
	ContactCard,
	CurrentContact,
	PreviousContact,
	StaffDirectoryDetailed,
	StaffPresence,
	StageAssignment,
} from "century-nit-shared";
import { JOURNEY_STAGE_LABELS, type JourneyStage } from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	communicationEvents,
	conversationParticipants,
	conversations,
	messages,
	opsUsers,
	stageAssignments,
	staffPresence,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import type { SessionUser, StaffContext } from "../middleware/auth.js";
import { canSeeApplication } from "./cases.js";
import { publishChatEvent, notifyOfflineParticipants } from "./chat.js";
import { notifyMany, getCustomerServiceUserIds, getManagerAndCoordinatorUserIds } from "./notify.js";
import { serializeMessageRow } from "./message-serializer.js";

/* ── Helpers ───────────────────────────────────────────────────────────── */

const STAGE_LABEL = (key: string | null | undefined): string | null => {
	if (!key) return null;
	return (JOURNEY_STAGE_LABELS as Record<string, string>)[key] ?? key;
};

async function getOpsUser(opsUserId: string) {
	const [row] = await db
		.select({
			id: opsUsers.id,
			name: opsUsers.name,
			email: opsUsers.email,
			role: opsUsers.role,
			branch: opsUsers.branch,
		})
		.from(opsUsers)
		.where(eq(opsUsers.id, opsUserId))
		.limit(1);
	return row ?? null;
}

async function getPresence(opsUserId: string): Promise<StaffPresence> {
	const [row] = await db
		.select({ status: staffPresence.status, lastSeenAt: staffPresence.lastSeenAt })
		.from(staffPresence)
		.where(eq(staffPresence.opsUserId, opsUserId))
		.limit(1);
	if (!row) return "offline";
	// Auto-flip to offline if no heartbeat for 15 minutes.
	if (row.status !== "offline" && row.lastSeenAt) {
		const ageMs = Date.now() - row.lastSeenAt.getTime();
		if (ageMs > 15 * 60 * 1000) return "offline";
	}
	return row.status;
}

function availabilityNote(presence: StaffPresence): string | null {
	switch (presence) {
		case "available":
			return "Replies in ~1h";
		case "busy":
			return "Replies in ~4h";
		case "on_leave":
			return "On leave — covered by your case manager";
		case "offline":
			return "Replies within 1 business day";
	}
}

async function toContactCard(
	opsUserId: string | null | undefined,
	opts: { stageKey?: string | null } = {},
): Promise<ContactCard | null> {
	if (!opsUserId || !opsUserId.trim()) return null;
	const staff = await getOpsUser(opsUserId);
	if (!staff) return null;
	const presence = await getPresence(opsUserId);
	return {
		opsUserId: staff.id,
		name: staff.name,
		email: staff.email,
		role: staff.role,
		branch: staff.branch,
		stageKey: opts.stageKey ?? null,
		stageLabel: STAGE_LABEL(opts.stageKey),
		presence,
		availabilityNote: availabilityNote(presence),
	};
}

/* ── Audit ─────────────────────────────────────────────────────────────── */

export async function recordEvent(input: {
	action: string;
	actorUserId?: string | null;
	actorOpsUserId?: string | null;
	conversationId?: string | null;
	applicationId?: string | null;
	stageKey?: string | null;
	metadata?: Record<string, unknown>;
}): Promise<void> {
	const actorUserId = input.actorUserId && input.actorUserId.trim().length > 0
		? input.actorUserId.trim()
		: null;
	const actorOpsUserId = input.actorOpsUserId && input.actorOpsUserId.trim().length > 0
		? input.actorOpsUserId.trim()
		: null;
	await db.insert(communicationEvents).values({
		action: input.action,
		actorUserId,
		actorOpsUserId,
		conversationId: input.conversationId ?? null,
		applicationId: input.applicationId ?? null,
		stageKey: input.stageKey ?? null,
		metadata: input.metadata ?? {},
	});
}

/* ── Access control ────────────────────────────────────────────────────── */

/**
 * Entity-based conversation access (§14). Customers may access only their own
 * customer-visible conversations; staff may access conversations they
 * participate in OR cases they can see. `INTERNAL` / `ESCALATION` conversations
 * are never visible via `/me/*` — this is the security boundary.
 */
export async function canAccessConversation(
	user: SessionUser,
	staff: StaffContext | null,
	conversationId: string,
): Promise<boolean> {
	const [conv] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (!conv) return false;

	// Customer-visible types. Anything else is staff-only.
	const customerVisible = ["support", "case", "stage", "applicant"];
	if (customerVisible.includes(conv.type)) {
		// The customer owns it via userId, OR is a participant via participant_user_id.
		if (conv.userId === user.id) return true;
		const [part] = await db
			.select()
			.from(conversationParticipants)
			.where(
				and(
					eq(conversationParticipants.conversationId, conversationId),
					eq(conversationParticipants.participantUserId, user.id),
				),
			)
			.limit(1);
		if (part) return true;
		// Staff fall through to the staff path below.
		if (!staff) return false;
	} else if (!staff) {
		return false;
	}

	// Staff path: participant, or can-see-the-linked-case.
	const [partStaff] = await db
		.select()
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.opsUserId, staff.opsUserId),
			),
		)
		.limit(1);
	if (partStaff) return true;

	// Case-linked: may access if they can see the case (manager/coordinator/assignee).
	if (conv.linkedEntityType === "application" && conv.linkedEntityId) {
		const [app] = await db
			.select({
				assignedStaffId: applications.assignedStaffId,
				applicantId: applications.applicantId,
			})
			.from(applications)
			.where(eq(applications.id, conv.linkedEntityId))
			.limit(1);
		if (app) {
			const [applicant] = await db
				.select({ userId: applicants.userId })
				.from(applicants)
				.where(eq(applicants.id, app.applicantId))
				.limit(1);
			return canSeeApplication(
				{ assignedStaffId: app.assignedStaffId, applicantUserId: applicant?.userId ?? null },
				user.id,
				staff,
			);
		}
	}
	// Consultation-linked: delegate to assigned-officer / coordinator visibility.
	if (conv.linkedEntityType === "consultation" && conv.linkedEntityId) {
		// Coarse: managers/coordinators/super_admin see all; consultants must be
		// a participant. (Refined in a follow-up via canSeeConsultation if needed.)
		return (
			staff.role === "manager" ||
			staff.role === "coordinator" ||
			staff.role === "super_admin"
		);
	}
	return false;
}

/* ── Serialization ──────────────────────────────────────────────────────── */

async function getParticipants(conversationId: string) {
	return db
		.select({
			opsUserId: conversationParticipants.opsUserId,
			participantUserId: conversationParticipants.participantUserId,
			name: opsUsers.name,
			email: opsUsers.email,
			role: conversationParticipants.role,
			lastReadAt: conversationParticipants.lastReadAt,
			joinedAt: conversationParticipants.joinedAt,
		})
		.from(conversationParticipants)
		.leftJoin(opsUsers, eq(conversationParticipants.opsUserId, opsUsers.id))
		.where(eq(conversationParticipants.conversationId, conversationId));
}

/** Unread count for whichever side the viewer is on (staff or customer). */
async function countUnreadFor(
	conversationId: string,
	viewer: { opsUserId?: string; userId?: string },
): Promise<number> {
	const conditions = [eq(messages.conversationId, conversationId)];
	const [participant] = viewer.opsUserId
		? await db
				.select({ lastReadAt: conversationParticipants.lastReadAt })
				.from(conversationParticipants)
				.where(
					and(
						eq(conversationParticipants.conversationId, conversationId),
						eq(conversationParticipants.opsUserId, viewer.opsUserId),
					),
				)
				.limit(1)
		: await db
				.select({ lastReadAt: conversationParticipants.lastReadAt })
				.from(conversationParticipants)
				.where(
					and(
						eq(conversationParticipants.conversationId, conversationId),
						eq(conversationParticipants.participantUserId, viewer.userId!),
					),
				)
				.limit(1);

	if (!participant) return 0;

	// Messages not sent by the viewer, newer than their last-read cursor.
	if (viewer.opsUserId) {
		conditions.push(ne(messages.senderOpsUserId, viewer.opsUserId));
	} else {
		conditions.push(ne(messages.senderUserId, viewer.userId!));
	}
	if (participant.lastReadAt) {
		conditions.push(gt(messages.createdAt, participant.lastReadAt));
	}

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(messages)
		.where(and(...conditions));
	return count;
}

async function serializeConversation(
	row: typeof conversations.$inferSelect,
	viewer: { opsUserId?: string; userId?: string },
): Promise<ChatConversation> {
	const participants = await getParticipants(row.id);
	const unread = await countUnreadFor(row.id, viewer);

	const [lastMsg] = await db
		.select()
		.from(messages)
		.where(eq(messages.conversationId, row.id))
		.orderBy(desc(messages.createdAt))
		.limit(1);

	return {
		id: row.id,
		type: row.type as ChatConversation["type"],
		title: row.title,
		linkedEntityType: row.linkedEntityType,
		linkedEntityId: row.linkedEntityId,
		createdBy: row.createdBy,
		stageKey: row.stageKey,
		status: row.status as "open" | "closed" | "archived",
		emailInboxToken: row.emailInboxToken,
		escalatedByOpsUserId: row.escalatedByOpsUserId,
		escalationReason: row.escalationReason,
		participants: participants
			.filter((p) => p.opsUserId !== null)
			.map((p) => ({
				opsUserId: p.opsUserId!,
				name: p.name ?? "",
				email: p.email ?? "",
				role: p.role as "owner" | "member" | "former",
				lastReadAt: p.lastReadAt?.toISOString() ?? null,
				joinedAt: p.joinedAt.toISOString(),
			})),
		lastMessage: lastMsg ? serializeMessageRow(lastMsg) : null,
		unreadCount: unread,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function serializeMessage(row: typeof messages.$inferSelect): ChatMessage {
	return serializeMessageRow(row);
}

/* ── Conversation routing — the no-duplicate gate (§22) ─────────────────── */

export interface FindOrCreateInput {
	type: "support" | "case" | "stage" | "internal" | "escalation";
	/** Customer (applicant) user ID — required for customer-visible types. */
	userId?: string;
	/** Staff who initiated (for internal/escalation) or who owns (for applicant creation). */
	createdByOpsUserId?: string | null;
	linkedEntityType?: "application" | "consultation" | "booking" | null;
	linkedEntityId?: string | null;
	stageKey?: string | null;
	title: string;
	/** Initial participant staff IDs (besides the creator). */
	participantOpsUserIds?: string[];
}

/**
 * Find an existing conversation matching the natural identity
 * (linkedEntityType, linkedEntityId, stageKey, type) or create one. Repeated
 * clicks never duplicate — this is the structural fix for "don't fragment".
 */
export async function findOrCreateConversation(
	input: FindOrCreateInput,
): Promise<{ id: string; created: boolean; row: typeof conversations.$inferSelect }> {
	const stageKey = input.stageKey ?? null;
	const linkedEntityType = input.linkedEntityType ?? null;
	const linkedEntityId = input.linkedEntityId ?? null;
	const validCreatorId = input.createdByOpsUserId && input.createdByOpsUserId.trim().length > 0
		? input.createdByOpsUserId.trim()
		: null;

	// Look up by the natural identity.
	const [existing] = await db
		.select()
		.from(conversations)
		.where(
			and(
				eq(conversations.type, input.type),
				linkedEntityType
					? eq(conversations.linkedEntityType, linkedEntityType)
					: isNull(conversations.linkedEntityType),
				linkedEntityId
					? eq(conversations.linkedEntityId, linkedEntityId)
					: isNull(conversations.linkedEntityId),
				stageKey ? eq(conversations.stageKey, stageKey) : isNull(conversations.stageKey),
				input.userId ? eq(conversations.userId, input.userId) : sql`true`,
			),
		)
		.limit(1);

	if (existing) {
		// Ensure the customer is a participant (backfill for older applicant convs).
		if (input.userId) {
			await ensureUserParticipant(existing.id, input.userId);
		}
		return { id: existing.id, created: false, row: existing };
	}

	const [created] = await db
		.insert(conversations)
		.values({
			type: input.type,
			title: input.title,
			linkedEntityType,
			linkedEntityId,
			userId: input.userId ?? null,
			createdBy: validCreatorId,
			stageKey,
			emailInboxToken: randomUUID(),
			status: "open",
		})
		.returning();

	// Add creator + participants.
	if (validCreatorId) {
		await db.insert(conversationParticipants).values({
			conversationId: created.id,
			opsUserId: validCreatorId,
			role: "owner",
		});
	}
	for (const pid of input.participantOpsUserIds ?? []) {
		if (!pid || !pid.trim() || pid === validCreatorId) continue;
		await db.insert(conversationParticipants).values({
			conversationId: created.id,
			opsUserId: pid.trim(),
			role: "member",
		});
	}
	if (input.userId) {
		await ensureUserParticipant(created.id, input.userId);
	}

	await recordEvent({
		action: "conversation_created",
		actorOpsUserId: validCreatorId,
		conversationId: created.id,
		applicationId: linkedEntityType === "application" ? linkedEntityId : null,
		stageKey,
		metadata: { type: input.type, title: input.title },
	});

	return { id: created.id, created: true, row: created };
}

async function ensureUserParticipant(conversationId: string, userId: string): Promise<void> {
	const [existing] = await db
		.select()
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.participantUserId, userId),
			),
		)
		.limit(1);
	if (existing) return;
	await db.insert(conversationParticipants).values({
		conversationId,
		participantUserId: userId,
		role: "member",
	});
}

/* ── Current-contact resolver (§21) ────────────────────────────────────── */

/**
 * Resolve the customer's current contact — the answer to "who can help me,
 * with what, and how do I contact them?" without navigating away.
 *
 *   IF active stage assignment exists  → stage_officer
 *   ELSE IF active escalation exists    → escalation
 *   ELSE IF case manager assigned       → case_manager
 *   ELSE                                → support
 */
export async function resolveCurrentContact(userId: string): Promise<{
	current: CurrentContact;
	activeCaseId: string | null;
	activeCaseRef: string | null;
	activeStageKey: string | null;
}> {
	// Find the customer's applicant row.
	const [applicant] = await db
		.select({ id: applicants.id, assignedOfficerId: applicants.assignedOfficerId, name: applicants.name })
		.from(applicants)
		.where(eq(applicants.userId, userId))
		.limit(1);

	if (!applicant) {
		return {
			current: { kind: "support" },
			activeCaseId: null,
			activeCaseRef: null,
			activeStageKey: null,
		};
	}

	// Most recently updated application is the "active case".
	const [app] = await db
		.select({
			id: applications.id,
			appNumber: applications.appNumber,
			stage: applications.stage,
			assignedStaffId: applications.assignedStaffId,
			updatedAt: applications.updatedAt,
		})
		.from(applications)
		.where(eq(applications.applicantId, applicant.id))
		.orderBy(desc(applications.updatedAt))
		.limit(1);

	if (!app) {
		return {
			current: { kind: "support" },
			activeCaseId: null,
			activeCaseRef: null,
			activeStageKey: null,
		};
	}

	const caseRef = app.appNumber;
	const stageKey = app.stage as JourneyStage;

	// Active stage assignment wins.
	const [stageAssignment] = await db
		.select()
		.from(stageAssignments)
		.where(
			and(
				eq(stageAssignments.applicationId, app.id),
				eq(stageAssignments.stage, stageKey),
				eq(stageAssignments.status, "active"),
			),
		)
		.limit(1);

	// Active escalation for this case overrides.
	const [escalation] = await db
		.select()
		.from(conversations)
		.where(
			and(
				eq(conversations.type, "escalation"),
				eq(conversations.linkedEntityType, "application"),
				eq(conversations.linkedEntityId, app.id),
				eq(conversations.status, "open"),
			),
		)
		.limit(1);

	const caseManager = applicant.assignedOfficerId
		? await toContactCard(applicant.assignedOfficerId)
		: null;

	if (escalation && escalation.escalatedByOpsUserId) {
		const contact = await toContactCard(escalation.escalatedByOpsUserId);
		if (contact) {
			return {
				current: {
					kind: "escalation",
					contact,
					caseRef,
					reason: escalation.escalationReason ?? null,
				},
				activeCaseId: app.id,
				activeCaseRef: caseRef,
				activeStageKey: stageKey,
			};
		}
	}

	if (stageAssignment) {
		const contact = await toContactCard(stageAssignment.opsUserId, { stageKey });
		if (contact) {
			return {
				current: {
					kind: "stage_officer",
					contact,
					caseRef,
					stageKey,
					stageLabel: STAGE_LABEL(stageKey) ?? stageKey,
					caseManager,
				},
				activeCaseId: app.id,
				activeCaseRef: caseRef,
				activeStageKey: stageKey,
			};
		}
	}

	if (caseManager) {
		return {
			current: { kind: "case_manager", contact: caseManager, caseRef },
			activeCaseId: app.id,
			activeCaseRef: caseRef,
			activeStageKey: stageKey,
		};
	}

	return {
		current: { kind: "support" },
		activeCaseId: app.id,
		activeCaseRef: caseRef,
		activeStageKey: stageKey,
	};
}

/* ── Previous contacts (continuity, §6/§12) ────────────────────────────── */

export async function getPreviousContacts(userId: string): Promise<PreviousContact[]> {
	const [applicant] = await db
		.select({ id: applicants.id })
		.from(applicants)
		.where(eq(applicants.userId, userId))
		.limit(1);
	if (!applicant) return [];

	// All non-active stage assignments for the customer's cases, newest end first.
	const appIds = db
		.select({ id: applications.id })
		.from(applications)
		.where(eq(applications.applicantId, applicant.id))
		.as("app_ids");

	const rows = await db
		.select({
			opsUserId: stageAssignments.opsUserId,
			stage: stageAssignments.stage,
			endedReason: stageAssignments.endedReason,
			endedAt: stageAssignments.endedAt,
			name: opsUsers.name,
			role: opsUsers.role,
		})
		.from(stageAssignments)
		.innerJoin(appIds, eq(stageAssignments.applicationId, appIds.id))
		.innerJoin(opsUsers, eq(stageAssignments.opsUserId, opsUsers.id))
		.where(ne(stageAssignments.status, "active"))
		.orderBy(desc(stageAssignments.endedAt));

	// Deduplicate by officer (keep the most recent stage they handled).
	const seen = new Set<string>();
	const out: PreviousContact[] = [];
	for (const r of rows) {
		if (seen.has(r.opsUserId)) continue;
		seen.add(r.opsUserId);
		out.push({
			opsUserId: r.opsUserId,
			name: r.name,
			role: r.role,
			stageKey: r.stage,
			stageLabel: STAGE_LABEL(r.stage),
			endedReason: r.endedReason,
		});
	}
	return out;
}

/* ── Customer conversation list ─────────────────────────────────────────── */

const CUSTOMER_VISIBLE_TYPES = ["support", "case", "stage", "applicant"] as const;

export async function listCustomerConversations(userId: string): Promise<ChatConversation[]> {
	// Conversations owned via userId OR where the customer is a participant.
	const rows = await db
		.select()
		.from(conversations)
		.where(
			and(
				inArray(conversations.type, [...CUSTOMER_VISIBLE_TYPES]),
				eq(conversations.userId, userId),
				// status open or closed (archived hidden)
				inArray(conversations.status, ["open", "closed"]),
			),
		)
		.orderBy(desc(conversations.updatedAt));

	// Also include ones where they're a participant (participant_user_id).
	const participantRows = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(eq(conversationParticipants.participantUserId, userId));
	const participantIds = new Set(participantRows.map((r) => r.conversationId));
	const extra = participantIds.size
		? await db
				.select()
				.from(conversations)
				.where(
					and(
						inArray(
							conversations.id,
							[...participantIds],
						),
						inArray(conversations.type, [...CUSTOMER_VISIBLE_TYPES]),
						inArray(conversations.status, ["open", "closed"]),
					),
				)
		: [];

	const merged = new Map<string, typeof conversations.$inferSelect>();
	for (const r of rows) {
		if (r.userId === userId) merged.set(r.id, r);
	}
	for (const r of extra) {
		if (!merged.has(r.id)) merged.set(r.id, r);
	}

	const list = await Promise.all(
		[...merged.values()].map((r) => serializeConversation(r, { userId })),
	);
	return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ── Full portal context ────────────────────────────────────────────────── */

export async function getCommunicationContext(userId: string): Promise<CommunicationContext> {
	const { current, activeCaseRef, activeStageKey } = await resolveCurrentContact(userId);
	const previousContacts = await getPreviousContacts(userId);
	const convos = await listCustomerConversations(userId);
	return {
		current,
		previousContacts,
		conversations: convos,
		activeCaseRef,
		activeStageKey: activeStageKey ?? undefined,
	};
}

/* ── Routing the customer's "Chat" click (§22) ──────────────────────────── */

export async function routeCustomerChat(
	userId: string,
	opts: { caseId?: string; stageKey?: string; createdByOpsUserId?: string | null } = {},
): Promise<ChatConversation> {
	// Resolve the active case if none specified.
	let caseId = opts.caseId;
	let stageKey = opts.stageKey ?? null;

	if (!caseId) {
		const { activeCaseId, activeStageKey } = await resolveCurrentContact(userId);
		caseId = activeCaseId ?? undefined;
		stageKey = stageKey ?? activeStageKey ?? null;
	}

	if (!caseId) {
		// No case — open / create the SUPPORT conversation.
		const { row } = await findOrCreateConversation({
			type: "support",
			userId,
			createdByOpsUserId: opts.createdByOpsUserId || null,
			title: "Support",
		});
		return serializeConversation(row, { userId });
	}

	// Verify the customer owns this case.
	const [app] = await db
		.select({
			id: applications.id,
			appNumber: applications.appNumber,
			stage: applications.stage,
			assignedStaffId: applications.assignedStaffId,
			applicantId: applications.applicantId,
		})
		.from(applications)
		.where(eq(applications.id, caseId))
		.limit(1);
	if (!app) throw new HttpError(404, "CASE_NOT_FOUND", "Case not found");
	const [applicant] = await db
		.select({ userId: applicants.userId })
		.from(applicants)
		.where(eq(applicants.id, app.applicantId))
		.limit(1);
	if (applicant?.userId !== userId) {
		throw new HttpError(403, "FORBIDDEN", "This is not your case");
	}

	const stage = stageKey ?? (app.stage as JourneyStage);

	// Stage officer?
	const [assignment] = await db
		.select({ opsUserId: stageAssignments.opsUserId })
		.from(stageAssignments)
		.where(
			and(
				eq(stageAssignments.applicationId, caseId),
				eq(stageAssignments.stage, stage),
				eq(stageAssignments.status, "active"),
			),
		)
		.limit(1);

	const title = `${app.appNumber} · ${STAGE_LABEL(stage) ?? stage}`;

	if (assignment) {
		const { row } = await findOrCreateConversation({
			type: "stage",
			userId,
			createdByOpsUserId: assignment.opsUserId,
			linkedEntityType: "application",
			linkedEntityId: caseId,
			stageKey: stage,
			title,
			participantOpsUserIds: [assignment.opsUserId],
		});
		return serializeConversation(row, { userId });
	}

	// No stage officer — case-level thread with the assigned staff / case manager.
	const ownerId = app.assignedStaffId ?? (opts.createdByOpsUserId || null);
	const { row } = await findOrCreateConversation({
		type: "case",
		userId,
		createdByOpsUserId: ownerId,
		linkedEntityType: "application",
		linkedEntityId: caseId,
		stageKey: null,
		title: `${app.appNumber}`,
		participantOpsUserIds: ownerId ? [ownerId] : [],
	});
	return serializeConversation(row, { userId });
}

/* ── Messages (customer-facing) ─────────────────────────────────────────── */

export async function getCustomerMessages(
	conversationId: string,
	userId: string,
	opts: { limit?: number; before?: string } = {},
): Promise<ChatMessageList> {
	const ok = await canAccessConversation(
		{ id: userId, email: "", name: null },
		null,
		conversationId,
	);
	if (!ok) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

	const limit = Math.min(opts.limit ?? 50, 100);
	const conditions = [eq(messages.conversationId, conversationId)];
	if (opts.before) {
		conditions.push(
			sql`${messages.createdAt} < (SELECT created_at FROM ${messages} WHERE id = ${opts.before})`,
		);
	}
	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(limit + 1);
	const hasMore = rows.length > limit;
	const sliced = hasMore ? rows.slice(0, limit) : rows;
	return {
		messages: sliced.reverse().map(serializeMessage),
		total: sliced.length,
		hasMore,
	};
}

export async function sendCustomerMessage(
	conversationId: string,
	user: SessionUser,
	content: string,
): Promise<ChatMessage> {
	const ok = await canAccessConversation(user, null, conversationId);
	if (!ok) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

	const [conv] = await db
		.select({ status: conversations.status })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (conv?.status === "closed") {
		throw new HttpError(409, "CONVERSATION_CLOSED", "This conversation is closed");
	}

	const [created] = await db
		.insert(messages)
		.values({
			conversationId,
			senderUserId: user.id,
			senderName: user.name ?? "Applicant",
			content,
			messageType: "text",
		})
		.returning();

	await db
		.update(conversations)
		.set({ updatedAt: new Date(), lastMessageAt: new Date() })
		.where(eq(conversations.id, conversationId));

	await recordEvent({
		action: "message_sent",
		actorUserId: user.id,
		conversationId,
		metadata: { messageId: created.id, sender: "customer" },
	});

	// Real-time: push the customer's message to every staff participant's SSE
	// stream so their chat UI appends it instantly without polling.
	publishChatEvent(conversationId, {
		type: "chat.message",
		conversationId,
		message: serializeMessage(created),
	});

	// In-app + push: alert the staff participants that the customer replied.
	// Fire-and-forget so a notification hiccup never blocks the send.
	(async () => {
		try {
			const preview = content.length > 160 ? `${content.slice(0, 160)}…` : content;
			const staffParticipants = await db
				.select({ userId: opsUsers.userId })
				.from(conversationParticipants)
				.innerJoin(opsUsers, eq(conversationParticipants.opsUserId, opsUsers.id))
				.where(
					and(
						eq(conversationParticipants.conversationId, conversationId),
						ne(conversationParticipants.role, "former"),
					),
				);
		const recipients = staffParticipants
			.map((p) => p.userId)
			.filter((id): id is string => id != null);

		if (recipients.length === 0) {
			// No staff participants — for support conversations, fall back to
			// alerting customer_service + managers/coordinators so the message
			// isn't stranded.
			const [convRow] = await db
				.select({ type: conversations.type })
				.from(conversations)
				.where(eq(conversations.id, conversationId))
				.limit(1);
			if (convRow?.type === "support") {
				const [csAgents, mgrCoordinators] = await Promise.all([
					getCustomerServiceUserIds(),
					getManagerAndCoordinatorUserIds(),
				]);
				const fallbackRecipients = [
					...csAgents.map(({ userId }) => userId),
					...mgrCoordinators.map(({ userId }) => userId),
				].filter((id, idx, arr) => id != null && arr.indexOf(id) === idx);
				if (fallbackRecipients.length > 0) {
					await notifyMany(
						fallbackRecipients.map((recipientUserId) => ({
							recipientUserId,
							type: "chat.message",
							title: `${user.name ?? "A client"} sent a support message`,
							body: preview,
							link: "/inbox",
						})),
					);
				}
			}
			return;
		}

		await notifyMany(
				recipients.map((recipientUserId) => ({
					recipientUserId,
					type: "chat.message",
					title: `${user.name ?? "A client"} sent a message`,
					body: preview,
					link: "/inbox",
				})),
			);

		// Email: notify offline staff participants via email so they don't
		// miss the message while away from the console.
		await notifyOfflineParticipants(
			conversationId,
			{ id: user.id, name: user.name ?? "A client", email: user.email },
			created,
		);
		} catch {
			// Notification failure must not block the message send.
		}
	})().catch(() => {});

	return serializeMessage(created);
}

export async function markCustomerRead(conversationId: string, userId: string): Promise<void> {
	const ok = await canAccessConversation(
		{ id: userId, email: "", name: null },
		null,
		conversationId,
	);
	if (!ok) return;
	await db
		.update(conversationParticipants)
		.set({ lastReadAt: new Date() })
		.where(
			and(
				eq(conversationParticipants.conversationId, conversationId),
				eq(conversationParticipants.participantUserId, userId),
			),
		);
}

/* ── System messages (stage transitions, assignments) ───────────────────── */

export async function appendSystemMessage(
	conversationId: string,
	content: string,
	metadata?: Record<string, unknown>,
): Promise<void> {
	await db.insert(messages).values({
		conversationId,
		senderName: "System",
		content,
		messageType: "system",
	});
	await db
		.update(conversations)
		.set({ updatedAt: new Date(), lastMessageAt: new Date() })
		.where(eq(conversations.id, conversationId));
	await recordEvent({
		action: "system_message",
		conversationId,
		metadata: { content, ...metadata },
	});
}

/* ── Stage assignment + reassignment (§8, §12) ───────────────────────────── */

export async function assignStageOfficer(input: {
	applicationId: string;
	stage: string;
	opsUserId: string;
	assignedBy: string;
	reason?: string;
}): Promise<StageAssignment> {
	// End any existing active assignment for this (case, stage) — reassignment.
	const existing = await db
		.select()
		.from(stageAssignments)
		.where(
			and(
				eq(stageAssignments.applicationId, input.applicationId),
				eq(stageAssignments.stage, input.stage),
				eq(stageAssignments.status, "active"),
			),
		);
	for (const row of existing) {
		await db
			.update(stageAssignments)
			.set({ status: "reassigned", endedAt: new Date(), endedReason: input.reason ?? "reassigned" })
			.where(eq(stageAssignments.id, row.id));
		// Downgrade their conversation participant role to `former` (history retained).
		// Find the stage conversation and update the old officer's role.
		const [stageConv] = await db
			.select({ id: conversations.id })
			.from(conversations)
			.where(
				and(
					eq(conversations.linkedEntityType, "application"),
					eq(conversations.linkedEntityId, input.applicationId),
					eq(conversations.stageKey, input.stage),
					eq(conversations.type, "stage"),
				),
			)
			.limit(1);
		if (stageConv) {
			await db
				.update(conversationParticipants)
				.set({ role: "former" })
				.where(
					and(
						eq(conversationParticipants.conversationId, stageConv.id),
						eq(conversationParticipants.opsUserId, row.opsUserId),
					),
				);
		}
	}

	const [created] = await db
		.insert(stageAssignments)
		.values({
			applicationId: input.applicationId,
			stage: input.stage,
			opsUserId: input.opsUserId,
			assignedBy: input.assignedBy,
			status: "active",
		})
		.returning();

	// Ensure the new officer is a participant in the stage conversation (create if needed).
	const [app] = await db
		.select({ appNumber: applications.appNumber, applicantId: applications.applicantId })
		.from(applications)
		.where(eq(applications.id, input.applicationId))
		.limit(1);
	if (app) {
		const [applicant] = await db
			.select({ userId: applicants.userId })
			.from(applicants)
			.where(eq(applicants.id, app.applicantId))
			.limit(1);
		if (applicant?.userId) {
			const { row } = await findOrCreateConversation({
				type: "stage",
				userId: applicant.userId,
				createdByOpsUserId: input.assignedBy,
				linkedEntityType: "application",
				linkedEntityId: input.applicationId,
				stageKey: input.stage,
				title: `${app.appNumber} · ${STAGE_LABEL(input.stage) ?? input.stage}`,
				participantOpsUserIds: [input.opsUserId],
			});
			// Make sure the new officer is an active participant.
			await db
				.insert(conversationParticipants)
				.values({
					conversationId: row.id,
					opsUserId: input.opsUserId,
					role: "member",
				})
				.onConflictDoNothing();
			// System message announcing the assignment (§11).
			const officer = await getOpsUser(input.opsUserId);
			if (officer) {
				await appendSystemMessage(
					row.id,
					`Your ${STAGE_LABEL(input.stage) ?? input.stage} stage has been assigned to ${officer.name}.`,
					{ assignmentId: created.id, officer: officer.name },
				);
			}
		}
	}

	await recordEvent({
		action: "staff_assigned",
		actorOpsUserId: input.assignedBy,
		applicationId: input.applicationId,
		stageKey: input.stage,
		metadata: { assignmentId: created.id, officer: input.opsUserId, reason: input.reason },
	});

	return {
		id: created.id,
		applicationId: created.applicationId,
		stage: created.stage,
		opsUserId: created.opsUserId,
		status: created.status,
		assignedAt: created.assignedAt.toISOString(),
		assignedBy: created.assignedBy,
		endedAt: null,
		endedReason: null,
	};
}

export async function listStageAssignments(applicationId: string): Promise<StageAssignment[]> {
	const rows = await db
		.select({
			id: stageAssignments.id,
			applicationId: stageAssignments.applicationId,
			stage: stageAssignments.stage,
			opsUserId: stageAssignments.opsUserId,
			opsUserName: opsUsers.name,
			status: stageAssignments.status,
			assignedAt: stageAssignments.assignedAt,
			assignedBy: stageAssignments.assignedBy,
			endedAt: stageAssignments.endedAt,
			endedReason: stageAssignments.endedReason,
		})
		.from(stageAssignments)
		.innerJoin(opsUsers, eq(stageAssignments.opsUserId, opsUsers.id))
		.where(eq(stageAssignments.applicationId, applicationId))
		.orderBy(desc(stageAssignments.assignedAt));
	return rows.map((r) => ({
		id: r.id,
		applicationId: r.applicationId,
		stage: r.stage,
		opsUserId: r.opsUserId,
		opsUserName: r.opsUserName,
		status: r.status,
		assignedAt: r.assignedAt.toISOString(),
		assignedBy: r.assignedBy,
		endedAt: r.endedAt?.toISOString() ?? null,
		endedReason: r.endedReason,
	}));
}

/* ── Staff presence ────────────────────────────────────────────────────── */

export async function updatePresence(opsUserId: string, status: StaffPresence): Promise<void> {
	const now = new Date();
	await db
		.insert(staffPresence)
		.values({
			opsUserId,
			status,
			lastSeenAt: now,
			statusSetAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: staffPresence.opsUserId,
			set: {
				status,
				lastSeenAt: now,
				updatedAt: now,
			},
		});
}

export async function heartbeat(opsUserId: string): Promise<void> {
	const now = new Date();
	// Insert with status='available' (the DB default is 'offline' — a fresh
	// user who is clearly online because they're heartbeating should not show
	// as offline). On conflict, only flip offline→available; a user who
	// explicitly set busy/on_leave keeps that status.
	await db
		.insert(staffPresence)
		.values({
			opsUserId,
			status: "available",
			lastSeenAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: staffPresence.opsUserId,
			set: {
				lastSeenAt: now,
				updatedAt: now,
				status: sql`CASE WHEN ${staffPresence.status} = 'offline' THEN 'available' ELSE ${staffPresence.status} END`,
			},
		});
}

/* ── Staff directory (OPS hub) ──────────────────────────────────────────── */

export async function getStaffDirectoryDetailed(): Promise<StaffDirectoryDetailed> {
	const staffRows = await db
		.select({
			opsUserId: opsUsers.id,
			name: opsUsers.name,
			email: opsUsers.email,
			role: opsUsers.role,
			branch: opsUsers.branch,
		})
		.from(opsUsers)
		.where(eq(opsUsers.active, true))
		.orderBy(opsUsers.name);

	// Presence + active case counts in parallel.
	const out = await Promise.all(
		staffRows.map(async (s) => {
			const [presenceRow] = await db
				.select({ status: staffPresence.status, lastSeenAt: staffPresence.lastSeenAt })
				.from(staffPresence)
				.where(eq(staffPresence.opsUserId, s.opsUserId))
				.limit(1);
			// Same auto-flip rule as getPresence: no heartbeat for 15 min = offline.
			let presence: StaffPresence = presenceRow?.status ?? "offline";
			if (presence !== "offline" && presenceRow?.lastSeenAt) {
				const ageMs = Date.now() - presenceRow.lastSeenAt.getTime();
				if (ageMs > 15 * 60 * 1000) presence = "offline";
			}
			const [{ activeCount }] = await db
				.select({ activeCount: sql<number>`count(*)::int` })
				.from(stageAssignments)
				.where(
					and(
						eq(stageAssignments.opsUserId, s.opsUserId),
						eq(stageAssignments.status, "active"),
					),
				);
			// Per-staff unread of messages from others is computed by the FAB badge
			// via getUnreadCounts(viewer); the directory shows presence + load only.
			return {
				opsUserId: s.opsUserId,
				name: s.name,
				email: s.email,
				role: s.role,
				branch: s.branch,
				presence,
				lastSeenAt: presenceRow?.lastSeenAt?.toISOString() ?? null,
				unreadCount: 0,
				activeCaseCount: activeCount,
				currentAssignmentSummary:
					activeCount > 0 ? `Handling ${activeCount} active case${activeCount === 1 ? "" : "s"}` : null,
			};
		}),
	);
	return { staff: out };
}

