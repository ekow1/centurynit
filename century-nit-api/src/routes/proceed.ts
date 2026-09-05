import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	proceedApplicationSchema,
	declineProceedSchema,
	proceedQuotationSchema,
	acceptProceedResponseSchema,
} from "century-nit-shared";
import {
	requireAuth,
	requireMfa,
	requireModule,
	type AuthVariables,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
	getApplicantByUserId,
	latestApplicationForApplicant,
	acceptProceedForApplication,
	declineProceedForApplication,
	reinviteProceedForApplication,
	quotationForApplication,
} from "../services/cases.js";

/**
 * Consent gate ("start your application?") — self-service for the portal and
 * override endpoints for ops. Kept in its own file so it mounts independently
 * of the larger case router tree.
 *
 * Mounted:
 *   - self-service  at /api/v1/me/application
 *   - ops overrides at /api/v1/cases
 */
export const meProceedRouter = new OpenAPIHono<{ Variables: AuthVariables }>();
export const opsProceedRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const applicationParams = z.object({ id: z.string().uuid() });

async function applicantApplicationFor(
	c: Parameters<Parameters<typeof meProceedRouter.openapi>[1]>[0],
): Promise<string> {
	const user = c.get("user")!;
	const applicant = await getApplicantByUserId(user.id);
	if (!applicant) {
		throw new HttpError(404, "APPLICANT_NOT_FOUND", "No applicant record found for this user");
	}
	const app = await latestApplicationForApplicant(applicant.id);
	if (!app) {
		throw new HttpError(404, "APPLICATION_NOT_FOUND", "No application found. Complete your assessment first.");
	}
	return app.id;
}

/* ── GET /api/v1/me/application/quotation ─────────────────────────────────── */

meProceedRouter.openapi(
	createRoute({
		method: "get",
		path: "/quotation",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: proceedQuotationSchema } },
				description:
					"Advisory price estimate from the current draft school selection (not an invoice)",
			},
		},
	}),
	async (c) => {
		const applicationId = await applicantApplicationFor(c);
		return c.json(await quotationForApplication(applicationId));
	},
);

/* ── POST /api/v1/me/application/proceed ──────────────────────────────────── */

meProceedRouter.openapi(
	createRoute({
		method: "post",
		path: "/proceed",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: proceedApplicationSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: acceptProceedResponseSchema } },
				description: "Applicant accepted to start the application",
			},
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const applicationId = await applicantApplicationFor(c);
		const body = c.req.valid("json");
		const result = await acceptProceedForApplication({
			applicationId,
			fundingTrack: body.fundingTrack,
			degreeLevel: body.degreeLevel,
			country: body.country,
			actor: { name: user.name ?? user.email },
		});
		return c.json(result);
	},
);

/* ── POST /api/v1/me/application/proceed/decline ──────────────────────────── */

meProceedRouter.openapi(
	createRoute({
		method: "post",
		path: "/proceed/decline",
		tags: ["Applicants"],
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: declineProceedSchema } },
				required: true,
			},
		},
		responses: {
			200: { description: "Applicant declined to proceed" },
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const applicationId = await applicantApplicationFor(c);
		const body = c.req.valid("json");
		await declineProceedForApplication({
			applicationId,
			reason: body.reason,
			actor: { name: user.name ?? user.email },
		});
		return c.json({ ok: true });
	},
);

/* ── POST /api/v1/cases/:id/proceed (ops override on the applicant's behalf) ─ */

opsProceedRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/proceed",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: applicationParams,
			body: {
				content: {
					"application/json": {
						schema: z.object({
							fundingTrack: z.string().min(1).max(64).nullable().optional(),
							degreeLevel: z.string().min(1).max(64).optional(),
							country: z.string().min(1).max(80).optional(),
						}),
					},
				},
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: acceptProceedResponseSchema } },
				description: "Ops recorded the applicant's consent to proceed",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await acceptProceedForApplication({
			applicationId: id,
			fundingTrack: body.fundingTrack,
			degreeLevel: body.degreeLevel,
			country: body.country,
			actor: { opsUserId: staff.opsUserId, name: staff.name },
		});
		return c.json(result);
	},
);

/* ── POST /api/v1/cases/:id/proceed/decline (ops records a phone decline) ─── */

opsProceedRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/proceed/decline",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: applicationParams,
			body: {
				content: { "application/json": { schema: declineProceedSchema } },
				required: true,
			},
		},
		responses: {
			200: { description: "Ops recorded the applicant's decline" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		await declineProceedForApplication({
			applicationId: id,
			reason: body.reason,
			actor: { opsUserId: staff.opsUserId, name: staff.name },
		});
		return c.json({ ok: true });
	},
);

/* ── POST /api/v1/cases/:id/proceed/reinvite (reopens a declined gate) ────── */

opsProceedRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/proceed/reinvite",
		tags: ["Applications"],
		middleware: [requireAuth, requireMfa, requireModule("applications")] as const,
		request: {
			params: applicationParams,
		},
		responses: {
			200: { description: "Declined application re-invited back to the consent gate" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { id } = c.req.valid("param");
		await reinviteProceedForApplication({ applicationId: id, actor: { opsUserId: staff.opsUserId, name: staff.name } });
		return c.json({ ok: true });
	},
);