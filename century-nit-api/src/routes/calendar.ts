import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "../db/index.js";
import { staffCalendarAccounts } from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { requireAuth, requireStaff, type AuthVariables } from "../middleware/auth.js";
import { encrypt } from "../lib/crypto.js";
import {
	buildConsentUrl,
	createOAuthClient,
	googleConfigured,
	GOOGLE_SCOPES,
} from "../services/calendar/index.js";
import {
	ensureDefaultWorkingHours,
	listWorkingHours,
	setWorkingHours,
} from "../services/availability.js";
import { isValidTimeZone } from "../lib/time.js";
import { updateWorkingHoursSchema, workingHoursResponseSchema } from "century-nit-shared";
import { queuePendingCalendarSyncs } from "../services/booking.js";
import { queueCalendar } from "../worker/queues.js";

/**
 * Google Calendar connection for staff (§4).
 *
 * Tokens are exchanged server-side and stored encrypted. Nothing in this file
 * ever returns a token, a refresh token or an authorisation code to the browser
 * — the frontend only ever learns *whether* a calendar is connected.
 */

const calendarRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/** Short-lived signed state, so the callback cannot be replayed or forged. */
const pendingStates = new Map<string, { opsUserId: string; expiresAt: number }>();

function issueState(opsUserId: string): string {
	// Opportunistic sweep — this map is small and only lives for the OAuth hop.
	const now = Date.now();
	for (const [key, value] of pendingStates) {
		if (value.expiresAt < now) pendingStates.delete(key);
	}
	const state = randomUUID();
	pendingStates.set(state, { opsUserId, expiresAt: now + 10 * 60_000 });
	return state;
}

function consumeState(state: string): string | null {
	const entry = pendingStates.get(state);
	if (!entry) return null;
	pendingStates.delete(state); // single use
	if (entry.expiresAt < Date.now()) return null;
	return entry.opsUserId;
}

const statusSchema = z.object({
	configured: z.boolean(),
	connected: z.boolean(),
	needsReconnect: z.boolean(),
	googleAccountEmail: z.string().nullable(),
	workingHours: z.array(
		z.object({
			dayOfWeek: z.number().int(),
			start: z.string(),
			end: z.string(),
			timezone: z.string(),
		}),
	),
});

/* ── GET /api/calendar/status ────────────────────────────────────────────── */

calendarRouter.openapi(
	createRoute({
		method: "get",
		path: "/status",
		tags: ["Calendar"],
		summary: "Whether the signed-in staff member has connected Google Calendar",
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: { content: { "application/json": { schema: statusSchema } }, description: "Status" },
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const [account] = await db
			.select()
			.from(staffCalendarAccounts)
			.where(eq(staffCalendarAccounts.opsUserId, staff.opsUserId))
			.limit(1);

		return c.json({
			configured: googleConfigured(),
			connected: Boolean(account) && !account?.needsReconnect,
			needsReconnect: account?.needsReconnect ?? false,
			googleAccountEmail: account?.googleAccountEmail ?? null,
			workingHours: await listWorkingHours(staff.opsUserId),
		});
	},
);

/* ── GET /api/calendar/connect ───────────────────────────────────────────── */

calendarRouter.openapi(
	createRoute({
		method: "get",
		path: "/connect",
		tags: ["Calendar"],
		summary: "Begin the Google Calendar OAuth flow",
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ url: z.string().url() }) } },
				description: "Consent URL to redirect the employee to",
			},
		},
	}),
	async (c) => {
		if (!googleConfigured()) {
			throw new HttpError(
				503,
				"CALENDAR_NOT_CONFIGURED",
				"Google Calendar is not configured on this server",
			);
		}
		const staff = c.get("staff")!;
		return c.json({ url: buildConsentUrl(issueState(staff.opsUserId)) });
	},
);

/* ── GET /api/calendar/callback ──────────────────────────────────────────── */

/**
 * OAuth redirect target.
 *
 * Deliberately not JSON: Google sends the employee's browser here, so it
 * redirects back into the ops app with a short result flag. The authorisation
 * code is exchanged here and never reaches the frontend.
 */
calendarRouter.openapi(
	createRoute({
		method: "get",
		path: "/callback",
		tags: ["Calendar"],
		summary: "Google OAuth redirect target",
		request: {
			query: z.object({
				code: z.string().optional(),
				state: z.string().optional(),
				error: z.string().optional(),
			}),
		},
		responses: { 302: { description: "Redirects back to the ops app" } },
	}),
	async (c) => {
		const { code, state, error } = c.req.valid("query");
		// Personal calendar page, reachable by every role that carries a caseload —
		// /ops/settings is admin-only and consultants are exactly who connect here.
		const settings = `${env.FRONTEND_URL}/ops/my-calendar`;

		if (error || !code || !state) {
			return c.redirect(`${settings}?calendar=denied`, 302);
		}

		const opsUserId = consumeState(state);
		if (!opsUserId) {
			return c.redirect(`${settings}?calendar=expired`, 302);
		}

		try {
			const oauth = createOAuthClient();
			const { tokens } = await oauth.getToken(code);

			if (!tokens.refresh_token) {
				// Without a refresh token the connection dies in an hour. Google only
				// returns one on first consent, so force the employee through again.
				return c.redirect(`${settings}?calendar=no_refresh_token`, 302);
			}

			// Identify which Google account was connected, for display only.
			oauth.setCredentials(tokens);
			let accountEmail: string | null = null;
			try {
				const info = await oauth.getTokenInfo(tokens.access_token ?? "");
				accountEmail = info.email ?? null;
			} catch {
				/* non-fatal — the connection still works without the label */
			}

			const values = {
				opsUserId,
				provider: "google" as const,
				googleAccountEmail: accountEmail,
				calendarId: "primary",
				accessTokenEncrypted: tokens.access_token ? encrypt(tokens.access_token) : null,
				refreshTokenEncrypted: encrypt(tokens.refresh_token),
				accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
				scope: tokens.scope ?? GOOGLE_SCOPES.join(" "),
				needsReconnect: false,
				updatedAt: new Date(),
			};

			await db
				.insert(staffCalendarAccounts)
				.values(values)
				.onConflictDoUpdate({ target: staffCalendarAccounts.opsUserId, set: values });

			// A newly connected employee needs hours before they can be assigned.
			await ensureDefaultWorkingHours(opsUserId);
			// Pull their existing commitments so availability is correct immediately.
			await queueCalendar({ type: "refreshBusy", opsUserId });
			/*
			 * Pick up bookings already assigned to them that never got a link —
			 * either because they had not connected yet, or because the server had
			 * no Google credentials at the time. Those are left FAILED with no retry
			 * queued, since retrying is pointless until there is something to
			 * authenticate with. Connecting is that moment.
			 */
			const resynced = await queuePendingCalendarSyncs(opsUserId);
			if (resynced > 0) {
				console.log(`[calendar] queued ${resynced} pending sync(s) for ${opsUserId}`);
			}

			return c.redirect(`${settings}?calendar=connected`, 302);
		} catch {
			return c.redirect(`${settings}?calendar=failed`, 302);
		}
	},
);

/* ── PUT /api/calendar/working-hours ─────────────────────────────────────── */

/**
 * Set the signed-in staff member's own working hours (§3).
 *
 * Scoped to the caller by construction — the target is taken from the session,
 * never from the request, so there is no id a client could substitute to edit
 * somebody else's availability.
 */
calendarRouter.openapi(
	createRoute({
		method: "put",
		path: "/working-hours",
		tags: ["Calendar"],
		summary: "Replace your weekly working hours",
		middleware: [requireAuth, requireStaff] as const,
		request: {
			body: {
				content: { "application/json": { schema: updateWorkingHoursSchema } },
				description: "The complete weekly set; omitted days are non-working",
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: workingHoursResponseSchema } },
				description: "Updated working hours",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");

		if (!isValidTimeZone(body.timezone)) {
			throw new HttpError(400, "VALIDATION_ERROR", `Unknown timezone: ${body.timezone}`);
		}

		const conflictingBookings = await setWorkingHours(staff.opsUserId, body);

		return c.json({
			workingHours: await listWorkingHours(staff.opsUserId),
			conflictingBookings,
		});
	},
);

/* ── DELETE /api/calendar/connection ─────────────────────────────────────── */

calendarRouter.openapi(
	createRoute({
		method: "delete",
		path: "/connection",
		tags: ["Calendar"],
		summary: "Disconnect Google Calendar",
		middleware: [requireAuth, requireStaff] as const,
		responses: {
			200: {
				content: { "application/json": { schema: z.object({ disconnected: z.boolean() }) } },
				description: "Disconnected",
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		await db
			.delete(staffCalendarAccounts)
			.where(eq(staffCalendarAccounts.opsUserId, staff.opsUserId));
		return c.json({ disconnected: true });
	},
);

/* ── POST /api/calendar/webhook ──────────────────────────────────────────── */

/**
 * Google push notification receiver (§12).
 *
 * Google does not say *what* changed, only that something did on a watched
 * resource. The correct response is to acknowledge immediately and reconcile
 * asynchronously — the handler must return fast or Google backs the channel off.
 */
calendarRouter.openapi(
	createRoute({
		method: "post",
		path: "/webhook",
		tags: ["Calendar"],
		summary: "Google Calendar change notification",
		responses: {
			200: { description: "Acknowledged" },
			401: { description: "Rejected" },
		},
	}),
	async (c) => {
		const channelId = c.req.header("x-goog-channel-id");
		const resourceId = c.req.header("x-goog-resource-id");
		const token = c.req.header("x-goog-channel-token");
		const state = c.req.header("x-goog-resource-state");

		// Reject forgeries: the token is a shared secret we set when watching.
		if (env.GOOGLE_WEBHOOK_TOKEN) {
			const expected = Buffer.from(env.GOOGLE_WEBHOOK_TOKEN);
			const received = Buffer.from(token ?? "");
			const ok =
				expected.length === received.length && timingSafeEqual(expected, received);
			if (!ok) return c.body(null, 401);
		}

		// The handshake Google sends when a channel is created.
		if (state === "sync") return c.body(null, 200);

		if (channelId) {
			const [account] = await db
				.select({ opsUserId: staffCalendarAccounts.opsUserId })
				.from(staffCalendarAccounts)
				.where(eq(staffCalendarAccounts.channelId, channelId))
				.limit(1);

			if (account) {
				// Reconcile off the request path so the ack is immediate.
				await queueCalendar({ type: "refreshBusy", opsUserId: account.opsUserId });
			}
		}

		void resourceId;
		return c.body(null, 200);
	},
);

export { calendarRouter };
