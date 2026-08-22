import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { and, eq, gte, inArray, like, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db/index.js";
import { bookings, calendarBusyBlocks, staffCalendarFeeds } from "../db/schema.js";
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
import { removeCalendarFeed, renderBookingsIcs } from "../services/calendar/ics.js";
import { queueFeedSync } from "../worker/queues.js";
import {
	API_PREFIX,
	ACTIVE_BOOKING_STATUSES,
	updateWorkingHoursSchema,
	workingHoursResponseSchema,
} from "century-nit-shared";

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
	/** Absolute URL of this consultant's outbound read-only ICS subscription. */
	outboundUrl: z.string().url().nullable(),
});

/**
 * Build the subscribable outbound ICS URL for a feed token, anchored to the
 * host that served this request (the API's own public origin).
 */
function outboundUrl(c: { req: { url: string } }, token: string | null): string | null {
	if (!token) return null;
	const origin = new URL(c.req.url).origin;
	return `${origin}${API_PREFIX}/calendar/feeds/outbound/${token}`;
}

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
				outboundUrl: outboundUrl(c, feed?.outboundToken ?? null),
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
		const token = randomUUID();
		await db
			.insert(staffCalendarFeeds)
			.values({
				opsUserId: staff.opsUserId,
				icsUrlEncrypted: encrypted,
				label: body.label ?? null,
				outboundToken: token,
			})
			.onConflictDoUpdate({
				target: staffCalendarFeeds.opsUserId,
				// NOTE: outboundToken is intentionally NOT overwritten on replace —
				// the consultant has already subscribed to it; regenerating would
				// silently break their existing calendar subscription.
				set: { icsUrlEncrypted: encrypted, label: body.label ?? null, updatedAt: new Date() },
			});

		// Fetch once now so the consultant sees blocks without waiting up to 3 min.
		// Run on the worker so a slow/bad URL never blocks the request.
		await ensureDefaultWorkingHours(staff.opsUserId);
		await queueFeedSync();

		// Return the (possibly pre-existing) token's outbound URL so the consultant
		// can subscribe their personal calendar to their Century NIT bookings.
		const [feed] = await db
			.select({ outboundToken: staffCalendarFeeds.outboundToken })
			.from(staffCalendarFeeds)
			.where(eq(staffCalendarFeeds.opsUserId, staff.opsUserId))
			.limit(1);

		return c.json(
			{
				hasFeed: true,
				label: body.label ?? null,
				lastSyncedAt: null,
				lastError: null,
				busyBlocksCount: 0,
				outboundUrl: outboundUrl(c, feed?.outboundToken ?? null),
			},
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

/* ── GET /api/v1/calendar/feeds/outbound/{token} ─────────────────────────────
 * Public (no auth) — the token in the URL is the sole credential. Lets a
 * consultant subscribe their personal calendar to their own Century NIT
 * bookings, so the two-way mirror is complete: external events block portal
 * slots (inbound), and portal bookings block their personal calendar (outbound).
 * ─────────────────────────────────────────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "get",
		path: "/feeds/outbound/{token}",
		tags: ["Calendar"],
		summary: "Subscribe to a consultant's Century NIT bookings (read-only ICS, public)",
		description:
			"Returns upcoming confirmed/assigned consultations for the token owner as an ICS " +
			"calendar subscription. No authentication — the unguessable token is the credential. " +
			"Calendar apps subscribe by pointing at this URL.",
		request: { params: z.object({ token: z.string().min(1) }) },
		responses: {
			200: { content: { "text/calendar": { schema: z.string() } }, description: "ICS subscription" },
			404: { description: "Unknown token" },
		},
	}),
	async (c) => {
		const { token } = c.req.valid("param");
		const [feed] = await db
			.select({ opsUserId: staffCalendarFeeds.opsUserId, label: staffCalendarFeeds.label })
			.from(staffCalendarFeeds)
			.where(eq(staffCalendarFeeds.outboundToken, token))
			.limit(1);
		if (!feed) return c.body(null, 404);

		const from = new Date();
		const to = new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000);
		const rows = await db
			.select({
				reference: bookings.reference,
				serviceName: bookings.serviceName,
				clientName: bookings.clientName,
				startsAt: bookings.startsAt,
				endsAt: bookings.endsAt,
			})
			.from(bookings)
			.where(
				and(
					eq(bookings.employeeId, feed.opsUserId),
					inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
					gte(bookings.startsAt, from),
					lt(bookings.startsAt, to),
				),
			)
			.orderBy(bookings.startsAt);

		const ics = renderBookingsIcs(rows, feed.label ? `${feed.label} · Century NIT` : "Century NIT");
		return c.body(ics, 200, {
			"content-type": "text/calendar; charset=utf-8",
			"content-disposition": 'inline; filename="century-nit.ics"',
			"cache-control": "public, max-age=300",
		});
	},
);
