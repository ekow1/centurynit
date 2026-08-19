import { desc, eq, and } from "drizzle-orm";

import type {
	CreateTicket,
	ReplyTicket,
	Ticket,
	TicketList,
	UpdateTicketStatus,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	opsUsers,
	ticketMessages,
	tickets,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { notify, notifyMany, getManagerAndCoordinatorUserIds, getStaffUserId } from "./notify.js";

/* ── Category-based routing ────────────────────────────────────────────────── */

/**
 * Maps ticket categories to the role that should handle them.
 * `autoAssign: true` means route to the applicant's consultation officer.
 * A `role` string means find an active staff member with that role.
 */
const CATEGORY_ROUTING: Record<string, { role: string } | { autoAssign: true }> = {
	Billing: { role: "finance" },
	Technical: { role: "coordinator" },
	Application: { autoAssign: true },
	Documents: { autoAssign: true },
	Visa: { autoAssign: true },
	Other: { autoAssign: true },
};

/**
 * Determine who should be assigned to a ticket based on its category
 * and the applicant's existing consultation officer.
 *
 * Returns a staff UUID or null (unassigned → triage queue).
 */
async function resolveAssignee(
	category: string,
	applicantId: string | null,
): Promise<string | null> {
	const rule = CATEGORY_ROUTING[category] ?? { autoAssign: true };

	if ("role" in rule) {
		// Find an active staff member with the target role
		const [staff] = await db
			.select({ id: opsUsers.id })
			.from(opsUsers)
			.where(and(eq(opsUsers.role, rule.role), eq(opsUsers.active, true)))
			.limit(1);
		return staff?.id ?? null;
	}

	// autoAssign: route to the applicant's consultation officer
	if (!applicantId) return null;
	const [applicant] = await db
		.select({ assignedOfficerId: applicants.assignedOfficerId })
		.from(applicants)
		.where(eq(applicants.id, applicantId))
		.limit(1);
	return applicant?.assignedOfficerId ?? null;
}

/* ── Serialization ─────────────────────────────────────────────────────────── */

export async function serializeTicket(row: typeof tickets.$inferSelect): Promise<Ticket> {
	const messages = await db
		.select()
		.from(ticketMessages)
		.where(eq(ticketMessages.ticketId, row.id))
		.orderBy(ticketMessages.createdAt);

	let staffName: string | null = null;
	if (row.assignedStaffId) {
		const [staff] = await db
			.select()
			.from(opsUsers)
			.where(eq(opsUsers.id, row.assignedStaffId))
			.limit(1);
		staffName = staff?.name ?? null;
	}

	return {
		id: row.id,
		clientUserId: row.clientUserId,
		applicantName: row.applicantName,
		source: (row.source as "internal" | "external") ?? "external",
		subject: row.subject,
		category: row.category,
		status: row.status,
		priority: row.priority,
		assignedStaffId: row.assignedStaffId ?? undefined,
		assignedStaffName: staffName,
		messages: messages.map((m) => ({
			id: m.id,
			ticketId: m.ticketId,
			senderType: m.senderType,
			senderId: m.senderId,
			senderName: m.senderName,
			message: m.message,
			createdAt: m.createdAt.toISOString(),
		})),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/* ── Queries ───────────────────────────────────────────────────────────────── */

export async function listTicketsForUser(userId: string): Promise<TicketList> {
	const rows = await db
		.select()
		.from(tickets)
		.where(and(eq(tickets.clientUserId, userId), eq(tickets.source, "external")))
		.orderBy(desc(tickets.updatedAt));

	const list = await Promise.all(rows.map(serializeTicket));
	return {
		tickets: list,
		total: list.length,
	};
}

export async function listAllTickets(filter?: { status?: string; source?: string }): Promise<TicketList> {
	const conditions = [];
	if (filter?.status && ["open", "pending", "resolved", "closed"].includes(filter.status)) {
		conditions.push(eq(tickets.status, filter.status as any));
	}
	if (filter?.source && ["internal", "external"].includes(filter.source)) {
		conditions.push(eq(tickets.source, filter.source as any));
	}

	let query = db.select().from(tickets);
	if (conditions.length > 0) {
		query = query.where(and(...conditions)) as typeof query;
	}

	const rows = await query.orderBy(desc(tickets.updatedAt));
	const list = await Promise.all(rows.map(serializeTicket));
	return {
		tickets: list,
		total: list.length,
	};
}

/* ── Applicant creates ticket (external) ───────────────────────────────────── */

export async function createTicket(
	user: { id: string; name?: string | null; email: string },
	input: CreateTicket,
): Promise<Ticket> {
	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.userId, user.id))
		.limit(1);

	const applicantName = applicant?.name ?? user.name ?? user.email.split("@")[0];

	// Category-based routing with fallback to consultation officer → triage
	const assigneeId = await resolveAssignee(input.category, applicant?.id ?? null);

	const [created] = await db
		.insert(tickets)
		.values({
			clientUserId: user.id,
			applicantId: applicant?.id ?? null,
			applicantName,
			source: "external",
			subject: input.subject,
			category: input.category,
			status: "open",
			priority: input.priority ?? "medium",
			assignedStaffId: assigneeId,
		})
		.returning();

	await db.insert(ticketMessages).values({
		ticketId: created.id,
		senderType: "applicant",
		senderId: user.id,
		senderName: applicantName,
		message: input.message,
	});

	// In-app: alert the assigned staff member, or the triage queue when nobody
	// is assigned yet. Fire-and-forget so it never blocks ticket creation.
	(async () => {
		try {
			const title = `New ticket: ${created.subject}`;
			const body = `${applicantName} — ${created.category}`;

			if (created.assignedStaffId) {
				const staffUserId = await getStaffUserId(created.assignedStaffId);
				if (staffUserId) {
					await notify({
						recipientUserId: staffUserId,
						type: "ticket.new",
						title,
						body,
						link: "/ops/helpdesk",
					});
					return;
				}
			}

			const managers = await getManagerAndCoordinatorUserIds();
			await notifyMany(
				managers.map((m) => ({
					recipientUserId: m.userId,
					type: "ticket.new",
					title,
					body,
					link: "/ops/helpdesk",
				})),
			);
		} catch {
			// Notification failure must not block the ticket creation.
		}
	})().catch(() => {});

	return serializeTicket(created);
}

/* ── Staff creates internal ticket ─────────────────────────────────────────── */

export async function createInternalTicket(
	user: { id: string; name?: string | null; email: string },
	input: CreateTicket,
): Promise<Ticket> {
	const staffName = user.name ?? user.email.split("@")[0];

	const [created] = await db
		.insert(tickets)
		.values({
			clientUserId: user.id,
			applicantName: staffName,
			source: "internal",
			subject: input.subject,
			category: input.category,
			status: "open",
			priority: input.priority ?? "medium",
		})
		.returning();

	await db.insert(ticketMessages).values({
		ticketId: created.id,
		senderType: "staff",
		senderId: user.id,
		senderName: staffName,
		message: input.message,
	});

	return serializeTicket(created);
}

/* ── Reply ─────────────────────────────────────────────────────────────────── */

export async function replyToTicket(
	ticketId: string,
	sender: { type: "applicant" | "staff" | "system"; id?: string; name: string },
	input: ReplyTicket,
): Promise<Ticket> {
	const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
	if (!ticket) {
		throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
	}

	await db.insert(ticketMessages).values({
		ticketId,
		senderType: sender.type,
		senderId: sender.id ?? null,
		senderName: sender.name,
		message: input.message,
	});

	// Reopen ticket if applicant replied to a resolved/pending ticket
	const newStatus = sender.type === "applicant" && ticket.status === "resolved" ? "open" : ticket.status;

	const [updated] = await db
		.update(tickets)
		.set({
			status: newStatus,
			updatedAt: new Date(),
		})
		.where(eq(tickets.id, ticketId))
		.returning();

	return serializeTicket(updated);
}

/* ── Update status / priority / assignment ─────────────────────────────────── */

export async function updateTicketStatus(
	ticketId: string,
	input: UpdateTicketStatus,
): Promise<Ticket> {
	const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
	if (!ticket) {
		throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
	}

	const [updated] = await db
		.update(tickets)
		.set({
			status: input.status ?? ticket.status,
			priority: input.priority ?? ticket.priority,
			assignedStaffId: input.assignedStaffId !== undefined ? input.assignedStaffId : ticket.assignedStaffId,
			updatedAt: new Date(),
		})
		.where(eq(tickets.id, ticketId))
		.returning();

	return serializeTicket(updated);
}
