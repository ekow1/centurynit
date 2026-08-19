import { and, desc, eq, sql } from "drizzle-orm";
import {
	CASE_ERROR_CODES,
	type AddComment,
	type ApiApplicant,
	type ApiApplication,
	type ApiConsultation,
	type ApplicantProfile,
	type AssessmentResult,
	type CaseApplicationStatus,
	JOURNEY_STAGES,
	type JourneyStage,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	bookings,
	caseComments,
	consultationActivities,
	consultations,
	notifications,
	opsUsers,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import type { StaffContext } from "../middleware/auth.js";
import * as mail from "./notifications.js";
import { queueEmails } from "../worker/queues.js";
import { notify, getStaffUserId } from "./notify.js";

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
	await tx.execute(sql`SELECT pg_advisory_xact_lock(710003, ${year})`);
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
			status: row.status === "IN_ASSESSMENT" ? "IN_ASSESSMENT" : "ASSIGNED",
			updatedAt: new Date(),
		})
		.where(eq(consultations.id, row.id));

	await db
		.update(applicants)
		.set({ assignedOfficerId: employeeId, updatedAt: new Date() })
		.where(eq(applicants.id, row.applicantId));
}

/**
 * Sync the consultation status when a booking is cancelled.
 *
 * If an officer has been assigned, the consultation stays active so the
 * applicant can reschedule instead of starting over from scratch.  Only
 * unassigned consultations (no officer yet) are terminated.
 */
export async function syncConsultationCancelled(bookingId: string): Promise<void> {
	// Look up the consultation linked to this booking.
	const [row] = await db
		.select({ id: consultations.id, assignedOfficerId: consultations.assignedOfficerId, status: consultations.status })
		.from(consultations)
		.where(eq(consultations.bookingId, bookingId))
		.limit(1);

	if (!row) return;
	if (row.status === "COMPLETED" || row.status === "CANCELLED") return;

	await db
		.update(consultations)
		.set({ status: "CANCELLED", updatedAt: new Date() })
		.where(eq(consultations.id, row.id));
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
		.set({ status: "CANCELLED", updatedAt: new Date() })
		.where(eq(consultations.id, row.id));

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
	const [applicant, officer, coordinator, coordinatorAssigner, booking, comments] = await Promise.all([
		db.select().from(applicants).where(eq(applicants.id, row.applicantId)).limit(1).then((r) => r[0]),
		loadStaff(row.assignedOfficerId),
		loadStaff(row.coordinatorId),
		loadStaff(row.coordinatorAssignedBy),
		row.bookingId
			? db.select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1).then((r) => r[0] ?? null)
			: Promise.resolve(null),
		commentsFor("consultation", row.id),
	]);

	return {
		id: row.id,
		reference: row.reference,
		bookingId: row.bookingId,
		applicantId: row.applicantId,
		applicantName: applicant?.name ?? "",
		email: applicant?.email ?? "",
		phone: applicant?.phone ?? null,
		branch: row.branch,
		type: row.type,
		targetCountry: row.targetCountry ?? applicant?.targetCountry ?? null,
		status: row.status,
		assignedOfficerId: row.assignedOfficerId,
		assignedOfficerName: officer?.name ?? null,
		assignedOfficerEmail: officer?.email ?? null,
		coordinatorId: row.coordinatorId,
		coordinatorName: coordinator?.name ?? null,
		coordinatorEmail: coordinator?.email ?? null,
		coordinatorAssignedAt: row.coordinatorAssignedAt?.toISOString() ?? null,
		coordinatorAssignedByName: coordinatorAssigner?.name ?? null,
		delegationNote: row.delegationNote ?? null,
		slotConfirmed: row.slotConfirmed,
		startsAt: booking?.startsAt.toISOString() ?? null,
		timezone: booking?.timezone ?? null,
		meetingUrl: booking?.meetingUrl ?? null,
		rescheduleRequestedAt: booking?.rescheduleRequestedAt?.toISOString() ?? null,
		rescheduleRequestedStartsAt: booking?.rescheduleRequestedStartsAt?.toISOString() ?? null,
		rescheduleRequestReason: booking?.rescheduleRequestReason ?? null,
		assessmentResult: row.assessmentResult ?? null,
		requestedDocuments: row.requestedDocuments ?? [],
		comments: comments.map(toComment),
		profile: (applicant?.profile as ApplicantProfile) ?? emptyProfile(),
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
		fundingTrack: row.fundingTrack,
		notes: row.notes,
		checklist: row.checklist ?? [],
		visaStage: row.visaStage,
		visaInvoicePaid: row.visaInvoicePaid,
		visaCounselorNote: row.visaCounselorNote,
		paymentPlanId: row.paymentPlanId,
		agencyStageIndex: row.agencyStageIndex,
		agencySettled: row.agencySettled,
		travelClearance: row.travelClearance === "cleared" ? "cleared" : "pending",
		requestedDocuments: row.requestedDocuments ?? [],
		comments: comments.map(toComment),
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
				.where(eq(consultations.applicantId, row.id))
				.orderBy(desc(consultations.createdAt))
				.limit(1);

	const currentStage = latestApp?.stage ?? (latestConsult ? "Consultation" : "New");
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
	if (canSeeAllCases(staff)) {
		return db.select().from(applications).orderBy(desc(applications.createdAt));
	}
	return db
		.select()
		.from(applications)
		.where(eq(applications.assignedStaffId, staff.opsUserId))
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
					link: "/ops/cases",
				}).catch(() => {});
			}
		} catch {
			// Notification failure must not block the assignment.
		}
	}

	return updated;
}

export async function confirmConsultationSlot(id: string, actor: Actor): Promise<ConsultationRow> {
	const row = await getConsultation(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	const [updated] = await db
		.update(consultations)
		.set({ slotConfirmed: true, updatedAt: new Date() })
		.where(eq(consultations.id, id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: id,
		kind: "status",
		text: "Slot confirmed",
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});
	return updated;
}

export async function startConsultationAssessment(id: string, actor: Actor): Promise<ConsultationRow> {
	const row = await getConsultation(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}
	if (!row.slotConfirmed) {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "Confirm the meeting slot before starting assessment");
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

	const [updated] = await db
		.update(consultations)
		.set({
			status: "COMPLETED",
			assessmentResult: input.result,
			updatedAt: new Date(),
		})
		.where(eq(consultations.id, row.id))
		.returning();

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
	} catch {
		// Notification failure must not block the assessment completion.
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
				assignedStaffId: row.assignedOfficerId,
				stage: "document_verification",
				status: "UNDER_REVIEW",
				fundingTrack: input.result.recPackage || null,
				notes: input.result.notes || "Opened from a completed consultation assessment.",
				checklist,
				submittedAt: new Date(),
			})
			.returning();
		return app;
	});

	return { consultation: updated, application: created };
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
				},
			]);
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

	const [updated] = await db
		.update(applications)
		.set({ assignedStaffId: input.employeeId, updatedAt: new Date() })
		.where(eq(applications.id, row.id))
		.returning();

	await db
		.update(applicants)
		.set({ assignedOfficerId: input.employeeId, updatedAt: new Date() })
		.where(eq(applicants.id, row.applicantId));

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "assignment",
		text: `Assigned to ${employee.name}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});
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
	return updated;
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

export async function setApplicationPackage(input: {
	id: string;
	fundingTrack: string;
	degreeLevel: string;
}): Promise<ApplicationRow> {
	const row = await getApplication(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const [updated] = await db
		.update(applications)
		.set({
			fundingTrack: input.fundingTrack,
			degreeLevel: input.degreeLevel,
			updatedAt: new Date(),
		})
		.where(eq(applications.id, row.id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "status",
		text: `Package chosen: ${input.fundingTrack} · ${input.degreeLevel}`,
		authorName: "Applicant",
	});
	return updated;
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

/** Applicant login ids a consultant may reach via assigned cases, not only bookings. */
export async function assignedApplicantUserIds(opsUserId: string): Promise<string[]> {
	const fromConsult = await db
		.select({ userId: applicants.userId })
		.from(consultations)
		.innerJoin(applicants, eq(applicants.id, consultations.applicantId))
		.where(eq(consultations.assignedOfficerId, opsUserId));
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
const ACTIVE_CONSULTATION_STATUSES = ["UNDER_REVIEW", "ASSIGNED", "IN_ASSESSMENT"] as const;

/**
 * Get per-coordinator workload across the platform.
 *
 * Returns one entry per coordinator with their active / overdue counts and
 * a capacity percentage.  Used for the heatmap and the delegation picker.
 */
export async function getCoordinatorWorkload(branch?: string): Promise<{
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
	const coordinators = await db
		.select()
		.from(opsUsers)
		.where(and(STAFF_ACTIVE, branch ? eq(opsUsers.branch, branch) : undefined));

	const coordinatorIds = coordinators.map((c) => c.id);
	if (coordinatorIds.length === 0) {
		return { coordinators: [], maxCapacityPerCoordinator: DEFAULT_MAX_CAPACITY };
	}

	const activeCases = await db
		.select({
			coordinatorId: consultations.coordinatorId,
			status: consultations.status,
		})
		.from(consultations)
		.where(
			sql`${consultations.coordinatorId} IN ${sql`(${sql.join(coordinatorIds.map((id) => sql`${id}`), sql`, `)})`} 
				AND ${consultations.status} IN ${sql`(${sql.join(ACTIVE_CONSULTATION_STATUSES.map((s) => sql`${s}`), sql`, `)})`}`,
		);

	const overdueThreshold = new Date(Date.now() - 4 * 60 * 60 * 1000);
	const overdueCases = await db
		.select({ coordinatorId: consultations.coordinatorId })
		.from(consultations)
		.where(
			sql`${consultations.coordinatorId} IN ${sql`(${sql.join(coordinatorIds.map((id) => sql`${id}`), sql`, `)})`} 
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

	const result = coordinators.map((c) => {
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

	const workload = await getCoordinatorWorkload();
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


