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
 * This service finally does - one conversation per (case, stage, type),
 * created on demand, never duplicated.
 *
 * See the design doc for the full routing and permission model.
 */

import { and, desc, eq, gt, gte, inArray, isNull, like, lte, ne, notExists, sql } from "drizzle-orm";
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
	authSettings,
	cannedReplies,
	communicationEvents,
	conversationParticipants,
	conversations,
	messageAttachments,
	messages,
	opsUsers,
	stageAssignments,
	staffPresence,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import type { SessionUser, StaffContext } from "../middleware/auth.js";
import { canAccessApplication } from "./cases.js";
import { publishChatEvent, publishChatEventToClient, notifyOfflineParticipants, sendMessage } from "./chat.js";
import { notify, notifyMany, getStaffUserId, getCustomerServiceUserIds, getManagerAndCoordinatorUserIds } from "./notify.js";
import { serializeMessageRow, hydrateMessages } from "./message-serializer.js";

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
			return "On leave - covered by your case manager";
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
 * are never visible via `/me/*` - this is the security boundary.
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
		return canAccessApplication(conv.linkedEntityId, user.id, staff);
	}
	// Consultation-linked: delegate to assigned-officer / coordinator visibility.
	if (conv.linkedEntityType === "consultation" && conv.linkedEntityId) {
		// Coarse: managers/coordinators and the admin tier see all; consultants
		// must be a participant. (Refined in a follow-up via canSeeConsultation
		// if needed.)
		return (
			staff.role === "manager" ||
			staff.role === "coordinator" ||
			staff.role === "super_admin" ||
			staff.role === "admin"
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

	// System rows (assignment announcements, stage completion notes) are
	// housekeeping, not conversation — they never count as unread.
	conditions.push(ne(messages.messageType, "system"));

	// Messages not sent by the viewer, newer than their last-read cursor.
	if (viewer.opsUserId) {
		conditions.push(ne(messages.senderOpsUserId, viewer.opsUserId));
	} else {
		conditions.push(ne(messages.senderUserId, viewer.userId!));
		// Staff-only notes never count toward a client's unread badge.
		conditions.push(eq(messages.visibility, "public"));
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

	// The preview shows the last real message — a staff-only note for clients,
	// and a system housekeeping row for nobody.
	const lastMsgConditions = [
		eq(messages.conversationId, row.id),
		ne(messages.messageType, "system"),
	];
	if (viewer.userId) {
		lastMsgConditions.push(eq(messages.visibility, "public"));
	}
	const [lastMsg] = await db
		.select()
		.from(messages)
		.where(and(...lastMsgConditions))
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
		subject: row.subject,
		category: row.category as ChatConversation["category"],
		priority: row.priority as ChatConversation["priority"],
		waitingOn: row.waitingOn as ChatConversation["waitingOn"],
		audience: row.audience as ChatConversation["audience"],
		raisedByOpsUserId: row.raisedByOpsUserId,
		firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
		resolvedAt: row.resolvedAt?.toISOString() ?? null,
		csatScore: row.csatScore,
		csatNote: viewer.opsUserId ? row.csatNote : null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function serializeMessage(row: typeof messages.$inferSelect): ChatMessage {
	return serializeMessageRow(row);
}

/* ── Conversation routing - the no-duplicate gate (§22) ─────────────────── */

export interface FindOrCreateInput {
	type: "support" | "case" | "stage" | "internal" | "escalation";
	/** Customer (applicant) user ID - required for customer-visible types. */
	userId?: string;
	/** Staff who initiated (for internal/escalation) or who owns (for applicant creation). */
	createdByOpsUserId?: string | null;
	linkedEntityType?: "application" | "consultation" | "booking" | null;
	linkedEntityId?: string | null;
	stageKey?: string | null;
	title: string;
	/** Initial participant staff IDs (besides the creator). */
	participantOpsUserIds?: string[];
	/* Request layer — for `support`: reuses only an OPEN thread of the same
	   category (one request per thread); everything else keeps the old match. */
	subject?: string | null;
	category?: string | null;
	priority?: string;
	/** "internal" keeps the thread off every client read. */
	audience?: string;
	raisedByOpsUserId?: string | null;
}

/**
 * Find an existing conversation matching the natural identity
 * (linkedEntityType, linkedEntityId, stageKey, type) or create one. Repeated
 * clicks never duplicate - this is the structural fix for "don't fragment".
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
				// Request threads reuse only an OPEN thread of the same category —
				// a payment question in March and a visa question in July are two
				// requests, not one endless scroll. Uncategorized callers keep the
				// old one-thread-per-client behaviour.
				input.type === "support" ? eq(conversations.status, "open") : sql`true`,
				input.type === "support" && input.category !== undefined
					? (input.category ? eq(conversations.category, input.category) : isNull(conversations.category))
					: sql`true`,
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
			subject: input.subject ?? null,
			category: input.category ?? null,
			priority: input.priority ?? "normal",
			audience: input.audience === "internal" ? "internal" : "client",
			raisedByOpsUserId: input.raisedByOpsUserId ?? null,
			// A new request owes the desk a reply until staff answer.
			waitingOn: input.type === "support" ? "us" : null,
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
 * Resolve the customer's current contact - the answer to "who can help me,
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
		// No case - open / create the SUPPORT conversation. Title it with
		// the applicant's name so staff can identify who they're talking to
		// in the support queue, not a generic "Support" label.
		const [applicant] = await db
			.select({ name: applicants.name })
			.from(applicants)
			.where(eq(applicants.userId, userId))
			.limit(1);
		const { row } = await findOrCreateConversation({
			type: "support",
			userId,
			createdByOpsUserId: opts.createdByOpsUserId || null,
			title: applicant?.name ?? "Support",
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

	// No stage officer - case-level thread with the assigned staff / case manager.
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

/* ── Staff-initiated client threads (ops Helpdesk "New conversation") ────── */

/**
 * The ops-side mirror of routeCustomerChat: a staff member opens a thread
 * with a client - support (no context), case, or stage-scoped. Reuses
 * findOrCreateConversation so re-opening the same context joins the existing
 * thread instead of forking a duplicate. The creator is made a participant
 * (owner when creating) so they can reply immediately.
 */
export async function startClientConversation(
	clientUserId: string,
	creator: { id: string; name: string; email: string },
	opts: {
		linkedEntityType?: "application" | "consultation" | "booking" | null;
		linkedEntityId?: string | null;
		stageKey?: string | null;
		initialMessage?: string;
	} = {},
): Promise<ChatConversation> {
	const [applicant] = await db
		.select({ id: applicants.id, name: applicants.name })
		.from(applicants)
		.where(eq(applicants.userId, clientUserId))
		.limit(1);
	if (!applicant) {
		throw new HttpError(404, "CLIENT_NOT_FOUND", "No applicant on file for this client");
	}

	let type: FindOrCreateInput["type"] = "support";
	let title = applicant.name;
	let participantOpsUserIds: string[] = [];

	if (opts.linkedEntityType === "application" && opts.linkedEntityId) {
		const [app] = await db
			.select({
				id: applications.id,
				appNumber: applications.appNumber,
				stage: applications.stage,
				assignedStaffId: applications.assignedStaffId,
				applicantId: applications.applicantId,
			})
			.from(applications)
			.where(eq(applications.id, opts.linkedEntityId))
			.limit(1);
		if (!app || app.applicantId !== applicant.id) {
			throw new HttpError(404, "CASE_NOT_FOUND", "No such case for this client");
		}

		const stageKey = opts.stageKey ?? null;
		if (stageKey) {
			type = "stage";
			title = `${app.appNumber} · ${STAGE_LABEL(stageKey) ?? stageKey}`;
			const [assignment] = await db
				.select({ opsUserId: stageAssignments.opsUserId })
				.from(stageAssignments)
				.where(
					and(
						eq(stageAssignments.applicationId, app.id),
						eq(stageAssignments.stage, stageKey as JourneyStage),
						eq(stageAssignments.status, "active"),
					),
				)
				.limit(1);
			if (assignment && assignment.opsUserId !== creator.id) {
				participantOpsUserIds = [assignment.opsUserId];
			}
		} else {
			type = "case";
			title = `${app.appNumber}`;
			if (app.assignedStaffId && app.assignedStaffId !== creator.id) {
				participantOpsUserIds = [app.assignedStaffId];
			}
		}
	} else if (opts.linkedEntityType === "consultation" && opts.linkedEntityId) {
		// "entity" is not in CUSTOMER_VISIBLE_TYPES - a consultation-scoped
		// thread must stay `support` (with the link recorded) or the client
		// would never see it.
		type = "support";
		title = `${applicant.name} · Consultation`;
	}

	const { row, created } = await findOrCreateConversation({
		type,
		userId: clientUserId,
		createdByOpsUserId: creator.id,
		linkedEntityType: opts.linkedEntityType ?? null,
		linkedEntityId: opts.linkedEntityId ?? null,
		stageKey: opts.stageKey ?? null,
		title,
		participantOpsUserIds,
	});

	// The creator must be a participant even when the thread already existed
	// (findOrCreate only inserts the creator on the create path).
	const [membership] = await db
		.select({ opsUserId: conversationParticipants.opsUserId })
		.from(conversationParticipants)
		.where(
			and(
				eq(conversationParticipants.conversationId, row.id),
				eq(conversationParticipants.opsUserId, creator.id),
			),
		)
		.limit(1);
	if (!membership) {
		await db.insert(conversationParticipants).values({
			conversationId: row.id,
			opsUserId: creator.id,
			role: "member",
		});
	}

	if (created) {
		publishChatEvent(row.id, { type: "chat.conversation.created", conversationId: row.id });
	}

	if (opts.initialMessage?.trim()) {
		await sendMessage(row.id, creator, { content: opts.initialMessage });
	}

	return serializeConversation(row, { opsUserId: creator.id });
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
	const conditions = [
		eq(messages.conversationId, conversationId),
		// Staff-only notes are filtered out of every client transcript.
		eq(messages.visibility, "public"),
		// Assignment/completion housekeeping is not client conversation.
		ne(messages.messageType, "system"),
	];
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
	const hydrated = await hydrateMessages(sliced.reverse(), { userId });
	return {
		messages: hydrated,
		total: hydrated.length,
		hasMore,
	};
}

export async function sendCustomerMessage(
	conversationId: string,
	user: SessionUser,
	content: string,
	attachmentIds?: string[],
): Promise<ChatMessage> {
	const ok = await canAccessConversation(user, null, conversationId);
	if (!ok) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");

	const [conv] = await db
		.select({ status: conversations.status })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);

	// A new client message re-opens a resolved conversation - "resolved" is a
	// state, not a wall. Staff see the divider, the queue surfaces it again.
	if (conv?.status === "closed") {
		await db
			.update(conversations)
			.set({
				status: "open",
				closedAt: null,
				reopenedCount: sql`${conversations.reopenedCount} + 1`,
			})
			.where(eq(conversations.id, conversationId));
		await appendSystemMessage(
			conversationId,
			"Conversation reopened - new message from the client",
		);
		publishChatEvent(conversationId, {
			type: "chat.conversation.updated",
			conversationId,
			status: "open",
		});
		publishChatEventToClient(conversationId, {
			type: "chat.conversation.updated",
			conversationId,
			status: "open",
		});
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
		.set({ updatedAt: new Date(), lastMessageAt: new Date(), waitingOn: "us" })
		.where(eq(conversations.id, conversationId));

	// Bind pre-staged uploads - scoped to this customer's unbound rows so one
	// client can't attach another's staged file by guessing ids.
	if (attachmentIds?.length) {
		await db
			.update(messageAttachments)
			.set({ messageId: created.id })
			.where(
				and(
					inArray(messageAttachments.id, attachmentIds),
					isNull(messageAttachments.messageId),
					eq(messageAttachments.uploadedByUserId, user.id),
				),
			);
	}

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
	// Client channel too: the sender's own tab dedupes by id, and their other
	// devices stay in sync.
	publishChatEventToClient(conversationId, {
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
			// No staff participants - alert the triage queue for ANY client-facing
			// thread, not just support. An orphaned case/stage conversation
			// (deleted or unassigned officer) would otherwise black-hole.
			const [convRow] = await db
				.select({ type: conversations.type })
				.from(conversations)
				.where(eq(conversations.id, conversationId))
				.limit(1);
			if (convRow && (CUSTOMER_VISIBLE_TYPES as readonly string[]).includes(convRow.type)) {
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
							title: `${user.name ?? "A client"} sent a message`,
							body: preview,
							link: `/helpdesk?id=${conversationId}`,
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
					link: `/helpdesk?id=${conversationId}`,
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

	// Out-of-hours courtesy line — self-guarding, one per 20h per thread.
	void maybeAutoHoursLine(conversationId);

	return { ...serializeMessage(created), deliveryStatus: "sent" };
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
) {
	const [row] = await db.insert(messages).values({
		conversationId,
		senderName: "System",
		content,
		messageType: "system",
	}).returning();
	await db
		.update(conversations)
		.set({ updatedAt: new Date(), lastMessageAt: new Date() })
		.where(eq(conversations.id, conversationId));
	await recordEvent({
		action: "system_message",
		conversationId,
		metadata: { content, ...metadata },
	});
	return row;
}

/* ── Stage assignment + reassignment (§8, §12) ───────────────────────────── */

export async function assignStageOfficer(input: {
	applicationId: string;
	stage: string;
	opsUserId: string;
	assignedBy: string;
	reason?: string;
	scope?: "stage" | "all";
}): Promise<StageAssignment> {
	// "All stages" - the whole-case owner. Goes through setCaseOwner so
	// applications.assignedStaffId, the applicant's point of contact and the
	// case_assignments history change together (see caseOwnership.ts).
	if (input.scope === "all") {
		const { setCaseOwner } = await import("./caseOwnership.js");
		await setCaseOwner({
			applicationId: input.applicationId,
			opsUserId: input.opsUserId,
			assignedBy: input.assignedBy,
			note: input.reason,
		});
		const { caseAssignments } = await import("../db/schema.js");
		const [created] = await db
			.select({ id: caseAssignments.id })
			.from(caseAssignments)
			.where(
				and(
					eq(caseAssignments.targetType, "application"),
					eq(caseAssignments.targetId, input.applicationId),
					eq(caseAssignments.status, "active"),
				),
			)
			.limit(1);
		await recordEvent({
			action: "staff_assigned",
			actorOpsUserId: input.assignedBy,
			applicationId: input.applicationId,
			metadata: { assignmentId: created.id, officer: input.opsUserId, scope: "all", reason: input.reason },
		});
		return {
			id: created?.id ?? input.applicationId,
			applicationId: input.applicationId,
			stage: "all",
			opsUserId: input.opsUserId,
			status: "active",
			assignedAt: new Date().toISOString(),
			assignedBy: input.assignedBy,
			endedAt: null,
			endedReason: null,
		};
	}

	// End any existing active assignment for this (case, stage) - reassignment.
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
		// The outgoing officer hears about a replacement — the seat should
		// never just disappear from their queue without a word.
		if (row.opsUserId !== input.opsUserId) {
			getStaffUserId(row.opsUserId)
				.then((userId) =>
					userId
						? notify({
								recipientUserId: userId,
								type: "assignment.released",
								title: "Seat reassigned",
								body: `Your ${JOURNEY_STAGE_LABELS[input.stage as JourneyStage] ?? input.stage} seat moved to another handler.${input.reason ? ` ${input.reason}` : ""}`,
								link: "/applications",
							})
						: null,
				)
				.catch(() => {});
		}
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

/**
 * Auto-end the active per-stage officer assignment for a stage that has
 * finished (`ended_reason = 'stage_completed'`). Idempotent no-op when the
 * stage was never staffed or is already ended. Releases the specialist from
 * the stage conversation (participant → `former`, history retained) and
 * records a `stage_completed` event so the assignment feed shows the reason.
 */
export async function onStageCompleted(input: {
	applicationId: string;
	stage: string;
	completedBy?: string | null;
	reason?: string;
}): Promise<void> {
	const active = await db
		.select({
			id: stageAssignments.id,
			opsUserId: stageAssignments.opsUserId,
		})
		.from(stageAssignments)
		.where(
			and(
				eq(stageAssignments.applicationId, input.applicationId),
				eq(stageAssignments.stage, input.stage),
				eq(stageAssignments.status, "active"),
			),
		);
	if (active.length === 0) return;

	const reason = input.reason ?? "stage_completed";
	const now = new Date();
	const label = STAGE_LABEL(input.stage) ?? input.stage;

	for (const row of active) {
		await db
			.update(stageAssignments)
			.set({ status: "completed", endedAt: now, endedReason: reason })
			.where(eq(stageAssignments.id, row.id));

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
			await appendSystemMessage(
				stageConv.id,
				`The ${label} stage is complete - thanks for handling it.`,
				{ assignmentId: row.id, reason, stage: input.stage },
			);
		}
	}

	await recordEvent({
		action: "stage_completed",
		actorOpsUserId: input.completedBy ?? undefined,
		applicationId: input.applicationId,
		stageKey: input.stage,
		metadata: { reason },
	});
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
	// Insert with status='available' (the DB default is 'offline' - a fresh
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


/* ══════════════════════════════════════════════════════════════════════════
 * Request layer. A support thread is ONE request: category + subject +
 * waiting-on state + resolution + CSAT. Both intakes (portal form and the
 * ops "log request" sheet) produce the same row, so a phone call and a
 * portal submission land in the same queue.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Portal intake. Reuses the client's OPEN same-category support thread. */
export async function createCustomerRequest(
	user: SessionUser,
	input: { category: string; subject: string; content: string; caseId?: string },
): Promise<ChatConversation> {
	const conv = await findOrCreateConversation({
		type: "support",
		userId: user.id,
		createdByOpsUserId: null,
		linkedEntityType: input.caseId ? "application" : null,
		linkedEntityId: input.caseId ?? null,
		category: input.category,
		subject: input.subject,
		title: input.subject,
	});
	if (!conv.created) {
		// Reused the open thread — keep the latest subject fresh.
		await db
			.update(conversations)
			.set({ subject: input.subject })
			.where(and(eq(conversations.id, conv.id), isNull(conversations.subject)));
	}
	await sendCustomerMessage(conv.id, user, input.content);
	const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id)).limit(1);
	return serializeConversation(row, { userId: user.id });
}

/** Ops intake: file a request FOR a client, or an internal staff ticket. */
export async function createStaffRequest(
	opsUserId: string,
	input: {
		clientUserId?: string | null;
		category: string;
		subject: string;
		content: string;
		internal?: boolean;
		assigneeOpsUserId?: string | null;
		priority?: string;
	},
): Promise<ChatConversation> {
	const [creator] = await db
		.select({ userId: opsUsers.userId, name: opsUsers.name, email: opsUsers.email })
		.from(opsUsers)
		.where(eq(opsUsers.id, opsUserId))
		.limit(1);
	const conv = await findOrCreateConversation({
		type: input.internal ? "internal" : "support",
		userId: input.internal ? undefined : (input.clientUserId ?? undefined),
		createdByOpsUserId: opsUserId,
		category: input.category,
		subject: input.subject,
		title: input.subject,
		priority: input.priority ?? "normal",
		audience: input.internal ? "internal" : "client",
		raisedByOpsUserId: opsUserId,
		participantOpsUserIds: input.assigneeOpsUserId ? [input.assigneeOpsUserId] : [],
	});
	if (input.content.trim()) {
		await sendMessage(
			conv.id,
			{ id: opsUserId, name: creator?.name ?? "Staff", email: creator?.email ?? "" },
			{ content: input.content },
		);
	}
	// A request filed by the office already has its first response.
	if (conv.created) {
		await db
			.update(conversations)
			.set({ firstResponseAt: new Date() })
			.where(eq(conversations.id, conv.id));
	}
	const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id)).limit(1);
	return serializeConversation(row, { opsUserId });
}

export async function setConversationWaitingOn(
	conversationId: string,
	waitingOn: "us" | "client" | null,
): Promise<void> {
	await db
		.update(conversations)
		.set({ waitingOn, updatedAt: new Date() })
		.where(eq(conversations.id, conversationId));
	publishChatEvent(conversationId, { type: "chat.conversation.updated", conversationId });
	publishChatEventToClient(conversationId, { type: "chat.conversation.updated", conversationId });
}

export async function escalateConversation(
	conversationId: string,
	opsUserId: string,
	reason: string,
): Promise<void> {
	await db
		.update(conversations)
		.set({
			escalatedByOpsUserId: opsUserId,
			escalationReason: reason,
			priority: "urgent",
			waitingOn: "us",
			updatedAt: new Date(),
		})
		.where(eq(conversations.id, conversationId));
	await appendSystemMessage(conversationId, `Escalated — ${reason}`);
	publishChatEvent(conversationId, { type: "chat.conversation.updated", conversationId });
	// Managers own escalations.
	const mgrs = await getManagerAndCoordinatorUserIds();
	await notifyMany(
		mgrs.map(({ userId }) => ({
			recipientUserId: userId!,
			type: "chat.escalation",
			title: "Conversation escalated",
			body: reason,
			link: `/helpdesk?id=${conversationId}`,
		})),
	);
}

/** CSAT after resolve. Client-owned conversations only. */
export async function rateConversation(
	user: SessionUser,
	conversationId: string,
	score: number,
	note?: string,
): Promise<void> {
	const [conv] = await db
		.select({ userId: conversations.userId, status: conversations.status })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	if (!conv || conv.userId !== user.id)
		throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
	await db
		.update(conversations)
		.set({ csatScore: score, csatNote: note ?? null })
		.where(eq(conversations.id, conversationId));
	publishChatEvent(conversationId, { type: "chat.conversation.updated", conversationId });
}

/* ── Canned replies ─────────────────────────────────────────────────────── */

export async function listCannedReplies(scopeValue?: string | null) {
	const rows = await db.select().from(cannedReplies).orderBy(cannedReplies.label);
	return rows
		.filter(
			(r) =>
				r.scope === "all" ||
				(scopeValue != null && r.scopeValue === scopeValue),
		)
		.map(serializeCannedReply);
}

function serializeCannedReply(r: typeof cannedReplies.$inferSelect) {
	return {
		id: r.id,
		label: r.label,
		body: r.body,
		scope: r.scope as "all" | "branch" | "stage",
		scopeValue: r.scopeValue,
	};
}

export async function createCannedReply(input: {
	label: string;
	body: string;
	scope?: string;
	scopeValue?: string;
}) {
	const [row] = await db
		.insert(cannedReplies)
		.values({
			label: input.label,
			body: input.body,
			scope: input.scope ?? "all",
			scopeValue: input.scopeValue ?? null,
		})
		.returning();
	return serializeCannedReply(row);
}

export async function deleteCannedReply(id: string): Promise<void> {
	await db.delete(cannedReplies).where(eq(cannedReplies.id, id));
}

/* ── Desk settings + stats ──────────────────────────────────────────────── */

export interface HelpdeskSettings {
	hoursLabel: string;
	firstResponseMinutes: number;
	resolutionHours: number;
	/** Structured hours for the out-of-hours auto line. daysOpen: 0=Sun…6=Sat. */
	daysOpen: number[];
	openMinutes: number;
	closeMinutes: number;
	timezone: string;
	/** Minutes an unclaimed client request may sit before the sweep assigns it. */
	autoAssignMinutes: number;
}

const DEFAULT_HELPDESK: HelpdeskSettings = {
	hoursLabel: "Mon–Fri 08:00–17:00 GMT",
	firstResponseMinutes: 60,
	resolutionHours: 24,
	daysOpen: [1, 2, 3, 4, 5],
	openMinutes: 8 * 60,
	closeMinutes: 17 * 60,
	timezone: "Africa/Accra",
	autoAssignMinutes: 15,
};

export async function getHelpdeskSettings(): Promise<HelpdeskSettings> {
	const [row] = await db
		.select({ value: authSettings.value })
		.from(authSettings)
		.where(eq(authSettings.key, "helpdesk"))
		.limit(1);
	const v = (row?.value ?? {}) as Partial<HelpdeskSettings>;
	return { ...DEFAULT_HELPDESK, ...v };
}

/** Local wall-clock in the desk's timezone — the honest "are we open" check. */
export function isDeskOpen(settings: HelpdeskSettings, at = new Date()): boolean {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: settings.timezone,
			weekday: "short",
			hour: "numeric",
			minute: "numeric",
			hour12: false,
		}).formatToParts(at);
		const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
		const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
		const minutes = Number(get("hour")) * 60 + Number(get("minute"));
		return (
			settings.daysOpen.includes(dayIdx) &&
			minutes >= settings.openMinutes &&
			minutes < settings.closeMinutes
		);
	} catch {
		// A bad timezone in settings must fail OPEN — never tell a client the
		// desk is closed because of a config typo.
		return true;
	}
}

const AUTO_HOURS_MARKER = "desk is open";

/**
 * Out-of-hours auto line. When a client writes while the desk is closed we
 * say when we'll be back instead of leaving the send on read-nothing.
 * Throttled to one per 20h per thread so a late-night back-and-forth isn't
 * spammed, and fully self-guarding — a failure here never blocks the send.
 */
export async function maybeAutoHoursLine(conversationId: string): Promise<void> {
	try {
		const [conv] = await db
			.select({ audience: conversations.audience })
			.from(conversations)
			.where(eq(conversations.id, conversationId))
			.limit(1);
		if (conv?.audience !== "client") return;
		const settings = await getHelpdeskSettings();
		if (isDeskOpen(settings)) return;
		const since = new Date(Date.now() - 20 * 60 * 60 * 1000);
		const [recent] = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(
					eq(messages.conversationId, conversationId),
					eq(messages.messageType, "system"),
					like(messages.content, `%${AUTO_HOURS_MARKER}%`),
					gte(messages.createdAt, since),
				),
			)
			.limit(1);
		if (recent) return;
		const row = await appendSystemMessage(
			conversationId,
			`Our ${AUTO_HOURS_MARKER} ${settings.hoursLabel} — we'll reply first thing when we open.`,
			{ auto: "out_of_hours" },
		);
		const payload = { type: "chat.message", conversationId, message: serializeMessage(row) };
		publishChatEvent(conversationId, payload);
		publishChatEventToClient(conversationId, payload);
	} catch {
		// The auto line is a courtesy — never let it break a real send.
	}
}

function median(nums: number[]): number | null {
	if (!nums.length) return null;
	const s = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export async function deskStats(): Promise<{
	open: number;
	waitingOnClient: number;
	unclaimed: number;
	breaching: number;
	medianFirstResponseMinutes: number | null;
	medianResolutionHours: number | null;
	csatAvg: number | null;
	settings: HelpdeskSettings;
}> {
	const settings = await getHelpdeskSettings();
	const rows = await db
		.select()
		.from(conversations)
		.where(
			and(
				inArray(conversations.type, ["support", "case", "stage", "applicant"]),
				eq(conversations.audience, "client"),
				ne(conversations.status, "archived"),
			),
		);

	const now = Date.now();
	const firstRespMs: number[] = [];
	const resolMs: number[] = [];
	const csat: number[] = [];
	let open = 0;
	let waitingClient = 0;
	let breaching = 0;

	for (const r of rows) {
		if (r.status === "open") {
			open++;
			if (r.waitingOn === "client") waitingClient++;
			const ageMin = (now - r.createdAt.getTime()) / 60000;
			const resAgeH =
				(now - (r.lastMessageAt?.getTime() ?? r.createdAt.getTime())) / 3600000;
			if (
				(r.firstResponseAt == null && ageMin > settings.firstResponseMinutes) ||
				resAgeH > settings.resolutionHours
			) {
				breaching++;
			}
		}
		if (r.firstResponseAt) {
			firstRespMs.push(r.firstResponseAt.getTime() - r.createdAt.getTime());
		}
		if (r.resolvedAt) {
			resolMs.push(r.resolvedAt.getTime() - r.createdAt.getTime());
		}
		if (r.csatScore) csat.push(r.csatScore);
	}

	// unclaimed = open, no owner participant
	const owners = await db
		.select({ conversationId: conversationParticipants.conversationId })
		.from(conversationParticipants)
		.where(eq(conversationParticipants.role, "owner"));
	const owned = new Set(owners.map((o) => o.conversationId));
	const unclaimed = rows.filter((r) => r.status === "open" && !owned.has(r.id)).length;

	return {
		open,
		waitingOnClient: waitingClient,
		unclaimed,
		breaching,
		medianFirstResponseMinutes: firstRespMs.length
			? Math.round(median(firstRespMs)! / 60000)
			: null,
		medianResolutionHours: resolMs.length
			? Math.round((median(resolMs)! / 3600000) * 10) / 10
			: null,
		csatAvg: csat.length
			? Math.round((csat.reduce((a, b) => a + b, 0) / csat.length) * 10) / 10
			: null,
		settings,
	};
}

/**
 * The unclaimed-request sweep (BullMQ, every 15min). Open client-facing
 * threads with NO owner and older than the grace period get handed to the
 * least-loaded available customer-service agent. "Available" is the same
 * presence rule the desk reads: status available + heartbeat < 15min. When
 * nobody is available the request stays unclaimed — the next sweep retries,
 * and the desk's Unclaimed band still shows it either way.
 */
export async function runHelpdeskSweep(): Promise<{ assigned: number }> {
	const settings = await getHelpdeskSettings();
	const cutoff = new Date(Date.now() - settings.autoAssignMinutes * 60_000);

	// Open, client-facing, past the grace period, with no owner participant.
	const orphans = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(
			and(
				eq(conversations.status, "open"),
				eq(conversations.audience, "client"),
				inArray(conversations.type, [...CUSTOMER_VISIBLE_TYPES]),
				lte(conversations.createdAt, cutoff),
				notExists(
					db
						.select({ one: sql`1` })
						.from(conversationParticipants)
						.where(
							and(
								eq(conversationParticipants.conversationId, conversations.id),
								eq(conversationParticipants.role, "owner"),
							),
						),
				),
			),
		)
		.limit(50);
	if (!orphans.length) return { assigned: 0 };

	// Available customer-service agents — presence heartbeat within 15min.
	const agents = await db
		.select({ id: opsUsers.id, name: opsUsers.name, userId: opsUsers.userId })
		.from(opsUsers)
		.innerJoin(staffPresence, eq(staffPresence.opsUserId, opsUsers.id))
		.where(
			and(
				eq(opsUsers.active, true),
				eq(opsUsers.role, "customer_service"),
				eq(staffPresence.status, "available"),
				gte(staffPresence.lastSeenAt, new Date(Date.now() - 15 * 60_000)),
			),
		);
	if (!agents.length) return { assigned: 0 };

	// Least-loaded wins each round — an even spread, not a strict rotation,
	// so a drowning agent doesn't keep taking tickets.
	const load = new Map<string, number>(agents.map((a) => [a.id, 0]));
	const owned = await db
		.select({
			opsUserId: conversationParticipants.opsUserId,
			n: sql<number>`count(*)::int`,
		})
		.from(conversationParticipants)
		.innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
		.where(
			and(
				eq(conversationParticipants.role, "owner"),
				eq(conversations.status, "open"),
				eq(conversations.audience, "client"),
				inArray(conversationParticipants.opsUserId, agents.map((a) => a.id)),
			),
		)
		.groupBy(conversationParticipants.opsUserId);
	for (const r of owned) if (r.opsUserId) load.set(r.opsUserId, r.n);

	let assigned = 0;
	for (const conv of orphans) {
		const pick = agents.reduce((a, b) =>
			(load.get(b.id) ?? 0) < (load.get(a.id) ?? 0) ? b : a,
		);
		// Promote an existing membership or join them in as owner — the
		// COALESCE'd unique index can't be upserted, so select-then-write.
		const [existing] = await db
			.select({ conversationId: conversationParticipants.conversationId })
			.from(conversationParticipants)
			.where(
				and(
					eq(conversationParticipants.conversationId, conv.id),
					eq(conversationParticipants.opsUserId, pick.id),
				),
			)
			.limit(1);
		if (existing) {
			await db
				.update(conversationParticipants)
				.set({ role: "owner" })
				.where(
					and(
						eq(conversationParticipants.conversationId, conv.id),
						eq(conversationParticipants.opsUserId, pick.id),
					),
				);
		} else {
			await db
				.insert(conversationParticipants)
				.values({ conversationId: conv.id, opsUserId: pick.id, role: "owner" });
		}
		await appendSystemMessage(
			conv.id,
			`Auto-assigned to ${pick.name} — the desk picked up your request.`,
			{ auto: "round_robin", opsUserId: pick.id },
		);
		publishChatEvent(conv.id, {
			type: "chat.conversation.updated",
			conversationId: conv.id,
		});
		publishChatEventToClient(conv.id, {
			type: "chat.conversation.updated",
			conversationId: conv.id,
		});
		if (pick.userId) {
			notify({
				recipientUserId: pick.userId,
				type: "chat.assigned",
				title: "Request auto-assigned to you",
				body: "An unclaimed client request was routed to your queue.",
				link: `/helpdesk?id=${conv.id}`,
			}).catch(() => {});
		}
		load.set(pick.id, (load.get(pick.id) ?? 0) + 1);
		assigned++;
	}
	return { assigned };
}
