import {
	articles,
	coreServices,
	destinations,
	events,
	faqs,
	programs,
	scholarships,
	universities,
} from "./content.js";

/**
 * Site content model for the CMS.
 *
 * The public site's content lives in `data/content.ts` as ~2,500 lines of seed
 * arrays. Rather than move all of it into ops state, the CMS writes a thin
 * **overlay** keyed by `collection:id`, and readers resolve `override ?? seed`.
 *
 * That keeps the seed as the source of truth, makes an edit a small diff, and
 * leaves a clean migration path: swap the overlay store for D1/KV later and the
 * read API doesn't change.
 */

export type CmsStatus = "Published" | "Draft" | "Scheduled";

export type CmsCollectionId =
	| "destinations"
	| "universities"
	| "programs"
	| "scholarships"
	| "services"
	| "blog"
	| "events"
	| "faqs";

/** The editable fields we expose per collection - not every seed property */
export type CmsFieldKind = "text" | "textarea" | "richtext";

export type CmsField = {
	key: string;
	label: string;
	kind: CmsFieldKind;
	/** Rendered under the input as guidance */
	hint?: string;
};

export type CmsCollection = {
	id: CmsCollectionId;
	label: string;
	/** Singular, for buttons and headings */
	noun: string;
	/** Where this collection appears on the public site */
	route: (id: string) => string;
	fields: CmsField[];
	/** Seed records, normalised to a common shape for the list view */
	records: () => CmsRecord[];
};

export type CmsRecord = {
	id: string;
	title: string;
	subtitle: string;
	/** The seed values for every editable field */
	values: Record<string, string>;
};

/** One edited record. Only changed fields are stored. */
export type CmsOverride = {
	values: Record<string, string>;
	status: CmsStatus;
	updatedAt: string;
	updatedBy: string;
};

/** Keyed `collection:id` */
export type CmsOverlay = Record<string, CmsOverride>;

export function cmsKey(collection: CmsCollectionId, id: string) {
	return `${collection}:${id}`;
}

const text = (key: string, label: string, hint?: string): CmsField => ({ key, label, kind: "text", hint });
const area = (key: string, label: string, hint?: string): CmsField => ({ key, label, kind: "textarea", hint });
const rich = (key: string, label: string, hint?: string): CmsField => ({ key, label, kind: "richtext", hint });

export const CMS_COLLECTIONS: CmsCollection[] = [
	{
		id: "destinations",
		label: "Destinations",
		noun: "destination",
		route: (id) => `/destinations/${id}`,
		fields: [text("name", "Name"), text("tagline", "Tagline"), rich("description", "Description")],
		records: () =>
			destinations.map((d) => ({
				id: d.id,
				title: d.name,
				subtitle: d.tagline,
				values: { name: d.name, tagline: d.tagline, description: d.description },
			})),
	},
	{
		id: "universities",
		label: "Universities",
		noun: "university",
		route: (id) => `/universities/${id}`,
		fields: [text("name", "Name"), text("city", "City"), rich("description", "Description")],
		records: () =>
			universities.map((u) => ({
				id: u.id,
				title: u.name,
				subtitle: `${u.city} · ${u.type}`,
				values: { name: u.name, city: u.city, description: u.description },
			})),
	},
	{
		id: "programs",
		label: "Programs",
		noun: "program",
		route: (id) => `/programs/${id}`,
		fields: [text("name", "Name"), text("field", "Field"), text("duration", "Duration"), rich("description", "Description")],
		records: () =>
			programs.map((p) => ({
				id: p.id,
				title: p.name,
				subtitle: `${p.level} · ${p.field}`,
				values: { name: p.name, field: p.field, duration: p.duration, description: p.description },
			})),
	},
	{
		id: "scholarships",
		label: "Scholarships",
		noun: "scholarship",
		route: (id) => `/scholarships/${id}`,
		fields: [
			text("name", "Name"),
			text("amount", "Amount label", "Display only - the figure used for GH₵/USD is amountUsd"),
			text("deadline", "Deadline"),
			text("eligibility", "Eligibility"),
			rich("description", "Description"),
		],
		records: () =>
			scholarships.map((s) => ({
				id: s.id,
				title: s.name,
				subtitle: `${s.type} · ${s.amount}`,
				values: {
					name: s.name,
					amount: s.amount,
					deadline: s.deadline,
					eligibility: s.eligibility,
					description: s.description,
				},
			})),
	},
	{
		id: "services",
		label: "Services",
		noun: "service",
		route: (id) => `/services/${id}`,
		fields: [text("title", "Title"), rich("description", "Description")],
		records: () =>
			coreServices.map((s) => ({
				id: s.id,
				title: s.title,
				subtitle: s.id.replace(/-/g, " "),
				values: { title: s.title, description: s.description },
			})),
	},
	{
		id: "blog",
		label: "Blog posts",
		noun: "post",
		route: (id) => `/blog/${id}`,
		fields: [
			text("title", "Title"),
			text("category", "Category"),
			text("readTime", "Read time"),
			rich("excerpt", "Excerpt"),
		],
		records: () =>
			articles.map((b) => ({
				id: b.id,
				title: b.title,
				subtitle: `${b.category} · ${b.date}`,
				values: { title: b.title, category: b.category, readTime: b.readTime, excerpt: b.excerpt },
			})),
	},
	{
		id: "events",
		label: "Events",
		noun: "event",
		route: () => `/events`,
		fields: [text("title", "Title"), text("date", "Date"), text("time", "Time & place"), area("description", "Description")],
		records: () =>
			events.map((e) => ({
				id: e.id,
				title: e.title,
				subtitle: `${e.date} · ${e.type}`,
				values: { title: e.title, date: e.date, time: e.time, description: e.description },
			})),
	},
	{
		id: "faqs",
		label: "FAQs",
		noun: "FAQ",
		route: () => `/faqs`,
		fields: [text("q", "Question"), area("a", "Answer")],
		records: () =>
			faqs.map((f, i) => ({
				id: String(i),
				title: f.q,
				subtitle: f.a.slice(0, 80),
				values: { q: f.q, a: f.a },
			})),
	},
];

export function getCollection(id: CmsCollectionId) {
	return CMS_COLLECTIONS.find((c) => c.id === id);
}

/** Seed record merged with any override - what the public site should render */
export function resolveRecord(
	collection: CmsCollectionId,
	record: CmsRecord,
	overlay: CmsOverlay,
): { values: Record<string, string>; status: CmsStatus; edited: boolean; override?: CmsOverride } {
	const override = overlay[cmsKey(collection, record.id)];
	if (!override) return { values: record.values, status: "Published", edited: false };
	return {
		values: { ...record.values, ...override.values },
		status: override.status,
		edited: Object.keys(override.values).length > 0,
		override,
	};
}

/** Only fields that actually differ from the seed get stored */
export function diffValues(
	seed: Record<string, string>,
	next: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(next)) {
		if (seed[k] !== v) out[k] = v;
	}
	return out;
}
