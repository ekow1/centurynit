import { and, desc, eq, ilike, inArray, isNull, ne, not, or, sql } from "drizzle-orm";
import {
	CASE_ERROR_CODES,
	type AddComment,
	type ApiApplicant,
	type ApiApplication,

	type ApplicantProfile,

	type CaseApplicationStatus,
	type AcceptProceedResponse,
	canAdvanceToStage,
	isTravelResolved,
	travelBlockReason,
	type TravelAssistanceStatus,
	JOURNEY_STAGES,
	canOwnStage,
	JOURNEY_STAGE_LABELS,
	type JourneyStage,
	patchApplicationSchema,
	type ProceedQuotation,
	permissionsGrant,
	type VisaDetails,
	type DepartureDetails,
	type PreDepartureTask,
	VISA_STAGE_LABELS,
	milestoneLines,
	normaliseScope,
	quoteTotal,
	scopeHas,
	scopeLabel,
	serviceStageForJourney,
	stageLines,
	SERVICE_STAGE_LABELS,
	SERVICE_STAGES,
	type ServiceStage,
	nextStepFor,
} from "century-nit-shared";
import { serviceFeeFor, type SchoolFundingTrack } from "century-nit-core/content";
import { canonicalBranchId } from "./availability.js";
import { normalizeTravelStatus } from "./travelAssistance.js";
import { livePermissions } from "./roles.js";
import { documentChecklistForApplication, plannedStagesFor, visaDocumentChecklistFor } from "./documentChecklist.js";
// Comments and document requests target either record; the consultation half lives next door.
import { applicantUserIdOfConsultation, getConsultation } from "./consultations.js";
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
	invoicePayments,
	notifications,
	opsUsers,
	destinations,
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
import { emitDomain } from "../worker/pubsub.js";
import { listSchoolsForApplication } from "./schools.js";
import { applicationFeeLinesFor, createInvoice, type InvoiceRow } from "./invoice.js";
import { activeFeeItem } from "./fees.js";
import { resolvePreDepartureTasks, seedPreDepartureTasks } from "./preDeparture.js";
import {

	syncLeadAssignment,
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
	if (!canOwnStage(employee.role, stage, await livePermissions())) {
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

/** Whoever holds the capability sees every case (the root role always does). */
export function canSeeAllCases(staff: StaffContext | null): boolean {
	return Boolean(staff) && permissionsGrant(staff!.role, staff!.permissions, "see_all_cases");
}

/** Whoever holds the capability sees — and manages — every branch. */
export function canSeeAllBranches(staff: StaffContext | null): boolean {
	return Boolean(staff) && permissionsGrant(staff!.role, staff!.permissions, "see_all_branches");
}

/**
 * The branch-manager boundary on management writes (duty, delegation):
 * a see-all-branches actor — the general manager — manages any branch;
 * anyone else manages only the branch on their own staff record. That's
 * the whole difference between the two levels — one check.
 */
export function assertBranchScope(staff: StaffContext, branch: string | null | undefined): void {
	if (canSeeAllBranches(staff)) return;
	const own = staff.branch ? canonicalBranchId(staff.branch) : null;
	const target = branch ? canonicalBranchId(branch) : null;
	if (!own || !target || target !== own) {
		throw new HttpError(403, "FORBIDDEN", "You can only manage your own branch");
	}
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


/**
 * The case's state is derived from what happened: the client's consent
 * makes it Active — nobody "accepts" a case by hand. The two hand-set states
 * (ACTION_REQUIRED, REJECTED) are kept as stored.
 */
export function caseStatusOf(row: Pick<ApplicationRow, "status" | "proceedStatus">): CaseApplicationStatus {
	if (row.status === "UNDER_REVIEW" && row.proceedStatus === "accepted") return "ACCEPTED";
	return row.status;
}

async function serializeApplication(row: ApplicationRow, forApplicant = false): Promise<ApiApplication> {
	const [applicant, staff, comments, documentChecklist, preDepartureTasks] = await Promise.all([
		db.select().from(applicants).where(eq(applicants.id, row.applicantId)).limit(1).then((r) => r[0]),
		loadStaff(row.assignedStaffId),
		commentsFor("application", row.id, forApplicant),
		documentChecklistForApplication(row.id),
		resolvePreDepartureTasks(row),
	]);

	// Scoped to this application, not the applicant — an earlier application's
	// tracks must not appear on this one.
	const schoolList = await listSchoolsForApplication(row.id);
	// The recommendation, only until a plan is accepted — it pre-fills the builder.
	const assessmentForPlan =
		row.scopeStages || !row.consultationId
			? null
			: await db
					.select({ assessmentResult: consultations.assessmentResult })
					.from(consultations)
					.where(eq(consultations.id, row.consultationId))
					.limit(1)
					.then((r) => r[0]?.assessmentResult ?? null);

	const pendingHandoff = await pendingHandoffForApplication(row.id);
	// The journey coordinator rides on the applicant, not the case row.
	const journeyCoordinator = applicant?.coordinatorId ? await loadStaff(applicant.coordinatorId) : null;

	// Load consent status for all three stages so the portal can decide
	// whether to show the consent card.
	const { getStageConsent } = await import("./stageConsents.js");
	const [applicationConsent, visaConsent, travelConsent, travelAssistanceStatus] = await Promise.all([
		getStageConsent(row.id, "application"),
		getStageConsent(row.id, "visa"),
		getStageConsent(row.id, "travel"),
		getTravelAssistanceStatusForApplication(row.id),
	]);
	// The visa set is only asked once the chapter has opened.
	const visaDocumentChecklist =
		row.visaStage !== "locked" || visaConsent?.decision === "continue" ? await visaDocumentChecklistFor(applicant?.userId) : [];

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

	// A continuation request waiting on the office — the client asked to take
	// the stage beyond where the journey ended. The latest of any status
	// carries a decline's reason, and an approved one is what re-opened the
	// case — the stage's intake card keys off it.
	const { pendingContinuationFor, lastContinuationFor } = await import("./continuations.js");
	const [pendingContinuation, lastContinuation] = await Promise.all([
		row.stage === "completed" ? pendingContinuationFor(row.id) : Promise.resolve(null),
		lastContinuationFor(row.id),
	]).catch(() => [null, null] as const);

	return {
		id: row.id,
		appNumber: row.appNumber,
		applicantId: row.applicantId,
		applicantUserId: applicant?.userId ?? null,
		applicantName: applicant?.name ?? "",
		email: applicant?.email ?? "",
		phone: applicant?.phone ?? null,
		// The office that owns the case — a referral writes applications.branch;
		// unreferred cases are handled by the applicant's home office.
		branch: row.branch ?? applicant?.branch ?? "",
		university: row.university,
		program: row.program,
		country: row.country,
		degreeLevel: row.degreeLevel,
		assignedStaffId: row.assignedStaffId,
		assignedStaffName: staff?.name ?? null,
		assignedStaffEmail: staff?.email ?? null,
		journeyCoordinatorName: journeyCoordinator?.name ?? null,
		journeyCoordinatorEmail: journeyCoordinator?.email ?? null,
		stage: row.stage as JourneyStage,
		status: caseStatusOf(row),
		completedAtStage: row.completedAtStage ?? null,
		completionNote: row.completionNote ?? null,
		stageIntake: (row.stageIntake ?? {}) as ApiApplication["stageIntake"],
		pendingContinuation,
		lastContinuation,
		proceedStatus: row.proceedStatus,
		proceededAt: row.proceededAt?.toISOString() ?? null,
		declinedReason: row.declinedReason,
		fundingTrack: row.fundingTrack,
		scopeStages: row.scopeStages ?? null,
		plannedStages: plannedStagesFor({
			scopeStages: row.scopeStages ?? null,
			recStages: (assessmentForPlan as { recStages?: string[] } | null)?.recStages ?? null,
			entryIntent: (applicant?.profile as { entryIntent?: string } | null)?.entryIntent ?? null,
		}),
		targetSchoolCount: row.targetSchoolCount ?? null,
		acceptedSchoolId: row.acceptedSchoolId ?? null,
		offerAcceptedAt: row.offerAcceptedAt?.toISOString() ?? null,
		notes: row.notes,
		checklist: row.checklist ?? [],
		visaStage: row.visaStage,
		visaOutcome: (row.visaOutcome as "approved" | "refused" | null) ?? null,
		visaInvoicePaid: await visaCostsSettled(row),
		visaCounselorNote: row.visaCounselorNote,
		visaDetails: (row.visaDetails ?? {}) as ApiApplication["visaDetails"],
		departureDetails: (row.departureDetails ?? {}) as ApiApplication["departureDetails"],
		visaDocumentChecklist,
		paymentPlanId: row.paymentPlanId,
		postArrivalMonths: row.postArrivalMonths ?? null,
		postArrivalFrequency: row.postArrivalFrequency ?? null,
		postArrivalStatus: (row.postArrivalStatus as "pending" | "approved" | "declined" | null) ?? null,
		postArrivalStartAt: row.postArrivalStartAt?.toISOString() ?? null,
		postArrivalReviewedBy: row.postArrivalReviewedBy ?? null,
		postArrivalReviewedAt: row.postArrivalReviewedAt?.toISOString() ?? null,
		postArrivalDeclineReason: row.postArrivalDeclineReason ?? null,
		postArrivalInterestPct: row.postArrivalInterestPct ?? null,
		packageId: row.packageId,
		packageSelectedAt: row.packageSelectedAt?.toISOString() ?? null,
		agencyStageIndex: row.agencyStageIndex,
		agencySettled: row.agencySettled,
		depositPaid: row.depositPaid,
		appFeePaid: await applicationFeesSettled(row),
		travelInvoicePaid: row.travelInvoicePaid,
		requestedDocuments: row.requestedDocuments ?? [],
		documentChecklist,
		preDepartureTasks,
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
		.select({ stage: applications.stage, status: applications.status, proceedStatus: applications.proceedStatus, depositPaid: applications.depositPaid })
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
	// Enrolled is the deposit, Active is the client's consent — derived, never typed.
	const status =
		latestApp?.depositPaid
			? "Enrolled"
			: latestApp
				? caseStatusOf(latestApp) === "ACCEPTED" ? "Active" : "New"
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

	// The same sources the invoices are raised from: the package's price,
	// each school's own fee, the destination's visa costs.
	const schoolCount = draftRows.length;
	const appLines = await applicationFeeLinesFor(applicationId);
	const appSubtotalCents = appLines.reduce((n, l) => n + l.amountCents, 0);
	const [pkg] = app.packageId ? await db.select({ priceCents: servicePackages.priceCents }).from(servicePackages).where(eq(servicePackages.id, app.packageId)).limit(1) : [];
	const agencyFeeCents =
		pkg && pkg.priceCents > 0 ? pkg.priceCents : Math.round(serviceFeeFor((app.fundingTrack ?? "") as SchoolFundingTrack | "") * 100);
	const visaFeeCents = (await visaCostLinesFor(app)).reduce((n, l) => n + l.amountCents, 0);
	const extra = await activeFeeItem("extra_school");

	return {
		schoolCount,
		appBaseCents: 0,
		perSchoolCents: extra?.amountCents ?? 0,
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
				// The client said yes — the case is Active from this moment.
				status: row.status === "UNDER_REVIEW" ? ("ACCEPTED" satisfies CaseApplicationStatus) : row.status,
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

	// Refresh signal: ops activity feeds update live; the applicant's portal
	// syncs too when the comment is client-visible.
	let clientUserId: string | null = null;
	if (row.visibility === "applicant") {
		if (input.targetType === "application") {
			const [app] = await db
				.select({ applicantId: applications.applicantId })
				.from(applications)
				.where(eq(applications.id, input.targetId))
				.limit(1);
			const applicant = app ? await getApplicant(app.applicantId) : null;
			clientUserId = applicant?.userId ?? null;
		} else {
			clientUserId = await applicantUserIdOfConsultation(input.targetId);
		}
	}
	emitDomain(
		"case.updated",
		{ caseId: input.targetId, targetType: input.targetType, comment: true },
		{ ops: true, userId: clientUserId },
	);
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
	/**
	 * Coverage — `stage` staffs the current stage only (the seat re-opens when
	 * the chapter closes); `all` makes the handler carry the rest of the case.
	 * Default "all" preserves the historical whole-case-owner behaviour.
	 */
	scope?: "stage" | "all";
	/** Referral — move the file to this handling branch with the placement. */
	branch?: string;
	/**
	 * Handover note. Required when this placement replaces an active handler —
	 * the seat change must carry context forward to whoever takes over.
	 */
	reason?: string;
	actor: Actor;
}): Promise<ApplicationRow> {
	const row = await getApplication(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const scope = input.scope ?? "all";
	// A stage-only placement must hold a role that may own the stage they
	// will actually sit on — a paid deposit opens school_submission below,
	// so validate against that stage, not the one that is closing. The
	// whole-case handler is validated against the school-submission tier.
	const stageOpened = row.stage === "document_verification" && row.depositPaid;
	const targetStage = stageOpened ? "school_submission" : row.stage;
	const employee = await loadAssignableStaff(input.employeeId, scope === "stage" ? targetStage : "school_submission");

	const applicant = await getApplicant(row.applicantId);
	const referredBranch = input.branch ? canonicalBranchId(input.branch) : null;
	if (input.branch && !referredBranch) {
		throw new HttpError(400, "BRANCH_NOT_FOUND", `Unknown branch: ${input.branch}`);
	}

	// Branch consistency — a file placed with an officer of another office
	// must carry the referral that moves the file there. A branch-less staff
	// row (HQ floater) is exempt.
	const effectiveBranch = referredBranch ?? canonicalBranchId(row.branch);
	const employeeBranch = canonicalBranchId(employee.branch);
	if (employeeBranch && effectiveBranch && employeeBranch !== effectiveBranch) {
		throw new HttpError(
			409,
			"CASE_OTHER_BRANCH",
			`${employee.name} sits in ${employee.branch} but this file belongs to ${row.branch}. Refer the file to ${employee.branch} or pick a ${row.branch} officer.`,
		);
	}

	// Replacing an active handler requires the handover note — the comment and
	// the assignment record both carry it forward to the incoming handler.
	let replacedOpsUserId: string | null = null;
	if (scope === "all") {
		replacedOpsUserId = row.assignedStaffId;
	} else {
		const [seat] = await db
			.select({ opsUserId: stageAssignments.opsUserId })
			.from(stageAssignments)
			.where(
				and(
					eq(stageAssignments.applicationId, row.id),
					eq(stageAssignments.stage, targetStage),
					eq(stageAssignments.status, "active"),
				),
			)
			.limit(1);
		replacedOpsUserId = seat?.opsUserId ?? null;
	}
	if (replacedOpsUserId && replacedOpsUserId !== input.employeeId && !input.reason?.trim()) {
		throw new HttpError(
			400,
			"HANDOVER_NOTE_REQUIRED",
			"Replacing an active handler requires a handover note so the next handler knows what they are walking into.",
		);
	}

	// The handler change, the pending handoff it answers and any referral must
	// land together.
	const { setCaseOwner } = await import("./caseOwnership.js");
	const updated = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		if (scope === "all") {
			await setCaseOwner({
				applicationId: row.id,
				opsUserId: input.employeeId,
				assignedBy: input.actor.opsUserId,
				note: input.reason,
				tx: txDb,
			});
		}
		if (referredBranch) {
			await txDb
				.update(applications)
				.set({ branch: referredBranch, updatedAt: new Date() })
				.where(eq(applications.id, row.id));
		}

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

	// Stage-only coverage seats them on the stage the case is actually in —
	// after the document_verification → school_submission advance above, not
	// before it, or the assignment would cover a stage that just closed.
	if (scope === "stage") {
		const { assignStageOfficer } = await import("./communication.js");
		await assignStageOfficer({
			applicationId: row.id,
			stage: stageOpened ? "school_submission" : row.stage,
			opsUserId: input.employeeId,
			assignedBy: input.actor.opsUserId,
			reason: input.reason ?? (input.branch ? `stage handler · referred to ${referredBranch}` : "stage handler"),
			scope: "stage",
		});
	}

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
		text: `Assigned to ${employee.name}${scope === "stage" ? " — this stage only" : " — carries the rest of the case"}${referredBranch ? ` · file referred to ${referredBranch}` : ""}${input.reason ? ` — ${input.reason}` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	// The outgoing handler hears about a replacement — the seat should never
	// just disappear from their queue without a word.
	if (replacedOpsUserId && replacedOpsUserId !== input.employeeId) {
		const outgoingUserId = await getStaffUserId(replacedOpsUserId);
		if (outgoingUserId) {
			notify({
				recipientUserId: outgoingUserId,
				type: "assignment.released",
				title: "Case reassigned",
				body: `${updated.appNumber}'s handler seat moved to ${employee.name}.${input.reason ? ` ${input.reason}` : ""}`,
				link: "/applications",
			}).catch(() => {});
		}
	}

	// Notify the assigned staff member by email and in-app.
	const staffUserId = await getStaffUserId(employee.id);
	if (applicant) {
		try {
			await queueEmails([
				mail.caseAssigned({
					entityId: updated.id,
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
					entityId: updated.id,
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

/**
 * Refer a case to another handling branch without placing a handler — the
 * receiving desk staffs it from their own queue. The branch is the office
 * that owns the file, not the client's location; a Kumasi client can be
 * handled by Accra without rewriting their applicant record.
 */
export async function referApplicationBranch(input: {
	id: string;
	branch: string;
	note?: string;
	actor: Actor;
}): Promise<ApplicationRow> {
	const row = await getApplication(input.id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const branch = canonicalBranchId(input.branch);
	if (!branch) throw new HttpError(400, "BRANCH_NOT_FOUND", `Unknown branch: ${input.branch}`);

	const [updated] = await db
		.update(applications)
		.set({ branch, updatedAt: new Date() })
		.where(eq(applications.id, row.id))
		.returning();

	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "assignment",
		text: `Referred to ${branch}${input.note ? ` — ${input.note}` : ""}`,
		authorName: input.actor.name,
		authorOpsUserId: input.actor.opsUserId,
	});

	// Tell the receiving desk's managers a file landed in their queue.
	const recipients = await getManagerAndCoordinatorUserIds();
	await notifyMany(
		recipients.map((r) => ({
			recipientUserId: r.userId,
			type: "case.updated",
			title: "Case referred to a branch",
			body: `${row.appNumber} was referred to ${branch}${input.note ? ` — ${input.note}` : ""}`,
			link: `/applications?id=${row.id}`,
		})),
	).catch(() => {});

	await broadcastCaseUpdate(updated, input.actor);
	return updated;
}

export type PatchApplicationInput = z.infer<typeof patchApplicationSchema>;

/**
 * Refresh signal for a case mutation — a domain event, not a notification.
 *
 * Replaces the old notifyMany() fan-out: it wrote a bell row and queued a
 * web push for every manager on every field edit, so the bell filled with
 * "Case updated" noise whose only real purpose was moving screens. Now it
 * publishes once to `ops:events` (every open console refetches) and to the
 * applicant's own channel (the portal re-syncs its journey). Anything that
 * deserves a bell entry calls notify() explicitly at its own site.
 */
async function broadcastCaseUpdate(application: ApplicationRow, actor: Actor): Promise<void> {
	try {
		const applicant = await getApplicant(application.applicantId);
		emitDomain(
			"case.updated",
			{
				caseId: application.id,
				appNumber: application.appNumber,
				stage: application.stage,
				actor: actor.name,
			},
			{ ops: true, userId: applicant?.userId ?? null },
		);
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
				title: "Chapter has no handler",
				body: `${JOURNEY_STAGE_LABELS[stage]} on ${app?.appNumber ?? "a case"} has no handler.`,
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
	if (input.notes !== undefined) set.notes = input.notes;
	if (input.targetSchoolCount !== undefined) set.targetSchoolCount = input.targetSchoolCount;

	if (Object.keys(set).length <= 1) return row;

	const [updated] = await db
		.update(applications)
		.set(set)
		.where(eq(applications.id, id))
		.returning();

	// Ops changed the plan: the invoice follows it, as it does for the client.
	if (input.paymentPlanId !== undefined && input.paymentPlanId && input.paymentPlanId !== row.paymentPlanId) {
		const { reshapeAgencyInvoiceForPlan } = await import("./serviceFee.js");
		await reshapeAgencyInvoiceForPlan(id, input.paymentPlanId);
	}

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

/**
 * The visa invoice is money paid on the client's behalf: the destination's
 * visa fee and its biometrics fee, at cost. The destination is the accepted
 * school's country; before an offer is accepted, the country on the case.
 */
export async function visaCostLinesFor(app: ApplicationRow): Promise<{ label: string; detail: string; amountCents: number }[]> {
	let dest: { id: string; name: string; visaFeeCents: number; biometricsFeeCents: number } | undefined;
	if (app.acceptedSchoolId) {
		const [row] = await db
			.select({ id: destinations.id, name: destinations.name, visaFeeCents: destinations.visaFeeCents, biometricsFeeCents: destinations.biometricsFeeCents })
			.from(schoolApplications)
			.innerJoin(destinations, eq(destinations.id, schoolApplications.destinationId))
			.where(eq(schoolApplications.id, app.acceptedSchoolId))
			.limit(1);
		dest = row;
	}
	if (!dest && app.country) {
		const [row] = await db
			.select({ id: destinations.id, name: destinations.name, visaFeeCents: destinations.visaFeeCents, biometricsFeeCents: destinations.biometricsFeeCents })
			.from(destinations)
			.where(or(ilike(destinations.name, app.country), eq(destinations.id, app.country.toLowerCase())))
			.limit(1);
		dest = row;
	}
	if (!dest) return [];
	const lines: { label: string; detail: string; amountCents: number }[] = [];
	if (dest.visaFeeCents > 0) lines.push({ label: `${dest.name} visa fee`, detail: "Paid to the embassy on your behalf, at cost", amountCents: dest.visaFeeCents });
	if (dest.biometricsFeeCents > 0) lines.push({ label: `${dest.name} biometrics fee`, detail: "Paid to the visa centre on your behalf, at cost", amountCents: dest.biometricsFeeCents });
	return lines;
}

/**
 * Whether the application fees are settled — paid, or nothing due. The
 * `app_fee_paid` column is derived by the ledger trigger from paid invoices
 * alone, so "nothing due" (no school charges a fee, no add-on) has to be
 * read from the catalogue every time; a flag would be undone by the next
 * invoice change. Every gate reads this, not the column.
 */
export async function applicationFeesSettled(row: { id: string; appFeePaid: boolean }): Promise<boolean> {
	if (row.appFeePaid) return true;
	// "Nothing due" was recorded when the fees were raised and there were none —
	// and still holds only while the chosen schools charge nothing.
	return (await nothingDueRecorded(row.id, NOTHING_DUE_TEXT)) && (await applicationFeeLinesFor(row.id)).length === 0;
}

/** Whether the visa costs are settled — paid, or recorded as none for the destination (and still none). */
export async function visaCostsSettled(row: ApplicationRow): Promise<boolean> {
	if (row.visaInvoicePaid) return true;
	return (await nothingDueRecorded(row.id, VISA_NOTHING_DUE_TEXT)) && (await visaCostLinesFor(row)).length === 0;
}

async function nothingDueRecorded(applicationId: string, text: string): Promise<boolean> {
	const [row] = await db
		.select({ id: caseComments.id })
		.from(caseComments)
		.where(and(eq(caseComments.targetId, applicationId), eq(caseComments.text, text)))
		.limit(1);
	return Boolean(row);
}

/** No application fees for the chosen schools: nothing to invoice, submissions can start. Recorded once, for the client. */
export async function markApplicationFeesNotDue(applicationId: string, byName: string): Promise<void> {
	const [already] = await db
		.select({ id: caseComments.id })
		.from(caseComments)
		.where(and(eq(caseComments.targetId, applicationId), eq(caseComments.text, NOTHING_DUE_TEXT)))
		.limit(1);
	if (already) return;
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: applicationId,
		kind: "status",
		visibility: "applicant",
		text: NOTHING_DUE_TEXT,
		authorName: byName,
		authorOpsUserId: null,
	});
}
const NOTHING_DUE_TEXT = "No university application fees are due for the chosen schools — nothing to pay before submissions start.";
const VISA_NOTHING_DUE_TEXT = "No visa costs are recorded for this destination — nothing to pay before visa processing starts.";

/** Auto-raise the visa costs when entering visa_processing with no visa invoice — or record that none are due. */
async function raiseVisaInvoiceForApplication(
	app: ApplicationRow,
	applicant: ApplicantRow,
	actor: { opsUserId?: string | null; name: string; email: string },
): Promise<void> {
	const clientUserId = applicant.userId ?? undefined;
	const lines = await visaCostLinesFor(app);
	if (lines.length === 0) {
		await db.insert(caseComments).values({
			targetType: "application",
			targetId: app.id,
			kind: "status",
			visibility: "applicant",
			text: VISA_NOTHING_DUE_TEXT,
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId ?? null,
		});
		return;
	}
	await createInvoice({
		data: {
			applicantName: applicant.name,
			applicantEmail: applicant.email ?? undefined,
			clientUserId,
			applicationId: app.id,
			type: "visa",
			status: "proforma",
			lines,
			note: "Visa costs paid on your behalf, at cost.",
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

/**
 * Why this case may end where it is: a recorded opt-out on a stage consent,
 * the enrolment decline, or a note the handler wrote into the completion.
 * Null when nothing explains an early finish — then the ordinary gates rule.
 */
async function completionStopReason(row: ApplicationRow, note?: string): Promise<string | null> {
	const { getStageConsent } = await import("./stageConsents.js");
	const [visaConsent, travelConsent] = await Promise.all([getStageConsent(row.id, "visa"), getStageConsent(row.id, "travel")]);
	if (visaConsent?.decision === "opt_out") return `Client opted out of the Visa stage${visaConsent.reason ? `: ${visaConsent.reason}` : "."}`;
	if (travelConsent?.decision === "opt_out") return `Client opted out of the Departure stage${travelConsent.reason ? `: ${travelConsent.reason}` : "."}`;
	if (row.proceedStatus === "declined") return `Client declined to proceed${row.declinedReason ? `: ${row.declinedReason}` : "."}`;
	return note?.trim() || null;
}

export async function setApplicationStage(
	id: string,
	stage: JourneyStage,
	actor: Actor,
	note?: string,
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
	// A visa or departure entry brought its own offer, verified at consultation.
	const hasAdmitted = schoolTracks.schools.some((s) => s.outcome === "Admitted") || (row.scopeStages != null && !scopeHas(row.scopeStages, "admissions"));
	const hasVisaInvoice = clientInvoices.some((i) => i.type === "visa");

	// ── A plan that stops short completes at its exit ───────────────────
	// Admissions only is done at the offer; a plan ending at Visa is done at
	// the approval. Neither has a flight, a checklist or an arrival to wait
	// for, so `completed` is reached straight from the exit stage.
	const scopeNow = row.scopeStages ? normaliseScope(row.scopeStages) : null;
	if (stage === "completed" && scopeNow && !scopeNow.includes("departure")) {
		// The same function the ops next-action renders from.
		const step = nextStepFor({
			scopeStages: scopeNow,
			stage: row.stage,
			checks: { visaDone: row.visaStage === "complete" && row.visaOutcome === "approved", agencySettled: row.agencySettled, hasAdmitted },
		});
		if (step.kind === "complete") return finishAdvance(row, stage, actor, applicant);
		// Not at the plan's exit — a recorded stop can still complete the case
		// at the reached stage via the early-completion path below.
		if (!(await completionStopReason(row, note))) {
			throw new HttpError(409, "STAGE_ADVANCE_BLOCKED", `Cannot complete: ${step.kind === "blocked" ? step.reason : "the case is not at its exit stage"}.`);
		}
	}

	// ── Complete where the client stopped ────────────────────────────────
	// A client who opted out of the next stage (or whom ops is closing for,
	// with a note) can be marked complete at the last stage whose exit fact
	// holds — and the ledger is pruned to what was delivered, so a stage
	// that never opened stops being billed. No stop signal: fall through to
	// the ordinary gates (a full-plan finish needs the whole checklist).
	if (stage === "completed" && row.stage !== "completed") {
		const stopReason = await completionStopReason(row, note);
		if (stopReason) {
			const reached: ServiceStage | null = isTravelResolved(travelAssistanceStatus)
				? "departure"
				: row.visaStage === "complete" && row.visaOutcome === "approved"
					? "visa"
					: hasAdmitted
						? "admissions"
						: null;
			if (!reached) {
				throw new HttpError(
					409,
					"STAGE_ADVANCE_BLOCKED",
					"Cannot complete: no stage's work is finished yet. A case completes at a finished stage, never inside an open one.",
				);
			}
			// Trim the plan to what was delivered. Removing a stage that never
			// opened prunes its unfired lines; an opened stage still owed
			// refuses here, so completion never closes with money hanging.
			const keptScope = scopeNow
				? scopeNow.filter((s) => (SERVICE_STAGES as readonly string[]).indexOf(s) <= (SERVICE_STAGES as readonly string[]).indexOf(reached))
				: null;
			if (keptScope && scopeNow && keptScope.length < scopeNow.length) {
				await setApplicationPackage({
					id,
					packageCode: row.fundingTrack,
					degreeLevel: row.degreeLevel,
					stages: keptScope,
					actor: { name: actor.name, opsUserId: actor.opsUserId, reason: `Completed early — ended at ${SERVICE_STAGE_LABELS[reached]}` },
					internal: true,
				});
			}
			// Belt and braces after the prune: nothing due may still be owed.
			const open = clientInvoices.filter((i) => i.status === "issued" || i.status === "partial");
			for (const inv of open) {
				const [lines, paidRow] = await Promise.all([
					db.select({ dueAt: invoiceLines.dueAt, amountCents: invoiceLines.amountCents }).from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)),
					db.select({ total: sql<number>`coalesce(sum(amount_cents), 0)::int` }).from(invoicePayments).where(eq(invoicePayments.invoiceId, inv.id)),
				]);
				const dueCents = lines.filter((l) => l.dueAt != null).reduce((n, l) => n + l.amountCents, 0);
				if (dueCents > (paidRow[0]?.total ?? 0)) {
					throw new HttpError(409, "INVOICE_OUTSTANDING", `Cannot complete: ${inv.invoiceNumber} has an amount due — settle, void, or write it off first.`);
				}
			}

			const [updated] = await db
				.update(applications)
				.set({ stage: "completed", completedAtStage: reached, completionNote: stopReason, updatedAt: new Date() })
				.where(and(eq(applications.id, id), ne(applications.stage, "completed")))
				.returning();
			if (!updated) return row;

			await db.insert(caseComments).values({
				targetType: "application",
				targetId: id,
				kind: "status",
				text: `Stage → completed · ended at ${SERVICE_STAGE_LABELS[reached]} — ${stopReason}`,
				authorName: actor.name,
				authorOpsUserId: actor.opsUserId,
			});
			markStageCompleted(id, row.stage, actor.opsUserId);
			const clientUserId = await applicantUserIdOfApplication(id);
			if (clientUserId) {
				notify({
					recipientUserId: clientUserId,
					type: "stage.changed",
					title: "Your journey is complete",
					body: `Your file closed at ${SERVICE_STAGE_LABELS[reached]}. Everything you paid for stays yours — and you can pick up the next stage any time.`,
					link: "/portal/complete",
				}).catch(() => {});
			}
			await broadcastCaseUpdate(updated, actor);
			return updated;
		}
	}

	// ── Guard: the stage must be on the client's plan ───────────────────
	// A case that bought Admissions only stops at the offer; the next
	// chapter is sold, not opened. A legacy case (no scope) is the full journey.
	const needed = serviceStageForJourney(stage);
	if (needed && row.scopeStages && !normaliseScope(row.scopeStages).includes(needed)) {
		throw new HttpError(
			409,
			"STAGE_NOT_IN_PLAN",
			`Cannot advance to ${JOURNEY_STAGE_LABELS[stage]}: the ${SERVICE_STAGE_LABELS[needed]} stage is not on the client's plan (${scopeLabel(row.scopeStages)}). Extend the plan first.`,
		);
	}

	// ── Guard: adjacency + completion + per-stage prerequisites ────────
	const adjacencyReason = canAdvanceToStage(row.stage, stage, {
		visaStage: row.visaStage,
		agencySettled: row.agencySettled,
		agencyStageIndex: row.agencyStageIndex,
		appFeePaid: await applicationFeesSettled(row),
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

	// The visa invoice is the officer's to raise from the case — nothing
	// raises itself on a stage move.

	return finishAdvance(row, stage, actor, applicant);
}

/** The write half of a stage advance: the row, the trail, the client, the handoff. */
async function finishAdvance(
	row: ApplicationRow,
	stage: JourneyStage,
	actor: Actor,
	applicant: Awaited<ReturnType<typeof getApplicant>>,
): Promise<ApplicationRow> {
	const id = row.id;
	const [updated] = await db
		.update(applications)
		.set({ stage, updatedAt: new Date() })
		.where(eq(applications.id, id))
		.returning();
	if (stage === "travel_assistance") await seedPreDepartureTasks(id);
	// The visa file opening makes the Visa stage's milestone due.
	if (stage === "visa_processing" && row.stage !== "visa_processing") {
		const { fireDueTrigger } = await import("./serviceFee.js");
		await fireDueTrigger(id, "visa_open");
	}
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
					entityId: row.id,
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
		appFeePaid: await applicationFeesSettled(row),
		paymentPlanId: row.paymentPlanId,
		preDepartureTasks: await resolvePreDepartureTasks(row),
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

/* ── Visa facts ────────────────────────────────────────────────────────── */

const VISA_DATE = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const VISA_DATETIME = (iso: string) =>
	new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** A patch merged over the stored facts: `undefined` leaves a field, `null` clears it. */
function mergeVisaDetails(current: VisaDetails | null | undefined, patch: VisaDetails | undefined): VisaDetails {
	const next: VisaDetails = { ...(current ?? {}) };
	for (const [k, v] of Object.entries(patch ?? {}) as [keyof VisaDetails, VisaDetails[keyof VisaDetails]][]) {
		if (v === undefined) continue;
		if (v === null || v === "") delete next[k];
		else next[k] = v as never;
	}
	return next;
}

/** One line per fact recorded — what the case history says about this change. */
function describeVisaDetails(patch: VisaDetails | undefined, merged: VisaDetails): string[] {
	const lines: string[] = [];
	if (!patch) return lines;
	if (patch.visaType !== undefined || patch.reference !== undefined || patch.submittedAt !== undefined) {
		const bits = [merged.visaType, merged.reference ? `ref ${merged.reference}` : null, merged.submittedAt ? `lodged ${VISA_DATE(merged.submittedAt)}` : null].filter(Boolean);
		lines.push(`Visa application — ${bits.length ? bits.join(" · ") : "details cleared"}`);
	}
	if (patch.appointmentAt !== undefined || patch.appointmentCentre !== undefined) {
		lines.push(
			merged.appointmentAt
				? `Visa appointment — ${VISA_DATETIME(merged.appointmentAt)}${merged.appointmentCentre ? ` · ${merged.appointmentCentre}` : ""}`
				: "Visa appointment cleared",
		);
	}
	if (patch.biometricsAt !== undefined) lines.push(merged.biometricsAt ? `Biometrics given — ${VISA_DATE(merged.biometricsAt)}` : "Biometrics date cleared");
	if (patch.decidedAt !== undefined) lines.push(merged.decidedAt ? `Visa decision received — ${VISA_DATE(merged.decidedAt)}` : "Decision date cleared");
	if (patch.validFrom !== undefined || patch.validTo !== undefined) {
		lines.push(
			merged.validFrom || merged.validTo
				? `Visa valid ${merged.validFrom ? VISA_DATE(merged.validFrom) : "…"} → ${merged.validTo ? VISA_DATE(merged.validTo) : "…"}`
				: "Visa validity cleared",
		);
	}
	if (patch.collectedAt !== undefined) lines.push(merged.collectedAt ? `Passport / permit collected — ${VISA_DATE(merged.collectedAt)}` : "Collection date cleared");
	return lines;
}

/** Record visa facts without moving the stage — the reference, the appointment, validity. */
/* ── Departure facts ───────────────────────────────────────────────────── */

function mergeDepartureDetails(current: DepartureDetails | null | undefined, patch: DepartureDetails): DepartureDetails {
	const next: DepartureDetails = { ...(current ?? {}) };
	for (const [k, v] of Object.entries(patch) as [keyof DepartureDetails, DepartureDetails[keyof DepartureDetails]][]) {
		if (v === undefined) continue;
		if (v === null || v === "") delete next[k];
		else next[k] = v as never;
	}
	return next;
}

function describeDepartureDetails(patch: DepartureDetails, merged: DepartureDetails): string[] {
	const lines: string[] = [];
	if (patch.reportBy !== undefined) lines.push(merged.reportBy ? `Report to the school by ${VISA_DATE(merged.reportBy)}` : "Report-by date cleared");
	if (patch.orientationAt !== undefined) lines.push(merged.orientationAt ? `Orientation — ${VISA_DATE(merged.orientationAt)}` : "Orientation date cleared");
	if (patch.briefingAt !== undefined) lines.push(merged.briefingAt ? `Pre-departure briefing — ${VISA_DATETIME(merged.briefingAt)}` : "Briefing date cleared");
	if (patch.pickupBy !== undefined || patch.pickupNote !== undefined) {
		lines.push(merged.pickupBy ? `Airport pickup — ${merged.pickupBy}${merged.pickupNote ? ` · ${merged.pickupNote}` : ""}` : "Airport pickup cleared");
	}
	if (patch.accommodationAddress !== undefined || patch.accommodationMoveInAt !== undefined) {
		lines.push(
			merged.accommodationAddress || merged.accommodationMoveInAt
				? `Accommodation — ${merged.accommodationAddress ?? "address to follow"}${merged.accommodationMoveInAt ? ` · from ${VISA_DATE(merged.accommodationMoveInAt)}` : ""}`
				: "Accommodation cleared",
		);
	}
	if (patch.emergencyContactName !== undefined || patch.emergencyContactPhone !== undefined || patch.emergencyContactRelation !== undefined) {
		lines.push(
			merged.emergencyContactName
				? `Emergency contact abroad — ${merged.emergencyContactName}${merged.emergencyContactRelation ? ` (${merged.emergencyContactRelation})` : ""}${merged.emergencyContactPhone ? ` · ${merged.emergencyContactPhone}` : ""}`
				: "Emergency contact cleared",
		);
	}
	if (patch.arrivedAt !== undefined) lines.push(merged.arrivedAt ? `Arrived — ${VISA_DATE(merged.arrivedAt)}` : "Arrival date cleared");
	return lines;
}

/**
 * Record Departure facts. Recording the briefing closes the briefing item
 * and recording the pickup closes the pickup item — the fact is the tick.
 */
export async function updateDepartureDetails(id: string, patch: DepartureDetails, actor: Actor): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const merged = mergeDepartureDetails(row.departureDetails, patch);
	const now = new Date().toISOString();
	const tasks = ((row.preDepartureTasks ?? []) as PreDepartureTask[]).map((t) => {
		if (t.id === "pd-briefing" && patch.briefingAt !== undefined) {
			return merged.briefingAt ? { ...t, done: true, doneBy: t.done ? t.doneBy : actor.name, doneAt: t.done ? t.doneAt : now } : { ...t, done: false, doneBy: null, doneAt: null };
		}
		return t;
	});
	const [updated] = await db
		.update(applications)
		.set({ departureDetails: merged, preDepartureTasks: tasks, updatedAt: new Date() })
		.where(eq(applications.id, id))
		.returning();
	// Arrival recorded: the post-arrival instalments take their dates from it.
	if (patch.arrivedAt !== undefined) {
		const { refreshPostArrivalDates, fireDueTrigger } = await import("./serviceFee.js");
		await refreshPostArrivalDates(id);
		if (merged.arrivedAt) await fireDueTrigger(id, "arrival");
	}
	const lines = describeDepartureDetails(patch, merged);
	if (lines.length > 0) {
		await db.insert(caseComments).values({
			targetType: "application",
			targetId: id,
			kind: "status",
			visibility: "applicant",
			text: lines.join("\n"),
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId,
		});
		const clientUserId = await applicantUserIdOfApplication(id);
		if (clientUserId && (patch.briefingAt || patch.pickupBy || patch.reportBy)) {
			notify({
				recipientUserId: clientUserId,
				type: "stage.changed",
				title: "Before you fly",
				body: lines[0],
				link: "/portal/pre-departure",
			}).catch(() => {});
		}
	}
	await broadcastCaseUpdate(updated, actor);
	return updated;
}

export async function updateVisaDetails(id: string, patch: VisaDetails, actor: Actor): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const merged = mergeVisaDetails(row.visaDetails, patch);
	const [updated] = await db
		.update(applications)
		.set({ visaDetails: merged, updatedAt: new Date() })
		.where(eq(applications.id, id))
		.returning();
	const lines = describeVisaDetails(patch, merged);
	if (lines.length > 0) {
		await db.insert(caseComments).values({
			targetType: "application",
			targetId: id,
			kind: "status",
			visibility: "applicant",
			text: lines.join("\n"),
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId,
		});
		const clientUserId = await applicantUserIdOfApplication(id);
		if (clientUserId && patch.appointmentAt) {
			notify({
				recipientUserId: clientUserId,
				type: "visa.stage_changed",
				title: "Visa appointment",
				body: lines.find((l) => l.startsWith("Visa appointment")) ?? lines[0],
				link: "/portal/visa/tracking",
			}).catch(() => {});
		}
	}
	await broadcastCaseUpdate(updated, actor);
	return updated;
}

export async function setApplicationVisaStage(
	id: string,
	stage: ApplicationRow["visaStage"],
	note: string | undefined,
	actor: Actor,
	outcome?: "approved" | "refused",
	details?: VisaDetails,
): Promise<ApplicationRow> {
	const row = await getApplication(id);
	if (!row) throw new HttpError(404, CASE_ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found");
	const mergedDetails = mergeVisaDetails(row.visaDetails, details);

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
		const hasPaidVisaInvoice =
			clientInvoices.some((i) => i.type === "visa" && i.status === "paid") || (await visaCostsSettled(row));
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
			// A refusal reason becomes the note the client reads; a reason for a
			// plain move (a step back, a reopen) stays in the history only.
			visaCounselorNote: outcome ? (note ?? row.visaCounselorNote) : row.visaCounselorNote,
			visaDetails: mergedDetails,
			updatedAt: new Date(),
		})
		.where(eq(applications.id, id))
		.returning();
	// Approval makes the pre-departure milestone (or the Departure stage) due.
	if (visaOutcome === "approved" && row.visaOutcome !== "approved") {
		const { fireDueTrigger } = await import("./serviceFee.js");
		await fireDueTrigger(id, "visa_approved");
	}
	const factLines = describeVisaDetails(details, mergedDetails);
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: id,
		kind: "status",
		// The milestone — and a decision's reason — is the client's to read;
		// the reason for a plain move (a step back, a reopen) is staff-only.
		visibility: "applicant",
		text: [
			visaOutcome === "refused"
				? `Visa refused${note ? ` — ${note}` : ""}`
				: visaOutcome === "approved"
					? `Visa approved${note ? ` — ${note}` : ""}`
					: `Visa stage → ${VISA_STAGE_LABELS[stage] ?? stage}`,
			...factLines,
		].join("\n"),
		authorName: actor.name,
		authorOpsUserId: actor.opsUserId,
	});
	if (!visaOutcome && note) {
		await db.insert(caseComments).values({
			targetType: "application",
			targetId: id,
			kind: "status",
			text: `Visa stage → ${VISA_STAGE_LABELS[stage] ?? stage} — ${note}`,
			authorName: actor.name,
			authorOpsUserId: actor.opsUserId,
		});
	}

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

	if (stage === "complete") {
		markStageCompleted(id, "visa_processing", actor.opsUserId);
		// Departure opens with the approval: the checklist is seeded now.
		await seedPreDepartureTasks(id);
	}

	await broadcastCaseUpdate(updated, actor);
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

import { serviceFeeForPackage } from "century-nit-core/content";
import { nextInvoiceNumber, nextUncoveredDueAt } from "./invoice.js";
import { milestoneSplit, stagePricesFor } from "./fees.js";

type PackageOutcome = { application: ApplicationRow; proformaInvoice: typeof invoices.$inferSelect | null };

/**
 * Ops recorded, extended or reduced the plan on the client's behalf: say so,
 * in-app and by email, with the note they gave. A client should never learn
 * their plan changed from an invoice. Never throws.
 */
async function notifyPlanChangedByOps(app: ApplicationRow, change: "recorded" | "extended" | "reduced", planLabel: string, actor: { name: string; reason?: string | null }): Promise<void> {
	try {
		const [who] = await db
			.select({ userId: applicants.userId, name: applicants.name, email: applicants.email })
			.from(applicants)
			.where(eq(applicants.id, app.applicantId))
			.limit(1);
		if (!who) return;
		if (who.userId) {
			await notify({
				recipientUserId: who.userId,
				type: "plan.updated",
				title: `Your plan was ${change}: ${planLabel}`,
				body: `${actor.name} ${change} your plan on your behalf${actor.reason ? ` — “${actor.reason}”` : ""}. Your service-fee invoice reflects it.`,
				link: "/portal/package",
				entityType: "case",
				entityId: app.id,
			});
		}
		if (who.email) {
			await queueEmails([
				mail.planUpdatedForClient({
					entityId: app.id,
					clientName: who.name ?? "there",
					clientEmail: who.email,
					appNumber: app.appNumber,
					change,
					planLabel,
					byName: actor.name,
					reason: actor.reason ?? null,
				}),
			]);
		}
	} catch (err) {
		console.warn("[cases] plan-changed notification failed:", err);
	}
}

/** Which stage an agency line pays for — from its label; null on a full-journey split line. */
function lineStage(l: { label: string }): ServiceStage | null {
	if (l.label.startsWith("Admissions")) return "admissions";
	if (l.label === "Visa") return "visa";
	if (l.label.startsWith("Departure")) return "departure";
	return null;
}

/**
 * Bind the client's plan: the track (package), the stages on it, the
 * degree level and the school allowance — and raise the service fee the
 * way the ledger carries it, one agency invoice whose lines are the
 * milestones.
 *
 * The fee is `quoteTotal` from shared, so the portal, the ops sheet and
 * this raise price identically. What happens to an existing invoice
 * depends on whether money is on it:
 *
 *  - nothing paid: it is voided and a fresh one raised for the new plan;
 *  - paid in part or full: the plan can only *grow*. Added stages are
 *    appended as lines (a bundle completed this way gets its discount off
 *    the last added line), the track cannot change, stages cannot be
 *    removed. Void the invoice by hand to start over.
 *
 * Acceptance milestones fall due now; every other line waits for its case
 * event (`fireDueTrigger`).
 */
export async function setApplicationPackage(input: {
	id: string;
	/** The track. Required when Admissions is on the plan; a visa or departure entry has none. */
	packageCode?: string | null;
	degreeLevel: string;
	targetSchoolCount?: number;
	/** The stages on the plan; omitted means the full journey. */
	stages?: readonly string[];
	/** Who is choosing — the client, or ops on their behalf (with a reason). */
	actor?: { name: string; opsUserId?: string | null; reason?: string | null };
	/**
	 * System-initiated reshape (an early completion pruning the plan, a
	 * continuation approval extending it) — skips the client-facing
	 * eligibility and consent gates; the caller's own gate already ran.
	 */
	internal?: boolean;
}): Promise<PackageOutcome> {
	const scope = normaliseScope(input.stages ?? SERVICE_STAGES);
	const split = await milestoneSplit();
	const actorName = input.actor?.name ?? "Applicant";
	const onBehalf = input.actor?.opsUserId ? ` — recorded by ${actorName}${input.actor.reason ? ` (${input.actor.reason})` : ""}` : "";

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
		if (!input.internal && (!eligible || consultation?.status !== "COMPLETED")) {
			throw new HttpError(403, "CONSULTATION_NOT_ELIGIBLE", "Package selection requires a completed, eligible consultation");
		}

		// Consent gate: the applicant must have explicitly accepted to proceed
		// before a package can be selected. Consent is a separate step.
		if (!input.internal && app.proceedStatus !== "accepted") {
			throw new HttpError(409, "CONSENT_REQUIRED", "The applicant must consent to proceed before selecting a package.");
		}

		const needsTrack = scope.includes("admissions");
		const code = input.packageCode && input.packageCode !== "undecided" ? input.packageCode : null;
		if (needsTrack && !code) throw new HttpError(400, "TRACK_REQUIRED", "Choose a track — Admissions is on the plan.");
		const [pkg] = code
			? await tx
					.select()
					.from(servicePackages)
					.where(eq(servicePackages.code, code as any))
					.limit(1)
			: [];
		if (code && !pkg) throw new HttpError(404, "PACKAGE_NOT_FOUND", "Package not found");
		if (pkg && !pkg.active) throw new HttpError(400, "PACKAGE_INACTIVE", "Package is no longer available");

		const targetSchools = input.targetSchoolCount ?? app.targetSchoolCount ?? 3;
		// A row finance has not priced yet falls back to the legacy table.
		const bundleCents = pkg ? (pkg.priceCents > 0 ? pkg.priceCents : Math.round(serviceFeeForPackage(input.degreeLevel, code!, targetSchools))) : 0;
		// Admissions by track, Visa and Departure flat from the catalogue.
		const stagePrices = await stagePricesFor(pkg ? { priceCents: bundleCents, stagePrices: pkg.stagePrices ?? null } : null);
		const quote = quoteTotal({ bundleCents, stagePrices, stages: scope });
		const planName = pkg ? pkg.name : scopeLabel(scope);

		// The live agency invoice and what is on it.
		const [live] = await tx
			.select()
			.from(invoices)
			.where(and(eq(invoices.applicationId, app.id), eq(invoices.type, "agency"), ne(invoices.status, "void")))
			.orderBy(desc(invoices.createdAt))
			.limit(1);
		const [paidRow] = live
			? await tx.select({ total: sql<number>`coalesce(sum(amount_cents), 0)::int` }).from(invoicePayments).where(eq(invoicePayments.invoiceId, live.id))
			: [{ total: 0 }];
		const paidCents = paidRow?.total ?? 0;
		// The scope the ledger knows: only once a plan was accepted (the invoice
		// exists). Before that the row's scope is the recommendation.
		const prevScope = live ? (app.scopeStages ? normaliseScope(app.scopeStages) : [...SERVICE_STAGES]) : [];

		const bind = async () => {
			const [updated] = await tx
				.update(applications)
				.set({
					packageId: pkg?.id ?? null,
					packageSelectedAt: app.packageSelectedAt ?? new Date(),
					// "undecided" is the enum's own word for "no track" — a visa or departure entry.
					fundingTrack: code ?? "undecided",
					degreeLevel: input.degreeLevel,
					targetSchoolCount: targetSchools,
					scopeStages: scope,
					updatedAt: new Date(),
				})
				.where(eq(applications.id, app.id))
				.returning();
			return updated;
		};

		// ── Money on the ledger: the plan can only grow ─────────────────
		if (live && paidCents > 0) {
			if ((app.packageId ?? null) !== (pkg?.id ?? null)) {
				throw new HttpError(409, "PACKAGE_LOCKED", "Payments are recorded on the current plan — the track cannot change. Void the service-fee invoice to start over.");
			}
			const removed = prevScope.filter((st) => !scope.includes(st));
			const existing = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, live.id)).orderBy(invoiceLines.position);
			let removedCents = 0;
			if (removed.length > 0) {
				// A stage that never opened comes off: its lines are unfired and, since
				// lines are paid in order, unpaid unless the client paid ahead. A stage
				// whose file has opened is owed under the withdrawal rule — it cannot
				// be removed here; finance credits or voids from Invoices.
				const removedLines = existing.filter((l) => removed.includes(lineStage(l) as ServiceStage));
				const opened = removedLines.filter((l) => l.dueAt != null);
				if (opened.length > 0) {
					throw new HttpError(
						409,
						"PACKAGE_LOCKED",
						`${removed.map((st) => SERVICE_STAGE_LABELS[st]).join(", ")} has already opened — it is owed under the plan. Credit or void the service-fee invoice from Invoices instead.`,
					);
				}
				if (!live.subtotalCents || existing.length === 0 || removedLines.length === 0) {
					// A full journey bought as one is a deposit / pre-departure / post-arrival
					// split, not stage lines — nothing maps to the stage, so it cannot be
					// trimmed line by line. (A full journey reached by extension has stage
					// lines and trims fine.)
					throw new HttpError(409, "PACKAGE_LOCKED", "This plan's invoice is one split, not per-stage lines. Credit or void it from Invoices, then record the new plan.");
				}
				for (const l of removedLines) await tx.delete(invoiceLines).where(eq(invoiceLines.id, l.id));
				removedCents = removedLines.reduce((n, l) => n + l.amountCents, 0);
				const kept = existing.filter((l) => !removedLines.some((r) => r.id === l.id));
				for (const [i, l] of kept.entries()) await tx.update(invoiceLines).set({ position: i }).where(eq(invoiceLines.id, l.id));
				const newSubtotal = live.subtotalCents - removedCents;
				await tx.insert(invoiceEvents).values({
					invoiceId: live.id,
					action: "lines_removed",
					actor: input.actor?.opsUserId ? actorName : "client",
					detail: `Plan reduced: ${removed.map((st) => SERVICE_STAGE_LABELS[st]).join(" + ")} removed before opening · −${(removedCents / 100).toFixed(2)}`,
				});
				if (paidCents > newSubtotal) {
					// Paid ahead for a stage that will not happen: finance issues the credit.
					const refund = paidCents - newSubtotal;
					await tx.insert(invoiceEvents).values({ invoiceId: live.id, action: "refund_due", actor: "system", detail: `Paid ${(paidCents / 100).toFixed(2)} against ${(newSubtotal / 100).toFixed(2)} — refund due ${(refund / 100).toFixed(2)}` });
					await tx.insert(caseComments).values({
						targetType: "application",
						targetId: app.id,
						kind: "status",
						text: `Refund due: ${(refund / 100).toFixed(2)} USD — the client paid ahead for ${removed.map((st) => SERVICE_STAGE_LABELS[st]).join(" + ")}, now off the plan. Issue a credit note from Invoices.`,
						authorName: "Century NIT",
						authorOpsUserId: null,
					});
				}
			}
			const added = quote.stageLines.filter((l) => !prevScope.includes(l.stage));
			if (added.length === 0) {
				if (removedCents > 0) {
					await tx
						.update(invoices)
						.set({ subtotalCents: live.subtotalCents - removedCents, note: `Service package: ${planName} · ${scopeLabel(scope)}`, dueAt: await nextUncoveredDueAt(live.id, paidCents, txDb), updatedAt: new Date() })
						.where(eq(invoices.id, live.id));
					const updated = await bind();
					await tx.insert(caseComments).values({
						targetType: "application",
						targetId: app.id,
						kind: "status",
						text: `Plan reduced: ${removed.map((st) => SERVICE_STAGE_LABELS[st]).join(" + ")} removed · now ${scopeLabel(scope)}${onBehalf}`,
						authorName: actorName,
						authorOpsUserId: input.actor?.opsUserId ?? null,
					});
					const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, live.id)).limit(1);
					if (input.actor?.opsUserId && !input.internal) await notifyPlanChangedByOps(updated, "reduced", scopeLabel(scope), input.actor);
					return { application: updated, proformaInvoice: fresh ?? live };
				}
				// Same plan — only the facts changed.
				const updated = await bind();
				return { application: updated, proformaInvoice: live };
			}
			// New lines go after whatever is left on the invoice.
			const existingPositions = existing.length - (removed.length > 0 ? existing.filter((l) => removed.includes(lineStage(l) as ServiceStage)).length : 0);
			// Stages added to a plan open on their own events; only a brand-new
			// entry (Admissions added in front of a visa entry) is due on acceptance,
			// which stageLines handles through the admissions split.
			const lines = stageLines(added, split, existingPositions, quote.bundleDiscountCents);
			const addedCents = lines.reduce((n, l) => n + l.amountCents, 0);
			await tx.insert(invoiceLines).values(
				lines.map(({ stage: _stage, ...l }) => ({ invoiceId: live.id, ...l, dueAt: l.dueOn === "acceptance" ? new Date() : null })),
			);
			await tx
				.update(invoices)
				.set({
					subtotalCents: live.subtotalCents + addedCents - removedCents,
					note: `Service package: ${planName} · ${scopeLabel(scope)}`,
					// The invoice falls due with its first unpaid dated line.
					dueAt: await nextUncoveredDueAt(live.id, paidCents, txDb),
					updatedAt: new Date(),
				})
				.where(eq(invoices.id, live.id));
			const addedLabel = added.map((l) => SERVICE_STAGE_LABELS[l.stage]).join(" + ");
			await tx.insert(invoiceEvents).values({
				invoiceId: live.id,
				action: "lines_added",
				actor: input.actor?.opsUserId ? actorName : "client",
				detail: `Plan extended: ${addedLabel}${quote.bundleDiscountCents > 0 ? " · full-journey bundle price applied" : ""}`,
			});
			const updated = await bind();
			await tx.insert(caseComments).values({
				targetType: "application",
				targetId: app.id,
				kind: "status",
				text: `Plan extended: ${addedLabel} added · now ${scopeLabel(scope)}${onBehalf}`,
				authorName: actorName,
				authorOpsUserId: input.actor?.opsUserId ?? null,
			});
			const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, live.id)).limit(1);
			if (input.actor?.opsUserId && !input.internal) await notifyPlanChangedByOps(updated, "extended", scopeLabel(scope), input.actor);
			return { application: updated, proformaInvoice: fresh ?? live };
		}

		// ── Nothing paid: the previous invoice (if any) goes, a fresh one comes ──
		if (live) {
			await tx
				.update(invoices)
				.set({ status: "void", voidedAt: new Date(), voidReason: "Package re-selected" })
				.where(eq(invoices.id, live.id));
			await tx.insert(invoiceEvents).values({
				invoiceId: live.id,
				action: "voided",
				actor: "system",
				detail: "Replaced by new package selection",
			});
		}

		const updated = await bind();
		const lines = milestoneLines(quote, split, app.paymentPlanId);
		const subtotalCents = lines.reduce((n, l) => n + l.amountCents, 0);
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
					note: `Service package: ${planName} · ${scopeLabel(scope)}`,
					// The acceptance milestone is due now; the rest wait for their events.
					dueAt: lines.some((l) => l.dueOn === "acceptance") ? new Date() : null,
				})
				.returning();

			await tx.insert(invoiceLines).values(
				lines.map(({ stage: _stage, ...l }) => ({ invoiceId: created.id, ...l, dueAt: l.dueOn === "acceptance" ? new Date() : null })),
			);

			await tx.insert(invoiceEvents).values({
				invoiceId: created.id,
				action: "issued",
				actor: "system",
				detail: `Issued from ${pkg ? `package ${pkg.code}` : "the fee catalogue"} · ${scopeLabel(scope)}`,
			});

			proformaInvoice = created;
		}

		await tx.insert(caseComments).values({
			targetType: "application",
			targetId: app.id,
			kind: "status",
			text: `Package Agreement: ${planName} · ${scopeLabel(scope)} · ${input.degreeLevel}${onBehalf}`,
			authorName: actorName,
			authorOpsUserId: input.actor?.opsUserId ?? null,
		});

		if (input.actor?.opsUserId && !input.internal) await notifyPlanChangedByOps(updated, "recorded", scopeLabel(scope), input.actor);
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
	// The invoice follows the plan: full = deposit + balance; instalments =
	// deposit, pre-departure, post-arrival. Only while nothing past the
	// deposit is paid.
	const { reshapeAgencyInvoiceForPlan } = await import("./serviceFee.js");
	await reshapeAgencyInvoiceForPlan(row.id, input.paymentPlanId);
	await db.insert(caseComments).values({
		targetType: "application",
		targetId: row.id,
		kind: "status",
		text: `Payment plan chosen: ${input.paymentPlanId}`,
		authorName: "Applicant",
	});
	await broadcastCaseUpdate(updated, { opsUserId: "", name: "Applicant", email: "" });
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
		appFeePaid: await applicationFeesSettled(row),
		paymentPlanId: row.paymentPlanId,
		preDepartureTasks: await resolvePreDepartureTasks(row),
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


