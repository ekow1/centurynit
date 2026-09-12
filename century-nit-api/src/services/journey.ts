import { desc, eq } from "drizzle-orm";
import {
	JOURNEY_STAGES,
	deriveJourney,
	emptyJourney,
	type DerivedJourney,
	type JourneyStage,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { applications, consultations, invoices, travelAssistanceRequests } from "../db/schema.js";
import { activeHandlerFor } from "./handoffs.js";
import { listSchoolsForApplication } from "./schools.js";
import { getStageConsent } from "./stageConsents.js";

/**
 * Gathers the facts about one applicant's current case and derives their
 * journey. This is the one place the facts are collected, so the applicant
 * portal (`GET /me/journey`) and the ops console (application serializer)
 * always describe the same step — a support call about "Awaiting application
 * invoice" means the same thing on both screens.
 */

type ApplicantRow = { id: string; userId: string | null };
type ApplicationRow = typeof applications.$inferSelect;
type ConsultationRow = typeof consultations.$inferSelect;

type Prefetched = {
	schoolTracks?: Awaited<ReturnType<typeof listSchoolsForApplication>>;
	visaConsent?: Awaited<ReturnType<typeof getStageConsent>>;
};

export async function journeyForApplicant(
	applicant: ApplicantRow,
	application: ApplicationRow | null,
	prefetched: Prefetched = {},
): Promise<DerivedJourney> {
	const [consultation, allInvoices] = await Promise.all([
		application?.consultationId
			? db
					.select()
					.from(consultations)
					.where(eq(consultations.id, application.consultationId))
					.limit(1)
					.then((r) => r[0] ?? null)
			: db
					.select()
					.from(consultations)
					.where(eq(consultations.applicantId, applicant.id))
					.orderBy(desc(consultations.createdAt))
					.limit(1)
					.then((r) => r[0] ?? null),
		applicant.userId
			? db.select().from(invoices).where(eq(invoices.clientUserId, applicant.userId))
			: Promise.resolve([] as (typeof invoices.$inferSelect)[]),
	]);

	if (!consultation && !application) return emptyJourney();

	// Every signal is scoped to the current application. A returning client's
	// earlier application keeps its own schools and paid invoices; none of
	// that may count towards the new one.
	const scoped = application ? allInvoices.filter((i) => i.applicationId === application.id) : allInvoices;
	const [schoolTracks, visaConsent, taRow, handler] = await Promise.all([
		prefetched.schoolTracks ?? (application ? listSchoolsForApplication(application.id) : { schools: [], total: 0 }),
		prefetched.visaConsent !== undefined
			? prefetched.visaConsent
			: application
				? getStageConsent(application.id, "visa")
				: null,
		db
			.select({ status: travelAssistanceRequests.status })
			.from(travelAssistanceRequests)
			.where(
				application
					? eq(travelAssistanceRequests.applicationId, application.id)
					: eq(travelAssistanceRequests.applicantId, applicant.id),
			)
			.orderBy(desc(travelAssistanceRequests.createdAt))
			.limit(1)
			.then((r) => r[0] ?? null),
		// assignedStaffId is the authoritative whole-case owner; fall back to
		// the per-stage assignment for cases assigned the legacy way.
		application
			? application.assignedStaffId
				? true
				: activeHandlerFor(application.id, "school_submission").then(Boolean)
			: false,
	]);

	const invoiceIs = (type: string, ...statuses: string[]) =>
		scoped.some((i) => i.type === type && statuses.includes(i.status));
	const hasSchools = schoolTracks.schools.length > 0;
	const hasAppInvoice = scoped.some((i) => i.type === "application");
	const outcome = (consultation as ConsultationRow | null)?.assessmentResult?.outcome;

	return deriveJourney({
		hasConsultation: Boolean(consultation),
		isEligible: outcome === "Eligible" || outcome === "Conditionally Eligible",
		proceedStatus: application?.proceedStatus ?? null,
		hasPackage: Boolean(application?.fundingTrack),
		depositPaid: Boolean(application?.depositPaid),
		hasHandler: handler,
		// Locked selection: the lock raises the application invoice, and ops
		// moving a track past "Preparing Application" implies it too.
		hasSelection:
			hasSchools && (hasAppInvoice || schoolTracks.schools.some((s) => s.status !== "Preparing Application")),
		// The invoice starts as a proforma when the applicant locks schools;
		// the handler must issue it before the applicant can pay.
		appInvoiceIssued: invoiceIs("application", "issued", "partial", "paid"),
		appInvoicePaid: Boolean(application?.appFeePaid) || invoiceIs("application", "paid"),
		hasAdmitted: schoolTracks.schools.some((s) => s.outcome === "Admitted"),
		hasVisaConsent: visaConsent?.decision === "continue",
		visaInvoicePaid: Boolean(application?.visaInvoicePaid) || invoiceIs("visa", "paid"),
		visaDone: application?.visaStage === "complete",
		visaRefused: application?.visaOutcome === "refused",
		travelInvoicePaid: Boolean(application?.travelInvoicePaid) || invoiceIs("travel", "paid"),
		travelAssistanceStatus: taRow?.status ?? null,
		paymentPlanId: application?.paymentPlanId ?? null,
		agencyStageIndex: application?.agencyStageIndex ?? 0,
		agencySettled: Boolean(application?.agencySettled),
		travelCleared: application?.travelClearance === "cleared",
		preDepartureDone: Boolean(
			(application?.checklist?.length ?? 0) > 0 && application?.checklist?.every((item) => item.checked),
		),
		coarseStage:
			application?.stage && (JOURNEY_STAGES as string[]).includes(application.stage)
				? (application.stage as JourneyStage)
				: null,
	});
}
