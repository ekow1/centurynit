import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { opsUsers } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import {
	canModifyBooking,
	canSeeAllBookings,
	canViewBooking,
	requireAuth,
	requireMfa,
	requireRole,
	type AuthVariables,
} from "../middleware/auth.js";
import { zonedTimeToUtc } from "../lib/time.js";
import { assignableEmployees, branchAvailability, sameBranch } from "../services/availability.js";
import {
	assignBooking,
	cancelBooking,
	completeBooking,
	createBooking,
	getBooking,
	listBookings,
	listBookingsForClient,
	markNoShow,
	rescheduleBooking,
	setBookingMeetingUrl,
	type BookingRow,
} from "../services/booking.js";
import { ensureCaseForBooking, syncConsultationAssignment } from "../services/cases.js";
import { createConsultationInvoice } from "../services/invoice.js";
import {
	assignBookingSchema,
	assignableEmployeeSchema,
	availabilityQuerySchema,
	availabilityResponseSchema,
	bookingListSchema,
	bookingSchema,
	bookingStatusSchema,
	cancelBookingSchema,
	createBookingSchema,
	rescheduleBookingSchema,
} from "century-nit-shared";
import type { Booking, CreateBooking } from "century-nit-shared";
import { branches, consultationTypes, servicePackages } from "century-nit-core/content";
import { createPaystackCheckout, verifyPaystackTransaction } from "../services/paystack.js";
import { consultations, bookings as bookingsTable } from "../db/schema.js";

const bookingsRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const idParams = z.object({
	id: z.string().uuid(),
});

const listQuerySchema = z.object({
	status: bookingStatusSchema.optional(),
	branchId: z.string().min(1).optional(),
	employeeId: z.string().uuid().optional(),
});

const employeesQuerySchema = z.object({
	bookingId: z.string().uuid().optional(),
	branchId: z.string().min(1).optional(),
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	time: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/)
		.optional(),
	durationMinutes: z.coerce.number().int().min(15).max(240).optional(),
});

function resolveServiceName(serviceId: string): string {
	const pkg = servicePackages.find((p) => p.id === serviceId);
	if (pkg) return pkg.name;
	const type = consultationTypes.find((t) => t.id === serviceId);
	if (type) return type.name;
	return serviceId;
}

function getBranchOrThrow(branchId: string) {
	const branch = branches.find((b) => b.id === branchId);
	if (!branch) throw new HttpError(404, "BRANCH_NOT_FOUND", `Unknown branch: ${branchId}`);
	return branch;
}

async function loadEmployee(employeeId: string | null) {
	if (!employeeId) return null;
	const [row] = await db.select().from(opsUsers).where(eq(opsUsers.id, employeeId)).limit(1);
	return row ?? null;
}

function toBookingResponse(row: BookingRow, employee?: { name: string; email: string } | null): Booking {
	return {
		id: row.id,
		reference: row.reference,
		status: row.status,
		serviceId: row.serviceId,
		serviceName: row.serviceName,
		branchId: row.branchId,
		type: row.type,
		startsAt: row.startsAt.toISOString(),
		endsAt: row.endsAt.toISOString(),
		timezone: row.timezone,
		durationMinutes: row.durationMinutes,
		clientName: row.clientName,
		clientEmail: row.clientEmail,
		clientPhone: row.clientPhone ?? null,
		employeeId: row.employeeId ?? null,
		employeeName: employee?.name ?? null,
		employeeEmail: employee?.email ?? null,
		assignedAt: row.assignedAt?.toISOString() ?? null,
		meetingUrl: row.meetingUrl ?? null,
		calendarEventId: row.calendarEventId ?? null,
		calendarSyncStatus: row.calendarSyncStatus,
		rescheduledAt: row.rescheduledAt?.toISOString() ?? null,
		rescheduleRequestedAt: row.rescheduleRequestedAt?.toISOString() ?? null,
		rescheduleRequestedStartsAt: row.rescheduleRequestedStartsAt?.toISOString() ?? null,
		rescheduleRequestedEndsAt: row.rescheduleRequestedEndsAt?.toISOString() ?? null,
		rescheduleRequestedTimezone: row.rescheduleRequestedTimezone ?? null,
		rescheduleRequestReason: row.rescheduleRequestReason ?? null,
		cancelledAt: row.cancelledAt?.toISOString() ?? null,
		cancellationReason: row.cancellationReason ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/* ── GET /api/v1/bookings/availability ──────────────────────────────────────── */

  bookingsRouter.openapi(
  createRoute({
    method: "get",
    path: "/availability",
    tags: ["Bookings"],
    request: { query: availabilityQuerySchema },
    responses: {
      200: {
        description: "Available slots",
        content: { "application/json": { schema: availabilityResponseSchema } },
      },
    },
  }),
  async (c) => {
    const query = c.req.valid("query");
    const branch = getBranchOrThrow(query.branchId);
    const result = await branchAvailability({
      branchId: query.branchId,
      date: query.date,
      durationMinutes: query.durationMinutes,
      timezone: branch.timezone,
      employeeId: query.employeeId,
    });
    return c.json({
      branchId: branch.id,
      date: query.date,
      timezone: branch.timezone,
      durationMinutes: query.durationMinutes,
      slots: result.slots.map((s) => ({
        time: s.time,
        startsAt: s.startsAt.toISOString(),
        available: s.available,
        reason: s.reason,
      })),
      calendarSyncStatus: result.calendarSyncStatus,
    });
  },
);

/* ── POST /api/v1/bookings/checkout ─────────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "post",
		path: "/checkout",
		tags: ["Bookings"],
		middleware: requireAuth,
		request: {
			body: {
				content: { "application/json": { schema: createBookingSchema } },
				description: "Booking details for checkout",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Checkout URL",
				content: { "application/json": { schema: z.object({ authorizationUrl: z.string() }) } },
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const origin = c.req.header("origin") || c.req.header("referer")?.split("/").slice(0, 3).join("/") || "https://centurynit.softclicksolutions.com";
		
		const checkout = await createPaystackCheckout({
			email: user.email,
			amountCents: 7500, // Fixed consultation fee
			callbackUrl: `${origin}/portal/pay?paystack=1&booking=consultation`,
			customMetadata: { bookingPayload: body },
		});
		
		return c.json({ authorizationUrl: checkout.authorizationUrl }, 200);
	},
);

/* ── POST /api/v1/bookings/verify-payment ───────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "post",
		path: "/verify-payment",
		tags: ["Bookings"],
		middleware: requireAuth,
		request: {
			body: {
				content: { "application/json": { schema: z.object({ reference: z.string() }) } },
				description: "Paystack transaction reference",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Booking created after payment verification",
				content: { "application/json": { schema: bookingSchema } },
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const { reference } = c.req.valid("json");

		const txn = await verifyPaystackTransaction(reference);
		if (txn.status !== "success") {
			throw new HttpError(400, "PAYMENT_FAILED", "Payment was not successful");
		}
		
		const bookingPayload = txn.metadata?.bookingPayload as CreateBooking;
		if (!bookingPayload) {
			throw new HttpError(400, "BAD_REQUEST", "Transaction missing booking payload");
		}
		
		const serviceName = resolveServiceName(bookingPayload.serviceId);
		const booking = await createBooking({
			data: bookingPayload,
			client: {
				id: user.id,
				name: user.name ?? user.email,
				email: user.email,
			},
			serviceName,
		});

		// Immediately create the consultation row so ops see it in the intake queue.
		if (bookingPayload.serviceId === "consultation") {
			try {
				await ensureCaseForBooking({
					id: booking.id,
					reference: booking.reference,
					clientUserId: user.id,
					clientName: user.name ?? user.email,
					clientEmail: user.email,
					clientPhone: booking.clientPhone ?? null,
					branchId: booking.branchId,
					type: booking.type,
				});
				await createConsultationInvoice({
					clientUserId: user.id,
					applicantName: user.name ?? user.email,
					applicantEmail: user.email,
					bookingId: booking.id,
					reference: booking.reference,
					amountCents: txn.amountCents,
					issuedBy: "System",
				});
			} catch {
				// Non-fatal — booking still succeeds; ops can still find the booking
			}
		}

		return c.json(toBookingResponse(booking), 200);
	},
);

/* ── POST /api/v1/bookings ──────────────────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["Bookings"],
		middleware: requireAuth,
		request: {
			body: {
				content: { "application/json": { schema: createBookingSchema } },
				description: "Booking to create",
				required: true,
			},
		},
		responses: {
			201: {
				description: "Booking created",
				content: { "application/json": { schema: bookingSchema } },
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const serviceName = resolveServiceName(body.serviceId);
		const booking = await createBooking({
			data: body,
			client: {
				id: user.id,
				name: user.name ?? user.email,
				email: user.email,
			},
			serviceName,
		});

// Immediately create the consultation row so ops see it in the intake queue.
		// ensureCaseForBooking is idempotent — safe to call for every booking type
		// but only actually creates a consultation row for serviceId "consultation".
		if (body.serviceId === "consultation") {
			try {
				await ensureCaseForBooking({
					id: booking.id,
					reference: booking.reference,
					clientUserId: user.id,
					clientName: user.name ?? user.email,
					clientEmail: user.email,
					clientPhone: booking.clientPhone ?? null,
					branchId: booking.branchId,
					type: booking.type,
				});
				await createConsultationInvoice({
					clientUserId: user.id,
					applicantName: user.name ?? user.email,
					applicantEmail: user.email,
					bookingId: booking.id,
					reference: booking.reference,
					amountCents: 7500,
					issuedBy: "System",
				});
			} catch {
				// Non-fatal — booking still succeeds; ops can still find the booking
			}
		}

		return c.json(toBookingResponse(booking), 201);
	},
);

/* ── GET /api/v1/bookings ───────────────────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa] as const,
		request: { query: listQuerySchema },
		responses: {
			200: {
				description: "List of bookings",
				content: { "application/json": { schema: bookingListSchema } },
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff");
		const query = c.req.valid("query");

		let rows: BookingRow[] = [];
		if (!staff) {
			rows = await listBookingsForClient(user.id);
		} else if (canSeeAllBookings(staff)) {
			rows = await listBookings({
				status: query.status ? [query.status] : undefined,
				branchId: query.branchId,
				employeeId: query.employeeId,
			});
		} else {
			const [mine, assigned] = await Promise.all([
				listBookingsForClient(user.id),
				listBookings({ employeeId: staff.opsUserId }),
			]);
			const byId = new Map<string, BookingRow>();
			for (const row of mine) byId.set(row.id, row);
			for (const row of assigned) byId.set(row.id, row);
			rows = Array.from(byId.values());
		}

		const employeeIds = Array.from(new Set(rows.map((r) => r.employeeId).filter(Boolean)));
		const employees = employeeIds.length
			? await db.select().from(opsUsers).where(inArray(opsUsers.id, employeeIds as string[]))
			: [];
		const byEmployee = new Map(employees.map((e) => [e.id, e]));

		const list = rows.map((r) => toBookingResponse(r, r.employeeId ? byEmployee.get(r.employeeId) ?? null : null));
		return c.json({ bookings: list, total: list.length });
	},
);

/*
 * Registered BEFORE `/:id`. Hono matches in registration order, so a static
 * segment declared after a parameterised one is unreachable — `/employees`
 * was being matched as `/:id` with id="employees" and failing uuid validation.
 */
/* ── GET /api/v1/bookings/employees ─────────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/employees",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa] as const,
		request: { query: employeesQuerySchema },
		responses: {
			200: {
				description: "Assignable employees",
				content: { "application/json": { schema: z.array(assignableEmployeeSchema) } },
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff");
		if (!staff) throw new HttpError(403, "FORBIDDEN", "Staff access required");

		const query = c.req.valid("query");
		let startsAt: Date;
		let durationMinutes: number;
		let timezone: string;
		let branchId: string | undefined;
		let excludeBookingId: string | undefined;

		if (query.bookingId) {
			const row = await getBooking(query.bookingId);
			if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
			startsAt = row.startsAt;
			durationMinutes = row.durationMinutes;
			timezone = row.timezone;
			branchId = row.branchId;
			excludeBookingId = row.id;
		} else if (query.branchId && query.date && query.time && query.durationMinutes) {
			const branch = getBranchOrThrow(query.branchId);
			startsAt = zonedTimeToUtc(query.date, query.time, branch.timezone);
			durationMinutes = query.durationMinutes;
			timezone = branch.timezone;
			branchId = query.branchId;
		} else {
			throw new HttpError(400, "VALIDATION_ERROR", "Provide bookingId or branchId+date+time+durationMinutes");
		}

		const options = await assignableEmployees({
			startsAt,
			durationMinutes,
			timezone,
			branchId,
			excludeBookingId,
		});
		/*
		 * Branch labels are compared canonically: ops_users.branch says "accra"
		 * while the catalogue says "accra-hq", so a raw !== drops every employee
		 * and the manager's dialog comes back empty.
		 *
		 * Unavailable staff are deliberately kept — §2 wants "✕ Kwame - Busy"
		 * shown, not hidden. The assign endpoint is what refuses them.
		 */
		const filtered = options.filter((o) =>
			branchId && o.branch ? sameBranch(o.branch, branchId) : true,
		);
		return c.json(filtered);
	},
);

/* ── GET /api/v1/bookings/:id ───────────────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa] as const,
		request: { params: idParams },
		responses: {
			200: {
				description: "Booking",
				content: { "application/json": { schema: bookingSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const user = c.get("user");
		const staff = c.get("staff");

		const row = await getBooking(id);
		if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
		if (!canViewBooking(row, user, staff)) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to view this booking");
		}
		const employee = await loadEmployee(row.employeeId);
		return c.json(toBookingResponse(row, employee));
	},
);

/* ── PATCH /api/v1/bookings/:id/cancel ──────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/cancel",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: cancelBookingSchema } },
				description: "Cancel reason",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Cancelled booking",
				content: { "application/json": { schema: bookingSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const user = c.get("user");
		const staff = c.get("staff");

		const row = await getBooking(id);
		if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
		if (!canModifyBooking(row, user, staff)) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to cancel this booking");
		}
		const updated = await cancelBooking({
			bookingId: id,
			reason: body.reason,
			actor: staff ? { name: staff.name, email: staff.email } : { name: user.name ?? user.email, email: user.email },
		});

		const employee = await loadEmployee(updated.employeeId);
		return c.json(toBookingResponse(updated, employee));
	},
);

/* ── PATCH /api/v1/bookings/:id/reschedule ──────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/reschedule",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: rescheduleBookingSchema } },
				description: "Reschedule details",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Rescheduled booking",
				content: { "application/json": { schema: bookingSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const user = c.get("user");
		const staff = c.get("staff");

		const row = await getBooking(id);
		if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
		if (!canModifyBooking(row, user, staff)) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to reschedule this booking");
		}
		const updated = await rescheduleBooking({
			bookingId: id,
			date: body.date,
			time: body.time,
			timezone: body.timezone,
			reason: body.reason,
			actor: staff ? { name: staff.name, email: staff.email } : { name: user.name ?? user.email, email: user.email },
		});
		const employee = await loadEmployee(updated.employeeId);
		return c.json(toBookingResponse(updated, employee));
	},
);

/* ── PATCH /api/v1/bookings/:id/assign ──────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/assign",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: assignBookingSchema } },
				description: "Employee to assign",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Assigned booking",
				content: { "application/json": { schema: bookingSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const staff = c.get("staff");

		if (!staff) throw new HttpError(403, "FORBIDDEN", "Staff access required");
		if (
			staff.role !== "manager" &&
			staff.role !== "coordinator" &&
			staff.role !== "super_admin"
		) {
			throw new HttpError(403, "FORBIDDEN", "Only managers or coordinators can assign bookings");
		}

		const updated = await assignBooking({
			bookingId: id,
			employeeId: body.employeeId,
			actor: { opsUserId: staff.opsUserId, name: staff.name, email: staff.email },
		});

		// Keep the consultation row assignment in sync with the booking assignment
		try {
			await syncConsultationAssignment(
				id,
				body.employeeId,
				{ opsUserId: staff.opsUserId, name: staff.name, email: staff.email },
			);
		} catch {
			/* non-fatal — consultation may not exist yet */
		}

		const employee = await loadEmployee(updated.employeeId);
		return c.json(toBookingResponse(updated, employee));
	},
);

/* ── PATCH /api/v1/bookings/:id/meeting-url ──────────────────────────────────── */

const meetingUrlSchema = z.object({
	meetingUrl: z
		.string()
		.url()
		.nullable()
		.transform((v) => (v && v.trim() ? v.trim() : null)),
});

bookingsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/meeting-url",
		tags: ["Bookings"],
		summary: "Set the meeting link on a booking",
		description:
			"Google Calendar integration has been removed. Staff paste any video link " +
			"(Zoom, Google Meet, Microsoft Teams, 8x8, …) onto the consultation booking. " +
			"Send an empty string or null to clear it. Only https:// URLs are accepted.",
		middleware: [requireAuth, requireMfa] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: meetingUrlSchema } },
				description: "Meeting URL to attach to the booking",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Updated booking",
				content: { "application/json": { schema: bookingSchema } },
			},
			400: { description: "Invalid URL" },
			403: { description: "Not allowed to modify this booking" },
			404: { description: "Booking not found" },
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const user = c.get("user");
		const staff = c.get("staff");

		const row = await getBooking(id);
		if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
		if (!canModifyBooking(row, user, staff)) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to update this booking");
		}

		const url = body.meetingUrl;
		if (url) {
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw new HttpError(400, "VALIDATION_ERROR", "Enter a valid https:// meeting link");
			}
			if (parsed.protocol !== "https:") {
				throw new HttpError(400, "VALIDATION_ERROR", "Meeting link must start with https://");
			}
		}

		const updated = await setBookingMeetingUrl(id, url);
		return c.json(toBookingResponse(updated), 200);
	},
);

/* ── PATCH /api/v1/bookings/:id/complete ────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/complete",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa] as const,
		request: { params: idParams },
		responses: {
			200: {
				description: "Completed booking",
				content: { "application/json": { schema: bookingSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const user = c.get("user");
		const staff = c.get("staff");
		if (!staff) throw new HttpError(403, "FORBIDDEN", "Staff access required");

		const row = await getBooking(id);
		if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
		if (!canModifyBooking(row, user, staff)) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to complete this booking");
		}
		const updated = await completeBooking({
			bookingId: id,
			actor: { name: staff.name, email: staff.email },
		});
		const employee = await loadEmployee(updated.employeeId);
		return c.json(toBookingResponse(updated, employee));
	},
);

/* ── PATCH /api/v1/bookings/:id/no-show ─────────────────────────────────────── */

bookingsRouter.openapi(
	createRoute({
		method: "patch",
		path: "/{id}/no-show",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa] as const,
		request: { params: idParams },
		responses: {
			200: {
				description: "Marked no-show",
				content: { "application/json": { schema: bookingSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const user = c.get("user");
		const staff = c.get("staff");
		if (!staff) throw new HttpError(403, "FORBIDDEN", "Staff access required");

		const row = await getBooking(id);
		if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
		if (!canModifyBooking(row, user, staff)) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to mark this booking as a no-show");
		}
		const updated = await markNoShow({
			bookingId: id,
			actor: { name: staff.name, email: staff.email },
		});
		const employee = await loadEmployee(updated.employeeId);
		return c.json(toBookingResponse(updated, employee));
	},
);

bookingsRouter.openapi(
	createRoute({
		method: "get",
		path: "/debug/reset-cancelled",
		tags: ["Bookings"],
		middleware: [requireAuth, requireMfa, requireRole("super_admin")] as const,
		request: {},
		responses: {
			200: { description: "Reset cancelled consultations (super admin only)" },
		},
	}),
	async (c) => {
		const cancelledConsultations = await db.select().from(consultations).where(eq(consultations.status, "CANCELLED"));
		if (cancelledConsultations.length === 0) {
			return c.json({ message: "No cancelled consultations found." }, 200);
		}
		for (const consultation of cancelledConsultations) {
			await db.update(consultations)
				.set({ status: "UNDER_REVIEW" })
				.where(eq(consultations.id, consultation.id));
				
			if (consultation.bookingId) {
				await db.update(bookingsTable)
					.set({ status: "UNASSIGNED" })
					.where(eq(bookingsTable.id, consultation.bookingId));
			}
		}
		return c.json({ message: `Reset ${cancelledConsultations.length} consultations.` }, 200);
	}
);

export { bookingsRouter };
