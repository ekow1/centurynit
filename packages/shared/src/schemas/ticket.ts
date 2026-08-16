import { z } from "zod";

export const ticketStatusSchema = z.enum(["open", "pending", "resolved", "closed"]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;

export const ticketMessageSchema = z.object({
	id: z.string().uuid(),
	ticketId: z.string().uuid(),
	senderType: z.enum(["applicant", "staff", "system"]),
	senderId: z.string().nullable().optional(),
	senderName: z.string(),
	message: z.string().min(1).max(5000),
	createdAt: z.string().datetime(),
});
export type TicketMessage = z.infer<typeof ticketMessageSchema>;

export const ticketSchema = z.object({
	id: z.string().uuid(),
	clientUserId: z.string(),
	applicantName: z.string(),
	subject: z.string().min(1).max(255),
	category: z.string().min(1).max(64),
	status: ticketStatusSchema,
	priority: ticketPrioritySchema,
	assignedStaffId: z.string().uuid().nullable().optional(),
	assignedStaffName: z.string().nullable().optional(),
	messages: z.array(ticketMessageSchema),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type Ticket = z.infer<typeof ticketSchema>;

export const ticketListSchema = z.object({
	tickets: z.array(ticketSchema),
	total: z.number().int(),
});
export type TicketList = z.infer<typeof ticketListSchema>;

export const createTicketSchema = z.object({
	subject: z.string().min(3).max(255),
	category: z.string().min(1).max(64).default("General Inquiry"),
	message: z.string().min(1).max(5000),
	priority: ticketPrioritySchema.default("medium"),
});
export type CreateTicket = z.infer<typeof createTicketSchema>;

export const replyTicketSchema = z.object({
	message: z.string().min(1).max(5000),
});
export type ReplyTicket = z.infer<typeof replyTicketSchema>;

export const updateTicketStatusSchema = z.object({
	status: ticketStatusSchema.optional(),
	priority: ticketPrioritySchema.optional(),
	assignedStaffId: z.string().uuid().nullable().optional(),
});
export type UpdateTicketStatus = z.infer<typeof updateTicketStatusSchema>;
