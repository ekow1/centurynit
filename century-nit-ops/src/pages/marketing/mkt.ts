import { API_PREFIX } from "century-nit-shared";
import { apiFetch } from "../../lib/api";

export const MKT = `${API_PREFIX}/marketing`;

export const get = <T>(path: string) => apiFetch<T>(`${MKT}${path}`);
export const post = <T>(path: string, body: unknown) =>
	apiFetch<T>(`${MKT}${path}`, { method: "POST", body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
	apiFetch<T>(`${MKT}${path}`, { method: "PUT", body: JSON.stringify(body) });
export const del = <T>(path: string) => apiFetch<T>(`${MKT}${path}`, { method: "DELETE" });

/* ── Shared types ────────────────────────────────────────────────────────── */

export type Campaign = {
	id: string;
	name: string;
	type: string;
	status: string;
	channel: string;
	audience: string | null;
	subject: string | null;
	body: string;
	templateId: string | null;
	mailingListId: string | null;
	segmentId: string | null;
	preheader: string | null;
	fromName: string | null;
	replyTo: string | null;
	blocks: EmailBlock[] | null;
	sentBy: string | null;
	sentAt: string | null;
	scheduledAt: string | null;
	recipientCount: number;
	deliveredCount: number;
	failedCount: number;
	createdAt: string;
	updatedAt: string;
};

export type Recipient = {
	id: string;
	campaignId: string;
	contactId: string | null;
	email: string;
	name: string | null;
	status: string;
	sentAt: string | null;
	error: string | null;
	openedAt: string | null;
	bouncedAt: string | null;
	clickedAt: string | null;
	clickedUrl: string | null;
	createdAt: string;
};

export type MailingList = {
	id: string;
	name: string;
	description: string | null;
	contactCount: number;
	pendingCount: number;
	confirmedCount: number;
	unsubscribedCount: number;
	isNewsletter: boolean;
	createdAt: string;
};

export type EmailTemplate = {
	id: string;
	name: string;
	type: string;
	subject: string | null;
	header: string | null;
	body: string;
	footer: string | null;
	isCustom: boolean;
	createdBy: string | null;
	blocks?: EmailBlock[] | null;
	preheader?: string | null;
	fromName?: string | null;
	replyTo?: string | null;
	usedFor?: string;
	isPreset?: boolean;
	createdAt: string;
	updatedAt: string;
};

export type SegmentFilter = { field: string; op: string; value?: unknown };

export type Segment = {
	id: string;
	name: string;
	entity: "applicants" | "leads" | "contacts" | string;
	filters: SegmentFilter[];
	createdAt: string;
	updatedAt: string;
};

export type Person = {
	email: string;
	name: string | null;
	identity: string;
	caseRef: string | null;
	chapter: string | null;
	branch: string | null;
	consent: string;
	consentSource: string | null;
	lists: string[];
	lastEngagement: string | null;
	rowCount: number;
};

export type PersonDetail = {
	person: Person;
	campaigns: {
		campaignId: string;
		name: string;
		status: string;
		sentAt: string | null;
		openedAt: string | null;
		clickedAt: string | null;
		bouncedAt: string | null;
	}[];
	suppression: { reason: string; detail: string | null; createdAt: string } | null;
	optin: { source: string; note: string | null; createdAt: string } | null;
};

export type Suppression = {
	email: string;
	reason: string;
	detail: string | null;
	createdAt: string;
};

export type Automation = {
	id: string;
	name: string;
	event: string;
	segmentId: string | null;
	templateId: string | null;
	subject: string | null;
	delayMinutes: number;
	status: string;
	sends: number;
	sentCount: number;
	createdAt: string;
	updatedAt: string;
};

export type AutomationSend = {
	email: string;
	name: string | null;
	status: string;
	scheduledFor: string;
	sentAt: string | null;
	error: string | null;
};

export type CampaignReport = {
	totals: {
		recipients: number;
		sent: number;
		failed: number;
		skipped: number;
		pending: number;
		opened: number;
		clicked: number;
		bounced: number;
	};
	topLinks: { url: string; clicks: number }[];
	timeline: { hour: string; sent: number; opened: number; clicked: number }[];
};

/* ── Block composer model ────────────────────────────────────────────────── */

export type EmailBlock =
	| { type: "heading"; text: string }
	| { type: "paragraph"; text: string }
	| { type: "button"; text: string; url: string }
	| { type: "divider" }
	| { type: "two_col"; left: string; right: string };

/** Merge fields the worker actually replaces — keep this list honest. */
export const MERGE_FIELDS = [
	{ token: "{{name}}", label: "Full name" },
	{ token: "{{first_name}}", label: "First name" },
	{ token: "{{email}}", label: "Email" },
	{ token: "{{date}}", label: "Today's date" },
	{ token: "{{case_ref}}", label: "Case reference" },
	{ token: "{{stage}}", label: "Chapter / stage" },
	{ token: "{{officer}}", label: "Handler name" },
	{ token: "{{branch}}", label: "Branch" },
	{ token: "{{next_due}}", label: "Next due line" },
	{ token: "{{arrival_window}}", label: "Arrival window" },
	{ token: "{{portal_link}}", label: "Portal link" },
	{ token: "{{preferences_link}}", label: "Preferences link" },
];

export const fmtDate = (iso: string | null | undefined) =>
	iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
