import { API_PREFIX } from "century-nit-shared";
import type { SchoolApplication, SchoolApplicationList } from "century-nit-shared";
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

export function signIn(email: string, password: string): Promise<SignInResponse> {
	return apiFetch<SignInResponse>("/api/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email, password }),
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

/* ── Invoices ── */

export type ApiInvoice = {
	id: string;
	invoiceNumber: string;
	status: "proforma" | "issued" | "partial" | "paid" | "overdue" | "void";
	type: "application" | "visa" | "consultation" | "custom";
	applicantName: string;
	applicantEmail: string | null;
	clientUserId: string | null;
	lines: { id: string; label: string; detail: string | null; amountCents: number }[];
	subtotalCents: number;
	paidCents: number;
	creditedCents: number;
	balanceCents: number;
	note: string | null;
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
	q?: string;
	limit?: number;
	offset?: number;
}): Promise<InvoiceListResponse> {
	const qs = new URLSearchParams();
	if (params?.status) qs.set("status", params.status);
	if (params?.type) qs.set("type", params.type);
	if (params?.q) qs.set("q", params.q);
	if (params?.limit) qs.set("limit", String(params.limit));
	if (params?.offset) qs.set("offset", String(params.offset));
	const query = qs.toString();
	return apiFetch<InvoiceListResponse>(`${API_PREFIX}/invoices${query ? `?${query}` : ""}`);
}

export function getInvoice(id: string): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/invoices/${id}`);
}

export function createInvoice(body: {
	applicantName: string;
	applicantEmail?: string;
	clientUserId?: string;
	type: "application" | "visa" | "consultation" | "custom";
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
		lines: { label: string; detail?: string; amountCents: number }[];
		note?: string;
		dueAt?: string;
	},
): Promise<ApiInvoice> {
	return apiFetch<ApiInvoice>(`${API_PREFIX}/invoices/${id}/issue`, {
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

export function listChatConversations(): Promise<ChatConversationListResponse> {
	return apiFetch<ChatConversationListResponse>(`${CHAT}/conversations`);
}

export function createChatConversation(body: {
	participantOpsUserId?: string;
	linkedEntityType?: string;
	linkedEntityId?: string;
	title?: string;
	participantOpsUserIds?: string[];
	initialMessage?: string;
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
	params?: { limit?: number; before?: string },
): Promise<ChatMessageListResponse> {
	const qs = new URLSearchParams();
	if (params?.limit) qs.set("limit", String(params.limit));
	if (params?.before) qs.set("before", params.before);
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

export type TeamAssignment = {
	id: string;
	type: "case" | "consultation" | "ticket";
	reference: string;
	clientName: string;
	clientEmail: string | null;
	assignedStaffId: string | null;
	assignedStaffName: string | null;
	assignedStaffEmail: string | null;
	stageOrStatus: string;
	stageOrStatusLabel: string;
	priority: string | null;
	updatedAt: string;
	link: string;
};

export function getTeamAssignments(limit = 200): Promise<{ items: TeamAssignment[] }> {
	return apiFetch<{ items: TeamAssignment[] }>(`${API_PREFIX}/team/assignments?limit=${limit}`);
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

