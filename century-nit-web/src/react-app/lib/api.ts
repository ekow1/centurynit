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
