import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Hook } from "@hono/zod-openapi";
import { ZodError } from "zod";
import { env } from "../env.js";
import {
	StorageError,
	StorageNotConfiguredError,
} from "../services/storage/types.js";

/**
 * An error with a stable, client-facing code.
 *
 * The code is part of the API contract — callers branch on it (SLOT_TAKEN in
 * particular, see §11). The message is for humans and may change.
 */
export class HttpError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "HttpError";
	}
}

type ErrorBody = {
	error: { code: string; message: string; details?: unknown };
	requestId: string;
	timestamp: string;
};

function body(
	code: string,
	message: string,
	requestId: string,
	details?: unknown,
): ErrorBody {
	return {
		error: details === undefined ? { code, message } : { code, message, details },
		requestId,
		timestamp: new Date().toISOString(),
	};
}

/**
 * `defaultHook` for every `OpenAPIHono` router and bare `zValidator` call.
 *
 * Without it the validator answers `c.json(result, 400)` — the failed parse
 * result serialised wholesale, `{ issues, name: "ZodError" }` — which never
 * reaches `errorHandler` and leaks Zod internals to the client. Returning the
 * standard envelope here keeps validation failures on the same contract as
 * `HttpError`, with the first issue as the message so toasts read like a
 * sentence instead of a stack trace.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validationHook: Hook<any, any, any, any> = (result, c) => {
	if (result.success) return;
	const details = result.error.issues.map((i) => ({
		path: i.path.join("."),
		message: i.message,
	}));
	const first = details[0];
	const message = !first
		? "Request validation failed"
		: first.path
			? `${first.path}: ${first.message}`
			: first.message;
	return c.json(
		body(
			"VALIDATION_ERROR",
			message,
			(c.get("requestId") as string | undefined) ?? "",
			details,
		),
		400,
	);
};

export const errorHandler: ErrorHandler<{ Variables: { requestId: string } }> = (err, c) => {
	const requestId = c.get("requestId");

	// Deliberate, typed failures — expected control flow, not incidents.
	if (err instanceof HttpError) {
		if (err.status >= 500) console.error(`[requestId=${requestId}]`, err);
		return c.json(
			body(err.code, err.message, requestId, err.details),
			err.status as 400,
		);
	}

	// Request validation from @hono/zod-openapi.
	if (err instanceof ZodError) {
		return c.json(
			body(
				"VALIDATION_ERROR",
				"Request validation failed",
				requestId,
				err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
			),
			400,
		);
	}

	if (err instanceof HTTPException) {
		return c.json(body("HTTP_ERROR", err.message, requestId), err.status);
	}

	// Document storage failures are operational, not programming errors: the
	// caller should see "storage is not configured" or the provider's message
	// (e.g. "Object not found", "signature verification failed") — not a bare
	// "Internal server error" that says nothing about which system failed.
	// Surfaced here so every storage call site gets it, not just the download
	// route where it was first noticed.
	if (err instanceof StorageNotConfiguredError) {
		return c.json(
			body(
				"STORAGE_NOT_CONFIGURED",
				"Document storage is not configured on this server.",
				requestId,
			),
			503,
		);
	}
	if (err instanceof StorageError) {
		console.error(`[requestId=${requestId}] storage error:`, err.message);
		return c.json(body("STORAGE_ERROR", err.message, requestId), 502);
	}

	console.error(`[requestId=${requestId}]`, err);
	return c.json(
		body(
			"INTERNAL_SERVER_ERROR",
			env.NODE_ENV === "production" ? "Internal server error" : err.message,
			requestId,
		),
		500,
	);
};
