/**
 * Recognising Postgres constraint violations through Drizzle.
 *
 * Drizzle wraps the driver error, so the SQLSTATE lands on `err.cause.code`
 * rather than `err.code`. Checking only the outer object silently misses every
 * violation — a duplicate insert then surfaces as a generic 500 with the failed
 * SQL and its parameters in the message, instead of the 409 the caller can act
 * on. That is exactly the bug this file exists to prevent recurring.
 */

/** unique_violation */
export const PG_UNIQUE_VIOLATION = "23505";
/** exclusion_violation */
export const PG_EXCLUSION_VIOLATION = "23P01";
/** foreign_key_violation */
export const PG_FOREIGN_KEY_VIOLATION = "23503";

/** SQLSTATE for an error, looking through Drizzle's wrapper. */
export function sqlState(err: unknown): string | undefined {
	const outer = err as { code?: string; cause?: unknown };
	if (typeof outer?.code === "string") return outer.code;
	const cause = outer?.cause as { code?: string; cause?: unknown } | undefined;
	if (typeof cause?.code === "string") return cause.code;
	// Two levels is enough in practice, but recurse defensively rather than
	// assume the wrapping depth.
	if (cause?.cause) return sqlState(cause);
	return undefined;
}

/** A unique or exclusion violation — "something already occupies this". */
export function isConflictError(err: unknown): boolean {
	const code = sqlState(err);
	return code === PG_UNIQUE_VIOLATION || code === PG_EXCLUSION_VIOLATION;
}

export function isUniqueViolation(err: unknown): boolean {
	return sqlState(err) === PG_UNIQUE_VIOLATION;
}

/** The name of the constraint that rejected the write, when Postgres reports it. */
export function violatedConstraint(err: unknown): string | undefined {
	const outer = err as { constraint?: string; cause?: { constraint?: string } };
	return outer?.constraint ?? outer?.cause?.constraint;
}
