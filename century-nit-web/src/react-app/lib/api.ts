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

/* MFA enrollment (optional for clients) */

export type MfaEnrollmentStatus = {
	enrolled: boolean;
	method: string | null;
	required: boolean;
	availableMethods: string[];
	/** Whether the account holds a credential password. Drives which enrol paths are open. */
	hasPassword?: boolean;
	/**
	 * Passwordless accounts enrolled in email-otp MFA must pass a code per
	 * session. The plugin's own challenge never fires on OAuth callbacks.
	 */
	challengeRequired?: boolean;
	/**
	 * Whether a second factor can be set up for this account. False only for
	 * passwordless accounts when email-otp MFA is switched off. A password
	 * account can always enrol, and a social account can via email code.
	 */
	applicable: boolean;
};

export function getMfaEnrollment(): Promise<MfaEnrollmentStatus> {
	return apiFetch<MfaEnrollmentStatus>("/api/v1/auth-settings/mfa");
}

export function enrollMfa(
	method: "totp" | "email_otp",
	password?: string,
): Promise<{
	totpURI?: string;
	backupCodes?: string[];
	message?: string;
	email?: string;
}> {
	return apiFetch("/api/v1/auth-settings/mfa/enroll", {
		method: "POST",
		body: JSON.stringify(password ? { method, password } : { method }),
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

/** Verify the per-session email code that gates passwordless MFA sign-ins. */
export function verifyMfaOtp(code: string): Promise<{ success: boolean }> {
	return apiFetch("/api/v1/auth-settings/mfa/verify-otp", {
		method: "POST",
		body: JSON.stringify({ code }),
	});
}
