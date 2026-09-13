import { and, desc, eq, sql } from "drizzle-orm";
import {
	CASE_ERROR_CODES,



	type ApiConsultation,
	type ApplicantProfile,
	type AssessmentResult,











} from "century-nit-shared";


import { documentChecklistFor } from "./documentChecklist.js";

import { db } from "../db/index.js";
import {

	applicants,
	applications,
	bookings,
	caseComments,
	consultationActivities,
	consultations,




	opsUsers,





} from "../db/schema.js";

import { HttpError } from "../middleware/error.js";
import type { StaffContext } from "../middleware/auth.js";
import * as mail from "./notifications.js";
import { queueEmails } from "../worker/queues.js";
import { notify, notifyMany, getStaffUserId, getManagerAndCoordinatorUserIds } from "./notify.js";


import {
	linkApplicationToLead,
	syncLeadAssignment,

} from "./leads.js";








import {

	type ConsultationRow,
	type ApplicationRow,
	type Actor,
	loadStaff,
	commentsFor,
	toComment,
	emptyProfile,
	getApplicant,
	canSeeAllCases,



	recordActivity,
	nextAppNumber,
	loadAssignableStaff,
} from "./cases.js";

/**
 * Consultations — the first chapter: the booking that opens the case, its
 * assignment and rescheduling, the assessment that ends it, coordinator
 * delegation, workload, and the consultation's own timeline. Split out of
 * cases.ts, which keeps the application lifecycle.
 */

const STAFF_ACTIVE = eq(opsUsers.active, true);

const DEFAULT_MAX_CAPACITY = 10;

const ACTIVE_CONSULTATION_STATUSES = ["UNDER_REVIEW", "ASSIGNED", "CONFIRMED", "IN_ASSESSMENT"] as const;

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

export async function serializeConsultation(row: ConsultationRow, forApplicant = false): Promise<ApiConsultation> {
	const [applicant, coordinator, coordinatorAssigner, booking, comments, linkedApplication] = await Promise.all([
		db.select().from(applicants).where(eq(applicants.id, row.applicantId)).limit(1).then((r) => r[0]),
		loadStaff(row.coordinatorId),
		loadStaff(row.coordinatorAssignedBy),
		row.bookingId
			? db.select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1).then((r) => r[0] ?? null)
			: Promise.resolve(null),
		commentsFor("consultation", row.id, forApplicant),
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
	// The standard documents are collected here, in the Consultation chapter.
	const documentChecklist = await documentChecklistFor({
		ownerUserId: applicant?.userId ?? null,
		recommendedPackage: (row.assessmentResult as { recPackage?: string } | null)?.recPackage ?? null,
	});

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
		documentChecklist,
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

export async function getConsultation(id: string): Promise<ConsultationRow | null> {
	const [row] = await db.select().from(consultations).where(eq(consultations.id, id)).limit(1);
	return row ?? null;
}

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

	const employee = await loadAssignableStaff(input.employeeId, "consultation");

	// Availability is checked *before* anything is written. Previously the
	// consultation was reassigned first and the booking assignment then
	// refused the clash, leaving the case pointing at someone who could not
	// take the slot.
	if (row.bookingId) {
		const [booking] = await db.select().from(bookings).where(eq(bookings.id, row.bookingId)).limit(1);
		if (booking && booking.employeeId !== input.employeeId) {
			const { isEmployeeAvailable } = await import("./availability.js");
			const check = await isEmployeeAvailable(input.employeeId, booking.startsAt, booking.durationMinutes, {
				excludeBookingId: booking.id,
				timezone: booking.timezone,
			});
			if (!check.available) {
				throw new HttpError(
					409,
					"EMPLOYEE_UNAVAILABLE",
					`${employee.name} is not available at the consultation's time`,
					{ reason: check.reason },
				);
			}
		}
	}

	// Officer, applicant contact, history and audit line change together.
	const { startAssignment } = await import("./caseAssignments.js");
	const updated = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const [c] = await txDb
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
		await startAssignment({
			targetType: "consultation",
			targetId: row.id,
			opsUserId: input.employeeId,
			assignedBy: input.actor.opsUserId,
			tx: txDb,
		});
		await txDb
			.update(applicants)
			.set({ assignedOfficerId: input.employeeId, updatedAt: new Date() })
			.where(eq(applicants.id, row.applicantId));
		await txDb.insert(caseComments).values({
			targetType: "consultation",
			targetId: row.id,
			kind: "assignment",
			text: `Assigned to ${employee.name}`,
			authorName: input.actor.name,
			authorOpsUserId: input.actor.opsUserId,
		});
		return c;
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

export async function applicantUserIdOfConsultation(id: string): Promise<string | null> {
	const [row] = await db
		.select({ userId: applicants.userId })
		.from(consultations)
		.innerJoin(applicants, eq(applicants.id, consultations.applicantId))
		.where(eq(consultations.id, id))
		.limit(1);
	return row?.userId ?? null;
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
