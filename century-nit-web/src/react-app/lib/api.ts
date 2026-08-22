export class ApiError extends Error {
	constructor(
		public status: number,
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
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});
	if (!res.ok) {
		const body = await res.text();
		throw new ApiError(res.status, body || res.statusText);
	}
	return res.json() as Promise<T>;
}

export type HealthResponse = {
	ok: boolean;
	status: string;
	database: string;
};

export async function getHealth(): Promise<HealthResponse> {
	return apiFetch<HealthResponse>("/api/health");
}

export type PortalAuthSettings = {
	email_password: boolean;
	social_google: boolean;
	email_otp: boolean;
	mfa_required: boolean;
	mfa_methods: ("totp" | "email_otp")[];
};

export type AuthSettingsResponse = {
	portal: PortalAuthSettings;
	/** Ops settings are only returned by the staff-gated endpoint; absent on
	 * the public portal-facing response. */
	ops?: {
		email_password: boolean;
		google_sso: boolean;
		mfa_required: boolean;
		mfa_methods: ("totp" | "email_otp")[];
	};
};

export async function getAuthSettings(): Promise<AuthSettingsResponse> {
	return apiFetch<AuthSettingsResponse>("/api/v1/auth-settings/portal");
}

/* ── MFA enrollment (optional for clients) ───────────────────────────────── */

export type MfaEnrollmentStatus = {
	enrolled: boolean;
	method: string | null;
	required: boolean;
	availableMethods: string[];
};

export function getMfaEnrollment(): Promise<MfaEnrollmentStatus> {
	return apiFetch<MfaEnrollmentStatus>("/api/v1/auth-settings/mfa");
}

export function enrollMfa(
	method: "totp" | "email_otp",
	password: string,
): Promise<{
	totpURI?: string;
	backupCodes?: string[];
	message?: string;
	email?: string;
}> {
	return apiFetch("/api/v1/auth-settings/mfa/enroll", {
		method: "POST",
		body: JSON.stringify({ method, password }),
	});
}

export function confirmMfaOtp(code: string): Promise<{ success: boolean }> {
	return apiFetch("/api/v1/auth-settings/mfa/confirm", {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}

export function sendMfaOtp(): Promise<{ sent: boolean }> {
	return apiFetch("/api/v1/auth-settings/mfa/send-otp", { method: "POST" });
}
