import { z } from "zod";

/**
 * The fee model.
 *
 * Century's own fee is the package's service fee (see packages) plus the
 * items here of kind `century` — the consultation and a short list of
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

/** A destination's third-party tariffs — what the client pays the embassy and the visa centre. */
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

/** How the service fee is collected: the deposit, the pre-departure milestone, the remainder after arrival. */
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
export const feeCatalogueSchema = z.object({
	items: z.array(feeItemSchema),
	destinations: z.array(destinationTariffSchema),
	/** GHS per USD — the rate the client is charged at and receipts convert at. */
	exchangeRate: z.number().positive(),
	serviceFeeSplit: serviceFeeSplitSchema,
});
export type FeeCatalogue = z.infer<typeof feeCatalogueSchema>;

export const DEFAULT_SERVICE_FEE_SPLIT: ServiceFeeSplit = { depositPercent: 10, preDeparturePercent: 50, postArrivalPercent: 40 };
export const DEFAULT_EXCHANGE_RATE = 15;
