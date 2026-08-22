import {
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
	boolean,
	integer,
	jsonb,
	pgEnum,
	index,
	uniqueIndex,
	primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
	id: text("id").primaryKey(),
	email: varchar("email", { length: 255 }).notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	name: text("name"),
	image: text("image"),

	/*
	 * Phone sign-in (Better Auth `phoneNumber` plugin).
	 *
	 * Stored in E.164 and unique, so "0241234567" and "+233241234567" cannot
	 * become two accounts for one person — normalisation happens before the write,
	 * because a unique index only helps on a canonical value.
	 */
	phoneNumber: varchar("phone_number", { length: 20 }).unique(),
	phoneNumberVerified: boolean("phone_number_verified").notNull().default(false),

	/**
	 * Whether a second factor is enrolled (Better Auth `twoFactor` plugin).
	 * Whether one is *required* is a property of the staff role, not of the user,
	 * so it is derived rather than stored — see `mfaRequiredForRole`.
	 */
	twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),

	/**
	 * Which MFA method the user chose during enrollment.
	 * "totp" = authenticator app (Better Auth twoFactor plugin)
	 * "email_otp" = email one-time code (custom implementation)
	 * null = MFA not yet enrolled or method not yet chosen.
	 */
	mfaMethod: text("mfa_method"),

	/**
	 * Whether the user has completed MFA enrollment.
	 * Separate from twoFactorEnabled because email_otp users don't use the
	 * twoFactor plugin — this flag covers both methods.
	 */
	mfaEnrolled: boolean("mfa_enrolled").notNull().default(false),

	/**
	 * Access control / suspension.
	 * When banned is true, Better Auth and API reject all session attempts.
	 */
	banned: boolean("banned").notNull().default(false),
	banReason: text("ban_reason"),
	bannedAt: timestamp("banned_at", { withTimezone: true }),
	bannedBy: text("banned_by"),

	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * TOTP secrets and backup codes (Better Auth `twoFactor` plugin).
 *
 * Separate from `users` because these are credentials, not profile: they are
 * written once at enrolment, read only during verification, and must never be
 * serialised by a route that returns a user. Better Auth owns the contents;
 * this table exists so the adapter has somewhere to put them.
 */
export const twoFactors = pgTable(
	"two_factors",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		/** False between enabling and confirming the first code. */
		verified: boolean("verified").notNull().default(true),
		/*
		 * Brute-force protection. A 6-digit TOTP is only 10^6 wide and the window
		 * tolerates clock skew, so unlimited guesses would be feasible offline-fast
		 * against a stolen password. Better Auth counts failures and locks; these
		 * columns are where it keeps that state.
		 */
		failedVerificationCount: integer("failed_verification_count").notNull().default(0),
		lockedUntil: timestamp("locked_until", { withTimezone: true }),
	},
	(t) => ({
		byUser: index("two_factors_user_idx").on(t.userId),
	}),
);

export const sessions = pgTable("sessions", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
});

export const accounts = pgTable("accounts", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
	scope: text("scope"),
	idToken: text("id_token"),
	password: text("password"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/**
 * Staff. Existed before scheduling but was queried by nothing.
 *
 * `userId` is new and is what makes a staff member a real, authenticated
 * principal: it links this row to the Better Auth `users` row they sign in with.
 * Staff-ness is derived from the presence of this link rather than a flag on
 * `users`, so Better Auth's own table keeps the shape its adapter expects and
 * there is still only one authentication system.
 */
/**
 * Dynamic Operations Roles & Permission Matrix.
 *
 * Built-in system roles (super_admin, admin, manager, coordinator, consultant, finance)
 * are seeded automatically. Admins can create custom roles and toggle granted module
 * permissions dynamically in the UI.
 */
export const opsRoles = pgTable("ops_roles", {
	id: varchar("id", { length: 64 }).primaryKey(),
	name: varchar("name", { length: 128 }).notNull(),
	description: text("description"),
	isSystem: boolean("is_system").notNull().default(false),
	permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opsUsers = pgTable("ops_users", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: text("user_id")
		.unique()
		.references(() => users.id, { onDelete: "set null" }),
	email: varchar("email", { length: 255 }).notNull().unique(),
	name: text("name").notNull(),
	role: varchar("role", { length: 64 }).notNull(),
	branch: varchar("branch", { length: 64 }),
	active: boolean("active").notNull().default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invitationStatusEnum = pgEnum("invitation_status", [
	"PENDING",
	"ACCEPTED",
	"REVOKED",
	"EXPIRED",
]);

/**
 * Staff invitations.
 *
 * Staff accounts have exactly one origin: somebody with the authority invited
 * them. There is no staff sign-up endpoint, so this table is the only door in.
 *
 * The token is stored as a SHA-256 hash, never in plaintext — the emailed link
 * is a bearer credential that creates a privileged account, and a database dump
 * must not hand over the ability to claim every outstanding invitation. The
 * lookup hashes the presented token and compares, exactly as a password would be
 * handled.
 */
export const staffInvitations = pgTable(
	"staff_invitations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		email: varchar("email", { length: 255 }).notNull(),
		name: text("name").notNull(),
		role: varchar("role", { length: 64 }).notNull(),
		branch: varchar("branch", { length: 64 }),

		/** SHA-256 of the emailed token. The plaintext exists only in the email. */
		tokenHash: text("token_hash").notNull().unique(),

		status: invitationStatusEnum("status").notNull().default("PENDING"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

		invitedBy: uuid("invited_by").references(() => opsUsers.id, { onDelete: "set null" }),
		invitedByName: text("invited_by_name"),

		acceptedAt: timestamp("accepted_at", { withTimezone: true }),
		/** The ops profile created on acceptance, for audit. */
		acceptedOpsUserId: uuid("accepted_ops_user_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),

		revokedAt: timestamp("revoked_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byEmail: index("staff_invitations_email_idx").on(t.email, t.status),
		/*
		 * One outstanding invitation per address. Without this, two managers
		 * inviting the same person concurrently produce two valid tokens, and
		 * whichever is accepted second collides on the ops_users email unique
		 * index with a confusing error rather than a clear one.
		 */
		onePendingPerEmail: uniqueIndex("staff_invitations_pending_unique")
			.on(t.email)
			.where(sql`status = 'PENDING'`),
	}),
);

export const documentStatusEnum = pgEnum("document_status", [
	"PENDING_UPLOAD",
	"UPLOADED",
	"VERIFIED",
	"REJECTED",
]);

/**
 * Applicant documents.
 *
 * The row is created *before* the file exists, at PENDING_UPLOAD, and is only
 * marked UPLOADED once the browser reports the signed PUT succeeded and the
 * server has confirmed the object is actually there. Creating the row after the
 * upload would leave orphaned objects whenever a browser died mid-request, with
 * nothing in the database pointing at them.
 *
 * `storageKey` is a path inside a private bucket, never a URL. Every read is a
 * fresh short-lived signed URL, so a link copied out of the browser stops
 * working instead of exposing a passport indefinitely.
 */
export const applicantDocuments = pgTable(
	"applicant_documents",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		/** Owner. Ownership checks compare the session user against this. */
		ownerUserId: text("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),

		/** Which required document this satisfies, e.g. "passport". */
		documentType: varchar("document_type", { length: 64 }).notNull(),

		/** As the applicant named it — display only, never used as a path. */
		fileName: text("file_name").notNull(),
		contentType: varchar("content_type", { length: 128 }).notNull(),
		sizeBytes: integer("size_bytes"),

		/** Path within the private bucket. Server-generated, never client-supplied. */
		storageKey: text("storage_key").notNull().unique(),

		status: documentStatusEnum("status").notNull().default("PENDING_UPLOAD"),

		/* Review */
		reviewedBy: uuid("reviewed_by").references(() => opsUsers.id, { onDelete: "set null" }),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		reviewNote: text("review_note"),

		uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byOwner: index("applicant_documents_owner_idx").on(t.ownerUserId, t.documentType),
		byStatus: index("applicant_documents_status_idx").on(t.status, t.createdAt),
		/*
		 * One live document per type per applicant. Re-uploading a passport should
		 * replace the previous one rather than silently accumulating copies that
		 * reviewers then have to disambiguate. Rejected documents are excluded so a
		 * rejection can be corrected by uploading again.
		 */
		oneCurrentPerType: uniqueIndex("applicant_documents_current_unique")
			.on(t.ownerUserId, t.documentType)
			.where(sql`status <> 'REJECTED'`),
	}),
);

/* ══════════════════════════════════════════════════════════════════════════
 * Scheduling
 *
 * Timestamps are `timestamptz` and always UTC. The booking's IANA `timezone` is
 * stored beside them so the client and employee can each be shown correct local
 * time. Offsets are never stored or hand-applied — they change with DST.
 * ══════════════════════════════════════════════════════════════════════════ */

export const bookingStatusEnum = pgEnum("booking_status", [
	"UNASSIGNED",
	"ASSIGNED",
	"CONFIRMED",
	"RESCHEDULED",
	"CANCELLED",
	"COMPLETED",
	"NO_SHOW",
]);

export const calendarSyncStatusEnum = pgEnum("calendar_sync_status", [
	"NOT_REQUIRED",
	"PENDING",
	"SYNCED",
	"FAILED",
]);

export const bookingTypeEnum = pgEnum("booking_type", ["online", "in_person"]);

export const bookings = pgTable(
	"bookings",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		/** Human-facing reference, e.g. CNS-2026-0007. */
		reference: varchar("reference", { length: 32 }).notNull().unique(),

		/** The applicant. Ownership checks compare the session user against this. */
		clientUserId: text("client_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** Snapshot: the booking must stay readable if the profile changes later. */
		clientName: text("client_name").notNull(),
		clientEmail: varchar("client_email", { length: 255 }).notNull(),
		clientPhone: varchar("client_phone", { length: 40 }),

		/** Service catalogue stays in content.ts — this references it by id. */
		serviceId: varchar("service_id", { length: 64 }).notNull(),
		serviceName: text("service_name").notNull(),
		branchId: varchar("branch_id", { length: 64 }).notNull(),
		type: bookingTypeEnum("type").notNull().default("online"),

		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
		timezone: varchar("timezone", { length: 64 }).notNull(),
		durationMinutes: integer("duration_minutes").notNull(),

		status: bookingStatusEnum("status").notNull().default("UNASSIGNED"),

		/** Null until a manager or coordinator assigns. Never auto-assigned. */
		employeeId: uuid("employee_id").references(() => opsUsers.id, { onDelete: "set null" }),
		assignedAt: timestamp("assigned_at", { withTimezone: true }),
		assignedBy: uuid("assigned_by").references(() => opsUsers.id, { onDelete: "set null" }),

		/* Google Calendar / Meet */
		meetingUrl: text("meeting_url"),
		calendarEventId: text("calendar_event_id"),
		calendarId: text("calendar_id"),
		calendarSyncStatus: calendarSyncStatusEnum("calendar_sync_status")
			.notNull()
			.default("NOT_REQUIRED"),
		calendarSyncError: text("calendar_sync_error"),
		calendarSyncAttempts: integer("calendar_sync_attempts").notNull().default(0),

		rescheduledAt: timestamp("rescheduled_at", { withTimezone: true }),

		rescheduleRequestedAt: timestamp("reschedule_requested_at", { withTimezone: true }),
		rescheduleRequestedStartsAt: timestamp("reschedule_requested_starts_at", { withTimezone: true }),
		rescheduleRequestedEndsAt: timestamp("reschedule_requested_ends_at", { withTimezone: true }),
		rescheduleRequestedTimezone: varchar("reschedule_requested_timezone", { length: 64 }),
		rescheduleRequestReason: text("reschedule_request_reason"),

		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		cancelledBy: text("cancelled_by"),
		cancellationReason: text("cancellation_reason"),

		notes: text("notes"),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byClient: index("bookings_client_idx").on(t.clientUserId, t.startsAt),
		byEmployee: index("bookings_employee_idx").on(t.employeeId, t.startsAt),
		byStatus: index("bookings_status_idx").on(t.status, t.startsAt),
		byBranchDay: index("bookings_branch_idx").on(t.branchId, t.startsAt),
		/*
		 * §11 — two clients racing for one slot. Enforced in the database, not the
		 * application: a partial unique index means the loser's INSERT fails
		 * outright rather than both succeeding. Cancelled and no-show bookings are
		 * excluded so the slot genuinely frees up again.
		 *
		 * The matching employee-overlap guard is an exclusion constraint, added in
		 * the migration — Drizzle cannot express EXCLUDE USING gist.
		 */
		oneActivePerConsultantSlot: uniqueIndex("bookings_branch_consultant_slot_unique")
			.on(t.branchId, t.employeeId, t.startsAt)
			.where(sql`status NOT IN ('CANCELLED', 'NO_SHOW')`),
	}),
);

/**
 * Google Calendar credentials for one staff member.
 *
 * Tokens are encrypted at rest (AES-256-GCM, see lib/crypto.ts) and never
 * leave the server — no route serialises this table.
 */
export const staffCalendarAccounts = pgTable("staff_calendar_accounts", {
	id: uuid("id").primaryKey().defaultRandom(),
	opsUserId: uuid("ops_user_id")
		.notNull()
		.unique()
		.references(() => opsUsers.id, { onDelete: "cascade" }),
	provider: varchar("provider", { length: 32 }).notNull().default("google"),
	googleAccountEmail: varchar("google_account_email", { length: 255 }),
	/** Which calendar events are written to. "primary" unless the user picks. */
	calendarId: text("calendar_id").notNull().default("primary"),

	accessTokenEncrypted: text("access_token_encrypted"),
	refreshTokenEncrypted: text("refresh_token_encrypted"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
	scope: text("scope"),

	/** Set when the refresh token stops working — the UI prompts to reconnect. */
	needsReconnect: boolean("needs_reconnect").notNull().default(false),

	/* Push-notification channel (§12) */
	syncToken: text("sync_token"),
	channelId: text("channel_id"),
	channelResourceId: text("channel_resource_id"),
	channelExpiresAt: timestamp("channel_expires_at", { withTimezone: true }),

	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Recurring weekly availability. Absent rows mean the employee does not work that day. */
export const staffWorkingHours = pgTable(
	"staff_working_hours",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opsUserId: uuid("ops_user_id")
			.notNull()
			.references(() => opsUsers.id, { onDelete: "cascade" }),
		/** 0 = Sunday … 6 = Saturday, in `timezone`. */
		dayOfWeek: integer("day_of_week").notNull(),
		/** Minutes from local midnight, e.g. 540 = 09:00. */
		startMinute: integer("start_minute").notNull(),
		endMinute: integer("end_minute").notNull(),
		timezone: varchar("timezone", { length: 64 }).notNull().default("Africa/Accra"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		oneRowPerDay: uniqueIndex("staff_working_hours_unique").on(t.opsUserId, t.dayOfWeek),
	}),
);

/**
 * Events from the employee's Google Calendar that were not created by us.
 *
 * §12 — the application's database is not assumed to be in step with Google.
 * The webhook refreshes this table, and availability subtracts it, so an event
 * an employee adds in Google makes the slot unavailable here too.
 */
export const calendarBusyBlocks = pgTable(
	"calendar_busy_blocks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opsUserId: uuid("ops_user_id")
			.notNull()
			.references(() => opsUsers.id, { onDelete: "cascade" }),
		externalEventId: text("external_event_id").notNull(),
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
		summary: text("summary"),
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		oneRowPerEvent: uniqueIndex("calendar_busy_unique").on(t.opsUserId, t.externalEventId),
		byWindow: index("calendar_busy_window_idx").on(t.opsUserId, t.startsAt, t.endsAt),
	}),
);

/**
 * A read-only iCal/ICS subscription URL for one staff member.
 *
 * Replaces the removed Google Calendar OAuth integration. Each consultant pastes
 * their calendar's secret iCal address (Google "Secret address in iCal format",
 * Outlook/Apple "publish calendar" .ics link). A worker fetches it on a
 * schedule and writes the busy windows into `calendar_busy_blocks`, which the
 * availability check already subtracts — so an external meeting instantly
 * blocks the slot on the portal, with zero OAuth and zero verification.
 *
 * The URL is a secret address (read access to the calendar's busy times), so it
 * is encrypted at rest with the same AES-256-GCM scheme as OAuth tokens were
 * (`lib/crypto.ts`), and never returned to any client.
 */
export const staffCalendarFeeds = pgTable(
	"staff_calendar_feeds",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opsUserId: uuid("ops_user_id")
			.notNull()
			.unique()
			.references(() => opsUsers.id, { onDelete: "cascade" }),
		icsUrlEncrypted: text("ics_url_encrypted").notNull(),
		label: varchar("label", { length: 120 }),
		lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
		lastError: text("last_error"),
		/**
		 * Unguessable token for this consultant's outbound read-only ICS feed
		 * (their Century NIT bookings, subscribable by any calendar app without
		 * auth). Acts as the sole credential for the unauthenticated feed route.
		 */
		outboundToken: varchar("outbound_token", { length: 64 }).unique(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
);

/* ══════════════════════════════════════════════════════════════════════════
 * Invoices (API_MIGRATION_PLAN.md §Phase 4)
 *
 * Money is integer cents in USD. GHS conversion is a presentation concern —
 * never store a formatted string. "overdue" is derived (dueAt passed with a
 * balance outstanding), never stored, so a paid-late invoice cannot get stuck
 * in a stale status.
 * ══════════════════════════════════════════════════════════════════════════ */

export const invoiceStatusEnum = pgEnum("invoice_status", [
	"proforma",
	"issued",
	"partial",
	"paid",
	"void",
]);

export const invoiceTypeEnum = pgEnum("invoice_type", [
	"application",
	"visa",
	"consultation",
	"agency",
	"custom",
]);

export const invoices = pgTable(
	"invoices",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		/** Human-facing number, e.g. INV-2026-0007. */
		invoiceNumber: varchar("invoice_number", { length: 32 }).notNull().unique(),

		/** The applicant's login, when they have one — drives /api/me/invoices later. */
		clientUserId: text("client_user_id").references(() => users.id, { onDelete: "set null" }),
		/** Snapshot: the invoice must stay readable if the profile changes later. */
		applicantName: text("applicant_name").notNull(),
		applicantEmail: varchar("applicant_email", { length: 255 }),

		type: invoiceTypeEnum("type").notNull().default("custom"),
		/** Sum of lines at issue time, integer cents. Immutable after creation. */
		subtotalCents: integer("subtotal_cents").notNull(),
		/** Total reversed by credit notes, integer cents. */
		creditedCents: integer("credited_cents").notNull().default(0),
		note: text("note"),

		status: invoiceStatusEnum("status").notNull().default("issued"),

		issuedBy: uuid("issued_by").references(() => opsUsers.id, { onDelete: "set null" }),
		issuedByName: text("issued_by_name").notNull(),
		/** When payment is expected — drives overdue and the aging buckets. */
		dueAt: timestamp("due_at", { withTimezone: true }),

		voidedAt: timestamp("voided_at", { withTimezone: true }),
		voidReason: text("void_reason"),

		reviewedBy: uuid("reviewed_by").references(() => opsUsers.id, { onDelete: "set null" }),
		reviewedByName: text("reviewed_by_name"),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byStatus: index("invoices_status_idx").on(t.status, t.dueAt),
		byClient: index("invoices_client_idx").on(t.clientUserId, t.createdAt),
	}),
);

export const invoiceLines = pgTable(
	"invoice_lines",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoices.id, { onDelete: "cascade" }),
		position: integer("position").notNull().default(0),
		label: text("label").notNull(),
		detail: text("detail"),
		amountCents: integer("amount_cents").notNull(),
	},
	(t) => ({
		byInvoice: index("invoice_lines_invoice_idx").on(t.invoiceId, t.position),
	}),
);

export const invoicePayments = pgTable(
	"invoice_payments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoices.id, { onDelete: "cascade" }),
		amountCents: integer("amount_cents").notNull(),
		method: varchar("method", { length: 48 }).notNull(),
		gateway: varchar("gateway", { length: 48 }),
		reference: varchar("reference", { length: 64 }),
		recordedBy: uuid("recorded_by").references(() => opsUsers.id, { onDelete: "set null" }),
		recordedByName: text("recorded_by_name").notNull(),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byInvoice: index("invoice_payments_invoice_idx").on(t.invoiceId, t.at),
	}),
);

/** Append-only audit trail shown on the invoice detail. */
export const invoiceEvents = pgTable(
	"invoice_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoices.id, { onDelete: "cascade" }),
		action: varchar("action", { length: 48 }).notNull(),
		actor: text("actor"),
		detail: text("detail"),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byInvoice: index("invoice_events_invoice_idx").on(t.invoiceId, t.at),
	}),
);

/**
 * Append-only audit trail, and the idempotency ledger (§14).
 *
 * A retried assignment, calendar write, reschedule or notification finds its
 * `idempotencyKey` already present and returns the previous result instead of
 * creating a second calendar event or a second Meet link.
 */
export const bookingEvents = pgTable(
	"booking_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		bookingId: uuid("booking_id")
			.notNull()
			.references(() => bookings.id, { onDelete: "cascade" }),
		type: varchar("type", { length: 48 }).notNull(),
		actor: text("actor"),
		payload: jsonb("payload"),
		/** Unique per logical operation. Null for pure audit entries. */
		idempotencyKey: text("idempotency_key").unique(),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byBooking: index("booking_events_booking_idx").on(t.bookingId, t.at),
	}),
);

/**
 * Platform-level settings — integration credentials managed from the ops UI.
 *
 * Stores encrypted values (AES-256-GCM via lib/crypto.ts) for things like
 * Resend, Supabase Storage, and Google OAuth. The ENCRYPTION_KEY env var
 * encrypts at rest; the API reads and decrypts on demand with an in-memory
 * cache. Infrastructure secrets (DATABASE_URL, BETTER_AUTH_SECRET, etc.) stay
 * in environment variables and are never stored here.
 */
export const platformSettings = pgTable(
	"platform_settings",
	{
		key: varchar("key", { length: 64 }).primaryKey(),
	 /** Encrypted ciphertext (v1.<iv>.<authTag>.<data>). Null means "unset, fall back to env". */
		encryptedValue: text("encrypted_value"),
		/** Who last changed this, for the audit trail. */
		updatedBy: uuid("updated_by").references(() => opsUsers.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
);

/**
 * Append-only audit log for platform settings changes.
 *
 * Every write records who changed what and when. Old and new values are stored
 * masked (never plaintext) so the log is safe to display in the UI.
 */
export const settingsAudit = pgTable(
	"settings_audit",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		key: varchar("key", { length: 64 }).notNull(),
		actorId: uuid("actor_id").references(() => opsUsers.id, { onDelete: "set null" }),
		actorEmail: varchar("actor_email", { length: 255 }),
	 /** Masked representation, e.g. "re_••••••••a8c1" — never the real value. */
		oldValueMasked: text("old_value_masked"),
		newValueMasked: text("new_value_masked"),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byKey: index("settings_audit_key_idx").on(t.key, t.at),
	}),
);

/* ══════════════════════════════════════════════════════════════════════════
 * Applicant journey
 *
 * An applicant is a person. A consultation is the assessment case, usually
 * created from a booking. An application is the school-file that follows a
 * successful assessment. Comments are shared across both case types.
 * ══════════════════════════════════════════════════════════════════════════ */

export const consultationStatusEnum = pgEnum("consultation_status", [
	"UNDER_REVIEW",
	"ASSIGNED",
	"IN_ASSESSMENT",
	"COMPLETED",
	"CANCELLED",
]);

export const applicationStatusEnum = pgEnum("application_status", [
	"UNDER_REVIEW",
	"ACCEPTED",
	"ACTION_REQUIRED",
	"REJECTED",
]);

export const visaStageEnum = pgEnum("visa_stage", [
	"locked",
	"pending",
	"biometrics",
	"decision",
	"complete",
]);

export const caseCommentKindEnum = pgEnum("case_comment_kind", [
	"comment",
	"recommendation",
	"document_request",
	"status",
	"assignment",
]);

export const caseTargetEnum = pgEnum("case_target", ["consultation", "application"]);

export const applicants = pgTable(
	"applicants",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.unique()
			.references(() => users.id, { onDelete: "set null" }),
		email: varchar("email", { length: 255 }).notNull().unique(),
		name: text("name").notNull(),
		phone: varchar("phone", { length: 40 }),
		branch: varchar("branch", { length: 64 }).notNull(),
		targetCountry: varchar("target_country", { length: 80 }),
		assignedOfficerId: uuid("assigned_officer_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		profile: jsonb("profile").$type<Record<string, string>>().notNull().default({}),
		portalState: jsonb("portal_state").$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byOfficer: index("applicants_officer_idx").on(t.assignedOfficerId),
		byBranch: index("applicants_branch_idx").on(t.branch),
	}),
);

export const consultations = pgTable(
	"consultations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		reference: varchar("reference", { length: 32 }).notNull(),
		bookingId: uuid("booking_id")
			.unique()
			.references(() => bookings.id, { onDelete: "set null" }),
		applicantId: uuid("applicant_id")
			.notNull()
			.references(() => applicants.id, { onDelete: "cascade" }),
		branch: varchar("branch", { length: 64 }).notNull(),
		type: varchar("type", { length: 32 }).notNull().default("online"),
		targetCountry: varchar("target_country", { length: 80 }),
		status: consultationStatusEnum("status").notNull().default("UNDER_REVIEW"),
		/** The consultant who does the assessment. Assigned by the coordinator. */
		assignedOfficerId: uuid("assigned_officer_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		assignedAt: timestamp("assigned_at", { withTimezone: true }),
		assignedBy: uuid("assigned_by").references(() => opsUsers.id, { onDelete: "set null" }),
		/** The coordinator who manages this case. Delegated by manager/owner. */
		coordinatorId: uuid("coordinator_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		coordinatorAssignedAt: timestamp("coordinator_assigned_at", { withTimezone: true }),
		coordinatorAssignedBy: uuid("coordinator_assigned_by").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		delegationNote: text("delegation_note"),
		slotConfirmed: boolean("slot_confirmed").notNull().default(false),
		assessmentResult: jsonb("assessment_result").$type<{
			outcome: string;
			notes: string;
			recCountry: string;
			recUniversity: string;
			recProgram: string;
			recPackage: string;
		}>(),
		requestedDocuments: jsonb("requested_documents").$type<string[]>().notNull().default([]),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byApplicant: index("consultations_applicant_idx").on(t.applicantId),
		byOfficer: index("consultations_officer_idx").on(t.assignedOfficerId, t.status),
		byCoordinator: index("consultations_coordinator_idx").on(t.coordinatorId, t.status),
		byStatus: index("consultations_status_idx").on(t.status),
	}),
);

export const applications = pgTable(
	"applications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		appNumber: varchar("app_number", { length: 32 }).notNull().unique(),
		applicantId: uuid("applicant_id")
			.notNull()
			.references(() => applicants.id, { onDelete: "cascade" }),
		consultationId: uuid("consultation_id").references(() => consultations.id, {
			onDelete: "set null",
		}),
		university: text("university").notNull(),
		program: text("program").notNull(),
		country: varchar("country", { length: 80 }).notNull(),
		degreeLevel: varchar("degree_level", { length: 64 }).notNull().default("Master's"),
		assignedStaffId: uuid("assigned_staff_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		stage: varchar("stage", { length: 80 }).notNull().default("document_verification"),
		status: applicationStatusEnum("status").notNull().default("UNDER_REVIEW"),
		fundingTrack: text("funding_track"),
		notes: text("notes"),
		checklist: jsonb("checklist")
			.$type<{ id: string; label: string; checked: boolean }[]>()
			.notNull()
			.default([]),
		visaStage: visaStageEnum("visa_stage").notNull().default("locked"),
		visaInvoicePaid: boolean("visa_invoice_paid").notNull().default(false),
		visaCounselorNote: text("visa_counselor_note"),
		paymentPlanId: varchar("payment_plan_id", { length: 32 }),
		agencyStageIndex: integer("agency_stage_index").notNull().default(0),
		agencySettled: boolean("agency_settled").notNull().default(false),
		travelClearance: varchar("travel_clearance", { length: 16 }).notNull().default("pending"),
		requestedDocuments: jsonb("requested_documents").$type<string[]>().notNull().default([]),
		submittedAt: timestamp("submitted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byApplicant: index("applications_applicant_idx").on(t.applicantId),
		byStaff: index("applications_staff_idx").on(t.assignedStaffId, t.status),
		byStatus: index("applications_status_idx").on(t.status, t.stage),
	}),
);

export const caseComments = pgTable(
	"case_comments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		targetType: caseTargetEnum("target_type").notNull(),
		targetId: uuid("target_id").notNull(),
		kind: caseCommentKindEnum("kind").notNull().default("comment"),
		text: text("text").notNull(),
		authorName: text("author_name").notNull(),
		authorOpsUserId: uuid("author_ops_user_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byTarget: index("case_comments_target_idx").on(t.targetType, t.targetId, t.at),
	}),
);

/* ══════════════════════════════════════════════════════════════════════════
 * School Applications & Tracking (Phase 1)
 * ══════════════════════════════════════════════════════════════════════════ */

export const schoolTrackStatusEnum = pgEnum("school_track_status", [
	"Draft",
	"Preparing Application",
	"Documents under review",
	"Submitted to University",
	"Conditional Offer Received",
	"Unconditional Offer",
	"Offer Accepted",
	"Offer Declined",
	"Application Rejected",
	"Waitlisted",
	"Withdrawn",
]);

export const schoolApplications = pgTable(
	"school_applications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicantId: uuid("applicant_id")
			.notNull()
			.references(() => applicants.id, { onDelete: "cascade" }),
		applicationId: uuid("application_id").references(() => applications.id, {
			onDelete: "set null",
		}),
		destinationId: varchar("destination_id", { length: 64 }).notNull().references(() => destinations.id),
		universityId: text("university_id").notNull().references(() => catalogUniversities.id),
		programId: text("program_id").notNull().references(() => catalogPrograms.id),
		intake: varchar("intake", { length: 64 }).notNull(),
		status: schoolTrackStatusEnum("status").notNull().default("Draft"),
		handlerNote: text("handler_note"),
		financialNote: text("financial_note"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byApplicant: index("school_applications_applicant_idx").on(t.applicantId),
		byApplication: index("school_applications_application_idx").on(t.applicationId),
		byStatus: index("school_applications_status_idx").on(t.status),
	}),
);

export const schoolTrackEvents = pgTable(
	"school_track_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		schoolApplicationId: uuid("school_application_id")
			.notNull()
			.references(() => schoolApplications.id, { onDelete: "cascade" }),
		status: schoolTrackStatusEnum("status").notNull(),
		note: text("note").notNull().default(""),
		financialNote: text("financial_note"),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		bySchool: index("school_track_events_school_idx").on(t.schoolApplicationId, t.at),
	}),
);

/* ══════════════════════════════════════════════════════════════════════════
 * Support & Helpdesk Tickets (Phase 1)
 * ══════════════════════════════════════════════════════════════════════════ */

export const ticketStatusEnum = pgEnum("ticket_status", [
	"open",
	"pending",
	"resolved",
	"closed",
]);

export const ticketPriorityEnum = pgEnum("ticket_priority", [
	"low",
	"medium",
	"high",
	"urgent",
]);

export const ticketSenderTypeEnum = pgEnum("ticket_sender_type", [
	"applicant",
	"staff",
	"system",
]);

export const tickets = pgTable(
	"tickets",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		clientUserId: text("client_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		applicantId: uuid("applicant_id").references(() => applicants.id, {
			onDelete: "set null",
		}),
		applicantName: text("applicant_name").notNull(),
		source: varchar("source", { length: 16 }).notNull().default("external"),
		subject: varchar("subject", { length: 255 }).notNull(),
		category: varchar("category", { length: 64 }).notNull().default("General Inquiry"),
		status: ticketStatusEnum("status").notNull().default("open"),
		priority: ticketPriorityEnum("priority").notNull().default("medium"),
		assignedStaffId: uuid("assigned_staff_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byClient: index("tickets_client_idx").on(t.clientUserId, t.status),
		byStaff: index("tickets_staff_idx").on(t.assignedStaffId, t.status),
		byStatus: index("tickets_status_idx").on(t.status, t.createdAt),
		bySource: index("tickets_source_idx").on(t.source, t.status),
	}),
);

export const ticketMessages = pgTable(
	"ticket_messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ticketId: uuid("ticket_id")
			.notNull()
			.references(() => tickets.id, { onDelete: "cascade" }),
		senderType: ticketSenderTypeEnum("sender_type").notNull().default("applicant"),
		senderId: text("sender_id"),
		senderName: text("sender_name").notNull(),
		message: text("message").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byTicket: index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt),
	}),
);

/* ══════════════════════════════════════════════════════════════════════════
 * CRM Leads (Phase 1)
 * ══════════════════════════════════════════════════════════════════════════ */

export const leadStageEnum = pgEnum("lead_stage", [
	"New Lead",
	"Contacted",
	"Consultation Booked",
	"Assessment Complete",
	"Enrolled",
	"Lost",
]);

export const leads = pgTable(
	"leads",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		email: varchar("email", { length: 255 }).notNull(),
		phone: varchar("phone", { length: 40 }),
		source: varchar("source", { length: 64 }).notNull().default("Web Inquiry"),
		stage: leadStageEnum("stage").notNull().default("New Lead"),
		targetCountry: varchar("target_country", { length: 80 }),
		assignedStaffId: uuid("assigned_staff_id").references(() => opsUsers.id, {
			onDelete: "cascade",
		}),
		consultationId: uuid("consultation_id").references(() => consultations.id, {
			onDelete: "set null",
		}),
		applicationId: uuid("application_id").references(() => applications.id, {
			onDelete: "set null",
		}),
		notes: text("notes"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byStage: index("leads_stage_idx").on(t.stage, t.createdAt),
		byEmail: index("leads_email_idx").on(t.email),
		byStaff: index("leads_staff_idx").on(t.assignedStaffId),
		byConsultation: index("leads_consultation_idx").on(t.consultationId),
		byApplication: index("leads_application_idx").on(t.applicationId),
	}),
);

/* ── Lead activity audit trail ─────────────────────────────────────────── */

export const leadEvents = pgTable(
	"lead_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		leadId: uuid("lead_id")
			.notNull()
			.references(() => leads.id, { onDelete: "cascade" }),
		type: varchar("type", { length: 48 }).notNull(),
		actorName: text("actor_name"),
		payload: jsonb("payload"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byLead: index("lead_events_lead_idx").on(t.leadId, t.createdAt),
	}),
);

/* ══════════════════════════════════════════════════════════════════════════
 * Payment Gateway Transactions (Paystack / Stripe)
 * ══════════════════════════════════════════════════════════════════════════ */

export const paymentGatewayEnum = pgEnum("payment_gateway", ["paystack", "stripe"]);
export const paymentStatusEnum = pgEnum("payment_status", [
	"pending",
	"success",
	"failed",
	"reversed",
]);

export const paymentTransactions = pgTable(
	"payment_transactions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		invoiceId: uuid("invoice_id")
			.notNull()
			.references(() => invoices.id, { onDelete: "cascade" }),
		clientUserId: text("client_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		reference: varchar("reference", { length: 128 }).notNull().unique(),
		gateway: paymentGatewayEnum("gateway").notNull().default("paystack"),
		amountCents: integer("amount_cents").notNull(),
		currency: varchar("currency", { length: 16 }).notNull().default("USD"),
		status: paymentStatusEnum("status").notNull().default("pending"),
		rawWebhookPayload: jsonb("raw_webhook_payload"),
		paidAt: timestamp("paid_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byInvoice: index("payment_transactions_invoice_idx").on(t.invoiceId),
		byReference: index("payment_transactions_ref_idx").on(t.reference),
		byStatus: index("payment_transactions_status_idx").on(t.status),
	}),
);

/* ══════════════════════════════════════════════════════════════════════════
 * Internal Chat — staff-to-staff messaging
 * ══════════════════════════════════════════════════════════════════════════ */

export const conversationTypeEnum = pgEnum("conversation_type", [
	"direct",
	"entity",
	"group",
	"applicant",
	"support",
	"case",
	"stage",
	"internal",
	"escalation",
]);

export const conversationRoleEnum = pgEnum("conversation_role", [
	"owner",
	"member",
	"former",
]);

/**
 * Lifecycle status of a conversation. `open` is the default; `closed` freezes
 * the conversation for customers (staff can still append internal notes);
 * `archived` hides it from active lists.
 */
export const conversationStatusEnum = pgEnum("conversation_status", [
	"open",
	"closed",
	"archived",
]);

/**
 * Staff availability — distinct from the static `opsUsers.active` flag.
 * `available` means actively accepting work; `busy` is online but at capacity;
 * `on_leave` is out of office; `offline` is no recent heartbeat.
 */
export const staffPresenceEnum = pgEnum("staff_presence_status", [
	"available",
	"busy",
	"on_leave",
	"offline",
]);

/** Lifecycle of a per-stage assignment. Only one `active` row per (case, stage). */
export const stageAssignmentStatusEnum = pgEnum("stage_assignment_status", [
	"active",
	"reassigned",
	"on_leave",
	"completed",
]);

export const messageTypeEnum = pgEnum("message_type", [
	"text",
	"system",
	"action",
]);

export const conversations = pgTable(
	"conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		type: conversationTypeEnum("type").notNull().default("direct"),
		title: text("title").notNull(),
		/** Which business entity this conversation is linked to, if any. */
		linkedEntityType: varchar("linked_entity_type", { length: 48 }),
		linkedEntityId: uuid("linked_entity_id"),
		createdBy: uuid("created_by")
			.references(() => opsUsers.id, { onDelete: "set null" }),
		/** For applicant-staff conversations, the applicant's user ID. */
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		/**
		 * Journey stage key this conversation is scoped to (when `type` is
		 * `stage`). Null for `support`/`case`/`internal`/`escalation` that are
		 * not stage-scoped. See JOURNEY_STAGES in century-nit-shared.
		 */
		stageKey: varchar("stage_key", { length: 80 }),
		/** Opaque unguessable token for inbound email threading (§11). */
		emailInboxToken: varchar("email_inbox_token", { length: 64 }).unique(),
		/** For escalations — who escalated and why. */
		escalatedByOpsUserId: uuid("escalated_by_ops_user_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		escalationReason: text("escalation_reason"),
		/** Denormalised last-activity timestamp for sorting / unread queries. */
		lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
		/** Lifecycle: open (default) / closed (read-only for customers) / archived. */
		status: conversationStatusEnum("status").notNull().default("open"),
		closedAt: timestamp("closed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byType: index("conversations_type_idx").on(t.type, t.updatedAt),
		byEntity: index("conversations_entity_idx").on(t.linkedEntityType, t.linkedEntityId),
		byUser: index("conversations_user_idx").on(t.userId),
		byStage: index("conversations_stage_idx").on(t.linkedEntityType, t.linkedEntityId, t.stageKey),
	}),
);

export const messages = pgTable(
	"messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		senderOpsUserId: uuid("sender_ops_user_id")
			.references(() => opsUsers.id, { onDelete: "set null" }),
		/** For messages sent by applicants (not staff). */
		senderUserId: text("sender_user_id").references(() => users.id, { onDelete: "set null" }),
		/** Denormalised for fast rendering without joins. */
		senderName: text("sender_name").notNull(),
		content: text("content").notNull(),
		messageType: messageTypeEnum("message_type").notNull().default("text"),
		replyToId: uuid("reply_to_id"),
		/**
		 * Set when this message was produced by forwarding another one. Points at
		 * the ORIGINAL message, not the immediately-forwarded one, so a chain of
		 * forwards still attributes back to the true author. `set null` on delete
		 * so removing the original degrades the forward to a plain message rather
		 * than cascading it away.
		 */
		forwardedFromId: uuid("forwarded_from_id"),
		/**
		 * Non-null once the author has edited the body. Kept distinct from
		 * `updatedAt` because reactions and receipts also touch a row's mtime —
		 * only a real content change should surface an "edited" marker in the UI.
		 */
		editedAt: timestamp("edited_at", { withTimezone: true }),
		/**
		 * Soft delete. Deleted messages keep their row so that replies quoting
		 * them, and forwards descending from them, don't dangle — the UI renders
		 * a "message deleted" tombstone instead. Never hard-delete a message that
		 * something else references.
		 */
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		deletedByOpsUserId: uuid("deleted_by_ops_user_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byConversation: index("messages_conversation_idx").on(t.conversationId, t.createdAt),
	}),
);

/**
 * One row per (message, reactor, emoji).
 *
 * Reactors are split across two nullable columns for the same reason
 * participants are: staff are `ops_users`, clients are Better Auth `users`, and
 * there is no single table spanning both.
 *
 * Uniqueness is a COALESCE'd unique index rather than a composite primary key
 * over those two columns, because Postgres implicitly forces every PRIMARY KEY
 * column NOT NULL — a composite PK here would make it impossible to store any
 * reaction at all, since one of the two reactor columns is always null.
 * COALESCE collapses the pair into a single non-null reactor identity, which
 * also keeps the constraint meaningful (NULLs would otherwise compare distinct
 * and let a user stack the same emoji repeatedly).
 */
export const messageReactions = pgTable(
	"message_reactions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		messageId: uuid("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		opsUserId: uuid("ops_user_id").references(() => opsUsers.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		/** Unicode emoji, stored as-is (e.g. "👍"). */
		emoji: varchar("emoji", { length: 16 }).notNull(),
		/** Denormalised so the "who reacted" popover needs no join. */
		reactorName: text("reactor_name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		oneReactionPerReactor: uniqueIndex("message_reactions_unique").on(
			t.messageId,
			sql`coalesce(${t.opsUserId}::text, ${t.userId})`,
			t.emoji,
		),
		byMessage: index("message_reactions_message_idx").on(t.messageId),
	}),
);

/**
 * Attachments hang off a message rather than standing alone, so an upload is
 * always part of the conversation transcript (spec §14) and inherits the
 * message's delete/forward semantics for free.
 *
 * `messageId` is nullable because uploading is two-phase: the client presigns
 * and uploads first, then sends the message referencing the resulting ids. A
 * row therefore exists, owned but unbound, between those steps. Unbound rows
 * older than a day are abandoned uploads and safe to sweep.
 */
export const messageAttachments = pgTable(
	"message_attachments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
		/** Who staged the upload — gates who may later bind it to a message. */
		uploadedByOpsUserId: uuid("uploaded_by_ops_user_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		/** Object key in R2 — not a public URL; links are presigned on read. */
		storageKey: text("storage_key").notNull(),
		fileName: text("file_name").notNull(),
		contentType: varchar("content_type", { length: 128 }).notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byMessage: index("message_attachments_message_idx").on(t.messageId),
	}),
);

export const conversationParticipants = pgTable(
	"conversation_participants",
	{
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		opsUserId: uuid("ops_user_id").references(() => opsUsers.id, { onDelete: "cascade" }),
		/**
		 * Symmetric participant pointer for non-staff (applicants/customers).
		 * Exactly one of `opsUserId` / `participantUserId` is set per row.
		 */
		participantUserId: text("participant_user_id").references(() => users.id, {
			onDelete: "cascade",
		}),
		role: conversationRoleEnum("role").notNull().default("member"),
		lastReadAt: timestamp("last_read_at", { withTimezone: true }),
		joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		// Composite PK — also guarantees no duplicate (conversation, participant) rows.
		pk: primaryKey({ columns: [t.conversationId, t.opsUserId, t.participantUserId] }),
		byOpsUser: index("conversation_participants_user_idx").on(t.opsUserId),
		byParticipantUser: index("conversation_participants_part_user_idx").on(t.participantUserId),
	}),
);

export const messageMentions = pgTable(
	"message_mentions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		messageId: uuid("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		mentionedOpsUserId: uuid("mentioned_ops_user_id")
			.notNull()
			.references(() => opsUsers.id, { onDelete: "cascade" }),
		readAt: timestamp("read_at", { withTimezone: true }),
	},
	(t) => ({
		byMessage: index("message_mentions_message_idx").on(t.messageId),
		byUser: index("message_mentions_user_idx").on(t.mentionedOpsUserId, t.readAt),
	}),
);

/* ══════════════════════════════════════════════════════════════════════════
 * Context-Aware Case Communication — stage assignments, presence,
 * notification preferences, and the audit trail.
 *
 * See services/communication.ts for the routing logic that ties a customer
 * to the staff member currently responsible for their case stage.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Per-stage assignment of an officer to a case (application).
 *
 * Distinct from `applications.assignedStaffId` (the fallback/whole-case owner)
 * and `applicants.assignedOfficerId` (the primary coordinator / case manager).
 * A customer's journey typically moves through several stages, each handled
 * by a different specialist; this table records who owns which stage right now.
 */
export const stageAssignments = pgTable(
	"stage_assignments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => applications.id, { onDelete: "cascade" }),
		/** Journey stage key this assignment covers (JOURNEY_STAGES). */
		stage: varchar("stage", { length: 80 }).notNull(),
		opsUserId: uuid("ops_user_id")
			.notNull()
			.references(() => opsUsers.id, { onDelete: "cascade" }),
		status: stageAssignmentStatusEnum("status").notNull().default("active"),
		assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
		assignedBy: uuid("assigned_by").references(() => opsUsers.id, { onDelete: "set null" }),
		endedAt: timestamp("ended_at", { withTimezone: true }),
		endedReason: text("ended_reason"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byApplication: index("stage_assignments_application_idx").on(t.applicationId, t.stage),
		byOpsUser: index("stage_assignments_ops_user_idx").on(t.opsUserId, t.status),
	}),
);

/**
 * Live staff availability. Backed by a heartbeat from the ops frontend and
 * (in future) Redis for fast lookup; this table is the durable source of truth
 * the API serves to clients. Distinct from `opsUsers.active` (enabled flag).
 */
export const staffPresence = pgTable(
	"staff_presence",
	{
		opsUserId: uuid("ops_user_id")
			.primaryKey()
			.references(() => opsUsers.id, { onDelete: "cascade" }),
		status: staffPresenceEnum("status").notNull().default("offline"),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
		statusSetAt: timestamp("status_set_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
);

/**
 * Per-user notification preferences. Drives the fan-out in the unified
 * `notify(event)` service (§10). `channelFlags` is a map of event type →
 * `{ inApp, email, push, sms }` booleans.
 */
export const notificationPreferences = pgTable(
	"notification_preferences",
	{
		userId: text("user_id")
			.primaryKey()
			.references(() => users.id, { onDelete: "cascade" }),
		channelFlags: jsonb("channel_flags").$type<Record<string, {
			inApp?: boolean;
			email?: boolean;
			push?: boolean;
			sms?: boolean;
		}>>().notNull().default({}),
		/** Quiet hours, e.g. `{ start: "21:00", end: "07:00", timezone: "Africa/Accra" }`. */
		quietHours: jsonb("quiet_hours").$type<{
			start?: string;
			end?: string;
			timezone?: string;
		}>(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
);

/**
 * Append-only audit trail for every meaningful communication event.
 *
 * Records Actor → Action → Timestamp → Case → Stage → Conversation, with
 * arbitrary structured metadata. Complements `consultation_activities` (which
 * tracks case-state changes only); over time the two should converge.
 */
export const communicationEvents = pgTable(
	"communication_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		/** Who performed the action — one of these is set. */
		actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
		actorOpsUserId: uuid("actor_ops_user_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		action: varchar("action", { length: 64 }).notNull(),
		conversationId: uuid("conversation_id").references(() => conversations.id, {
			onDelete: "cascade",
		}),
		applicationId: uuid("application_id"),
		stageKey: varchar("stage_key", { length: 80 }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byConversation: index("communication_events_conversation_idx").on(t.conversationId, t.createdAt),
		byApplication: index("communication_events_application_idx").on(t.applicationId, t.createdAt),
		byAction: index("communication_events_action_idx").on(t.action, t.createdAt),
	}),
);

/**
 * Append-only activity timeline for consultations.
 *
 * Records every meaningful state change — delegation, assignment, status
 * change, document request, assessment — so managers and owners can see
 * the full history without digging through comments.
 */
export const consultationActivities = pgTable(
	"consultation_activities",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		consultationId: uuid("consultation_id")
			.notNull()
			.references(() => consultations.id, { onDelete: "cascade" }),
		type: varchar("type", { length: 48 }).notNull(),
		/** Who performed the action (null for system-generated activities). */
		actorOpsUserId: uuid("actor_ops_user_id").references(() => opsUsers.id, {
			onDelete: "set null",
		}),
		actorName: text("actor_name"),
		/** Structured payload — what changed. */
		payload: jsonb("payload"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		byConsultation: index("consultation_activities_consultation_idx").on(t.consultationId, t.createdAt),
	}),
);

/* ── In-app notifications ──────────────────────────────────────────────────── */

export const notifications = pgTable(
	"notifications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		type: varchar("type", { length: 50 }).notNull(),
		title: varchar("title", { length: 200 }).notNull(),
		body: text("body").notNull(),
		link: varchar("link", { length: 500 }),
		read: boolean("read").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		eventId: varchar("event_id", { length: 200 }),
		priority: varchar("priority", { length: 20 }).notNull().default("normal"),
		entityType: varchar("entity_type", { length: 50 }),
		entityId: varchar("entity_id", { length: 100 }),
		caseId: varchar("case_id", { length: 100 }),
		readAt: timestamp("read_at", { withTimezone: true }),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
	},
	(t) => ({
		userIdIdx: index("notifications_user_idx").on(t.userId),
		caseIdx: index("notifications_case_idx").on(t.caseId),
		/**
		 * `notify()` (services/notify.ts) upserts with
		 * `onConflictDoNothing({ target: [eventId, userId] })` for idempotency.
		 * Postgres requires an actual unique index matching that target or the
		 * insert throws "no unique or exclusion constraint matching the ON
		 * CONFLICT specification" — which was being caught and swallowed,
		 * silently dropping every notification (in-app, SSE, push, and email)
		 * ever sent. `eventId` is nullable; Postgres treats each NULL as
		 * distinct, so events without one (the common case) never collide.
		 */
		eventUserUnique: uniqueIndex("notifications_event_user_unique").on(t.eventId, t.userId),
	}),
);

/**
 * Web Push (browser push notification) subscriptions.
 *
 * A user may have several subscriptions — one per browser/device. Each row
 * stores the PushSubscription endpoint and keys (p256dh + auth) that the
 * browser produced via `pushManager.subscribe()`. The push worker fans a
 * notification out to every subscription for the recipient and prunes any that
 * the push service reports as 410 Gone / 404 (the subscription expired or was
 * revoked by the user).
 *
 * `UNIQUE(endpoint)` doubles as the dedup target for the upsert: re-subscribing
 * the same browser updates the keys and refreshes `lastUsedAt` rather than
 * accumulating duplicate rows.
 */
export const pushSubscriptions = pgTable(
	"push_subscriptions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		endpoint: text("endpoint").notNull().unique(),
		keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
		userAgent: text("user_agent"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
	},
	(t) => ({
		byUser: index("push_subs_user_idx").on(t.userId),
	}),
);

/* ── Notification delivery log ───────────────────────────────────────────── */

export const notificationLog = pgTable(
	"notification_log",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		recipient: varchar("recipient", { length: 255 }).notNull(),
		subject: varchar("subject", { length: 500 }).notNull(),
		/** Which template produced this email (e.g. "Booking created", "Consultation assigned"). */
		template: varchar("template", { length: 200 }),
		/** "sent" or "failed" — the worker catches Resend errors and records the outcome. */
		status: varchar("status", { length: 20 }).notNull().default("sent"),
		/** The business reference (booking ref, consultation ref, etc.) for cross-linking. */
		reference: varchar("reference", { length: 200 }),
		/** Idempotency key from the queue — prevents duplicate log rows for the same email. */
		idempotencyKey: varchar("idempotency_key", { length: 300 }),
		errorMessage: text("error_message"),
		sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		bySentAt: index("notification_log_sent_at_idx").on(t.sentAt),
		byStatus: index("notification_log_status_idx").on(t.status),
	}),
);

/* ── Auth configuration ──────────────────────────────────────────────────── */

/**
 * Admin-configurable auth settings for portal and ops console.
 *
 * Key-value store where keys follow a dot-notation convention:
 *   portal.email_password   — boolean, enable email+password login for portal
 *   portal.social_google    — boolean, enable Google OAuth for portal
 *   portal.email_otp        — boolean, enable email OTP (passwordless) for portal
 *   portal.mfa_required     — boolean, require MFA for portal after password/social login
 *   portal.mfa_methods      — string[], available MFA methods for portal users
 *   ops.email_password      — boolean, always true (staff always use email+password)
 *   ops.google_sso          — boolean, enable Google SSO for ops console
 *   ops.mfa_required        — boolean, always true (staff always require MFA)
 *   ops.mfa_methods         — string[], available MFA methods for staff
 */
export const authSettings = pgTable("auth_settings", {
	key: varchar("key", { length: 128 }).primaryKey(),
	value: jsonb("value").notNull(),
	updatedBy: text("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});


/**
 * Global Lookup Values
 * Used for dynamic dropdowns in forms (e.g. Assessment Form).
 * Configured in Ops dashboard.
 */
export const lookupValues = pgTable("lookup_values", {
	id: uuid("id").defaultRandom().primaryKey(),
	category: varchar("category", { length: 64 }).notNull(),
	value: varchar("value", { length: 128 }).notNull(),
	label: varchar("label", { length: 255 }).notNull(),
	sortOrder: integer("sort_order").notNull().default(0),
	isActive: boolean("is_active").notNull().default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ─── Marketing ─── */

export const marketingCampaigns = pgTable("marketing_campaigns", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: varchar("name", { length: 255 }).notNull(),
	type: varchar("type", { length: 16 }).notNull(),
	status: varchar("status", { length: 16 }).notNull().default("draft"),
	channel: varchar("channel", { length: 16 }).notNull().default("email"),
	audience: varchar("audience", { length: 255 }),
	subject: varchar("subject", { length: 500 }),
	body: text("body").notNull(),
	templateId: uuid("template_id"),
	mailingListId: uuid("mailing_list_id"),
	sentBy: text("sent_by"),
	sentAt: timestamp("sent_at", { withTimezone: true }),
	recipientCount: integer("recipient_count").notNull().default(0),
	deliveredCount: integer("delivered_count").notNull().default(0),
	failedCount: integer("failed_count").notNull().default(0),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
	byStatus: index("campaigns_status_idx").on(t.status),
	byType: index("campaigns_type_idx").on(t.type),
}));

export const mailingLists = pgTable("mailing_lists", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: varchar("name", { length: 255 }).notNull(),
	description: text("description"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mailingListContacts = pgTable("mailing_list_contacts", {
	id: uuid("id").defaultRandom().primaryKey(),
	mailingListId: uuid("mailing_list_id").notNull().references(() => mailingLists.id, { onDelete: "cascade" }),
	name: varchar("name", { length: 255 }),
	email: varchar("email", { length: 255 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
	byList: index("mlc_list_idx").on(t.mailingListId),
	byEmail: index("mlc_email_idx").on(t.email),
}));

export const emailTemplate = pgTable("email_templates", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: varchar("name", { length: 255 }).notNull(),
	type: varchar("type", { length: 16 }).notNull().default("email"),
	subject: varchar("subject", { length: 500 }),
	header: varchar("header", { length: 500 }),
	body: text("body").notNull(),
	footer: text("footer"),
	isCustom: boolean("is_custom").notNull().default(false),
	createdBy: text("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});



// --- ACADEMIC CATALOGUE ---

export const destinations = pgTable("destinations", {
	id: text("id").primaryKey(), // e.g. "ca", "uk"
	name: text("name").notNull(),
	region: text("region").notNull(),
	tagline: text("tagline"),
	description: text("description"),
	highlights: jsonb("highlights").$type<string[]>(), // Array of strings
	universities: integer("universities").default(0),
	programs: integer("programs").default(0),
	image: text("image"),
	flag: text("flag"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const catalogUniversities = pgTable("catalog_universities", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	destinationId: text("destination_id").references(() => destinations.id),
	city: text("city"),
	ranking: text("ranking"),
	type: text("type"),
	acceptance: text("acceptance"),
	description: text("description"),
	image: text("image"),
	tags: jsonb("tags").$type<string[]>(), // Array of strings
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const catalogPrograms = pgTable("catalog_programs", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	universityId: text("university_id").references(() => catalogUniversities.id),
	level: text("level"), // Undergraduate, Postgraduate, etc.
	field: text("field"), // STEM, Arts, etc.
	duration: text("duration"),
	tuition: text("tuition"),
	tuitionUsd: integer("tuition_usd"),
	intake: jsonb("intake").$type<string[]>(), // ["Sept 2024", "Jan 2025"]
	applicationDeadline: text("application_deadline"),
	description: text("description"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const catalogScholarships = pgTable("catalog_scholarships", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	universityId: text("university_id").references(() => catalogUniversities.id),
	amount: text("amount"),
	type: text("type"),
	deadline: text("deadline"),
	eligibility: text("eligibility"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const studentScholarships = pgTable("student_scholarships", {
	id: uuid("id").primaryKey().defaultRandom(),
	applicantId: uuid("applicant_id")
		.notNull()
		.references(() => applicants.id, { onDelete: "cascade" }),
	scholarshipId: text("scholarship_id")
		.notNull()
		.references(() => catalogScholarships.id, { onDelete: "cascade" }),
	awardedAt: timestamp("awarded_at", { withTimezone: true }).defaultNow(),
	notes: text("notes"),
}, (t) => ({
	byApplicant: index("student_scholarships_applicant_idx").on(t.applicantId),
	uniqueAward: uniqueIndex("student_scholarships_unique_idx").on(t.applicantId, t.scholarshipId)
}));
