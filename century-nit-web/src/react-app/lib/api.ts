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
	ops: {
		email_password: boolean;
		google_sso: boolean;
		mfa_required: boolean;
		mfa_methods: ("totp" | "email_otp")[];
	};
};

export async function getAuthSettings(): Promise<AuthSettingsResponse> {
	return apiFetch<AuthSettingsResponse>("/api/auth-settings");
}
