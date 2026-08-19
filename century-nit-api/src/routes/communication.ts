import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	chatConversationSchema,
	chatConversationListSchema,
	chatMessageListSchema,
	chatMessageSchema,
	communicationContextSchema,
	createStageAssignmentSchema,
	stageAssignmentSchema,
	staffDirectoryDetailedSchema,
	updatePresenceSchema,
	sendContextMessageSchema,
} from "century-nit-shared";
import { requireAuth, requireMfa, requireModule, requireRole, type AuthVariables } from "../middleware/auth.js";
import {
	getCommunicationContext,
	listCustomerConversations,
	routeCustomerChat,
	getCustomerMessages,
	sendCustomerMessage,
	markCustomerRead,
	getStaffDirectoryDetailed,
	updatePresence,
	heartbeat,
	assignStageOfficer,
	listStageAssignments,
} from "../services/communication.js";

const idParams = z.object({ id: z.string().uuid() });

/* ══════════════════════════════════════════════════════════════════════════
 * Applicant-facing communication — mounted at /api/v1/me/communication
 *
 * No MFA, no staff module: applicants reach this with their session cookie
 * only. Internal/escalation conversations never appear here — the service
 * filters by customer-visible types at the SQL layer (§14, §29).
 * ══════════════════════════════════════════════════════════════════════════ */
export const meCommunicationRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* GET /me/communication/context — the single payload the portal's
 * Communication Center renders: current contact, previous contacts,
 * conversation list, active case ref + stage. */
meCommunicationRouter.openapi(
	createRoute({
		method: "get",
		path: "/context",
		tags: ["Communication"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: communicationContextSchema } },
				description: "The applicant's full communication context",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const ctx = await getCommunicationContext(user.id);
		return c.json(ctx);
	},
);

/* GET /me/communication/conversations — list customer-visible conversations. */
meCommunicationRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversations",
		tags: ["Communication"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: chatConversationListSchema } },
				description: "Customer-visible conversations",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const conversations = await listCustomerConversations(user.id);
		return c.json({ conversations, total: conversations.length });
	},
);

/* POST /me/communication/route — route the customer's "Chat" click to the
 * right conversation (stage → case → support), creating idempotently. */
meCommunicationRouter.openapi(
	createRoute({
		method: "post",
		path: "/route",
		tags: ["Communication"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							caseId: z.string().uuid().optional(),
							stageKey: z.string().optional(),
						}),
					},
				},
				required: false,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: chatConversationSchema } },
				description: "The resolved conversation",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json") ?? {};
		// createdBy must be an opsUserId; use the case manager if available,
		// otherwise fall back to a sentinel that findOrCreateConversation will
		// accept. For support conversations the creator is the first staff who
		// replies; here we use the applicant's case manager if known.
		const conv = await routeCustomerChat(user.id, {
			caseId: body.caseId,
			stageKey: body.stageKey,
			createdByOpsUserId: "", // resolved inside the service to the assigned officer
		});
		return c.json(conv);
	},
);

/* GET /me/communication/conversations/:id/messages — paginated. */
meCommunicationRouter.openapi(
	createRoute({
		method: "get",
		path: "/conversations/{id}/messages",
		tags: ["Communication"],
		middleware: [requireAuth] as const,
		request: {
			params: idParams,
			query: z.object({
				limit: z.coerce.number().int().min(1).max(100).optional(),
				before: z.string().uuid().optional(),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: chatMessageListSchema } },
				description: "Paginated messages",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const query = c.req.valid("query");
		const list = await getCustomerMessages(id, user.id, query);
		return c.json(list);
	},
);

/* POST /me/communication/conversations/:id/messages — send. */
meCommunicationRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/messages",
		tags: ["Communication"],
		middleware: [requireAuth] as const,
		request: {
			params: idParams,
			body: { content: { "application/json": { schema: sendContextMessageSchema } }, required: true },
		},
		responses: {
			201: {
				content: { "application/json": { schema: chatMessageSchema } },
				description: "Message sent",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const msg = await sendCustomerMessage(id, user, body.content);
		return c.json(msg, 201);
	},
);

/* POST /me/communication/conversations/:id/read — mark read. */
meCommunicationRouter.openapi(
	createRoute({
		method: "post",
		path: "/conversations/{id}/read",
		tags: ["Communication"],
		middleware: [requireAuth] as const,
		request: { params: idParams },
		responses: { 200: { description: "Marked as read" } },
	}),
	async (c) => {
		const user = c.get("user");
		const { id } = c.req.valid("param");
		await markCustomerRead(id, user.id);
		return c.json({ ok: true });
	},
);

/* ══════════════════════════════════════════════════════════════════════════
 * Staff-facing communication — mounted at /api/v1/communication
 *
 * All staff endpoints require MFA + the `chat` module. Stage-assignment
 * writes additionally require a manager/coordinator/super_admin role.
 * ══════════════════════════════════════════════════════════════════════════ */
export const communicationRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* GET /communication/staff-directory — directory with presence + load. */
communicationRouter.openapi(
	createRoute({
		method: "get",
		path: "/staff-directory",
		tags: ["Communication"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: staffDirectoryDetailedSchema } },
				description: "Staff directory with presence and load",
			},
		},
	}),
	async (c) => {
		const dir = await getStaffDirectoryDetailed();
		return c.json(dir);
	},
);

/* POST /communication/presence — set availability status. */
communicationRouter.openapi(
	createRoute({
		method: "post",
		path: "/presence",
		tags: ["Communication"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
		request: { body: { content: { "application/json": { schema: updatePresenceSchema } }, required: true } },
		responses: { 200: { description: "Presence updated" } },
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		await updatePresence(staff.opsUserId, body.status);
		return c.json({ ok: true });
	},
);

/* POST /communication/heartbeat — lightweight presence ping (60s cadence). */
communicationRouter.openapi(
	createRoute({
		method: "post",
		path: "/heartbeat",
		tags: ["Communication"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
		responses: { 200: { description: "Heartbeat recorded" } },
	}),
	async (c) => {
		const staff = c.get("staff")!;
		await heartbeat(staff.opsUserId);
		return c.json({ ok: true });
	},
);

/* POST /communication/stage-assignments — assign/reassign a stage officer.
 * Manager/coordinator/super_admin only. */
communicationRouter.openapi(
	createRoute({
		method: "post",
		path: "/stage-assignments",
		tags: ["Communication"],
		middleware: [requireAuth, requireMfa, requireModule("chat"), requireRole("manager", "coordinator", "super_admin")] as const,
		request: { body: { content: { "application/json": { schema: createStageAssignmentSchema } }, required: true } },
		responses: {
			201: {
				content: { "application/json": { schema: stageAssignmentSchema } },
				description: "Stage assignment created",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		const assignment = await assignStageOfficer({
			applicationId: body.applicationId,
			stage: body.stage,
			opsUserId: body.opsUserId,
			assignedBy: staff.opsUserId,
			reason: body.reason,
		});
		return c.json(assignment, 201);
	},
);

/* GET /communication/stage-assignments?applicationId= — list assignments. */
communicationRouter.openapi(
	createRoute({
		method: "get",
		path: "/stage-assignments",
		tags: ["Communication"],
		middleware: [requireAuth, requireMfa, requireModule("chat")] as const,
		request: {
			query: z.object({ applicationId: z.string().uuid() }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ assignments: z.array(stageAssignmentSchema) }) } },
				description: "Stage assignments for the case",
			},
		},
	}),
	async (c) => {
		const { applicationId } = c.req.valid("query");
		const assignments = await listStageAssignments(applicationId);
		return c.json({ assignments });
	},
);
