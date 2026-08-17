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
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	bookings,
	caseComments,
	consultations,
	opsUsers,
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import type { StaffContext } from "../middleware/auth.js";
import * as mail from "./notifications.js";
import { queueEmails } from "../worker/queues.js";

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

	// If an officer is assigned, keep the consultation alive — the applicant
	// should reschedule, not start a brand-new consultation flow.
	if (row.assignedOfficerId) return;

	await db
		.update(consultations)
		.set({ status: "CANCELLED", updatedAt: new Date() })
		.where(eq(consultations.id, row.id));
}

/**
 * Force-cancel the entire consultation process (separate from cancelling a
 * single booking).  Used by ops when the engagement should end entirely.
 */
export async function cancelConsultation(consultationId: string): Promise<void> {
	const [row] = await db
		.select({ id: consultations.id, status: consultations.status })
		.from(consultations)
		.where(eq(consultations.id, consultationId))
		.limit(1);

	if (!row) return;
	if (row.status === "COMPLETED" || row.status === "CANCELLED") return;

	await db
		.update(consultations)
		.set({ status: "CANCELLED", updatedAt: new Date() })
		.where(eq(consultations.id, row.id));
}

/* ── Serialise ───────────────────────────────────────────────────────────── */

async function serializeConsultation(row: ConsultationRow): Promise<ApiConsultation> {
	const [applicant, officer, booking, comments] = await Promise.all([
		db.select().from(applicants).where(eq(applicants.id, row.applicantId)).limit(1).then((r) => r[0]),
		loadStaff(row.assignedOfficerId),
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
		slotConfirmed: row.slotConfirmed,
		startsAt: booking?.startsAt.toISOString() ?? null,
		timezone: booking?.timezone ?? null,
		meetingUrl: booking?.meetingUrl ?? null,
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
		stage: row.stage,
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
		.where(eq(consultations.assignedOfficerId, staff.opsUserId))
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
	if (!eligible) return { consultation: updated, application: null };

	const [existing] = await db
		.select()
		.from(applications)
		.where(eq(applications.consultationId, row.id))
		.limit(1);
	if (existing) return { consultation: updated, application: existing };

	const applicant = (await getApplicant(row.applicantId))!;
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
				stage: "Document Verification",
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
	stage: string,
	actor: Actor,
): Promise<ApplicationRow> {
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


