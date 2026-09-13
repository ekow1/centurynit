import { OpenAPIHono, createRoute } from "@hono/zod-openapi";




















































































import {





































	deferStageHandoffSchema,
	stageHandoffListSchema,
	stageHandoffSchema,
	listStageHandoffsQuerySchema,
	resolveStageHandoffSchema,









} from "century-nit-shared";
import {
	deferStageHandoff,
	getStageHandoff,
	listStageHandoffs,
	resolveStageHandoff,


} from "../services/handoffs.js";









import {
	requireAuth,
	requireMfa,
	requireModule,

	type AuthVariables,
	requireCapability,
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
import { idParams, actorFrom } from "./caseShared.js";

/**
 * Stage handoffs — the assignment decision queue. Registered on the
 * applications router (the paths live under /applications/handoffs) and
 * before its `/{id}` routes, which would otherwise answer these first.
 */
export function registerHandoffRoutes(router: OpenAPIHono<{ Variables: AuthVariables }>): void {
	/* ── Stage handoffs (assignment decision queue) ──────────────────────────── */

	router.openapi(
		createRoute({
			method: "get",
			path: "/handoffs",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("assign_work")] as const,
			request: {
				query: listStageHandoffsQuerySchema,
			},
			responses: {
				200: {
					content: { "application/json": { schema: stageHandoffListSchema } },
					description: "Stage handoffs (assignment decisions) awaiting resolution",
				},
			},
		}),
		async (c) => {
			const handoffs = await listStageHandoffs(c.req.valid("query"));
			return c.json({ handoffs, total: handoffs.length });
		},
	);

	router.openapi(
		createRoute({
			method: "get",
			path: "/handoffs/{id}",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("assign_work")] as const,
			request: { params: idParams },
			responses: {
				200: {
					content: { "application/json": { schema: stageHandoffSchema } },
					description: "Single stage handoff",
				},
			},
		}),
		async (c) => c.json(await getStageHandoff(c.req.valid("param").id)),
	);

	router.openapi(
		createRoute({
			method: "post",
			path: "/handoffs/{id}/resolve",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("assign_work")] as const,
			request: {
				params: idParams,
				body: { content: { "application/json": { schema: resolveStageHandoffSchema } }, required: true },
			},
			responses: {
				200: {
					content: { "application/json": { schema: stageHandoffSchema } },
					description: "Handoff resolved — stage assignment written, stage activated",
				},
			},
		}),
		async (c) => {
			const body = c.req.valid("json");
			return c.json(
				await resolveStageHandoff({
					handoffId: c.req.valid("param").id,
					decision: body.decision,
					opsUserId: body.opsUserId,
					reason: body.reason,
					actor: actorFrom(c.get("staff")!),
				}),
			);
		},
	);

	router.openapi(
		createRoute({
			method: "post",
			path: "/handoffs/{id}/defer",
			tags: ["Applications"],
			middleware: [requireAuth, requireMfa, requireModule("applications"), requireCapability("assign_work")] as const,
			request: {
				params: idParams,
				body: { content: { "application/json": { schema: deferStageHandoffSchema } }, required: true },
			},
			responses: {
				200: {
					content: { "application/json": { schema: stageHandoffSchema } },
					description: "Handoff deferred — still pending, managers re-alerted",
				},
			},
		}),
		async (c) => {
			const body = c.req.valid("json");
			return c.json(
				await deferStageHandoff({
					handoffId: c.req.valid("param").id,
					reason: body.reason,
					actor: actorFrom(c.get("staff")!),
				}),
			);
		},
	);


}
