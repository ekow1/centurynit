import { and, desc, eq, inArray, isNull, ne, not, or, sql } from "drizzle-orm";
import {
	CASE_ERROR_CODES,
	type AddComment,
	type ApiApplicant,
	type ApiApplication,

	type ApplicantProfile,

	type CaseApplicationStatus,
	type AcceptProceedResponse,
	canAdvanceToStage,
	travelBlockReason,
	type TravelAssistanceStatus,
	JOURNEY_STAGES,
	canOwnStage,
	JOURNEY_STAGE_LABELS,
	type JourneyStage,
	patchApplicationSchema,
	type ProceedQuotation,
} from "century-nit-shared";
import { serviceFeeFor, type SchoolFundingTrack } from "century-nit-core/content";
import { normalizeTravelStatus } from "./travelAssistance.js";
import { documentChecklistForApplication } from "./documentChecklist.js";
// Comments and document requests target either record; the consultation half lives next door.
import { getConsultation } from "./consultations.js";
import type { z } from "zod";
import { db } from "../db/index.js";
import {
	applicantDocuments,
	applicants,
	applications,

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
	stageAssignments,
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

export type Actor = { opsUserId: string; name: string; email: string };

export function emptyProfile(): ApplicantProfile {
	return {};
}

export async function nextAppNumber(tx: typeof db): Promise<string> {
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

export async function loadStaff(id: string | null) {
	if (!id) return null;
	const [row] = await db.select().from(opsUsers).where(eq(opsUsers.id, id)).limit(1);
	return row ?? null;
}

/**
 * The staff member being made handler of `stage` — must exist, be active,
 * and hold a role that may own that stage (STAGE_ASSIGNABLE_ROLES).
 */
export async function loadAssignableStaff(id: string, stage: string) {
	const employee = await loadStaff(id);
	if (!employee?.active) throw new HttpError(404, "NOT_FOUND", "Employee not found");
	if (!canOwnStage(employee.role, stage)) {
		throw new HttpError(
			409,
			"ROLE_CANNOT_OWN_STAGE",
			`${employee.name} (${employee.role}) cannot be the handler for ${JOURNEY_STAGE_LABELS[stage as JourneyStage] ?? stage}.`,
		);
	}
	return employee;
}

export async function commentsFor(
	targetType: "consultation" | "application",
	targetId: string,
	forApplicant = false,
): Promise<CommentRow[]> {
	let conditions = and(eq(caseComments.targetType, targetType), eq(caseComments.targetId, targetId));
	if (forApplicant) {
		conditions = and(conditions, eq(caseComments.visibility, "applicant"));
	}
	return db
		.select()
		.from(caseComments)
		.where(conditions)
		.orderBy(caseComments.at);
}

export function toComment(row: CommentRow) {
	return {
		id: row.id,
		at: row.at.toISOString(),
		author: row.authorName,
		kind: row.kind,
		text: row.text,
	};
}

/** Roles that see, and may assign, every case. */
export function canSeeAllCases(staff: StaffContext | null): boolean {
	return (
		staff?.role === "manager" ||
		staff?.role === "coordinator" ||
		staff?.role === "admin" ||
		staff?.role === "super_admin"
	);
}

/**
 * Whether the signed-in person may see and work this application.
 *
 * Staff who do not see everything reach a case in one of three ways — as the
 * whole-case owner (`applications.assignedStaffId`), as an active stage
 * specialist (`stage_assignments`: visa, travel, finance), or as the handler
 * of its travel request. All three count, on reads and writes alike: a visa
 * specialist who can advance the visa stage must also be able to open the
 * case, and vice versa.
 */
export async function canAccessApplication(
	applicationId: string,
	userId: string,
	staff: StaffContext | null,
): Promise<boolean> {
	const [row] = await db
		.select({ assignedStaffId: applications.assignedStaffId, applicantUserId: applicants.userId })
		.from(applications)
		.innerJoin(applicants, eq(applicants.id, applications.applicantId))
		.where(eq(applications.id, applicationId))
		.limit(1);
	if (!row) return false;
	if (row.applicantUserId && row.applicantUserId === userId) return true;
	if (!staff) return false;
	if (canSeeAllCases(staff)) return true;
	if (row.assignedStaffId === staff.opsUserId) return true;
	const [stageRow] = await db
		.select({ id: stageAssignments.id })
		.from(stageAssignments)
		.where(
			and(
				eq(stageAssignments.applicationId, applicationId),
				eq(stageAssignments.opsUserId, staff.opsUserId),
				eq(stageAssignments.status, "active"),
			),
		)
		.limit(1);
	if (stageRow) return true;
	const [travelRow] = await db
		.select({ id: travelAssistanceRequests.id })
		.from(travelAssistanceRequests)
		.where(
			and(
				eq(travelAssistanceRequests.applicationId, applicationId),
				eq(travelAssistanceRequests.assignedOpsUserId, staff.opsUserId),
			),
		)
		.limit(1);
	return Boolean(travelRow);
}

/** Applications a non-manager may see: owned, stage-assigned, or travel-handled. */
function accessibleApplicationsFilter(staff: StaffContext) {
	return or(
		eq(applications.assignedStaffId, staff.opsUserId),
		inArray(
			applications.id,
			db
				.select({ id: stageAssignments.applicationId })
				.from(stageAssignments)
				.where(and(eq(stageAssignments.opsUserId, staff.opsUserId), eq(stageAssignments.status, "active"))),
		),
		inArray(
			applications.id,
			db
				.select({ id: travelAssistanceRequests.applicationId })
				.from(travelAssistanceRequests)
				.where(eq(travelAssistanceRequests.assignedOpsUserId, staff.opsUserId)),
		),
	);
}



/* ── Ensure from booking ─────────────────────────────────────────────────── */






/* ── Serialise ───────────────────────────────────────────────────────────── */


async function serializeApplication(row: ApplicationRow, forApplicant = false): Promise<ApiApplication> {
	const [applicant, staff, comments, documentChecklist] = await Promise.all([
		db.select().from(applicants).where(eq(applicants.id, row.applicantId)).limit(1).then((r) => r[0]),
		loadStaff(row.assignedStaffId),
		commentsFor("application", row.id, forApplicant),
		documentChecklistForApplication(row.id),
	]);

	// Scoped to this application, not the applicant — an earlier application's
	// tracks must not appear on this one.
	const schoolList = await listSchoolsForApplication(row.id);

	const pendingHandoff = await pendingHandoffForApplication(row.id);

	// Load consent status for all three stages so the portal can decide
	// whether to show the consent card.
	const { getStageConsent } = await import("./stageConsents.js");
	const [applicationConsent, visaConsent, travelConsent, travelAssistanceStatus] = await Promise.all([
		getStageConsent(row.id, "application"),
		getStageConsent(row.id, "visa"),
		getStageConsent(row.id, "travel"),
		getTravelAssistanceStatusForApplication(row.id),
	]);

	// Who owns which stage right now (visa / travel / finance specialists).
	const stageHandlers = await db
		.select({
			stage: stageAssignments.stage,
			opsUserId: stageAssignments.opsUserId,
			opsUserName: opsUsers.name,
			opsUserEmail: opsUsers.email,
			assignedAt: stageAssignments.assignedAt,
		})
		.from(stageAssignments)
		.innerJoin(opsUsers, eq(opsUsers.id, stageAssignments.opsUserId))
		.where(and(eq(stageAssignments.applicationId, row.id), eq(stageAssignments.status, "active")))
		.then((rows) => rows.map((r) => ({ ...r, assignedAt: r.assignedAt.toISOString() })));

	// The same journey the portal shows, so ops sees the client's step.
	const { journeyForApplicant } = await import("./journey.js");
	const journey = applicant
		? await journeyForApplicant(applicant, row, { schoolTracks: schoolList, visaConsent }).catch(() => null)
		: null;

	return {
		id: row.id,
		appNumber: row.appNumber,
		applicantId: row.applicantId,
		applicantUserId: applicant?.userId ?? null,
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
		visaOutcome: (row.visaOutcome as "approved" | "refused" | null) ?? null,
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
		requestedDocuments: row.requestedDocuments ?? [],
		documentChecklist,
		preDepartureTasks: (row.preDepartureTasks ?? []) as ApiApplication["preDepartureTasks"],
		comments: comments.map(toComment),
		pendingHandoff,
		consultationId: row.consultationId ?? null,
		consultationNumber: null,
		schoolApplications: schoolList.schools,
		applicationConsent,
		visaConsent,
		travelConsent,
		travelAssistanceStatus,
		stageHandlers,
		journey: journey
			? {
					portalStage: journey.portalStage,
					label: journey.label,
					nextUnlock: journey.nextUnlock,
					stageStatuses: journey.stageStatuses,
					chapterUnlocks: journey.chapterUnlocks,
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
		.where(and(depositFilter, accessibleApplicationsFilter(staff)))
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
 * `null` when the applicant has not decided yet (no request exists).
 */
async function getTravelAssistanceStatusForApplication(
	applicationId: string,
): Promise<TravelAssistanceStatus | null> {
	const [row] = await db
		.select({ status: travelAssistanceRequests.status })
		.from(travelAssistanceRequests)
		.where(eq(travelAssistanceRequests.applicationId, applicationId))
		.orderBy(desc(travelAssistanceRequests.createdAt))
		.limit(1);
	return row ? normalizeTravelStatus(row.status) : null;
}

export { serializeApplication, serializeApplicant };

/* ── Consultation commands ───────────────────────────────────────────────── */





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
			visibility: input.data.visibility,
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
					body: `Your consultant has asked for: ${input.documents.join(", ")}. Please upload them in your document vault.`,
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
	const employee = await loadAssignableStaff(input.employeeId, "school_submission");

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
				title: "Your consultant has been assigned",
				body: "Your consultant is now on your case. You can now choose your schools and programmes.",
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
				title: "Chapter has no owner",
				body: `${JOURNEY_STAGE_LABELS[stage]} on ${app?.appNumber ?? "a case"} has no owner.`,
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
	// Accepting the application activates the applicant; it says nothing
	// about the visa. Visa tracking opens on its own path — consent, paid
	// visa invoice, specialist assigned — and used to be forced to "pending"
	// here, which opened the visa chapter on every case at document review.
	const [updated] = await db
		.update(applications)
		.set({ status: "ACCEPTED" satisfies CaseApplicationStatus, updatedAt: new Date() })
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
		hasPaymentPlan?: boolean;
		agencySettled?: boolean;
		preDepartureDone?: boolean;
		/**
		 * The travel request's status — the one travel signal. Resolved
		 * (never blocks) when booked, declined or on hold; everything else
		 * says what is still owed.
		 */
		travelAssistanceStatus?: TravelAssistanceStatus | null;
	},
): string | null {
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
		case "travel_assistance":
			return signals.visaDone
				? null
				: "Cannot advance to Departure: the visa must be approved.";
		case "completed": {
			const travelBlock = travelBlockReason(signals.travelAssistanceStatus, "Cannot advance to Completed");
			if (travelBlock) return travelBlock;
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
		visaDone: row.visaStage === "complete" && row.visaOutcome === "approved",
		hasPaymentPlan: Boolean(row.paymentPlanId),
		agencySettled: row.agencySettled,
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
	outcome?: "approved" | "refused",
): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");

	// The decision: a refusal is recorded at `decision` and stays there (the
	// case is reopened for a reapplication by moving back to `pending`);
	// reaching `complete` is an approval.
	if (outcome === "refused" && stage !== "decision") {
		throw new HttpError(409, "VISA_OUTCOME_STAGE", "A refusal is recorded at the decision step.");
	}
	// Any other move (including back to `pending`) clears a refusal — that is
	// the reapplication.
	const visaOutcome: string | null = outcome === "refused" ? "refused" : stage === "complete" ? "approved" : null;

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
			visaOutcome,
			visaCounselorNote: note ?? row.visaCounselorNote,
			updatedAt: new Date(),
		})
		.where(eq(applications.id, id))
		.returning();
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: id,
		kind: "status",
		text: visaOutcome === "refused" ? "Visa refused" : visaOutcome === "approved" ? "Visa approved" : `Visa stage → ${stage}`,
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
			link: "/portal/visa/tracking",
		}).catch(() => {});
	}

	if (stage === "complete") markStageCompleted(id, "visa_processing", actor.opsUserId);

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
 * Applicant self-service: complete the journey from Payment Execution.
 *
 * The gate is per-plan — a full plan needs the agency service fee settled in
 * full, an installment plan only its first installment (the deposit). Either
 * way the ticketing fee must be paid, travel clearance granted, and the
 * pre-departure checklist finished. `canAdvanceToStage` enforces all of it
 * server-side. Admission to `completed` is terminal: the owned assignments
 * for the finance and travel work are concluded.
 */
export async function completeFromDeparture(input: {
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
	if (row.stage !== "travel_assistance") {
		throw new HttpError(
			409,
			"STAGE_ADVANCE_BLOCKED",
			`Completion opens from Departure. Current stage: ${JOURNEY_STAGE_LABELS[row.stage]}.`,
		);
	}

	const travelAssistanceStatus = await getTravelAssistanceStatusForApplication(input.id);
	const gateReason = canAdvanceToStage(row.stage, "completed", {
		visaStage: row.visaStage,
		agencySettled: row.agencySettled,
		agencyStageIndex: row.agencyStageIndex,
		appFeePaid: row.appFeePaid,
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
		.where(and(eq(applications.id, row.id), eq(applications.stage, "travel_assistance")))
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

	// Terminal: conclude the travel owner (and any legacy finance owner).
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




/* ── Workload ──────────────────────────────────────────────────────────── */


/** Active statuses that count towards a coordinator's workload. */


/* ── Activity timeline ─────────────────────────────────────────────────── */

export async function recordActivity(input: {
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


/* ── Auto-escalation ───────────────────────────────────────────────────── */


/* ── Daily digest ──────────────────────────────────────────────────────── */




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


