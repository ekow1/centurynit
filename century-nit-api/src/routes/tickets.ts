import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	createTicketSchema,
	replyTicketSchema,
	ticketListSchema,
	ticketSchema,
	updateTicketStatusSchema,
} from "century-nit-shared";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
import {
	createTicket,
	listAllTickets,
	listTicketsForUser,
	replyToTicket,
	updateTicketStatus,
} from "../services/tickets.js";

const idParams = z.object({ id: z.string().uuid() });

export const meTicketsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();
export const opsTicketsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── GET /api/v1/me/tickets ─────────────────────────────────────────────────── */

meTicketsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Tickets"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: ticketListSchema } },
				description: "Signed-in applicant's tickets",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const list = await listTicketsForUser(user.id);
		return c.json(list);
	},
);

/* ── POST /api/v1/me/tickets ────────────────────────────────────────────────── */

meTicketsRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["Tickets"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: createTicketSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: ticketSchema } },
				description: "Support ticket created",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const body = c.req.valid("json");
		const created = await createTicket(user, body);
		return c.json(created, 201);
	},
);

/* ── POST /api/v1/me/tickets/:id/messages ───────────────────────────────────── */

meTicketsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/messages",
		tags: ["Tickets"],
		middleware: [requireAuth] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: replyTicketSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: ticketSchema } },
				description: "Message reply added",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await replyToTicket(
			id,
			{ type: "applicant", id: user.id, name: user.name ?? user.email.split("@")[0] },
			body,
		);
		return c.json(updated);
	},
);

/* ── Staff Tickets Router ───────────────────────────────────────────────────── */

opsTicketsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Tickets"],
		middleware: [requireAuth, requireMfa, requireModule("helpdesk")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: ticketListSchema } },
				description: "All tickets visible to staff",
			},
		},
	}),
	async (c) => {
		const list = await listAllTickets();
		return c.json(list);
	},
);

opsTicketsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}",
		tags: ["Tickets"],
		middleware: [requireAuth, requireMfa, requireModule("helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: updateTicketStatusSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: ticketSchema } },
				description: "Ticket updated",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await updateTicketStatus(id, body);
		return c.json(updated);
	},
);

/* ── POST /api/v1/tickets/:id/messages (staff reply) ──────────────────────── */

opsTicketsRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/messages",
		tags: ["Tickets"],
		middleware: [requireAuth, requireMfa, requireModule("helpdesk")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: replyTicketSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: ticketSchema } },
				description: "Staff reply added",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await replyToTicket(
			id,
			{ type: "staff", id: user.id, name: user.name ?? user.email.split("@")[0] },
			body,
		);
		return c.json(updated);
	},
);
