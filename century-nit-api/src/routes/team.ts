import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { requireAuth, requireMfa, requireModule, type AuthVariables } from "../middleware/auth.js";
import { getTeamAssignments } from "../services/team.js";

const teamAssignmentSchema = z.object({
	id: z.string().uuid(),
	type: z.enum(["case", "consultation"]),
	reference: z.string(),
	clientName: z.string(),
	clientEmail: z.string().nullable(),
	assignedStaffId: z.string().uuid().nullable(),
	assignedStaffName: z.string().nullable(),
	assignedStaffEmail: z.string().email().nullable(),
	stageOrStatus: z.string(),
	stageOrStatusLabel: z.string(),
	priority: z.string().nullable(),
	updatedAt: z.string().datetime(),
	link: z.string(),
});

const teamAssignmentsSchema = z.object({
	items: z.array(teamAssignmentSchema),
});

export const teamRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/* ── GET /api/v1/team/assignments ────────────────────────────────────────── */

teamRouter.openapi(
	createRoute({
		method: "get",
		path: "/assignments",
		tags: ["Team"],
		middleware: [requireAuth, requireMfa, requireModule("reports")] as const,
		request: {
			query: z.object({
				limit: z.coerce.number().min(1).max(500).optional().default(200),
			}),
		},
		responses: {
			200: {
				content: { "application/json": { schema: teamAssignmentsSchema } },
				description: "Combined list of team assignments",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const { limit } = c.req.valid("query");
		const items = await getTeamAssignments(staff, limit);
		return c.json({ items });
	},
);
