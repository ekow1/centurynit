import { desc, eq } from "drizzle-orm";

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

export async function listTicketsForUser(userId: string): Promise<TicketList> {
	const rows = await db
		.select()
		.from(tickets)
		.where(eq(tickets.clientUserId, userId))
		.orderBy(desc(tickets.updatedAt));

	const list = await Promise.all(rows.map(serializeTicket));
	return {
		tickets: list,
		total: list.length,
	};
}

export async function listAllTickets(filter?: { status?: string }): Promise<TicketList> {
	let query = db.select().from(tickets);
	if (filter?.status && ["open", "pending", "resolved", "closed"].includes(filter.status)) {
		query = query.where(eq(tickets.status, filter.status as any)) as any;
	}

	const rows = await query.orderBy(desc(tickets.updatedAt));
	const list = await Promise.all(rows.map(serializeTicket));
	return {
		tickets: list,
		total: list.length,
	};
}

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

	// Auto-assign to the applicant's consultation officer so the ticket
	// reaches the right desk immediately instead of sitting in triage.
	const autoAssignId = applicant?.assignedOfficerId ?? null;

	const [created] = await db
		.insert(tickets)
		.values({
			clientUserId: user.id,
			applicantId: applicant?.id ?? null,
			applicantName,
			subject: input.subject,
			category: input.category,
			status: "open",
			priority: input.priority ?? "medium",
			assignedStaffId: autoAssignId,
		})
		.returning();

	// Insert initial message
	await db.insert(ticketMessages).values({
		ticketId: created.id,
		senderType: "applicant",
		senderId: user.id,
		senderName: applicantName,
		message: input.message,
	});

	return serializeTicket(created);
}

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
