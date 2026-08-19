import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	getCurrentSession,
	signOut as authSignOut,
} from "./authStore";
import { safeGetJSON, safeRemoveItem, safeSetJSON, meApi } from "century-nit-core";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { invoicesApi } from "century-nit-core/api";
import {
	API_PREFIX,
	JOURNEY_STAGE_TO_PORTAL,
	type JourneyStage,
} from "century-nit-shared";
import {
	APPLICATION_FEE,
	APP_INVOICE_BASE,
	AUTH_STORAGE_KEY,
	BOOKING_STORAGE_KEY,
	formatDualCurrency,
	MESSAGES_KEY,
	PORTAL_INTERVIEW_KEY,
	PRE_DEPARTURE_KEY,
	PRE_DEPARTURE_TASKS,
	PROCESS_STAGES,
	SCHOOL_APPS_KEY,
	SCHOOL_DEGREE_LEVELS,
	SCHOOL_FUNDING_TRACKS,
	AGENCY_DEPOSIT_PORTION,
	serviceFeeFor,
	SEED_MESSAGES,
	STORAGE_KEY,
	VISA_INVOICE_AMOUNT,
	VISA_STAGE_FEE,
	appInvoiceActualLines,
	appInvoiceEstimateLines,
	sumInvoiceLines,
	visaInvoiceActualLines,
	visaInvoiceEstimateLines,
	type AppNotification,
	type ChatMessage,
	type PaymentPlanId,
	type PortalChapterId,
	type PreDepartureTask,
	type ProcessStageId,
	type SchoolDegreeLevel,
	type SchoolFundingTrack,
	type SchoolTrackStatus,
} from "century-nit-core";

export type AuthMethod = "google" | "apple" | "linkedin" | "email" | "otp" | "phone";

export type AuthUser = {
	id?: string;
	name: string;
	email: string;
	method: AuthMethod;
	signedInAt: string;
	/**
	 * Whether an avatar is on file (the provider URL or a storage key). The
	 * value is never rendered directly — it is signed per request by the API —
	 * so components treat it as "show the photo, falling back to initials".
	 */
	image?: string | null;
};

export type DocReviewStatus = "idle" | "pending" | "approved" | "rejected";
export type VisaStatus = "locked" | "pending" | "biometrics" | "decision" | "complete";

export type InvoiceLine = {
	id: string;
	label: string;
	detail: string;
	amount: number;
};

export type StageInvoice = {
	id: string | null;
	/** Payable amount right now: estimated while waiting, actual once the consultant issues it */
	amount: number;
	status: "none" | "estimated" | "raised" | "paid";
	raisedAt: string | null;
	paidAt: string | null;
	description: string;
	/** Auto-generated estimate shown before the consultant issues the actual invoice */
	estimatedAmount: number;
	estimateLines: InvoiceLine[];
	/** Consultant / handler entered figures - becomes the payable amount */
	actualAmount: number | null;
	actualLines: InvoiceLine[];
	consultantNote: string | null;
};

export type SchoolTrackEvent = {
	at: string;
	status: SchoolTrackStatus;
	note: string;
	financialNote?: string | null;
};

export type SchoolApplicationTrack = {
	id: string;
	destinationId: string;
	universityId: string;
	programId: string;
	intake: string;
	status: SchoolTrackStatus;
	/** Handler / consultant feedback for the applicant (read-only) */
	handlerNote: string | null;
	/** Financial feedback (fees, deposits, funding notes) - read-only */
	financialNote: string | null;
	/** Handler timeline the applicant can only view */
	events: SchoolTrackEvent[];
	createdAt: string;
	updatedAt: string | null;
	/** When application process tracking started (after invoice paid) */
	trackStartedAt: string | null;
	/**
	 * Offer terms, set when the institution makes an offer.
	 *
	 * This is the university's money, not Century NIT's — kept structured
	 * rather than buried in `financialNote` so the deposit deadline can be
	 * surfaced and counted down. Missing a deposit deadline loses the place,
	 * which makes it the highest-stakes date in the whole journey.
	 */
	offerTuitionUsd: number | null;
	/** Native-currency display string, e.g. "£38,760" */
	offerTuitionLabel: string | null;
	offerDepositUsd: number | null;
	offerDepositDueAt: string | null;
	offerDepositPaidAt: string | null;
};

export type ApplicationData = {
	firstName: string;
	middleName: string;
	lastName: string;
	email: string;
	phone: string;
	dateOfBirth: string;
	nationality: string;
	highestEducation: string;
	institution: string;
	fieldOfStudy: string;
	graduationYear: string;
	gpa: string;
	destinationId: string;
	universityId: string;
	programId: string;
	intake: string;
	packageId: string;
	termsAccepted: boolean;
	privacyAccepted: boolean;
	currentStep: number;
	applicationId: string | null;
	paymentStatus: "idle" | "processing" | "success" | "failed";
	submittedAt: string | null;
	profileCompletedAt: string | null;
	docsReadyAt: string | null;
	docReviewStatus: DocReviewStatus;
	docReviewUpdatedAt: string | null;
	/** Selection list locked for tracking */
	schoolSelectionDoneAt: string | null;
	schoolSubmittedAt: string | null;
	/** Stage invoices */
	applicationInvoice: StageInvoice;
	visaInvoice: StageInvoice;
	/** School application package (after eligibility) */
	applicationPackageId: string;
	schoolFundingTrack: SchoolFundingTrack | "";
	schoolDegreeLevel: SchoolDegreeLevel | "";
	packageChosenAt: string | null;
	/** Installment vs full - after admitted, before visa/travel */
	paymentPlanId: PaymentPlanId | "";
	paymentPlanChosenAt: string | null;
	/** Agency settlement (Stage IV) */
	agencyTotal: number;
	agencyPaid: number;
	agencyDepositPaid: boolean;
	agencyStageIndex: number;
	agencySettledAt: string | null;
	/** Post-arrival recurring schedule (installment plan only) */
	postArrivalSchedule: string | null;
	postArrivalPaymentIndex: number;
	visaStatus: VisaStatus;
	visaUpdatedAt: string | null;
	completedAt: string | null;
	/** Set once every pre-departure task is ticked — the travel stage's done signal */
	preDepartureCompletedAt: string | null;
	counselorNote: string | null;
	pipelineStatus: string;
	pipelineUpdatedAt: string | null;
	onboardingCompleted: boolean;
	referralSource: string;
	/**
	 * Coarse journey stage read from `applications.stage` on the server
	 * (the shared `JourneyStage` enum). Empty until `syncFromServer`
	 * populates it. `getCurrentProcessStage` uses this as the
	 * authoritative floor and refines it into a fine-grained
	 * `ProcessStageId` using invoice / school signals.
	 */
	journeyStage: JourneyStage | "";
};

export type ConsultationType = "online" | "in_person" | "";
export type EligibilityOutcome =
	| "pending"
	| "eligible"
	| "conditional"
	| "needs_info"
	| "not_eligible";

export type AssessmentDoc = {
	fileName: string | null;
	uploadedAt: string | null;
	documentId: string | null;
};

export type AssessmentData = {
	// Personal
	firstName: string;
	middleName: string;
	lastName: string;
	email: string;
	phone: string;
	dateOfBirth: string;
	gender: string;
	nationality: string;
	address: string;
	// Passport
	passportNumber: string;
	passportCountry: string;
	passportIssue: string;
	passportExpiry: string;
	// Education
	highestEducation: string;
	institution: string;
	fieldOfStudy: string;
	graduationYear: string;
	gpa: string;
	// Employment
	employmentStatus: string;
	employer: string;
	jobTitle: string;
	yearsExperience: string;
	// English
	englishTest: string;
	englishScore: string;
	englishDate: string;
	// Study preferences
	preferredCountries: string;
	preferredLevel: string;
	preferredField: string;
	intakePreference: string;
	// Financial (basic)
	fundingSource: string;
	budgetRange: string;
	sponsorName: string;
	sponsorRelationship: string;
};

export type BookingData = {
	step: number;
	// Step 1
	consultationType: ConsultationType;
	// Step 2
	country: string;
	region: string;
	city: string;
	// Step 3
	branchId: string;
	// Step 4
	date: string;
	time: string;
	duration: string;
	// Step 5
	assessment: AssessmentData;
	assessmentSection: number;
	assessmentCompleted: boolean;
	assessmentDocs: Record<string, AssessmentDoc>;
	// Step 7
	paymentStatus: "idle" | "processing" | "success" | "failed";
	paidAt: string | null;
	// Step 8
	confirmationId: string | null;
	meetingLink: string | null;
	// Steps 9–10
	consultationPhase:
		| "draft"
		| "booked"
		| "awaiting_confirmation"
		| "confirmed"
		| "awaiting_assignment"
		| "assigned"
		| "awaiting_assignment_confirmation"
		| "assessment"
		| "assessment_complete"
		| "outcome"
		| "cancelled";
	consultantName: string | null;
	/** id into `consultants` - resolves to title, photo, specialties */
	consultantId: string | null;
	eligibilityOutcome: EligibilityOutcome;
	eligibilityNote: string | null;
	outcomeAt: string | null;
	// Legacy aliases used by old storage
	serviceId?: string;
	destinationId?: string;
	fullName?: string;
	email?: string;
	phone?: string;
	notes?: string;
};

export type InterviewBooking = {
	slotId: string | null;
	mode: "video" | "phone" | "";
	notes: string;
	confirmedAt: string | null;
	confirmationCode: string | null;
};

const defaultApplication: ApplicationData = {
	firstName: "",
	middleName: "",
	lastName: "",
	email: "",
	phone: "",
	dateOfBirth: "",
	nationality: "",
	highestEducation: "",
	institution: "",
	fieldOfStudy: "",
	graduationYear: "",
	gpa: "",
	destinationId: "",
	universityId: "",
	programId: "",
	intake: "",
	packageId: "",
	termsAccepted: false,
	privacyAccepted: false,
	currentStep: 0,
	applicationId: null,
	paymentStatus: "idle",
	submittedAt: null,
	profileCompletedAt: null,
	docsReadyAt: null,
	docReviewStatus: "idle",
	docReviewUpdatedAt: null,
	schoolSelectionDoneAt: null,
	schoolSubmittedAt: null,
	applicationInvoice: {
		id: null,
		amount: APP_INVOICE_BASE,
		status: "none",
		raisedAt: null,
		paidAt: null,
		description: "Stage II - school selection & admission tracking",
		estimatedAmount: APP_INVOICE_BASE,
		estimateLines: [],
		actualAmount: null,
		actualLines: [],
		consultantNote: null,
	},
	visaInvoice: {
		id: null,
		amount: VISA_STAGE_FEE,
		status: "none",
		raisedAt: null,
		paidAt: null,
		description: "Stage III - visa processing & travel prep",
		estimatedAmount: VISA_STAGE_FEE,
		estimateLines: [],
		actualAmount: null,
		actualLines: [],
		consultantNote: null,
	},
	applicationPackageId: "",
	schoolFundingTrack: "",
	schoolDegreeLevel: "",
	packageChosenAt: null,
	paymentPlanId: "",
	paymentPlanChosenAt: null,
	agencyTotal: 0,
	agencyPaid: 0,
	agencyDepositPaid: false,
	agencyStageIndex: 0,
	agencySettledAt: null,
	postArrivalSchedule: null,
	postArrivalPaymentIndex: 0,
	visaStatus: "locked",
	visaUpdatedAt: null,
	completedAt: null,
	preDepartureCompletedAt: null,
	counselorNote: null,
	pipelineStatus: "draft",
	pipelineUpdatedAt: null,
	onboardingCompleted: false,
	referralSource: "",
	journeyStage: "",
};

const defaultAssessment: AssessmentData = {
	firstName: "",
	middleName: "",
	lastName: "",
	email: "",
	phone: "",
	dateOfBirth: "",
	gender: "",
	nationality: "",
	address: "",
	passportNumber: "",
	passportCountry: "",
	passportIssue: "",
	passportExpiry: "",
	highestEducation: "",
	institution: "",
	fieldOfStudy: "",
	graduationYear: "",
	gpa: "",
	employmentStatus: "",
	employer: "",
	jobTitle: "",
	yearsExperience: "",
	englishTest: "",
	englishScore: "",
	englishDate: "",
	preferredCountries: "",
	preferredLevel: "",
	preferredField: "",
	intakePreference: "",
	fundingSource: "",
	budgetRange: "",
	sponsorName: "",
	sponsorRelationship: "",
};

const defaultAssessmentDocs: Record<string, AssessmentDoc> = {
	passport: { fileName: null, uploadedAt: null, documentId: null },
	certificates: { fileName: null, uploadedAt: null, documentId: null },
	transcripts: { fileName: null, uploadedAt: null, documentId: null },
	cv: { fileName: null, uploadedAt: null, documentId: null },
	english: { fileName: null, uploadedAt: null, documentId: null },
	financial: { fileName: null, uploadedAt: null, documentId: null },
	sponsorship: { fileName: null, uploadedAt: null, documentId: null },
	additional: { fileName: null, uploadedAt: null, documentId: null },
};

const defaultBooking: BookingData = {
	step: 0,
	consultationType: "",
	country: "",
	region: "",
	city: "",
	branchId: "",
	date: "",
	time: "",
	duration: "45",
	assessment: defaultAssessment,
	assessmentSection: 0,
	assessmentCompleted: false,
	assessmentDocs: defaultAssessmentDocs,
	paymentStatus: "idle",
	paidAt: null,
	confirmationId: null,
	meetingLink: null,
	consultationPhase: "draft",
	consultantName: null,
	consultantId: null,
	eligibilityOutcome: "pending",
	eligibilityNote: null,
	outcomeAt: null,
};

const defaultInterview: InterviewBooking = {
	slotId: null,
	mode: "",
	notes: "",
	confirmedAt: null,
	confirmationCode: null,
};

function loadJSON<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return fallback;
		return { ...fallback, ...JSON.parse(raw) };
	} catch {
		return fallback;
	}
}

/**
 * Rehydrate the signed-in applicant from `AUTH_STORAGE_KEY`.
 *
 * This key is the handshake between the two halves of the product: the ops side's
 * `useLivePortalCase()` treats it as the signal that somebody is signed into the
 * portal, and returns no live case at all without it. It is also what keeps a
 * portal session across a reload when the API is unreachable.
 *
 * Precedence, deliberately: a stored user wins until Better Auth returns a real
 * session, which then overwrites it. A `getCurrentSession()` that succeeds but
 * returns *no* user does **not** clear this — the app is localStorage-backed and
 * has to keep working with no server at all, which is also what makes the
 * two-window demo run offline. The cost is that a session revoked server-side
 * survives locally until sign-out. That is the right trade only for as long as
 * there is no real applicant data behind the API; revisit it in Phase 2 of
 * docs/API_MIGRATION_PLAN.md, where the server becomes the authority.
 *
 * Only the fields the ops snapshot and the portal chrome actually read are kept;
 * anything else in the stored blob is discarded rather than trusted.
 */
function loadAuthUser(): AuthUser | null {
	const stored = safeGetJSON<Partial<AuthUser>>(AUTH_STORAGE_KEY);
	if (!stored?.email || !stored.name) return null;
	return {
		id: typeof stored.id === "string" ? stored.id : undefined,
		name: stored.name,
		email: stored.email,
		method: (stored.method ?? "email") as AuthMethod,
		signedInAt: stored.signedInAt ?? new Date().toISOString(),
	};
}

export function isAgreementDone(app: ApplicationData) {
	return app.termsAccepted && app.privacyAccepted;
}

export function isPaid(app: ApplicationData) {
	return app.paymentStatus === "success" && Boolean(app.applicationId);
}

export function isProfileComplete(app: ApplicationData) {
	if (app.profileCompletedAt) return true;
	return Boolean(
		app.firstName.trim() &&
			app.lastName.trim() &&
			app.email.includes("@") &&
			app.phone.trim() &&
			app.dateOfBirth &&
			app.nationality.trim() &&
			app.highestEducation &&
			app.institution.trim() &&
			app.fieldOfStudy.trim() &&
			app.graduationYear.trim(),
	);
}

export function isSchoolSelected(app: ApplicationData) {
	return Boolean(app.destinationId && app.universityId && app.programId && app.intake);
}

export function isConsultationEligible(booking: BookingData) {
	return (
		booking.paymentStatus === "success" &&
		(booking.eligibilityOutcome === "eligible" ||
			booking.eligibilityOutcome === "conditional")
	);
}

export function hasAcceptedOffer(schools: SchoolApplicationTrack[]) {
	return schools.some((s) => s.status === "accepted");
}

export function isAppInvoicePaid(app: ApplicationData) {
	return app.applicationInvoice.status === "paid";
}

export function isVisaInvoicePaid(app: ApplicationData) {
	return app.visaInvoice.status === "paid";
}

export function hasSchoolPackage(app: ApplicationData) {
	return Boolean(
		app.packageChosenAt && app.schoolFundingTrack && app.schoolDegreeLevel,
	);
}

/** @deprecated alias */
export function hasPackage(app: ApplicationData) {
	return hasSchoolPackage(app);
}

export function hasPaymentPlan(app: ApplicationData) {
	return Boolean(app.paymentPlanId && app.paymentPlanChosenAt);
}

export function isAgencyDepositPaid(app: ApplicationData) {
	return app.agencyDepositPaid;
}

export function isAgencySettled(app: ApplicationData) {
	return Boolean(app.agencySettledAt) || (app.agencyTotal > 0 && app.agencyPaid >= app.agencyTotal);
}

/**
 * Select schools → pay application invoice → tracking starts.
 * Admitted → pay visa invoice → visa tracking. Then payment plan → agency → complete.
 *
 * The authoritative coarse stage is `application.stage` (a shared `JourneyStage`)
 * which `syncFromServer` writes into `app.journeyStage`. When present it is
 * mapped via `JOURNEY_STAGE_TO_PORTAL` and used as a *floor* — the heuristic
 * invoice / school signals may only advance the fine-grained `ProcessStageId`
 * beyond that floor, never regress it. When `journeyStage` is empty (server
 * unreachable / no application yet) the pure heuristic derivation is used.
 */
export function getCurrentProcessStage(
	app: ApplicationData,
	booking: BookingData,
	schools: SchoolApplicationTrack[],
): ProcessStageId {
	const heuristic = computeHeuristicProcessStage(app, booking, schools);

	const coarseFromServer = app.journeyStage
		? (JOURNEY_STAGE_TO_PORTAL[app.journeyStage] as ProcessStageId)
		: null;
	if (!coarseFromServer) return heuristic;

	const order = PROCESS_STAGES.map((s) => s.id);
	const coarseIdx = order.indexOf(coarseFromServer);
	const heuristicIdx = order.indexOf(heuristic);
	// The server stage is the authoritative minimum progress; local signals
	// can only move the applicant forward, not backwards.
	return heuristicIdx > coarseIdx ? heuristic : coarseFromServer;
}

/**
 * Pure local heuristic — derives a fine-grained `ProcessStageId` from
 * consultation, package, invoice, school, visa and pre-departure signals
 * without consulting the server's `JourneyStage`. Used as the fallback when
 * no server stage is available, and as the refinement candidate that the
 * server stage floors.
 */
function computeHeuristicProcessStage(
	app: ApplicationData,
	booking: BookingData,
	schools: SchoolApplicationTrack[],
): ProcessStageId {
	const eligible = isConsultationEligible(booking);
	const consulted = Boolean(booking.confirmationId && booking.paymentStatus === "success");
	const admitted = hasAcceptedOffer(schools);
	const pkg = hasSchoolPackage(app);
	const hasSchools = schools.length > 0;
	const selectionConfirmed = Boolean(app.schoolSelectionDoneAt);
	const appPaid = isAppInvoicePaid(app);
	const visaPaid = isVisaInvoicePaid(app);
	const visaDone = app.visaStatus === "complete";
	const preDepartureDone = Boolean(app.preDepartureCompletedAt);

	// Money is no longer a stage. The spine describes service progress; the
	// service fee gates travel rather than occupying two milestones of its own.
	if (app.completedAt || (visaDone && preDepartureDone)) return "completed";
	if (admitted && visaDone) return "pre_departure";
	if (admitted && visaPaid) return "visa";
	if (admitted && !visaPaid) return "visa_invoice";
	// Application process (tracking) only after invoice paid
	if (appPaid && selectionConfirmed) return "school_tracking";
	if (selectionConfirmed && !appPaid) return "application_invoice";
	if (pkg && (hasSchools || selectionConfirmed)) return "school_select";
	if (pkg) return "school_select";
	if (eligible && !pkg) return "school_package";
	if (consulted) return "eligibility";
	return "consultation";
}

export function getStageStatus(
	stageId: ProcessStageId,
	current: ProcessStageId,
	app: ApplicationData,
	booking: BookingData,
	schools: SchoolApplicationTrack[],
): "done" | "current" | "locked" {
	const order = PROCESS_STAGES.map((s) => s.id);
	const ci = order.indexOf(current);
	const si = order.indexOf(stageId);
	const eligible = isConsultationEligible(booking);
	const consulted = Boolean(booking.confirmationId && booking.paymentStatus === "success");
	const admitted = hasAcceptedOffer(schools);
	const selectionConfirmed = Boolean(app.schoolSelectionDoneAt);

	if (stageId === "consultation" && consulted) return si === ci ? "current" : "done";
	if (stageId === "eligibility" && eligible) return si === ci ? "current" : "done";
	if (stageId === "school_package" && hasSchoolPackage(app)) {
		return si === ci ? "current" : "done";
	}
	if (stageId === "school_select" && selectionConfirmed) {
		return si === ci ? "current" : "done";
	}
	if (stageId === "application_invoice" && isAppInvoicePaid(app)) {
		return si === ci ? "current" : "done";
	}
	if (stageId === "school_tracking" && admitted) {
		return si === ci ? "current" : "done";
	}
	if (stageId === "visa_invoice" && isVisaInvoicePaid(app)) {
		return si === ci ? "current" : "done";
	}
	if (stageId === "visa" && app.visaStatus === "complete") return "done";
	if (stageId === "pre_departure" && app.preDepartureCompletedAt) {
		return si === ci ? "current" : "done";
	}
	if (stageId === "completed" && app.completedAt) return "done";

	if (si < ci) return "done";
	if (si === ci) return "current";
	return "locked";
}

/** Progressive unlocks - next stage opens when prior step is done.
 *
 * The server-driven `JourneyStage` (floored through `getCurrentProcessStage`)
 * guarantees a chapter is unlocked once the applicant has reached it on the
 * server, even before local invoice / school signals catch up. Local signal
 * gates are OR'd with the stage floor so they only ever *add* access. */
export function getChapterUnlocks(
	app: ApplicationData,
	booking: BookingData,
	schools: SchoolApplicationTrack[],
): Record<PortalChapterId, boolean> {
	const eligible = isConsultationEligible(booking);
	const pkg = hasSchoolPackage(app);
	const appPaid = isAppInvoicePaid(app);
	const admitted = hasAcceptedOffer(schools);
	const visaPaid = isVisaInvoicePaid(app);
	const visaDone = app.visaStatus === "complete";
	const agencySettled = isAgencySettled(app);

	const stage = getCurrentProcessStage(app, booking, schools);
	const order = PROCESS_STAGES.map((s) => s.id);
	const stageIdx = order.indexOf(stage);
	const atOrBeyond = (id: ProcessStageId) => stageIdx >= order.indexOf(id);

	return {
		journey: true,
		consultation: true,
		package: eligible || atOrBeyond("school_package"),
		application: (eligible && pkg) || atOrBeyond("school_select"),
		// Tracking is its own page - only after application invoice paid
		tracking: (appPaid && Boolean(app.schoolSelectionDoneAt)) || atOrBeyond("school_tracking"),
		visa: admitted || atOrBeyond("visa"),
		// Travel opens on visa approval AND agency settlement — the same
		// `finished` check PreDepartureInner uses, so the gate and the page
		// never disagree about who can enter.
		pre_departure:
			(admitted && visaPaid && visaDone && agencySettled) || atOrBeyond("pre_departure"),
		// Completion needs the travel checklist finished, not a payment state
		complete: Boolean(app.preDepartureCompletedAt) || atOrBeyond("completed"),
	};
}

export function getJourneyPhase(
	app: ApplicationData,
	booking: BookingData,
	schools: SchoolApplicationTrack[],
): { phase: number; label: string; nextUnlock: string | null; stage: ProcessStageId } {
	const stage = getCurrentProcessStage(app, booking, schools);
	const meta = PROCESS_STAGES.find((s) => s.id === stage)!;
	const next = PROCESS_STAGES.find((s) => s.index === meta.index + 1);

	const labels: Record<ProcessStageId, string> = {
		consultation: "Stage I · Consultation first",
		eligibility: "Awaiting eligibility",
		school_package: "Choose school application package",
		school_select: "Select schools & programmes",
		application_invoice: "Pay application invoice (before tracking)",
		school_tracking: "Application process / tracking",
		visa_invoice: "Pay visa invoice (before process)",
		visa: "Visa tracking in progress",
		pre_departure: "Travel & pre-departure",
		completed: "Application complete",
	};

	return {
		phase: meta.index,
		label: labels[stage],
		nextUnlock: next
			? next.owner === "you"
				? `Next for you: ${next.label}`
				: `Next: ${next.label} (${next.owner})`
			: null,
		stage,
	};
}

type AppStateContextValue = {
	application: ApplicationData;
	updateApplication: (patch: Partial<ApplicationData>) => void;
	setApplicationStep: (step: number) => void;
	resetApplication: () => void;
	/** Full simulation reset (application + booking + schools) - keeps sign-in */
	resetJourney: () => void;
	generateApplicationId: () => string;
	completeProfile: () => void;
	markDocsReady: () => void;
	submitSchoolApplication: () => void;
	/** Raise / pay stage invoices */
	raiseApplicationInvoice: () => void;
	payApplicationInvoice: () => void;
	raiseVisaInvoice: () => void;
	payVisaInvoice: () => void;
	chooseSchoolPackage: (funding: SchoolFundingTrack, level: SchoolDegreeLevel) => void;
	choosePaymentPlan: (planId: PaymentPlanId) => void;
	choosePostArrivalSchedule: (scheduleId: string) => void;
	/** Post-arrival schedule options enabled by ops (null = all enabled) */
	enabledPostArrivalSchedules: string[] | null;
	setEnabledPostArrivalSchedules: (ids: string[] | null) => void;
	/** Custom schedules created by ops that the portal may show */
	customPostArrivalSchedules: { id: string; label: string; detail: string; payments: number; intervalDays: number; graceDays: number }[];
	setCustomPostArrivalSchedules: (schedules: { id: string; label: string; detail: string; payments: number; intervalDays: number; graceDays: number }[]) => void;
	payAgencyInstallment: () => Promise<void>;
	/** Multi-school tracking (no new docs - consultation already has them) */
	schoolApplications: SchoolApplicationTrack[];
	/** Replace the full school applications list (used by server-poll sync). */
	setSchoolApplications: (
		next: SchoolApplicationTrack[] | ((prev: SchoolApplicationTrack[]) => SchoolApplicationTrack[]),
	) => void;
	addSchoolApplication: (input: {
		destinationId: string;
		universityId: string;
		programId: string;
		intake: string;
	}) => void;
	removeSchoolApplication: (id: string) => void;
	lockSchoolSelection: () => void;
	updateSchoolTrack: (
		id: string,
		patch: Partial<
			Pick<
				SchoolApplicationTrack,
				| "status"
				| "handlerNote"
				| "financialNote"
				| "offerTuitionUsd"
				| "offerTuitionLabel"
				| "offerDepositUsd"
				| "offerDepositDueAt"
				| "offerDepositPaidAt"
			>
		>,
	) => void;
	applicationFee: number;
	applicationStageFee: number;
	visaStageFee: number;
	autosaveLabel: string;
	chapterUnlocks: Record<PortalChapterId, boolean>;
	journeyPhase: ReturnType<typeof getJourneyPhase>;
	processStage: ProcessStageId;
	booking: BookingData;
	updateBooking: (patch: Partial<BookingData>) => void;
	updateAssessment: (patch: Partial<AssessmentData>) => void;
	updateAssessmentDoc: (id: string, fileName: string | null) => void;
	setBookingStep: (step: number) => void;
	resetBooking: () => void;
	generateBookingId: () => string;
	completeConsultationPayment: () => string;
	setEligibilityOutcome: (outcome: EligibilityOutcome, note?: string) => void;
	revealOutcome: () => void;
	interview: InterviewBooking;
	updateInterview: (patch: Partial<InterviewBooking>) => void;
	confirmInterview: (slotId: string) => string;
	authUser: AuthUser | null;
	isAuthenticated: boolean;
	sessionStatus: "checking" | "authenticated" | "unauthenticated";
	signIn: (user: Omit<AuthUser, "signedInAt">) => void;
	signOut: () => Promise<void>;
	/** Self-service account edit - syncs the auth record and application/assessment email */
	updateAccount: (patch: { name: string; email: string }) => void;
	/** Marks the profile photo as present ("set") or cleared ("clear") */
	setAvatarImage: (state: "set" | "clear") => void;
	/** Messaging */
	messages: ChatMessage[];
	sendMessage: (text: string) => void;
	/** Notifications */
	notifications: AppNotification[];
	unreadCount: number;
	markNotificationRead: (id: string) => void;
	markAllNotificationsRead: () => void;
	pushNotification: (n: Omit<AppNotification, "id" | "at" | "read">) => void;
	/** Pre-departure */
	/** Force an immediate re-sync of server consultation / invoice state */
	syncFromServer: () => Promise<void>;
	preDepartureTasks: PreDepartureTask[];
	togglePreDepartureTask: (id: string) => void;
	preDepartureProgress: number;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

function migrateApplication(loaded: ApplicationData): ApplicationData {
	const base = { ...defaultApplication, ...loaded };
	const migrateInvoice = (
		inv: StageInvoice,
		fallbackAmount: number,
		estimateLines: InvoiceLine[],
		actualLines: InvoiceLine[],
	): StageInvoice => {
		const oldAmount = inv.amount ?? fallbackAmount;
		const wasIssued = inv.status === "raised" || inv.status === "paid";
		return {
			...defaultApplication.applicationInvoice,
			...inv,
			estimatedAmount: inv.estimatedAmount ?? inv.amount ?? fallbackAmount,
			estimateLines: inv.estimateLines?.length ? inv.estimateLines : estimateLines,
			actualAmount: inv.actualAmount ?? (wasIssued ? oldAmount : null),
			actualLines: inv.actualLines?.length ? inv.actualLines : actualLines,
			consultantNote: inv.consultantNote ?? null,
			amount: oldAmount,
		};
	};
	base.applicationInvoice = migrateInvoice(
		base.applicationInvoice,
		APP_INVOICE_BASE,
		appInvoiceEstimateLines(1),
		appInvoiceActualLines(1),
	);
	base.visaInvoice = migrateInvoice(
		base.visaInvoice,
		VISA_STAGE_FEE,
		visaInvoiceEstimateLines(),
		visaInvoiceActualLines(),
	);
	if (!base.profileCompletedAt && isProfileComplete(base) && isPaid(base)) {
		base.profileCompletedAt = base.submittedAt ?? new Date().toISOString();
	}
	return base;
}

function loadSchoolApps(): SchoolApplicationTrack[] {
	try {
		const raw = localStorage.getItem(SCHOOL_APPS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as SchoolApplicationTrack[];
		if (!Array.isArray(parsed)) return [];
		return parsed.map((s) => ({
			...s,
			events: Array.isArray(s.events) ? s.events : [],
			trackStartedAt: s.trackStartedAt ?? null,
			handlerNote: s.handlerNote ?? null,
			financialNote: s.financialNote ?? null,
		}));
	} catch {
		return [];
	}
}

export function AppStateProvider({ children }: { children: ReactNode }) {
	const [application, setApplication] = useState<ApplicationData>(() =>
		migrateApplication(loadJSON(STORAGE_KEY, defaultApplication)),
	);
	const [booking, setBooking] = useState<BookingData>(() => {
		const loaded = loadJSON(BOOKING_STORAGE_KEY, defaultBooking);
		return {
			...defaultBooking,
			...loaded,
			assessment: { ...defaultAssessment, ...(loaded.assessment ?? {}) },
			assessmentDocs: { ...defaultAssessmentDocs, ...(loaded.assessmentDocs ?? {}) },
		};
	});
	const [schoolApplications, setSchoolApplications] =
		useState<SchoolApplicationTrack[]>(loadSchoolApps);
	const [interview, setInterview] = useState<InterviewBooking>(() =>
		loadJSON(PORTAL_INTERVIEW_KEY, defaultInterview),
	);
	const [authUser, setAuthUser] = useState<AuthUser | null>(loadAuthUser);
	const [sessionStatus, setSessionStatus] = useState<
		"checking" | "authenticated" | "unauthenticated"
	>("checking");
	const [autosaveLabel, setAutosaveLabel] = useState("Ready");

	/**
	 * Silent Web Push subscription — active whenever the user is signed in.
	 * The permission prompt is never shown automatically; this only resubscribes
	 * returning users who previously granted permission. `subscribe()` is
	 * exposed (via the hook return) for an explicit "enable notifications" UI.
	 */
	usePushNotifications({ isAuthenticated: !!authUser });

	const [enabledPostArrivalSchedules, setEnabledPostArrivalSchedules] =
		useState<string[] | null>(() => {
			try {
				const raw = localStorage.getItem("century-nit-enabled-schedules");
				if (!raw) return null;
				return JSON.parse(raw) as string[];
			} catch {
				return null;
			}
		});
	const [customPostArrivalSchedules, setCustomPostArrivalSchedules] =
		useState<{ id: string; label: string; detail: string; payments: number; intervalDays: number; graceDays: number }[]>(() => {
			try {
				const raw = localStorage.getItem("century-nit-custom-schedules");
				if (!raw) return [];
				return JSON.parse(raw);
			} catch {
				return [];
			}
		});

	const customPostArrivalSchedulesRef = useRef(customPostArrivalSchedules);
	useEffect(() => {
		customPostArrivalSchedulesRef.current = customPostArrivalSchedules;
	}, [customPostArrivalSchedules]);

	/**
	 * Autopilot simulates the consultant/finance side with timers so the portal
	 * can be demoed on its own. Switch it off for the two-window demo, where the
	 * Operations Center issues these decisions for real.
	 */
	const [messages, setMessages] = useState<ChatMessage[]>(() => {
		try {
			const raw = localStorage.getItem(MESSAGES_KEY);
			if (!raw) return SEED_MESSAGES;
			const parsed = JSON.parse(raw) as ChatMessage[];
			return Array.isArray(parsed) && parsed.length > 0 ? parsed : SEED_MESSAGES;
		} catch {
			return SEED_MESSAGES;
		}
	});

	/**
	 * Notifications are now server-driven (polling + SSE). The server is the
	 * source of truth — no localStorage seeding or persistence. `syncFromServer`
	 * hydrates the list on mount and every 30s; the SSE `EventSource` (below)
	 * prepends new notifications in real time.
	 */
	const [notifications, setNotifications] = useState<AppNotification[]>([]);

	const [preDepartureTasks, setPreDepartureTasks] = useState<PreDepartureTask[]>(() => {
		try {
			const raw = localStorage.getItem(PRE_DEPARTURE_KEY);
			if (!raw) return PRE_DEPARTURE_TASKS;
			const parsed = JSON.parse(raw) as PreDepartureTask[];
			if (!Array.isArray(parsed) || parsed.length === 0) return PRE_DEPARTURE_TASKS;
			return PRE_DEPARTURE_TASKS.map((t) => {
				const existing = parsed.find((p) => p.id === t.id);
				return existing ?? t;
			});
		} catch {
			return PRE_DEPARTURE_TASKS;
		}
	});

	useEffect(() => {
		const t1 = window.setTimeout(() => setAutosaveLabel("Saving…"), 0);
		const t2 = window.setTimeout(() => {
			safeSetJSON(STORAGE_KEY, application);
			setAutosaveLabel("Progress saved");
		}, 400);
		return () => {
			window.clearTimeout(t1);
			window.clearTimeout(t2);
		};
	}, [application]);

	useEffect(() => {
		safeSetJSON(BOOKING_STORAGE_KEY, booking);
	}, [booking]);

	useEffect(() => {
		safeSetJSON(SCHOOL_APPS_KEY, schoolApplications);
	}, [schoolApplications]);

	useEffect(() => {
		safeSetJSON(PORTAL_INTERVIEW_KEY, interview);
	}, [interview]);

	/**
	 * Persist the signed-in applicant. Without this the ops side never sees a
	 * live case (see `loadAuthUser`), and a reload signs the applicant out
	 * whenever the API is unreachable.
	 */
	useEffect(() => {
		if (authUser) safeSetJSON(AUTH_STORAGE_KEY, authUser);
		else safeRemoveItem(AUTH_STORAGE_KEY);
	}, [authUser]);


	useEffect(() => {
		safeSetJSON(MESSAGES_KEY, messages);
	}, [messages]);

	useEffect(() => {
		safeSetJSON(PRE_DEPARTURE_KEY, preDepartureTasks);
	}, [preDepartureTasks]);

	/** Persist portal state to server whenever key fields change (debounced). */
	useEffect(() => {
		if (!authUser) return;
		const t = window.setTimeout(() => {
			void meApi.updatePortalState({
				preDepartureTasks,
				postArrivalScheduleId: application.postArrivalSchedule,
				enabledPostArrivalSchedules,
				customPostArrivalSchedules,
			}).catch(() => { /* keep local */ });
		}, 1500);
		return () => window.clearTimeout(t);
	}, [authUser, preDepartureTasks, application.postArrivalSchedule, enabledPostArrivalSchedules, customPostArrivalSchedules]);

	/** Prefill profile from consultation when eligible (no invoice yet) */
	useEffect(() => {
		if (!isConsultationEligible(booking)) return;
		const t = window.setTimeout(() => {
			setApplication((prev) => {
				if (prev.firstName && prev.email) return prev;
				return {
					...prev,
					firstName: prev.firstName || booking.assessment.firstName,
					lastName: prev.lastName || booking.assessment.lastName,
					email: prev.email || booking.assessment.email,
					phone: prev.phone || booking.assessment.phone,
					dateOfBirth: prev.dateOfBirth || booking.assessment.dateOfBirth,
					nationality: prev.nationality || booking.assessment.nationality,
					highestEducation: prev.highestEducation || booking.assessment.highestEducation,
					institution: prev.institution || booking.assessment.institution,
					fieldOfStudy: prev.fieldOfStudy || booking.assessment.fieldOfStudy,
					graduationYear: prev.graduationYear || booking.assessment.graduationYear,
				};
			});
		}, 0);
		return () => window.clearTimeout(t);
	}, [booking]);

	/**
	 * Application invoice ESTIMATE raised AFTER schools selected & confirmed.
	 * The consultant then issues the ACTUAL invoice (separate effect below),
	 * which the applicant pays before application tracking begins.
	 */
	useEffect(() => {
		if (!application.schoolSelectionDoneAt) return;
		if (schoolApplications.length === 0) return;
		if (application.applicationInvoice.status === "paid") return;

		const t = window.setTimeout(() => {
			const estimateLines = appInvoiceEstimateLines(schoolApplications.length);
			const estimated = sumInvoiceLines(estimateLines);
			const now = new Date().toISOString();
			setApplication((prev) => {
				if (prev.applicationInvoice.status === "paid") return prev;
				if (
					prev.applicationInvoice.status !== "none" &&
					prev.applicationInvoice.status !== "estimated"
				) {
					return prev;
				}
				if (
					prev.applicationInvoice.status === "estimated" &&
					prev.applicationInvoice.estimatedAmount === estimated
				) {
					return prev;
				}
				return {
					...prev,
					applicationInvoice: {
						...prev.applicationInvoice,
						id: prev.applicationInvoice.id ?? `INV-APP-${Date.now().toString(36).toUpperCase()}`,
						status: "estimated",
						raisedAt: prev.applicationInvoice.raisedAt ?? now,
						estimatedAmount: estimated,
						estimateLines,
						amount: estimated,
						description: `Estimate for ${schoolApplications.length} school(s) - actual invoice follows from your consultant`,
					},
					counselorNote: `Estimate ${formatDualCurrency(estimated)} issued for ${schoolApplications.length} school(s). Your consultant confirms the actual invoice.`,
				};
			});
		}, 0);
		return () => window.clearTimeout(t);
	}, [
		application.schoolSelectionDoneAt,
		application.applicationInvoice.status,
		schoolApplications,
		schoolApplications.length,
	]);

	/**
	 * Visa invoice ESTIMATE raised on admission - the consultant then issues
	 * the ACTUAL invoice (separate effect), which is paid BEFORE visa starts.
	 */
	useEffect(() => {
		if (!hasAcceptedOffer(schoolApplications)) return;
		if (application.visaInvoice.status === "paid") return;

		const t = window.setTimeout(() => {
			const estimateLines = visaInvoiceEstimateLines();
			const estimated = sumInvoiceLines(estimateLines);
			const now = new Date().toISOString();
			setApplication((prev) => {
				if (prev.visaInvoice.status === "paid") return prev;
				if (
					prev.visaInvoice.status !== "none" &&
					prev.visaInvoice.status !== "estimated"
				) {
					return prev;
				}
				if (
					prev.visaInvoice.status === "estimated" &&
					prev.visaInvoice.estimatedAmount === estimated
				) {
					return prev;
				}
				return {
					...prev,
					visaInvoice: {
						...prev.visaInvoice,
						id: `INV-VISA-${Date.now().toString(36).toUpperCase()}`,
						status: "estimated",
						raisedAt: now,
						estimatedAmount: estimated,
						estimateLines,
						amount: estimated,
						description: "Visa fee estimate - actual invoice follows from your consultant",
					},
					visaStatus: "locked",
					counselorNote: `Admitted. Visa estimate ${formatDualCurrency(estimated)} issued - your consultant confirms the actual invoice.`,
				};
			});
		}, 0);
		return () => window.clearTimeout(t);
	}, [schoolApplications, application.visaInvoice.status]);

	/** Visa tracking simulation REMOVED — visaStage is now server-driven via syncFromServer */

	const updateApplication = useCallback((patch: Partial<ApplicationData>) => {
		setApplication((prev) => ({ ...prev, ...patch }));
	}, []);

	const setApplicationStep = useCallback((step: number) => {
		setApplication((prev) => ({ ...prev, currentStep: step }));
	}, []);

	const resetApplication = useCallback(() => {
		setApplication({
			...defaultApplication,
			applicationInvoice: { ...defaultApplication.applicationInvoice },
			visaInvoice: { ...defaultApplication.visaInvoice },
		});
		localStorage.removeItem(STORAGE_KEY);
		setSchoolApplications([]);
		localStorage.removeItem(SCHOOL_APPS_KEY);
		setInterview(defaultInterview);
		localStorage.removeItem(PORTAL_INTERVIEW_KEY);
	}, []);

	const resetJourney = useCallback(() => {
		setApplication({
			...defaultApplication,
			applicationInvoice: {
				...defaultApplication.applicationInvoice,
				amount: APP_INVOICE_BASE,
			},
			visaInvoice: {
				...defaultApplication.visaInvoice,
				amount: VISA_STAGE_FEE,
			},
		});
		localStorage.removeItem(STORAGE_KEY);
		setSchoolApplications([]);
		localStorage.removeItem(SCHOOL_APPS_KEY);
		setInterview(defaultInterview);
		localStorage.removeItem(PORTAL_INTERVIEW_KEY);
		setBooking({
			...defaultBooking,
			assessment: { ...defaultAssessment },
			assessmentDocs: { ...defaultAssessmentDocs },
		});
		localStorage.removeItem(BOOKING_STORAGE_KEY);
	}, []);

	const generateApplicationId = useCallback(() => {
		const n = Math.floor(Math.random() * 900000) + 1;
		const id = `CNT-2026-${String(n).padStart(6, "0")}`;
		const now = new Date().toISOString();
		setApplication((prev) => ({
			...prev,
			applicationId: id,
			paymentStatus: "success",
			submittedAt: now,
			pipelineStatus: "submitted",
			pipelineUpdatedAt: now,
			counselorNote: "Payment verified. Complete your profile next.",
		}));
		return id;
	}, []);

	const completeProfile = useCallback(() => {
		const now = new Date().toISOString();
		setApplication((prev) => ({
			...prev,
			profileCompletedAt: now,
			counselorNote: "Profile complete. Upload your documents to continue.",
		}));
	}, []);

	const markDocsReady = useCallback(() => {
		const now = new Date().toISOString();
		setApplication((prev) => ({
			...prev,
			docsReadyAt: now,
			docReviewStatus: "pending",
			docReviewUpdatedAt: now,
			counselorNote: "Documents received. Counselor is verifying your vault.",
		}));
	}, []);

	/** Confirm school list → raises invoice (tracking waits for payment) */
	const submitSchoolApplication = useCallback(() => {
		const now = new Date().toISOString();
		setSchoolApplications((list) => {
			const estimateLines = appInvoiceEstimateLines(list.length);
			const estimated = sumInvoiceLines(estimateLines);
			setApplication((prev) => ({
				...prev,
				schoolSelectionDoneAt: now,
				schoolSubmittedAt: now,
				applicationInvoice: {
					...prev.applicationInvoice,
					id: prev.applicationInvoice.id ?? `INV-APP-${Date.now().toString(36).toUpperCase()}`,
					status: "estimated",
					raisedAt: now,
					estimatedAmount: estimated,
					estimateLines,
					amount: estimated,
					description: `Estimate for ${list.length} school(s) - actual invoice follows from your consultant`,
				},
				counselorNote: `Schools confirmed. Estimate ${formatDualCurrency(estimated)} issued - your consultant confirms the actual invoice.`,
				pipelineStatus: "submitted",
				pipelineUpdatedAt: now,
			}));
			return list;
		});
	}, []);

	/** Consultant issues the ACTUAL application invoice (manual trigger / fallback) */
	const raiseApplicationInvoice = useCallback(() => {
		setApplication((prev) => {
			const count = schoolApplications.length || 1;
			const actualLines = appInvoiceActualLines(count);
			const actual = sumInvoiceLines(actualLines);
			const now = new Date().toISOString();
			return {
				...prev,
				applicationInvoice: {
					...prev.applicationInvoice,
					id: `INV-APP-${Date.now().toString(36).toUpperCase()}`,
					status: "raised",
					raisedAt: now,
					amount: actual,
					actualAmount: actual,
					actualLines,
					consultantNote: "Actual invoice issued by consultant.",
				},
			};
		});
	}, [schoolApplications.length]);

	const payApplicationInvoice = useCallback(() => {
		const now = new Date().toISOString();
		setApplication((prev) => {
			const amount =
				prev.applicationInvoice.actualAmount ??
				prev.applicationInvoice.amount ??
				APP_INVOICE_BASE;
			return {
				...prev,
				applicationInvoice: {
					...prev.applicationInvoice,
					status: "paid",
					paidAt: now,
					id: prev.applicationInvoice.id ?? `INV-APP-${Date.now().toString(36).toUpperCase()}`,
					amount,
					actualAmount: prev.applicationInvoice.actualAmount ?? amount,
					actualLines: prev.applicationInvoice.actualLines.length
						? prev.applicationInvoice.actualLines
						: prev.applicationInvoice.estimateLines,
					description: prev.applicationInvoice.description,
				},
				applicationId: prev.applicationId ?? `CNT-APP-${Date.now().toString(36).toUpperCase()}`,
				paymentStatus: "success",
				submittedAt: prev.submittedAt ?? now,
				counselorNote: `Payment received: ${formatDualCurrency(amount)}. Application process / tracking has started.`,
			};
		});
		// Start tracking clock for every school once paid
		setSchoolApplications((prev) =>
			prev.map((s, i) => {
				const startAt = new Date(Date.now() + i * 500).toISOString();
				const note = "Payment cleared - application process started. Handler is filing your case.";
				return {
					...s,
					status: "submitted" as SchoolTrackStatus,
					trackStartedAt: s.trackStartedAt ?? startAt,
					updatedAt: now,
					handlerNote: note,
					events: [
						...(s.events ?? []),
						{
							at: now,
							status: "submitted" as SchoolTrackStatus,
							note,
						},
					],
				};
			}),
		);
	}, []);

	/** Consultant issues the ACTUAL visa invoice (manual trigger / fallback) */
	const raiseVisaInvoice = useCallback(() => {
		const now = new Date().toISOString();
		setApplication((prev) => {
			const actualLines = visaInvoiceActualLines();
			const actual = sumInvoiceLines(actualLines);
			return {
				...prev,
				visaInvoice: {
					...prev.visaInvoice,
					id: `INV-VISA-${Date.now().toString(36).toUpperCase()}`,
					status: "raised",
					raisedAt: now,
					amount: actual,
					actualAmount: actual,
					actualLines,
					consultantNote: "Actual visa invoice issued by consultant.",
				},
			};
		});
	}, []);

	const payVisaInvoice = useCallback(() => {
		const now = new Date().toISOString();
		setApplication((prev) => {
			const amount = prev.visaInvoice.actualAmount ?? prev.visaInvoice.amount ?? VISA_INVOICE_AMOUNT;
			return {
				...prev,
				visaInvoice: {
					...prev.visaInvoice,
					status: "paid",
					paidAt: now,
					id: prev.visaInvoice.id ?? `INV-VISA-${Date.now().toString(36).toUpperCase()}`,
					amount,
					actualAmount: prev.visaInvoice.actualAmount ?? amount,
					actualLines: prev.visaInvoice.actualLines.length
						? prev.visaInvoice.actualLines
						: prev.visaInvoice.estimateLines,
					description: prev.visaInvoice.description,
				},
				visaStatus: "pending",
				visaUpdatedAt: now,
				counselorNote: `Visa payment received: ${formatDualCurrency(amount)}. Visa process & tracking started.`,
			};
		});
	}, []);

	const addSchoolApplication = useCallback(
		(input: {
			destinationId: string;
			universityId: string;
			programId: string;
			intake: string;
		}) => {
			const now = new Date().toISOString();
			const row: SchoolApplicationTrack = {
				id: `SCH-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 99)}`,
				...input,
				status: "queued",
				handlerNote: "Queued - waiting for application invoice payment to start process.",
				financialNote: null,
				events: [
					{
						at: now,
						status: "queued",
						note: "School added to your application list.",
					},
				],
				createdAt: now,
				updatedAt: now,
				trackStartedAt: null,
				offerTuitionUsd: null,
				offerTuitionLabel: null,
				offerDepositUsd: null,
				offerDepositDueAt: null,
				offerDepositPaidAt: null,
			};
			setSchoolApplications((prev) => [...prev, row]);
		},
		[],
	);

	const removeSchoolApplication = useCallback((id: string) => {
		setSchoolApplications((prev) => prev.filter((s) => s.id !== id));
	}, []);

	const lockSchoolSelection = useCallback(() => {
		submitSchoolApplication();
	}, [submitSchoolApplication]);

	const updateSchoolTrack = useCallback(
		(
			id: string,
			patch: Partial<Pick<SchoolApplicationTrack, "status" | "handlerNote" | "financialNote">>,
		) => {
			const now = new Date().toISOString();
			setSchoolApplications((prev) =>
				prev.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now } : s)),
			);
		},
		[],
	);

	const chooseSchoolPackage = useCallback(
		(funding: SchoolFundingTrack, level: SchoolDegreeLevel) => {
			const fund = SCHOOL_FUNDING_TRACKS.find((f) => f.id === funding);
			const deg = SCHOOL_DEGREE_LEVELS.find((d) => d.id === level);
			const now = new Date().toISOString();
			const id = `${funding}-${level}`;
			// Agency estimate comes from the shared service package catalogue
			const agencyBase = serviceFeeFor(funding);
			setApplication((prev) => ({
				...prev,
				applicationPackageId: id,
				schoolFundingTrack: funding,
				schoolDegreeLevel: level,
				packageChosenAt: now,
				agencyTotal: agencyBase,
				agencyPaid: 0,
				agencyDepositPaid: false,
				agencyStageIndex: 0,
				agencySettledAt: null,
				postArrivalSchedule: null,
				postArrivalPaymentIndex: 0,
				counselorNote: `School package set: ${fund?.name ?? funding} · ${deg?.name ?? level}. You may pay the application invoice and select schools.`,
			}));
		},
		[],
	);

	const choosePaymentPlan = useCallback((planId: PaymentPlanId) => {
		const now = new Date().toISOString();
		setApplication((prev) => {
			const baseAgency = prev.agencyTotal || serviceFeeFor(prev.schoolFundingTrack);
			return {
				...prev,
				paymentPlanId: planId,
				paymentPlanChosenAt: now,
				agencyTotal: baseAgency,
				postArrivalSchedule: planId === "installment" ? prev.postArrivalSchedule : null,
				postArrivalPaymentIndex: planId === "installment" ? prev.postArrivalPaymentIndex : 0,
				counselorNote:
					planId === "full"
						? "Full payment plan selected. Settle the remaining balance when ready — can continue after departure."
						: "Installment plan selected. Pay the pre-departure milestone, then choose a post-arrival schedule.",
			};
		});
	}, []);

	const choosePostArrivalSchedule = useCallback((scheduleId: string) => {
		setApplication((prev) => ({
			...prev,
			postArrivalSchedule: scheduleId,
			postArrivalPaymentIndex: 0,
			counselorNote: `Post-arrival schedule set to ${scheduleId}. Payments start after a grace period following arrival.`,
		}));
	}, []);

	/**
	 * Initiate an agency service-fee payment through Paystack hosted checkout.
	 *
	 * The server resolves the agency invoice and outstanding balance from the
	 * session, returns a Paystack `authorizationUrl`, and we redirect the
	 * browser there — same pattern as `paystackCheckout` for stage invoices.
	 * On return, `PortalPayCallback` detects `?type=agency` and re-syncs
	 * the authoritative agency invoice state from the server via
	 * `syncFromServer`, which maps the invoice's `paidCents`/`balanceCents`
	 * onto `agencyPaid` / `agencyDepositPaid` / `agencyStageIndex` /
	 * `agencySettledAt`. Local-only settlement (the old `setApplication` step
	 * math) is gone — the server is now the source of truth.
	 *
	 * Errors (e.g. "No agency invoice found") propagate to the caller so the
	 * Financial page can surface them instead of silently mutating state.
	 */
	const payAgencyInstallment = useCallback(async () => {
		const { authorizationUrl } = await meApi.agencyPayment();
		if (authorizationUrl && /^https?:\/\//i.test(authorizationUrl)) {
			window.location.href = authorizationUrl;
			return;
		}
		throw new Error("Could not initialize Paystack checkout.");
	}, []);

	const updateBooking = useCallback((patch: Partial<BookingData>) => {
		setBooking((prev) => ({ ...prev, ...patch }));
	}, []);

	const updateAssessment = useCallback((patch: Partial<AssessmentData>) => {
		setBooking((prev) => ({
			...prev,
			assessment: { ...prev.assessment, ...patch },
		}));
	}, []);

	const updateAssessmentDoc = useCallback((id: string, fileName: string | null, documentId?: string | null) => {
		setBooking((prev) => ({
			...prev,
			assessmentDocs: {
				...prev.assessmentDocs,
				[id]: fileName
					? { fileName, uploadedAt: new Date().toISOString(), documentId: documentId ?? prev.assessmentDocs[id]?.documentId ?? null }
					: { fileName: null, uploadedAt: null, documentId: null },
			},
		}));
	}, []);

	const setBookingStep = useCallback((step: number) => {
		setBooking((prev) => ({ ...prev, step }));
	}, []);

	const resetBooking = useCallback(() => {
		setBooking({
			...defaultBooking,
			assessment: { ...defaultAssessment },
			assessmentDocs: { ...defaultAssessmentDocs },
		});
		localStorage.removeItem(BOOKING_STORAGE_KEY);
	}, []);

	const generateBookingId = useCallback(() => {
		const n = Math.floor(Math.random() * 900000) + 100000;
		const id = `CNT-CONS-${n}`;
		setBooking((prev) => ({ ...prev, confirmationId: id }));
		return id;
	}, []);

	const completeConsultationPayment = useCallback(() => {
		const n = Math.floor(Math.random() * 900000) + 100000;
		const id = `CNT-CONS-${n}`;
		const now = new Date().toISOString();
		setBooking((prev) => {
			const isOnline = prev.consultationType === "online";
			const meetingLink = isOnline
				? `https://meet.google.com/century-nit-${id.toLowerCase().replace(/[^a-z0-9]/g, "")}`
				: null;
			return {
				...prev,
				confirmationId: id,
				paymentStatus: "success",
				paidAt: now,
				consultationPhase: "awaiting_confirmation",
				consultantName: null,
				consultantId: null,
				eligibilityOutcome: "pending",
				eligibilityNote: "Payment received. Your booking is awaiting confirmation from the branch.",
				step: 8,
				meetingLink,
			};
		});
		return id;
	}, []);

	const setEligibilityOutcome = useCallback(
		(outcome: EligibilityOutcome, note?: string) => {
			const notes: Record<EligibilityOutcome, string> = {
				pending: "Awaiting consultant assessment.",
				eligible:
					"You are eligible to continue to the official application stage with Century NIT.",
				conditional:
					"Conditionally eligible - complete the outstanding items noted by your consultant, then apply.",
				needs_info:
					"Additional information is required before we can confirm eligibility. Check your email.",
				not_eligible:
					"Based on the consultation, you are not eligible for the pathways discussed at this time.",
			};
			setBooking((prev) => ({
				...prev,
				eligibilityOutcome: outcome,
				eligibilityNote: note ?? notes[outcome],
				outcomeAt: new Date().toISOString(),
				consultationPhase: "outcome",
			}));
		},
		[],
	);

	const updateInterview = useCallback((patch: Partial<InterviewBooking>) => {
		setInterview((prev) => ({ ...prev, ...patch }));
	}, []);

	const confirmInterview = useCallback((slotId: string) => {
		const code = `INT-${Date.now().toString(36).toUpperCase()}`;
		setInterview((prev) => ({
			...prev,
			slotId,
			confirmedAt: new Date().toISOString(),
			confirmationCode: code,
		}));
		return code;
	}, []);

	const signIn = useCallback((user: Omit<AuthUser, "signedInAt">) => {
		const next: AuthUser = {
			...user,
			signedInAt: new Date().toISOString(),
		};
		setAuthUser(next);
		setSessionStatus("authenticated");
		setApplication((prev) => {
			const isPhoneAuth = user.method === "phone";
			return {
				...prev,
				email: prev.email || (isPhoneAuth ? "" : user.email),
				firstName: prev.firstName || user.name.split(" ")[0] || "",
				lastName: prev.lastName || user.name.split(" ").slice(1).join(" ") || "",
			};
		});
	}, []);

	const signOut = useCallback(async () => {
		try {
			await authSignOut();
		} finally {
			// Server-first: the error propagates to the caller so the UI can tell
			// the user their session is still live on the server, but local state
			// is cleared either way.
			setAuthUser(null);
			safeRemoveItem(AUTH_STORAGE_KEY);
			setSessionStatus("unauthenticated");
		}
	}, []);

	/**
	 * Re-validate the session against the server. Runs on mount and on every
	 * window focus. While in flight `sessionStatus` is "checking"; a confirmed
	 * session flips it to "authenticated" (through `signIn`), and a missing or
	 * failed session clears the locally-cached user and marks it
	 * "unauthenticated" so stale `AUTH_STORAGE_KEY` data cannot force the
	 * portal open.
	 */
	const probeSession = useCallback(async () => {
		try {
			const data = await getCurrentSession();
			if (data?.user) {
				signIn({
					id: data.user.id,
					method: "email",
					name: data.user.name || data.user.email.split("@")[0] || "Applicant",
					email: data.user.email,
					image: data.user.image ?? null,
				});
			} else {
				setAuthUser(null);
				safeRemoveItem(AUTH_STORAGE_KEY);
				setSessionStatus("unauthenticated");
			}
		} catch {
			setAuthUser(null);
			safeRemoveItem(AUTH_STORAGE_KEY);
			setSessionStatus("unauthenticated");
		}
	}, [signIn]);

	useEffect(() => {
		void probeSession();
	}, [probeSession]);

	useEffect(() => {
		const onFocus = () => void probeSession();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [probeSession]);

	const updateAccount = useCallback((patch: { name: string; email: string }) => {
		const name = patch.name.trim();
		const email = patch.email.trim();
		const parts = name.split(/\s+/);
		setAuthUser((prev) => (prev ? { ...prev, name, email } : prev));
		setApplication((app) => ({
			...app,
			email,
			firstName: app.firstName || parts[0] || "",
			lastName: app.lastName || parts.slice(1).join(" ") || "",
		}));
		setBooking((b) => ({
			...b,
			assessment: { ...b.assessment, email },
		}));
	}, []);

	/** Flip the avatar flag after an upload or removal, so every avatar rerenders. */
	const setAvatarImage = useCallback((image: string | null) => {
		setAuthUser((prev) => (prev ? { ...prev, image } : prev));
	}, []);

	const sendMessage = useCallback((text: string) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		const msg: ChatMessage = {
			id: `msg-${Date.now().toString(36)}`,
			sender: "applicant",
			authorName: "You",
			text: trimmed,
			at: new Date().toISOString(),
		};
		setMessages((prev) => [...prev, msg]);
	}, []);

	const pushNotification = useCallback(
		(n: Omit<AppNotification, "id" | "at" | "read">) => {
			const notif: AppNotification = {
				...n,
				id: `ntf-${Date.now().toString(36)}`,
				at: new Date().toISOString(),
				read: false,
			};
			setNotifications((prev) => [notif, ...prev]);
		},
		[],
	);

	const markNotificationRead = useCallback((id: string) => {
		setNotifications((prev) =>
			prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
		);
		void meApi.markNotificationRead(id).catch(() => { /* keep local */ });
	}, []);

	const markAllNotificationsRead = useCallback(() => {
		setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
		void meApi.markAllNotificationsRead().catch(() => { /* keep local */ });
	}, []);

	const revealOutcome = useCallback(async () => {
		// Read the actual outcome from the server rather than forcing "eligible".
		// If the consultant hasn't posted one yet, we surface "Pending" instead.
		let outcome: EligibilityOutcome = "pending";
		let note =
			"Pending — your consultant has not posted an eligibility outcome yet.";
		try {
			const res = await meApi.application();
			const result = res.consultation?.assessmentResult;
			if (result?.outcome) {
				const o = result.outcome.toLowerCase();
				outcome =
					o === "eligible"
						? "eligible"
						: o.includes("conditional")
							? "conditional"
							: o.includes("ineligible") || o.includes("not eligible")
								? "not_eligible"
								: o.includes("info")
									? "needs_info"
									: "pending";
				if (result.notes) note = result.notes;
			}
		} catch {
			/* keep the "Pending" defaults — do not force a value */
		}
		setBooking((prev) => {
			if (prev.consultationPhase !== "assessment_complete") return prev;
			return {
				...prev,
				consultationPhase: "outcome",
				eligibilityOutcome: outcome,
				outcomeAt: new Date().toISOString(),
				eligibilityNote: note,
			};
		});
		pushNotification({
			type: "stage",
			title: "Eligibility outcome viewed",
			body:
				outcome === "eligible"
					? "You are eligible. Check your recommendations and next steps."
					: "Your eligibility outcome is now available.",
			link: "/portal/consultation",
		});
	}, [pushNotification]);

	const togglePreDepartureTask = useCallback((id: string) => {
		setPreDepartureTasks((prev) => {
			const next = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
			// Mirror completion onto the application — the travel stage reads it
			const allDone = next.every((t) => t.done);
			setApplication((app) =>
				allDone === Boolean(app.preDepartureCompletedAt)
					? app
					: { ...app, preDepartureCompletedAt: allDone ? new Date().toISOString() : null },
			);
			return next;
		});
	}, []);

	/**
	 * Sync real server consultation, assignment, eligibility and applicant profile
	 * with AppState. Runs on mount and then polls every 30 seconds so assignment
	 * and eligibility decisions from ops appear without requiring a page reload.
	 */
	const syncFromServer = useCallback(async () => {
		if (!authUser) return;
		try {
			const res = await meApi.application();
			if (res.consultation) {
				const c = res.consultation;
			const phase: BookingData["consultationPhase"] =
				c.status === "CANCELLED"
					? "cancelled"
					: c.status === "COMPLETED"
						? "outcome"
						: c.status === "IN_ASSESSMENT"
							? "assessment"
							: c.status === "ASSIGNED" || c.assignedOfficerId
								? c.slotConfirmed
									? "awaiting_assignment_confirmation"
									: "assigned"
								: c.slotConfirmed
									? "awaiting_assignment"
									: "awaiting_confirmation";
			const outcome: EligibilityOutcome =
				c.assessmentResult?.outcome?.toLowerCase() === "eligible"
					? "eligible"
					: c.assessmentResult?.outcome?.toLowerCase().includes("conditional")
						? "conditional"
						: c.assessmentResult?.outcome?.toLowerCase().includes("ineligible")
							? "not_eligible"
							: "pending";
				setBooking((prev) => ({
					...prev,
					confirmationId: c.reference,
					consultationType: (c.type === "in_person" ? "in_person" : "online") as any,
					branchId: c.branch,
					consultantName: c.assignedOfficerName ?? prev.consultantName,
					consultantId: c.assignedOfficerId ?? prev.consultantId,
					consultationPhase: phase,
					eligibilityOutcome: outcome,
					eligibilityNote:
						c.assessmentResult?.notes ||
						(c.status === "COMPLETED"
							? "Assessment complete. You are eligible to continue."
							: "Your consultation case is under review by your advisor."),
					outcomeAt: c.status === "COMPLETED" ? c.updatedAt : prev.outcomeAt,
					paymentStatus: "success",
					paidAt: c.createdAt,
					meetingLink: c.meetingUrl ?? prev.meetingLink,
					date: c.startsAt ? c.startsAt.slice(0, 10) : prev.date,
				}));
			}
			if (res.applicant) {
				const a = res.applicant;
				setApplication((prev) => ({
					...prev,
					firstName: prev.firstName || a.name.split(" ")[0] || "",
					lastName: prev.lastName || a.name.split(" ").slice(1).join(" ") || "",
					phone: prev.phone || a.phone || "",
					nationality: prev.nationality || a.profile?.nationality || "",
					destinationId: prev.destinationId || a.targetCountry || "",
				}));
			}
		if (res.application) {
			const a = res.application;
			setApplication((prev) => ({
				...prev,
				applicationId: a.id || prev.applicationId,
				destinationId: a.country || prev.destinationId,
				universityId: a.university || prev.universityId,
				programId: a.program || prev.programId,
				schoolFundingTrack: (a.fundingTrack as SchoolFundingTrack) || prev.schoolFundingTrack,
				schoolDegreeLevel: (a.degreeLevel as SchoolDegreeLevel) || prev.schoolDegreeLevel,
				visaStatus: (a.visaStage as VisaStatus) || prev.visaStatus,
				// Authoritative coarse journey stage from `applications.stage`.
				// `getCurrentProcessStage` floors the fine-grained
				// `ProcessStageId` off this value via `JOURNEY_STAGE_TO_PORTAL`.
				journeyStage: a.stage ?? prev.journeyStage,
			}));
		}
		} catch {
			/* server state fallback — keep local values */
		}

		/* ── Sync portal state (pre-departure tasks, post-arrival schedules) ── */
		try {
			const ps = await meApi.portalState();
			if (ps && typeof ps === "object") {
				if (Array.isArray(ps.preDepartureTasks) && ps.preDepartureTasks.length > 0) {
					setPreDepartureTasks((prev) => {
						const serverTasks = ps.preDepartureTasks as PreDepartureTask[];
						return prev.map((t) => {
							const server = serverTasks.find((s) => s.id === t.id);
							return server ?? t;
						});
					});
				}
				if (ps.postArrivalScheduleId) {
					setApplication((prev) => ({
						...prev,
						postArrivalSchedule: ps.postArrivalScheduleId as string,
					}));
				}
				if (Array.isArray(ps.enabledPostArrivalSchedules)) {
					setEnabledPostArrivalSchedules(ps.enabledPostArrivalSchedules as string[]);
				}
				if (Array.isArray(ps.customPostArrivalSchedules) && ps.customPostArrivalSchedules.length > 0) {
					setCustomPostArrivalSchedules(ps.customPostArrivalSchedules as any);
				}
			}
		} catch {
			/* keep local values */
		}

		/* ── Sync in-app notifications from server ── */
		try {
			const notifRes = await meApi.notifications();
			const serverNotifs: AppNotification[] = (notifRes?.notifications ?? []).map((n) => ({
				id: n.id,
				type: n.type as AppNotification["type"],
				title: n.title,
				body: n.body,
				read: n.read,
				at: n.createdAt,
				link: n.link ?? undefined,
			}));
			setNotifications(serverNotifs);
		} catch {
			/* keep local values */
		}

		/* ── Sync agency service-fee invoice (Stage IV settlement) ──
		 * The agency invoice is the server's record of truth for the service
		 * fee. Map its paid/balance cents onto the local agency state so the
		 * Financial page reflects real settlement progress after a Paystack
		 * return (and on every poll). Deposit is "paid" once any money lands;
		 * stage index is derived from how far through the plan the payments
		 * have gone (deposit 10% → pre-departure +50% → post-arrival 40%). */
		try {
			const { invoices: agencyInvoices } = await invoicesApi.list({ type: "agency" });
			const agencyInvoice = agencyInvoices[0];
			if (agencyInvoice) {
				const totalUsd = agencyInvoice.subtotalCents / 100;
				const paidUsd = agencyInvoice.paidCents / 100;
				const settled = agencyInvoice.balanceCents === 0 && agencyInvoice.paidCents > 0;
				const depositThreshold = totalUsd * AGENCY_DEPOSIT_PORTION;
				const depositPaid = paidUsd > 0 && paidUsd >= depositThreshold - 0.5;
				const preDepDone = paidUsd >= depositThreshold + totalUsd * 0.5 - 0.5;
				setApplication((prev) => ({
					...prev,
					agencyTotal: totalUsd > 0 ? totalUsd : prev.agencyTotal,
					agencyPaid: paidUsd,
					agencyDepositPaid: depositPaid,
					agencyStageIndex: settled
						? (prev.paymentPlanId === "full" ? 3 : 1)
						: preDepDone
							? 1
							: 0,
					agencySettledAt: settled ? agencyInvoice.updatedAt : null,
					completedAt:
						settled && prev.visaStatus === "complete"
							? agencyInvoice.updatedAt
							: prev.completedAt,
				}));
			}
		} catch {
			/* keep local values — server may be unreachable */
		}
	}, [authUser]);

	/** Run on mount */
	useEffect(() => {
		void syncFromServer();
	}, [syncFromServer]);

	/** Poll every 30 seconds to surface assignment / eligibility from ops */
	useEffect(() => {
		if (!authUser) return;
		const id = window.setInterval(() => void syncFromServer(), 30_000);
		return () => window.clearInterval(id);
	}, [authUser, syncFromServer]);

	/**
	 * Real-time notifications via Server-Sent Events. SSE is the primary
	 * delivery channel; the 30s `syncFromServer` poll (above) is a fallback
	 * that catches anything missed while the stream is disconnected. The
	 * `EventSource` is same-origin against the portal's `/api/v1` proxy, so
	 * it rides the existing auth cookie — no headers needed.
	 */
	useEffect(() => {
		if (!authUser) return;
		const url = `${API_PREFIX}/events/stream`;
		const es = new EventSource(url);

		es.addEventListener("connected", () => {
			console.log("[SSE] notifications stream connected");
		});

		es.addEventListener("notification", (event) => {
			try {
				const data = JSON.parse((event as MessageEvent).data) as {
					id: string;
					type: string;
					title: string;
					body: string;
					link: string | null;
					createdAt: string;
				};
				const notif: AppNotification = {
					id: data.id,
					type: data.type as AppNotification["type"],
					title: data.title,
					body: data.body,
					at: data.createdAt,
					read: false,
					link: data.link ?? undefined,
				};
				setNotifications((prev) =>
					prev.some((n) => n.id === notif.id) ? prev : [notif, ...prev],
				);
			} catch {
				/* ignore malformed payloads */
			}
		});

		es.addEventListener("error", () => {
			// EventSource auto-reconnects; just log for debugging.
			console.warn("[SSE] notifications stream error — reconnecting");
		});

		return () => {
			es.close();
		};
	}, [authUser]);

	const unreadCount = useMemo(
		() => notifications.filter((n) => !n.read).length,
		[notifications],
	);

	const preDepartureProgress = useMemo(() => {
		const done = preDepartureTasks.filter((t) => t.done).length;
		return Math.round((done / preDepartureTasks.length) * 100);
	}, [preDepartureTasks]);

	const processStage = useMemo(
		() => getCurrentProcessStage(application, booking, schoolApplications),
		[application, booking, schoolApplications],
	);
	const chapterUnlocks = useMemo(
		() => getChapterUnlocks(application, booking, schoolApplications),
		[application, booking, schoolApplications],
	);
	const journeyPhase = useMemo(
		() => getJourneyPhase(application, booking, schoolApplications),
		[application, booking, schoolApplications],
	);

	// ── Server-driven journey stage ───────────────────────────────────────
	// When the user is authenticated, fetch the authoritative stage from the
	// API and prefer it over the locally computed one.  Falls back to local
	// on network error so the portal never breaks.
	//
	// The server may return either:
	//   • `currentStage` — the coarse `JourneyStage` enum value (e.g.
	//     "visa_processing"), which we map via `JOURNEY_STAGE_TO_PORTAL`, or
	//   • `portalStage` — the already-mapped fine-grained `ProcessStageId`,
	//     preferred when present (lets the server override the mapping).
	type ServerJourney = {
		currentStage: string;
		portalStage?: string;
		chapterUnlocks: Record<string, boolean>;
		label: string;
		nextUnlock: string | null;
	};
	const [serverJourney, setServerJourney] = useState<ServerJourney | null>(
		null,
	);

	useEffect(() => {
		if (!authUser) {
			setServerJourney(null);
			return;
		}
		let cancelled = false;
		meApi
			.journey()
			.then((j: ServerJourney) => {
				if (!cancelled) setServerJourney(j);
			})
			.catch(() => {
				/* keep local fallback */
			});
		return () => {
			cancelled = true;
		};
	}, [authUser]);

	const effectiveJourneyPhase = useMemo(() => {
		if (serverJourney) {
			// Prefer an explicit `portalStage` from the server; otherwise map
			// the coarse `currentStage` (a `JourneyStage`) through the shared
			// `JOURNEY_STAGE_TO_PORTAL` table. If `currentStage` isn't a known
			// `JourneyStage` (older server still emitting a `ProcessStageId`),
			// fall back to using it directly so the portal doesn't regress.
			let stageId: ProcessStageId;
			if (serverJourney.portalStage) {
				stageId = serverJourney.portalStage as ProcessStageId;
			} else if (
				serverJourney.currentStage &&
				serverJourney.currentStage in JOURNEY_STAGE_TO_PORTAL
			) {
				stageId = JOURNEY_STAGE_TO_PORTAL[
					serverJourney.currentStage as JourneyStage
				] as ProcessStageId;
			} else {
				stageId = serverJourney.currentStage as ProcessStageId;
			}
			const meta = PROCESS_STAGES.find((s) => s.id === stageId)!;
			return {
				phase: meta.index,
				label: serverJourney.label,
				nextUnlock: serverJourney.nextUnlock,
				stage: stageId,
			};
		}
		return journeyPhase;
	}, [serverJourney, journeyPhase]);

	const value = useMemo(
		() => ({
			application,
			updateApplication,
			setApplicationStep,
			resetApplication,
			resetJourney,
			generateApplicationId,
			completeProfile,
			markDocsReady,
			submitSchoolApplication,
			raiseApplicationInvoice,
			payApplicationInvoice,
			raiseVisaInvoice,
			payVisaInvoice,
			chooseSchoolPackage,
			choosePaymentPlan,
			choosePostArrivalSchedule,
			enabledPostArrivalSchedules,
			setEnabledPostArrivalSchedules: (ids: string[] | null) => {
				setEnabledPostArrivalSchedules(ids);
				try {
					if (ids) safeSetJSON("century-nit-enabled-schedules", ids);
					else localStorage.removeItem("century-nit-enabled-schedules");
				} catch { /* ignore */ }
			},
			customPostArrivalSchedules,
			setCustomPostArrivalSchedules: (schedules: { id: string; label: string; detail: string; payments: number; intervalDays: number; graceDays: number }[]) => {
				setCustomPostArrivalSchedules(schedules);
				try {
					safeSetJSON("century-nit-custom-schedules", schedules);
				} catch { /* ignore */ }
			},
			payAgencyInstallment,
			schoolApplications,
			setSchoolApplications,
			addSchoolApplication,
			removeSchoolApplication,
			lockSchoolSelection,
			updateSchoolTrack,
			applicationFee: APPLICATION_FEE,
			applicationStageFee: APP_INVOICE_BASE,
			visaStageFee: VISA_STAGE_FEE,
			autosaveLabel,
			chapterUnlocks,
			journeyPhase: effectiveJourneyPhase,
			processStage,
			booking,
			updateBooking,
			updateAssessment,
			updateAssessmentDoc,
			setBookingStep,
			resetBooking,
			generateBookingId,
			completeConsultationPayment,
			setEligibilityOutcome,
			revealOutcome,
			interview,
			updateInterview,
			confirmInterview,
			authUser,
			isAuthenticated: Boolean(authUser),
			sessionStatus,
			signIn,
			signOut,
			updateAccount,
			setAvatarImage,
			messages,
			sendMessage,
			notifications,
			unreadCount,
			markNotificationRead,
			markAllNotificationsRead,
			pushNotification,
			preDepartureTasks,
			togglePreDepartureTask,
			preDepartureProgress,
			syncFromServer,
		}),
		[
			application,
			updateApplication,
			setApplicationStep,
			resetApplication,
			resetJourney,
			generateApplicationId,
			completeProfile,
			markDocsReady,
			submitSchoolApplication,
			raiseApplicationInvoice,
			payApplicationInvoice,
			raiseVisaInvoice,
			payVisaInvoice,
			chooseSchoolPackage,
			choosePaymentPlan,
			choosePostArrivalSchedule,
			enabledPostArrivalSchedules,
			setEnabledPostArrivalSchedules,
			customPostArrivalSchedules,
			payAgencyInstallment,
			schoolApplications,
			setSchoolApplications,
			addSchoolApplication,
			removeSchoolApplication,
			lockSchoolSelection,
			updateSchoolTrack,
			autosaveLabel,
			chapterUnlocks,
			effectiveJourneyPhase,
			processStage,
			booking,
			updateBooking,
			updateAssessment,
			updateAssessmentDoc,
			setBookingStep,
			resetBooking,
			generateBookingId,
			completeConsultationPayment,
			setEligibilityOutcome,
			revealOutcome,
			interview,
			updateInterview,
			confirmInterview,
			authUser,
			sessionStatus,
			signIn,
			signOut,
			updateAccount,
			setAvatarImage,
			messages,
			sendMessage,
			notifications,
			unreadCount,
			markNotificationRead,
			markAllNotificationsRead,
			pushNotification,
			preDepartureTasks,
			togglePreDepartureTask,
			preDepartureProgress,
			syncFromServer,
		],
	);

	return (
		<AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
	);
}

export function useAppState() {
	const ctx = useContext(AppStateContext);
	if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
	return ctx;
}
