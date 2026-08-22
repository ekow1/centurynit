import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { and, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { calendarBusyBlocks, staffCalendarFeeds } from "../db/schema.js";
import { encrypt } from "../lib/crypto.js";
import {
	requireAuth,
	requireMfa,
	requireRole,
	type AuthVariables,
} from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
	ensureDefaultWorkingHours,
	listWorkingHours,
	setWorkingHours,
} from "../services/availability.js";
import { isValidTimeZone } from "../lib/time.js";
import { removeCalendarFeed } from "../services/calendar/ics.js";
import { queueFeedSync } from "../worker/queues.js";
import { updateWorkingHoursSchema, workingHoursResponseSchema } from "century-nit-shared";

/**
 * Calendar feeds — the iCal/ICS mirror that replaced Google Calendar.
 *
 * Self-service: each staff member pastes their own calendar's read-only secret
 * iCal address. The URL is encrypted at rest and never returned on read. A
 * worker pulls the busy windows into `calendar_busy_blocks`; availability
 * subtracts them, so an external meeting blocks the portal slot.
 */

export const calendarFeedsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const feedResponseSchema = z.object({
	hasFeed: z.boolean(),
	label: z.string().nullable(),
	lastSyncedAt: z.string().datetime().nullable(),
	lastError: z.string().nullable(),
	busyBlocksCount: z.number().int(),
});

const upsertFeedSchema = z.object({
	icsUrl: z
		.string()
		.min(1, "Paste your calendar's secret iCal address")
		.refine((v) => v.startsWith("https://") || v.startsWith("webcal://"), {
			message: "The calendar link must start with https:// or webcal://",
		}),
	label: z.string().max(120).optional(),
});

function toHttps(url: string): string {
	return url.startsWith("webcal://") ? "https://" + url.slice("webcal://".length) : url;
}

/* ── GET /api/v1/calendar/feeds/me ─────────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "get",
		path: "/feeds/me",
		tags: ["Calendar"],
		summary: "My calendar feed status",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "consultant")] as const,
		responses: {
			200: { content: { "application/json": { schema: feedResponseSchema } }, description: "Feed status (URL never returned)" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const [feed] = await db
			.select()
			.from(staffCalendarFeeds)
			.where(eq(staffCalendarFeeds.opsUserId, staff.opsUserId))
			.limit(1);

		const [countRow] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(calendarBusyBlocks)
			.where(
				and(
					eq(calendarBusyBlocks.opsUserId, staff.opsUserId),
					like(calendarBusyBlocks.externalEventId, "ics:%"),
				),
			);

		return c.json(
			{
				hasFeed: !!feed,
				label: feed?.label ?? null,
				lastSyncedAt: feed?.lastSyncedAt?.toISOString() ?? null,
				lastError: feed?.lastError ?? null,
				busyBlocksCount: countRow?.count ?? 0,
			},
			200,
		);
	},
);

/* ── PUT /api/v1/calendar/feeds/me ────────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "put",
		path: "/feeds/me",
		tags: ["Calendar"],
		summary: "Add or replace my calendar feed",
		description:
			"Paste a calendar's read-only secret iCal/ICS address (Google \"Secret address in iCal format\", " +
			"Outlook/Apple \"publish calendar\" .ics link). The URL is encrypted and never returned. " +
			"Replaces any existing feed for this staff member and mirrors it immediately.",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "consultant")] as const,
		request: {
			body: { content: { "application/json": { schema: upsertFeedSchema } }, required: true },
		},
		responses: {
			200: { content: { "application/json": { schema: feedResponseSchema } }, description: "Feed saved and syncing" },
			400: { description: "Invalid URL" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		const url = toHttps(body.icsUrl);

		const encrypted = encrypt(url);
		await db
			.insert(staffCalendarFeeds)
			.values({
				opsUserId: staff.opsUserId,
				icsUrlEncrypted: encrypted,
				label: body.label ?? null,
			})
			.onConflictDoUpdate({
				target: staffCalendarFeeds.opsUserId,
				set: { icsUrlEncrypted: encrypted, label: body.label ?? null, updatedAt: new Date() },
			});

		// Fetch once now so the consultant sees blocks without waiting up to 3 min.
		// Run on the worker so a slow/bad URL never blocks the request.
		await ensureDefaultWorkingHours(staff.opsUserId);
		await queueFeedSync();

		return c.json(
			{ hasFeed: true, label: body.label ?? null, lastSyncedAt: null, lastError: null, busyBlocksCount: 0 },
			200,
		);
	},
);

/* ── DELETE /api/v1/calendar/feeds/me ──────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "delete",
		path: "/feeds/me",
		tags: ["Calendar"],
		summary: "Remove my calendar feed",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "consultant")] as const,
		responses: {
			204: { description: "Feed and mirrored busy blocks removed" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		await removeCalendarFeed(staff.opsUserId);
		return c.body(null, 204);
	},
);

/* ── POST /api/v1/calendar/feeds/sync ──────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "post",
		path: "/feeds/sync",
		tags: ["Calendar"],
		summary: "Mirror all calendar feeds now",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "consultant")] as const,
		responses: {
			202: { description: "Sync queued" },
		},
	}),
	async (c) => {
		await queueFeedSync();
		return c.body(null, 202);
	},
);

/* ── GET /api/v1/calendar/working-hours ────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "get",
		path: "/working-hours",
		tags: ["Calendar"],
		summary: "My weekly working hours",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "consultant")] as const,
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ workingHours: workingHoursResponseSchema.shape.workingHours }) } },
				description: "Working hours",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		return c.json({ workingHours: await listWorkingHours(staff.opsUserId) }, 200);
	},
);

/* ── PUT /api/v1/calendar/working-hours ────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "put",
		path: "/working-hours",
		tags: ["Calendar"],
		summary: "Replace my weekly working hours",
		description:
			"The complete weekly set — omit a day to mark it non-working. The target is the session " +
			"staff member; there is no id to pass, and none is accepted. Narrowing hours never cancels " +
			"existing bookings; the count now outside the new hours is returned.",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "consultant")] as const,
		request: {
			body: { content: { "application/json": { schema: updateWorkingHoursSchema } }, required: true },
		},
		responses: {
			200: {
				content: { "application/json": { schema: workingHoursResponseSchema } },
				description: "Updated working hours",
			},
			400: { description: "Unknown timezone" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		if (!isValidTimeZone(body.timezone)) {
			throw new HttpError(400, "VALIDATION_ERROR", `Unknown timezone: ${body.timezone}`);
		}
		const conflictingBookings = await setWorkingHours(staff.opsUserId, body);
		return c.json(
			{ workingHours: await listWorkingHours(staff.opsUserId), conflictingBookings },
			200,
		);
	},
);
