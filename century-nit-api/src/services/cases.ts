import { and, desc, eq, inArray, isNull, ne, not, sql } from "drizzle-orm";
import {
	CASE_ERROR_CODES,
	type AddComment,
	type ApiApplicant,
	type ApiApplication,
	type ApiConsultation,
	type ApplicantProfile,
	type AssessmentResult,
	type CaseApplicationStatus,
	type AcceptProceedResponse,
	canAdvanceToStage,
	JOURNEY_STAGES,
	JOURNEY_STAGE_LABELS,
	type JourneyStage,
	patchApplicationSchema,
	type ProceedQuotation,
} from "century-nit-shared";
import { serviceFeeFor, type SchoolFundingTrack } from "century-nit-core/content";
import type { z } from "zod";
import { db } from "../db/index.js";
import {
	applicantDocuments,
	applicants,
	applications,
	bookings,
	caseComments,
	consultationActivities,
	consultations,
	invoices,
	invoiceEvents,
	invoiceLines,
	notifications,
	opsUsers,
	schoolApplications,
	servicePackages,
	stageHandoffs,
	travelAssistanceRequests,
} from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import type { StaffContext } from "../middleware/auth.js";
import * as mail from "./notifications.js";
import { queueEmails } from "../worker/queues.js";
import { notify, notifyMany, getStaffUserId, getManagerAndCoordinatorUserIds } from "./notify.js";
import { listSchoolsForApplication } from "./schools.js";
import { createInvoice, getFeeSchedule, type InvoiceRow } from "./invoice.js";
import {
	linkApplicationToLead,
	syncLeadAssignment,
	syncLeadFromApplicationStatus,
} from "./leads.js";
import {
	activeHandlerFor,
	createOrGetHandoff,
	isAwaitingAssignmentBoundary,
	isOwnerClassBoundary,
	pendingHandoffForApplication,
} from "./handoffs.js";

export type ApplicantRow = typeof applicants.$inferSelect;
export type ConsultationRow = typeof consultations.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type CommentRow = typeof caseComments.$inferSelect;

type Actor = { opsUserId: string; name: string; email: string };

function emptyProfile(): ApplicantProfile {
	return {};
}

async function nextAppNumber(tx: typeof db): Promise<string> {
	const year = new Date().getUTCFullYear();
	await tx.execute(sql`SELECT pg_advisory_xact_lock(710004, ${year})`);
	const [row] = await tx
		.select({
			max: sql<number>`coalesce(max(split_part(${applications.appNumber}, '-', 3)::int), 0)::int`,
		})
		.from(applications)
		.where(sql`${applications.appNumber} like ${`APP-${year}-%`}`);
	return `APP-${year}-${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

async function loadStaff(id: string | null) {
	if (!id) return null;
	const [row] = await db.select().from(opsUsers).where(eq(opsUsers.id, id)).limit(1);
	return row ?? null;
}

async function commentsFor(
	targetType: "consultation" | "application",
	targetId: string,
): Promise<CommentRow[]> {
	return db
		.select()
		.from(caseComments)
		.where(and(eq(caseComments.targetType, targetType), eq(caseComments.targetId, targetId)))
		.orderBy(caseComments.at);
}

function toComment(row: CommentRow) {
	return {
		id: row.id,
		at: row.at.toISOString(),
		author: row.authorName,
		kind: row.kind,
		text: row.text,
	};
}

export function canSeeAllCases(staff: StaffContext | null): boolean {
	return (
		staff?.role === "manager" ||
		staff?.role === "coordinator" ||
		staff?.role === "super_admin"
	);
}

export function canSeeConsultation(
	row: { assignedOfficerId: string | null; applicantUserId?: string | null },
	userId: string,
	staff: StaffContext | null,
): boolean {
	if (row.applicantUserId && row.applicantUserId === userId) return true;
	if (!staff) return false;
	if (canSeeAllCases(staff)) return true;
	if (staff.role === "consultant") return row.assignedOfficerId === staff.opsUserId;
	return false;
}

export function canSeeApplication(
	row: { assignedStaffId: string | null; applicantUserId?: string | null },
	userId: string,
	staff: StaffContext | null,
): boolean {
	if (row.applicantUserId && row.applicantUserId === userId) return true;
	if (!staff) return false;
	if (canSeeAllCases(staff)) return true;
	if (staff.role === "consultant") return row.assignedStaffId === staff.opsUserId;
	return false;
}

/* ── Ensure from booking ─────────────────────────────────────────────────── */

/**
 * Create (or reuse) the applicant + consultation that belong to a booking.
 *
 * Called after a booking is committed so the operations queue and the calendar
 * describe the same person. Safe to call twice — the unique booking_id on
 * consultations makes a second insert a no-op.
 */
export async function ensureCaseForBooking(booking: {
	id: string;
	reference: string;
	clientUserId: string;
	clientName: string;
	clientEmail: string;
	clientPhone: string | null;
	branchId: string;
	type: string;
}): Promise<ConsultationRow> {
	const email = booking.clientEmail.trim().toLowerCase();

	const [existingByBooking] = await db
		.select()
		.from(consultations)
		.where(eq(consultations.bookingId, booking.id))
		.limit(1);
	if (existingByBooking) return existingByBooking;

	const applicant = await db.transaction(async (tx) => {
		const [byUser] = booking.clientUserId
			? await tx.select().from(applicants).where(eq(applicants.userId, booking.clientUserId)).limit(1)
			: [];
		if (byUser) {
			await tx
				.update(applicants)
				.set({
					name: booking.clientName,
					phone: booking.clientPhone ?? byUser.phone,
					branch: booking.branchId,
					updatedAt: new Date(),
				})
				.where(eq(applicants.id, byUser.id));
			return byUser;
		}

		const [byEmail] = await tx.select().from(applicants).where(eq(applicants.email, email)).limit(1);
		if (byEmail) {
			await tx
				.update(applicants)
				.set({
					userId: booking.clientUserId || byEmail.userId,
					name: booking.clientName,
					phone: booking.clientPhone ?? byEmail.phone,
					branch: booking.branchId,
					updatedAt: new Date(),
				})
				.where(eq(applicants.id, byEmail.id));
			return { ...byEmail, userId: booking.clientUserId || byEmail.userId };
		}

		const [created] = await tx
			.insert(applicants)
			.values({
				userId: booking.clientUserId,
				email,
				name: booking.clientName,
				phone: booking.clientPhone,
				branch: booking.branchId,
				profile: {},
			})
			.returning();
		return created;
	});

	const [created] = await db
		.insert(consultations)
		.values({
			reference: booking.reference,
			bookingId: booking.id,
			applicantId: applicant.id,
			branch: booking.branchId,
			type: booking.type,
			status: "UNDER_REVIEW",
		})
		.onConflictDoNothing({ target: consultations.bookingId })
		.returning();

	if (created) return created;

	const [again] = await db
		.select()
		.from(consultations)
		.where(eq(consultations.bookingId, booking.id))
		.limit(1);
	return again!;
}

/** Keep the consultation assignment in step when a booking is assigned. */
export async function syncConsultationAssignment(
	bookingId: string,
	employeeId: string,
	actor: Actor,
): Promise<void> {
	const [row] = await db
		.select()
		.from(consultations)
		.where(eq(consultations.bookingId, bookingId))
		.limit(1);
	if (!row) return;
	if (row.status === "COMPLETED" || row.status === "CANCELLED") return;

	await db
		.update(consultations)
		.set({
			assignedOfficerId: employeeId,
			assignedAt: new Date(),
			assignedBy: actor.opsUserId,
			status:
				row.status === "CONFIRMED" || row.status === "IN_ASSESSMENT"
					? row.status
					: "ASSIGNED",
			updatedAt: new Date(),
		})
		.where(eq(consultations.id, row.id));

	await db
		.update(applicants)
		.set({ assignedOfficerId: employeeId, updatedAt: new Date() })
		.where(eq(applicants.id, row.applicantId));

	const applicant = await getApplicant(row.applicantId);
	if (applicant?.email) {
		const staff = await loadStaff(employeeId);
		if (staff) {
			await syncLeadAssignment(applicant.email, employeeId, staff.name, actor.name);
		}
	}
}

/**
 * Sync the consultation status when a booking is cancelled.
 *
 * Marks the consultation as cancelled, releases the assigned officer, and
 * clears the applicant's denormalized officer reference so the portal no
 * longer shows a counselor for a cancelled appointment.
 */
export async function syncConsultationCancelled(bookingId: string): Promise<void> {
	// Look up the consultation linked to this booking.
	const [row] = await db
		.select({ id: consultations.id, applicantId: consultations.applicantId, assignedOfficerId: consultations.assignedOfficerId, status: consultations.status })
		.from(consultations)
		.where(eq(consultations.bookingId, bookingId))
		.limit(1);

	if (!row) return;
	if (row.status === "COMPLETED" || row.status === "CANCELLED") return;

	await db
		.update(consultations)
		.set({
			status: "CANCELLED",
			assignedOfficerId: null,
			assignedAt: null,
			assignedBy: null,
			updatedAt: new Date(),
		})
		.where(eq(consultations.id, row.id));

	// End the assignment history row.
	const { endAssignment: endConsultAssignmentCancel } = await import("./caseAssignments.js");
	await endConsultAssignmentCancel({
		targetType: "consultation",
		targetId: row.id,
		endedBy: null,
		endReason: "cancelled",
	});

	// Release the officer on the applicant record too; the assignment is tied
	// to the live consultation/appointment, and once the appointment is gone
	// the officer should no longer appear in the portal header.
	await db
		.update(applicants)
		.set({ assignedOfficerId: null, updatedAt: new Date() })
		.where(eq(applicants.id, row.applicantId));
}

/**
 * Roll a confirmed consultation back to ASSIGNED when its booking slot moves.
 *
 * A new time means the old confirmation is void: the consultant must confirm
 * the rescheduled slot again before starting the assessment. Only CONFIRMED
 * consultations are affected — IN_ASSESSMENT/COMPLETED outcomes stay put.
 */
export async function syncConsultationRescheduled(bookingId: string): Promise<void> {
	await db
		.update(consultations)
		.set({ status: "ASSIGNED", updatedAt: new Date() })
		.where(and(eq(consultations.bookingId, bookingId), eq(consultations.status, "CONFIRMED")));
}

/**
 * Force-cancel the entire consultation process (separate from cancelling a
 * single booking).  Used by ops when the engagement should end entirely.
 *
 * Cascades to the linked booking so that the calendar event is removed,
 * reminders are cancelled, and the applicant + employee are notified by email.
 */
export async function cancelConsultation(
	consultationId: string,
	actor: { opsUserId: string; name: string; email: string },
	reason?: string,
): Promise<void> {
	const [row] = await db
		.select({ id: consultations.id, status: consultations.status, bookingId: consultations.bookingId, applicantId: consultations.applicantId })
		.from(consultations)
		.where(eq(consultations.id, consultationId))
		.limit(1);

	if (!row) return;
	if (row.status === "COMPLETED" || row.status === "CANCELLED") return;

	await db
		.update(consultations)
		.set({
			status: "CANCELLED",
			assignedOfficerId: null,
			assignedAt: null,
			assignedBy: null,
			updatedAt: new Date(),
		})
		.where(eq(consultations.id, row.id));

	// Release the officer on the applicant record too — the assignment is tied
	// to the live consultation, and once the consultation is gone the officer
	// should no longer appear in the portal or ops header.
	await db
		.update(applicants)
		.set({ assignedOfficerId: null, updatedAt: new Date() })
		.where(eq(applicants.id, row.applicantId));

	// Audit trail — record why the case was cancelled.
	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "status",
		text: `Consultation cancelled by ${actor.name}${reason ? `: ${reason}` : "."}`,
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});

	// Cascade to the linked booking — this handles calendar cancellation,
	// reminder cancellation, and email notifications to client + employee.
	if (row.bookingId) {
		try {
			const { cancelBooking } = await import("./booking.js");
			await cancelBooking({
				bookingId: row.bookingId,
				reason: reason ?? "Consultation cancelled by operations",
				actor,
			});
		} catch {
			// The booking may already be cancelled or in a terminal state.
			// The consultation itself is already cancelled, which is what matters.
		}
	}
}

/* ── Serialise ───────────────────────────────────────────────────────────── */

async function serializeConsultation(row: ConsultationRow): Promise<ApiConsultation> {
	const [applicant, coordinator, coordinatorAssigner, booking, comments, linkedApplication] = await Promise.all([
		db.select().from(applicants).where(eq(applicants.id, row.applicantId)).limit(1).then((r) => r[0]),
		loadStaff(row.coordinatorId),
		loadStaff(row.coordinatorAssignedBy),
		row.bookingId
			? db.select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1).then((r) => r[0] ?? null)
			: Promise.resolve(null),
		commentsFor("consultation", row.id),
		db
			.select({ id: applications.id, appNumber: applications.appNumber, stage: applications.stage })
			.from(applications)
			.where(eq(applications.consultationId, row.id))
			.limit(1)
			.then((r) => r[0] ?? null),
	]);

	// If the linked appointment has been cancelled, the public view of the
	// consultation should be cancelled too — even if the consultation row has
	// not yet been synced. Hide the counselor and meeting link so the portal
	// doesn't show an assigned staff member for a cancelled appointment.
	const isBookingCancelled = booking?.status === "CANCELLED";
	const effectiveStatus = isBookingCancelled ? "CANCELLED" : (row.status as ApiConsultation["status"]);
	const officer = isBookingCancelled ? null : await loadStaff(row.assignedOfficerId);

	const workflow = ((): ApiConsultation["workflow"] => {
		const base = { stage: "CONSULTATION", closureReason: null as string | null, nextAction: null as string | null };

		if (effectiveStatus === "CANCELLED" || isBookingCancelled) {
			return {
				status: "CLOSED",
				stage: "APPOINTMENT",
				closureReason: isBookingCancelled ? "APPOINTMENT_CANCELLED" : "CONSULTATION_CANCELLED",
				nextAction: "REBOOK_APPOINTMENT",
			};
		}

		if (effectiveStatus === "COMPLETED") {
			return { ...base, status: "COMPLETED", nextAction: "PROCEED_TO_ELIGIBILITY" };
		}

		if (effectiveStatus === "IN_ASSESSMENT") {
			return { ...base, status: "IN_PROGRESS", nextAction: "AWAIT_ASSESSMENT" };
		}

		if (officer || effectiveStatus === "ASSIGNED") {
			return { ...base, status: "IN_PROGRESS", nextAction: "ATTEND_CONSULTATION" };
		}

		return { ...base, status: "AWAITING_ASSIGNMENT", nextAction: "ASSIGN_STAFF" };
	})();

	return {
		id: row.id,
		reference: row.reference,
		bookingId: row.bookingId,
		applicantId: row.applicantId,
		applicantUserId: applicant?.userId ?? null,
		applicantName: applicant?.name ?? "",
		email: applicant?.email ?? "",
		phone: applicant?.phone ?? null,
		branch: row.branch,
		type: row.type,
		targetCountry: row.targetCountry ?? applicant?.targetCountry ?? null,
		status: effectiveStatus,
		assignedOfficerId: isBookingCancelled ? null : row.assignedOfficerId,
		assignedOfficerName: isBookingCancelled ? null : (officer?.name ?? null),
		assignedOfficerEmail: isBookingCancelled ? null : (officer?.email ?? null),
		coordinatorId: row.coordinatorId,
		coordinatorName: coordinator?.name ?? null,
		coordinatorEmail: coordinator?.email ?? null,
		coordinatorAssignedAt: row.coordinatorAssignedAt?.toISOString() ?? null,
		coordinatorAssignedByName: coordinatorAssigner?.name ?? null,
		delegationNote: row.delegationNote ?? null,
		slotConfirmed: row.status === "CONFIRMED" || row.status === "IN_ASSESSMENT",
		startsAt: booking?.startsAt.toISOString() ?? null,
		timezone: booking?.timezone ?? null,
		meetingUrl: isBookingCancelled ? null : (booking?.meetingUrl ?? null),
		rescheduleRequestedAt: booking?.rescheduleRequestedAt?.toISOString() ?? null,
		rescheduleRequestedStartsAt: booking?.rescheduleRequestedStartsAt?.toISOString() ?? null,
		rescheduleRequestReason: booking?.rescheduleRequestReason ?? null,
		assessmentResult: row.assessmentResult ?? null,
		requestedDocuments: row.requestedDocuments ?? [],
		comments: comments.map(toComment),
		profile: (applicant?.profile as ApplicantProfile) ?? emptyProfile(),
		workflow,
		applicationId: linkedApplication?.id ?? null,
		applicationNumber: linkedApplication?.appNumber ?? null,
		applicationStage: linkedApplication?.stage ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

async function serializeApplication(row: ApplicationRow): Promise<ApiApplication> {
	const [applicant, staff, comments] = await Promise.all([
		db.select().from(applicants).where(eq(applicants.id, row.applicantId)).limit(1).then((r) => r[0]),
		loadStaff(row.assignedStaffId),
		commentsFor("application", row.id),
	]);

	// Scoped to this application, not the applicant — an earlier application's
	// tracks must not appear on this one.
	const schoolList = await listSchoolsForApplication(row.id);

	const pendingHandoff = await pendingHandoffForApplication(row.id);

	// Load consent status for all three stages so the portal can decide
	// whether to show the consent card.
	const { getStageConsent } = await import("./stageConsents.js");
	const [applicationConsent, visaConsent, travelConsent] = await Promise.all([
		getStageConsent(row.id, "application"),
		getStageConsent(row.id, "visa"),
		getStageConsent(row.id, "travel"),
	]);

	// The same journey the portal shows, so ops sees the client's step.
	const { journeyForApplicant } = await import("./journey.js");
	const journey = applicant
		? await journeyForApplicant(applicant, row, { schoolTracks: schoolList, visaConsent }).catch(() => null)
		: null;

	return {
		id: row.id,
		appNumber: row.appNumber,
		applicantId: row.applicantId,
		applicantName: applicant?.name ?? "",
		email: applicant?.email ?? "",
		phone: applicant?.phone ?? null,
		branch: applicant?.branch ?? "",
		university: row.university,
		program: row.program,
		country: row.country,
		degreeLevel: row.degreeLevel,
		assignedStaffId: row.assignedStaffId,
		assignedStaffName: staff?.name ?? null,
		assignedStaffEmail: staff?.email ?? null,
		stage: row.stage as JourneyStage,
		status: row.status,
		proceedStatus: row.proceedStatus,
		proceededAt: row.proceededAt?.toISOString() ?? null,
		declinedReason: row.declinedReason,
		fundingTrack: row.fundingTrack,
		targetSchoolCount: row.targetSchoolCount ?? null,
		notes: row.notes,
		checklist: row.checklist ?? [],
		visaStage: row.visaStage,
		visaInvoicePaid: row.visaInvoicePaid,
		visaCounselorNote: row.visaCounselorNote,
		paymentPlanId: row.paymentPlanId,
		packageId: row.packageId,
		packageSelectedAt: row.packageSelectedAt?.toISOString() ?? null,
		agencyStageIndex: row.agencyStageIndex,
		agencySettled: row.agencySettled,
		depositPaid: row.depositPaid,
		appFeePaid: row.appFeePaid,
		travelInvoicePaid: row.travelInvoicePaid,
		travelClearance: row.travelClearance === "cleared" ? "cleared" : "pending",
		requestedDocuments: row.requestedDocuments ?? [],
		preDepartureTasks: (row.preDepartureTasks ?? []) as ApiApplication["preDepartureTasks"],
		comments: comments.map(toComment),
		pendingHandoff,
		consultationId: row.consultationId ?? null,
		consultationNumber: null,
		schoolApplications: schoolList.schools,
		applicationConsent,
		visaConsent,
		travelConsent,
		journey: journey
			? {
					portalStage: journey.portalStage,
					label: journey.label,
					nextUnlock: journey.nextUnlock,
					stageStatuses: journey.stageStatuses,
				}
			: undefined,
		submittedAt: row.submittedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

async function serializeApplicant(row: ApplicantRow): Promise<ApiApplicant> {
	const officer = await loadStaff(row.assignedOfficerId);
	const [latestApp] = await db
		.select({ stage: applications.stage, status: applications.status })
		.from(applications)
		.where(eq(applications.applicantId, row.id))
		.orderBy(desc(applications.createdAt))
		.limit(1);
	const [latestConsult] = latestApp
		? []
		: await db
				.select({ status: consultations.status })
				.from(consultations)
				.where(and(eq(consultations.applicantId, row.id), ne(consultations.status, "CANCELLED")))
				.orderBy(desc(consultations.createdAt))
				.limit(1);

	const currentStage = latestApp?.stage ?? "pre_application";
	const status =
		latestApp?.status === "ACCEPTED"
			? "Enrolled"
			: latestApp
				? "Active"
				: latestConsult?.status === "COMPLETED"
					? "Assessed"
					: "Active";

	return {
		id: row.id,
		userId: row.userId,
		email: row.email,
		name: row.name,
		phone: row.phone,
		branch: row.branch,
		targetCountry: row.targetCountry,
		assignedOfficerId: row.assignedOfficerId,
		assignedOfficerName: officer?.name ?? null,
		assignedOfficerEmail: officer?.email ?? null,
		profile: (row.profile as ApplicantProfile) ?? emptyProfile(),
		portalState: (row.portalState as Record<string, unknown>) ?? {},
		currentStage,
		status,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/* ── List / get ──────────────────────────────────────────────────────────── */

export async function listConsultations(staff: StaffContext): Promise<ConsultationRow[]> {
	if (canSeeAllCases(staff)) {
		return db.select().from(consultations).orderBy(desc(consultations.createdAt));
	}
	return db
		.select()
		.from(consultations)
		.where(
			sql`${consultations.assignedOfficerId} = ${staff.opsUserId} OR ${consultations.coordinatorId} = ${staff.opsUserId}`,
		)
		.orderBy(desc(consultations.createdAt));
}

export async function listApplications(staff: StaffContext): Promise<ApplicationRow[]> {
	// Only applications where the 10% deposit has been paid are visible to ops.
	// Applications without a deposit are still portal-only — the applicant hasn't
	// crossed into the operational workflow yet.
	const depositFilter = eq(applications.depositPaid, true);
	if (canSeeAllCases(staff)) {
		return db.select().from(applications).where(depositFilter).orderBy(desc(applications.createdAt));
	}
	return db
		.select()
		.from(applications)
		.where(and(depositFilter, eq(applications.assignedStaffId, staff.opsUserId)))
		.orderBy(desc(applications.createdAt));
}

export async function listApplicants(staff: StaffContext): Promise<ApplicantRow[]> {
	if (canSeeAllCases(staff)) {
		return db.select().from(applicants).orderBy(desc(applicants.createdAt));
	}
	return db
		.select()
		.from(applicants)
		.where(eq(applicants.assignedOfficerId, staff.opsUserId))
		.orderBy(desc(applicants.createdAt));
}

export async function getConsultation(id: string): Promise<ConsultationRow | null> {
	const [row] = await db.select().from(consultations).where(eq(consultations.id, id)).limit(1);
	return row ?? null;
}

export async function getApplication(id: string): Promise<ApplicationRow | null> {
	const [row] = await db.select().from(applications).where(eq(applications.id, id)).limit(1);
	return row ?? null;
}

export async function getApplicant(id: string): Promise<ApplicantRow | null> {
	const [row] = await db.select().from(applicants).where(eq(applicants.id, id)).limit(1);
	return row ?? null;
}

export async function getApplicantByUserId(userId: string): Promise<ApplicantRow | null> {
	const [row] = await db.select().from(applicants).where(eq(applicants.userId, userId)).limit(1);
	return row ?? null;
}

/**
 * Travel assistance status for an application, used by the journey gate.
 * Returns `null` when no request exists (legacy applications) so the gate
 * falls back to the old `travelInvoicePaid` / `travelClearance` signals.
 */
async function getTravelAssistanceStatusForApplication(
	applicationId: string,
): Promise<
	| "decision_pending"
	| "review"
	| "quote_prepared"
	| "quote_approved"
	| "invoiced"
	| "ticket_paid"
	| "booked"
	| "cleared"
	| "declined"
	| "on_hold"
	| null
> {
	const [row] = await db
		.select({ status: travelAssistanceRequests.status })
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.applicationId, applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt))
		.limit(1);
	return row?.status ?? null;
}

export { serializeConsultation, serializeApplication, serializeApplicant };

/* ── Consultation commands ───────────────────────────────────────────────── */

export async function assignConsultation(input: {
	id: string;
	employeeId: string;
	actor: Actor;
}): Promise<ConsultationRow> {
	const row = await getConsultation(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}

	const employee = await loadStaff(input.employeeId);
	if (!employee?.active) throw new HttpError(404, "NOT_FOUND", "Employee not found");

	const [updated] = await db
		.update(consultations)
		.set({
			assignedOfficerId: input.employeeId,
			assignedAt: new Date(),
			assignedBy: input.actor.opsUserId,
			status: row.status === "IN_ASSESSMENT" ? "IN_ASSESSMENT" : "ASSIGNED",
			updatedAt: new Date(),
		})
		.where(eq(consultations.id, row.id))
		.returning();

	// Record the assignment in the append-only history table.
	const { startAssignment } = await import("./caseAssignments.js");
	await startAssignment({
		targetType: "consultation",
		targetId: row.id,
		opsUserId: input.employeeId,
		assignedBy: input.actor.opsUserId,
	});

	await db
		.update(applicants)
		.set({ assignedOfficerId: input.employeeId, updatedAt: new Date() })
		.where(eq(applicants.id, row.applicantId));

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "assignment",
		text: `Assigned to ${employee.name}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	if (updated.bookingId) {
		const { assignBooking } = await import("./booking.js");
		try {
			await assignBooking({
				bookingId: updated.bookingId,
				employeeId: input.employeeId,
				actor: input.actor,
			});
		} catch (err) {
			if (err instanceof HttpError && err.code === "EMPLOYEE_UNAVAILABLE") throw err;
			// Booking already assigned to this person, or calendar retry — the case is assigned.
		}
	} else {
		// No linked booking — send a standalone assignment notification to the consultant.
		try {
			const applicant = await db
				.select()
				.from(applicants)
				.where(eq(applicants.id, row.applicantId))
				.limit(1)
				.then((r) => r[0]);
			const email = mail.consultationAssigned({
				reference: updated.reference,
				clientName: applicant?.name ?? "Client",
				clientEmail: applicant?.email ?? "",
				employeeName: employee.name,
				employeeEmail: employee.email,
			});
			await queueEmails([email]);

			// In-app notification to the assigned consultant.
			const userId = await getStaffUserId(employee.id);
			if (userId) {
				await notify({
					recipientUserId: userId,
					type: "consultation.assigned",
					title: "New consultation assigned",
					body: `${applicant?.name ?? "A client"}'s consultation has been assigned to you. Ref: ${updated.reference}`,
					link: "/applications",
				}).catch(() => {});
			}
		} catch (err) {
			console.error(`[cases] failed to queue consultation assignment email for ${updated.reference}:`, err);
		}
	}

	return updated;
}

/**
 * Confirm the meeting slot for an assigned consultation.
 *
 * The slot is only ever confirmed once a consultant is assigned AND the time is
 * still ahead of us. Confirmation is a real state transition: the consultation
 * moves ASSIGNED → CONFIRMED and the linked booking is marked CONFIRMED so both
 * records agree. The applicant is told (email + in-app) that the slot is locked
 * and gets the meeting link if one is set. Idempotent — re-confirming a
 * CONFIRMED consultation is a no-op.
 */
export async function confirmConsultationSlot(id: string, actor: Actor): Promise<ConsultationRow> {
	const row = await getConsultation(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}
	if (row.status === "CONFIRMED") return row;

	if (row.status !== "ASSIGNED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "Assign a consultant before confirming the slot");
	}

	if (row.bookingId) {
		const [booking] = await db.select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
		if (booking) {
			if (booking.startsAt.getTime() <= Date.now()) {
				throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "That slot is already in the past");
			}
			await db
				.update(bookings)
				.set({ status: "CONFIRMED", updatedAt: new Date() })
				.where(eq(bookings.id, row.bookingId));
		}
	}

	const [updated] = await db
		.update(consultations)
		.set({ status: "CONFIRMED", updatedAt: new Date() })
		.where(eq(consultations.id, id))
		.returning();

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: id,
		kind: "status",
		text: "Slot confirmed — booking locked",
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});

	// Tell the applicant the slot is locked (email that carries the link + in-app).
	try {
		const applicant = await getApplicant(row.applicantId);
		if (row.bookingId && applicant?.email) {
			const { notificationContext } = await import("./booking.js");
			const [booking] = await db
				.select()
				.from(bookings)
				.where(eq(bookings.id, row.bookingId))
				.limit(1);
			if (booking) {
				const employee = booking.employeeId ? await loadStaff(booking.employeeId) : null;
				const ctx = await notificationContext(
					booking,
					employee ? { name: employee.name, email: employee.email, id: employee.id } : null,
				);
				await queueEmails([mail.bookingSlotConfirmedForClient(ctx)]);
			}
		}
		if (applicant?.userId) {
			notify({
				recipientUserId: applicant.userId,
				type: "booking.slot_confirmed",
				title: "Your consultation slot is confirmed",
				body: `Your consultation slot has been locked in. Ref: ${row.reference}`,
				link: "/portal/consultation",
			}).catch(() => {});
		}
	} catch (err) {
		console.error(`[cases] failed to queue slot-confirmed email for ${row.reference}:`, err);
	}

	return updated;
}

export async function startConsultationAssessment(id: string, actor: Actor): Promise<ConsultationRow> {
	const row = await getConsultation(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}
	if (row.status === "IN_ASSESSMENT") return row; // idempotent
	if (row.status !== "CONFIRMED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "Confirm the meeting slot before starting the assessment");
	}
	const [updated] = await db
		.update(consultations)
		.set({ status: "IN_ASSESSMENT", updatedAt: new Date() })
		.where(eq(consultations.id, id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: id,
		kind: "status",
		text: "Assessment started",
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});
	return updated;
}

export async function completeConsultationAssessment(input: {
	id: string;
	result: AssessmentResult;
	actor: Actor;
}): Promise<{ consultation: ConsultationRow; application: ApplicationRow | null }> {
	const row = await getConsultation(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}
	if (row.status === "COMPLETED") {
		// Idempotent resubmission — return the locked result and any application
		// that the original completion already created.
		const [existing] = await db
			.select()
			.from(applications)
			.where(eq(applications.consultationId, row.id))
			.limit(1);
		return { consultation: row, application: existing ?? null };
	}
	if (row.status !== "IN_ASSESSMENT") {
		throw new HttpError(
			409,
			CASE_ERROR_CODES.CASE_CLOSED,
			"Start the assessment before completing it",
		);
	}

	const [updated] = await db
		.update(consultations)
		.set({
			status: "COMPLETED",
			assessmentResult: input.result,
			updatedAt: new Date(),
		})
		.where(eq(consultations.id, row.id))
		.returning();

	// Mark the booking as COMPLETED so the portal appointment card updates —
	// the portal reads the booking status, not the consultation status, so
	// without this the appointment stays "Confirmed" even after the assessment
	// is done.
	if (row.bookingId) {
		await db
			.update(bookings)
			.set({ status: "COMPLETED", updatedAt: new Date() })
			.where(eq(bookings.id, row.bookingId));
	}

	// End the assignment history row — the consultation is closed.
	const { endAssignment: endConsultAssignmentComplete } = await import("./caseAssignments.js");
	await endConsultAssignmentComplete({
		targetType: "consultation",
		targetId: row.id,
		endedBy: input.actor.opsUserId,
		endReason: "completed",
	});

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "recommendation",
		text: `${input.result.outcome}${input.result.notes ? ` — ${input.result.notes}` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	const eligible =
		input.result.outcome === "Eligible" || input.result.outcome === "Conditionally Eligible";

	const applicant = (await getApplicant(row.applicantId))!;
	try {
		await queueEmails([
			mail.assessmentCompleteForClient({
				reference: updated.reference,
				clientName: applicant.name ?? "Client",
				clientEmail: applicant.email ?? "",
			}),
		]);
	} catch (err) {
		console.error(`[cases] failed to queue assessment email for ${updated.reference}:`, err);
	}

	// In-app: tell the client their assessment is ready to view.
	if (applicant.userId) {
		notify({
			recipientUserId: applicant.userId,
			type: "assessment.complete",
			title: "Your assessment is complete",
			body: "Your eligibility assessment has been completed. View your results.",
			link: "/portal/tracking",
		}).catch(() => {});
	}

	if (!eligible) return { consultation: updated, application: null };

	const [existing] = await db
		.select()
		.from(applications)
		.where(eq(applications.consultationId, row.id))
		.limit(1);
	if (existing) return { consultation: updated, application: existing };
	const checklist = (row.requestedDocuments ?? []).map((label, i) => ({
		id: `chk-${i}`,
		label,
		checked: false,
	}));

	const created = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const appNumber = await nextAppNumber(txDb);
		const [app] = await tx
			.insert(applications)
			.values({
				appNumber,
				applicantId: row.applicantId,
				consultationId: row.id,
				university: input.result.recUniversity || "TBC",
				program: input.result.recProgram || "TBC",
				country: input.result.recCountry || row.targetCountry || applicant.targetCountry || "TBC",
				degreeLevel: (applicant.profile as ApplicantProfile)?.degreeLevel || "Master's",
				// Deliberately null: the consultation's officer must NOT be inherited —
				// a manager assigns the application handler from the ops workspace.
				assignedStaffId: null,
				stage: "document_verification",
				status: "UNDER_REVIEW",
				// The application is locked until the client consents to start it.
				proceedStatus: "invited",
				fundingTrack: input.result.recPackage || null,
				notes: input.result.notes || "Opened from a completed consultation assessment.",
				checklist,
				requestedDocuments: row.requestedDocuments ?? [],
				submittedAt: new Date(),
			})
			.returning();

		// Fully release the consultant — same principle as assignedStaffId above.
		await tx
			.update(applicants)
			.set({ assignedOfficerId: null, updatedAt: new Date() })
			.where(eq(applicants.id, row.applicantId));

		return app;
	});

	if (applicant?.email && created) {
		await linkApplicationToLead(created.id, applicant.email, input.actor.name);
	}

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: created.id,
		kind: "assignment",
		text: "Application opened — awaiting assignment",
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	// NOTE: the school_submission handoff is NOT created here. It fires when
	// the 10% agency deposit is paid (see recordPayment in invoice.ts). Creating
	// it at consultation completion was premature — the applicant hasn't even
	// accepted to proceed yet, and a pending handoff for a declined applicant
	// would sit in the ops queue as a phantom entry.

	// In-app: hand the case to management — it needs an owner before work starts.
	getManagerAndCoordinatorUserIds()
		.then((recipients) =>
			notifyMany(
				recipients.map((r) => ({
					recipientUserId: r.userId,
					type: "application.awaiting_assignment",
					title: "New application awaiting assignment",
					body: `${applicant.name ?? "A client"}'s application ${created.appNumber} opened from consultation ${updated.reference} — awaiting assignment.`,
					link: "/applications",
					entityType: "case",
					entityId: created.id,
					caseId: created.id,
				})),
			),
		)
		.catch(() => {});

	return { consultation: updated, application: created };
}

/** ── Consent gate: "start your application?" (post-consultation) ─────────── */

/**
 * Compute the pre-commit advisory quotation for the application's current
 * DRAFT school selection. Pure function — nothing is cached; the final,
 * payable figure is raised separately as a proforma by a consultant.
 */
export async function quotationForApplication(applicationId: string): Promise<ProceedQuotation> {
	const [app] = await db
		.select()
		.from(applications)
		.where(eq(applications.id, applicationId))
		.limit(1);
	if (!app) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const draftRows = await db
		.select()
		.from(schoolApplications)
		.where(and(eq(schoolApplications.applicationId, applicationId), eq(schoolApplications.status, "Preparing Application")));

	const fees = await getFeeSchedule();
	const schoolCount = draftRows.length;
	const appSubtotalCents =
		fees.appBaseCents + schoolCount * fees.appPerSchoolCents + fees.appDocVerifyCents;
	const agencyFeeCents = Math.round(serviceFeeFor((app.fundingTrack ?? "") as SchoolFundingTrack | "") * 100);
	const visaFeeCents = fees.visaBaseCents;

	return {
		schoolCount,
		appBaseCents: fees.appBaseCents,
		perSchoolCents: fees.appPerSchoolCents,
		appSubtotalCents,
		agencyFeeCents,
		visaFeeCents,
		totalCents: agencyFeeCents + appSubtotalCents + visaFeeCents,
		currency: "USD",
		advisory:
			"An estimate. This is not an invoice — your consultant will raise the payable proforma once your application is opened.",
	};
}

async function lockApplicationRow(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	applicationId: string,
): Promise<ApplicationRow | undefined> {
	const txDb = tx as unknown as typeof db;
	const [row] = await txDb
		.select()
		.from(applications)
		.where(eq(applications.id, applicationId))
		.for("update")
		.limit(1);
	return row;
}

/**
 * Applicant (or ops override on the applicant's behalf) accepts to start the
 * application. State machine: `invited → accepted` (applicant), and additionally
 * `declined → accepted` for an ops override after a phone re-confirmation.
 */
export async function acceptProceedForApplication(input: {
	applicationId: string;
	fundingTrack?: string | null;
	degreeLevel?: string;
	country?: string;
	reason?: string;
	actor: { opsUserId?: string; name: string };
}): Promise<AcceptProceedResponse> {
	const { applicationId, actor } = input;

	return db.transaction(async (tx) => {
		const row = await lockApplicationRow(tx, applicationId);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

		// An applicant may accept from "invited" or after putting the case on
		// hold; only ops can accept on behalf of someone who declined.
		const isOverride = typeof actor.opsUserId === "string";
		const allowed =
			row.proceedStatus === "invited" ||
			row.proceedStatus === "paused" ||
			(isOverride && row.proceedStatus === "declined");
		if (!allowed) {
			throw new HttpError(
				409,
				"PROCEED_ALREADY_DECIDED",
				row.proceedStatus === "accepted"
					? "This application has already been accepted to proceed."
					: "This application was declined. A member of our team must re-invite you before you can proceed.",
			);
		}

		// School selection now happens *after* consent, so do not require draft
		// schools before the applicant can confirm they want to proceed.
		const schoolCount = 0;

		const txDb = tx as unknown as typeof db;
		await txDb
			.update(applications)
			.set({
				proceedStatus: "accepted",
				proceededAt: new Date(),
				declinedReason: null,
				fundingTrack: input.fundingTrack ?? row.fundingTrack,
				degreeLevel: input.degreeLevel ?? row.degreeLevel,
				country: input.country ?? row.country,
				updatedAt: new Date(),
			})
			.where(eq(applications.id, applicationId));

		await txDb.insert(caseComments).values({
			targetType: "application",
			targetId: applicationId,
			kind: "recommendation",
			text: (() => {
				const base = `${isOverride ? "Ops" : "Applicant"} confirmed to proceed with the application and accepted the pricing shown.`;
				if (isOverride && input.reason) {
					return `${base} Reason for override: ${input.reason}`;
				}
				return base;
			})(),
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId ?? null,
		});

		return { quotation: await quotationForApplication(applicationId), schoolCount };
	});
}

/**
 * Applicant declines to proceed. Reversible: staff can re-invite
 * (`reinviteProceedForApplication`) so the gate reopens on `invited`.
 */
export async function declineProceedForApplication(input: {
	applicationId: string;
	reason?: string;
	actor: { opsUserId?: string; name: string };
}): Promise<void> {
	const { applicationId, actor } = input;

	return db.transaction(async (tx) => {
		const row = await lockApplicationRow(tx, applicationId);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		if (row.proceedStatus === "accepted") {
			throw new HttpError(409, "PROCEED_ALREADY_DECIDED", "This application is already open and cannot be declined.");
		}
		if (row.proceedStatus === "declined") return;

		const txDb = tx as unknown as typeof db;
		await txDb
			.update(applications)
			.set({
				proceedStatus: "declined",
				proceededAt: new Date(),
				declinedReason: input.reason ?? null,
				updatedAt: new Date(),
			})
			.where(eq(applications.id, applicationId));

		await txDb.insert(caseComments).values({
			targetType: "application",
			targetId: applicationId,
			kind: "recommendation",
			text: `Applicant declined to proceed${input.reason ? `: ${input.reason}` : "."}`,
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId ?? null,
		});
	});
}

/**
 * Applicant places application on hold / paused. Reversible at any time.
 */
export async function pauseProceedForApplication(input: {
	applicationId: string;
	reason?: string;
	actor: { opsUserId?: string; name: string };
}): Promise<void> {
	const { applicationId, actor } = input;

	return db.transaction(async (tx) => {
		const row = await lockApplicationRow(tx, applicationId);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		if (row.proceedStatus === "accepted") {
			throw new HttpError(409, "PROCEED_ALREADY_DECIDED", "This application is already open and cannot be paused.");
		}
		if (row.proceedStatus === "paused") return;

		const txDb = tx as unknown as typeof db;
		await txDb
			.update(applications)
			.set({
				proceedStatus: "paused",
				declinedReason: input.reason ?? "Applicant put application on hold",
				updatedAt: new Date(),
			})
			.where(eq(applications.id, applicationId));

		await txDb.insert(caseComments).values({
			targetType: "application",
			targetId: applicationId,
			kind: "recommendation",
			text: `Applicant put application on hold${input.reason ? `: ${input.reason}` : "."}`,
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId ?? null,
		});
	});
}

/**
 * Ops re-invite after a decline — reverses the gate back to `invited` so the
 * applicant can reconsider. Old declined selection rows are pruned.
 */
export async function reinviteProceedForApplication(input: {
	applicationId: string;
	actor: { opsUserId: string; name: string };
}): Promise<void> {
	const { applicationId, actor } = input;

	return db.transaction(async (tx) => {
		const row = await lockApplicationRow(tx, applicationId);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		if (row.proceedStatus !== "declined") {
			throw new HttpError(409, "PROCEED_NOT_DECLINED", "Only a declined application can be re-invited.");
		}

		const txDb = tx as unknown as typeof db;
		await txDb
			.update(applications)
			.set({
				proceedStatus: "invited",
				proceededAt: null,
				declinedReason: null,
				updatedAt: new Date(),
			})
			.where(eq(applications.id, applicationId));
		await txDb.delete(schoolApplications).where(
			and(eq(schoolApplications.applicationId, applicationId), eq(schoolApplications.status, "Preparing Application")),
		);

		await txDb.insert(caseComments).values({
			targetType: "application",
			targetId: applicationId,
			kind: "recommendation",
			text: "Applicant re-invited after declining to proceed.",
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId,
		});
	});
}

export async function respondToOutcome(input: {
	consultationId: string;
	userId: string;
	action: "accept" | "request_info";
	note?: string;
}): Promise<void> {
	const row = await getConsultation(input.consultationId);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status !== "COMPLETED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "Consultation is not yet completed");
	}

	const applicant = await getApplicantByUserId(input.userId);
	if (!applicant || applicant.id !== row.applicantId) {
		throw new HttpError(403, CASE_ERROR_CODES.CASE_CLOSED, "Not your consultation");
	}

	const text =
		input.action === "accept"
			? "Applicant accepted the assessment outcome and is proceeding to package selection."
			: `Applicant requested more information: ${input.note || "No additional note provided."}`;

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: input.action === "accept" ? "status" : "comment",
		text,
		authorName: applicant.name,
		authorOpsUserId: null,
	});

	if (row.assignedOfficerId) {
		const officer = await loadStaff(row.assignedOfficerId);
		if (officer) {
			await queueEmails([
				{
					to: officer.email,
					subject: input.action === "accept"
						? `Outcome accepted — ${applicant.name}`
						: `Applicant needs more info — ${applicant.name}`,
					text,
					html: `<p>${text}</p><p>Consultation ref: ${row.reference}</p>`,
					idempotencyKey: `notify:outcome:${row.id}:${input.action}`,
					template: input.action === "accept" ? "Outcome accepted" : "Applicant needs more info",
					reference: row.reference,
				},
			]);

			const officerUserId = await getStaffUserId(row.assignedOfficerId);
			if (officerUserId) {
				notify({
					recipientUserId: officerUserId,
					type: input.action === "accept" ? "outcome.accepted" : "outcome.info_requested",
					title: input.action === "accept"
						? `${applicant.name} accepted the outcome`
						: `${applicant.name} requested more info`,
					body: text,
					link: "/applications",
					entityType: "case",
					entityId: row.id,
				}).catch(() => {});
			}
		}
	}
}

export async function addCaseComment(input: {
	targetType: "consultation" | "application";
	targetId: string;
	data: AddComment;
	actor: Actor;
}): Promise<CommentRow> {
	const [row] = await db
		.insert(caseComments)
		.values({
			targetType: input.targetType,
			targetId: input.targetId,
			kind: input.data.kind,
			text: input.data.text,
			authorName: input.actor.name,
			authorOpsUserId: input.actor.opsUserId,
		})
		.returning();
	return row;
}

export async function requestCaseDocuments(input: {
	targetType: "consultation" | "application";
	targetId: string;
	documents: string[];
	actor: Actor;
}): Promise<void> {
	if (input.targetType === "consultation") {
		const row = await getConsultation(input.targetId);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
		const next = Array.from(new Set([...(row.requestedDocuments ?? []), ...input.documents]));
		await db
			.update(consultations)
			.set({ requestedDocuments: next, updatedAt: new Date() })
			.where(eq(consultations.id, row.id));
	} else {
		const row = await getApplication(input.targetId);
		if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
		const next = Array.from(new Set([...(row.requestedDocuments ?? []), ...input.documents]));
		await db
			.update(applications)
			.set({ requestedDocuments: next, updatedAt: new Date() })
			.where(eq(applications.id, row.id));
	}

	await db.insert(caseComments).values({
		targetType: input.targetType,
		targetId: input.targetId,
		kind: "document_request",
		text: `Requested: ${input.documents.join(", ")}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	// Notify the applicant when documents are requested on their application
	// (or consultation). The portal surfaces this as an action-required card.
	if (input.targetType === "application") {
		const [app] = await db
			.select({ applicantId: applications.applicantId })
			.from(applications)
			.where(eq(applications.id, input.targetId))
			.limit(1);
		if (app) {
			const [applicant] = await db
				.select({ userId: applicants.userId, name: applicants.name })
				.from(applicants)
				.where(eq(applicants.id, app.applicantId))
				.limit(1);
			if (applicant?.userId) {
				await notify({
					recipientUserId: applicant.userId,
					type: "document.requested",
					title: "Documents required",
					body: `Your case handler requested: ${input.documents.join(", ")}. Please upload them in your document vault.`,
					link: "/portal/documents",
					entityType: "case",
					entityId: input.targetId,
					caseId: input.targetId,
				}).catch(() => {});
			}
		}
	} else {
		const [cons] = await db
			.select({ applicantId: consultations.applicantId })
			.from(consultations)
			.where(eq(consultations.id, input.targetId))
			.limit(1);
		if (cons) {
			const [applicant] = await db
				.select({ userId: applicants.userId })
				.from(applicants)
				.where(eq(applicants.id, cons.applicantId))
				.limit(1);
			if (applicant?.userId) {
				await notify({
					recipientUserId: applicant.userId,
					type: "document.requested",
					title: "Documents required",
					body: `Your counselor requested: ${input.documents.join(", ")}. Please upload them in your document vault.`,
					link: "/portal/documents",
					entityType: "case",
					entityId: input.targetId,
				}).catch(() => {});
			}
		}
	}
}

/* ── Application commands ────────────────────────────────────────────────── */

export async function assignApplication(input: {
	id: string;
	employeeId: string;
	actor: Actor;
}): Promise<ApplicationRow> {
	const row = await getApplication(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const employee = await loadStaff(input.employeeId);
	if (!employee?.active) throw new HttpError(404, "NOT_FOUND", "Employee not found");
	const applicant = await getApplicant(row.applicantId);

	// The owner change and the pending handoff it answers must land together.
	const { setCaseOwner } = await import("./caseOwnership.js");
	const stageOpened = row.stage === "document_verification" && row.depositPaid;
	const updated = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		await setCaseOwner({
			applicationId: row.id,
			opsUserId: input.employeeId,
			assignedBy: input.actor.opsUserId,
			tx: txDb,
		});

		// The handler has been assigned directly, so any pending handoff is
		// answered. Without this the portal would keep showing "awaiting
		// specialist assignment" with a handler already in place.
		await txDb
			.update(stageHandoffs)
			.set({
				status: "resolved",
				decision: "assign",
				resolvedOpsUserId: input.employeeId,
				decidedBy: input.actor.opsUserId ?? null,
				decidedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(and(eq(stageHandoffs.applicationId, row.id), eq(stageHandoffs.status, "pending")));

		// A handler plus a paid deposit opens school submission. Without the
		// deposit the case stays at document_verification — the deposit
		// payment will open the stage when it lands (see recordPayment).
		if (stageOpened) {
			await txDb
				.update(applications)
				.set({ stage: "school_submission", updatedAt: new Date() })
				.where(and(eq(applications.id, row.id), eq(applications.stage, "document_verification")));
			await txDb.insert(caseComments).values({
				targetType: "application",
				targetId: row.id,
				kind: "status",
				text: "Stage → school_submission (handler assigned & deposit paid)",
				authorName: input.actor.name,
				authorOpsUserId: input.actor.opsUserId,
			});
		}

		const [app] = await txDb.select().from(applications).where(eq(applications.id, row.id)).limit(1);
		return app;
	});

	if (stageOpened) {
		const clientUserId = await applicantUserIdOfApplication(row.id);
		if (clientUserId) {
			notify({
				recipientUserId: clientUserId,
				type: "stage.changed",
				title: "Your application handler has been assigned",
				body: "A handler has been assigned to your case. You can now select your schools and programmes.",
				link: "/portal/application",
			}).catch(() => {});
		}
	}

	if (applicant?.email) {
		await syncLeadAssignment(applicant.email, input.employeeId, employee.name, input.actor.name);
	}

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "assignment",
		text: `Assigned to ${employee.name}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	// Notify the assigned staff member by email and in-app.
	const staffUserId = await getStaffUserId(employee.id);
	if (applicant) {
		try {
			await queueEmails([
				mail.caseAssigned({
					reference: updated.appNumber,
					clientName: applicant.name ?? "Client",
					clientEmail: applicant.email ?? "",
					employeeName: employee.name,
					employeeEmail: employee.email,
				}),
			]);
		} catch {
			// Email failure must not block the assignment.
		}

		// Also let the applicant know who is handling their case.
		try {
			await queueEmails([
				mail.consultantAssignedForClient({
					clientName: applicant.name ?? "Applicant",
					clientEmail: applicant.email ?? "",
					consultantName: employee.name,
					consultantEmail: employee.email,
					appNumber: updated.appNumber,
					portalUrl: env.FRONTEND_URL,
				}),
			]);
		} catch {
			// Email failure must not block the assignment.
		}
	}
	if (staffUserId) {
		notify({
			recipientUserId: staffUserId,
			type: "case.assigned",
			title: "New case assigned",
			body: `${applicant?.name ?? "A client"}'s case has been assigned to you. Ref: ${updated.appNumber}`,
			link: "/applications",
		}).catch(() => {});
	}

	await broadcastCaseUpdate(updated, input.actor);
	return updated;
}

export type PatchApplicationInput = z.infer<typeof patchApplicationSchema>;

async function broadcastCaseUpdate(application: ApplicationRow, actor: Actor): Promise<void> {
	try {
		const [applicant, assignedStaffUserId, managers] = await Promise.all([
			getApplicant(application.applicantId),
			application.assignedStaffId ? getStaffUserId(application.assignedStaffId) : null,
			getManagerAndCoordinatorUserIds(),
		]);
		const recipientIds = new Set<string>();
		if (assignedStaffUserId) recipientIds.add(assignedStaffUserId);
		for (const m of managers) {
			if (m.userId) recipientIds.add(m.userId);
		}
		if (recipientIds.size === 0) return;

		const events = Array.from(recipientIds).map((userId) => ({
			recipientUserId: userId,
			type: "case.updated",
			title: "Case updated",
			body: `${applicant?.name ?? "A client"}'s case ${application.appNumber} has been updated by ${actor.name}.`,
			entityType: "case",
			entityId: application.id,
			caseId: application.id,
			link: `/applications`,
		}));
		await notifyMany(events);
	} catch (err) {
		console.warn("[cases] Failed to broadcast case update:", err);
	}
}

/**
 * After a document is verified, check whether every requested document type
 * for this applicant has at least one VERIFIED document.  If so and the
 * application is still at `document_verification`, auto-advance to
 * `school_submission`.
 *
 * Fire-and-forget from the document review route — errors are logged but
 * never thrown to the caller.
 */
/**
 * Auto-end the active per-stage officer assignment once a stage concludes
 * (`stage_completed`). Fire-and-forget — a feed/notification failure must
 * never abort the stage transition it follows.
 */
function markStageCompleted(
	applicationId: string,
	stage: string,
	completedBy: string | null | undefined,
): void {
	void import("./communication.js")
		.then(({ onStageCompleted }) =>
			onStageCompleted({ applicationId, stage, completedBy: completedBy ?? null }),
		)
		.catch((err) => console.warn("[cases] Failed to complete stage assignment:", err));
}

/**
 * After a stage transition, check whether anyone owns the new stage (the
 * stage's specialist or the whole-case owner — see caseOwnership.ts). If so,
 * stay quiet. Otherwise alert managers/coordinators so the stage is not
 * worked silently — the complement to markStageCompleted, which releases the
 * outgoing officer.
 */
async function signalStageNeedsHandler(applicationId: string, stage: JourneyStage): Promise<void> {
	try {
		const { stageHasActiveHandler } = await import("./handoffs.js");
		if (await stageHasActiveHandler(applicationId, stage)) return;

		const [app] = await db
			.select({ appNumber: applications.appNumber })
			.from(applications)
			.where(eq(applications.id, applicationId))
			.limit(1);
		const recipients = await getManagerAndCoordinatorUserIds();
		await notifyMany(
			recipients.map((r) => ({
				recipientUserId: r.userId,
				type: "stage.needs_handler",
				title: "Stage has no assigned handler",
				body: `Stage "${JOURNEY_STAGE_LABELS[stage]}" on ${app?.appNumber ?? "an application"} has no handler.`,
				link: "/applications",
				entityType: "case",
				entityId: applicationId,
				caseId: applicationId,
			})),
		);
	} catch (err) {
		console.warn("[cases] Failed to signal stage handler need:", err);
	}
}

export async function checkAndAdvanceDocumentStage(ownerUserId: string): Promise<void> {
	try {
		const [applicant] = await db
			.select()
			.from(applicants)
			.where(eq(applicants.userId, ownerUserId))
			.limit(1);
		if (!applicant) return;

		const application = await latestApplicationForApplicant(applicant.id);
		if (!application || application.stage !== "document_verification") return;

		const requested = application.requestedDocuments ?? [];
		if (requested.length === 0) return;

		const docs = await db
			.select({ documentType: applicantDocuments.documentType, status: applicantDocuments.status })
			.from(applicantDocuments)
			.where(eq(applicantDocuments.ownerUserId, ownerUserId));

		const verifiedTypes = new Set(
			docs.filter((d) => d.status === "VERIFIED").map((d) => d.documentType),
		);
		const allVerified = requested.every((t) => verifiedTypes.has(t));
		if (!allVerified) return;

		// Verified documents alone do not open school submission: the same
		// gates as every other route into that stage apply — the applicant has
		// consented, paid the deposit, and a handler owns the case. When the
		// deposit lands or the handoff resolves, those paths advance the stage;
		// this one only completes it when everything else is already in place.
		if (application.proceedStatus !== "accepted" || !application.depositPaid) return;
		const { activeHandlerFor } = await import("./handoffs.js");
		if (!(await activeHandlerFor(application.id, "school_submission"))) return;

		const [updated] = await db
			.update(applications)
			.set({ stage: "school_submission", updatedAt: new Date() })
			.where(and(eq(applications.id, application.id), eq(applications.stage, "document_verification")))
			.returning();
		if (!updated) return;

		markStageCompleted(application.id, "document_verification", null);
		void signalStageNeedsHandler(application.id, "school_submission");

		await db.insert(caseComments).values({
			targetType: "application",
			targetId: application.id,
			kind: "status",
			text: "Stage → school_submission (all documents verified)",
			authorName: "System",
			authorOpsUserId: null,
		});

		const clientUserId = await applicantUserIdOfApplication(application.id);
		if (clientUserId) {
			notify({
				recipientUserId: clientUserId,
				type: "stage.changed",
				title: "Your documents are verified",
				body: "All requested documents have been verified. Your case has moved on to school submission.",
				link: "/portal/application",
			}).catch(() => {});
		}

		await broadcastCaseUpdate(updated, { opsUserId: "", name: "System", email: "" });
	} catch (err) {
		console.warn("[cases] Failed to auto-advance document stage:", err);
	}
}

export async function updateApplication(
	id: string,
	input: PatchApplicationInput,
	actor: Actor,
): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

	const set: Partial<typeof applications.$inferInsert> & { updatedAt: Date } = {
		updatedAt: new Date(),
	};
	if (input.visaCounselorNote !== undefined) set.visaCounselorNote = input.visaCounselorNote;
	if (input.paymentPlanId !== undefined) set.paymentPlanId = input.paymentPlanId;
	if (input.travelClearance !== undefined) set.travelClearance = input.travelClearance;
	if (input.preDepartureTasks !== undefined) set.preDepartureTasks = input.preDepartureTasks;
	if (input.notes !== undefined) set.notes = input.notes;

	if (Object.keys(set).length <= 1) return row;

	const [updated] = await db
		.update(applications)
		.set(set)
		.where(eq(applications.id, id))
		.returning();

	const changedFields = Object.keys(input).join(", ");
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: id,
		kind: "comment",
		text: `Updated: ${changedFields}`,
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});

	await broadcastCaseUpdate(updated, actor);
	return updated;
}

export async function acceptApplication(id: string, actor: Actor): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const [updated] = await db
		.update(applications)
		.set({ status: "ACCEPTED" satisfies CaseApplicationStatus, visaStage: "pending", updatedAt: new Date() })
		.where(eq(applications.id, id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: id,
		kind: "status",
		text: "Application accepted",
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});

	// Accepting the application concludes whatever stage it was being
	// processed in.
	markStageCompleted(id, row.stage, actor.opsUserId);

	const applicant = await getApplicant(row.applicantId);
	if (applicant?.email) {
		await syncLeadFromApplicationStatus(updated.id, applicant.email, updated.status, actor.name);
	}

	await broadcastCaseUpdate(updated, actor);
	return updated;
}

/**
 * Guard for stage transitions — checks the real prerequisites that the
 * portal assumes when it maps a `JourneyStage` to a portal chapter.
 * Returns a human-readable block reason, or `null` if the transition is
 * allowed. Mirrors the portal's `getStageStatus` signal checks.
 */
export function canAdvanceTo(
	stage: JourneyStage,
	signals: {
		hasPackage: boolean;
		hasSelection: boolean;
		hasAdmitted: boolean;
		hasAppInvoice: boolean;
		hasVisaInvoice: boolean;
		visaDone: boolean;
		travelClearance: string | null;
		hasPaymentPlan?: boolean;
		agencySettled?: boolean;
		travelInvoicePaid?: boolean;
		preDepartureDone?: boolean;
		/**
		 * Travel assistance request status from the direct-invoice flow.
	 * When present, this overrides the legacy `travelInvoicePaid` /
		 * `travelClearance` / `preDepartureDone` signals for travel gating.
		 *
		 * - `booked` or `declined` → travel is resolved, never blocks.
		 * - `on_hold` → applicant parked; does not block (opt-out unblocks).
		 * - `invoiced` → ticket invoice raised; blocks `payment_execution`
		 *   until paid (mirrors legacy `travelInvoicePaid`).
		 * - `quote_prepared`/`quote_approved` (legacy, removed flow)/`review`/`decision_pending` →
		 *   travel not yet resolved; blocks `completed` but not `payment_execution`.
		 */
		travelAssistanceStatus?:
			| "decision_pending"
			| "review"
			| "quote_prepared"
			| "quote_approved"
			| "invoiced"
			| "ticket_paid"
			| "booked"
			| "cleared"
			| "declined"
			| "on_hold";
	},
): string | null {
	const ta = signals.travelAssistanceStatus;
	const travelResolved = ta === "cleared" || ta === "booked" || ta === "declined" || ta === "on_hold";
	switch (stage) {
		case "document_verification":
			return null;
		case "school_submission":
			return signals.hasPackage
				? null
				: "Cannot advance to School Submission: no school application package selected.";
		case "offer_letter_review":
			return signals.hasSelection
				? null
				: "Cannot advance to Offer Letter Review: no schools selected.";
		case "visa_processing":
			return signals.hasAdmitted
				? null
				: "Cannot advance to Visa Processing: no accepted offer (admitted).";
		case "payment_execution": {
			// New flow: if a travel assistance request exists, the ticket invoice
			// must be paid (status `ticket_paid`, `booked`, or `cleared`) before
			// advancing. `declined`/`on_hold` never block.
			if (ta) {
				if (travelResolved) return null;
				if (ta === "invoiced" || ta === "ticket_paid") {
					return signals.travelInvoicePaid
						? null
						: "Cannot advance to Payment Execution: the ticket invoice is not paid.";
				}
				return "Cannot advance to Payment Execution: your flight is still being processed.";
			}
			return signals.travelInvoicePaid
				? null
				: "Cannot advance to Payment Execution: the travel invoice (ticketing fee) is not paid.";
		}
		case "travel_assistance":
			return signals.visaDone
				? null
				: "Cannot advance to Travel Assistance: visa stage is not complete.";
		case "completed": {
			// New flow: travel is resolved when the request is cleared, booked,
			// declined, or on hold. Otherwise the legacy clearance + checklist signals apply.
			if (ta) {
				if (travelResolved) return null;
				return "Cannot advance to Completed: your travel is not cleared yet.";
			}
			if (signals.travelClearance !== "cleared") {
				return "Cannot advance to Completed: travel clearance is not 'cleared'.";
			}
			return signals.preDepartureDone
				? null
				: "Cannot advance to Completed: pre-departure checklist is not finished.";
		}
		default:
			return null;
	}
}

/** List invoices for an applicant (by applicantId → userId). */
async function listInvoicesForApplicant(applicantId: string) {
	const [applicant] = await db
		.select({ userId: applicants.userId })
		.from(applicants)
		.where(eq(applicants.id, applicantId))
		.limit(1);
	if (!applicant?.userId) return [];
	return db
		.select()
		.from(invoices)
		.where(eq(invoices.clientUserId, applicant.userId));
}

/** Auto-raise a visa invoice when entering visa_processing with no visa invoice. */
async function raiseVisaInvoiceForApplication(
	app: ApplicationRow,
	applicant: ApplicantRow,
	actor: { opsUserId?: string | null; name: string; email: string },
): Promise<void> {
	const clientUserId = applicant.userId ?? undefined;
	const fees = await getFeeSchedule();
	await createInvoice({
		data: {
			applicantName: applicant.name,
			applicantEmail: applicant.email ?? undefined,
			clientUserId,
			applicationId: app.id,
			type: "visa",
			status: "proforma",
			lines: [
				{
					label: "Visa processing fee",
					amountCents: fees.visaBaseCents,
				},
			],
			note: `Auto-raised when stage advanced to visa_processing (application ${app.appNumber}).`,
		},
		actor,
	});
}

/**
 * Idempotently ensure a visa invoice exists for the applicant's latest
 * application. The portal's visa step calls this so a proforma estimate lands
 * in Ops for review/issue even if the journey stage has not formally reached
 * `visa_processing` yet. Never duplicates an existing visa invoice: it prefers
 * the invoice already linked to this applicant, then recovers an orphaned one
 * from before the login link existed (client_user_id null) by attaching it,
 * and only raises a fresh invoice when neither exists.
 */
export async function ensureVisaInvoiceForApplication(
	userId: string,
	actor: { opsUserId?: string | null; name: string; email: string },
): Promise<InvoiceRow> {
	const [applicant] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.userId, userId))
		.limit(1);
	if (!applicant) throw new HttpError(404, "APPLICANT_NOT_FOUND", "Applicant not found");
	const app = await latestApplicationForApplicant(applicant.id);
	if (!app) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

	// Reuse any live visa invoice linked to THIS application — never one from
	// a different application. Stale paid visa invoices created before this
	// application or with notes referencing a different application number must
	// never be reused.
	const candidates = await db
		.select()
		.from(invoices)
		.where(
			and(
				eq(invoices.type, "visa"),
				not(eq(invoices.status, "void")),
				eq(invoices.applicationId, app.id),
			),
		);
	const validCandidates = candidates.filter((c) => {
		if (c.status === "paid" && c.createdAt < app.createdAt) return false;
		if (c.note && app.appNumber && c.note.includes("application APP-") && !c.note.includes(app.appNumber)) return false;
		return true;
	});
	const statusRank = (status: string): number =>
		status === "paid" ? 0 : status === "partial" ? 1 : status === "issued" ? 2 : status === "proforma" ? 3 : 4;
	validCandidates.sort((a, b) => statusRank(a.status) - statusRank(b.status) || (a.createdAt < b.createdAt ? -1 : 1));
	const linked = validCandidates[0];
	if (linked) {
		if (!linked.clientUserId) {
			await db
				.update(invoices)
				.set({ clientUserId: userId })
				.where(eq(invoices.id, linked.id));
		}
		return linked;
	}

	// Fall back to an unlinked visa invoice for this user (raised by ops before
	// the application was created, applicationId is null). Link it to this app.
	// Never fall back to a paid invoice from another application.
	const unlinked = await db
		.select()
		.from(invoices)
		.where(
			and(
				eq(invoices.type, "visa"),
				not(eq(invoices.status, "void")),
				not(eq(invoices.status, "paid")),
				eq(invoices.clientUserId, userId),
				isNull(invoices.applicationId),
			),
		)
		.limit(1);
	if (unlinked[0]) {
		await db
			.update(invoices)
			.set({ clientUserId: userId, applicationId: app.id })
			.where(eq(invoices.id, unlinked[0].id));
		const [recovered] = await db
			.select()
			.from(invoices)
			.where(eq(invoices.id, unlinked[0].id))
			.limit(1);
		if (recovered) return recovered;
	}

	// Recover a visa invoice that predates the applicant's login link
	// (client_user_id is null, e.g. raised from Ops before the portal was
	// connected) rather than creating a duplicate. Link it to this user.
	// Never adopt a paid invoice or an invoice that belongs to another application!
	const orphans = await db
		.select()
		.from(invoices)
		.where(
			and(
				eq(invoices.type, "visa"),
				not(eq(invoices.status, "void")),
				not(eq(invoices.status, "paid")),
				isNull(invoices.clientUserId),
				isNull(invoices.applicationId),
			),
		)
		.limit(50);
	const orphan = orphans.find(
		(i) =>
			(Boolean(applicant.email) && i.applicantEmail === applicant.email) ||
			(i.applicantName ?? "").toLowerCase() === (applicant.name ?? "").toLowerCase(),
	);
	if (orphan) {
		await db
			.update(invoices)
			.set({ clientUserId: userId, applicationId: app.id })
			.where(eq(invoices.id, orphan.id));
		const [recovered] = await db
			.select()
			.from(invoices)
			.where(eq(invoices.id, orphan.id))
			.limit(1);
		return recovered ?? orphan;
	}

	await raiseVisaInvoiceForApplication(app, applicant, actor);
	const raised = await listInvoicesForApplicant(applicant.id);
	const created = raised.find((i) => i.type === "visa" && i.status !== "void" && i.applicationId === app.id);
	if (!created) {
		throw new HttpError(500, "VISA_INVOICE_RAISE_FAILED", "Could not raise the visa invoice");
	}
	return created;
}

export async function setApplicationStage(
	id: string,
	stage: JourneyStage,
	actor: Actor,
): Promise<ApplicationRow> {
	if (!JOURNEY_STAGES.includes(stage)) {
		throw new HttpError(400, "INVALID_STAGE", `Unknown journey stage: ${stage}`);
	}
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

	// ── Fetch signals for the precondition guard ────────────────────────
	const [applicant, schoolTracks, applicantInvoices, travelAssistanceStatus] = await Promise.all([
		getApplicant(row.applicantId),
		listSchoolsForApplication(row.id),
		row.applicantId ? listInvoicesForApplicant(row.applicantId) : [],
		getTravelAssistanceStatusForApplication(id),
	]);
	// Only this application's invoices count as signals.
	const clientInvoices = applicantInvoices.filter((i) => i.applicationId === row.id);
	const hasAppInvoice = clientInvoices.some((i) => i.type === "application");
	const hasSelection = schoolTracks.schools.length > 0 && (hasAppInvoice || schoolTracks.schools.some((s) => s.status !== "Preparing Application"));
	const hasAdmitted = schoolTracks.schools.some(
		(s) => s.outcome === "Admitted",
	);
	const hasVisaInvoice = clientInvoices.some((i) => i.type === "visa");

	// ── Guard: adjacency + completion + per-stage prerequisites ────────
	const adjacencyReason = canAdvanceToStage(row.stage, stage, {
		visaStage: row.visaStage,
		agencySettled: row.agencySettled,
		agencyStageIndex: row.agencyStageIndex,
		appFeePaid: row.appFeePaid,
		travelInvoicePaid: row.travelInvoicePaid,
		travelClearance: row.travelClearance,
		paymentPlanId: row.paymentPlanId,
		travelAssistanceStatus: travelAssistanceStatus ?? undefined,
	});
	if (adjacencyReason) {
		throw new HttpError(409, "STAGE_ADVANCE_BLOCKED", adjacencyReason);
	}

	// ── Guard: refuse if prerequisites aren't met (legacy signal checks) ─
	const blockReason = canAdvanceTo(stage, {
		hasPackage: Boolean(row.fundingTrack),
		hasSelection,
		hasAdmitted,
		hasAppInvoice,
		hasVisaInvoice,
		visaDone: row.visaStage === "complete",
		travelClearance: row.travelClearance,
		hasPaymentPlan: Boolean(row.paymentPlanId),
		agencySettled: row.agencySettled,
		travelInvoicePaid: row.travelInvoicePaid,
		preDepartureDone:
			Array.isArray(row.preDepartureTasks) &&
			row.preDepartureTasks.length > 0 &&
			row.preDepartureTasks.every((t) => t.done),
		travelAssistanceStatus: travelAssistanceStatus ?? undefined,
	});
	if (blockReason) {
		throw new HttpError(409, "STAGE_PREREQUISITES_NOT_MET", blockReason);
	}

	// ── Consent gate: the applicant must have said "continue" before the
	// case can advance into visa_processing or travel_assistance. This stops
	// Ops from pushing the applicant into a stage they haven't agreed to.
	if (stage === "visa_processing" || stage === "travel_assistance") {
		const { getStageConsent } = await import("./stageConsents.js");
		const consentStage = stage === "visa_processing" ? "visa" : "travel";
		const consent = await getStageConsent(id, consentStage);
		if (!consent || consent.decision !== "continue") {
			throw new HttpError(
				409,
				"STAGE_CONSENT_REQUIRED",
				`The applicant must consent to continue with the ${consentStage} stage before it can begin.`,
			);
		}
	}

	// ── Auto-raise visa invoice on entering visa_processing ──────────────
	if (stage === "visa_processing" && !hasVisaInvoice && applicant) {
		await raiseVisaInvoiceForApplication(row, applicant, actor);
	}

	const [updated] = await db
		.update(applications)
		.set({ stage, updatedAt: new Date() })
		.where(eq(applications.id, id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: id,
		kind: "status",
		text: `Stage → ${stage}`,
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});

	// In-app: let the client know their case has progressed.
	const clientUserId = await applicantUserIdOfApplication(id);
	if (clientUserId) {
		notify({
			recipientUserId: clientUserId,
			type: "stage.changed",
			title: "Your case has moved to the next stage",
			body: `Your application has advanced to: ${stage}.`,
			link: "/portal/tracking",
		}).catch(() => {});
	}

	// Email: queue a stage-advance notification so the client is informed even
	// if they aren't logged into the portal. Previously only an in-app notify
	// fired, so clients who never opened the portal never saw the update.
	if (applicant?.email && row.appNumber) {
		const stageLabel = JOURNEY_STAGE_LABELS?.[stage] ?? stage.replace(/_/g, " ");
		try {
			await queueEmails([
				mail.stageAdvancedForClient({
					clientName: applicant.name ?? "Client",
					clientEmail: applicant.email,
					stageLabel,
					appNumber: row.appNumber,
				}),
			]);
		} catch (err) {
			console.error(`[cases] failed to queue stage-advance email for ${row.appNumber}:`, err);
		}
	}

	// Leaving a stage the case was in concludes that stage's assignment.
	if (stage !== row.stage) {
		const handler = await activeHandlerFor(id, row.stage);
		const isGated = isAwaitingAssignmentBoundary(stage);

		// Create a handoff on EVERY stage transition so the manager always
		// sees "Assign" + "Keep previous handler" — not just at owner-class
		// boundaries. The previous stage's handler is the continuity candidate.
		await createOrGetHandoff({
			applicationId: id,
			stage,
			source: "stage_transition",
			fromOpsUserId: handler?.opsUserId ?? null,
		});

		// Finance/travel boundary stages hard-gate on entry — the case parks at
		// its predecessor until a manager resolves the handoff, so the stage is
		// never worked without a confirmed specialist. `signalStageNeedsHandler`
		// alerts management; resolving the handoff completes the transition.
		if (isGated) {
			markStageCompleted(id, row.stage, actor.opsUserId);
			void signalStageNeedsHandler(id, stage);
			await broadcastCaseUpdate(row, actor);
			return row;
		}

		markStageCompleted(id, row.stage, actor.opsUserId);
		// The new stage may be unowned — surface it instead of silent drift.
		void signalStageNeedsHandler(id, stage);
	}

	await broadcastCaseUpdate(updated, actor);
	return updated;
}

/**
 * Complete a boundary transition that hard-gated on entry: once its handoff is
 * resolved and the new stage staffed, move the parked application into it.
 * No-ops unless the case is genuinely parked behind this handoff (still at the
 * owner-class predecessor and not already at the target). Visa's gate is the
 * `awaiting_handler` sub-state, so its transition never auto-applies here.
 */
export async function applyHandoffResolvedTransition(input: {
	applicationId: string;
	stage: JourneyStage;
	actor: Actor;
}): Promise<ApplicationRow | null> {
	const row = await getApplication(input.applicationId);
	if (!row) return null;
	if (row.stage === input.stage) return row;
	const isDocToSchoolTransition = row.stage === "document_verification" && input.stage === "school_submission";
	if (!isOwnerClassBoundary(row.stage, input.stage) && !isDocToSchoolTransition) return null;

	// Defensive re-validation: the gate was satisfied when the handoff was
	// created, but an invoice void / plan change in between must not let the
	// transition through silently. If the target's prerequisites no longer
	// hold, the case stays parked (the specialist is still recorded).
	const stillGated = canAdvanceToStage(row.stage, input.stage, {
		visaStage: row.visaStage,
		agencySettled: row.agencySettled,
		agencyStageIndex: row.agencyStageIndex,
		appFeePaid: row.appFeePaid,
		travelInvoicePaid: row.travelInvoicePaid,
		travelClearance: row.travelClearance,
		paymentPlanId: row.paymentPlanId,
		preDepartureTasks: (row.preDepartureTasks ?? []) as { done: boolean }[],
	});
	if (stillGated) return row;

	const [updated] = await db
		.update(applications)
		.set({ stage: input.stage, updatedAt: new Date() })
		.where(and(eq(applications.id, input.applicationId), eq(applications.stage, row.stage)))
		.returning();
	if (!updated) return null;

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: input.applicationId,
		kind: "status",
		text: `Stage → ${input.stage} (specialist confirmed)`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	const clientUserId = await applicantUserIdOfApplication(input.applicationId);
	if (clientUserId) {
		notify({
			recipientUserId: clientUserId,
			type: "stage.changed",
			title: "Your case has moved to the next stage",
			body: `Your application has advanced to: ${JOURNEY_STAGE_LABELS[input.stage]}.`,
			link: "/portal/tracking",
		}).catch(() => {});
	}

	await broadcastCaseUpdate(updated, input.actor);
	return updated;
}

export async function toggleApplicationChecklist(
	id: string,
	itemId: string,
	checked: boolean,
): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const checklist = (row.checklist ?? []).map((item) =>
		item.id === itemId ? { ...item, checked } : item,
	);
	const [updated] = await db
		.update(applications)
		.set({ checklist, updatedAt: new Date() })
		.where(eq(applications.id, id))
		.returning();
	return updated;
}

export async function setApplicationVisaStage(
	id: string,
	stage: ApplicationRow["visaStage"],
	note: string | undefined,
	actor: Actor,
): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

	// The portal must not show visa tracking until the visa invoice is paid.
	// Only allow leaving "locked" (starting the visa process) once a paid visa
	// invoice exists for this application. Payment itself unlocks the stage, so
	// a manual advance here is only meaningful for staff nudging progress.
	if (stage !== "locked" && row.visaStage === "locked") {
		const clientInvoices = row.applicantId ? await listInvoicesForApplicant(row.applicantId) : [];
		const hasPaidVisaInvoice = clientInvoices.some(
			(i) => i.type === "visa" && i.status === "paid",
		);
		if (!hasPaidVisaInvoice) {
			throw new HttpError(
				409,
				"VISA_INVOICE_UNPAID",
				"Start the visa process by paying the visa invoice first. Visa tracking stays locked until the invoice is settled.",
			);
		}
	}

	// `awaiting_handler` is a hard gate: only a manager resolving the stage
	// handoff moves the case to `pending` (handoffs service). Staff nudging
	// progress must not bypass the assignment decision.
	if (row.visaStage === "awaiting_handler" && stage !== "locked" && stage !== "awaiting_handler") {
		throw new HttpError(
			409,
			"VISA_ASSIGNMENT_PENDING",
			"A visa specialist is being assigned. Resolve the assignment from the Workspace before visa tracking opens.",
		);
	}

	const [updated] = await db
		.update(applications)
		.set({
			visaStage: stage,
			visaCounselorNote: note ?? row.visaCounselorNote,
			updatedAt: new Date(),
		})
		.where(eq(applications.id, id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: id,
		kind: "status",
		text: `Visa stage → ${stage}`,
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});

	// In-app: keep the client informed of visa processing progress.
	const clientUserId = await applicantUserIdOfApplication(id);
	if (clientUserId) {
		notify({
			recipientUserId: clientUserId,
			type: "visa.stage_changed",
			title: "Visa processing update",
			body: `Your visa processing stage is now: ${stage}.`,
			link: "/portal/tracking",
		}).catch(() => {});
	}

	if (stage === "complete") markStageCompleted(id, "visa_processing", actor.opsUserId);

	return updated;
}

export async function setApplicationTravelClearance(
	id: string,
	cleared: boolean,
	actor: Actor,
): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const [updated] = await db
		.update(applications)
		.set({
			travelClearance: cleared ? "cleared" : "pending",
			updatedAt: new Date(),
		})
		.where(eq(applications.id, id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: id,
		kind: "status",
		text: cleared ? "Travel cleared" : "Travel clearance withdrawn",
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});

	if (cleared) markStageCompleted(id, "travel_assistance", actor.opsUserId);

	return updated;
}

export async function patchApplicant(
	id: string,
	patch: {
		name?: string;
		phone?: string;
		branch?: string;
		targetCountry?: string;
		profile?: ApplicantProfile;
	},
): Promise<ApplicantRow> {
	const row = await getApplicant(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "Applicant not found");
	const [updated] = await db
		.update(applicants)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.phone !== undefined ? { phone: patch.phone } : {}),
			...(patch.branch !== undefined ? { branch: patch.branch } : {}),
			...(patch.targetCountry !== undefined ? { targetCountry: patch.targetCountry } : {}),
			...(patch.profile !== undefined
				? { profile: { ...(row.profile as ApplicantProfile), ...patch.profile } }
				: {}),
			updatedAt: new Date(),
		})
		.where(eq(applicants.id, id))
		.returning();
	return updated;
}

export async function applicantUserIdOfConsultation(id: string): Promise<string | null> {
	const [row] = await db
		.select({ userId: applicants.userId })
		.from(consultations)
		.innerJoin(applicants, eq(applicants.id, consultations.applicantId))
		.where(eq(consultations.id, id))
		.limit(1);
	return row?.userId ?? null;
}

export async function applicantUserIdOfApplication(id: string): Promise<string | null> {
	const [row] = await db
		.select({ userId: applicants.userId })
		.from(applications)
		.innerJoin(applicants, eq(applicants.id, applications.applicantId))
		.where(eq(applications.id, id))
		.limit(1);
	return row?.userId ?? null;
}

/* ── Applicant self-service commands ──────────────────────────────────────── */
/**
 * These run as the applicant (resolved from the session), not as staff. The
 * route layer enforces that the caller owns the row; the service trusts the id
 * it is given. Each appends a case comment so the ops audit trail shows the
 * applicant's own actions, not just staff's.
 */

import { AGENCY_STAGES, serviceFeeForPackage } from "century-nit-core/content";
import { nextInvoiceNumber } from "./invoice.js";

export async function setApplicationPackage(input: {
	id: string;
	packageCode: string;
	degreeLevel: string;
	targetSchoolCount?: number;
}): Promise<{ application: ApplicationRow; proformaInvoice: typeof invoices.$inferSelect | null }> {
	return db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;

		const [app] = await tx
			.select()
			.from(applications)
			.where(eq(applications.id, input.id))
			.limit(1);
		if (!app) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

		const [applicant] = await tx
			.select({ userId: applicants.userId, name: applicants.name, email: applicants.email })
			.from(applicants)
			.where(eq(applicants.id, app.applicantId))
			.limit(1);
		if (!applicant) throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "Applicant not found");

		const consultation = app.consultationId
			? await tx
					.select({ assessmentResult: consultations.assessmentResult, status: consultations.status })
					.from(consultations)
					.where(eq(consultations.id, app.consultationId))
					.limit(1)
					.then((rows) => rows[0])
			: null;

		const outcome = (consultation?.assessmentResult as { outcome?: string } | null)?.outcome?.toLowerCase() ?? "";
		const eligible = outcome === "eligible" || outcome === "conditionally eligible";
		if (!eligible || consultation?.status !== "COMPLETED") {
			throw new HttpError(403, "CONSULTATION_NOT_ELIGIBLE", "Package selection requires a completed, eligible consultation");
		}

		// Consent gate: the applicant must have explicitly accepted to proceed
		// before a package can be selected. Consent is a separate step.
		if (app.proceedStatus !== "accepted") {
			throw new HttpError(409, "CONSENT_REQUIRED", "The applicant must consent to proceed before selecting a package.");
		}

		const [pkg] = await tx
			.select()
			.from(servicePackages)
			.where(eq(servicePackages.code, input.packageCode as any))
			.limit(1);
		if (!pkg) throw new HttpError(404, "PACKAGE_NOT_FOUND", "Package not found");
		if (!pkg.active) throw new HttpError(400, "PACKAGE_INACTIVE", "Package is no longer available");

		const targetSchools = input.targetSchoolCount ?? app.targetSchoolCount ?? 3;

		const [updated] = await tx
			.update(applications)
			.set({
				packageId: pkg.id,
				packageSelectedAt: new Date(),
				fundingTrack: input.packageCode,
				degreeLevel: input.degreeLevel,
				targetSchoolCount: targetSchools,
				updatedAt: new Date(),
			})
			.where(eq(applications.id, app.id))
			.returning();

		// Void any prior unpaid agency invoices for this applicant.
		const prior = await tx
			.select({ id: invoices.id })
			.from(invoices)
			.where(
				and(
					eq(invoices.clientUserId, applicant.userId ?? ""),
					eq(invoices.type, "agency"),
					sql`${invoices.status} IN ('proforma', 'issued')`,
				),
			);
		for (const p of prior) {
			await tx
				.update(invoices)
				.set({ status: "void", voidedAt: new Date(), voidReason: "Package re-selected" })
				.where(eq(invoices.id, p.id));
			await tx.insert(invoiceEvents).values({
				invoiceId: p.id,
				action: "voided",
				actor: "system",
				detail: "Replaced by new package selection",
			});
		}

		// Raise the agency proforma pre-split into deposit / pre-departure / post-arrival milestones.
		// Package price matches the price configured in Ops Center (pkg.priceCents).
		const price = (pkg.priceCents && pkg.priceCents > 0)
			? pkg.priceCents
			: Math.round(serviceFeeForPackage(input.degreeLevel, input.packageCode, targetSchools));
		const milestoneLines = AGENCY_STAGES.map((stage, i) => ({
			position: i,
			label: stage.label,
			detail: stage.detail,
			amountCents: i === AGENCY_STAGES.length - 1
				? price - AGENCY_STAGES.slice(0, -1).reduce((n, s) => n + Math.round(price * s.portion), 0)
				: Math.round(price * stage.portion),
		})).filter((l) => l.amountCents > 0);

		const subtotalCents = milestoneLines.reduce((n, l) => n + l.amountCents, 0);
		let proformaInvoice: typeof invoices.$inferSelect | null = null;

		if (subtotalCents > 0) {
			const invoiceNumber = await nextInvoiceNumber(txDb);
			const [created] = await tx
				.insert(invoices)
				.values({
					invoiceNumber,
					applicationId: app.id,
					clientUserId: applicant.userId ?? null,
					applicantName: applicant.name ?? "Applicant",
					applicantEmail: applicant.email ?? null,
					type: "agency",
					subtotalCents,
					status: "issued",
					issuedBy: null,
					issuedByName: "Century NIT",
					note: `Service package: ${pkg.name}`,
				})
				.returning();

			await tx.insert(invoiceLines).values(
				milestoneLines.map((l) => ({
					invoiceId: created.id,
					position: l.position,
					label: l.label,
					detail: l.detail,
					amountCents: l.amountCents,
				})),
			);

			await tx.insert(invoiceEvents).values({
				invoiceId: created.id,
				action: "issued",
				actor: "system",
				detail: `Issued from package ${pkg.code}`,
			});

			proformaInvoice = created;
		}

		await tx.insert(caseComments).values({
			targetType: "application",
			targetId: app.id,
			kind: "status",
			text: `Package Agreement: ${pkg.name} · ${input.degreeLevel}`,
			authorName: "Applicant",
		});

		return { application: updated, proformaInvoice };
	});
}

export async function setApplicationPaymentPlan(input: {
	id: string;
	paymentPlanId: string;
}): Promise<ApplicationRow> {
	const row = await getApplication(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const [updated] = await db
		.update(applications)
		.set({
			paymentPlanId: input.paymentPlanId,
			updatedAt: new Date(),
		})
		.where(eq(applications.id, row.id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "status",
		text: `Payment plan chosen: ${input.paymentPlanId}`,
		authorName: "Applicant",
	});
	return updated;
}

/**
 * Applicant self-service: advance from Travel Assistance to Payment Execution
 * (the plan chapter) once the ticketing fee is paid.
 *
 * This path is deliberately NOT parked on a handoff, unlike the ops stage
 * endpoint (`setApplicationStage`). Travel Assistance is self-serve for the
 * ticketing fee, so there is nothing for a specialist to assign before the
 * case moves. The shared `canAdvanceToStage` gate re-validates the ticketing
 * invoice, then the case advances immediately and the finance handoff is
 * queued (idempotent) so the handled plan work gets staffed — the pending
 * assignment never blocks the applicant's entry. The travel specialist's
 * owned work (clearance + pre-departure checklist) stays in progress and is
 * concluded when the journey completes.
 */
export async function advanceToPaymentPlanFromTravel(input: {
	id: string;
	applicantUserId: string;
}): Promise<ApplicationRow> {
	const row = await getApplication(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

	const applicant = await getApplicant(row.applicantId);
	if (!applicant || applicant.userId !== input.applicantUserId) {
		throw new HttpError(403, "FORBIDDEN", "Not your application");
	}

	if (row.stage === "payment_execution" || row.stage === "completed") {
		return row;
	}
	if (row.stage !== "travel_assistance") {
		throw new HttpError(
			409,
			"STAGE_ADVANCE_BLOCKED",
			`Payment Execution opens from Travel Assistance. Current stage: ${JOURNEY_STAGE_LABELS[row.stage]}.`,
		);
	}

	const travelAssistanceStatus = await getTravelAssistanceStatusForApplication(input.id);
	const gateReason = canAdvanceToStage(row.stage, "payment_execution", {
		visaStage: row.visaStage,
		agencySettled: row.agencySettled,
		agencyStageIndex: row.agencyStageIndex,
		appFeePaid: row.appFeePaid,
		travelInvoicePaid: row.travelInvoicePaid,
		travelClearance: row.travelClearance,
		paymentPlanId: row.paymentPlanId,
		preDepartureTasks: (row.preDepartureTasks ?? []) as { done: boolean }[],
		travelAssistanceStatus: travelAssistanceStatus ?? undefined,
	});
	if (gateReason) {
		throw new HttpError(409, "STAGE_PREREQUISITES_NOT_MET", gateReason);
	}

	const [updated] = await db
		.update(applications)
		.set({ stage: "payment_execution", updatedAt: new Date() })
		.where(and(eq(applications.id, row.id), eq(applications.stage, "travel_assistance")))
		.returning();
	if (!updated) return row;

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "status",
		text: "Stage → payment_execution (applicant advanced after paying the ticketing fee)",
		authorName: applicant.name ?? "Applicant",
		authorOpsUserId: null,
	});

	// The applicant drove entry; queue the finance owner for the handled plan
	// work. The handoff must NOT park the transition.
	const continuity = row.assignedStaffId ? await loadStaff(row.assignedStaffId) : null;
	await createOrGetHandoff({
		applicationId: row.id,
		stage: "payment_execution",
		source: "applicant_advance",
		fromOpsUserId: continuity?.id ?? null,
	});
	void signalStageNeedsHandler(row.id, "payment_execution");

	notify({
		recipientUserId: input.applicantUserId,
		type: "stage.changed",
		title: "Payment plan is open",
		body: "Your ticketing fee is settled. Choose your payment plan to continue.",
		link: "/portal/payment-execution",
	}).catch(() => {});

	const actor: Actor = {
		opsUserId: "",
		name: applicant.name ?? "Applicant",
		email: applicant.email ?? "",
	};
	await broadcastCaseUpdate(updated, actor);

	return updated;
}

/**
 * Applicant self-service: complete the journey from Payment Execution.
 *
 * The gate is per-plan — a full plan needs the agency service fee settled in
 * full, an installment plan only its first installment (the deposit). Either
 * way the ticketing fee must be paid, travel clearance granted, and the
 * pre-departure checklist finished. `canAdvanceToStage` enforces all of it
 * server-side. Admission to `completed` is terminal: the owned assignments
 * for the finance and travel work are concluded.
 */
export async function completeFromPaymentPlan(input: {
	id: string;
	applicantUserId: string;
}): Promise<ApplicationRow> {
	const row = await getApplication(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

	const applicant = await getApplicant(row.applicantId);
	if (!applicant || applicant.userId !== input.applicantUserId) {
		throw new HttpError(403, "FORBIDDEN", "Not your application");
	}

	if (row.stage === "completed") {
		return row;
	}
	if (row.stage !== "payment_execution") {
		throw new HttpError(
			409,
			"STAGE_ADVANCE_BLOCKED",
			`Completion opens from Payment Execution. Current stage: ${JOURNEY_STAGE_LABELS[row.stage]}.`,
		);
	}

	const travelAssistanceStatus = await getTravelAssistanceStatusForApplication(input.id);
	const gateReason = canAdvanceToStage(row.stage, "completed", {
		visaStage: row.visaStage,
		agencySettled: row.agencySettled,
		agencyStageIndex: row.agencyStageIndex,
		appFeePaid: row.appFeePaid,
		travelInvoicePaid: row.travelInvoicePaid,
		travelClearance: row.travelClearance,
		paymentPlanId: row.paymentPlanId,
		preDepartureTasks: (row.preDepartureTasks ?? []) as { done: boolean }[],
		travelAssistanceStatus: travelAssistanceStatus ?? undefined,
	});
	if (gateReason) {
		throw new HttpError(409, "STAGE_PREREQUISITES_NOT_MET", gateReason);
	}

	const [updated] = await db
		.update(applications)
		.set({ stage: "completed", updatedAt: new Date() })
		.where(and(eq(applications.id, row.id), eq(applications.stage, "payment_execution")))
		.returning();
	if (!updated) return row;

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "status",
		text: "Stage → completed (applicant completed the journey)",
		authorName: applicant.name ?? "Applicant",
		authorOpsUserId: null,
	});

	// Terminal: conclude the finance and travel owners.
	markStageCompleted(row.id, "payment_execution", null);
	markStageCompleted(row.id, "travel_assistance", null);

	notify({
		recipientUserId: input.applicantUserId,
		type: "stage.changed",
		title: "Your journey is complete",
		body: "All stages are settled. Your consultant will be in touch for your post-arrival plan.",
		link: "/portal/home",
	}).catch(() => {});

	const actor: Actor = {
		opsUserId: "",
		name: applicant.name ?? "Applicant",
		email: applicant.email ?? "",
	};
	await broadcastCaseUpdate(updated, actor);

	return updated;
}

/** Applicant login ids a consultant may reach via assigned cases, not only bookings. */
export async function assignedApplicantUserIds(opsUserId: string): Promise<string[]> {
	const fromConsult = await db
		.select({ userId: applicants.userId })
		.from(consultations)
		.innerJoin(applicants, eq(applicants.id, consultations.applicantId))
		.where(
			and(
				eq(consultations.assignedOfficerId, opsUserId),
				not(inArray(consultations.status, ["COMPLETED", "CANCELLED"])),
			),
		);
	const fromApps = await db
		.select({ userId: applicants.userId })
		.from(applications)
		.innerJoin(applicants, eq(applicants.id, applications.applicantId))
		.where(eq(applications.assignedStaffId, opsUserId));
	return Array.from(
		new Set(
			[...fromConsult, ...fromApps]
				.map((r) => r.userId)
				.filter((id): id is string => Boolean(id)),
		),
	);
}

export async function latestConsultationForApplicant(
	applicantId: string,
): Promise<ConsultationRow | null> {
	const [row] = await db
		.select()
		.from(consultations)
		.where(eq(consultations.applicantId, applicantId))
		.orderBy(desc(consultations.createdAt))
		.limit(1);
	return row ?? null;
}

export async function latestApplicationForApplicant(
	applicantId: string,
): Promise<ApplicationRow | null> {
	const [row] = await db
		.select()
		.from(applications)
		.where(eq(applications.applicantId, applicantId))
		.orderBy(desc(applications.createdAt))
		.limit(1);
	return row ?? null;
}

/* ── Coordinator delegation ─────────────────────────────────────────────── */

const STAFF_ACTIVE = eq(opsUsers.active, true);

/**
 * Delegate a consultation to a coordinator.
 *
 * Only manager / owner / super_admin may delegate.  The coordinator must
 * exist and be active.  On success the case is also auto-assigned to the
 * coordinator as its `assignedOfficerId` so it shows up in their queue.
 */
export async function delegateCoordinator(input: {
	consultationId: string;
	coordinatorOpsUserId: string;
	note?: string;
	actor: Actor;
}): Promise<ConsultationRow> {
	const row = await getConsultation(input.consultationId);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}

	const coordinator = await loadStaff(input.coordinatorOpsUserId);
	if (!coordinator?.active) throw new HttpError(404, "NOT_FOUND", "Coordinator not found or inactive");

	const now = new Date();
	const [updated] = await db
		.update(consultations)
		.set({
			coordinatorId: input.coordinatorOpsUserId,
			coordinatorAssignedAt: now,
			coordinatorAssignedBy: input.actor.opsUserId,
			delegationNote: input.note ?? row.delegationNote,
			updatedAt: now,
		})
		.where(eq(consultations.id, row.id))
		.returning();

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "assignment",
		text: `Delegated to coordinator ${coordinator.name}${input.note ? `: ${input.note}` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	await recordActivity({
		consultationId: row.id,
		type: "coordinator_delegated",
		actorOpsUserId: input.actor.opsUserId,
		actorName: input.actor.name,
		payload: {
			coordinatorName: coordinator.name,
			coordinatorOpsUserId: coordinator.id,
			note: input.note ?? null,
		},
	});

	// Auto-create a chat conversation between the delegating manager and the coordinator,
	// with the consultation linked so it shows up in case context.
	try {
		const { createConversation } = await import("./chat.js");
		const manager = await loadStaff(input.actor.opsUserId);
		if (manager) {
			await createConversation(
				{ id: manager.id, name: manager.name, email: manager.email },
				{
					title: `Case ${row.reference} — ${coordinator.name}`,
					participantOpsUserId: input.coordinatorOpsUserId,
					linkedEntityType: "consultation",
					linkedEntityId: row.id,
					initialMessage: input.note
						? `I've delegated consultation ${row.reference} to you. ${input.note}`
						: `I've delegated consultation ${row.reference} to you. Please review and take ownership.`,
				},
			);
		}
	} catch {
		// Chat creation failure must not block the delegation.
	}

	return updated;
}

/**
 * Reassign a consultation to a different coordinator.
 *
 * Records why in the activity timeline.  Does NOT change status — the
 * consultation stays in whatever state it was in.
 */
export async function reassignCoordinator(input: {
	consultationId: string;
	newCoordinatorOpsUserId: string;
	reason?: string;
	actor: Actor;
}): Promise<ConsultationRow> {
	const row = await getConsultation(input.consultationId);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}

	const newCoordinator = await loadStaff(input.newCoordinatorOpsUserId);
	if (!newCoordinator?.active) throw new HttpError(404, "NOT_FOUND", "Coordinator not found or inactive");

	const oldCoordinator = row.coordinatorId ? await loadStaff(row.coordinatorId) : null;
	const now = new Date();
	const [updated] = await db
		.update(consultations)
		.set({
			coordinatorId: input.newCoordinatorOpsUserId,
			coordinatorAssignedAt: now,
			coordinatorAssignedBy: input.actor.opsUserId,
			updatedAt: now,
		})
		.where(eq(consultations.id, row.id))
		.returning();

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "assignment",
		text: `Coordinator reassigned from ${oldCoordinator?.name ?? "none"} to ${newCoordinator.name}${input.reason ? `: ${input.reason}` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	await recordActivity({
		consultationId: row.id,
		type: "coordinator_reassigned",
		actorOpsUserId: input.actor.opsUserId,
		actorName: input.actor.name,
		payload: {
			fromCoordinatorName: oldCoordinator?.name ?? null,
			toCoordinatorName: newCoordinator.name,
			reason: input.reason ?? null,
		},
	});

	return updated;
}

/* ── Workload ──────────────────────────────────────────────────────────── */

const DEFAULT_MAX_CAPACITY = 10;

/** Active statuses that count towards a coordinator's workload. */
const ACTIVE_CONSULTATION_STATUSES = ["UNDER_REVIEW", "ASSIGNED", "CONFIRMED", "IN_ASSESSMENT"] as const;

/**
 * Get per-staff workload across the platform.
 *
 * Returns one entry per active staff member with their active / overdue counts
 * and a capacity percentage. Used for the heatmap and the delegation picker.
 * A "coordinator" is simply the staff member currently responsible for a
 * consultation, not a separate job title, so any active staff can be delegated
 * a case.
 */
export async function getStaffWorkload(branch?: string): Promise<{
	coordinators: Array<{
		opsUserId: string;
		name: string;
		email: string;
		role: string;
		activeCases: number;
		overdueCases: number;
		maxCapacity: number;
		capacityPercent: number;
	}>;
	maxCapacityPerCoordinator: number;
}> {
	const staff = await db
		.select()
		.from(opsUsers)
		.where(and(STAFF_ACTIVE, branch ? eq(opsUsers.branch, branch) : undefined));

	const staffIds = staff.map((c) => c.id);
	if (staffIds.length === 0) {
		return { coordinators: [], maxCapacityPerCoordinator: DEFAULT_MAX_CAPACITY };
	}

	const activeCases = await db
		.select({
			coordinatorId: consultations.coordinatorId,
			status: consultations.status,
		})
		.from(consultations)
		.where(
			sql`${consultations.coordinatorId} IN ${sql`(${sql.join(staffIds.map((id) => sql`${id}`), sql`, `)})`}
				AND ${consultations.status} IN ${sql`(${sql.join(ACTIVE_CONSULTATION_STATUSES.map((s) => sql`${s}`), sql`, `)})`}`,
		);

	const overdueThreshold = new Date(Date.now() - 4 * 60 * 60 * 1000);
	const overdueCases = await db
		.select({ coordinatorId: consultations.coordinatorId })
		.from(consultations)
		.where(
			sql`${consultations.coordinatorId} IN ${sql`(${sql.join(staffIds.map((id) => sql`${id}`), sql`, `)})`}
				AND ${consultations.status} IN ${sql`(${sql.join(ACTIVE_CONSULTATION_STATUSES.map((s) => sql`${s}`), sql`, `)})`}
				AND ${consultations.coordinatorAssignedAt} < ${overdueThreshold}`,
		);

	const countMap = new Map<string, number>();
	for (const row of activeCases) {
		if (!row.coordinatorId) continue;
		countMap.set(row.coordinatorId, (countMap.get(row.coordinatorId) ?? 0) + 1);
	}

	const overdueMap = new Map<string, number>();
	for (const row of overdueCases) {
		if (!row.coordinatorId) continue;
		overdueMap.set(row.coordinatorId, (overdueMap.get(row.coordinatorId) ?? 0) + 1);
	}

	const result = staff.map((c) => {
		const active = countMap.get(c.id) ?? 0;
		const overdue = overdueMap.get(c.id) ?? 0;
		return {
			opsUserId: c.id,
			name: c.name,
			email: c.email,
			role: c.role,
			activeCases: active,
			overdueCases: overdue,
			maxCapacity: DEFAULT_MAX_CAPACITY,
			capacityPercent: Math.round((active / DEFAULT_MAX_CAPACITY) * 100),
		};
	});

	result.sort((a, b) => a.capacityPercent - b.capacityPercent);

	return {
		coordinators: result,
		maxCapacityPerCoordinator: DEFAULT_MAX_CAPACITY,
	};
}

/* ── Activity timeline ─────────────────────────────────────────────────── */

async function recordActivity(input: {
	consultationId: string;
	type: string;
	actorOpsUserId?: string | null;
	actorName?: string | null;
	payload?: Record<string, unknown> | null;
}): Promise<void> {
	await db.insert(consultationActivities).values({
		consultationId: input.consultationId,
		type: input.type,
		actorOpsUserId: input.actorOpsUserId ?? null,
		actorName: input.actorName ?? null,
		payload: input.payload ?? null,
	});
}

/**
 * Return the activity timeline for a consultation, newest first.
 */
export async function getConsultationActivity(
	consultationId: string,
	limit = 50,
): Promise<Array<{
	id: string;
	consultationId: string;
	type: string;
	actorName: string | null;
	payload: unknown;
	createdAt: Date;
}>> {
	return db
		.select()
		.from(consultationActivities)
		.where(eq(consultationActivities.consultationId, consultationId))
		.orderBy(desc(consultationActivities.createdAt))
		.limit(limit);
}

/* ── Auto-escalation ───────────────────────────────────────────────────── */

/**
 * Reassign stale consultations whose coordinator hasn't responded within
 * `hoursBeforeEscalation` hours.  Picks the coordinator with the lowest
 * capacity.  Intended to be called from a scheduled job (BullMQ).
 *
 * Returns the IDs of consultations that were escalated.
 */
export async function checkAndEscalate(options?: {
	hoursBeforeEscalation?: number;
}): Promise<string[]> {
	const hours = options?.hoursBeforeEscalation ?? 4;
	const staleThreshold = new Date(Date.now() - hours * 60 * 60 * 1000);

	const stale = await db
		.select()
		.from(consultations)
		.where(
			sql`${consultations.coordinatorId} IS NOT NULL 
				AND ${consultations.status} IN ${sql`(${sql.join(ACTIVE_CONSULTATION_STATUSES.map((s) => sql`${s}`), sql`, `)})`} 
				AND ${consultations.coordinatorAssignedAt} < ${staleThreshold}`,
		);

	if (stale.length === 0) return [];

	const workload = await getStaffWorkload();
	const leastBusy = workload.coordinators.find((c) => c.capacityPercent < 100);
	if (!leastBusy) return [];

	const escalated: string[] = [];

	for (const row of stale) {
		if (row.coordinatorId === leastBusy.opsUserId) continue;

		await db
			.update(consultations)
			.set({
				coordinatorId: leastBusy.opsUserId,
				coordinatorAssignedAt: new Date(),
				coordinatorAssignedBy: null,
				updatedAt: new Date(),
			})
			.where(eq(consultations.id, row.id));

		await recordActivity({
			consultationId: row.id,
			type: "auto_escalated",
			payload: {
				fromCoordinatorId: row.coordinatorId,
				toCoordinatorId: leastBusy.opsUserId,
				reason: `Auto-escalated after ${hours}h without coordinator action`,
			},
		});

		await db.insert(caseComments).values({
			targetType: "consultation",
			targetId: row.id,
			kind: "status",
			text: `Auto-escalated to ${leastBusy.name} — no coordinator action for ${hours}h`,
			authorName: "System",
			authorOpsUserId: null,
		});

		escalated.push(row.id);
	}

	return escalated;
}

/* ── Daily digest ──────────────────────────────────────────────────────── */

/**
 * Build and send a daily coordination digest email.
 *
 * Lists all active consultations and their current state — useful for
 * manager/owner to review at the start of the day.
 */
export async function sendDailyDigest(): Promise<void> {
	const active = await db
		.select({
			id: consultations.id,
			reference: consultations.reference,
			status: consultations.status,
			coordinatorId: consultations.coordinatorId,
			assignedOfficerId: consultations.assignedOfficerId,
			createdAt: consultations.createdAt,
			applicantId: consultations.applicantId,
		})
		.from(consultations)
		.where(sql`${consultations.status} IN ${sql`(${sql.join(ACTIVE_CONSULTATION_STATUSES.map((s) => sql`${s}`), sql`, `)})`}`)
		.orderBy(consultations.createdAt);

	if (active.length === 0) return;

	const rows = await Promise.all(
		active.map(async (c) => {
			const coordinator = c.coordinatorId ? await loadStaff(c.coordinatorId) : null;
			const officer = c.assignedOfficerId ? await loadStaff(c.assignedOfficerId) : null;
			const applicant = await db
				.select({ name: applicants.name })
				.from(applicants)
				.where(eq(applicants.id, c.applicantId))
				.limit(1)
				.then((r) => r[0]);
			return {
				reference: c.reference,
				clientName: applicant?.name ?? "Unknown",
				status: c.status,
				coordinatorName: coordinator?.name ?? "Unassigned",
				officerName: officer?.name ?? "Unassigned",
				createdAt: c.createdAt,
			};
		}),
	);

	const rowsHtml = rows
		.map(
			(r) => `<tr>
				<td style="padding:8px;border-bottom:1px solid #eee">${r.reference}</td>
				<td style="padding:8px;border-bottom:1px solid #eee">${r.clientName}</td>
				<td style="padding:8px;border-bottom:1px solid #eee">${r.status}</td>
				<td style="padding:8px;border-bottom:1px solid #eee">${r.coordinatorName}</td>
				<td style="padding:8px;border-bottom:1px solid #eee">${r.officerName}</td>
			</tr>`,
		)
		.join("");

	const html = `
		<h2>Daily Consultation Digest</h2>
		<p><strong>${rows.length}</strong> active consultation(s) require attention.</p>
		<table style="border-collapse:collapse;width:100%">
			<tr style="background:#f5f5f5">
				<th style="padding:8px;text-align:left">Reference</th>
				<th style="padding:8px;text-align:left">Client</th>
				<th style="padding:8px;text-align:left">Status</th>
				<th style="padding:8px;text-align:left">Coordinator</th>
				<th style="padding:8px;text-align:left">Consultant</th>
			</tr>
			${rowsHtml}
		</table>
	`;

	try {
		const { opsUsers: allStaff } = await import("../db/schema.js");
		const managers = await db
			.select({ email: allStaff.email })
			.from(allStaff)
			.where(sql`${allStaff.role} IN ('super_admin', 'manager') AND ${allStaff.active} = true`);

		const recipients = managers.map((m) => m.email);
		if (recipients.length === 0) return;

		await queueEmails([
			{
				to: recipients.join(","),
				subject: `Daily Consultation Digest — ${rows.length} active`,
				text: `You have ${rows.length} active consultations. View them in the operations dashboard.`,
				html,
				idempotencyKey: `daily-digest-${new Date().toISOString().slice(0, 10)}`,
			},
		]);
	} catch {
		// Digest failure must not block the scheduler.
	}
}

/** Record a status change activity (used by status-change routes). */
export async function recordStatusChange(consultationId: string, fromStatus: string, toStatus: string, actor: Actor): Promise<void> {
	await recordActivity({
		consultationId,
		type: "status_changed",
		actorOpsUserId: actor.opsUserId,
		actorName: actor.name,
		payload: { fromStatus, toStatus },
	});
}

/** Record an assignment activity (used by assignConsultation). */
export async function recordAssignment(consultationId: string, officerName: string, actor: Actor): Promise<void> {
	await recordActivity({
		consultationId,
		type: "consultant_assigned",
		actorOpsUserId: actor.opsUserId,
		actorName: actor.name,
		payload: { officerName },
	});
}

/* ── In-app notifications ─────────────────────────────────────────────────── */

export async function createNotification(input: {
	userId: string;
	type: string;
	title: string;
	body: string;
	link?: string;
}): Promise<void> {
	await db.insert(notifications).values({
		userId: input.userId,
		type: input.type,
		title: input.title,
		body: input.body,
		link: input.link ?? null,
	});
}


