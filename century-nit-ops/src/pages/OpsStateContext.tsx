import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { safeSetItem, formatSlot, resolveBranchId, type Lead, type LeadStage } from "century-nit-core";
import {
	EMPTY_DIRECTIVES,
	branchName,
	type Assignee,
	type CaseComment,
	type CommentKind,
	type ServicePackage,
	type EligibilityDirective,
	type InvoiceDirective,
	type MockApplicant,
	type MockApplication,
	type MockConsultation,
	type OpsDirectives,
	type OpsInvoiceLine,
	type Invoice,
	type InvoicePayment,
	type InvoiceStatus,
	type VisaStage,
	type PaymentPlanId,
	type VisaStageDirective,
	type PaymentPlanDirective,
	type AgencyAdvanceDirective,
	type TravelClearanceDirective,
	type ScheduleConfigDirective,
	type CustomSchedule,
} from "century-nit-core/ops";
import { fmtBoth } from "./currency";
import { cmsKey, type CmsCollectionId, type CmsOverlay, type CmsStatus } from "century-nit-core";

/* ─── INITIAL DATA ─── */

export const SEED_CONSULTATIONS: MockConsultation[] = [];

export const SEED_APPLICATIONS: MockApplication[] = [];

export const SEED_APPLICANTS: MockApplicant[] = [];

export const SEED_INVOICES: Invoice[] = [];

/* ─── Persistence ─── */

const OPS_STATE_KEY = "century-nit-ops-state";

/** Bump when seed data or shape changes so stale saved state is discarded. */
const OPS_STATE_VERSION = 25;

const SEED_PACKAGES: ServicePackage[] = [];

/**
 * Ticket vocabulary lives in `century-nit-core` because both apps speak it:
 * ops triages tickets, and the applicant portal raises and replies to the
 * `external` ones. Re-exported here so ops code keeps importing it from the
 * store it works with.
 */
import type {
	TicketSource,
	TicketStatus,
	TicketPriority,
	TicketCategory,
	TicketMessage,
	InternalTicket,
} from "century-nit-core/ops";
export type {
	TicketSource,
	TicketStatus,
	TicketPriority,
	TicketCategory,
	TicketMessage,
	InternalTicket,
};

export type MarketingCampaign = {
	id: string;
	name: string;
	type: "Email" | "SMS";
	audience: string;
	status: "Draft" | "Sent";
	sentAt?: string;
	sentBy?: string;
	subject?: string;
	body: string;
	templateId?: string;
};

export type MailingListContact = {
	id: string;
	name: string;
	email: string;
	addedAt: string;
};

export type MailingList = {
	id: string;
	name: string;
	description: string;
	recipientCount: number;
	contacts: MailingListContact[];
	createdAt: string;
};

export type EmailTemplate = {
	id: string;
	name: string;
	type: "Email" | "SMS";
	subject: string;
	header: string;
	body: string;
	footer: string;
	custom: boolean;
	createdAt: string;
	createdBy: string;
};

export const SEED_TICKETS: InternalTicket[] = [];

export const SEED_CAMPAIGNS: MarketingCampaign[] = [];

export const SEED_MAILING_LISTS: MailingList[] = [];

const SEED_EMAIL_TEMPLATES: EmailTemplate[] = [
	{
		id: "tpl-email-newsletter",
		name: "Intake Newsletter",
		type: "Email",
		subject: "New Programs Available for {{intake}}",
		header: "New Programs, New Opportunities",
		body: `<p>Dear {{name}},</p>
<p>We are excited to announce new partner universities and programs for the upcoming <strong>{{intake}}</strong> intake. Whether you are interested in business, engineering, health sciences, or the arts, we have new pathways to help you reach your study abroad goals.</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0.75rem 1rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb;">\u2713  12 new university partnerships</td></tr>
<tr><td style="padding:0.75rem 1rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb;">\u2713  Expanded scholarships up to $5,000</td></tr>
<tr><td style="padding:0.75rem 1rem;background:#f9fafb;font-weight:600;">\u2713  New STEM programs with extended work permits</td></tr>
</table>
<p style="margin-top:1.5rem;">Log in to your portal to explore the full catalog and update your preferences.</p>
<p style="margin-top:1.5rem;">Best regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "You are receiving this email because you are registered with Century NIT. To unsubscribe, reply with STOP.",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-reminder",
		name: "Document Reminder",
		type: "Email",
		subject: "Action Required: Missing Documents for Your Application",
		header: "Your Application Needs Attention",
		body: `<p>Dear {{name}},</p>
<p>Our records show that your application is currently missing one or more required documents. To avoid delays in processing, please log in to your portal and upload the following:</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;border:1px solid #fca5a5;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0.6rem 1rem;background:#fef2f2;border-bottom:1px solid #fca5a5;">\u26a0  Academic transcripts (sealed and stamped)</td></tr>
<tr><td style="padding:0.6rem 1rem;background:#fef2f2;border-bottom:1px solid #fca5a5;">\u26a0  Clear passport copy (bio-data page)</td></tr>
<tr><td style="padding:0.6rem 1rem;background:#fef2f2;">\u26a0  Proof of funds (bank statement, last 3 months)</td></tr>
</table>
<p>Your application cannot proceed to the next stage until these documents are received. If you have already uploaded them, please disregard this message.</p>
<p style="margin-top:1rem;padding:0.75rem 1rem;background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe;">Need help? Reply to this email or call us at <strong>+233 30 123 4567</strong>.</p>
<p style="margin-top:1.5rem;">Regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "This is an automated reminder. Please do not reply directly if your documents are already uploaded.",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-deadline",
		name: "Deadline Alert",
		type: "Email",
		subject: "Application Deadline Approaching — {{date}}",
		header: "Deadline Reminder",
		body: `<p>Dear {{name}},</p>
<p>This is a friendly reminder that your application deadline is approaching on <strong style="color:#dc2626;">{{date}}</strong>. Please ensure that all required materials — including documents, payments, and forms — are submitted before this date.</p>
<p>Late submissions may not be considered for your preferred intake. If you anticipate any delays, contact your assigned consultant as soon as possible to discuss your options.</p>
<p>You can track your application status and outstanding items in your portal.</p>
<p style="margin-top:1.5rem;">Regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "Century NIT  \u00b7  Your Study Abroad Partner",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-welcome",
		name: "Welcome Email",
		type: "Email",
		subject: "Welcome to Century NIT — Your Journey Starts Here",
		header: "Welcome Aboard!",
		body: `<p>Dear {{name}},</p>
<p>Welcome to <strong>Century NIT</strong>! We are thrilled to have you join our community of ambitious students pursuing their education abroad.</p>
<p>Your dedicated consultant will reach out within 24 hours to schedule your first consultation. During this session, we will:</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;">
<tr><td style="padding:0.4rem 0;color:#3b82f6;">\u2713</td><td style="padding:0.4rem 0;">Assess your academic background and career goals</td></tr>
<tr><td style="padding:0.4rem 0;color:#3b82f6;">\u2713</td><td style="padding:0.4rem 0;">Recommend universities and programs tailored to you</td></tr>
<tr><td style="padding:0.4rem 0;color:#3b82f6;">\u2713</td><td style="padding:0.4rem 0;">Outline a personalized application timeline</td></tr>
<tr><td style="padding:0.4rem 0;color:#3b82f6;">\u2713</td><td style="padding:0.4rem 0;">Discuss scholarship and funding opportunities</td></tr>
</table>
<p>In the meantime, feel free to explore your portal where you can browse programs, check requirements, and start your document checklist.</p>
<p style="margin-top:1.5rem;">Warm regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "Century NIT  \u00b7  Your Study Abroad Partner  \u00b7  century-nit.com",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-visa",
		name: "Visa Preparation",
		type: "Email",
		subject: "Visa Interview Preparation — Next Steps",
		header: "Your Visa Appointment Is Approaching",
		body: `<p>Dear {{name}},</p>
<p>Your visa appointment has been scheduled and it is time to prepare. Your consultant has uploaded your visa support documents to the portal. Please review them carefully.</p>
<p style="font-weight:600;margin-top:1rem;">Here is what you need to do before your appointment:</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;">\u2713  Print your visa letter and all supporting documents</td></tr>
<tr><td style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;">\u2713  Prepare your biometrics confirmation slip</td></tr>
<tr><td style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;">\u2713  Practice common interview questions (guide in portal)</td></tr>
<tr><td style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;">\u2713  Dress professionally and arrive 30 minutes early</td></tr>
<tr><td style="padding:0.6rem 1rem;">\u2713  Carry original passport and all originals of uploaded documents</td></tr>
</table>
<p>Your consultant is available for a mock interview session if you would like to practice. Simply book a slot through your portal.</p>
<p style="margin-top:1rem;padding:0.75rem 1rem;background:#ecfdf5;border-radius:6px;border:1px solid #a7f3d0;">You have got this \u2014 we are with you every step of the way.</p>
<p style="margin-top:1.5rem;">Best regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "Century NIT  \u00b7  Visa Support Team",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-payment",
		name: "Payment Confirmation",
		type: "Email",
		subject: "Payment Received — {{amount}}",
		header: "Payment Confirmed",
		body: `<p>Dear {{name}},</p>
<p>We have received your payment of <strong>{{amount}}</strong>. Your invoice has been marked as paid and your application will continue processing.</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0.5rem 1rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb;">Amount</td><td style="padding:0.5rem 1rem;border-bottom:1px solid #e5e7eb;">{{amount}}</td></tr>
<tr><td style="padding:0.5rem 1rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb;">Method</td><td style="padding:0.5rem 1rem;border-bottom:1px solid #e5e7eb;">Mobile Money / Bank Transfer</td></tr>
<tr><td style="padding:0.5rem 1rem;background:#f9fafb;font-weight:600;">Status</td><td style="padding:0.5rem 1rem;"><span style="color:#059669;font-weight:600;">Confirmed</span></td></tr>
</table>
<p>You can download your receipt from your portal under the Finance section.</p>
<p style="margin-top:1.5rem;">Regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "Century NIT  \u00b7  Finance Department",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-sms-reminder",
		name: "SMS Document Reminder",
		type: "SMS",
		subject: "",
		header: "",
		body: "Hi {{name}}, your application is missing documents. Please upload them by {{date}}. Reply STOP to opt out.",
		footer: "",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-sms-appointment",
		name: "SMS Appointment Alert",
		type: "SMS",
		subject: "",
		header: "",
		body: "Reminder: You have a consultation with Century NIT on {{date}} at {{time}}. Reply C to confirm or R to reschedule. Reply STOP to opt out.",
		footer: "",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-sms-deadline",
		name: "SMS Deadline Alert",
		type: "SMS",
		subject: "",
		header: "",
		body: "Alert: Your application deadline is {{date}}. Submit all documents now via your portal. Reply STOP to opt out.",
		footer: "",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-sms-payment",
		name: "SMS Payment Reminder",
		type: "SMS",
		subject: "",
		header: "",
		body: "Hi {{name}}, your invoice of {{amount}} is due on {{date}}. Pay via your portal to avoid delays. Reply STOP to opt out.",
		footer: "",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
];

export type OpsActivityEntry = {
	id: string;
	at: string;
	actor: string;
	action: string;
	detail: string;
};

type PersistedOpsState = {
	version: number;
	consultations: MockConsultation[];
	applications: MockApplication[];
	applicants: MockApplicant[];
	leads: Lead[];
	packages: ServicePackage[];
	directives: OpsDirectives;
	activityLog: OpsActivityEntry[];
	/** Verification decisions on seeded (non-live) documents, keyed by unique doc key. */
	seededDocVerdicts: Record<string, "Verified" | "Rejected">;
	/** Historical invoice records for all applicants. */
	invoices: Invoice[];
	/** CMS edits, keyed `collection:id`. Overlay on the seed in data/content.ts. */
	cmsOverlay: CmsOverlay;
	internalTickets: InternalTicket[];
	marketingCampaigns: MarketingCampaign[];
	mailingLists: MailingList[];
	emailTemplates: EmailTemplate[];
};

function defaultPersisted(): PersistedOpsState {
	return {
		version: OPS_STATE_VERSION,
		consultations: [],
		applications: [],
		applicants: [],
		leads: [],
		packages: SEED_PACKAGES,
		directives: EMPTY_DIRECTIVES,
		activityLog: [],
		seededDocVerdicts: {},
		invoices: [],
		cmsOverlay: {},
		internalTickets: [],
		marketingCampaigns: [],
		mailingLists: [],
		emailTemplates: SEED_EMAIL_TEMPLATES,
	};
}

function loadPersisted(): PersistedOpsState {
	const base = defaultPersisted();
	try {
		const raw = localStorage.getItem(OPS_STATE_KEY);
		if (!raw) return base;
		const parsed = JSON.parse(raw) as Partial<PersistedOpsState>;
		// Seed data or shape changed underneath a saved session - start clean.
		if (parsed.version !== OPS_STATE_VERSION) return base;
		return {
			version: OPS_STATE_VERSION,
			consultations: parsed.consultations ?? base.consultations,
			applications: parsed.applications ?? base.applications,
			applicants: parsed.applicants ?? base.applicants,
			leads: parsed.leads ?? base.leads,
			packages: parsed.packages ?? base.packages,
			directives: { ...EMPTY_DIRECTIVES, ...(parsed.directives ?? {}) },
			activityLog: parsed.activityLog ?? [],
			seededDocVerdicts: parsed.seededDocVerdicts ?? {},
			invoices: parsed.invoices ?? base.invoices,
			cmsOverlay: parsed.cmsOverlay ?? base.cmsOverlay,
			internalTickets: parsed.internalTickets ?? base.internalTickets,
			marketingCampaigns: parsed.marketingCampaigns ?? base.marketingCampaigns,
			mailingLists: (parsed.mailingLists ?? base.mailingLists).map((l) => ({ ...l, contacts: l.contacts ?? [] })),
			emailTemplates: parsed.emailTemplates ?? base.emailTemplates,
		};
	} catch {
		return base;
	}
}

/** Prepend an activity entry, capped so the log can't grow without bound. */
function withLog(
	state: PersistedOpsState,
	actor: string,
	action: string,
	detail: string,
): PersistedOpsState {
	return {
		...state,
		activityLog: [
			{
				id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
				at: new Date().toISOString(),
				actor,
				action,
				detail,
			},
			...state.activityLog,
		].slice(0, 40),
	};
}

/* ─── CONTEXT INTERFACE ─── */

interface OpsStateContextValue {
	consultations: MockConsultation[];
	applications: MockApplication[];
	applicants: MockApplicant[];
	/** Seeded records only - excludes the live portal projection */
	seededApplications: MockApplication[];
	directives: OpsDirectives;
	activityLog: OpsActivityEntry[];

	completeConsultationAssessment: (
		id: string,
		result: {
			outcome: string;
			notes: string;
			recCountry: string;
			recUniversity: string;
			recProgram: string;
			recPackage: string;
		},
		actor?: string,
	) => void;
	acceptApplication: (appId: string, actor?: string) => void;
	toggleApplicationChecklist: (appId: string, itemIndex: number) => void;
	setApplicationStage: (appId: string, stage: string, actor?: string) => void;

	/** Visa processing management */
	setVisaStage: (appId: string, stage: VisaStage, actor?: string) => void;
	setVisaInvoicePaid: (appId: string, actor?: string) => void;
	setVisaCounselorNote: (appId: string, note: string) => void;

	/** Travel assistance management */
	setPaymentPlan: (appId: string, plan: PaymentPlanId, actor?: string) => void;
	advanceAgencyStage: (appId: string, actor?: string) => void;
	setTravelClearance: (appId: string, cleared: boolean, actor?: string) => void;
	togglePreDepartureTask: (appId: string, taskId: string) => void;

	/** Assignment - manager only (enforced in the UI via canAssignWork) */
	assignConsultation: (id: string, to: Assignee, by: string) => void;
	/** Consultant confirms the assigned slot, acknowledging they've accepted it. */
	confirmConsultationSlot: (id: string, by: string) => void;
	/** Consultant starts working on an assigned consultation, moving to In Assessment. */
	startConsultationAssessment: (id: string, by: string) => void;
	assignApplication: (appId: string, to: Assignee, by: string) => void;
	/** Case work - consultant on their assigned items */
	addCaseComment: (
		target: { type: "consultation" | "application"; id: string },
		kind: CommentKind,
		text: string,
		by: string,
	) => void;
	requestDocuments: (
		target: { type: "consultation" | "application"; id: string },
		docs: string[],
		by: string,
	) => void;
	rescheduleConsultation: (id: string, date: string, time: string, reason: string, by: string) => void;

	/** Unified document verdict for seeded (demo) documents. */
	setDocVerdict: (docKey: string, docName: string, verdict: "Verified" | "Rejected", by: string) => void;
	seededDocVerdicts: Record<string, "Verified" | "Rejected">;

	/** Service packages - finance owns these */
	packages: ServicePackage[];
	savePackage: (pkg: ServicePackage, by: string) => void;
	togglePackage: (id: string, by: string) => void;

	/** Ops → portal directives */
	issueEligibility: (d: Omit<EligibilityDirective, "at">) => void;
	issueAppInvoice: (amount: number, lines: OpsInvoiceLine[], note: string, by: string) => void;
	issueVisaInvoice: (amount: number, lines: OpsInvoiceLine[], note: string, by: string) => void;
	issueVisaStage: (stage: VisaStage, note: string, by: string) => void;
	issuePaymentPlan: (plan: PaymentPlanId, by: string) => void;
	issueAgencyAdvance: (stageIndex: number, settled: boolean, by: string) => void;
	issueTravelClearance: (cleared: boolean, by: string) => void;
	issueScheduleConfig: (enabledScheduleIds: string[], by: string, customSchedules?: CustomSchedule[]) => void;
	/** Build and issue a custom invoice to any applicant. */
	createInvoice: (invoice: Omit<Invoice, "id" | "invoiceNumber" | "issuedAt" | "status">) => void;
	recordInvoicePayment: (id: string, amount: number, method: string, reference: string, by: string) => void;
	voidInvoice: (id: string, reason: string, by: string) => void;
	creditInvoice: (id: string, amount: number, reason: string, by: string) => void;
	resendInvoice: (id: string, by: string) => void;
	/** All issued invoices across every applicant. */
	invoices: Invoice[];

	/** CMS - overlay on the seed content, plus the actions that write it. */
	cmsOverlay: CmsOverlay;
	saveCmsRecord: (
		collection: CmsCollectionId,
		id: string,
		title: string,
		values: Record<string, string>,
		status: CmsStatus,
		by: string,
	) => void;
	setCmsStatus: (
		collection: CmsCollectionId,
		id: string,
		title: string,
		status: CmsStatus,
		by: string,
	) => void;
	revertCmsRecord: (collection: CmsCollectionId, id: string, title: string, by: string) => void;
	clearDirectives: () => void;
	logActivity: (actor: string, action: string, detail: string) => void;
	resetOpsState: () => void;

	// Command palette state
	isCommandOpen: boolean;
	openCommandPalette: () => void;
	closeCommandPalette: () => void;
	// Preview document modal state
	previewDoc: { name: string; category?: string; status?: string; isLive?: boolean; docKey?: string } | null;
	openDocPreview: (doc: { name: string; category?: string; status?: string; isLive?: boolean; docKey?: string }) => void;
	closeDocPreview: () => void;
	// CRM leads
	leads: Lead[];
	moveLead: (id: string, stage: LeadStage) => void;
	addLead: (lead: Omit<Lead, "id" | "createdAt" | "lastContactAt">) => void;

	/** Support tickets — internal (staff) and external (client portal). */
	internalTickets: InternalTicket[];
	createTicket: (
		ticket: Omit<
			InternalTicket,
			"id" | "ref" | "createdAt" | "updatedAt" | "assignedTo" | "assignedToEmail" | "escalatedToAdmin" | "messages"
		> & { messages?: TicketMessage[] },
	) => void;
	updateTicketStatus: (id: string, status: TicketStatus, by?: string) => void;
	assignTicket: (id: string, to: { name: string; email: string } | null, by: string) => void;
	escalateTicket: (id: string, by: string) => void;
	replyToTicket: (id: string, body: string, author: string, role: "applicant" | "staff") => void;

	marketingCampaigns: MarketingCampaign[];
	sendCampaign: (campaign: Omit<MarketingCampaign, "id" | "status" | "sentAt">) => void;

	mailingLists: MailingList[];
	createMailingList: (list: Omit<MailingList, "id" | "createdAt" | "recipientCount" | "contacts">) => void;
	deleteMailingList: (id: string) => void;
	addMailingListContact: (listId: string, name: string, email: string) => void;
	removeMailingListContact: (listId: string, contactId: string) => void;

	emailTemplates: EmailTemplate[];
	createEmailTemplate: (tpl: Omit<EmailTemplate, "id" | "createdAt" | "createdBy" | "custom">) => void;
	updateEmailTemplate: (id: string, updates: Partial<Omit<EmailTemplate, "id" | "createdAt" | "createdBy" | "custom">>) => void;
	deleteEmailTemplate: (id: string) => void;
}

const OpsStateContext = createContext<OpsStateContextValue | null>(null);

export function OpsStateProvider({ children }: { children: ReactNode }) {
	const [persisted, setPersisted] = useState<PersistedOpsState>(loadPersisted);
	const [isCommandOpen, setIsCommandOpen] = useState(false);
	const [previewDoc, setPreviewDoc] = useState<{ name: string; category?: string; status?: string; isLive?: boolean; docKey?: string } | null>(null);

	/** Serialized value we last wrote, so cross-tab echoes don't ping-pong. */
	const lastWrittenRef = useRef<string>("");

	useEffect(() => {
		const serialized = JSON.stringify(persisted);
		if (serialized === lastWrittenRef.current) return;
		lastWrittenRef.current = serialized;
		// Guarded: the seeded ops state is large, and an unguarded quota failure
		// here throws inside the effect and takes down the Operations Center.
		safeSetItem(OPS_STATE_KEY, serialized);
	}, [persisted]);

	/** Cross-tab sync - this is what makes the two-window demo work. */
	useEffect(() => {
		function onStorage(e: StorageEvent) {
			if (e.key !== OPS_STATE_KEY || e.newValue == null) return;
			if (e.newValue === lastWrittenRef.current) return;
			try {
				const parsed = JSON.parse(e.newValue) as Partial<PersistedOpsState>;
				lastWrittenRef.current = e.newValue;
				setPersisted({
					...defaultPersisted(),
					...parsed,
					version: OPS_STATE_VERSION,
					directives: { ...EMPTY_DIRECTIVES, ...(parsed.directives ?? {}) },
				});
			} catch {
				/* ignore malformed payloads */
			}
		}
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const logActivity = useCallback((actor: string, action: string, detail: string) => {
		setPersisted((prev) => withLog(prev, actor, action, detail));
	}, []);

	/* ─── Consultation → Application ─── */

	const completeConsultationAssessment = useCallback(
		(
			id: string,
			result: {
				outcome: string;
				notes: string;
				recCountry: string;
				recUniversity: string;
				recProgram: string;
				recPackage: string;
			},
			actor = "Consultant",
		) => {
			setPersisted((prev) => {
				const target = prev.consultations.find((c) => c.id === id);
				if (!target) return prev;

				const consultations = prev.consultations.map((c) =>
					c.id === id ? { ...c, status: "Completed" as const, assessmentResult: result } : c,
				);
				const next = { ...prev, consultations };

			const eligible =
				result.outcome === "Eligible" || result.outcome === "Conditionally Eligible";

			if (!eligible) return next;

				const alreadyExists = prev.applications.some(
					(a) => a.email === target.email && a.university === result.recUniversity,
				);
				if (alreadyExists) return next;

				const newApp: MockApplication = {
					id: `app-${Date.now()}`,
					appId: `APP-2026-${Math.floor(1000 + Math.random() * 9000)}`,
					applicantId: target.id,
					applicantName: target.applicantName,
					email: target.email,
					phone: target.phone,
					branch: target.branch,
					university: result.recUniversity || "University of Toronto",
					program: result.recProgram || "Master's Degree Program",
					country: result.recCountry || target.targetCountry,
					degreeLevel: target.goals.degreeLevel || "Master's",
					assignedStaff: target.assignedOfficer,
					assignedStaffEmail: target.assignedOfficerEmail,
					stage: "document_verification",
					status: "Under Review",
					submittedDate: new Date().toISOString().split("T")[0],
					fundingTrack: result.recPackage || "Standard Admission",
					notes: result.notes || "Generated from completed consultation assessment.",
					checklist: target.documents.map((d, i) => ({
						id: `chk-${i}`,
						label: d.name.replace(/_/g, " "),
						checked: d.status === "Verified",
					})),
				};

				return withLog(
					{ ...next, applications: [newApp, ...prev.applications] },
					actor,
					"Assessment completed",
					`${target.applicantName} → ${result.outcome}. Application ${newApp.appId} created.`,
				);
			});
		},
		[],
	);

	const acceptApplication = useCallback((appId: string, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;

			const applications = prev.applications.map((a) =>
				a.appId === appId ? { ...a, status: "Accepted" as const } : a,
			);
			const next = { ...prev, applications };

			const exists = prev.applicants.some((ap) => ap.applicantId === target.appId);
			if (exists) return next;

			const newApplicant: MockApplicant = {
				id: `applicant-${Date.now()}`,
				applicantId: target.appId,
				name: target.applicantName,
				email: target.email,
				phone: target.phone,
				branch: target.branch,
				assignedOfficer: target.assignedStaff,
				assignedOfficerEmail: target.assignedStaffEmail,
				country: target.country,
				university: target.university,
				program: target.program,
				package: target.fundingTrack,
				currentStage: "Document Review",
				stageNumber: 4,
				totalStages: 11,
				status: "Active",
				enrolledDate: "Fall 2026",
				financials: {
					totalAmount: "$3,000",
					paidAmount: "$1,500",
					outstanding: "$1,500",
					plan: "2 Installment Plan",
				},
				timeline: [
					{ stage: "1. Consultation", status: "Completed", date: target.submittedDate },
					{ stage: "2. Eligibility", status: "Completed", date: target.submittedDate },
					{ stage: "3. School Package", status: "Completed", date: target.submittedDate },
					{ stage: "4. Select Schools", status: "Completed", date: target.submittedDate },
					{ stage: "5. Application Process", status: "In Progress", date: "Current" },
				],
				documents: target.checklist.map((c) => ({
					name: `${c.label.replace(/\s+/g, "_")}.pdf`,
					category: "Verified Item",
					date: target.submittedDate,
					status: c.checked ? "Verified" : "Pending Review",
				})),
				messages: [
					{
						sender: `${target.assignedStaff} (Staff)`,
						time: "Just now",
						text: "Application accepted and activated in the active applicants directory.",
					},
				],
				auditLog: [
					{
						action: "Application Accepted & Approved",
						user: target.assignedStaff,
						timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
					},
				],
			};

			return withLog(
				{ ...next, applicants: [newApplicant, ...prev.applicants] },
				actor,
				"Application accepted",
				`${target.applicantName} (${target.appId}) activated as an applicant.`,
			);
		});
	}, []);

	const toggleApplicationChecklist = useCallback((appId: string, itemIndex: number) => {
		setPersisted((prev) => ({
			...prev,
			applications: prev.applications.map((a) =>
				a.appId === appId
					? {
							...a,
							checklist: a.checklist.map((item, idx) =>
								idx === itemIndex ? { ...item, checked: !item.checked } : item,
							),
						}
					: a,
			),
		}));
	}, []);

	const setApplicationStage = useCallback((appId: string, stage: string, actor = "Processing") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target || target.stage === stage) return prev;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId ? { ...a, stage } : a,
					),
				},
				actor,
				"Stage advanced",
				`${target.applicantName}: ${target.stage} → ${stage}`,
			);
		});
	}, []);

	/* ─── Visa processing management ─── */

	const setVisaStage = useCallback((appId: string, stage: VisaStage, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId ? { ...a, visaStage: stage } : a,
					),
				},
				actor,
				"Visa stage updated",
				`${target.applicantName}: visa → ${stage}`,
			);
		});
	}, []);

	const setVisaInvoicePaid = useCallback((appId: string, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId
							? {
									...a,
									visaInvoicePaid: true,
									visaStage: a.visaStage === "locked" ? "pending" : a.visaStage,
								}
							: a,
					),
				},
				actor,
				"Visa invoice paid",
				`${target.applicantName}: visa invoice marked paid`,
			);
		});
	}, []);

	const setVisaCounselorNote = useCallback((appId: string, note: string) => {
		setPersisted((prev) => ({
			...prev,
			applications: prev.applications.map((a) =>
				a.appId === appId ? { ...a, visaCounselorNote: note } : a,
			),
		}));
	}, []);

	/* ─── Travel assistance management ─── */

	const setPaymentPlan = useCallback((appId: string, plan: PaymentPlanId, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId ? { ...a, paymentPlanId: plan } : a,
					),
				},
				actor,
				"Payment plan set",
				`${target.applicantName}: plan → ${plan || "none"}`,
			);
		});
	}, []);

	const advanceAgencyStage = useCallback((appId: string, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			const curIdx = target.agencyStageIndex ?? 0;
			const nextIdx = Math.min(curIdx + 1, 2);
			const settled = nextIdx >= 2;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId
							? { ...a, agencyStageIndex: nextIdx, agencySettled: settled }
							: a,
					),
				},
				actor,
				"Agency milestone advanced",
				`${target.applicantName}: agency stage ${nextIdx + 1}/3`,
			);
		});
	}, []);

	const setTravelClearance = useCallback((appId: string, cleared: boolean, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId
							? { ...a, travelClearance: cleared ? "cleared" : "pending" }
							: a,
					),
				},
				actor,
				cleared ? "Travel cleared" : "Travel clearance revoked",
				`${target.applicantName}: travel ${cleared ? "cleared" : "pending"}`,
			);
		});
	}, []);

	const togglePreDepartureTask = useCallback((appId: string, taskId: string) => {
		setPersisted((prev) => ({
			...prev,
			applications: prev.applications.map((a) =>
				a.appId === appId
					? {
							...a,
							preDepartureTasks: (a.preDepartureTasks ?? []).map((t) =>
								t.id === taskId ? { ...t, done: !t.done } : t,
							),
						}
					: a,
			),
		}));
	}, []);

	function makeComment(author: string, kind: CommentKind, text: string): CaseComment {
		return {
			id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			at: new Date().toISOString(),
			author,
			kind,
			text,
		};
	}

	/** Manager routes a consultation to a consultant (or reassigns it). */
	const assignConsultation = useCallback((id: string, to: Assignee, by: string) => {
		setPersisted((prev) => {
			const note = makeComment(by, "assignment", `Assigned to ${to.name} (${branchName(to.branch)}).`);

			const target = prev.consultations.find((c) => c.id === id);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					consultations: prev.consultations.map((c) =>
						c.id === id
							? {
									...c,
									assignedOfficer: to.name,
									assignedOfficerEmail: to.email,
									status: "Assigned",
									slotConfirmed: false,
									comments: [...(c.comments ?? []), note],
								}
							: c,
					),
				},
				by,
				"Consultation assigned",
				`${target.applicantName} → ${to.name}`,
			);
		});
	}, []);

	/** Consultant confirms the assigned slot → adds a comment and marks it confirmed. */
	const confirmConsultationSlot = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const note = makeComment(by, "status", "Slot confirmed - consultant accepted the booking time.");

			const target = prev.consultations.find((c) => c.id === id);
			if (!target) return prev;
			const isOnline = target.type === "online";
			const meetingLink = isOnline
				? `https://meet.google.com/century-nit-${target.ref.toLowerCase().replace(/[^a-z0-9]/g, "")}`
				: undefined;
			const mapsUrl = !isOnline
				? `https://www.google.com/maps?q=${encodeURIComponent(target.branch)}`
				: undefined;
			return withLog(
				{
					...prev,
					consultations: prev.consultations.map((c) =>
						c.id === id
							? { ...c, slotConfirmed: true, meetingLink, mapsUrl, comments: [...(c.comments ?? []), note] }
							: c,
					),
				},
				by,
				"Slot confirmed",
				`${target.applicantName} - consultant accepted slot`,
			);
		});
	}, []);

	/** Consultant starts assessment → status becomes "In Assessment". */
	const startConsultationAssessment = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.consultations.find((c) => c.id === id);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					consultations: prev.consultations.map((c) =>
						c.id === id ? { ...c, status: "In Assessment" } : c,
					),
				},
				by,
				"Assessment started",
				`${target.applicantName} - consultant began review`,
			);
		});
	}, []);

	/** Manager routes a case stage to a consultant. */
	const assignApplication = useCallback((appId: string, to: Assignee, by: string) => {
		setPersisted((prev) => {
			const note = makeComment(by, "assignment", `Assigned to ${to.name} (${branchName(to.branch)}).`);
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;

			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId
							? {
									...a,
									assignedStaff: to.name,
									assignedStaffEmail: to.email,
									comments: [...(a.comments ?? []), note],
								}
							: a,
					),
				},
				by,
				"Case assigned",
				`${target.applicantName} (${appId}) → ${to.name}`,
			);
		});
	}, []);

	/** Consultant note, recommendation, or status update on an assigned case. */
	const addCaseComment = useCallback(
		(target: { type: "consultation" | "application"; id: string }, kind: CommentKind, text: string, by: string) => {
			setPersisted((prev) => {
				const note = makeComment(by, kind, text);

				if (target.type === "consultation") {
					return {
						...prev,
						consultations: prev.consultations.map((c) =>
							c.id === target.id ? { ...c, comments: [...(c.comments ?? []), note] } : c,
						),
					};
				}
				return {
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === target.id ? { ...a, comments: [...(a.comments ?? []), note] } : a,
					),
				};
			});
		},
		[],
	);

	/** Consultant asks the applicant for more paperwork. */
	const requestDocuments = useCallback(
		(target: { type: "consultation" | "application"; id: string }, docs: string[], by: string) => {
			setPersisted((prev) => {
				const note = makeComment(by, "document_request", `Requested: ${docs.join(", ")}.`);

				if (target.type === "consultation") {
					return withLog(
						{
							...prev,
							consultations: prev.consultations.map((c) =>
								c.id === target.id
									? {
											...c,
											comments: [...(c.comments ?? []), note],
											requestedDocuments: [...(c.requestedDocuments ?? []), ...docs],
										}
									: c,
							),
						},
						by,
						"Documents requested",
						docs.join(", "),
					);
				}
				return withLog(
					{
						...prev,
						applications: prev.applications.map((a) =>
							a.appId === target.id
								? {
										...a,
										comments: [...(a.comments ?? []), note],
										requestedDocuments: [...(a.requestedDocuments ?? []), ...docs],
									}
								: a,
						),
					},
					by,
					"Documents requested",
					docs.join(", "),
				);
			});
		},
		[],
	);

	/**
	 * Consultant moves an assigned consultation onto a new slot.
	 *
	 * Takes the structured date and time rather than a formatted string, and
	 * derives the display text from them. The structured triple is what makes
	 * the slot visible to the conflict check — a record carrying only prose is
	 * invisible to it and its slot reads as free.
	 */
	const rescheduleConsultation = useCallback(
		(id: string, date: string, time: string, reason: string, by: string) => {
			const when = formatSlot(date, time);
			setPersisted((prev) => {
				const note = makeComment(by, "status", `Rescheduled to ${when}. ${reason}`.trim());

				const target = prev.consultations.find((c) => c.id === id);
				if (!target) return prev;
				return withLog(
					{
						...prev,
						consultations: prev.consultations.map((c) =>
							c.id === id
								? {
										...c,
										dateTime: when,
										rescheduledTo: when,
										slotBranchId: resolveBranchId(c.branch) ?? c.slotBranchId,
										slotDate: date,
										slotTime: time,
										comments: [...(c.comments ?? []), note],
									}
								: c,
						),
					},
					by,
					"Consultation rescheduled",
					`${target.applicantName} → ${when}`,
				);
			});
		},
		[],
	);

	/** Record a document verdict on a seeded (demo) document. */
	const setDocVerdict = useCallback((docKey: string, docName: string, verdict: "Verified" | "Rejected", by: string) => {
		setPersisted((prev) =>
			withLog(
				{
					...prev,
					seededDocVerdicts: {
						...prev.seededDocVerdicts,
						[docKey]: verdict,
					},
				},
				by,
				verdict === "Verified" ? "Document verified" : "Document rejected",
				docName,
			),
		);
	}, []);

	/* ─── Service packages (finance) ─── */

	const savePackage = useCallback((pkg: ServicePackage, by: string) => {
		setPersisted((prev) => {
			const exists = prev.packages.some((p) => p.id === pkg.id);
			return withLog(
				{
					...prev,
					packages: exists
						? prev.packages.map((p) => (p.id === pkg.id ? pkg : p))
						: [...prev.packages, pkg],
				},
				by,
				exists ? "Package updated" : "Package created",
				`${pkg.name} - ${fmtBoth(pkg.price)}`,
			);
		});
	}, []);

	const togglePackage = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.packages.find((p) => p.id === id);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					packages: prev.packages.map((p) => (p.id === id ? { ...p, active: !p.active } : p)),
				},
				by,
				target.active ? "Package retired" : "Package activated",
				target.name,
			);
		});
	}, []);

	/* ─── Directives (ops → portal) ─── */

	const issueEligibility = useCallback((d: Omit<EligibilityDirective, "at">) => {
		const directive: EligibilityDirective = { ...d, at: new Date().toISOString() };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, eligibility: directive } },
				d.by,
				"Eligibility decision sent to applicant",
				`${d.outcome} - ${d.note}`,
			),
		);
	}, []);

	const issueInvoice = useCallback(
		(
			kind: "appInvoice" | "visaInvoice",
			amount: number,
			lines: OpsInvoiceLine[],
			note: string,
			by: string,
		) => {
			const directive: InvoiceDirective = {
				amount,
				lines,
				note,
				by,
				at: new Date().toISOString(),
			};
			setPersisted((prev) =>
				withLog(
					{ ...prev, directives: { ...prev.directives, [kind]: directive } },
					by,
					kind === "appInvoice" ? "Application invoice issued" : "Visa invoice issued",
					`${fmtBoth(amount)} - ${note}`,
				),
			);
		},
		[],
	);

	const issueAppInvoice = useCallback(
		(amount: number, lines: OpsInvoiceLine[], note: string, by: string) =>
			issueInvoice("appInvoice", amount, lines, note, by),
		[issueInvoice],
	);

	const issueVisaInvoice = useCallback(
		(amount: number, lines: OpsInvoiceLine[], note: string, by: string) =>
			issueInvoice("visaInvoice", amount, lines, note, by),
		[issueInvoice],
	);

	const issueVisaStage = useCallback((stage: VisaStage, note: string, by: string) => {
		const directive: VisaStageDirective = { stage, note, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, visaStage: directive } },
				by,
				"Visa stage updated",
				`${stage} - ${note}`,
			),
		);
	}, []);

	const issuePaymentPlan = useCallback((plan: PaymentPlanId, by: string) => {
		const directive: PaymentPlanDirective = { plan, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, paymentPlan: directive } },
				by,
				"Payment plan set",
				`plan → ${plan || "none"}`,
			),
		);
	}, []);

	const issueAgencyAdvance = useCallback((stageIndex: number, settled: boolean, by: string) => {
		const directive: AgencyAdvanceDirective = { stageIndex, settled, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, agencyAdvance: directive } },
				by,
				settled ? "Agency settled" : "Agency installment recorded",
				`stage ${stageIndex + 1}/3${settled ? " — settled" : ""}`,
			),
		);
	}, []);

	const issueTravelClearance = useCallback((cleared: boolean, by: string) => {
		const directive: TravelClearanceDirective = { cleared, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, travelClearance: directive } },
				by,
				cleared ? "Travel cleared" : "Travel clearance revoked",
				cleared ? "Cleared for departure" : "Clearance revoked",
			),
		);
	}, []);

	const issueScheduleConfig = useCallback((enabledScheduleIds: string[], by: string, customSchedules: CustomSchedule[] = []) => {
		const directive: ScheduleConfigDirective = { enabledScheduleIds, customSchedules, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, scheduleConfig: directive } },
				by,
				"Post-arrival schedules configured",
				`${enabledScheduleIds.length} option${enabledScheduleIds.length === 1 ? "" : "s"} enabled${customSchedules.length ? `, ${customSchedules.length} custom` : ""}`,
			),
		);
	}, []);

	/* ─── Invoice lifecycle ─── */

	/** Record a payment. A part-payment leaves a balance rather than closing it. */
	const recordInvoicePayment = useCallback(
		(id: string, amount: number, method: string, reference: string, by: string) => {
			setPersisted((prev) => {
				const target = prev.invoices.find((i) => i.id === id);
				if (!target) return prev;
				const payment: InvoicePayment = {
					id: `pay-${Date.now().toString(36)}`,
					amount,
					at: new Date().toISOString(),
					by,
					method,
					reference,
				};
				const payments = [...(target.payments ?? []), payment];
				const settled = payments.reduce((n, p) => n + p.amount, 0) + (target.creditedAmount ?? 0);
				const status: InvoiceStatus = settled >= target.subtotal ? "paid" : "partial";

				return withLog(
					{
						...prev,
						invoices: prev.invoices.map((i) =>
							i.id === id
								? {
										...i,
										payments,
										status,
										history: [
											...(i.history ?? []),
											{
												at: payment.at,
												by,
												action: status === "paid" ? "Paid in full" : "Part payment",
												detail: `${fmtBoth(amount)} · ${method}${reference ? ` · ${reference}` : ""}`,
											},
										],
									}
								: i,
						),
					},
					by,
					status === "paid" ? "Invoice paid" : "Part payment recorded",
					`${target.invoiceNumber} · ${fmtBoth(amount)}`,
				);
			});
		},
		[],
	);

	/** Void an invoice raised in error. Balance drops to zero; the record stays. */
	const voidInvoice = useCallback((id: string, reason: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.invoices.find((i) => i.id === id);
			if (!target) return prev;
			const at = new Date().toISOString();
			return withLog(
				{
					...prev,
					invoices: prev.invoices.map((i) =>
						i.id === id
							? {
									...i,
									status: "void" as InvoiceStatus,
									voidedAt: at,
									voidReason: reason,
									history: [...(i.history ?? []), { at, by, action: "Voided", detail: reason }],
								}
							: i,
					),
				},
				by,
				"Invoice voided",
				`${target.invoiceNumber} · ${reason}`,
			);
		});
	}, []);

	/** Credit note — reverses part or all of an invoice without deleting it. */
	const creditInvoice = useCallback((id: string, amount: number, reason: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.invoices.find((i) => i.id === id);
			if (!target) return prev;
			const at = new Date().toISOString();
			const credited = (target.creditedAmount ?? 0) + amount;
			const settled = (target.payments ?? []).reduce((n, p) => n + p.amount, 0) + credited;
			return withLog(
				{
					...prev,
					invoices: prev.invoices.map((i) =>
						i.id === id
							? {
									...i,
									creditedAmount: credited,
									status: (settled >= i.subtotal ? "paid" : i.status) as InvoiceStatus,
									history: [
										...(i.history ?? []),
										{ at, by, action: "Credit note", detail: `${fmtBoth(amount)} · ${reason}` },
									],
								}
							: i,
					),
				},
				by,
				"Credit note issued",
				`${target.invoiceNumber} · ${fmtBoth(amount)}`,
			);
		});
	}, []);

	/** Re-send to the applicant. Recorded so the chase history is visible. */
	const resendInvoice = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.invoices.find((i) => i.id === id);
			if (!target) return prev;
			const at = new Date().toISOString();
			return withLog(
				{
					...prev,
					invoices: prev.invoices.map((i) =>
						i.id === id
							? { ...i, history: [...(i.history ?? []), { at, by, action: "Re-sent to applicant" }] }
							: i,
					),
				},
				by,
				"Invoice re-sent",
				`${target.invoiceNumber} · ${target.applicantName}`,
			);
		});
	}, []);

	const createInvoice = useCallback(
		(input: Omit<Invoice, "id" | "invoiceNumber" | "issuedAt" | "status">) => {
			const id = `inv-${Date.now().toString(36)}`;
			const num = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
			const invoice: Invoice = {
				...input,
				id,
				invoiceNumber: num,
				issuedAt: new Date().toISOString(),
				status: "issued",
				// 14-day terms unless the caller says otherwise
				dueAt: input.dueAt ?? new Date(Date.now() + 14 * 86_400_000).toISOString(),
				payments: [],
				history: [
					{
						at: new Date().toISOString(),
						by: input.issuedBy,
						action: "Issued",
						detail: fmtBoth(input.subtotal),
					},
				],
			};
			setPersisted((prev) => {
				const next = {
					...prev,
					invoices: [invoice, ...prev.invoices],
				};

				return withLog(
					next,
					invoice.issuedBy,
					`${invoice.type} invoice issued`,
					`${invoice.applicantName} - ${fmtBoth(invoice.subtotal)}`,
				);
			});
		},
		[],
	);

	const clearDirectives = useCallback(() => {
		setPersisted((prev) => ({ ...prev, directives: EMPTY_DIRECTIVES }));
	}, []);

	/* ─── CMS ─── */

	/** Save an edit. Only fields differing from the seed are persisted. */
	const saveCmsRecord = useCallback(
		(
			collection: CmsCollectionId,
			id: string,
			title: string,
			values: Record<string, string>,
			status: CmsStatus,
			by: string,
		) => {
			setPersisted((prev) =>
				withLog(
					{
						...prev,
						cmsOverlay: {
							...prev.cmsOverlay,
							[cmsKey(collection, id)]: {
								values,
								status,
								updatedAt: new Date().toISOString(),
								updatedBy: by,
							},
						},
					},
					by,
					"Content updated",
					`${title} · ${status}`,
				),
			);
		},
		[],
	);

	/** Publish / unpublish without touching the field values. */
	const setCmsStatus = useCallback(
		(collection: CmsCollectionId, id: string, title: string, status: CmsStatus, by: string) => {
			setPersisted((prev) => {
				const key = cmsKey(collection, id);
				const existing = prev.cmsOverlay[key];
				return withLog(
					{
						...prev,
						cmsOverlay: {
							...prev.cmsOverlay,
							[key]: {
								values: existing?.values ?? {},
								status,
								updatedAt: new Date().toISOString(),
								updatedBy: by,
							},
						},
					},
					by,
					status === "Published" ? "Content published" : `Content set to ${status}`,
					title,
				);
			});
		},
		[],
	);

	/** Drop the override so the record falls back to the seed. */
	const revertCmsRecord = useCallback(
		(collection: CmsCollectionId, id: string, title: string, by: string) => {
			setPersisted((prev) => {
				const next = { ...prev.cmsOverlay };
				delete next[cmsKey(collection, id)];
				return withLog({ ...prev, cmsOverlay: next }, by, "Content reverted", title);
			});
		},
		[],
	);

	const resetOpsState = useCallback(() => {
		const fresh = defaultPersisted();
		lastWrittenRef.current = "";
		setPersisted(fresh);
	}, []);

	/* ─── CRM leads ─── */

	const moveLead = useCallback((id: string, stage: LeadStage) => {
		setPersisted((prev) => ({
			...prev,
			leads: prev.leads.map((l) =>
				l.id === id ? { ...l, stage, lastContactAt: new Date().toISOString() } : l,
			),
		}));
	}, []);

	const addLead = useCallback((lead: Omit<Lead, "id" | "createdAt" | "lastContactAt">) => {
		const now = new Date().toISOString();
		setPersisted((prev) => ({
			...prev,
			leads: [
				{ ...lead, id: `lead-${Date.now().toString(36)}`, createdAt: now, lastContactAt: now },
				...prev.leads,
			],
		}));
	}, []);

	/* ─── Helpdesk ─── */

	/* ─── Helpdesk ─── */

	/** Sequential, human-quotable reference */
	function nextTicketRef(existing: InternalTicket[]) {
		const year = new Date().getFullYear();
		const n = existing.length + 1;
		return `TKT-${year}-${String(n).padStart(4, "0")}`;
	}

	/**
	 * Raise a ticket. Called by staff from the helpdesk (`internal`) and by the
	 * applicant from the client portal (`external`) — the portal sits inside
	 * OpsStateProvider, so it writes here directly rather than through a bridge.
	 */
	const createTicket = useCallback(
		(
			ticket: Omit<
				InternalTicket,
				"id" | "ref" | "createdAt" | "updatedAt" | "assignedTo" | "assignedToEmail" | "escalatedToAdmin" | "messages"
			> & { messages?: TicketMessage[] },
		) => {
			const now = new Date().toISOString();
			setPersisted((prev) => {
				const ref = nextTicketRef(prev.internalTickets);
				const record: InternalTicket = {
					...ticket,
					id: `tkt-${Date.now().toString(36)}`,
					ref,
					createdAt: now,
					updatedAt: now,
					assignedTo: "",
					assignedToEmail: "",
					escalatedToAdmin: false,
					messages:
						ticket.messages ??
						(ticket.source === "external"
							? [
									{
										id: `m-${Date.now().toString(36)}`,
										author: ticket.createdBy,
										role: "applicant" as const,
										body: ticket.description,
										at: now,
									},
								]
							: []),
				};
				return withLog(
					{ ...prev, internalTickets: [record, ...prev.internalTickets] },
					ticket.createdBy,
					ticket.source === "external" ? "Support ticket received" : "Internal ticket raised",
					`${ref} · ${ticket.title}`,
				);
			});
		},
		[],
	);

	const updateTicketStatus = useCallback((id: string, status: TicketStatus, by = "Staff") => {
		setPersisted((prev) => {
			const t = prev.internalTickets.find((x) => x.id === id);
			if (!t) return prev;
			return withLog(
				{
					...prev,
					internalTickets: prev.internalTickets.map((x) =>
						x.id === id ? { ...x, status, updatedAt: new Date().toISOString() } : x,
					),
				},
				by,
				`Ticket ${status.toLowerCase()}`,
				`${t.ref} · ${t.title}`,
			);
		});
	}, []);

	/** Route a ticket to a colleague. Passing an empty assignee returns it to triage. */
	const assignTicket = useCallback(
		(id: string, to: { name: string; email: string } | null, by: string) => {
			setPersisted((prev) => {
				const t = prev.internalTickets.find((x) => x.id === id);
				if (!t) return prev;
				return withLog(
					{
						...prev,
						internalTickets: prev.internalTickets.map((x) =>
							x.id === id
								? {
										...x,
										assignedTo: to?.name ?? "",
										assignedToEmail: to?.email ?? "",
										escalatedToAdmin: to ? false : x.escalatedToAdmin,
										status: to && x.status === "Open" ? "In Progress" : x.status,
										updatedAt: new Date().toISOString(),
									}
								: x,
						),
					},
					by,
					to ? "Ticket assigned" : "Ticket returned to triage",
					`${t.ref} → ${to?.name ?? "Unassigned"}`,
				);
			});
		},
		[],
	);

	/** Hand a ticket to platform administration — used when it is a system fault. */
	const escalateTicket = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const t = prev.internalTickets.find((x) => x.id === id);
			if (!t) return prev;
			return withLog(
				{
					...prev,
					internalTickets: prev.internalTickets.map((x) =>
						x.id === id
							? {
									...x,
									escalatedToAdmin: true,
									assignedTo: "",
									assignedToEmail: "",
									status: x.status === "Resolved" ? x.status : "In Progress",
									updatedAt: new Date().toISOString(),
								}
							: x,
					),
				},
				by,
				"Ticket escalated to system admin",
				`${t.ref} · ${t.title}`,
			);
		});
	}, []);

	/** Post a reply. On an external ticket the applicant sees this in their portal. */
	const replyToTicket = useCallback(
		(id: string, body: string, author: string, role: "applicant" | "staff") => {
			const now = new Date().toISOString();
			setPersisted((prev) => {
				const t = prev.internalTickets.find((x) => x.id === id);
				if (!t) return prev;
				const msg: TicketMessage = {
					id: `m-${Date.now().toString(36)}`,
					author,
					role,
					body,
					at: now,
				};
				return withLog(
					{
						...prev,
						internalTickets: prev.internalTickets.map((x) =>
							x.id === id
								? {
										...x,
										messages: [...x.messages, msg],
										// An applicant reply reopens a waiting ticket
										status: role === "applicant" && x.status === "Waiting" ? "Open" : x.status,
										updatedAt: now,
									}
								: x,
						),
					},
					author,
					"Ticket reply",
					`${t.ref} · ${role === "staff" ? "staff" : "applicant"}`,
				);
			});
		},
		[],
	);



	/* ─── Marketing ─── */

	const sendCampaign = useCallback((campaign: Omit<MarketingCampaign, "id" | "status" | "sentAt">) => {
		setPersisted((prev) => ({
			...prev,
			marketingCampaigns: [
				{ ...campaign, id: `cmp-${Date.now().toString(36)}`, status: "Sent", sentAt: new Date().toISOString() },
				...prev.marketingCampaigns,
			],
		}));
	}, []);

	const createMailingList = useCallback((list: Omit<MailingList, "id" | "createdAt" | "recipientCount" | "contacts">) => {
		setPersisted((prev) => ({
			...prev,
			mailingLists: [
				{ ...list, id: `ml-${Date.now().toString(36)}`, recipientCount: 0, contacts: [], createdAt: new Date().toISOString() },
				...prev.mailingLists,
			],
		}));
	}, []);

	const deleteMailingList = useCallback((id: string) => {
		setPersisted((prev) => ({
			...prev,
			mailingLists: prev.mailingLists.filter((l) => l.id !== id),
		}));
	}, []);

	const addMailingListContact = useCallback((listId: string, name: string, email: string) => {
		setPersisted((prev) => ({
			...prev,
			mailingLists: prev.mailingLists.map((l) => {
				if (l.id !== listId) return l;
				const contact: MailingListContact = { id: `ct-${Date.now().toString(36)}`, name, email, addedAt: new Date().toISOString() };
				return { ...l, contacts: [...l.contacts, contact], recipientCount: l.contacts.length + 1 };
			}),
		}));
	}, []);

	const removeMailingListContact = useCallback((listId: string, contactId: string) => {
		setPersisted((prev) => ({
			...prev,
			mailingLists: prev.mailingLists.map((l) => {
				if (l.id !== listId) return l;
				const contacts = l.contacts.filter((c) => c.id !== contactId);
				return { ...l, contacts, recipientCount: contacts.length };
			}),
		}));
	}, []);

	const createEmailTemplate = useCallback((tpl: Omit<EmailTemplate, "id" | "createdAt" | "createdBy" | "custom">) => {
		setPersisted((prev) => ({
			...prev,
			emailTemplates: [
				{ ...tpl, id: `tpl-${Date.now().toString(36)}`, custom: true, createdAt: new Date().toISOString(), createdBy: "System" },
				...prev.emailTemplates,
			],
		}));
	}, []);

	const updateEmailTemplate = useCallback((id: string, updates: Partial<Omit<EmailTemplate, "id" | "createdAt" | "createdBy" | "custom">>) => {
		setPersisted((prev) => ({
			...prev,
			emailTemplates: prev.emailTemplates.map((t) => (t.id === id ? { ...t, ...updates } : t)),
		}));
	}, []);

	const deleteEmailTemplate = useCallback((id: string) => {
		setPersisted((prev) => ({
			...prev,
			emailTemplates: prev.emailTemplates.filter((t) => t.id !== id),
		}));
	}, []);

	/* ─── UI state ─── */

	const openCommandPalette = useCallback(() => setIsCommandOpen(true), []);
	const closeCommandPalette = useCallback(() => setIsCommandOpen(false), []);
	const openDocPreview = useCallback(
		(doc: { name: string; category?: string; status?: string }) => setPreviewDoc(doc),
		[],
	);
	const closeDocPreview = useCallback(() => setPreviewDoc(null), []);

	/* ─── Visible lists ─── */

	const consultations = persisted.consultations;

	const applications = persisted.applications;

	const applicants = persisted.applicants;

	const value: OpsStateContextValue = {
		consultations,
		applications,
		applicants,
		seededApplications: persisted.applications,
		directives: persisted.directives,
		activityLog: persisted.activityLog,
		completeConsultationAssessment,
		acceptApplication,
		toggleApplicationChecklist,
		setApplicationStage,
		setVisaStage,
		setVisaInvoicePaid,
		setVisaCounselorNote,
		setPaymentPlan,
		advanceAgencyStage,
		setTravelClearance,
		togglePreDepartureTask,
		assignConsultation,
		confirmConsultationSlot,
		startConsultationAssessment,
		assignApplication,
		addCaseComment,
		requestDocuments,
		rescheduleConsultation,
		setDocVerdict,
		seededDocVerdicts: persisted.seededDocVerdicts,
		packages: persisted.packages,
		savePackage,
		togglePackage,
		issueEligibility,
		issueAppInvoice,
		issueVisaInvoice,
		issueVisaStage,
		issuePaymentPlan,
		issueAgencyAdvance,
		issueTravelClearance,
		issueScheduleConfig,
		createInvoice,
		recordInvoicePayment,
		voidInvoice,
		creditInvoice,
		resendInvoice,
		invoices: persisted.invoices,
		cmsOverlay: persisted.cmsOverlay,
		saveCmsRecord,
		setCmsStatus,
		revertCmsRecord,
		clearDirectives,
		logActivity,
		resetOpsState,
		isCommandOpen,
		openCommandPalette,
		closeCommandPalette,
		previewDoc,
		openDocPreview,
		closeDocPreview,
		leads: persisted.leads,
		moveLead,
		addLead,
		internalTickets: persisted.internalTickets,
		createTicket,
		updateTicketStatus,
		assignTicket,
		escalateTicket,
		replyToTicket,
		marketingCampaigns: persisted.marketingCampaigns,
		sendCampaign,
		mailingLists: persisted.mailingLists,
		createMailingList,
		deleteMailingList,
		addMailingListContact,
		removeMailingListContact,
		emailTemplates: persisted.emailTemplates,
		createEmailTemplate,
		updateEmailTemplate,
		deleteEmailTemplate,
	};

	return <OpsStateContext.Provider value={value}>{children}</OpsStateContext.Provider>;
}

export function useOpsState() {
	const ctx = useContext(OpsStateContext);
	if (!ctx) throw new Error("useOpsState must be used within OpsStateProvider");
	return ctx;
}
