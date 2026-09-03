import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { and, eq, gte, inArray, like, lt, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
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
import { weeklySlotSchedule, type WeeklySlotScheduleDay } from "../services/settings.js";
import { isValidTimeZone, minutesToTime, timeToMinutes } from "../lib/time.js";
import { removeCalendarFeed, renderIcs, type IcsEvent } from "../services/calendar/ics.js";
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

/**
 * 256-bit subscription token (64 hex chars). Unguessable and never derived from
 * a user id or any predictable value — the feed URL is the sole credential for
 * the public outbound route, so it has to be a secret in its own right.
 */
function newSubscriptionToken(): string {
	return randomBytes(32).toString("hex");
}

const subscriptionResponseSchema = z.object({
	/** Absolute, subscribable ICS URL, or null if the staff member has no subscription. */
	url: z.string().url().nullable(),
	createdAt: z.string().datetime().nullable(),
});

/** Return this staff member's outbound subscription, provisioning nothing. */
async function readSubscription(
	opsUserId: string,
): Promise<{ token: string | null; createdAt: Date | null }> {
	const [row] = await db
		.select({ token: staffCalendarFeeds.outboundToken, createdAt: staffCalendarFeeds.createdAt })
		.from(staffCalendarFeeds)
		.where(eq(staffCalendarFeeds.opsUserId, opsUserId))
		.limit(1);
	return { token: row?.token ?? null, createdAt: row?.createdAt ?? null };
}

/**
 * Return the existing token, or create one if none exists. Never rotates an
 * existing token — that is `regenerateSubscription`. `onConflictDoNothing`
 * handles the race where two requests provision the same staff member at once.
 */
async function getOrCreateSubscription(
	opsUserId: string,
): Promise<{ token: string; createdAt: Date }> {
	const existing = await readSubscription(opsUserId);
	if (existing.token) return { token: existing.token, createdAt: existing.createdAt! };

	const token = newSubscriptionToken();
	const [row] = await db
		.insert(staffCalendarFeeds)
		.values({ opsUserId, icsUrlEncrypted: null, outboundToken: token })
		.onConflictDoNothing({ target: staffCalendarFeeds.opsUserId })
		.returning({ token: staffCalendarFeeds.outboundToken, createdAt: staffCalendarFeeds.createdAt });
	if (row?.token) return { token: row.token, createdAt: row.createdAt };

	// Lost the race — another request created the row first. Read its token.
	const reread = await readSubscription(opsUserId);
	return { token: reread.token!, createdAt: reread.createdAt! };
}

/** Mint a fresh token, invalidating the previous URL immediately. */
async function regenerateSubscription(
	opsUserId: string,
): Promise<{ token: string; createdAt: Date }> {
	const token = newSubscriptionToken();
	const [row] = await db
		.insert(staffCalendarFeeds)
		.values({ opsUserId, icsUrlEncrypted: null, outboundToken: token })
		.onConflictDoUpdate({
			target: staffCalendarFeeds.opsUserId,
			set: { outboundToken: token, updatedAt: new Date() },
		})
		.returning({ token: staffCalendarFeeds.outboundToken, createdAt: staffCalendarFeeds.createdAt });
	return { token: row.token!, createdAt: row.createdAt };
}

/** Revoke the outbound URL. Keeps the inbound mirror if one exists. */
async function revokeSubscription(opsUserId: string): Promise<void> {
	const [feed] = await db
		.select({ icsUrlEncrypted: staffCalendarFeeds.icsUrlEncrypted })
		.from(staffCalendarFeeds)
		.where(eq(staffCalendarFeeds.opsUserId, opsUserId))
		.limit(1);
	if (!feed) return;
	if (feed.icsUrlEncrypted) {
		await db
			.update(staffCalendarFeeds)
			.set({ outboundToken: null, updatedAt: new Date() })
			.where(eq(staffCalendarFeeds.opsUserId, opsUserId));
	} else {
		await db.delete(staffCalendarFeeds).where(eq(staffCalendarFeeds.opsUserId, opsUserId));
	}
}

/* ── GET /api/v1/calendar/feeds/me ─────────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "get",
		path: "/feeds/me",
		tags: ["Calendar"],
		summary: "My calendar feed status",
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "customer_service", "consultant")] as const,
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
				hasFeed: Boolean(feed?.icsUrlEncrypted),
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
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "customer_service", "consultant")] as const,
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
		const token = newSubscriptionToken();
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
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "customer_service", "consultant")] as const,
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
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "customer_service", "consultant")] as const,
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
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "customer_service", "consultant")] as const,
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
		middleware: [requireAuth, requireMfa, requireRole("super_admin", "admin", "manager", "coordinator", "customer_service", "consultant")] as const,
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

/* ── GET /api/v1/calendar/branch-slots ─────────────────────────────────────────
 * Read-only branch slot template. Every staff member sees it on their own
 * availability page so consultants understand which slots the portal will offer.
 * Only managers/systems/super admins can change it via /api/v1/scheduling.
 */

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const branchSlotsResponseSchema = z.object({
	timezone: z.string(),
	days: z.array(
		z.object({
			dayOfWeek: z.number().int(),
			enabled: z.boolean(),
			openStart: z.string(),
			openEnd: z.string(),
			intervalMinutes: z.number().int(),
			times: z.array(timeStringSchema),
		}),
	),
});

function computeSlotTimes(openStart: string, openEnd: string, intervalMinutes: number): string[] {
	const startMin = timeToMinutes(openStart);
	const endMin = timeToMinutes(openEnd);
	if (endMin <= startMin || intervalMinutes <= 0) return [];
	const times: string[] = [];
	for (let t = startMin; t < endMin; t += intervalMinutes) {
		times.push(minutesToTime(t));
	}
	return times;
}

function dayResponse(day: WeeklySlotScheduleDay) {
	return {
		dayOfWeek: day.dayOfWeek,
		enabled: day.enabled,
		openStart: day.openStart,
		openEnd: day.openEnd,
		intervalMinutes: day.intervalMinutes,
		times: day.enabled ? computeSlotTimes(day.openStart, day.openEnd, day.intervalMinutes) : [],
	};
}

calendarFeedsRouter.openapi(
	createRoute({
		method: "get",
		path: "/branch-slots",
		tags: ["Calendar"],
		summary: "Branch consultation slot template",
		description:
			"The branch-wide slot configuration that drives the portal booking grid. " +
			"Consultants see this read-only; only scheduling-authorized roles can edit it.",
		middleware: [
			requireAuth,
			requireMfa,
			requireRole("super_admin", "admin", "manager", "coordinator", "customer_service", "consultant"),
		] as const,
		responses: {
			200: {
				content: { "application/json": { schema: branchSlotsResponseSchema } },
				description: "Branch slot template",
			},
		},
	}),
	async (c) => {
		const schedule = await weeklySlotSchedule();
		return c.json(
			{
				timezone: schedule.timezone,
				days: schedule.days.map((d) => dayResponse(d)),
			},
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
		// Include recently-cancelled bookings so subscribers see STATUS:CANCELLED and
		// remove the event instead of keeping a stale copy — Google Calendar in
		// particular never drops an event that merely vanishes from a feed.
		const cancelCutoff = new Date(from.getTime() - 30 * 24 * 60 * 60 * 1000);
		const rows = await db
			.select({
				reference: bookings.reference,
				serviceName: bookings.serviceName,
				clientName: bookings.clientName,
				startsAt: bookings.startsAt,
				endsAt: bookings.endsAt,
				status: bookings.status,
				meetingUrl: bookings.meetingUrl,
				notes: bookings.notes,
				cancelledAt: bookings.cancelledAt,
				updatedAt: bookings.updatedAt,
				createdAt: bookings.createdAt,
			})
			.from(bookings)
			.where(
				and(
					eq(bookings.employeeId, feed.opsUserId),
					or(
						and(
							inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
							gte(bookings.startsAt, from),
							lt(bookings.startsAt, to),
						),
						and(eq(bookings.status, "CANCELLED"), gte(bookings.cancelledAt, cancelCutoff)),
					),
				),
			)
			.orderBy(bookings.startsAt);

		const events: IcsEvent[] = rows.map((r) => {
			const cancelled = r.status === "CANCELLED";
			return {
				uid: `century-nit-${r.reference}@century-nit`,
				summary: `${r.serviceName} · ${r.clientName}`,
				description: `Century NIT consultation. Ref: ${r.reference}. Client: ${r.clientName}.`,
				location: r.meetingUrl ?? null,
				startsAt: r.startsAt,
				endsAt: r.endsAt,
				status: cancelled ? "CANCELLED" : "CONFIRMED",
				lastModified: cancelled
					? (r.cancelledAt ?? r.updatedAt ?? r.createdAt)
					: (r.updatedAt ?? r.createdAt),
			};
		});

		const ics = renderIcs(events, feed.label ? `${feed.label} · Century NIT` : "Century NIT");
		return c.body(ics, 200, {
			"content-type": "text/calendar; charset=utf-8",
			"content-disposition": 'inline; filename="century-nit.ics"',
			"cache-control": "public, max-age=300",
		});
	},
);

/* ── Outbound subscription management ──────────────────────────────────────────
 * The company calendar is the source of truth; a staff member's personalized
 * iCal URL is a one-way, read-only mirror of it into their own calendar app.
 * Each staff member gets an independent, revocable token — independent of the
 * inbound mirror — and may regenerate it at any time to invalidate a leaked URL.
 * ─────────────────────────────────────────────────────────────────────────── */

const SUBSCRIPTION_ROLES = ["super_admin", "admin", "manager", "coordinator", "customer_service", "consultant"] as const;

/* ── GET /api/v1/calendar/subscription ─────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "get",
		path: "/subscription",
		tags: ["Calendar"],
		summary: "My calendar subscription URL",
		description:
			"Returns the staff member's personalized read-only iCal subscription URL (their Century " +
			"NIT bookings, subscribable by any calendar app). Does not provision a token — use " +
			"POST /calendar/subscription to create one.",
		middleware: [requireAuth, requireMfa, requireRole(...SUBSCRIPTION_ROLES)] as const,
		responses: {
			200: { content: { "application/json": { schema: subscriptionResponseSchema } }, description: "Subscription URL (null if none)" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const sub = await readSubscription(staff.opsUserId);
		return c.json(
			{ url: outboundUrl(c, sub.token), createdAt: sub.createdAt?.toISOString() ?? null },
			200,
		);
	},
);

/* ── POST /api/v1/calendar/subscription ────────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "post",
		path: "/subscription",
		tags: ["Calendar"],
		summary: "Create my calendar subscription (idempotent)",
		description:
			"Provisions a personalized iCal URL if none exists and returns it. Calling again returns " +
			"the same URL — it never rotates. Use POST /calendar/subscription/regenerate to invalidate " +
			"and replace it.",
		middleware: [requireAuth, requireMfa, requireRole(...SUBSCRIPTION_ROLES)] as const,
		responses: {
			200: { content: { "application/json": { schema: subscriptionResponseSchema } }, description: "Subscription URL" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const sub = await getOrCreateSubscription(staff.opsUserId);
		return c.json({ url: outboundUrl(c, sub.token), createdAt: sub.createdAt.toISOString() }, 200);
	},
);

/* ── POST /api/v1/calendar/subscription/regenerate ──────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "post",
		path: "/subscription/regenerate",
		tags: ["Calendar"],
		summary: "Regenerate my calendar subscription URL",
		description:
			"Mints a fresh token, immediately invalidating the previous URL. Use after a link may " +
			"have been exposed. Existing subscriptions stop receiving updates until the owner " +
			"re-subscribes with the new URL.",
		middleware: [requireAuth, requireMfa, requireRole(...SUBSCRIPTION_ROLES)] as const,
		responses: {
			200: { content: { "application/json": { schema: subscriptionResponseSchema } }, description: "New subscription URL" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const sub = await regenerateSubscription(staff.opsUserId);
		return c.json({ url: outboundUrl(c, sub.token), createdAt: sub.createdAt.toISOString() }, 200);
	},
);

/* ── DELETE /api/v1/calendar/subscription ──────────────────────────────────── */

calendarFeedsRouter.openapi(
	createRoute({
		method: "delete",
		path: "/subscription",
		tags: ["Calendar"],
		summary: "Revoke my calendar subscription URL",
		description:
			"Invalidates the personalized iCal URL. The inbound mirror (external meetings blocking " +
			"slots), if any, is untouched.",
		middleware: [requireAuth, requireMfa, requireRole(...SUBSCRIPTION_ROLES)] as const,
		responses: {
			204: { description: "Subscription revoked" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		await revokeSubscription(staff.opsUserId);
		return c.body(null, 204);
	},
);
