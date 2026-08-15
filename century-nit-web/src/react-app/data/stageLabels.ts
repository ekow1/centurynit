import type { ProcessStageId } from "century-nit-core";

/**
 * Short stage names for tight surfaces - the mobile app bar, pills, chips.
 *
 * The full `PROCESS_STAGES[].label` ("Stage I · Consultation", "Application
 * invoice") is written for a wide desktop rail and truncates to noise on a
 * phone. These are one- or two-word names that stay legible at ~120px.
 */
export const STAGE_SHORT: Record<ProcessStageId, string> = {
	consultation: "Consultation",
	eligibility: "Eligibility",
	school_package: "Package",
	school_select: "Schools",
	application_invoice: "Application fee",
	school_tracking: "Applications",
	visa_invoice: "Visa fee",
	visa: "Visa",
	pre_departure: "Travel",
	completed: "Complete",
};

/** Where the applicant continues from a given stage */
export const STAGE_PATH: Record<ProcessStageId, string> = {
	consultation: "/portal/consultation",
	eligibility: "/portal/consultation",
	school_package: "/portal/package",
	school_select: "/portal/application",
	application_invoice: "/portal/application",
	school_tracking: "/portal/tracking",
	visa_invoice: "/portal/visa",
	visa: "/portal/visa",
	pre_departure: "/portal/pre-departure",
	completed: "/portal/complete",
};
