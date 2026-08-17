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
import { safeGetJSON, safeRemoveItem, safeSetItem, safeSetJSON, meApi } from "century-nit-core";
import {
	APPLICATION_FEE,
	APP_INVOICE_BASE,
	AUTH_STORAGE_KEY,
	BOOKING_STORAGE_KEY,
	formatDualCurrency,
	MESSAGES_KEY,
	NOTIFICATIONS_KEY,
	PORTAL_INTERVIEW_KEY,
	PRE_DEPARTURE_KEY,
	PRE_DEPARTURE_TASKS,
	PROCESS_STAGES,
	SCHOOL_APPS_KEY,
	SCHOOL_DEGREE_LEVELS,
	SCHOOL_FUNDING_TRACKS,
	AGENCY_DEPOSIT_PORTION,
	POST_ARRIVAL_SCHEDULES,
	serviceFeeFor,
	SEED_MESSAGES,
	SEED_NOTIFICATIONS,
	STORAGE_KEY,
	VISA_INVOICE_AMOUNT,
	VISA_STAGE_FEE,
	appInvoiceActualLines,
	getProgram,
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

/** Toggles the built-in consultant/finance timers - see `simAutopilot`. */
const SIM_AUTOPILOT_KEY = "century-nit-sim-autopilot";

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
		| "outcome";
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
	passport: { fileName: null, uploadedAt: null },
	certificates: { fileName: null, uploadedAt: null },
	transcripts: { fileName: null, uploadedAt: null },
	cv: { fileName: null, uploadedAt: null },
	english: { fileName: null, uploadedAt: null },
	financial: { fileName: null, uploadedAt: null },
	sponsorship: { fileName: null, uploadedAt: null },
	additional: { fileName: null, uploadedAt: null },
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
 */
export function getCurrentProcessStage(
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

/** Progressive unlocks - next stage opens when prior step is done */
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

	return {
		journey: true,
		consultation: true,
		package: eligible,
		application: eligible && pkg,
		// Tracking is its own page - only after application invoice paid
		tracking: appPaid && Boolean(app.schoolSelectionDoneAt),
		visa: admitted,
		// Travel opens on visa approval; the service fee gates it from inside
		pre_departure: admitted && visaPaid && visaDone,
		// Completion needs the travel checklist finished, not a payment state
		complete: Boolean(app.preDepartureCompletedAt),
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
	payAgencyInstallment: () => void;
	/** Multi-school tracking (no new docs - consultation already has them) */
	schoolApplications: SchoolApplicationTrack[];
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
	/** When true, timers simulate the consultant/finance side (solo portal demo). */
	simAutopilot: boolean;
	setSimAutopilot: (on: boolean) => void;
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
	const [simAutopilot, setSimAutopilotState] = useState<boolean>(() => {
		try {
			return localStorage.getItem(SIM_AUTOPILOT_KEY) !== "off";
		} catch {
			return true;
		}
	});

	const setSimAutopilot = useCallback((on: boolean) => {
		setSimAutopilotState(on);
		try {
			safeSetItem(SIM_AUTOPILOT_KEY, on ? "on" : "off");
		} catch {
			/* storage unavailable - keep the in-memory value */
		}
	}, []);

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

	const [notifications, setNotifications] = useState<AppNotification[]>(() => {
		try {
			const raw = localStorage.getItem(NOTIFICATIONS_KEY);
			if (!raw) return SEED_NOTIFICATIONS;
			const parsed = JSON.parse(raw) as AppNotification[];
			return Array.isArray(parsed) ? parsed : SEED_NOTIFICATIONS;
		} catch {
			return SEED_NOTIFICATIONS;
		}
	});

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
		safeSetJSON(NOTIFICATIONS_KEY, notifications);
	}, [notifications]);

	useEffect(() => {
		safeSetJSON(PRE_DEPARTURE_KEY, preDepartureTasks);
	}, [preDepartureTasks]);

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

	/** Consultant issues the ACTUAL application invoice (estimated → raised) */
	useEffect(() => {
		if (!simAutopilot) return; // ops issues this instead
		if (application.applicationInvoice.status !== "estimated") return;
		const t = window.setTimeout(() => {
			setApplication((prev) => {
				if (prev.applicationInvoice.status !== "estimated") return prev;
				const count = schoolApplications.length || 1;
				const actualLines = appInvoiceActualLines(count);
				const actual = sumInvoiceLines(actualLines);
				const now = new Date().toISOString();
				return {
					...prev,
					applicationInvoice: {
						...prev.applicationInvoice,
						status: "raised",
						raisedAt: prev.applicationInvoice.raisedAt ?? now,
						amount: actual,
						actualAmount: actual,
						actualLines,
						consultantNote:
							"Actual invoice confirmed after review of your school list and document pack.",
					},
					counselorNote: `Actual invoice issued: ${formatDualCurrency(actual)} (estimated ${formatDualCurrency(prev.applicationInvoice.estimatedAmount)}).`,
				};
			});
		}, 5000);
		return () => window.clearTimeout(t);
	}, [simAutopilot, application.applicationInvoice.status, schoolApplications.length]);

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

	/** Consultant issues the ACTUAL visa invoice (estimated → raised) */
	useEffect(() => {
		if (!simAutopilot) return; // ops issues this instead
		if (application.visaInvoice.status !== "estimated") return;
		const t = window.setTimeout(() => {
			setApplication((prev) => {
				if (prev.visaInvoice.status !== "estimated") return prev;
				const actualLines = visaInvoiceActualLines();
				const actual = sumInvoiceLines(actualLines);
				const now = new Date().toISOString();
				return {
					...prev,
					visaInvoice: {
						...prev.visaInvoice,
						status: "raised",
						raisedAt: prev.visaInvoice.raisedAt ?? now,
						amount: actual,
						actualAmount: actual,
						actualLines,
						consultantNote: "Actual invoice confirmed after case file preparation.",
					},
					counselorNote: `Actual visa invoice issued: ${formatDualCurrency(actual)} (estimated ${formatDualCurrency(prev.visaInvoice.estimatedAmount)}).`,
				};
			});
		}, 5000);
		return () => window.clearTimeout(t);
	}, [application.visaInvoice.status]);

	/**
	 * Handler-side application tracking simulation (applicant is read-only).
	 * Advances: submitted → under_review → offer → accepted (first school).
	 */
	useEffect(() => {
		if (!isAppInvoicePaid(application) || !application.schoolSelectionDoneAt) return;
		const paidAt = application.applicationInvoice.paidAt;
		if (!paidAt) return;

		const paidMs = new Date(paidAt).getTime();
		if (Number.isNaN(paidMs)) return;

		const PIPELINE: {
			at: number;
			status: SchoolTrackStatus;
			note: string;
			financial?: string;
		}[] = [
			{
				at: 0,
				status: "submitted",
				note: "Handler filed your application with the institution desk.",
			},
			{
				at: 4_000,
				status: "under_review",
				note: "Institution is reviewing your file and documents on record.",
			},
			{
				at: 10_000,
				status: "offer",
				note: "Conditional / full offer received from the institution.",
				financial: "The university has set its tuition and the deposit that holds your place — the amount and deadline are in the offer terms above.",
			},
			{
				at: 16_000,
				status: "accepted",
				note: "Offer accepted by handler on your behalf for pathway progression (sim).",
				financial: "Your place is confirmed, which opens the visa stage with Century NIT. The tuition deposit is still paid directly to the university.",
			},
		];

		const applyProgress = () => {
			const nowIso = new Date().toISOString();
			setSchoolApplications((prev) => {
				let changed = false;
				const next = prev.map((s, i) => {
					// Terminal states (except we drive accepted via sim)
					if (s.status === "rejected" || s.status === "withdrawn") return s;

					const startMs = s.trackStartedAt
						? new Date(s.trackStartedAt).getTime()
						: paidMs + i * 3_000;
					const elapsed = Date.now() - startMs;
					if (elapsed < 0) return s;

					// First school reaches accepted; others stop at offer for variety
					const steps =
						i === 0 ? PIPELINE : PIPELINE.filter((p) => p.status !== "accepted");

					let target = steps[0];
					for (const step of steps) {
						if (elapsed >= step.at) target = step;
					}

					const order: SchoolTrackStatus[] = [
						"queued",
						"submitted",
						"under_review",
						"additional_info",
						"offer",
						"accepted",
					];
					const curIdx = order.indexOf(s.status);
					const tgtIdx = order.indexOf(target.status);
					if (tgtIdx <= curIdx && s.status !== "queued") {
						// Still ensure trackStartedAt is set
						if (!s.trackStartedAt) {
							changed = true;
							return { ...s, trackStartedAt: new Date(startMs).toISOString() };
						}
						return s;
					}

					const alreadyLogged = (s.events ?? []).some(
						(e) => e.status === target.status && e.note === target.note,
					);
					const financial =
						target.financial?.replace(
							"estimate",
							`$${8_000 + i * 500} est.`,
						) ?? s.financialNote;

					changed = true;
					const events = alreadyLogged
						? s.events ?? []
						: [
								...(s.events ?? []),
								{
									at: nowIso,
									status: target.status,
									note: target.note,
									financialNote: financial,
								},
							];

					// An offer carries real money: the institution's tuition and the
					// deposit that holds the place. Derived from the programme so the
					// figure agrees with what the schools board showed.
					const prog = getProgram(s.programId);
					const isOffer = target.status === "offer" || target.status === "accepted";
					const tuitionUsd = s.offerTuitionUsd ?? (isOffer ? (prog?.tuitionUsd ?? null) : null);
					const depositUsd =
						s.offerDepositUsd ??
						(isOffer && tuitionUsd ? Math.round((tuitionUsd * 0.2) / 50) * 50 : null);
					const depositDueAt =
						s.offerDepositDueAt ??
						(isOffer ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null);

					return {
						...s,
						status: target.status,
						handlerNote: target.note,
						financialNote: financial,
						events,
						offerTuitionUsd: tuitionUsd,
						offerTuitionLabel: s.offerTuitionLabel ?? (isOffer ? (prog?.tuition ?? null) : null),
						offerDepositUsd: depositUsd,
						offerDepositDueAt: depositDueAt,
						trackStartedAt: s.trackStartedAt ?? new Date(startMs).toISOString(),
						updatedAt: nowIso,
					};
				});
				return changed ? next : prev;
			});
		};

		applyProgress();
		const id = window.setInterval(applyProgress, 1_500);
		return () => window.clearInterval(id);
	}, [
		application.applicationInvoice.status,
		application.applicationInvoice.paidAt,
		application.schoolSelectionDoneAt,
	]);

	/** Visa tracking simulation only after visa invoice paid */
	useEffect(() => {
		if (application.visaInvoice.status !== "paid" || !application.visaInvoice.paidAt) return;
		if (application.visaStatus === "complete") return;

		const start = new Date(application.visaInvoice.paidAt).getTime();
		const steps: { at: number; status: VisaStatus; note: string }[] = [
			{ at: 0, status: "pending", note: "Visa case opened (simulated). Amount paid recorded." },
			{
				at: 5_000,
				status: "biometrics",
				note: "Biometrics / appointment window open (simulated).",
			},
			{
				at: 12_000,
				status: "decision",
				note: `Visa decision in progress. Fee paid: $${application.visaInvoice.amount} USD.`,
			},
			{
				at: 18_000,
				status: "complete",
				note: "Visa processing complete (simulated). Choose payment plan next.",
			},
		];
		const order: VisaStatus[] = ["locked", "pending", "biometrics", "decision", "complete"];

		const tick = () => {
			const elapsed = Date.now() - start;
			const step = [...steps].reverse().find((s) => elapsed >= s.at);
			if (!step) return;
			setApplication((prev) => {
				if (prev.visaStatus === "complete") return prev;
				const prevIdx = order.indexOf(prev.visaStatus);
				const nextIdx = order.indexOf(step.status);
				if (nextIdx <= prevIdx && prev.visaStatus !== "locked") return prev;
				const now = new Date().toISOString();
				return {
					...prev,
					visaStatus: step.status,
					visaUpdatedAt: now,
					counselorNote: step.note,
				};
			});
		};

		tick();
		const id = window.setInterval(tick, 1_000);
		return () => window.clearInterval(id);
	}, [
		application.visaInvoice.status,
		application.visaInvoice.paidAt,
		application.visaInvoice.amount,
		application.visaStatus,
	]);

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

	const payAgencyInstallment = useCallback(() => {
		setApplication((prev) => {
			if (prev.agencySettledAt) return prev;
			const total = prev.agencyTotal || serviceFeeFor(prev.schoolFundingTrack);
			const now = new Date().toISOString();

			// Step 1: Pay the deposit first (gates plan selection)
			if (!prev.agencyDepositPaid) {
				const depositAmount = Math.round(total * AGENCY_DEPOSIT_PORTION);
				return {
					...prev,
					agencyPaid: prev.agencyPaid + depositAmount,
					agencyDepositPaid: true,
					agencyStageIndex: 0,
					counselorNote: `Service fee deposit paid (${Math.round(AGENCY_DEPOSIT_PORTION * 100)}%). Choose your payment plan for the remaining balance.`,
				};
			}

			// Step 2+: Pay remaining balance per chosen plan
			const plan = prev.paymentPlanId;
			if (!plan) return prev; // deposit paid but no plan chosen yet

			if (plan === "full") {
				return {
					...prev,
					agencyPaid: total,
					agencyStageIndex: 3,
					agencySettledAt: now,
					completedAt: prev.visaStatus === "complete" ? now : prev.completedAt,
					counselorNote: "Service fee paid in full. Settlement complete.",
				};
			}

			// Installment plan:
			//   idx 0 = pre-departure (50% lump sum)
			//   idx 1 = post-arrival recurring payments (40% split per schedule)
			const idx = prev.agencyStageIndex;

			// Pre-departure milestone
			if (idx === 0) {
				const add = Math.round(total * 0.5);
				const paid = prev.agencyPaid + add;
				return {
					...prev,
					agencyPaid: paid,
					agencyStageIndex: 1,
					agencySettledAt: null,
					counselorNote: "Pre-departure milestone paid. Choose your post-arrival payment schedule.",
				};
			}

			// Post-arrival recurring payments
			if (idx >= 1) {
				const schedule = [...POST_ARRIVAL_SCHEDULES, ...customPostArrivalSchedulesRef.current].find((s) => s.id === prev.postArrivalSchedule);
				if (!schedule) return prev; // schedule not chosen yet

				const postArrivalTotal = Math.round(total * 0.4);
				const perPayment = Math.round(postArrivalTotal / schedule.payments);
				const payIdx = prev.postArrivalPaymentIndex;

				if (payIdx >= schedule.payments) {
					return {
						...prev,
						agencyPaid: total,
						agencySettledAt: now,
						completedAt: prev.visaStatus === "complete" ? now : prev.completedAt,
					};
				}

				const add = payIdx === schedule.payments - 1
					? total - prev.agencyPaid  // final payment: settle exact remainder
					: perPayment;
				const paid = Math.min(total, prev.agencyPaid + add);
				const nextPayIdx = payIdx + 1;
				const settled = nextPayIdx >= schedule.payments || paid >= total;

				return {
					...prev,
					agencyPaid: settled ? total : paid,
					agencyStageIndex: 1,
					postArrivalPaymentIndex: nextPayIdx,
					agencySettledAt: settled ? now : null,
					completedAt:
						settled && prev.visaStatus === "complete" ? now : prev.completedAt,
					counselorNote: settled
						? "All post-arrival payments complete. Service fee fully settled."
						: `Post-arrival payment ${nextPayIdx} of ${schedule.payments} recorded (${schedule.label}).`,
				};
			}

			return prev;
		});
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

	const updateAssessmentDoc = useCallback((id: string, fileName: string | null) => {
		setBooking((prev) => ({
			...prev,
			assessmentDocs: {
				...prev.assessmentDocs,
				[id]: fileName
					? { fileName, uploadedAt: new Date().toISOString() }
					: { fileName: null, uploadedAt: null },
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
	}, []);

	const markAllNotificationsRead = useCallback(() => {
		setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
	}, []);

	const revealOutcome = useCallback(() => {
		setBooking((prev) => {
			if (prev.consultationPhase !== "assessment_complete") return prev;
			return {
				...prev,
				consultationPhase: "outcome",
				eligibilityOutcome: "eligible",
				outcomeAt: new Date().toISOString(),
				eligibilityNote:
					"Eligible - the consultant recommends suitable countries, universities, and programmes. You may proceed to the official application stage.",
			};
		});
		pushNotification({
			type: "stage",
			title: "Eligibility outcome viewed",
			body: "You are eligible. Check your recommendations and next steps.",
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

	/** Pre-departure auto-simulation: once unlocked, tasks auto-complete one by one */
	useEffect(() => {
		if (!simAutopilot) return;
		// Travel opens once the visa is granted; the service fee gates it
		const visaDone = application.visaStatus === "complete";
		if (!visaDone || !isAgencySettled(application)) return;

		const id = window.setInterval(() => {
			setPreDepartureTasks((prev) => {
				const next = prev.find((t) => !t.done);
				if (!next) return prev;
				return prev.map((t) => (t.id === next.id ? { ...t, done: true } : t));
			});
		}, 3_000);

		return () => window.clearInterval(id);
	}, [simAutopilot, application.agencySettledAt, application.visaStatus]);

	/** Sync real server consultation & applicant profile with AppState */
	useEffect(() => {
		if (!authUser) return;
		let cancelled = false;
		meApi
			.application()
			.then((res) => {
				if (cancelled) return;
				if (res.consultation) {
					const c = res.consultation;
					const phase: BookingData["consultationPhase"] =
						c.status === "COMPLETED"
							? "outcome"
							: c.status === "IN_ASSESSMENT"
								? "assessment"
								: c.status === "ASSIGNED"
									? "assigned"
									: "confirmed";
					const outcome: EligibilityOutcome =
						c.assessmentResult?.outcome?.toLowerCase() === "eligible"
							? "eligible"
							: c.assessmentResult?.outcome?.toLowerCase() === "conditional"
								? "conditional"
								: c.assessmentResult?.outcome?.toLowerCase() === "ineligible"
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
			})
			.catch(() => {
				/* server state fallback */
			});
		return () => {
			cancelled = true;
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
	type ServerJourney = {
		currentStage: string;
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
			const meta = PROCESS_STAGES.find(
				(s) => s.id === serverJourney.currentStage,
			)!;
			return {
				phase: meta.index,
				label: serverJourney.label,
				nextUnlock: serverJourney.nextUnlock,
				stage: serverJourney.currentStage as ProcessStageId,
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
			addSchoolApplication,
			removeSchoolApplication,
			lockSchoolSelection,
			updateSchoolTrack,
			applicationFee: APPLICATION_FEE,
			applicationStageFee: APP_INVOICE_BASE,
			visaStageFee: VISA_STAGE_FEE,
			autosaveLabel,
			simAutopilot,
			setSimAutopilot,
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
			addSchoolApplication,
			removeSchoolApplication,
			lockSchoolSelection,
			updateSchoolTrack,
			autosaveLabel,
			simAutopilot,
			setSimAutopilot,
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
