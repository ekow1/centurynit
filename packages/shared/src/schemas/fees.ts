import { z } from "zod";

/**
 * The fee model.
 *
 * Century's own fee is the package's service fee (see packages) plus the
 * items here of kind `century`. The consultation and a short list of
 * add-ons. Everything else the client pays through Century is a third-party
 * cost recovered at cost (`pass_through`): the universities' application
 * fees and the destinations' visa and biometrics fees live on the catalogue
 * rows; the optional at-cost items (translation, TB test, courier) live here.
 */

export const feeKindSchema = z.enum(["century", "pass_through"]);
export type FeeKind = z.infer<typeof feeKindSchema>;

export const FEE_KIND_LABELS: Record<FeeKind, string> = {
	century: "Century's fee",
	pass_through: "Paid on your behalf",
};

export const feeItemSchema = z.object({
	key: z.string(),
	kind: feeKindSchema,
	/** Which chapter raises it: consult · apply · visa · depart. */
	chapter: z.string(),
	name: z.string(),
	/** What the client reads on the invoice line. */
	clientLabel: z.string(),
	description: z.string().nullable(),
	amountCents: z.number().int(),
	/** Offered as a tick-box when raising or approving, rather than added on its own. */
	optional: z.boolean(),
	active: z.boolean(),
	sortOrder: z.number().int(),
	updatedAt: z.string().datetime(),
});
export type FeeItem = z.infer<typeof feeItemSchema>;

export const updateFeeItemSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	clientLabel: z.string().min(1).max(160).optional(),
	description: z.string().max(500).nullable().optional(),
	amountCents: z.number().int().min(0).max(100_000_000).optional(),
	optional: z.boolean().optional(),
	active: z.boolean().optional(),
	sortOrder: z.number().int().optional(),
});
export type UpdateFeeItem = z.infer<typeof updateFeeItemSchema>;

/** A destination's third-party tariffs. What the client pays the embassy and the visa centre. */
export const destinationTariffSchema = z.object({
	id: z.string(),
	name: z.string(),
	visaFeeCents: z.number().int(),
	biometricsFeeCents: z.number().int(),
});
export type DestinationTariff = z.infer<typeof destinationTariffSchema>;

export const updateDestinationTariffSchema = z.object({
	visaFeeCents: z.number().int().min(0).max(100_000_000).optional(),
	biometricsFeeCents: z.number().int().min(0).max(100_000_000).optional(),
});
export type UpdateDestinationTariff = z.infer<typeof updateDestinationTariffSchema>;

/**
 * How the service fee is collected: the deposit at enrolment, the
 * pre-departure milestone after the visa (it releases the travel documents),
 * the remainder after arrival on a schedule the client picks.
 */
export const serviceFeeSplitSchema = z.object({
	depositPercent: z.number().int().min(1).max(98),
	preDeparturePercent: z.number().int().min(1).max(98),
	postArrivalPercent: z.number().int().min(1).max(98),
});
export type ServiceFeeSplit = z.infer<typeof serviceFeeSplitSchema>;

/**
 * The one payload every surface prices from: the items, the destinations'
 * tariffs, the exchange rate the client is charged at, and the milestone
 * split. Served publicly so the portal shows exactly what will be charged.
 */
/** How often a post-arrival instalment falls. */
export const POST_ARRIVAL_FREQUENCIES = ["monthly", "biweekly", "weekly"] as const;
export const postArrivalFrequencySchema = z.enum(POST_ARRIVAL_FREQUENCIES);
export type PostArrivalFrequency = z.infer<typeof postArrivalFrequencySchema>;
export const POST_ARRIVAL_FREQUENCY_LABELS: Record<PostArrivalFrequency, string> = {
	monthly: "Monthly",
	biweekly: "Every 2 weeks",
	weekly: "Weekly",
};

/**
 * What the client may choose for the post-arrival remainder: the durations
 * (months) and frequencies on offer, the grace after arrival before the
 * first instalment, and how many days ahead a reminder goes.
 */
export const postArrivalCatalogueSchema = z.object({
	durations: z.array(z.number().int().min(1).max(36)).min(1),
	frequencies: z.array(postArrivalFrequencySchema).min(1),
	graceDays: z.number().int().min(0).max(180),
	remindDays: z.number().int().min(0).max(60),
	/** Flat interest on the post-arrival remainder, priced into each instalment at approval. */
	interestPct: z.number().min(0).max(100).default(0),
});
export type PostArrivalCatalogue = z.infer<typeof postArrivalCatalogueSchema>;

export const DEFAULT_POST_ARRIVAL_CATALOGUE: PostArrivalCatalogue = {
	durations: [3, 6, 9, 12],
	frequencies: ["monthly", "biweekly"],
	graceDays: 30,
	remindDays: 7,
	interestPct: 8,
};

export const feeCatalogueSchema = z.object({
	items: z.array(feeItemSchema),
	destinations: z.array(destinationTariffSchema),
	/** GHS per USD. The rate the client is charged at and receipts convert at. */
	exchangeRate: z.number().positive(),
	serviceFeeSplit: serviceFeeSplitSchema,
	/** Optional only so older clients keep parsing. */
	postArrival: postArrivalCatalogueSchema.optional(),
});
export type FeeCatalogue = z.infer<typeof feeCatalogueSchema>;

export const DEFAULT_SERVICE_FEE_SPLIT: ServiceFeeSplit = { depositPercent: 10, preDeparturePercent: 30, postArrivalPercent: 60 };

/** The client's post-arrival choice. */
export const postArrivalScheduleChoiceSchema = z.object({
	months: z.number().int().min(1).max(36),
	frequency: postArrivalFrequencySchema,
});
export type PostArrivalScheduleChoice = z.infer<typeof postArrivalScheduleChoiceSchema>;

export type PostArrivalInstalment = {
	/** 1-based position in the schedule. */
	n: number;
	total: number;
	amountCents: number;
	/** ISO date the instalment falls, or null until arrival is known. */
	dueAt: string | null;
};

/** How many instalments a duration yields at a frequency. */
export function postArrivalInstalmentCount(months: number, frequency: PostArrivalFrequency): number {
	if (frequency === "monthly") return Math.max(1, months);
	if (frequency === "biweekly") return Math.max(1, Math.round((months * 365) / 12 / 14));
	return Math.max(1, Math.round((months * 365) / 12 / 7));
}

/**
 * The instalments for a remainder: equal parts (the last takes the rounding),
 * dated from the anchor plus the grace, then every interval. With no anchor
 *. The client has not arrived yet. The dates are null and the count and
 * amounts still stand.
 */
/** Flat interest on the principal — the total the instalments must add up to. */
export function postArrivalInterestCents(amountCents: number, interestPct: number): number {
	return Math.round((amountCents * interestPct) / 100);
}

export function postArrivalInstalments(input: {
	amountCents: number;
	months: number;
	frequency: PostArrivalFrequency;
	anchor: Date | string | null;
	graceDays: number;
	/** Flat interest on the remainder; the instalments total principal + interest. */
	interestPct?: number;
}): PostArrivalInstalment[] {
	const count = postArrivalInstalmentCount(input.months, input.frequency);
	const totalCents = input.amountCents + postArrivalInterestCents(input.amountCents, input.interestPct ?? 0);
	const each = Math.floor(totalCents / count);
	const anchor = input.anchor ? new Date(input.anchor) : null;
	const out: PostArrivalInstalment[] = [];
	for (let i = 0; i < count; i++) {
		const amountCents = i === count - 1 ? totalCents - each * (count - 1) : each;
		let dueAt: string | null = null;
		if (anchor && !Number.isNaN(anchor.getTime())) {
			const d = new Date(anchor);
			d.setUTCDate(d.getUTCDate() + input.graceDays);
			if (input.frequency === "monthly") d.setUTCMonth(d.getUTCMonth() + i);
			else d.setUTCDate(d.getUTCDate() + i * (input.frequency === "biweekly" ? 14 : 7));
			dueAt = d.toISOString();
		}
		out.push({ n: i + 1, total: count, amountCents, dueAt });
	}
	return out;
}

/** One row of the transaction ledger — the same truth served to portal and ops. */
export const ledgerRowSchema = z.object({
	id: z.string(),
	at: z.string(),
	label: z.string(),
	invoiceId: z.string(),
	invoiceNumber: z.string(),
	channel: z.string(),
	reference: z.string().nullable(),
	amountCents: z.number(),
	status: z.enum(["settled", "manual", "declined", "scheduled"]),
	failureReason: z.string().nullable(),
	recordedBy: z.string().nullable(),
	balanceAfterCents: z.number().nullable(),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

const joinList = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`);

/**
 * The plans in the client's words, written from the configured split and
 * catalogue. The one text the portal's plan cards, the block reasons and
 * the settings page all show. Nothing else spells a number.
 */
export function feePlanSentences(split: ServiceFeeSplit, catalogue: PostArrivalCatalogue = DEFAULT_POST_ARRIVAL_CATALOGUE): { installment: string; full: string; installmentShort: string; fullShort: string } {
	const durations = joinList(catalogue.durations.map(String));
	const frequencies = joinList(catalogue.frequencies.map((f) => POST_ARRIVAL_FREQUENCY_LABELS[f].toLowerCase()));
	return {
		installment: `${split.depositPercent}% now, ${split.preDeparturePercent}% after your visa is approved and before your travel documents are released, and the remaining ${split.postArrivalPercent}% after you arrive. Over ${durations} months, ${frequencies}, starting ${catalogue.graceDays} days after arrival.`,
		full: `${split.depositPercent}% now and the balance after your visa is approved, before your travel documents are released.`,
		installmentShort: `${split.depositPercent}% now · ${split.preDeparturePercent}% after your visa · ${split.postArrivalPercent}% after you arrive, on your schedule`,
		fullShort: `${split.depositPercent}% now · the balance after your visa, before your travel documents`,
	};
}
export const DEFAULT_EXCHANGE_RATE = 15;
