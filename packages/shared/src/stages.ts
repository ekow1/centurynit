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
