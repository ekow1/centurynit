import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import {
	AUTH_ERROR_CODES,
	mfaRequiredForRole,
	roleCanAccess,
	type OpsModule,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { opsUsers, users } from "../db/schema.js";
import { authInstance } from "../routes/auth.js";
import { HttpError } from "./error.js";

/**
 * Authentication and authorisation for the scheduling API.
 *
 * There is exactly one authentication system — Better Auth — and this reads the
 * session it already issues. Staff are not a second login: a staff member is a
 * Better Auth user who also has an `ops_users` row linked by `user_id`, which is
 * where their role and branch live.
 *
 * Everything here derives identity from the session cookie. A role, employee id
 * or client id sent in a request body is never trusted (§16).
 */

export type SessionUser = {
	id: string;
	email: string;
	name: string | null;
};

/** Staff identity, resolved from the session — never from client input. */
export type StaffContext = {
	opsUserId: string;
	role: string;
	branch: string | null;
	name: string;
	email: string;
};

export type AuthVariables = {
	requestId: string;
	user: SessionUser;
	staff: StaffContext | null;
};

/**
 * Populates `user` from the Better Auth session. 401 when absent.
 *
 * `staff` is resolved eagerly here rather than in `requireStaff`, so a handler
 * can cheaply branch on whether the caller is staff without a second query.
 */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
	const session = await authInstance.api.getSession({ headers: c.req.raw.headers });

	if (!session?.user) {
		throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue");
	}

	c.set("user", {
		id: session.user.id,
		email: session.user.email,
		name: session.user.name ?? null,
	});

	const [staff] = await db
		.select()
		.from(opsUsers)
		.where(eq(opsUsers.userId, session.user.id))
		.limit(1);

	c.set(
		"staff",
		staff && staff.active
			? {
					opsUserId: staff.id,
					role: staff.role,
					branch: staff.branch,
					name: staff.name,
					email: staff.email,
				}
			: null,
	);

	await next();
};

/** Any active staff member. Applicants get 403. */
export const requireStaff: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
	if (!c.get("staff")) {
		throw new HttpError(403, "FORBIDDEN", "Staff access required");
	}
	await next();
};

/**
 * Staff must hold a second factor before reaching applicant data.
 *
 * Enforced here rather than only in the ops app, because a UI gate is a
 * suggestion: the API is what actually holds the records. Enrolment routes
 * themselves are exempt, or a staff member could never get past this — that
 * exemption is why this is a separate middleware from `requireStaff` and is
 * applied per route group rather than globally.
 *
 * Clients are untouched: `mfaRequiredForRole` is false without a staff role, so
 * an applicant is never blocked from booking.
 */
export const requireMfa: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
	const staff = c.get("staff");
	const user = c.get("user");

	if (!mfaRequiredForRole(staff?.role)) {
		await next();
		return;
	}

	const [row] = await db
		.select({ twoFactorEnabled: users.twoFactorEnabled })
		.from(users)
		.where(eq(users.id, user.id))
		.limit(1);

	if (!row?.twoFactorEnabled) {
		throw new HttpError(
			403,
			AUTH_ERROR_CODES.MFA_NOT_ENROLLED,
			"Set up two-factor authentication before continuing",
		);
	}

	await next();
};

/**
 * Restrict to specific staff roles.
 *
 * Assignment is manager/coordinator only (§16), matching ASSIGN_WORK in the ops
 * app's permission matrix. The React copy of that matrix still hides UI; this is
 * the authority.
 */
export function requireRole(
	...roles: string[]
): MiddlewareHandler<{ Variables: AuthVariables }> {
	return async (c, next) => {
		const staff = c.get("staff");
		if (!staff) {
			throw new HttpError(403, "FORBIDDEN", "Staff access required");
		}
		if (!roles.includes(staff.role)) {
			throw new HttpError(
				403,
				"FORBIDDEN",
				`This action requires one of: ${roles.join(", ")}`,
			);
		}
		await next();
	};
}

/**
 * Restrict a route to staff whose role is granted a module in the shared
 * `ROLE_PERMISSIONS` matrix (century-nit-shared).
 *
 * This is the server-side twin of the ops app's `hasPermission` — the React
 * copy hides UI, this one is the authority. Use it on every staff-facing
 * resource route:
 *
 *   app.use("/api/v1/invoices/*", requireAuth, requireModule("invoices"));
 */
export function requireModule(
	module: OpsModule,
): MiddlewareHandler<{ Variables: AuthVariables }> {
	return async (c, next) => {
		const staff = c.get("staff");
		if (!staff) {
			throw new HttpError(403, "FORBIDDEN", "Staff access required");
		}
		if (!roleCanAccess(staff.role, module)) {
			throw new HttpError(
				403,
				"FORBIDDEN",
				`Your role does not include the "${module}" module`,
			);
		}
		await next();
	};
}

/**
 * Whether this caller may see a booking.
 *
 * Clients see only their own. Managers, coordinators and finance see all.
 * A consultant sees only what is assigned to them — the same row-level rule the
 * ops UI applies client-side, now enforced where the user cannot reach it.
 */
export function canViewBooking(
	booking: { clientUserId: string; employeeId: string | null },
	user: SessionUser,
	staff: StaffContext | null,
): boolean {
	if (booking.clientUserId === user.id) return true;
	if (!staff) return false;
	if (staff.role === "manager" || staff.role === "coordinator" || staff.role === "finance") {
		return true;
	}
	if (staff.role === "consultant") return booking.employeeId === staff.opsUserId;
	return false;
}

/** Who may reschedule or cancel: the client themselves, or staff who route work. */
export function canModifyBooking(
	booking: { clientUserId: string; employeeId: string | null },
	user: SessionUser,
	staff: StaffContext | null,
): boolean {
	if (booking.clientUserId === user.id) return true;
	if (!staff) return false;
	if (staff.role === "manager" || staff.role === "coordinator") return true;
	if (staff.role === "consultant") return booking.employeeId === staff.opsUserId;
	return false;
}
