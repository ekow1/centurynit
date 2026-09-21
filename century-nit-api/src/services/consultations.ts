import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
	CASE_ERROR_CODES,
	permissionsGrant,



	type ApiConsultation,
	type ApplicantProfile,
	type AssessmentResult,











} from "century-nit-shared";


import { documentChecklistFor } from "./documentChecklist.js";
import { canonicalBranchId } from "./availability.js";

import { db } from "../db/index.js";
import {

	applicants,
	applications,
	bookings,
	caseComments,
	consultationActivities,
	consultations,
	coordinatorDuty,
	coordinationGrants,




	opsUsers,





} from "../db/schema.js";

import { HttpError } from "../middleware/error.js";
import type { StaffContext } from "../middleware/auth.js";
import { permissionsOfRole } from "./roles.js";
import * as mail from "./notifications.js";
import { queueEmails } from "../worker/queues.js";
import { notify, notifyMany, getStaffUserId, getManagerAndCoordinatorUserIds } from "./notify.js";
import type { DomainEventType } from "century-nit-shared";
import { emitDomain } from "../worker/pubsub.js";


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
 * The coordinator steers. While a case has one, only they may place handlers
 * or move the file between branches — everyone else, managers included,
 * watches until they take the case back. Delegation itself stays with
 * managers; cancel stays a manager break-glass.
 */
async function assertCanSteer(row: ConsultationRow, actor: Actor): Promise<void> {
	if (!row.coordinatorId || row.coordinatorId === actor.opsUserId) return;
	const coordinator = await loadStaff(row.coordinatorId);
	throw new HttpError(
		409,
		"CASE_COORDINATED",
		`This case is coordinated by ${coordinator?.name ?? "a coordinator"} — take back coordination to make changes`,
	);
}

/**
 * Who may hold the wheel: either the see-all capability from their role, or
 * a standing coordination grant a manager/admin has given them (until it's
 * retracted or lapses).
 */
async function assertCanCoordinate(opsUser: { id: string; role: string; name: string }): Promise<void> {
	const permissions = await permissionsOfRole(opsUser.role);
	if (permissionsGrant(opsUser.role, permissions, "see_all_cases")) return;
	if (await hasActiveCoordinationGrant(opsUser.id)) return;
	throw new HttpError(
		400,
		"NOT_COORDINATOR_CAPABLE",
		`${opsUser.name} can't coordinate cases — grant them case oversight first`,
	);
}

async function hasActiveCoordinationGrant(opsUserId: string): Promise<boolean> {
	const [grant] = await db
		.select({ id: coordinationGrants.id })
		.from(coordinationGrants)
		.where(
			and(
				eq(coordinationGrants.opsUserId, opsUserId),
				isNull(coordinationGrants.revokedAt),
				or(isNull(coordinationGrants.expiresAt), gt(coordinationGrants.expiresAt, new Date())),
			),
		)
		.limit(1);
	return Boolean(grant);
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

	// Link the new case to the applicant's most recent cancelled consultation
	// (if any) so ops sees one client story, not two orphan rows.
	const [cancelledBefore] = await db
		.select({ id: consultations.id })
		.from(consultations)
		.where(and(eq(consultations.applicantId, applicant.id), eq(consultations.status, "CANCELLED")))
		.orderBy(desc(consultations.createdAt))
		.limit(1);

	// Coordination resolution: the applicant's journey coordinator wins, else
	// the branch's duty coordinator for today. Either is a stamp — a manager
	// can still delegate the case to someone else, or take it back.
	let coordination: { coordinatorId: string; coordinatedVia: string } | null = null;
	if (applicant.coordinatorId) {
		coordination = { coordinatorId: applicant.coordinatorId, coordinatedVia: "applicant" };
	} else {
		const today = new Date().toISOString().slice(0, 10);
		const [duty] = await db
			.select({ coordinatorId: coordinatorDuty.coordinatorId })
			.from(coordinatorDuty)
			.where(and(eq(coordinatorDuty.branch, booking.branchId), eq(coordinatorDuty.dutyDate, today)))
			.limit(1);
		if (duty) coordination = { coordinatorId: duty.coordinatorId, coordinatedVia: "duty" };
	}

	const [created] = await db
		.insert(consultations)
		.values({
			reference: booking.reference,
			bookingId: booking.id,
			applicantId: applicant.id,
			branch: booking.branchId,
			type: booking.type,
			status: "UNDER_REVIEW",
			rebookedFromId: cancelledBefore?.id ?? null,
			coordinatorId: coordination?.coordinatorId ?? null,
			coordinatorAssignedAt: coordination ? new Date() : null,
			coordinatedVia: coordination?.coordinatedVia ?? null,
		})
		.onConflictDoNothing({ target: consultations.bookingId })
		.returning();

	if (created) {
		emitConsultationEvent(created, "consultation.created").catch(() => {});
		return created;
	}

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
export async function syncConsultationCancelled(
	bookingId: string,
	actor?: { name: string; email: string; opsUserId?: string | null },
	reason?: string,
	skipComment?: boolean,
): Promise<void> {
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

	// Audit trail — who cancelled the appointment and why. The ops path
	// (cancelConsultation) writes its own line first, so it asks us to skip.
	if (!skipComment) {
		await db.insert(caseComments).values({
			targetType: "consultation",
			targetId: row.id,
			kind: "status",
			text: `Appointment cancelled by ${actor?.name ?? "system"}${reason ? `: ${reason}` : "."}`,
			authorName: actor?.name ?? "System",
			authorOpsUserId: actor?.opsUserId ?? null,
		});
	}

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
				skipConsultationComment: true,
			});
		} catch {
			// The booking may already be cancelled or in a terminal state.
			// The consultation itself is already cancelled, which is what matters.
		}
	}

	const [cancelled] = await db.select().from(consultations).where(eq(consultations.id, row.id)).limit(1);
	if (cancelled) await emitConsultationEvent(cancelled, "consultation.updated");
}

/**
 * Issue a free-rebooking credit — the client's next consultation checkout
 * skips payment entirely. Only valid on a cancelled case. The client is
 * told in-app and by email; a credit nobody hears about is no credit.
 */
export async function issueRebookingCredit(
	id: string,
	actor: { opsUserId: string; name: string; email: string },
): Promise<void> {
	const row = await getConsultation(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status !== "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "Only a cancelled consultation can take a rebooking credit");
	}

	await db
		.update(applicants)
		.set({ freeRebooking: true, updatedAt: new Date() })
		.where(eq(applicants.id, row.applicantId));

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "status",
		text: `Free rebooking issued by ${actor.name} — the client picks a new slot without paying`,
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});

	// Tell the client — in-app and by email (notify queues the email itself).
	const applicant = await getApplicant(row.applicantId);
	if (applicant?.userId) {
		notify({
			recipientUserId: applicant.userId,
			type: "consultation.rebook_credit",
			title: "Your rebooking is covered",
			body: "We issued a free rebooking for your cancelled consultation — pick a new slot, no payment needed.",
			link: "/portal/consultation",
			entityType: "case",
			entityId: row.id,
			email: applicant.email
				? mail.rebookingCreditForClient({
						entityId: row.id,
						reference: row.reference,
						clientName: applicant.name ?? applicant.email,
						clientEmail: applicant.email,
					})
				: undefined,
		}).catch(() => {});
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
		handlerCarriesCase: row.handlerCarriesCase,
		coordinatorId: row.coordinatorId,
		coordinatorName: coordinator?.name ?? null,
		coordinatorEmail: coordinator?.email ?? null,
		coordinatedVia: (row.coordinatedVia as ApiConsultation["coordinatedVia"]) ?? null,
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
		// Older rows predate the stage recommendation; empty means the full journey.
		assessmentResult: row.assessmentResult ? { recStages: [], ...row.assessmentResult } : null,
		requestedDocuments: row.requestedDocuments ?? [],
		documentChecklist,
		comments: comments.map(toComment),
		profile: (applicant?.profile as ApplicantProfile) ?? emptyProfile(),
		workflow,
		applicationId: linkedApplication?.id ?? null,
		applicationNumber: linkedApplication?.appNumber ?? null,
		applicationStage: linkedApplication?.stage ?? null,
		cancelledAt: booking?.cancelledAt?.toISOString() ?? null,
		cancelledBy: booking?.cancelledBy ?? null,
		cancellationReason: booking?.cancellationReason ?? null,
		freeRebooking: applicant?.freeRebooking ?? false,
		rebookedFromId: row.rebookedFromId ?? null,
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
	/**
	 * Coverage — `stage` staffs this consultation only; `all` lets the
	 * handler carry the case it opens (the application starts with them as
	 * its handler instead of an empty seat).
	 */
	scope?: "stage" | "all";
	/** Referral — move the file's handling branch with the placement. */
	branch?: string;
	actor: Actor;
}): Promise<ConsultationRow> {
	const row = await getConsultation(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}
	await assertCanSteer(row, input.actor);

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

	const referredBranch = input.branch ? canonicalBranchId(input.branch) : null;
	if (input.branch && !referredBranch) {
		throw new HttpError(400, "BRANCH_NOT_FOUND", `Unknown branch: ${input.branch}`);
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
				handlerCarriesCase: input.scope === "all",
				...(referredBranch ? { branch: referredBranch } : {}),
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
			text: `Assigned to ${employee.name}${input.scope === "all" ? " — carries the case it opens" : ""}${referredBranch ? ` · referred to ${referredBranch}` : ""}`,
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
				entityId: updated.id,
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

	await emitConsultationEvent(updated, "consultation.updated");
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
			// The confirmation email carries the join link — an online case
			// can't be confirmed with nothing to join. The confirm click is the
			// guaranteed checkpoint: mint the room now if assignment didn't (or
			// couldn't). Only when no provider can produce a link do we still
			// ask staff to paste one.
			if (row.type === "online" && !booking.meetingUrl) {
				const { syncCalendarForBooking } = await import("./booking.js");
				const ensured = await syncCalendarForBooking(booking.id);
				if (!ensured.meetingUrl) {
					throw new HttpError(
						409,
						CASE_ERROR_CODES.CASE_CLOSED,
						"Add a meeting link before confirming — the confirmation email carries it",
					);
				}
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

	await emitConsultationEvent(updated, "consultation.updated");
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
	await emitConsultationEvent(updated, "consultation.updated");
	return updated;
}

/**
 * Roll an in-progress assessment back to CONFIRMED — the undo for a "Start
 * assessment" misclick. Only that one step back exists; completed outcomes
 * stay locked.
 */
export async function returnConsultationToConfirmed(id: string, actor: Actor): Promise<ConsultationRow> {
	const row = await getConsultation(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status !== "IN_ASSESSMENT") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "Only an in-progress assessment can return to confirmed");
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
		text: "Returned to confirmed — the assessment can be started again",
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});
	await emitConsultationEvent(updated, "consultation.updated");
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
				entityId: updated.id,
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

	// Covers every exit below — eligible or not, the consultation is now
	// COMPLETED and an eligible outcome may also have opened an application.
	await emitConsultationEvent(updated, "consultation.updated");

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
				// Normally null: the consultation's officer is not inherited — a
				// manager assigns the application handler from the ops workspace.
				// The exception is a carry-through placement (`handlerCarriesCase`
				// set when the consultation was staffed with "rest of the case"
				// coverage): the officer opens the case already holding it.
				assignedStaffId: row.handlerCarriesCase ? row.assignedOfficerId : null,
				// The file's owning office follows the consultation's branch —
				// a Kumasi client whose consultation was referred to Accra keeps
				// the case in Accra.
				branch: canonicalBranchId(row.branch) ?? null,
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

		// Fully release the consultant — same principle as assignedStaffId
		// above. A carry-through handler keeps the seat instead.
		if (!row.handlerCarriesCase) {
			await tx
				.update(applicants)
				.set({ assignedOfficerId: null, updatedAt: new Date() })
				.where(eq(applicants.id, row.applicantId));
		}

		return app;
	});

	if (applicant?.email && created) {
		await linkApplicationToLead(created.id, applicant.email, input.actor.name);
	}

	const carrying = Boolean(row.handlerCarriesCase && row.assignedOfficerId);
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: created.id,
		kind: "assignment",
		text: carrying
			? "Application opened — handler carried through from the consultation"
			: "Application opened — awaiting handler",
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	// NOTE: the school_submission handoff is NOT created here. It fires when
	// the 10% agency deposit is paid (see recordPayment in invoice.ts). Creating
	// it at consultation completion was premature — the applicant hasn't even
	// accepted to proceed yet, and a pending handoff for a declined applicant
	// would sit in the ops queue as a phantom entry.

	// In-app: hand the case to management — it needs a handler before work
	// starts. A carry-through case already has one; nothing to place.
	if (!carrying) {
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
	}

	return { consultation: updated, application: created };
}

/**
 * Refer a consultation to another handling branch without placing a
 * handler — the receiving desk staffs it from their own queue. The branch
 * is the office that owns the file, not the client's location.
 */
export async function referConsultationBranch(input: {
	id: string;
	branch: string;
	note?: string;
	actor: Actor;
}): Promise<ConsultationRow> {
	const row = await getConsultation(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}
	await assertCanSteer(row, input.actor);
	const branch = canonicalBranchId(input.branch);
	if (!branch) throw new HttpError(400, "BRANCH_NOT_FOUND", `Unknown branch: ${input.branch}`);

	const [updated] = await db
		.update(consultations)
		.set({ branch, updatedAt: new Date() })
		.where(eq(consultations.id, row.id))
		.returning();

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "assignment",
		text: `Referred to ${branch}${input.note ? ` — ${input.note}` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	const recipients = await getManagerAndCoordinatorUserIds();
	await notifyMany(
		recipients.map((r) => ({
			recipientUserId: r.userId,
			type: "case.updated",
			title: "Consultation referred to a branch",
			body: `${row.reference} was referred to ${branch}${input.note ? ` — ${input.note}` : ""}`,
			link: `/consultations?id=${row.id}`,
		})),
	).catch(() => {});

	await emitConsultationEvent(updated, "consultation.updated");
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

/**
 * Refresh signal for a consultation mutation — a domain event, not a
 * notification. `ops:events` refreshes every console's consultation list,
 * pipeline and work queue; the applicant's channel syncs the portal's
 * consultation chapter. Bell entries stay with notify().
 */
async function emitConsultationEvent(row: ConsultationRow, type: DomainEventType, extra?: Record<string, unknown>): Promise<void> {
	const clientUserId = await applicantUserIdOfConsultation(row.id);
	emitDomain(
		type,
		{ consultationId: row.id, reference: row.reference, status: row.status, ...extra },
		{ ops: true, userId: clientUserId },
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
	/**
	 * "case" hands over this consultation. "journey" also makes them the
	 * applicant's coordinator — every case the person opens (a rebook, the
	 * application) inherits them, and their other live consultations are
	 * stamped too.
	 */
	scope?: "case" | "journey";
	actor: Actor;
}): Promise<ConsultationRow> {
	const row = await getConsultation(input.consultationId);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (row.status === "COMPLETED" || row.status === "CANCELLED") {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This consultation is closed");
	}

	const coordinator = await loadStaff(input.coordinatorOpsUserId);
	if (!coordinator?.active) throw new HttpError(404, "NOT_FOUND", "Coordinator not found or inactive");
	await assertCanCoordinate(coordinator);

	const scope = input.scope ?? "case";
	const now = new Date();
	const [updated] = await db
		.update(consultations)
		.set({
			coordinatorId: input.coordinatorOpsUserId,
			coordinatorAssignedAt: now,
			coordinatorAssignedBy: input.actor.opsUserId,
			coordinatedVia: scope === "journey" ? "applicant" : "case",
			delegationNote: input.note ?? row.delegationNote,
			updatedAt: now,
		})
		.where(eq(consultations.id, row.id))
		.returning();

	if (scope === "journey") {
		await db
			.update(applicants)
			.set({ coordinatorId: input.coordinatorOpsUserId, updatedAt: now })
			.where(eq(applicants.id, row.applicantId));
		// "All their cases" is literal — every other live case of theirs
		// inherits the same coordinator.
		await db
			.update(consultations)
			.set({
				coordinatorId: input.coordinatorOpsUserId,
				coordinatorAssignedAt: now,
				coordinatorAssignedBy: input.actor.opsUserId,
				coordinatedVia: "applicant",
				updatedAt: now,
			})
			.where(
				and(
					eq(consultations.applicantId, row.applicantId),
					inArray(consultations.status, [...ACTIVE_CONSULTATION_STATUSES]),
				),
			);
	}

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "assignment",
		text:
			scope === "journey"
				? `Journey delegated to coordinator ${coordinator.name} — every case for this applicant inherits${input.note ? `: ${input.note}` : ""}`
				: `Delegated to coordinator ${coordinator.name}${input.note ? `: ${input.note}` : ""}`,
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
	await assertCanCoordinate(newCoordinator);

	const oldCoordinator = row.coordinatorId ? await loadStaff(row.coordinatorId) : null;
	const now = new Date();
	const [updated] = await db
		.update(consultations)
		.set({
			coordinatorId: input.newCoordinatorOpsUserId,
			coordinatorAssignedAt: now,
			coordinatorAssignedBy: input.actor.opsUserId,
			coordinatedVia: "case",
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
 * The take-back: a manager pulls coordination back from whoever holds it.
 * Always available while a case is coordinated — the built-in break-glass,
 * so a delegated case can never strand. Clears only this case's stamp; an
 * applicant-level grant keeps covering their other cases.
 */
export async function reclaimConsultationCoordination(id: string, actor: Actor): Promise<ConsultationRow> {
	const row = await getConsultation(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.CONSULTATION_NOT_FOUND, "Consultation not found");
	if (!row.coordinatorId) {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This case isn't coordinated by anyone");
	}
	const previous = await loadStaff(row.coordinatorId);
	const [updated] = await db
		.update(consultations)
		.set({
			coordinatorId: null,
			coordinatorAssignedAt: null,
			coordinatorAssignedBy: null,
			coordinatedVia: null,
			updatedAt: new Date(),
		})
		.where(eq(consultations.id, row.id))
		.returning();

	await db.insert(caseComments).values({
		targetType: "consultation",
		targetId: row.id,
		kind: "assignment",
		text: `Coordination taken back by ${actor.name} — was ${previous?.name ?? "unassigned"}`,
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});
	await recordActivity({
		consultationId: row.id,
		type: "coordination_reclaimed",
		actorOpsUserId: actor.opsUserId,
		actorName: actor.name,
		payload: { fromCoordinatorName: previous?.name ?? null },
	});

	return updated;
}

/**
 * Journey scope: make a coordinator the applicant's — every case they open
 * inherits it, and their live cases are stamped now. Releasing clears only
 * the applicant field; in-flight cases keep whoever already holds them.
 */
export async function delegateJourneyCoordinator(input: {
	applicantId: string;
	coordinatorOpsUserId: string;
	actor: Actor;
}): Promise<void> {
	const applicant = await getApplicant(input.applicantId);
	if (!applicant) throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "Applicant not found");
	const coordinator = await loadStaff(input.coordinatorOpsUserId);
	if (!coordinator?.active) throw new HttpError(404, "NOT_FOUND", "Coordinator not found or inactive");
	await assertCanCoordinate(coordinator);

	const now = new Date();
	await db
		.update(applicants)
		.set({ coordinatorId: input.coordinatorOpsUserId, updatedAt: now })
		.where(eq(applicants.id, applicant.id));
	await db
		.update(consultations)
		.set({
			coordinatorId: input.coordinatorOpsUserId,
			coordinatorAssignedAt: now,
			coordinatorAssignedBy: input.actor.opsUserId,
			coordinatedVia: "applicant",
			updatedAt: now,
		})
		.where(
			and(
				eq(consultations.applicantId, applicant.id),
				inArray(consultations.status, [...ACTIVE_CONSULTATION_STATUSES]),
			),
		);
}

export async function releaseJourneyCoordinator(input: {
	applicantId: string;
	actor: Actor;
}): Promise<void> {
	const applicant = await getApplicant(input.applicantId);
	if (!applicant) throw new HttpError(404, CASE_ERROR_CODES.APPLICANT_NOT_FOUND, "Applicant not found");
	if (!applicant.coordinatorId) {
		throw new HttpError(409, CASE_ERROR_CODES.CASE_CLOSED, "This applicant has no journey coordinator");
	}
	await db
		.update(applicants)
		.set({ coordinatorId: null, updatedAt: new Date() })
		.where(eq(applicants.id, applicant.id));
}

/* ── Duty roster ─────────────────────────────────────────────────────────── */

/** Today's duty coordinator for a branch, with the staff row resolved. */
export async function getCoordinatorDuty(branch: string) {
	const today = new Date().toISOString().slice(0, 10);
	const [row] = await db
		.select()
		.from(coordinatorDuty)
		.where(and(eq(coordinatorDuty.branch, branch), eq(coordinatorDuty.dutyDate, today)))
		.limit(1);
	if (!row) return { branch, dutyDate: today, coordinator: null };
	const coordinator = await loadStaff(row.coordinatorId);
	return {
		branch: row.branch,
		dutyDate: row.dutyDate,
		coordinator: coordinator ? { id: coordinator.id, name: coordinator.name, email: coordinator.email } : null,
	};
}

/** Set (or clear, with null) the branch's duty coordinator for today. */
export async function setCoordinatorDuty(input: {
	branch: string;
	coordinatorOpsUserId: string | null;
	actor: Actor;
}) {
	const today = new Date().toISOString().slice(0, 10);
	if (input.coordinatorOpsUserId === null) {
		await db
			.delete(coordinatorDuty)
			.where(and(eq(coordinatorDuty.branch, input.branch), eq(coordinatorDuty.dutyDate, today)));
		return getCoordinatorDuty(input.branch);
	}
	const coordinator = await loadStaff(input.coordinatorOpsUserId);
	if (!coordinator?.active) throw new HttpError(404, "NOT_FOUND", "Coordinator not found or inactive");
	await assertCanCoordinate(coordinator);
	await db
		.insert(coordinatorDuty)
		.values({
			branch: input.branch,
			dutyDate: today,
			coordinatorId: input.coordinatorOpsUserId,
			setBy: input.actor.opsUserId,
		})
		.onConflictDoUpdate({
			target: [coordinatorDuty.branch, coordinatorDuty.dutyDate],
			set: { coordinatorId: input.coordinatorOpsUserId, setBy: input.actor.opsUserId },
		});
	return getCoordinatorDuty(input.branch);
}

/* ── Standing coordination grants ──────────────────────────────────────────
 * The authority layer: a manager/admin grants a staff member the right to
 * hold cases until it is retracted or lapses. Grant/revoke is audited on the
 * staff record; retracting also pulls their in-flight cases back to the pool
 * so access never lingers past its welcome.
 */

export type CoordinationGrantInfo = {
	active: boolean;
	grantedAt: string | null;
	expiresAt: string | null;
	grantedByName: string | null;
};

export async function getCoordinationGrant(opsUserId: string): Promise<CoordinationGrantInfo> {
	const [grant] = await db
		.select()
		.from(coordinationGrants)
		.where(and(eq(coordinationGrants.opsUserId, opsUserId), isNull(coordinationGrants.revokedAt)))
		.orderBy(desc(coordinationGrants.createdAt))
		.limit(1);
	if (!grant || (grant.expiresAt && grant.expiresAt.getTime() <= Date.now())) {
		return { active: false, grantedAt: null, expiresAt: null, grantedByName: null };
	}
	const grantor = grant.grantedBy ? await loadStaff(grant.grantedBy) : null;
	return {
		active: true,
		grantedAt: grant.createdAt.toISOString(),
		expiresAt: grant.expiresAt?.toISOString() ?? null,
		grantedByName: grantor?.name ?? null,
	};
}

/** Grant standing case-oversight — replaces any live grant. */
export async function grantCoordination(input: {
	opsUserId: string;
	expiresAt?: Date | null;
	actor: Actor;
}): Promise<CoordinationGrantInfo> {
	const grantee = await loadStaff(input.opsUserId);
	if (!grantee?.active) throw new HttpError(404, "NOT_FOUND", "Staff member not found or inactive");

	const now = new Date();
	await db
		.update(coordinationGrants)
		.set({ revokedAt: now, revokedBy: input.actor.opsUserId })
		.where(and(eq(coordinationGrants.opsUserId, input.opsUserId), isNull(coordinationGrants.revokedAt)));
	await db.insert(coordinationGrants).values({
		opsUserId: input.opsUserId,
		grantedBy: input.actor.opsUserId,
		expiresAt: input.expiresAt ?? null,
	});

	const granteeUserId = await getStaffUserId(input.opsUserId);
	if (granteeUserId) {
		await notify({
			recipientUserId: granteeUserId,
			type: "staff.coordination_granted",
			title: "You can now coordinate cases",
			body: `${input.actor.name} granted you case oversight${input.expiresAt ? ` until ${input.expiresAt.toISOString().slice(0, 10)}` : " until they retract it"}.`,
			link: "/consultations",
			eventId: `coordination-grant:${input.opsUserId}:${now.toISOString()}`,
		});
	}
	return getCoordinationGrant(input.opsUserId);
}

/**
 * Retract the grant — and pull their in-flight cases back. Retracting access
 * can't leave cases held by someone who may no longer steer them, so each
 * active case they coordinate returns to the management pool (reclaimable,
 * re-delegable, escalatable) with a note on the timeline.
 */
export async function revokeCoordination(input: {
	opsUserId: string;
	actor: Actor;
}): Promise<{ reclaimedCases: number }> {
	const grantee = await loadStaff(input.opsUserId);
	const now = new Date();
	const revoked = await db
		.update(coordinationGrants)
		.set({ revokedAt: now, revokedBy: input.actor.opsUserId })
		.where(and(eq(coordinationGrants.opsUserId, input.opsUserId), isNull(coordinationGrants.revokedAt)))
		.returning({ id: coordinationGrants.id });
	if (revoked.length === 0) {
		throw new HttpError(409, "NO_ACTIVE_GRANT", "No active coordination grant to retract");
	}

	const reclaimed = await db
		.update(consultations)
		.set({
			coordinatorId: null,
			coordinatorAssignedAt: null,
			coordinatorAssignedBy: null,
			coordinatedVia: null,
			updatedAt: now,
		})
		.where(and(eq(consultations.coordinatorId, input.opsUserId), inArray(consultations.status, ACTIVE_CONSULTATION_STATUSES)))
		.returning({ id: consultations.id });

	for (const c of reclaimed) {
		await db.insert(caseComments).values({
			targetType: "consultation",
			targetId: c.id,
			kind: "assignment",
			text: `Coordination retracted from ${grantee?.name ?? "the coordinator"} by ${input.actor.name} — case returns to the management pool`,
			authorName: input.actor.name,
			authorOpsUserId: input.actor.opsUserId,
		});
		await recordActivity({
			consultationId: c.id,
			type: "coordination_reclaimed",
			actorOpsUserId: input.actor.opsUserId,
			actorName: input.actor.name,
			payload: { fromCoordinatorName: grantee?.name ?? null, viaGrantRevocation: true },
		});
	}

	const granteeUserId = await getStaffUserId(input.opsUserId);
	if (granteeUserId) {
		await notify({
			recipientUserId: granteeUserId,
			type: "staff.coordination_revoked",
			title: "Case oversight retracted",
			body: `${input.actor.name} retracted your case coordination access${reclaimed.length ? ` — ${reclaimed.length} case(s) returned to the pool` : ""}.`,
			link: "/consultations",
			eventId: `coordination-revoked:${input.opsUserId}:${now.toISOString()}`,
		});
	}
	return { reclaimedCases: reclaimed.length };
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
