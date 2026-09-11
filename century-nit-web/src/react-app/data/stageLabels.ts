import type { ProcessStageId } from "century-nit-core";
import { PORTAL_STAGE_SHORT } from "century-nit-shared";

/**
 * Short stage names for tight surfaces — the mobile app bar, pills, chips.
 * The short form of the same entry the spine uses (century-nit-shared
 * labels.ts), never separate wording.
 */
export const STAGE_SHORT: Record<ProcessStageId, string> = PORTAL_STAGE_SHORT;

/** Where the applicant continues from a given stage */
export const STAGE_PATH: Record<ProcessStageId, string> = {
	new: "/portal/home",
	consultation: "/portal/consultation",
	eligibility: "/portal/consultation",
	proceed: "/portal/package",
	school_package: "/portal/package",
	awaiting_handler: "/portal/awaiting-handler",
	school_select: "/portal/application",
	awaiting_invoice: "/portal/application",
	application_invoice: "/portal/application",
	school_tracking: "/portal/tracking",
	visa_invoice: "/portal/visa",
	visa: "/portal/visa/tracking",
	payment_execution: "/portal/payment-execution",
	travel_assistance: "/portal/pre-departure",
	completed: "/portal/complete",
};
