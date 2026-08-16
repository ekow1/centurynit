import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
import {
	createManualLead,
	deleteLead,
	listLeads,
	updateLead,
} from "../services/leads.js";

const leadSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	email: z.string().email(),
	phone: z.string().nullable(),
	source: z.string(),
	stage: z.enum([
		"New Lead",
		"Contacted",
		"Consultation Booked",
		"Assessment Complete",
		"Enrolled",
		"Lost",
	]),
	targetCountry: z.string().nullable(),
	assignedStaffId: z.string().uuid().nullable(),
	notes: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const leadListResponseSchema = z.object({
	leads: z.array(leadSchema),
});

const createLeadBodySchema = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.string().email("Valid email required"),
	phone: z.string().optional().nullable(),
	source: z.string().optional(),
	targetCountry: z.string().optional().nullable(),
	notes: z.string().optional().nullable(),
});

const updateLeadBodySchema = z.object({
	name: z.string().optional(),
	email: z.string().email().optional(),
	phone: z.string().optional().nullable(),
	stage: z
		.enum([
			"New Lead",
			"Contacted",
			"Consultation Booked",
			"Assessment Complete",
			"Enrolled",
			"Lost",
		])
		.optional(),
	targetCountry: z.string().optional().nullable(),
	assignedStaffId: z.string().uuid().optional().nullable(),
	notes: z.string().optional().nullable(),
});

const idParams = z.object({
	id: z.string().uuid(),
});

export const leadsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── GET /api/v1/leads ──────────────────────────────────────────────────────── */

leadsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["CRM Leads"],
		middleware: [requireAuth, requireMfa, requireModule("leads")] as const,
		request: {
			query: z.object({
				stage: z.string().optional(),
				search: z.string().optional(),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: leadListResponseSchema } },
				description: "List of captured CRM leads",
			},
		},
	}),
	async (c) => {
		const query = c.req.valid("query");
		const rows = await listLeads(query);
		return c.json({ leads: rows });
	},
);

/* ── POST /api/v1/leads ─────────────────────────────────────────────────────── */

leadsRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["CRM Leads"],
		middleware: [requireAuth, requireMfa, requireModule("leads")] as const,
		request: {
			body: {
				content: { "application/json": { schema: createLeadBodySchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: leadSchema } },
				description: "Lead created successfully",
			},
		},
	}),
	async (c) => {
		const body = c.req.valid("json");
		const created = await createManualLead(body);
		return c.json(created, 201);
	},
);

/* ── PATCH /api/v1/leads/:id ────────────────────────────────────────────────── */

leadsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}",
		tags: ["CRM Leads"],
		middleware: [requireAuth, requireMfa, requireModule("leads")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: updateLeadBodySchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: leadSchema } },
				description: "Lead updated",
			},
			404: {
				description: "Lead not found",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const updated = await updateLead(id, body);
		if (!updated) {
			return c.json({ error: { code: "NOT_FOUND", message: "Lead not found" } }, 404);
		}
		return c.json(updated);
	},
);

/* ── DELETE /api/v1/leads/:id ───────────────────────────────────────────────── */

leadsRouter.openapi(
	createRoute({
		method: "delete",
		path: "/{id}",
		tags: ["CRM Leads"],
		middleware: [requireAuth, requireMfa, requireModule("leads")] as const,
		request: {
			params: idParams,
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
				description: "Lead deleted",
			},
			404: {
				description: "Lead not found",
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const ok = await deleteLead(id);
		if (!ok) {
			return c.json({ error: { code: "NOT_FOUND", message: "Lead not found" } }, 404);
		}
		return c.json({ success: true });
	},
);
