import type {
	DerivedJourney,
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
	AddCommentInput,
	ApiApplicant,
	ApiApplication,
	ApiConsultation,
	ApiInvoice,
	CreateInvoice,
	IssueProforma,
	VoidInvoice,
	CreditInvoice,
	AssessmentResult,
	ChoosePackage,
	ChoosePaymentPlan,
	RecordPayment,
	PaystackCheckout,
	PaystackVerify,
	PaystackVerifyResponse,
	UpdateMyProfile,
	RequestEmailChange,
	ConfirmEmailChange,
	VisaStage,
	SchoolApplication,
	SchoolApplicationList,
	AddSchoolApplication, OpsAddSchoolApplication, SchoolFileKind, VisaDetails,
	UpdateSchoolStatus,
	LockSchools,
	InitializePayment,
	InitializePaymentResponse,
	PaymentVerificationResult,
	AvatarUploadTicket,
	AvatarUrl,
	RequestAvatarUpload,
	ChatMessage as ApiChatMessage,
	ChatConversation as ApiChatConversation,
	CommunicationContext,
	ContactCard,
	PreviousContact,
	ProceedQuotation,
	ProceedApplication,
	DeclineProceed,
	PauseProceed,
	AcceptProceedResponse,
	ServicePackage,
	TravelAssistanceRequest,
	TravelAssistanceDecisionInput,
	TravelAssistanceBookingInput,
	TravelAssistanceInvoiceInput,
} from "century-nit-shared";
import { API_PREFIX, type FeeSchedule } from "century-nit-shared";



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

/**
 * PUT a file to a signed storage URL, reporting upload progress.
 *
 * `fetch` only exposes download progress — the number that matters here is
 * upload progress, which is why this uses XMLHttpRequest. The signed URL is the
 * entire authorisation, so no session cookie is sent, and the response is not
 * our JSON error envelope.
 */
async function putFileWithProgress(
	url: string,
	file: File,
	headers: Record<string, string>,
	onProgress?: (percent: number) => void,
	signal?: AbortSignal,
	maxRetries = 3,
): Promise<void> {
	let attempt = 0;
	while (attempt < maxRetries) {
		attempt++;
		try {
			await new Promise<void>((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				xhr.open("PUT", url);

				const isSupabaseSign = url.includes("/object/upload/sign/");
				let body: BodyInit = file;

				if (isSupabaseSign) {
					const formData = new FormData();
					formData.append("cacheControl", "3600");
					formData.append("", file);
					body = formData;

					for (const [key, value] of Object.entries(headers)) {
						if (key.toLowerCase() !== "content-type") {
							xhr.setRequestHeader(key, value);
						}
					}
				} else {
					for (const [key, value] of Object.entries(headers)) {
						xhr.setRequestHeader(key, value);
					}
				}

				xhr.upload.onprogress = (e) => {
					if (e.lengthComputable && onProgress) {
						onProgress(Math.round((e.loaded / e.total) * 100));
					}
				};

				xhr.onload = () => {
					if (xhr.status >= 200 && xhr.status < 300) {
						resolve();
					} else {
						let detail = "";
						try {
							const json = JSON.parse(xhr.responseText);
							detail = json.message || json.error || xhr.responseText;
						} catch {
							detail = xhr.responseText || xhr.statusText;
						}
						reject(
							new ApiError(
								xhr.status,
								"UPLOAD_FAILED",
								`Upload failed (${xhr.status})${detail ? `: ${detail}` : ""}`,
							),
						);
					}
				};

				xhr.onerror = () =>
					reject(new ApiError(0, "UPLOAD_FAILED", "Upload failed. Check your connection."));
				xhr.onabort = () => reject(new ApiError(0, "UPLOAD_ABORTED", "Upload cancelled"));

				signal?.addEventListener("abort", () => xhr.abort(), { once: true });
				xhr.send(body);
			});
			return;
		} catch (err) {
			if (signal?.aborted || attempt >= maxRetries) throw err;
			// Exponential backoff before retry
			await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 4000)));
		}
	}
}

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

	checkout(input: CreateBooking): Promise<{ authorizationUrl: string }> {
		return request(`${API_PREFIX}/bookings/checkout`, { method: "POST", ...json(input) });
	},

	verifyPayment(reference: string): Promise<Booking & { status?: string; message?: string }> {
		return request(`${API_PREFIX}/bookings/verify-payment`, { method: "POST", ...json({ reference }) });
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

	rescheduleRequest(
		bookingId: string,
		input: { date: string; time: string; timezone?: string; reason?: string },
	): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/reschedule-request`, {
			method: "PATCH",
			...json(input),
		});
	},

	rescheduleDecision(
		bookingId: string,
		decision: "approve" | "reject",
	): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/reschedule-decision`, {
			method: "PATCH",
			...json({ decision }),
		});
	},

	cancel(bookingId: string, reason?: string): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/cancel`, {
			method: "PATCH",
			...json({ reason }),
		});
	},

	complete(bookingId: string): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/complete`, { method: "PATCH" });
	},

	markNoShow(bookingId: string): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/no-show`, { method: "PATCH" });
	},

	/**
	 * Set the meeting link on a booking manually (Zoom, Google Meet, Microsoft
	 * Teams, …). Pass an empty string or null to clear it. Only https:// URLs are
	 * accepted. Replaces the removed Google Calendar auto-generated Meet link.
	 */
	setMeetingUrl(bookingId: string, meetingUrl: string | null): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/meeting-url`, {
			method: "PATCH",
			...json({ meetingUrl: meetingUrl && meetingUrl.trim() ? meetingUrl.trim() : null }),
		});
	},

	/**
	 * Generate a Google Meet link on-demand using the connected company
	 * Google Workspace account and email the client automatically.
	 */
	generateMeeting(bookingId: string): Promise<Booking> {
		return request(`${API_PREFIX}/bookings/${bookingId}/generate-meet`, {
			method: "POST",
		});
	},

	/**
	 * Resend the meeting link notification email to the client.
	 */
	resendMeetingLink(bookingId: string): Promise<{ success: boolean; clientEmail: string }> {
		return request(`${API_PREFIX}/bookings/${bookingId}/resend-meeting-link`, {
			method: "POST",
		});
	},

	/**
	 * Live (in-progress) online meetings — bookings where `meetingActive` is
	 * true, polled by the meeting-status worker. Returns the same shape as
	 * `list()` so the dashboard widget and dedicated page can reuse the
	 * Booking type.
	 */
	liveMeetings(params?: { branchId?: string; employeeId?: string }): Promise<{ bookings: Booking[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.branchId) qs.set("branchId", params.branchId);
		if (params?.employeeId) qs.set("employeeId", params.employeeId);
		const query = qs.toString();
		return request(`${API_PREFIX}/bookings/meetings/live${query ? `?${query}` : ""}`);
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

	resendInvitation(id: string): Promise<CreatedInvitation> {
		return request(`${API_PREFIX}/staff/invitations/${id}/resend`, { method: "POST" });
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

	update(
		id: string,
		patch: { role?: string; branch?: string | null; active?: boolean },
	): Promise<{
		id: string;
		email: string;
		name: string;
		role: string;
		branch: string | null;
		active: boolean;
	}> {
		return request(`${API_PREFIX}/staff/${id}`, { method: "PATCH", ...json(patch) });
	},

	deleteStaff(id: string): Promise<{ success: boolean }> {
		return request(`${API_PREFIX}/staff/${id}`, { method: "DELETE" });
	},

	authStats(): Promise<{
		totalStaff: number;
		mfaEnrolled: number;
		mfaRequired: number;
		mfaNotEnrolled: number;
		activeSessions: number;
		providers: { id: string; label: string; enabled: boolean }[];
	}> {
		return request(`${API_PREFIX}/staff/auth-stats`);
	},
};

/* ── Auth settings ───────────────────────────────────────────────────────── */

export type AuthSettingsResponse = {
	portal: {
		email_password: boolean;
		social_google: boolean;
		email_otp: boolean;
		mfa_required: boolean;
		mfa_methods: string[];
	};
	ops: {
		email_password: boolean;
		google_sso: boolean;
		mfa_required: boolean;
		mfa_methods: string[];
	};
};

export type MfaEnrollmentStatus = {
	enrolled: boolean;
	method: string | null;
	required: boolean;
	availableMethods: string[];
};

export const authSettingsApi = {
	/** Read all auth settings (admin/manager). */
	get(): Promise<AuthSettingsResponse> {
		return request(`${API_PREFIX}/auth-settings`);
	},

	/** Update auth settings (admin/manager). */
	update(patch: Partial<{
		portal: Partial<AuthSettingsResponse["portal"]>;
		ops: Partial<AuthSettingsResponse["ops"]>;
	}>): Promise<AuthSettingsResponse> {
		return request(`${API_PREFIX}/auth-settings`, {
			method: "PUT",
			...json(patch),
		});
	},

	/** Current user's MFA enrollment status. */
	mfaStatus(): Promise<MfaEnrollmentStatus> {
		return request(`${API_PREFIX}/auth-settings/mfa`);
	},

	/** Choose MFA method and begin enrollment. Returns TOTP URI for "totp" or sends email for "email_otp". */
	enrollMfa(method: "totp" | "email_otp", password: string): Promise<{
		totpURI?: string;
		backupCodes?: string[];
		message?: string;
		email?: string;
	}> {
		return request(`${API_PREFIX}/auth-settings/mfa/enroll`, {
			method: "POST",
			...json({ method, password }),
		});
	},

	/** Confirm email OTP enrollment with the code sent to the user. */
	confirmMfaOtp(code: string): Promise<{ success: boolean }> {
		return request(`${API_PREFIX}/auth-settings/mfa/confirm`, {
			method: "POST",
			...json({ code }),
		});
	},

	/** Send OTP for email MFA verification (during login). */
	sendMfaOtp(): Promise<{ sent: boolean }> {
		return request(`${API_PREFIX}/auth-settings/mfa/send-otp`, {
			method: "POST",
		});
	},

	/** Verify OTP for email MFA login. */
	verifyMfaOtp(code: string): Promise<{ success: boolean }> {
		return request(`${API_PREFIX}/auth-settings/mfa/verify-otp`, {
			method: "POST",
			...json({ code }),
		});
	},
};

/* ── Notification delivery log ────────────────────────────────────────────── */

export type NotificationLogItem = {
	id: string;
	recipient: string;
	subject: string;
	template: string | null;
	status: string;
	reference: string | null;
	errorMessage: string | null;
	sentAt: string;
};

export const notificationsApi = {
	log(limit?: number, status?: "sent" | "failed"): Promise<{
		notifications: NotificationLogItem[];
		total: number;
		sent: number;
		failed: number;
	}> {
		const params = new URLSearchParams();
		if (limit) params.set("limit", String(limit));
		if (status) params.set("status", status);
		const qs = params.toString() ? `?${params.toString()}` : "";
		return request(`${API_PREFIX}/notifications/log${qs}`);
	},
};

/* ── Calendar feed (iCal mirror) — staff ──────────────────────────────────── */

export type CalendarStatus = {
	hasFeed: boolean;
	label: string | null;
	lastSyncedAt: string | null;
	lastError: string | null;
	busyBlocksCount: number;
	/** Absolute URL to subscribe a calendar app to this consultant's own Century NIT bookings. */
	outboundUrl: string | null;
	workingHours: { dayOfWeek: number; start: string; end: string; timezone: string }[];
	/** Branch-wide slot configuration set by managers/systems. Consultants see this read-only. */
	branchSlots: BranchSlotSchedule | null;
};

export type BranchSlotSchedule = {
	timezone: string;
	general: {
		openStart: string;
		openEnd: string;
		intervalMinutes: number;
		maxSlotsPerDay: number | null;
	};
	days: {
		dayOfWeek: number;
		enabled: boolean;
		override: boolean;
		openStart: string;
		openEnd: string;
		intervalMinutes: number;
		maxSlotsPerDay: number | null;
		times: string[];
	}[];
};

/** The staff member's personalized, revocable read-only iCal subscription URL. */
export type CalendarSubscription = {
	/** Subscribable ICS URL, or null if the staff member has no subscription yet. */
	url: string | null;
	createdAt: string | null;
};

export const calendarApi = {
	/**
	 * Feed status plus working hours, merged for the Calendar page. The secret
	 * iCal URL is never returned — the server only says *whether* a feed exists.
	 */
	status(): Promise<CalendarStatus> {
		return Promise.all([
			request<Omit<CalendarStatus, "workingHours" | "branchSlots">>(`${API_PREFIX}/calendar/feeds/me`),
			request<{ workingHours: CalendarStatus["workingHours"] }>(`${API_PREFIX}/calendar/working-hours`),
			request<BranchSlotSchedule>(`${API_PREFIX}/calendar/branch-slots`).catch(() => null as BranchSlotSchedule | null),
		]).then(([feed, wh, slots]) => ({ ...feed, workingHours: wh.workingHours, branchSlots: slots }));
	},

	/** Add or replace the signed-in staff member's read-only iCal/ICS feed. */
	saveFeed(input: { icsUrl: string; label?: string }): Promise<{
		hasFeed: boolean;
		label: string | null;
		lastSyncedAt: string | null;
		lastError: string | null;
		busyBlocksCount: number;
		outboundUrl: string | null;
	}> {
		return request(`${API_PREFIX}/calendar/feeds/me`, {
			method: "PUT",
			...json(input),
		});
	},

	/** Remove the feed and the busy blocks it was mirroring. */
	removeFeed(): Promise<void> {
		return request(`${API_PREFIX}/calendar/feeds/me`, { method: "DELETE" });
	},

	/** Trigger an immediate mirror of every feed (manual "Sync now"). */
	syncNow(): Promise<void> {
		return request(`${API_PREFIX}/calendar/feeds/sync`, { method: "POST" });
	},

	/**
	 * Replace the signed-in staff member's weekly hours. `days` is the complete
	 * set — omit a day to mark it non-working. The target is the session user;
	 * there is no id to pass, and none is accepted.
	 */
	updateWorkingHours(input: UpdateWorkingHours): Promise<WorkingHoursResponse> {
		return request(`${API_PREFIX}/calendar/working-hours`, {
			method: "PUT",
			...json(input),
		});
	},

	/* Outbound subscription — the company calendar as a one-way, read-only iCal
	 * feed into a staff member's personal calendar. Independent of the inbound
	 * mirror above; revocable and regenerable. */
	getSubscription(): Promise<CalendarSubscription> {
		return request(`${API_PREFIX}/calendar/subscription`);
	},
	/** Provision the subscription if none exists; returns the existing URL otherwise. */
	createSubscription(): Promise<CalendarSubscription> {
		return request(`${API_PREFIX}/calendar/subscription`, { method: "POST" });
	},
	/** Mint a fresh token, invalidating the previous URL immediately. */
	regenerateSubscription(): Promise<CalendarSubscription> {
		return request(`${API_PREFIX}/calendar/subscription/regenerate`, { method: "POST" });
	},
	/** Revoke the subscription URL (keeps the inbound mirror, if any). */
	revokeSubscription(): Promise<void> {
		return request(`${API_PREFIX}/calendar/subscription`, { method: "DELETE" });
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

	/** A signed, expiring link. Fetch it at the moment of use; do not store it.
	 *  Pass `inline: true` for in-browser preview (no Content-Disposition:
	 *  attachment); omit it for a download that saves to disk. */
	downloadUrl(documentId: string, options?: { inline?: boolean }): Promise<DownloadTicket> {
		const query = options?.inline ? "?inline=true" : "";
		return request(`${API_PREFIX}/documents/${documentId}/download${query}`);
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
	 * `onProgress` receives 0–100 as the browser sends bytes, for a progress bar.
	 */
	async upload(
		file: File,
		documentType: string,
		options: {
			signal?: AbortSignal;
			onProgress?: (percent: number) => void;
			/** Staff only: place an official artifact on this applicant's record. */
			ownerUserId?: string;
		} = {},
	): Promise<ApplicantDocument> {
		const ticket = await documentsApi.requestUpload({
			documentType,
			fileName: file.name,
			contentType: file.type as RequestUpload["contentType"],
			sizeBytes: file.size,
			ownerUserId: options.ownerUserId,
		});

		try {
			await putFileWithProgress(
				ticket.uploadUrl,
				file,
				{ "Content-Type": file.type, ...ticket.headers },
				options.onProgress,
				options.signal,
			);
		} catch (err) {
			if (err instanceof ApiError && err.code === "UPLOAD_FAILED") {
				throw new ApiError(
					err.status,
					"UPLOAD_FAILED",
					`Could not upload ${file.name}. The link may have expired — try again.`,
				);
			}
			throw err;
		}

		return documentsApi.completeUpload(ticket.documentId);
	},
};

/* ── Cases: consultations, applications, applicants ──────────────────────── */

export const consultationsApi = {
	list(): Promise<{ consultations: ApiConsultation[]; total: number }> {
		return request(`${API_PREFIX}/consultations`);
	},
	get(id: string): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}`);
	},
	assign(id: string, employeeId: string): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}/assign`, {
			method: "POST",
			...json({ employeeId }),
		});
	},
	confirmSlot(id: string): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}/confirm-slot`, { method: "POST" });
	},
	startAssessment(id: string): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}/start-assessment`, { method: "POST" });
	},
	completeAssessment(
		id: string,
		result: AssessmentResult,
	): Promise<{ consultation: ApiConsultation; application: ApiApplication | null }> {
		return request(`${API_PREFIX}/consultations/${id}/complete-assessment`, {
			method: "POST",
			...json(result),
		});
	},
	comment(id: string, input: AddCommentInput): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}/comments`, {
			method: "POST",
			...json(input),
		});
	},
	requestDocuments(id: string, documents: string[]): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}/request-documents`, {
			method: "POST",
			...json({ documents }),
		});
	},
	cancel(id: string, reason?: string): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}/cancel`, {
			method: "PATCH",
			body: JSON.stringify({ reason: reason ?? "" }),
		});
	},
	delegate(
		id: string,
		body: { coordinatorOpsUserId: string; delegationNote?: string },
	): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}/delegate`, {
			method: "POST",
			...json(body),
		});
	},
	reassign(
		id: string,
		body: { newCoordinatorOpsUserId: string; reason?: string },
	): Promise<ApiConsultation> {
		return request(`${API_PREFIX}/consultations/${id}/delegate`, {
			method: "PUT",
			...json(body),
		});
	},
	workload(): Promise<{
		coordinators: Array<{
			opsUserId: string;
			name: string;
			email: string;
			role: string;
			activeCases: number;
			overdueCases: number;
			maxCapacity: number;
			capacityPercent: number;
		}>;
		maxCapacityPerCoordinator: number;
	}> {
		return request(`${API_PREFIX}/consultations/workload`);
	},
	getActivity(
		id: string,
	): Promise<{
		activities: Array<{
			id: string;
			consultationId: string;
			type: string;
			actorName: string | null;
			payload: unknown;
			createdAt: string;
		}>;
		total: number;
	}> {
		return request(`${API_PREFIX}/consultations/${id}/activity`);
	},
};

export const applicationsApi = {
	list(): Promise<{ applications: ApiApplication[]; total: number }> {
		return request(`${API_PREFIX}/applications`);
	},
	get(id: string): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}`);
	},
	assign(id: string, employeeId: string): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}/assign`, {
			method: "POST",
			...json({ employeeId }),
		});
	},
	accept(id: string): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}/accept`, { method: "POST" });
	},
	setStage(id: string, stage: string): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}/stage`, {
			method: "POST",
			...json({ stage }),
		});
	},
	toggleChecklist(id: string, itemId: string, checked: boolean): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}/checklist`, {
			method: "POST",
			...json({ itemId, checked }),
		});
	},
	addForApplicant(applicantId: string, input: Omit<OpsAddSchoolApplication, "applicantId">): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/schools`, {
			method: "POST",
			...json({ applicantId, ...input }),
		});
	},
	setVisaStage(id: string, stage: VisaStage, note?: string, outcome?: "approved" | "refused", details?: VisaDetails): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}/visa-stage`, {
			method: "POST",
			...json({ stage, note, outcome, details }),
		});
	},
	/** Record visa facts (reference, appointment, validity…) without moving the stage. */
	setVisaDetails(id: string, details: VisaDetails): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}/visa-details`, { method: "PATCH", ...json(details) });
	},
	/**
	 * Staff-side package selection — binds `packageId`/`fundingTrack`, sets the
	 * school allowance, voids prior unpaid agency proformas and raises a fresh
	 * one. Same service as the applicant's own `/me/application/package`.
	 */
	choosePackage(id: string, input: ChoosePackage): Promise<{ application: ApiApplication; proformaInvoice: ApiInvoice | null }> {
		return request(`${API_PREFIX}/applications/${id}/package`, { method: "POST", ...json(input) });
	},
	/**
	 * Correct patchable case facts. The package (`fundingTrack`) is not
	 * patchable — changing it re-prices invoices, so it goes through
	 * `choosePackage` only.
	 */
	patch(
		id: string,
		input: {
			paymentPlanId?: string;
			targetSchoolCount?: number | null;
			notes?: string;
			visaCounselorNote?: string;
		},
	): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}`, { method: "PATCH", ...json(input) });
	},
	comment(id: string, input: AddCommentInput): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}/comments`, {
			method: "POST",
			...json(input),
		});
	},
	requestDocuments(id: string, documents: string[]): Promise<ApiApplication> {
		return request(`${API_PREFIX}/applications/${id}/request-documents`, {
			method: "POST",
			...json({ documents }),
		});
	},

	/* ── Travel Assistance (Ops side) ──────────────────────────────── */

	listTravelAssistance(): Promise<TravelAssistanceRequest[]> {
		return request(`${API_PREFIX}/applications/travel-assistance`);
	},
	getTravelAssistance(id: string): Promise<TravelAssistanceRequest | null> {
		return request(`${API_PREFIX}/applications/${id}/travel-assistance`);
	},
	assignTravelHandler(
		id: string,
		opsUserId: string,
	): Promise<TravelAssistanceRequest> {
		return request(`${API_PREFIX}/applications/travel-assistance/${id}/assign`, {
			method: "POST",
			...json({ opsUserId }),
		});
	},
	/** Raise the ticket invoice (fare + flight). Issued at once when the caller holds the invoices module. */
	raiseTravelInvoice(id: string, input: TravelAssistanceInvoiceInput): Promise<TravelAssistanceRequest> {
		return request(`${API_PREFIX}/applications/travel-assistance/${id}/invoice`, {
			method: "POST",
			...json(input),
		});
	},
	recordTravelBooking(
		id: string,
		input: TravelAssistanceBookingInput,
	): Promise<TravelAssistanceRequest> {
		return request(`${API_PREFIX}/applications/travel-assistance/${id}/booking`, {
			method: "POST",
			...json(input),
		});
	},
};

export const applicantsApi = {
	list(): Promise<{ applicants: ApiApplicant[]; total: number }> {
		return request(`${API_PREFIX}/applicants`);
	},
	get(id: string): Promise<ApiApplicant> {
		return request(`${API_PREFIX}/applicants/${id}`);
	},
};

export const meApi = {
	identity(): Promise<{ isStaff: boolean; isApplicant: boolean; isBanned: boolean }> {
		return request(`${API_PREFIX}/me/identity`);
	},

	fees(): Promise<FeeSchedule> {
		return request(`${API_PREFIX}/fees`);
	},

	application(): Promise<{
		applicant: ApiApplicant | null;
		consultation: ApiConsultation | null;
		application: ApiApplication | null;
	}> {
		return request(`${API_PREFIX}/me/application`);
	},

	/**
	 * List invoices belonging to the signed-in user. This is the applicant-portal
	 * path; it does not require staff module permissions.
	 */
	invoices(query?: { status?: string; type?: string; q?: string; limit?: number; offset?: number }): Promise<{ invoices: ApiInvoice[]; total: number }> {
		const params = new URLSearchParams();
		if (query?.status) params.set("status", query.status);
		if (query?.type) params.set("type", query.type);
		if (query?.q) params.set("q", query.q);
		if (query?.limit) params.set("limit", String(query.limit));
		if (query?.offset) params.set("offset", String(query.offset));
		const qs = params.toString();
		return request(`${API_PREFIX}/me/invoices${qs ? `?${qs}` : ""}`);
	},

	/**
	 * Stage consent — the applicant's explicit decision to start, hold, or opt
	 * out of a major journey stage. Only "continue" sends the case to Ops for
	 * handler assignment.
	 */
	consent(
		stage: "application" | "visa" | "travel",
		input: { decision: "continue" | "hold" | "opt_out"; reason?: string },
	): Promise<{ consent: unknown }> {
		const path =
			stage === "application"
				? "/application/consent"
				: stage === "visa"
					? "/application/visa/consent"
					: "/application/travel/consent";
		return request(`${API_PREFIX}/me${path}`, { method: "POST", ...json(input) });
	},

	getConsent(stage: "application" | "visa" | "travel"): Promise<{ consent: unknown }> {
		return request(`${API_PREFIX}/me/application/consent/${stage}`);
	},

	/**
	 * Update the signed-in applicant's own profile. The server resolves the
	 * applicant from the session, so no id is sent. `branch` is not accepted
	 * here — that's an ops placement decision.
	 */
	updateProfile(input: UpdateMyProfile): Promise<ApiApplicant> {
		return request(`${API_PREFIX}/me/application`, { method: "PATCH", ...json(input) });
	},

	/** Request a 6-digit OTP to confirm a new email address. */
	requestEmailChange(input: RequestEmailChange): Promise<{ ok: boolean }> {
		return request(`${API_PREFIX}/me/change-email/request`, { method: "POST", ...json(input) });
	},

	/** Confirm the new email address with the OTP sent to it. */
	confirmEmailChange(input: ConfirmEmailChange): Promise<{ ok: boolean; email: string }> {
		return request(`${API_PREFIX}/me/change-email/confirm`, { method: "POST", ...json(input) });
	},

	/** Delete the authenticated user account and their data. */
	deleteAccount(action: "archive" | "purge" | "disconnect"): Promise<{ success: boolean; action: "archive" | "purge" | "disconnect" }> {
		return request(`${API_PREFIX}/me/account`, { method: "DELETE", ...json({ action }) });
	},

	/** Choose the school application package (funding track + degree level). */
	choosePackage(input: ChoosePackage): Promise<ApiApplication> {
		return request(`${API_PREFIX}/me/application/package`, { method: "POST", ...json(input) });
	},

	/** Choose the post-admission payment plan (full or installment). */
	choosePaymentPlan(input: ChoosePaymentPlan): Promise<ApiApplication> {
		return request(`${API_PREFIX}/me/application/payment-plan`, {
			method: "POST",
			...json(input),
		});
	},


	/**
	 * Complete the journey from Payment Execution. The gate is per-plan — full
	 * plans need the agency service fee settled in full, installment plans only
	 * their first installment — plus the ticketing fee, travel clearance, and
	 * the finished pre-departure checklist.
	 */
	completeApplication(): Promise<ApiApplication> {
		return request(`${API_PREFIX}/me/application/complete`, {
			method: "POST",
		});
	},

	/** Get the applicant's current travel assistance request, if any. */
	travelAssistance(): Promise<TravelAssistanceRequest | null> {
		return request(`${API_PREFIX}/me/application/travel-assistance`);
	},

	/** Record the applicant's travel assistance decision (yes/hold/no). */
	recordTravelDecision(
		input: TravelAssistanceDecisionInput,
	): Promise<TravelAssistanceRequest> {
		return request(`${API_PREFIX}/me/application/travel-assistance/decision`, {
			method: "POST",
			...json(input),
		});
	},


	/** Respond to a completed consultation outcome (accept or request more info). */
	respondToOutcome(input: { action: "accept" | "request_info"; note?: string }): Promise<{ ok: boolean }> {
		return request(`${API_PREFIX}/me/application/consultation/respond`, {
			method: "POST",
			...json(input),
		});
	},

	/** Accept a proforma estimate, converting it into a payable invoice. */
	acceptInvoice(invoiceId: string): Promise<ApiInvoice> {
		return request(`${API_PREFIX}/me/invoices/${invoiceId}/accept`, {
			method: "POST",
		});
	},

	/** Open a Paystack hosted checkout for an invoice's outstanding balance. */
	paystackCheckout(invoiceId: string): Promise<PaystackCheckout> {
		return request(`${API_PREFIX}/me/invoices/${invoiceId}/paystack/checkout`, {
			method: "POST",
		});
	},

	/** Verify the Paystack transaction the customer completed on return. */
	paystackVerify(invoiceId: string, reference: string): Promise<PaystackVerifyResponse> {
		return request(`${API_PREFIX}/me/invoices/${invoiceId}/paystack/verify`, {
			method: "POST",
			...json({ reference } satisfies PaystackVerify),
		});
	},

	/**
	 * Open Paystack hosted checkout for the applicant's agency service fee
	 * (Stage IV settlement). The server resolves the agency invoice and amount
	 * from the session — no invoice id is sent. Returns the hosted checkout
	 * URL to redirect the browser to, like `paystackCheckout`.
	 */
	agencyPayment(): Promise<{ authorizationUrl: string }> {
		return request(`${API_PREFIX}/me/application/agency-payment`, {
			method: "POST",
		});
	},

	/** A fresh signed URL for the signed-in user's photo, or null when none is set. */
	avatarUrl(): Promise<AvatarUrl> {
		return request(`${API_PREFIX}/me/avatar`);
	},

	/** Step one of setting a photo: take a signed upload ticket. */
	avatarUploadTicket(input: RequestAvatarUpload): Promise<AvatarUploadTicket> {
		return request(`${API_PREFIX}/me/avatar/upload-url`, { method: "POST", ...json(input) });
	},

	/** Step three: tell the server the bytes landed, committing the photo. */
	avatarComplete(key: string): Promise<AvatarUrl> {
		return request(`${API_PREFIX}/me/avatar/complete`, {
			method: "POST",
			...json({ key }),
		});
	},

	/**
	 * The whole photo upload, as one call — ticket, PUT straight to storage with
	 * progress, then complete. `onProgress` receives 0–100 as bytes go up.
	 */
	async uploadAvatar(
		file: File,
		onProgress?: (percent: number) => void,
	): Promise<AvatarUrl> {
		const ticket = await meApi.avatarUploadTicket({
			fileName: file.name,
			contentType: file.type as RequestAvatarUpload["contentType"],
			sizeBytes: file.size,
		});

		try {
			await putFileWithProgress(
				ticket.uploadUrl,
				file,
				{ "Content-Type": file.type, ...ticket.headers },
				onProgress,
			);
		} catch (err) {
			if (err instanceof ApiError && err.code === "UPLOAD_FAILED") {
				throw new ApiError(
					err.status,
					"UPLOAD_FAILED",
					`Could not upload your photo. The link may have expired — try again.`,
				);
			}
			throw err;
		}

		return meApi.avatarComplete(ticket.key);
	},

	/** Current journey stage and chapter unlocks derived server-side.
	 *
	 * `currentStage` is the coarse `JourneyStage` enum value stored on
	 * `applications.stage` (e.g. "visa_processing"). `portalStage` is the
	 * fine-grained `ProcessStageId` `deriveJourney` produced from it plus the
	 * invoice/school signals — the display position the UI should use. */
	journey(): Promise<DerivedJourney> {
		return request(`${API_PREFIX}/me/journey`);
	},

	/** Advisory pre-commit quotation from the current draft school selection. */
	proceedQuotation(): Promise<ProceedQuotation> {
		return request(`${API_PREFIX}/me/application/quotation`);
	},

	/** Applicant consent: accept the advisory quotation and open the application. */
	proceed(input: ProceedApplication): Promise<AcceptProceedResponse> {
		return request(`${API_PREFIX}/me/application/proceed`, {
			method: "POST",
			...json(input),
		});
	},

	/** Applicant consent: decline to proceed (reversible by an ops re-invite). */
	declineProceed(input?: DeclineProceed): Promise<{ ok: true }> {
		return request(`${API_PREFIX}/me/application/proceed/decline`, {
			method: "POST",
			...json(input ?? {}),
		});
	},

	/** Applicant consent: place application on hold / pause. */
	holdProceed(input?: PauseProceed): Promise<{ ok: true }> {
		return request(`${API_PREFIX}/me/application/proceed/hold`, {
			method: "POST",
			...json(input ?? {}),
		});
	},

	/** Fetch the signed-in applicant's persisted portal state. */
	portalState(): Promise<Record<string, unknown>> {
		return request(`${API_PREFIX}/me/portal-state`);
	},

	/** Merge partial updates into the applicant's portal state. */
	updatePortalState(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
		return request(`${API_PREFIX}/me/portal-state`, { method: "PATCH", ...json(patch) });
	},

	/** Fetch the signed-in applicant's in-app notifications. */
	notifications(): Promise<{ notifications: Array<{ id: string; type: string; title: string; body: string; link: string | null; read: boolean; createdAt: string }> }> {
		return request(`${API_PREFIX}/me/notifications`);
	},

	/** Mark a single notification as read. */
	markNotificationRead(id: string): Promise<{ ok: boolean }> {
		return request(`${API_PREFIX}/me/notifications/${id}/read`, { method: "PATCH" });
	},

	/** Mark all notifications as read. */
	markAllNotificationsRead(): Promise<{ ok: boolean }> {
		return request(`${API_PREFIX}/me/notifications/read-all`, { method: "POST" });
	},

	/** Get or create the applicant's conversation with their assigned consultant. */
	getConversation(): Promise<{ id: string; title: string; consultantName: string | null }> {
		return request(`${API_PREFIX}/me/conversation`);
	},

	/** Fetch messages in the applicant's conversation. */
	getConversationMessages(params?: { limit?: number; before?: string }): Promise<{
		messages: Array<{ id: string; conversationId: string; senderOpsUserId: string | null; senderName: string; content: string; messageType: string; replyToId?: string | null; createdAt: string }>;
		total: number;
		hasMore: boolean;
	}> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.before) qs.set("before", params.before);
		const s = qs.toString();
		return request(`${API_PREFIX}/me/conversation/messages${s ? `?${s}` : ""}`);
	},

	/** Send a message from the applicant into their conversation. */
	sendConversationMessage(content: string): Promise<{
		id: string;
		conversationId: string;
		senderOpsUserId: string | null;
		senderName: string;
		content: string;
		messageType: string;
		replyToId?: string | null;
		createdAt: string;
	}> {
		return request(`${API_PREFIX}/me/conversation/messages`, {
			method: "POST",
			...json({ content }),
		});
	},

	/* ── Context-Aware Case Communication (services/communication.ts) ── */

	/** The full payload the portal Communication Center renders. */
	getCommunicationContext(): Promise<CommunicationContext> {
		return request(`${API_PREFIX}/me/communication/context`);
	},

	/** Route the customer's "Chat" click to the right conversation. */
	routeCommunication(body?: { caseId?: string; stageKey?: string }): Promise<ApiChatConversation> {
		return request(`${API_PREFIX}/me/communication/route`, {
			method: "POST",
			...json(body ?? {}),
		});
	},

	/** List customer-visible conversations. */
	listCommunicationConversations(): Promise<{ conversations: ApiChatConversation[]; total: number }> {
		return request(`${API_PREFIX}/me/communication/conversations`);
	},

	/** Paginated messages in a conversation. */
	getCommunicationMessages(
		conversationId: string,
		params?: { limit?: number; before?: string },
	): Promise<{ messages: ApiChatMessage[]; total: number; hasMore: boolean }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.before) qs.set("before", params.before);
		const s = qs.toString();
		return request(`${API_PREFIX}/me/communication/conversations/${conversationId}/messages${s ? `?${s}` : ""}`);
	},

	/** Send a customer message. */
	sendCommunicationMessage(conversationId: string, content: string): Promise<ApiChatMessage> {
		return request(`${API_PREFIX}/me/communication/conversations/${conversationId}/messages`, {
			method: "POST",
			...json({ content }),
		});
	},

	/** Mark a conversation read. */
	markCommunicationRead(conversationId: string): Promise<{ ok: boolean }> {
		return request(`${API_PREFIX}/me/communication/conversations/${conversationId}/read`, { method: "POST" });
	},
};

export type {
	ContactCard as ApiContactCard,
	PreviousContact as ApiPreviousContact,
	CommunicationContext as ApiCommunicationContext,
};

export const invoicesApi = {
	list(query?: { status?: string; type?: string; q?: string; limit?: number; offset?: number }): Promise<{ invoices: ApiInvoice[]; total: number }> {
		const params = new URLSearchParams();
		if (query?.status) params.set("status", query.status);
		if (query?.type) params.set("type", query.type);
		if (query?.q) params.set("q", query.q);
		if (query?.limit) params.set("limit", String(query.limit));
		if (query?.offset) params.set("offset", String(query.offset));
		const qs = params.toString();
		return request(`${API_PREFIX}/invoices${qs ? `?${qs}` : ""}`);
	},
	get(id: string): Promise<ApiInvoice> {
		return request(`${API_PREFIX}/invoices/${id}`);
	},
	create(body: CreateInvoice): Promise<ApiInvoice> {
		return request(`${API_PREFIX}/invoices`, {
			method: "POST",
			...json(body),
		});
	},
	issue(invoiceId: string, body: IssueProforma): Promise<ApiInvoice> {
		return request(`${API_PREFIX}/invoices/${invoiceId}/issue`, {
			method: "POST",
			...json(body),
		});
	},
	payments(invoiceId: string, body: RecordPayment): Promise<ApiInvoice> {
		return request(`${API_PREFIX}/invoices/${invoiceId}/payments`, {
			method: "POST",
			...json(body),
		});
	},
	void(invoiceId: string, input: string | VoidInvoice): Promise<ApiInvoice> {
		const payload = typeof input === "string" ? { reason: input } : input;
		return request(`${API_PREFIX}/invoices/${invoiceId}/void`, {
			method: "POST",
			...json(payload),
		});
	},

	credit(invoiceId: string, body: CreditInvoice): Promise<ApiInvoice> {
		return request(`${API_PREFIX}/invoices/${invoiceId}/credit`, {
			method: "POST",
			...json(body),
		});
	},
};

/* ── Fee Schedule ────────────────────────────────────────────────────────── */

export const feesApi = {
	/** Live fee schedule (USD cents) from platform_settings. */
	schedule(): Promise<{
		appBaseCents: number;
		appPerSchoolCents: number;
		appDocVerifyCents: number;
		appMatchReviewCents: number;
		visaBaseCents: number;
		visaBiometricsCents: number;
		visaTranslationCents: number;
		consultationCents: number;
	}> {
		return request(`${API_PREFIX}/fees`);
	},
};


/* ── Schools & Applications ──────────────────────────────────────────────── */

export const schoolsApi = {
	/** List the signed-in applicant's school applications. */
	list(): Promise<SchoolApplicationList> {
		return request(`${API_PREFIX}/me/schools`);
	},

	/** List an applicant's school applications (Ops). */
	listForApplicant(applicantId: string): Promise<SchoolApplicationList> {
		return request(`${API_PREFIX}/schools/${applicantId}`);
	},

	/** Add a target school application before locking. */
	add(input: AddSchoolApplication): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/me/schools`, { method: "POST", ...json(input) });
	},

	/** Remove a school application before locking. */
	remove(id: string): Promise<void> {
		return request(`${API_PREFIX}/me/schools/${id}`, { method: "DELETE" });
	},

	/** Lock school selections — raises Stage II application invoice on server. */
	lock(input: LockSchools = {}): Promise<SchoolApplicationList> {
		return request(`${API_PREFIX}/me/schools/lock`, { method: "POST", ...json(input) });
	},

	/** Staff: remove a school still being prepared. */
	removeByStaff(id: string): Promise<void> {
		return request(`${API_PREFIX}/schools/${id}`, { method: "DELETE" });
	},

	/** Staff: record that the client is going with this admitted school. */
	acceptOffer(id: string): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/schools/${id}/accept`, { method: "POST" });
	},

	/** Applicant: accept this admitted school's offer. */
	meAcceptOffer(id: string): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/me/schools/${id}/accept`, { method: "POST" });
	},

	/** Staff: update an application track status, handler note, or timeline event. */
	updateStatus(id: string, input: UpdateSchoolStatus): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/schools/${id}/status`, { method: "PATCH", ...json(input) });
	},

	/**
	 * Staff: request a signed upload URL for an admission/offer letter. The
	 * server builds the storage key from the applicant's name so the vault has
	 * a sensible folder layout. PUT the file to `uploadUrl`, then call
	 * `completeAdmissionLetter` with the returned `storageKey`.
	 */
	requestAdmissionLetterUpload(
		id: string,
		input: { fileName: string; contentType: string },
	): Promise<{ uploadUrl: string; storageKey: string; expiresAt: string; headers?: Record<string, string> }> {
		return request(`${API_PREFIX}/schools/${id}/admission-letter/upload-url`, {
			method: "POST",
			...json(input),
		});
	},

	/** Staff: confirm an admission-letter upload landed and attach it to the row. */
	completeAdmissionLetterUpload(
		id: string,
		storageKey: string,
	): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/schools/${id}/admission-letter/complete`, {
			method: "POST",
			...json({ storageKey }),
		});
	},

	/** Staff: remove an admission letter from the row and storage. */
	removeAdmissionLetter(id: string): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/schools/${id}/admission-letter`, { method: "DELETE" });
	},

	/** Staff: get a short-lived signed download URL for an admission letter. */
	admissionLetterDownloadUrl(id: string): Promise<{ url: string; expiresAt: string }> {
		return request(`${API_PREFIX}/schools/${id}/admission-letter/download`);
	},

	/** Applicant: get a short-lived signed download URL for an admission letter. */
	meAdmissionLetterDownloadUrl(id: string): Promise<{ url: string; expiresAt: string }> {
		return request(`${API_PREFIX}/me/schools/${id}/admission-letter/download`);
	},

	/* ── Files on a school row, by kind: the offer letter or the submission proof ── */

	requestFileUpload(
		id: string,
		kind: SchoolFileKind,
		input: { fileName: string; contentType: string },
	): Promise<{ uploadUrl: string; storageKey: string; expiresAt: string; headers?: Record<string, string> }> {
		return request(`${API_PREFIX}/schools/${id}/${SCHOOL_FILE_PATH[kind]}/upload-url`, { method: "POST", ...json(input) });
	},
	completeFileUpload(id: string, kind: SchoolFileKind, storageKey: string): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/schools/${id}/${SCHOOL_FILE_PATH[kind]}/complete`, { method: "POST", ...json({ storageKey }) });
	},
	removeFile(id: string, kind: SchoolFileKind): Promise<SchoolApplication> {
		return request(`${API_PREFIX}/schools/${id}/${SCHOOL_FILE_PATH[kind]}`, { method: "DELETE" });
	},
	fileDownloadUrl(id: string, kind: SchoolFileKind): Promise<{ url: string; expiresAt: string }> {
		return request(`${API_PREFIX}/schools/${id}/${SCHOOL_FILE_PATH[kind]}/download`);
	},
	meFileDownloadUrl(id: string, kind: SchoolFileKind): Promise<{ url: string; expiresAt: string }> {
		return request(`${API_PREFIX}/me/schools/${id}/${SCHOOL_FILE_PATH[kind]}/download`);
	},

	/**
	 * Staff: the whole upload of one file on a school row, as one call —
	 * ticket, PUT straight to storage with progress, then complete.
	 * `onProgress` receives 0–100 as bytes go up. Returns the updated row.
	 */
	async uploadFile(
		id: string,
		kind: SchoolFileKind,
		file: File,
		onProgress?: (percent: number) => void,
	): Promise<SchoolApplication> {
		const ticket = await schoolsApi.requestFileUpload(id, kind, {
			fileName: file.name,
			contentType: file.type as RequestUpload["contentType"],
		});

		try {
			await putFileWithProgress(
				ticket.uploadUrl,
				file,
				{ "Content-Type": file.type, ...ticket.headers },
				onProgress,
			);
		} catch (err) {
			if (err instanceof ApiError && err.code === "UPLOAD_FAILED") {
				throw new ApiError(
					err.status,
					"UPLOAD_FAILED",
					`Could not upload ${file.name}. The link may have expired — try again.`,
				);
			}
			throw err;
		}

		return schoolsApi.completeFileUpload(id, kind, ticket.storageKey);
	},

	/** Staff: the offer letter upload — `uploadFile` for the "offer-letter" kind. */
	uploadAdmissionLetter(id: string, file: File, onProgress?: (percent: number) => void): Promise<SchoolApplication> {
		return schoolsApi.uploadFile(id, "offer-letter", file, onProgress);
	},
};

/** URL segment per file kind — the offer letter keeps its historical path. */
const SCHOOL_FILE_PATH: Record<SchoolFileKind, string> = {
	"offer-letter": "admission-letter",
	"submission-proof": "submission-proof",
};

/* ── CRM Leads ─────────────────────────────────────────────────────────── */

export const leadsApi = {
	list(params?: { stage?: string; search?: string }): Promise<{
		leads: Array<{
			id: string;
			name: string;
			email: string;
			phone: string | null;
			source: string;
			stage: string;
			targetCountry: string | null;
			assignedStaffId: string | null;
			assignedStaffName: string | null;
			consultationId: string | null;
			applicationId: string | null;
			notes: string | null;
			createdAt: string;
			updatedAt: string;
		}>;
	}> {
		const query = new URLSearchParams();
		if (params?.stage) query.set("stage", params.stage);
		if (params?.search) query.set("search", params.search);
		const qs = query.toString();
		return request(`${API_PREFIX}/leads${qs ? `?${qs}` : ""}`);
	},

	getEvents(leadId: string): Promise<{
		events: Array<{
			id: string;
			leadId: string;
			type: string;
			actorName: string | null;
			payload: unknown;
			createdAt: string;
		}>;
		total: number;
	}> {
		return request(`${API_PREFIX}/leads/${leadId}/events`);
	},

	update(
		leadId: string,
		patch: Partial<{
			name: string;
			email: string;
			phone: string | null;
			stage: string;
			targetCountry: string | null;
			assignedStaffId: string | null;
			consultationId: string | null;
			applicationId: string | null;
			notes: string | null;
		}>,
	): Promise<{
		id: string;
		name: string;
		email: string;
		phone: string | null;
		source: string;
		stage: string;
		targetCountry: string | null;
		assignedStaffId: string | null;
		assignedStaffName: string | null;
		consultationId: string | null;
		applicationId: string | null;
		notes: string | null;
		createdAt: string;
		updatedAt: string;
	}> {
		return request(`${API_PREFIX}/leads/${leadId}`, {
			method: "PATCH",
			...json(patch),
		});
	},
};

/* ── Payments Gateway (Paystack / Stripe) ────────────────────────────────── */

export const paymentsApi = {
	/** Initialize a real payment intent for an invoice (Paystack or Stripe). */
	initialize(input: InitializePayment): Promise<InitializePaymentResponse> {
		return request(`${API_PREFIX}/payments/initialize`, { method: "POST", ...json(input) });
	},

	/** Verify transaction reference directly. */
	verify(reference: string, gateway: "paystack" | "stripe" = "paystack"): Promise<PaymentVerificationResult> {
		return request(`${API_PREFIX}/payments/verify/${encodeURIComponent(reference)}?gateway=${gateway}`);
	}
};

/* ── Service Packages API ─────────────────────────────────────────────────── */

export const packagesApi = {
	/** List all active service packages. */
	list(): Promise<{ packages: ServicePackage[] }> {
		return request(`${API_PREFIX}/packages`, { method: "GET" });
	},
	/** Get a single service package by code. */
	get(code: string): Promise<{ package: ServicePackage }> {
		return request(`${API_PREFIX}/packages/${code}`, { method: "GET" });
	},
};

