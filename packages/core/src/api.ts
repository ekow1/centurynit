import type {
	AssignableEmployee,
	AvailabilityResponse,
	Booking,
	BookingStatus,
	CreateBooking,
	AcceptInvitation,
	CreateInvitation,
	Invitation,
	CreatedInvitation,
	InvitationPreview,
	TwoFactorStatus,
	UpdateWorkingHours,
	WorkingHoursResponse,
} from "century-nit-shared";

/**
 * Typed client for the scheduling API, shared by the portal and the Operations
 * Center.
 *
 * Both apps are served from the same origin as `/api/*` (the Worker proxies it),
 * so requests are relative and `credentials: "include"` carries the Better Auth
 * session cookie. No token is ever read or held by the frontend — §16.
 */

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}

	/** The slot was taken between rendering and submitting — offer a re-pick. */
	get isSlotTaken(): boolean {
		return this.code === "SLOT_TAKEN";
	}

	get isUnauthenticated(): boolean {
		return this.status === 401;
	}

	get isForbidden(): boolean {
		return this.status === 403;
	}
}

type ErrorBody = {
	error?: { code?: string; message?: string; details?: unknown };
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
		credentials: "include",
		...init,
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});

	if (!response.ok) {
		let body: ErrorBody = {};
		try {
			body = (await response.json()) as ErrorBody;
		} catch {
			/* non-JSON error page — fall back to the status text */
		}
		throw new ApiError(
			response.status,
			body.error?.code ?? "HTTP_ERROR",
			body.error?.message ?? response.statusText,
			body.error?.details,
		);
	}

	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

/* ── Bookings ────────────────────────────────────────────────────────────── */

export const bookingsApi = {
	/**
	 * Slots for a branch and date. Advisory only — the server re-checks on
	 * submit, so a slot shown as free here can still be refused (§10).
	 */
	availability(params: {
		branchId: string;
		date: string;
		durationMinutes?: number;
		employeeId?: string;
	}): Promise<AvailabilityResponse> {
		const query = new URLSearchParams({
			branchId: params.branchId,
			date: params.date,
			durationMinutes: String(params.durationMinutes ?? 45),
			...(params.employeeId ? { employeeId: params.employeeId } : {}),
		});
		return request(`/api/bookings/availability?${query}`);
	},

	create(input: CreateBooking): Promise<Booking> {
		return request("/api/bookings", { method: "POST", ...json(input) });
	},

	list(filter: { status?: BookingStatus; branchId?: string; employeeId?: string } = {}): Promise<{
		bookings: Booking[];
		total: number;
	}> {
		const query = new URLSearchParams(
			Object.entries(filter).filter(([, v]) => v != null) as [string, string][],
		);
		const suffix = query.toString() ? `?${query}` : "";
		return request(`/api/bookings${suffix}`);
	},

	get(id: string): Promise<Booking> {
		return request(`/api/bookings/${id}`);
	},

	/** Employees for the assign dialog, each flagged available or busy. */
	assignableEmployees(params: {
		bookingId?: string;
		branchId?: string;
		date?: string;
		time?: string;
		durationMinutes?: number;
	}): Promise<AssignableEmployee[]> {
		const query = new URLSearchParams(
			Object.entries(params)
				.filter(([, v]) => v != null)
				.map(([k, v]) => [k, String(v)]),
		);
		return request(`/api/bookings/employees?${query}`);
	},

	/** Manager/coordinator only. The server enforces that, not the caller. */
	assign(bookingId: string, employeeId: string): Promise<Booking> {
		return request(`/api/bookings/${bookingId}/assign`, {
			method: "PATCH",
			...json({ employeeId }),
		});
	},

	reschedule(
		bookingId: string,
		input: { date: string; time: string; timezone?: string; reason?: string },
	): Promise<Booking> {
		return request(`/api/bookings/${bookingId}/reschedule`, {
			method: "PATCH",
			...json(input),
		});
	},

	cancel(bookingId: string, reason?: string): Promise<Booking> {
		return request(`/api/bookings/${bookingId}/cancel`, {
			method: "PATCH",
			...json({ reason }),
		});
	},
};

/* ── Staff identity: invitations and MFA ─────────────────────────────────── */

export const staffApi = {
	/**
	 * What an invitee is shown before choosing a password.
	 *
	 * Public — they have no account yet. Returns only what the emailed link
	 * already told them, and never echoes the token back.
	 */
	previewInvitation(token: string): Promise<InvitationPreview> {
		return request(`/api/staff/invitations/preview?token=${encodeURIComponent(token)}`);
	},

	/** Creates the login and staff profile. The invitee chooses the password. */
	acceptInvitation(input: AcceptInvitation): Promise<{
		email: string;
		role: string;
		mfaRequired: boolean;
	}> {
		return request("/api/staff/invitations/accept", { method: "POST", ...json(input) });
	},

	createInvitation(input: CreateInvitation): Promise<CreatedInvitation> {
		return request("/api/staff/invitations", { method: "POST", ...json(input) });
	},

	listInvitations(): Promise<{ invitations: Invitation[] }> {
		return request("/api/staff/invitations");
	},

	revokeInvitation(id: string): Promise<Invitation> {
		return request(`/api/staff/invitations/${id}`, { method: "DELETE" });
	},

	/** Whether the caller holds a second factor, and whether they must. */
	mfaStatus(): Promise<TwoFactorStatus> {
		return request("/api/staff/mfa");
	},

	list(): Promise<{
		staff: {
			id: string;
			email: string;
			name: string;
			role: string;
			branch: string | null;
			active: boolean;
			hasLogin: boolean;
			mfaEnabled: boolean;
		}[];
	}> {
		return request("/api/staff");
	},
};

/* ── Calendar connection (staff) ─────────────────────────────────────────── */

export type CalendarStatus = {
	configured: boolean;
	connected: boolean;
	needsReconnect: boolean;
	googleAccountEmail: string | null;
	workingHours: { dayOfWeek: number; start: string; end: string; timezone: string }[];
};

export const calendarApi = {
	status(): Promise<CalendarStatus> {
		return request("/api/calendar/status");
	},

	/** Returns the Google consent URL to send the employee to. */
	connect(): Promise<{ url: string }> {
		return request("/api/calendar/connect");
	},

	disconnect(): Promise<{ disconnected: boolean }> {
		return request("/api/calendar/connection", { method: "DELETE" });
	},

	/**
	 * Replace the signed-in staff member's weekly hours.
	 *
	 * `days` is the complete set — omit a day to mark it non-working. The target
	 * is the session user; there is no id to pass, and none is accepted.
	 */
	updateWorkingHours(input: UpdateWorkingHours): Promise<WorkingHoursResponse> {
		return request("/api/calendar/working-hours", {
			method: "PUT",
			...json(input),
		});
	},
};
