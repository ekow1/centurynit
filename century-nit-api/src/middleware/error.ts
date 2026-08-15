import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { env } from "../env.js";

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
