/**
 * Destructive: clears all applicant journey data from the remote DB while
 * preserving staff/ops users, roles, catalog, and **all config settings**.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/clear-journey-data.ts [--dry-run]
 *
 * Safety:
 *   - Wraps everything in a single transaction; any error rolls back.
 *   - `--dry-run` prints the exact SQL and row counts without deleting.
 *   - Prints before/after counts for every affected table.
 *
 * PRESERVED (never touched):
 *   - Staff / ops: users (staff rows), ops_roles, ops_users, staff_invitations,
 *     staff_calendar_accounts, staff_working_hours, calendar_busy_blocks,
 *     staff_calendar_feeds, staff_presence.
 *   - Config settings: platform_settings, settings_audit, auth_settings,
 *     fee_definitions, lookup_values, service_packages, email_templates,
 *     destinations, catalog_universities, catalog_programs, catalog_scholarships,
 *     cms_content.
 */

import { Pool } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL is not set.");
	process.exit(1);
}

/*
 * Tables to TRUNCATE.
 *
 * These are the journey-data tables: applicant profiles, consultations,
 * applications, school tracks, bookings, invoices, leads, payments, chat,
 * notifications, marketing, and student scholarships.
 *
 * CASCADE propagates to dependent rows (invoice_lines, booking_events,
 * messages, etc.) so they are not listed individually — but they are included
 * explicitly below for clarity and to make the audit log readable.
 */
const JOURNEY_TABLES = [
	// Applicant journey
	"applicants",
	"consultations",
	"consultation_activities",
	"applications",
	"school_applications",
	"school_track_events",
	"stage_assignments",
	"case_comments",
	"case_assignments",
	// Bookings
	"bookings",
	"booking_events",
	// Invoices & payments
	"invoices",
	"invoice_lines",
	"invoice_payments",
	"invoice_events",
	"payment_transactions",
	// Leads
	"leads",
	"lead_events",
	// Chat / communication
	"conversations",
	"messages",
	"message_reactions",
	"message_attachments",
	"conversation_participants",
	"message_mentions",
	"communication_events",
	// Notifications
	"notifications",
	"notification_log",
	// Documents
	"applicant_documents",
	// Per-user preferences (cascade on user delete, but explicit for clarity)
	"notification_preferences",
	// Marketing
	"marketing_campaigns",
	"campaign_recipients",
	"mailing_lists",
	"mailing_list_contacts",
	// Verifications (email/phone OTP codes — expire fast, clear for cleanliness)
	"verifications",
] as const;

async function main() {
	const pool = new Pool({
		connectionString: url,
		ssl: { rejectUnauthorized: false },
		max: 1,
		connectionTimeoutMillis: 15_000,
	});

	const client = await pool.connect();
	try {
		// ── Before counts ───────────────────────────────────────────────
		const before: Record<string, string> = {};
		for (const t of [...JOURNEY_TABLES, "users", "ops_users"]) {
			const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
			before[t] = String(r.rows[0].n);
		}

		const clientUsersBefore = await client.query(
			`SELECT COUNT(*)::int AS n FROM users
			 WHERE id NOT IN (SELECT user_id FROM ops_users WHERE user_id IS NOT NULL)`,
		);

		console.log("\n══ BEFORE ════════════════════════════════════════════");
		for (const t of [...JOURNEY_TABLES, "users", "ops_users"]) {
			console.log(`  ${t.padEnd(28)} ${before[t]}`);
		}
		console.log(`  ${"users (non-staff)".padEnd(28)} ${clientUsersBefore.rows[0].n}`);
		console.log(`  ${"ops_users (staff)".padEnd(28)} ${before["ops_users"]}`);

		if (DRY_RUN) {
			console.log("\n══ DRY RUN — no changes made ════════════════════════");
			console.log("Would execute:");
			console.log("  BEGIN;");
			console.log("  TRUNCATE TABLE");
			for (let i = 0; i < JOURNEY_TABLES.length; i++) {
				const comma = i < JOURNEY_TABLES.length - 1 ? "," : "";
				console.log(`    ${JOURNEY_TABLES[i]}${comma}`);
			}
			console.log("    RESTART IDENTITY CASCADE;");
			console.log("  -- Then delete non-staff users:");
			console.log("  DELETE FROM users WHERE id NOT IN (SELECT user_id FROM ops_users WHERE user_id IS NOT NULL);");
			console.log("  COMMIT;");
			return;
		}

		// ── Destructive cleanup, single transaction ────────────────────
		await client.query("BEGIN");

		const truncateList = JOURNEY_TABLES.join(", ");
		await client.query(`TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`);

		// Delete non-staff users. Staff users are those linked to ops_users.
		// sessions/accounts/two_factors cascade via FK onDelete:cascade on users.
		await client.query(
			`DELETE FROM users
			 WHERE id NOT IN (SELECT user_id FROM ops_users WHERE user_id IS NOT NULL)`,
		);

		await client.query("COMMIT");

		// ── After counts ───────────────────────────────────────────────
		const after: Record<string, string> = {};
		for (const t of [...JOURNEY_TABLES, "users", "ops_users"]) {
			const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
			after[t] = String(r.rows[0].n);
		}

		console.log("\n══ AFTER ═════════════════════════════════════════════");
		for (const t of [...JOURNEY_TABLES, "users", "ops_users"]) {
			const delta = Number(after[t]) - Number(before[t]);
			const sign = delta > 0 ? "+" : "";
			console.log(`  ${t.padEnd(28)} ${after[t].padStart(8)}  (${sign}${delta})`);
		}
		console.log("\n✓ Journey data cleared. Staff and config settings preserved.");
	} catch (err) {
		console.error("\n✗ Cleanup failed — rolling back.", err);
		try {
			await client.query("ROLLBACK");
		} catch {
			/* ignore */
		}
		process.exitCode = 1;
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
