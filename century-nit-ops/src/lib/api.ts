import { API_PREFIX } from "century-nit-shared";
import type { ApplicationActivityResponse, SchoolApplication, SchoolApplicationList } from "century-nit-shared";
/**
 * Thin fetch wrapper for the ops app.
 *
 * Requests are always same-origin `/api/*`. Resource routes carry the version
 * prefix (API_PREFIX); `/api/auth` and `/api/health` deliberately do not.
 * In development Vite proxies them to
 * the API; in production the console Worker does (see src/worker/index.ts).
 *
 * Never call the API's origin directly from here. Better Auth's session cookie
 * would then be third-party — blocked by Safari and Firefox, and being phased
 * out in Chrome — so staff would appear signed out on every navigation no matter
 * what `credentials: "include"` says. Proxying keeps the cookie first-party,
 * needs no CORS, and keeps the API address a deploy-time variable rather than
 * something baked into this bundle.
 */

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
	) {
		super(message);
	}
}

export async function apiFetch<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const res = await fetch(path, {
		...init,
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});

	if (!res.ok) {
		let code = "UNKNOWN";
		let message = res.statusText;
		try {
			const body = await res.json();
			code = body?.error?.code ?? body?.code ?? code;
			message = body?.error?.message ?? body?.message ?? message;
		} catch {
			// non-JSON error body
		}
		/*
		 * The API's MFA gates answer 403 on every business route when the
		 * session owes enrolment (requireMfa) or a second-factor challenge
		 * (requireAuth's OAuth gate). OpsRequireAuth normally redirects before
		 * data calls fire — this catches the ones that slip past it (layout
		 * hooks, a role changed mid-session), so the user lands on the remedy
		 * screen instead of watching every request fail. A full navigation
		 * also drops any stale sessionStorage state. The pathname guard keeps
		 * the remedy pages' own calls from bouncing them back onto themselves.
		 */
		if (res.status === 403 && !location.pathname.startsWith("/mfa-")) {
			if (code === "MFA_NOT_ENROLLED") {
				location.assign("/mfa-setup");
			} else if (code === "MFA_CHALLENGE_REQUIRED") {
				location.assign("/mfa-challenge");
			}
		}
		throw new ApiError(res.status, code, message);
	}

	return res.json() as Promise<T>;
}

/* ── Auth ── */

export type SessionResponse = {
	user: { id: string; email: string; name: string | null } | null;
	staff: {
		opsUserId: string;
		role: string;
		branch: string | null;
		name: string;
		email: string;
	} | null;
	/** Admin-set inactivity limit (auth policy) the console's idle guard enforces. */
	idleHours?: number | null;
};

export function getSession(): Promise<SessionResponse> {
	return apiFetch<SessionResponse>("/api/auth/me");
}

export type SignInResponse = {
	twoFactorRedirect?: boolean;
	twoFactorMethods?: string[];
	user?: unknown;
	session?: unknown;
};

export function signIn(email: string, password: string, rememberMe?: boolean): Promise<SignInResponse> {
	return apiFetch<SignInResponse>("/api/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email, password, rememberMe }),
	});
}

export function verifyTotp(code: string): Promise<unknown> {
	return apiFetch("/api/auth/two-factor/verify-totp", {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

export function verifyBackupCode(code: string): Promise<unknown> {
	return apiFetch("/api/auth/two-factor/verify-backup-code", {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

/**
 * The enrolled MFA method while sign-in waits on the second factor.
 *
 * Between the password step and verification there is no session — only the
 * signed two-factor cookie Better Auth set. `/api/auth/mfa/method` reads it
 * server-side and answers which challenge to render; `getMfaEnrollment`
 * cannot do this job because it requires an established session. Throws
 * (401) when there is no pending challenge — callers fall back to TOTP.
 */
export type PendingMfaMethod = {
	method: "totp" | "email_otp" | null;
	email: string | null;
};

export function getPendingMfaMethod(): Promise<PendingMfaMethod> {
	return apiFetch<PendingMfaMethod>("/api/auth/mfa/method");
}

/**
 * Send the second-factor email code during the sign-in challenge.
 *
 * This is Better Auth's own `/two-factor/send-otp`, which works in the
 * pending two-factor window via the two_factor cookie. The custom
 * `/auth-settings/mfa/send-otp` endpoint cannot serve this flow — it sits
 * behind requireAuth and there is no session yet.
 */
export function sendTwoFactorOtp(): Promise<{ status?: boolean }> {
	return apiFetch<{ status?: boolean }>("/api/auth/two-factor/send-otp", {
		method: "POST",
	});
}

/** Verify the emailed second-factor code; on success the session is issued. */
export function verifyTwoFactorOtp(code: string): Promise<unknown> {
	return apiFetch("/api/auth/two-factor/verify-otp", {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

export function signOut(): Promise<unknown> {
	return apiFetch("/api/auth/sign-out", {
		method: "POST",
		body: JSON.stringify({}),
	});
}

/* ── Password reset (staff forgot-password) ── */

/**
 * Request a password reset email. Better Auth's `sendResetPassword` callback
 * sends a link containing a one-time token; when clicked, the API verifies the
 * token and redirects to `redirectTo` with `?token=...` appended for the
 * reset page to consume.
 */
export function requestPasswordReset(email: string, redirectTo: string): Promise<{ status?: boolean }> {
	return apiFetch<{ status?: boolean }>("/api/auth/request-password-reset", {
		method: "POST",
		body: JSON.stringify({ email, redirectTo }),
	});
}

/** Real-time check whether an email belongs to an active staff account. */
export function checkStaffEmail(email: string): Promise<{ isStaff: boolean }> {
	return apiFetch<{ isStaff: boolean }>("/api/auth/check-staff-email", {
		method: "POST",
		body: JSON.stringify({ email }),
	});
}

/** Set a new password using the token from the reset email. */
export function resetPassword(token: string, newPassword: string): Promise<{ status?: boolean }> {
	return apiFetch<{ status?: boolean }>("/api/auth/reset-password", {
		method: "POST",
		body: JSON.stringify({ token, newPassword }),
	});
}

/* ── Auth Settings ── */

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
	/** Account holds a credential (password) row — TOTP enrolment needs one. */
	hasPassword: boolean;
	/** Session exists but has not proven its second factor (e.g. Google SSO). */
	challengeRequired: boolean;
	/** Whether this account can enrol at all (password or email_otp allowed). */
	applicable: boolean;
};

export function getAuthSettings(): Promise<AuthSettingsResponse> {
	return apiFetch<AuthSettingsResponse>(`${API_PREFIX}/auth-settings`);
}

export function updateAuthSettings(patch: {
	portal?: Partial<AuthSettingsResponse["portal"]>;
	ops?: Partial<AuthSettingsResponse["ops"]>;
}): Promise<AuthSettingsResponse> {
	return apiFetch<AuthSettingsResponse>(`${API_PREFIX}/auth-settings`, {
		method: "PUT",
		body: JSON.stringify(patch),
	});
}

export function getMfaEnrollment(): Promise<MfaEnrollmentStatus> {
	return apiFetch<MfaEnrollmentStatus>(`${API_PREFIX}/auth-settings/mfa`);
}

export function enrollMfa(method: "totp" | "email_otp", password: string): Promise<{
	totpURI?: string;
	backupCodes?: string[];
	message?: string;
	email?: string;
}> {
	return apiFetch(`${API_PREFIX}/auth-settings/mfa/enroll`, {
		method: "POST",
		body: JSON.stringify({ method, password }),
	});
}

export function confirmMfaOtp(code: string): Promise<{ success: boolean }> {
	return apiFetch(`${API_PREFIX}/auth-settings/mfa/confirm`, {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

export function sendMfaOtp(): Promise<{ sent: boolean }> {
	return apiFetch(`${API_PREFIX}/auth-settings/mfa/send-otp`, {
		method: "POST",
	});
}

export function verifyMfaOtp(code: string): Promise<{ success: boolean }> {
	return apiFetch(`${API_PREFIX}/auth-settings/mfa/verify-otp`, {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

/**
 * Verify a TOTP code against an ESTABLISHED session — the challenge that
 * follows a Google SSO sign-in, where the plugin's pending-cookie flow never
 * ran. Marks the session mfa-ok on success.
 */
export function verifySessionTotp(code: string): Promise<{ success: boolean }> {
	return apiFetch(`${API_PREFIX}/auth-settings/mfa/verify-totp`, {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

/* ── Invoices ── */

export type ApiInvoice = {
	id: string;
	invoiceNumber: string;
	status: "proforma" | "issued" | "partial" | "paid" | "overdue" | "void";
	type: "application" | "visa" | "consultation" | "agency" | "travel" | "custom";
	applicantName: string;
	applicantEmail: string | null;
	clientUserId: string | null;
	applicationId: string | null;
	lines: { id: string; label: string; detail: string | null; amountCents: number; schoolApplicationId?: string | null; dueAt?: string | null; dueOn?: string | null }[];
	subtotalCents: number;
	paidCents: number;
	creditedCents: number;
	balanceCents: number;
	note: string | null;
	raisedByName?: string | null;
	raisedAt?: string;
	issuedByName: string;
	reviewedByName?: string | null;
	reviewedAt?: string | null;
	dueAt: string | null;
	voidedAt: string | null;
	voidReason: string | null;
	payments: {
		id: string;
		amountCents: number;
		method: string;
		gateway: string | null;
		reference: string | null;
		recordedByName: string;
		at: string;
	}[];
	history: {
		id: string;
		action: string;
		actor: string | null;
		detail: string | null;
		at: string;
	}[];
	createdAt: string;
	updatedAt: string;
};

export type InvoiceListResponse = {
	invoices: ApiInvoice[];
	total: number;
};

export function listInvoices(params?: {
	status?: string;
	type?: string;
	/** Every invoice raised on one application, all types. */
	applicationId?: string;
	q?: string;
	limit?: number;
	offset?: number;
}): Promise<InvoiceListResponse> {
	const qs = new URLSearchParams();
	if (params?.status) qs.set("status", params.status);
	if (params?.type) qs.set("type", params.type);
	if (params?.applicationId) qs.set("applicationId", params.applicationId);
	if (params?.q) qs.set("q", params.q);
	if (params?.limit) qs.set("limit", String(params.limit));
	if (params?.offset) qs.set("offset", String(params.offset));
	const query = qs.toString();
	return apiFetch<InvoiceListResponse>(`${API_PREFIX}/invoices${query ? `?${query}` : ""}`);
}

/** An application's timeline (comments, ownership, handoffs, invoices, schools…), newest first. */
export function getApplicationActivity(applicationId: string): Promise<ApplicationActivityResponse> {
	return apiFetch<ApplicationActivityResponse>(`${API_PREFIX}/applications/${applicationId}/activity`);
}

export type ConsultationActivityEvent = {
	id: string;
	consultationId: string;
	type: string;
	actorName: string | null;
	payload: unknown;
	createdAt: string;
};

/** A consultation's activity timeline (assignment, scheduling, assessment…), newest first. */
export function getConsultationActivity(consultationId: string): Promise<{ activities: ConsultationActivityEvent[]; total: number }> {
	return apiFetch(`${API_PREFIX}/consultations/${consultationId}/activity`);
}

export function getInvoice(id: string): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/invoices/${id}`);
}

/** Raise an invoice — it is born awaiting approval; issuing is a separate step. */
export function createInvoice(body: {
	applicantName: string;
	applicantEmail?: string;
	clientUserId?: string;
	applicationId?: string;
	type: "application" | "visa" | "consultation" | "agency" | "travel" | "custom";
	lines: { label: string; detail?: string; amountCents: number }[];
	note?: string;
	dueAt?: string;
}): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/invoices`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function issueInvoice(
	id: string,
	body: {
		lines: { label: string; detail?: string; amountCents: number; schoolApplicationId?: string | null }[];
		note?: string;
		dueAt?: string;
	},
): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/invoices/${id}/issue`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export type RaiseLineInput = { label: string; detail?: string; amountCents: number; schoolApplicationId?: string | null };

/**
 * Ops: raise the application invoice — the universities' own fees, paid on
 * the client's behalf, plus any extra-school add-on. `nothingDue` when no
 * school charges anything: the case records it and submissions can start.
 * When the raise sheet sends its edited lines they are billed as sent;
 * without a body the catalogue's lines are used.
 */
export function raiseApplicationInvoice(
	applicationId: string,
	body?: { lines: RaiseLineInput[]; note?: string },
): Promise<{ invoice: ApiInvoice | null; nothingDue: boolean }> {
	return apiFetch<{ invoice: ApiInvoice | null; nothingDue: boolean }>(`${API_PREFIX}/applications/${applicationId}/raise-application-invoice`, {
		method: "POST",
		body: body ? JSON.stringify(body) : undefined,
	});
}

/** The lines the raise sheet starts from — the school list and the catalogue — and what still gates the raise. */
export function applicationInvoicePreview(
	applicationId: string,
): Promise<{ lines: { label: string; detail: string; amountCents: number; schoolApplicationId: string | null }[]; outstandingDocuments: string[] }> {
	return apiFetch(`${API_PREFIX}/applications/${applicationId}/application-invoice-preview`);
}

/** The visa invoice's suggested lines — the destination's tariff. */
export function visaInvoicePreview(
	applicationId: string,
): Promise<{ lines: { label: string; detail: string; amountCents: number }[] }> {
	return apiFetch(`${API_PREFIX}/applications/${applicationId}/visa-invoice-preview`);
}

/** Ops: the visa officer raises the visa invoice — the tariff's lines as edited. */
export function raiseVisaInvoice(
	applicationId: string,
	body: { lines: RaiseLineInput[]; note?: string },
): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/applications/${applicationId}/raise-visa-invoice`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function recordPayment(
	id: string,
	body: {
		amountCents: number;
		method: string;
		gateway?: string;
		reference?: string;
	},
): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/invoices/${id}/payments`, {
		method: "POST",
		body: JSON.stringify(body),
	});

}

export function voidInvoice(
	id: string,
	reason: string,
): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/invoices/${id}/void`, {
		method: "POST",
		body: JSON.stringify({ reason }),
	});
}

export function creditInvoice(
	id: string,
	body: { amountCents: number; reason: string },
): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/invoices/${id}/credit`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

/* ── Chat ── */

export type ChatParticipant = {
	opsUserId: string;
	name: string;
	email: string;
	role: "owner" | "member" | "former";
	lastReadAt: string | null;
	joinedAt: string;
};

export type ChatMessage = import("century-nit-shared").ChatMessage;
export type ChatConversation = import("century-nit-shared").ChatConversation;

export type ChatConversationListResponse = {
	conversations: ChatConversation[];
	total: number;
};

export type ChatMessageListResponse = {
	messages: ChatMessage[];
	total: number;
	hasMore: boolean;
};

export type ChatUnreadResponse = {
	totalUnread: number;
	conversations: { conversationId: string; unreadCount: number }[];
};

export type StaffDirectoryEntry = {
	opsUserId: string;
	name: string;
	email: string;
	role: string;
};

export type StaffDirectoryResponse = {
	staff: StaffDirectoryEntry[];
};

const CHAT = `${API_PREFIX}/chat`;

export function listChatConversations(scope?: "staff" | "desk"): Promise<ChatConversationListResponse> {
	return apiFetch<ChatConversationListResponse>(`${CHAT}/conversations${scope ? `?scope=${scope}` : ""}`);
}

export function createChatConversation(body: {
	participantOpsUserId?: string;
	linkedEntityType?: string;
	linkedEntityId?: string;
	title?: string;
	participantOpsUserIds?: string[];
	initialMessage?: string;
	/** Staff-initiated client thread — the portal user the thread is with. */
	clientUserId?: string;
	/** Journey stage key for a stage-scoped client thread. */
	stageKey?: string;
}): Promise<ChatConversation> {
	return apiFetch<ChatConversation>(`${CHAT}/conversations`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function getChatConversation(id: string): Promise<ChatConversation> {
	return apiFetch<ChatConversation>(`${CHAT}/conversations/${id}`);
}

export function getChatMessages(
	conversationId: string,
	params?: { limit?: number; before?: string; q?: string },
): Promise<ChatMessageListResponse> {
	const qs = new URLSearchParams();
	if (params?.limit) qs.set("limit", String(params.limit));
	if (params?.before) qs.set("before", params.before);
	if (params?.q) qs.set("q", params.q);
	const query = qs.toString();
	return apiFetch<ChatMessageListResponse>(
		`${CHAT}/conversations/${conversationId}/messages${query ? `?${query}` : ""}`,
	);
}

export function sendChatMessage(
	conversationId: string,
	body: {
		content: string;
		replyToId?: string;
		mentions?: string[];
		attachmentIds?: string[];
		clientNonce?: string;
		visibility?: "public" | "internal";
	},
): Promise<ChatMessage> {
	return apiFetch<ChatMessage>(`${CHAT}/conversations/${conversationId}/messages`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function editChatMessage(
	messageId: string,
	body: { content: string },
): Promise<ChatMessage> {
	return apiFetch<ChatMessage>(`${CHAT}/messages/${messageId}`, {
		method: "PATCH",
		body: JSON.stringify(body),
	});
}

export function deleteChatMessage(messageId: string): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${CHAT}/messages/${messageId}`, {
		method: "DELETE",
	});
}

export function toggleChatReaction(
	messageId: string,
	emoji: string,
): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${CHAT}/messages/${messageId}/reactions`, {
		method: "POST",
		body: JSON.stringify({ emoji }),
	});
}

export function forwardChatMessage(
	messageId: string,
	targetConversationIds: string[],
): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${CHAT}/messages/${messageId}/forward`, {
		method: "POST",
		body: JSON.stringify({ targetConversationIds }),
	});
}

export function setChatTyping(
	conversationId: string,
	isTyping: boolean,
): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${CHAT}/conversations/${conversationId}/typing`, {
		method: "POST",
		body: JSON.stringify({ typing: isTyping }),
	});
}

export function markChatConversationRead(conversationId: string): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${CHAT}/conversations/${conversationId}/read`, {
		method: "POST",
	});
}

export function getChatUnread(): Promise<ChatUnreadResponse> {
	return apiFetch<ChatUnreadResponse>(`${CHAT}/unread`);
}

export function addChatParticipant(
	conversationId: string,
	opsUserId: string,
): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${CHAT}/conversations/${conversationId}/participants`, {
		method: "POST",
		body: JSON.stringify({ opsUserId }),
	});
}

export function getStaffDirectory(): Promise<StaffDirectoryResponse> {
	return apiFetch<StaffDirectoryResponse>(`${CHAT}/staff-directory`);
}

export function setChatConversationStatus(
	conversationId: string,
	status: "open" | "closed" | "archived",
): Promise<ChatConversation> {
	return apiFetch<ChatConversation>(`${CHAT}/conversations/${conversationId}/status`, {
		method: "PATCH",
		body: JSON.stringify({ status }),
	});
}

export function setChatConversationOwner(
	conversationId: string,
	opsUserId: string | null,
): Promise<ChatConversation> {
	return apiFetch<ChatConversation>(`${CHAT}/conversations/${conversationId}/owner`, {
		method: "POST",
		body: JSON.stringify({ opsUserId }),
	});
}

/* ── Request layer ──────────────────────────────────────────────────────── */

/** Log a request for a client (phone/walk-in) or an internal staff ticket. */
export function createChatRequest(body: {
	clientUserId?: string;
	category: string;
	subject: string;
	content: string;
	internal?: boolean;
	assigneeOpsUserId?: string;
	priority?: "normal" | "high" | "urgent";
}): Promise<ChatConversation> {
	return apiFetch<ChatConversation>(`${CHAT}/requests`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function setChatWaitingOn(
	conversationId: string,
	waitingOn: "us" | "client" | null,
): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${CHAT}/conversations/${conversationId}/waiting-on`, {
		method: "PATCH",
		body: JSON.stringify({ waitingOn }),
	});
}

export function escalateChatConversation(
	conversationId: string,
	reason: string,
): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${CHAT}/conversations/${conversationId}/escalate`, {
		method: "POST",
		body: JSON.stringify({ reason }),
	});
}

export type CannedReply = {
	id: string;
	label: string;
	body: string;
	scope: "all" | "branch" | "stage";
	scopeValue: string | null;
};

export function listCannedReplies(): Promise<CannedReply[]> {
	return apiFetch<CannedReply[]>(`${CHAT}/canned-replies`);
}

export type DeskStats = {
	open: number;
	waitingOnClient: number;
	unclaimed: number;
	breaching: number;
	medianFirstResponseMinutes: number | null;
	medianResolutionHours: number | null;
	csatAvg: number | null;
	settings: { hoursLabel: string; firstResponseMinutes: number; resolutionHours: number };
};

export function getDeskStats(): Promise<DeskStats> {
	return apiFetch<DeskStats>(`${CHAT}/desk/stats`);
}

export type ChatConversationContext = {
	client: {
		userId: string;
		name: string;
		email: string | null;
		branch: string | null;
		targetCountry: string | null;
		memberSince: string | null;
	} | null;
	cases: { id: string; appNumber: string; stage: string; stageLabel: string; status: string }[];
	money: { type: string; status: string; invoiceNumber: string }[];
	nextAppointment: { startsAt: string; serviceName: string; status: string } | null;
	owner: { opsUserId: string; name: string } | null;
	messageCount: number;
};

export function getChatConversationContext(
	conversationId: string,
): Promise<ChatConversationContext> {
	return apiFetch<ChatConversationContext>(`${CHAT}/conversations/${conversationId}/context`);
}

export type StagedAttachment = {
	attachmentId: string;
	uploadUrl: string;
	headers: Record<string, string>;
	expiresAt: string;
};

export function stageChatAttachment(
	conversationId: string,
	meta: { fileName: string; contentType: string; sizeBytes: number },
): Promise<StagedAttachment> {
	return apiFetch<StagedAttachment>(`${CHAT}/conversations/${conversationId}/attachments`, {
		method: "POST",
		body: JSON.stringify(meta),
	});
}

/** Upload the staged file's bytes to the presigned URL. Returns the id to bind on send. */
export async function uploadStagedAttachment(
	staged: StagedAttachment,
	file: File,
): Promise<string> {
	const res = await fetch(staged.uploadUrl, {
		method: "PUT",
		headers: { "Content-Type": file.type || "application/octet-stream", ...staged.headers },
		body: file,
	});
	if (!res.ok) throw new Error(`Upload failed (${res.status})`);
	return staged.attachmentId;
}

/* ── Client users (portal accounts) ── */

export type ClientUser = {
	id: string;
	name: string;
	email: string;
	phoneNumber: string | null;
	emailVerified: boolean;
	banned: boolean;
	banReason: string | null;
	bannedAt: string | null;
	bannedBy: string | null;
	activeSessionsCount: number;
	lastActiveAt: string;
	status: "active" | "inactive" | "banned" | "unverified" | "registered";
	leadStage: string | null;
	applicantStatus: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ClientListResponse = {
	clients: ClientUser[];
	metrics: {
		total: number;
		active: number;
		inactive: number;
		banned: number;
	};
};

export function listClientUsers(): Promise<ClientListResponse> {
	return apiFetch<ClientListResponse>(`${API_PREFIX}/client-users`);
}

/* ── Communication (context-aware case chat — /communication) ── */

const COMM = `${API_PREFIX}/communication`;

export type StaffPresence = "available" | "busy" | "on_leave" | "offline";

export type StaffDirectoryEntryDetailed = {
	opsUserId: string;
	name: string;
	email: string;
	role: string;
	branch: string | null;
	presence: StaffPresence;
	lastSeenAt?: string | null;
	unreadCount: number;
	activeCaseCount: number;
	currentAssignmentSummary?: string | null;
};

export type StaffDirectoryDetailedResponse = {
	staff: StaffDirectoryEntryDetailed[];
};

export type StageAssignment = {
	id: string;
	applicationId: string;
	stage: string;
	opsUserId: string;
	opsUserName?: string;
	status: "active" | "reassigned" | "on_leave" | "completed";
	assignedAt: string;
	assignedBy?: string | null;
	endedAt?: string | null;
	endedReason?: string | null;
};

export function getCommunicationStaffDirectory(): Promise<StaffDirectoryDetailedResponse> {
	return apiFetch<StaffDirectoryDetailedResponse>(`${COMM}/staff-directory`);
}

export function updateCommunicationPresence(status: StaffPresence): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${COMM}/presence`, {
		method: "POST",
		body: JSON.stringify({ status }),
	});
}

export function communicationHeartbeat(): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`${COMM}/heartbeat`, { method: "POST" });
}

export function createStageAssignment(body: {
	applicationId: string;
	stage: string;
	opsUserId: string;
	reason?: string;
}): Promise<StageAssignment> {
	return apiFetch<StageAssignment>(`${COMM}/stage-assignments`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

/* ── Schools (Ops) ── */

export function listSchoolsForApplicant(applicantId: string): Promise<SchoolApplicationList> {
	return apiFetch<SchoolApplicationList>(`${API_PREFIX}/schools/${applicantId}`);
}

export function updateSchoolStatus(
	id: string,
	body: { status: string; note?: string },
): Promise<SchoolApplication> {
	return apiFetch<SchoolApplication>(`${API_PREFIX}/schools/${id}/status`, {
		method: "PATCH",
		body: JSON.stringify(body),
	});
}

/* ── Paystack Transactions (Ops) ── */

export function fetchPaystackLiveTransactions(): Promise<{ status: boolean; data: any[]; error?: string }> {
	return apiFetch<{ status: boolean; data: any[]; error?: string }>(`${API_PREFIX}/payments/paystack/transactions`);
}

export type ReconcileResult = {
	reconciled: boolean;
	reference: string;
	status: string;
	bookingId: string | null;
	invoiceId: string | null;
	message: string;
};

export function reconcilePaystackTransaction(reference: string): Promise<ReconcileResult> {
	return apiFetch<ReconcileResult>(`${API_PREFIX}/payments/reconcile-paystack`, {
		method: "POST",
		body: JSON.stringify({ reference }),
	});
}

