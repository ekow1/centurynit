import { z } from "zod";

/**
 * The service stages — what a client buys.
 *
 * A package (the track: how hard Century searches) prices Admissions; Visa
 * and Departure are flat, from the fee catalogue; the three together are
 * the bundle. The client's *scope* is a contiguous segment of the line
 * Admissions → Visa → Departure: where they enter and where they leave.
 * A client who already holds an offer enters at Visa; the chapters before
 * the entry are discarded, not locked. Six shapes: A · A+V · A+V+D · V ·
 * V+D · D.
 *
 * This module is the one place the fee and its milestones are computed —
 * the portal builder, the ops sheet, the fee-schedule example and the API
 * raise all call it, so none of them can disagree.
 */

export const SERVICE_STAGES = ["admissions", "visa", "departure"] as const;
export const serviceStageSchema = z.enum(SERVICE_STAGES);
export type ServiceStage = z.infer<typeof serviceStageSchema>;

export const SERVICE_STAGE_LABELS: Record<ServiceStage, string> = {
	admissions: "Admissions",
	visa: "Visa",
	departure: "Departure & arrival",
};

export const SERVICE_STAGE_BLURBS: Record<ServiceStage, string> = {
	admissions: "Document review and credential verification, university matching, application submissions, offer-letter review.",
	visa: "Financial documents, CAS / I-20 handling, visa filing, biometrics booking, mock interview coaching.",
	departure: "Flight and housing coordination, airport pickup, pre-departure briefing, first-week check-in.",
};

/** Per-stage prices in cents, as a package carries them. */
export const stagePricesSchema = z.object({
	admissions: z.number().int().min(0).max(100_000_000),
	visa: z.number().int().min(0).max(100_000_000),
	departure: z.number().int().min(0).max(100_000_000),
});
export type StagePrices = z.infer<typeof stagePricesSchema>;

export const ALL_STAGES: readonly ServiceStage[] = SERVICE_STAGES;

/**
 * Where a client says they are when they book. It shapes the intake form,
 * what the consultation checks, and pre-fills the plan. Not a contract —
 * the plan is accepted after the consultation.
 */
export const SERVICE_INTENTS = ["admissions", "visa", "departure", "full"] as const;
export const serviceIntentSchema = z.enum(SERVICE_INTENTS);
export type ServiceIntent = z.infer<typeof serviceIntentSchema>;

export const SERVICE_INTENT_LABELS: Record<ServiceIntent, string> = {
	admissions: "I need help getting admitted",
	visa: "I have an offer, I need the visa",
	departure: "Visa approved — help me get there",
	full: "Take me from the start to arrival",
};

/** The stages an intent starts the plan with. */
export function intentScope(intent: ServiceIntent | null | undefined): ServiceStage[] {
	switch (intent) {
		case "visa":
			return ["visa"];
		case "departure":
			return ["departure"];
		case "admissions":
			return ["admissions"];
		default:
			return [...SERVICE_STAGES];
	}
}

/**
 * Normalise a scope: a contiguous segment of the line, in canonical order,
 * with any gap filled (Admissions + Departure means the visa too — nobody
 * works a case they did not see the middle of). Anything unknown is
 * dropped; an empty list is Admissions; no scope at all (a legacy case, an
 * old client) is the full journey.
 */
export function normaliseScope(stages: readonly string[] | null | undefined): ServiceStage[] {
	if (stages == null) return [...SERVICE_STAGES];
	const idx = stages
		.map((s) => (SERVICE_STAGES as readonly string[]).indexOf(s))
		.filter((i) => i >= 0);
	if (idx.length === 0) return ["admissions"];
	const lo = Math.min(...idx);
	const hi = Math.max(...idx);
	return SERVICE_STAGES.slice(lo, hi + 1);
}

/** The stage the client enters at — the first on the plan. */
export function entryStage(stages: readonly string[] | null | undefined): ServiceStage {
	return normaliseScope(stages)[0];
}

/** The journey stage a case opens at for its entry, once the plan's first milestone is paid. */
export function entryJourneyStage(stages: readonly string[] | null | undefined): "school_submission" | "visa_processing" | "travel_assistance" {
	switch (entryStage(stages)) {
		case "visa":
			return "visa_processing";
		case "departure":
			return "travel_assistance";
		default:
			return "school_submission";
	}
}

export function isFullScope(stages: readonly string[] | null | undefined): boolean {
	return normaliseScope(stages).length === SERVICE_STAGES.length;
}

/** Whether the plan includes the stage — a legacy case (no scope) has them all. */
export function scopeHas(stages: readonly string[] | null | undefined, stage: ServiceStage): boolean {
	return normaliseScope(stages).includes(stage);
}

const SHORT: Record<ServiceStage, string> = { admissions: "Admissions", visa: "Visa", departure: "Departure" };

export function scopeLabel(stages: readonly string[] | null | undefined): string {
	const scope = normaliseScope(stages);
	if (scope.length === 3) return "Full journey";
	if (scope.length === 1) return `${SHORT[scope[0]]} only`;
	return scope.map((s) => SHORT[s]).join(" + ");
}

/**
 * The documents each stage needs, by document type id (see DOCUMENT_TYPES
 * in core). A case's checklist is the union over its scope; the entry
 * stage's *evidence* is what must be verified before that stage's file
 * opens — the offer letter for a visa entry, the visa grant for departure.
 * The Admissions set is the package's `requiredDocuments` (by track), so it
 * is not listed here.
 */
export const STAGE_DOCUMENT_IDS: Record<Exclude<ServiceStage, "admissions">, readonly string[]> = {
	visa: ["passport", "photo", "financial", "admission_letter", "tb_test"],
	departure: ["visa_grant", "insurance", "accommodation_proof"],
};

export const ENTRY_EVIDENCE_IDS: Record<ServiceStage, readonly string[]> = {
	admissions: [],
	visa: ["admission_letter"],
	departure: ["visa_grant", "admission_letter"],
};

/**
 * The stage beyond the plan's exit — the one a completed client can ask
 * for. Null when the plan already covers the whole journey. The scope is
 * contiguous, so the requestable stage is always the step after its exit.
 */
export function requestableStageFor(stages: readonly string[] | null | undefined): ServiceStage | null {
	const scope = normaliseScope(stages);
	const exitIdx = (SERVICE_STAGES as readonly string[]).indexOf(scope[scope.length - 1]);
	return SERVICE_STAGES[exitIdx + 1] ?? null;
}

/**
 * What a stage must learn before its file can be worked — the questions and
 * documents a client entering at that stage gives at assessment, replayed
 * for a client who continued into the stage later. The field ids are the
 * assessment's own, so answers land where an entrant's would have.
 */
export type StageIntakeField = {
	id: string;
	label: string;
	hint?: string;
	kind: "text" | "yesno" | "number";
	/** Shown only when the named field equals this value. */
	showIf?: { id: string; equals: string };
};

export const STAGE_INTAKE: Record<Exclude<ServiceStage, "admissions">, { fields: StageIntakeField[]; documentIds: readonly string[] }> = {
	visa: {
		fields: [
			{ id: "visaRefusedBefore", label: "Ever been refused a visa — any country?", hint: "A refusal shapes the whole strategy. We ask before the embassy does.", kind: "yesno" },
			{ id: "visaRefusalCountry", label: "Which country refused it?", kind: "text", showIf: { id: "visaRefusedBefore", equals: "yes" } },
			{ id: "visaRefusalYear", label: "When?", hint: "e.g. 2023", kind: "text", showIf: { id: "visaRefusedBefore", equals: "yes" } },
			{ id: "visaRefusalReason", label: "The reason they gave, if you know it", kind: "text", showIf: { id: "visaRefusedBefore", equals: "yes" } },
			{ id: "priorApplications", label: "Previous applications — any country, approved or not", kind: "text" },
			{ id: "travelHistory", label: "Countries visited in the last 5 years", kind: "text" },
		],
		documentIds: STAGE_DOCUMENT_IDS.visa,
	},
	departure: {
		fields: [
			{ id: "arrivalCity", label: "Arrival city", kind: "text" },
			{ id: "arrivalAirport", label: "Arrival airport", kind: "text" },
			{ id: "arrivalWindow", label: "When do you plan to land?", hint: "A month or week is fine.", kind: "text" },
			{ id: "needsAccommodation", label: "Do you need housing arranged?", kind: "yesno" },
			{ id: "needsPickup", label: "Airport pickup on landing?", kind: "yesno" },
			{ id: "dependants", label: "Dependants travelling with you", kind: "number" },
		],
		documentIds: STAGE_DOCUMENT_IDS.departure,
	},
};

/**
 * Stage prices for a package that has none yet — the legacy rows priced
 * the whole journey as one number. Split so à la carte lands a little
 * above the bundle, which is the point of a bundle.
 */
export function defaultStagePrices(bundleCents: number): StagePrices {
	return {
		admissions: Math.round(bundleCents * 0.47),
		visa: Math.round(bundleCents * 0.47),
		departure: Math.round(bundleCents * 0.2),
	};
}

export type QuoteInput = {
	/** The package's bundle price — all three stages. */
	bundleCents: number;
	stagePrices: StagePrices | null | undefined;
	stages: readonly string[] | null | undefined;
};

export type Quote = {
	scope: ServiceStage[];
	full: boolean;
	/** One row per stage in scope, at the à-la-carte price. */
	stageLines: { stage: ServiceStage; amountCents: number }[];
	alaCarteCents: number;
	/** Zero unless the scope is full and the bundle undercuts à la carte. */
	bundleDiscountCents: number;
	totalCents: number;
};

/** The service fee for a scope. Bundle when full, à la carte otherwise. */
export function quoteTotal(input: QuoteInput): Quote {
	const scope = normaliseScope(input.stages);
	const prices = input.stagePrices ?? defaultStagePrices(input.bundleCents);
	const stageLines = scope.map((stage) => ({ stage, amountCents: prices[stage] }));
	const alaCarteCents = stageLines.reduce((n, l) => n + l.amountCents, 0);
	const full = scope.length === SERVICE_STAGES.length;
	// A bundle priced at zero (a legacy row) falls back to à la carte.
	const bundleApplies = full && input.bundleCents > 0 && input.bundleCents < alaCarteCents;
	const totalCents = bundleApplies ? input.bundleCents : alaCarteCents;
	return { scope, full, stageLines, alaCarteCents, bundleDiscountCents: bundleApplies ? alaCarteCents - input.bundleCents : 0, totalCents };
}

/**
 * When a milestone falls due. Stamped on the invoice line; the matching
 * case event stamps `dueAt`. `scheduled` is the post-arrival instalment
 * the client dates by choosing a schedule.
 */
export const DUE_TRIGGERS = ["acceptance", "offer", "visa_open", "visa_approved", "arrival", "scheduled"] as const;
export const dueTriggerSchema = z.enum(DUE_TRIGGERS);
export type DueTrigger = z.infer<typeof dueTriggerSchema>;

export const DUE_TRIGGER_LABELS: Record<DueTrigger, string> = {
	acceptance: "On acceptance",
	offer: "When your first offer letter is recorded",
	visa_open: "When the visa file opens",
	visa_approved: "After your visa is approved",
	arrival: "After you arrive",
	scheduled: "On the schedule you choose",
};

export type MilestoneLine = {
	position: number;
	label: string;
	detail: string;
	amountCents: number;
	dueOn: DueTrigger;
	/** The stage this line pays for; the full-journey split has none. */
	stage: ServiceStage | null;
};

export type MilestoneSplit = {
	/** Full journey: the deposit / pre-departure / post-arrival split. */
	depositPercent: number;
	preDeparturePercent: number;
	/** Admissions on its own: the share due on acceptance; the rest on the first offer. */
	admissionsStartPercent: number;
};

export const DEFAULT_ADMISSIONS_START_PERCENT = 50;

/**
 * The lines an accepted plan raises.
 *
 * Full journey keeps the deposit / pre-departure / post-arrival shape (the
 * only scope where "post-arrival" exists), or deposit + balance on the full
 * plan. A partial scope is paid per stage: Admissions half on acceptance
 * and half on the first offer, Visa when its file opens, Departure on visa
 * approval — except that the *entry* stage is always due on acceptance,
 * because accepting the plan is what opens that file.
 */
export function milestoneLines(quote: Quote, split: MilestoneSplit, paymentPlanId: string | null | undefined): MilestoneLine[] {
	const total = quote.totalCents;
	if (quote.full) {
		const deposit = Math.round((total * split.depositPercent) / 100);
		if (paymentPlanId === "full") {
			const full: MilestoneLine[] = [
				{ position: 0, label: "Service fee · deposit", detail: "Required before choosing your payment plan", amountCents: deposit, dueOn: "acceptance", stage: null },
				{ position: 1, label: "Service fee · balance", detail: "Due after your visa is approved — releases your travel documents", amountCents: total - deposit, dueOn: "visa_approved", stage: null },
			];
			return full.filter((l) => l.amountCents > 0);
		}
		const pre = Math.round((total * split.preDeparturePercent) / 100);
		const split3: MilestoneLine[] = [
			{ position: 0, label: "Service fee · deposit", detail: "Required before choosing your payment plan", amountCents: deposit, dueOn: "acceptance", stage: null },
			{ position: 1, label: "Service fee · pre-departure", detail: "Due after your visa is approved. Releases your travel documents", amountCents: pre, dueOn: "visa_approved", stage: null },
			{ position: 2, label: "Service fee · post-arrival", detail: "After you arrive, on the schedule you choose", amountCents: total - deposit - pre, dueOn: "arrival", stage: null },
		];
		return split3.filter((l) => l.amountCents > 0);
	}
	return stageLines(quote.stageLines, split, 0, 0, quote.scope[0]);
}

/**
 * Per-stage lines, for a partial scope or for stages added to a plan
 * later. `discountCents` (a bundle completed by an upgrade) comes off the
 * last line so no line ever goes negative.
 */
export function stageLines(
	stages: { stage: ServiceStage; amountCents: number }[],
	split: MilestoneSplit,
	firstPosition: number,
	discountCents = 0,
	/** The plan's entry stage: its line is due on acceptance rather than on its event. */
	entry: ServiceStage | null = null,
): MilestoneLine[] {
	const out: MilestoneLine[] = [];
	let position = firstPosition;
	for (const { stage, amountCents } of stages) {
		if (stage === "admissions") {
			const start = Math.round((amountCents * split.admissionsStartPercent) / 100);
			out.push({ position: position++, label: "Admissions · on acceptance", detail: "Opens document verification and school matching", amountCents: start, dueOn: "acceptance", stage });
			out.push({ position: position++, label: "Admissions · on offer", detail: DUE_TRIGGER_LABELS.offer, amountCents: amountCents - start, dueOn: "offer", stage });
		} else if (stage === "visa") {
			const atEntry = entry === "visa";
			out.push({ position: position++, label: "Visa", detail: atEntry ? "On acceptance — opens your visa file" : DUE_TRIGGER_LABELS.visa_open, amountCents, dueOn: atEntry ? "acceptance" : "visa_open", stage });
		} else {
			const atEntry = entry === "departure";
			out.push({ position: position++, label: "Departure & arrival", detail: atEntry ? "On acceptance — opens your departure file" : DUE_TRIGGER_LABELS.visa_approved, amountCents, dueOn: atEntry ? "acceptance" : "visa_approved", stage });
		}
	}
	if (discountCents > 0 && out.length > 0) {
		const last = out[out.length - 1];
		const off = Math.min(discountCents, last.amountCents);
		last.amountCents -= off;
		last.detail = `${last.detail} · includes the full-journey bundle discount`;
	}
	return out.filter((l) => l.amountCents > 0).map((l, i) => ({ ...l, position: firstPosition + i }));
}

/**
 * The chapters — the one numbering every surface uses (I–VI). Consultation
 * and Enrolment are on every plan; Applications, Visa and Departure only
 * when the plan has that stage; Complete always. A journey stage maps onto
 * one chapter; progress is counted in chapters *on the plan*, so a two-stage
 * plan reads "2 of 4", never "step 4 of 7".
 */
export const CHAPTERS_ORDERED = [
	{ id: "consultation", numeral: "I", label: "Consultation", stage: null },
	{ id: "enrolment", numeral: "II", label: "Enrolment", stage: null },
	{ id: "applications", numeral: "III", label: "Applications", stage: "admissions" },
	{ id: "visa", numeral: "IV", label: "Visa", stage: "visa" },
	{ id: "departure", numeral: "V", label: "Departure", stage: "departure" },
	{ id: "complete", numeral: "VI", label: "Complete", stage: null },
] as const;
export type ChapterKey = (typeof CHAPTERS_ORDERED)[number]["id"];

/** The chapter a journey stage sits in. `payment_execution` was folded into Departure. */
export function chapterOfJourneyStage(stage: string): ChapterKey {
	switch (stage) {
		case "document_verification":
			return "enrolment";
		case "school_submission":
		case "offer_letter_review":
			return "applications";
		case "visa_processing":
			return "visa";
		case "travel_assistance":
		case "payment_execution":
			return "departure";
		case "completed":
			return "complete";
		default:
			return "enrolment";
	}
}

/** The chapters a plan has, in order. Null scope is the full journey. */
export function planChapters(stages: readonly string[] | null | undefined): (typeof CHAPTERS_ORDERED)[number][] {
	const scope = normaliseScope(stages);
	return CHAPTERS_ORDERED.filter((c) => c.stage == null || scope.includes(c.stage));
}

/**
 * Where a case is, counted in the chapters on its plan: "IV · Visa · 3 of
 * 4". `atExit` when the case sits in the plan's last working chapter — the
 * one after which the plan ends — so a card can say so instead of a fraction.
 */
export function chapterProgress(stages: readonly string[] | null | undefined, journeyStage: string): { key: ChapterKey; numeral: string; label: string; step: number; total: number; atExit: boolean } {
	const chapters = planChapters(stages);
	const key = chapterOfJourneyStage(journeyStage);
	const idx = chapters.findIndex((c) => c.id === key);
	const at = idx >= 0 ? chapters[idx] : chapters[0];
	const working = chapters.filter((c) => c.id !== "complete");
	return {
		key: at.id,
		numeral: at.numeral,
		label: at.label,
		step: Math.max(1, idx + 1),
		total: chapters.length,
		atExit: key !== "complete" && working[working.length - 1]?.id === key,
	};
}

/** Which service stage a journey stage belongs to; null for the ones every plan has. */
export function serviceStageForJourney(journeyStage: string): ServiceStage | null {
	switch (journeyStage) {
		case "visa_processing":
			return "visa";
		case "travel_assistance":
		case "completed":
			return "departure";
		default:
			return null;
	}
}

/**
 * What finishing each stage hands the chapter after it — the "after X" the
 * portal rail names.
 */
const STAGE_EXIT_HINT: Record<ServiceStage, string> = {
	admissions: "when you're admitted",
	visa: "once your visa is approved",
	departure: "once you've landed",
};

/**
 * The line under an on-plan service chapter on the portal rail: the exit
 * fact of the previous stage *on the plan*, or enrolment when the stage is
 * the plan's first — a visa entrant reads "after enrolment", never "when
 * you're admitted" for an admission they already hold.
 */
export function stageUnlockHint(stages: readonly string[] | null | undefined, stage: ServiceStage): string {
	const scope = normaliseScope(stages);
	const prior = SERVICE_STAGES.slice(0, SERVICE_STAGES.indexOf(stage)).filter((s) => scope.includes(s));
	return prior.length ? STAGE_EXIT_HINT[prior[prior.length - 1]] : "after enrolment";
}

/** The line under Complete — the plan's own ending, not the whole journey's. */
export function planCompleteHint(stages: readonly string[] | null | undefined): string {
	const last = normaliseScope(stages)[normaliseScope(stages).length - 1];
	return last === "admissions" ? "when your offer is in hand" : STAGE_EXIT_HINT[last];
}

/**
 * True when the plan enters after this stage — the client brought its
 * result (their offer, their visa), so it was never owed. The rail says
 * "not needed", not "not included".
 */
export function stageSkippedByEntry(stages: readonly string[] | null | undefined, stage: ServiceStage): boolean {
	const scope = normaliseScope(stages);
	return !scope.includes(stage) && SERVICE_STAGES.indexOf(stage) < SERVICE_STAGES.indexOf(scope[0]);
}
