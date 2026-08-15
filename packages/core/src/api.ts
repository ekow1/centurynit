import type {
	AssignableEmployee,
	AvailabilityResponse,
	ApplicantDocument,
	Booking,
	BookingStatus,
	CreateBooking,
	AcceptInvitation,
	CreateInvitation,
	DownloadTicket,
	Invitation,
	CreatedInvitation,
	InvitationPreview,
	RequestUpload,
	ReviewDocument,
	TwoFactorStatus,
	UpdateWorkingHours,
	UploadTicket,
	WorkingHoursResponse,
} from "century-nit-shared";
import { API_PREFIX } from "century-nit-shared";

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
		return request(`${API_PREFIX}/bookings/availability?${query}`);
	},

	create(input: CreateBooking): Promise<Booking> {
		return request(`${API_PREFIX}/bookings`, { method: "POST", ...json(input) });
	},

	list(filter: { status?: BookingStatus; branchId?: string; employeeId?: string } = {}): Promise<{
		bookings: Booking[];
		total: number;
	}> {
		const query = new URLSearchParams(
			Object.entries(filter).filter(([, v]) => v != null) as [string, string][],
		);
		const suffix = query.toString() ? `?${query}` : "";
		return request(`${API_PREFIX}/bookings${suffix}`);
	},

	get(id: string): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${id}`);
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
		return request(`${API_PREFIX}/bookings/employees?${query}`);
	},

	/** Manager/coordinator only. The server enforces that, not the caller. */
	assign(bookingId: string, employeeId: string): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/assign`, {
			method: "PATCH",
			...json({ employeeId }),
		});
	},

	reschedule(
		bookingId: string,
		input: { date: string; time: string; timezone?: string; reason?: string },
	): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/reschedule`, {
			method: "PATCH",
			...json(input),
		});
	},

	cancel(bookingId: string, reason?: string): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/cancel`, {
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
		return request(`${API_PREFIX}/staff/invitations/preview?token=${encodeURIComponent(token)}`);
	},

	/** Creates the login and staff profile. The invitee chooses the password. */
	acceptInvitation(input: AcceptInvitation): Promise<{
		email: string;
		role: string;
		mfaRequired: boolean;
	}> {
		return request(`${API_PREFIX}/staff/invitations/accept`, { method: "POST", ...json(input) });
	},

	createInvitation(input: CreateInvitation): Promise<CreatedInvitation> {
		return request(`${API_PREFIX}/staff/invitations`, { method: "POST", ...json(input) });
	},

	listInvitations(): Promise<{ invitations: Invitation[] }> {
		return request(`${API_PREFIX}/staff/invitations`);
	},

	revokeInvitation(id: string): Promise<Invitation> {
		return request(`${API_PREFIX}/staff/invitations/${id}`, { method: "DELETE" });
	},

	/** Whether the caller holds a second factor, and whether they must. */
	mfaStatus(): Promise<TwoFactorStatus> {
		return request(`${API_PREFIX}/staff/mfa`);
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
		return request(`${API_PREFIX}/staff`);
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
		return request(`${API_PREFIX}/calendar/status`);
	},

	/** Returns the Google consent URL to send the employee to. */
	connect(): Promise<{ url: string }> {
		return request(`${API_PREFIX}/calendar/connect`);
	},

	disconnect(): Promise<{ disconnected: boolean }> {
		return request(`${API_PREFIX}/calendar/connection`, { method: "DELETE" });
	},

	/**
	 * Replace the signed-in staff member's weekly hours.
	 *
	 * `days` is the complete set — omit a day to mark it non-working. The target
	 * is the session user; there is no id to pass, and none is accepted.
	 */
	updateWorkingHours(input: UpdateWorkingHours): Promise<WorkingHoursResponse> {
		return request(`${API_PREFIX}/calendar/working-hours`, {
			method: "PUT",
			...json(input),
		});
	},
};

/* ── Documents ───────────────────────────────────────────────────────────── */

export const documentsApi = {
	/**
	 * Applicants get their own; staff with the documents module get the review
	 * queue. Passing `ownerUserId` as an applicant is refused by the server — the
	 * scope is decided from the session, not from this argument.
	 */
	list(params: { ownerUserId?: string } = {}): Promise<{ documents: ApplicantDocument[] }> {
		const query = params.ownerUserId
			? `?${new URLSearchParams({ ownerUserId: params.ownerUserId })}`
			: "";
		return request(`${API_PREFIX}/documents${query}`);
	},

	requestUpload(input: RequestUpload): Promise<UploadTicket> {
		return request(`${API_PREFIX}/documents/upload-url`, { method: "POST", ...json(input) });
	},

	completeUpload(documentId: string): Promise<ApplicantDocument> {
		return request(`${API_PREFIX}/documents/${documentId}/complete`, { method: "POST" });
	},

	/** A signed, expiring link. Fetch it at the moment of use; do not store it. */
	downloadUrl(documentId: string): Promise<DownloadTicket> {
		return request(`${API_PREFIX}/documents/${documentId}/download`);
	},

	review(documentId: string, input: ReviewDocument): Promise<ApplicantDocument> {
		return request(`${API_PREFIX}/documents/${documentId}/review`, {
			method: "POST",
			...json(input),
		});
	},

	remove(documentId: string): Promise<{ deleted: boolean }> {
		return request(`${API_PREFIX}/documents/${documentId}`, { method: "DELETE" });
	},

	/**
	 * The whole upload, as one call.
	 *
	 * Three steps that must happen in order and must not be reordered by a caller:
	 * take a ticket, PUT the bytes straight to storage, then tell the server they
	 * landed. Stopping after the PUT leaves a document stuck at PENDING_UPLOAD
	 * that no listing will ever show, so getting this wrong is invisible rather
	 * than loud — which is exactly why it lives here instead of in each screen.
	 *
	 * The PUT goes to storage, not to us, so it deliberately bypasses `request`:
	 * no session cookie should be sent to a third-party host, the signed URL is
	 * the entire authorisation, and the response is not our JSON error envelope.
	 */
	async upload(
		file: File,
		documentType: string,
		options: { signal?: AbortSignal } = {},
	): Promise<ApplicantDocument> {
		const ticket = await documentsApi.requestUpload({
			documentType,
			fileName: file.name,
			contentType: file.type as RequestUpload["contentType"],
			sizeBytes: file.size,
		});

		const put = await fetch(ticket.uploadUrl, {
			method: "PUT",
			body: file,
			headers: { "Content-Type": file.type, ...ticket.headers },
			signal: options.signal,
		});

		if (!put.ok) {
			throw new ApiError(
				put.status,
				"UPLOAD_FAILED",
				`Could not upload ${file.name}. The link may have expired — try again.`,
			);
		}

		return documentsApi.completeUpload(ticket.documentId);
	},
};
