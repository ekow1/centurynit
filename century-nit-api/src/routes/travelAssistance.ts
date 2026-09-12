import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";















































import {

	getForApplicationWithContext as getTravelAssistanceForApplicationOps,
	listForOps as listTravelAssistanceForOps,

	raiseTicketInvoice as raiseTravelTicketInvoice,
	recordBooking as recordTravelBooking,
	assignHandler as assignTravelHandler,
	applicationIdOfTravelRequest,
} from "../services/travelAssistance.js";


























import {










































	travelAssistanceRequestSchema,

	travelAssistanceBookingInputSchema,
	travelAssistanceInvoiceInputSchema,





} from "century-nit-shared";















import { checkRolePermission } from "../services/roles.js";

import {
	requireAuth,
	requireMfa,
	requireModule,
	requireRole,
	type AuthVariables,

} from "../middleware/auth.js";




/**
 * Notification `type` values addressed only to staff (managers, coordinators,
 * consultants, officers). They never belong in the client portal, so the
 * `/me/notifications` read excludes them — a staff member who also has a client
 * profile (dual-role account) must not see "New lead received", "consultation
 * assigned", etc. on the user end.
 *
 * `chat.message` is staff-to-staff chat — the applicant-facing equivalent is
 * `chat.reply`, which is intentionally NOT listed here so applicants still see
 * their own consultant replies.
 */
import { idParams, assertApplicationAccess, actorFrom } from "./caseShared.js";

/**
 * The travel queue (GET /applications/travel-assistance). A static path, so
 * it is registered before the applications router's `/{id}`.
 */
export function registerTravelQueueRoute(router: OpenAPIHono<{ Variables: AuthVariables }>): void {
	// Static paths must be registered before `/{id}`: the id route validates its
	// param as a uuid, so a later `/travel-assistance` would be answered 400 by
	// it first (`/handoffs` above only works because it comes first).
	router.openapi(
		createRoute({
			method: "get",
			path: "/travel-assistance",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
			request: {},
			responses: {
				200: {
					content: { "application/json": { schema: z.array(travelAssistanceRequestSchema) } },
					description: "Travel assistance queue",
				},
			},
		}),
		async (c) => {
			const list = await listTravelAssistanceForOps();
			return c.json(list);
		},
	);


}

/** The per-request travel routes: assign, invoice, booking. */
export function registerTravelRoutes(router: OpenAPIHono<{ Variables: AuthVariables }>): void {
	/* ── Travel Assistance (Ops side, direct-invoice) ─────────────────────────── */

	router.openapi(
		createRoute({
			method: "get",
			path: "/{id}/travel-assistance",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
			request: { params: idParams },
			responses: {
				200: {
					content: { "application/json": { schema: travelAssistanceRequestSchema.nullable() } },
					description: "The travel assistance request for this application",
				},
			},
		}),
		async (c) => {
			await assertApplicationAccess(c, c.req.valid("param").id);
			const { id } = c.req.valid("param");
			const req = await getTravelAssistanceForApplicationOps(id);
			return c.json(req);
		},
	);

	router.openapi(
		createRoute({
			method: "post",
			path: "/travel-assistance/{id}/assign",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications"), requireRole("manager", "coordinator", "admin", "super_admin")] as const,
			request: {
				params: idParams,
				body: {
					content: {
						"application/json": {
							schema: z.object({ opsUserId: z.string().uuid() }),
						},
					},
					required: true,
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: travelAssistanceRequestSchema } },
					description: "Handler assigned to the travel assistance request",
				},
			},
		}),
		async (c) => {
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			const staff = c.get("staff")!;
			const updated = await assignTravelHandler({
				requestId: id,
				opsUserId: body.opsUserId,
				actor: actorFrom(staff),
			});
			return c.json(updated);
		},
	);

	router.openapi(
		createRoute({
			method: "post",
			path: "/travel-assistance/{id}/invoice",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
			request: {
				params: idParams,
				body: {
					content: {
						"application/json": {
							schema: travelAssistanceInvoiceInputSchema,
						},
					},
					required: true,
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: travelAssistanceRequestSchema } },
					description: "Ticket invoice raised",
				},
			},
		}),
		async (c) => {
			await assertApplicationAccess(c, await applicationIdOfTravelRequest(c.req.valid("param").id));
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			const staff = c.get("staff")!;
			// Raising is handler work; issuing — what lets the applicant pay — needs
			// the invoices module, the same split as the application invoice. A
			// handler who holds both does it in one step.
			const updated = await raiseTravelTicketInvoice({
				requestId: id,
				fareCents: body.fareCents,
				flight: body.flight,
				issueNow: await checkRolePermission(staff.role, "invoices"),
				actor: actorFrom(staff),
			});
			return c.json(updated);
		},
	);


	router.openapi(
		createRoute({
			method: "post",
			path: "/travel-assistance/{id}/booking",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
			request: {
				params: idParams,
				body: {
					content: { "application/json": { schema: travelAssistanceBookingInputSchema } },
					required: true,
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: travelAssistanceRequestSchema } },
					description: "Booking confirmation recorded",
				},
			},
		}),
		async (c) => {
			await assertApplicationAccess(c, await applicationIdOfTravelRequest(c.req.valid("param").id));
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			const staff = c.get("staff")!;
			const updated = await recordTravelBooking({
				requestId: id,
				booking: body,
				actor: actorFrom(staff),
			});
			return c.json(updated);
		},
	);



}
