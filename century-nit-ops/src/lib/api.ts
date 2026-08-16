import { API_PREFIX } from "century-nit-shared";
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
			code = body?.error?.code ?? code;
			message = body?.error?.message ?? message;
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

export function signIn(email: string, password: string): Promise<unknown> {
	return apiFetch("/api/auth/sign-in/email", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
}

export function signOut(): Promise<unknown> {
	return apiFetch("/api/auth/sign-out", {
		method: "POST",
	});
}

/* ── Invoices ── */

export type ApiInvoice = {
	id: string;
	invoiceNumber: string;
	status: "issued" | "partial" | "paid" | "overdue" | "void";
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
