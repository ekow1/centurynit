import { asc, eq } from "drizzle-orm";
import {
	DEFAULT_ADMISSIONS_START_PERCENT,
	DEFAULT_EXCHANGE_RATE,
	DEFAULT_POST_ARRIVAL_CATALOGUE,
	DEFAULT_SERVICE_FEE_SPLIT,
	POST_ARRIVAL_FREQUENCIES,
	type DestinationTariff,
	type FeeCatalogue,
	type FeeItem,
	type MilestoneSplit,
	type PostArrivalCatalogue,
	type PostArrivalFrequency,
	type ServiceFeeSplit,
	type UpdateDestinationTariff,
	type UpdateFeeItem,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { destinations, feeItems, settingsAudit } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { getSetting } from "./settings.js";

/**
 * The fee catalogue — the one place every surface prices from.
 *
 * Century's own items (the consultation, the add-ons) and the optional
 * at-cost items are rows in `fee_items`; a destination's visa and
 * biometrics fees sit on the destination; a university's application fee
 * sits on the university (a programme may override it). The exchange rate
 * and the service-fee split are settings. `feeCatalogue()` gathers them
 * into the payload the portal, the console and the raise paths all read.
 */

function serializeItem(row: typeof feeItems.$inferSelect): FeeItem {
	return {
		key: row.key,
		kind: row.kind,
		chapter: row.chapter,
		name: row.name,
		clientLabel: row.clientLabel,
		description: row.description ?? null,
		amountCents: row.amountCents,
		optional: row.optional,
		active: row.active,
		sortOrder: row.sortOrder,
		updatedAt: row.updatedAt.toISOString(),
	};
}

export async function listFeeItems(): Promise<FeeItem[]> {
	const rows = await db.select().from(feeItems).orderBy(asc(feeItems.sortOrder), asc(feeItems.key));
	return rows.map(serializeItem);
}

/** One item by key; null when it does not exist or is switched off. */
export async function activeFeeItem(key: string): Promise<FeeItem | null> {
	const [row] = await db.select().from(feeItems).where(eq(feeItems.key, key)).limit(1);
	return row && row.active ? serializeItem(row) : null;
}

export async function updateFeeItem(
	key: string,
	patch: UpdateFeeItem,
	actor: { opsUserId?: string | null; email?: string | null },
): Promise<FeeItem> {
	const [current] = await db.select().from(feeItems).where(eq(feeItems.key, key)).limit(1);
	if (!current) throw new HttpError(404, "FEE_ITEM_NOT_FOUND", "No such fee item");
	const [updated] = await db
		.update(feeItems)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(feeItems.key, key))
		.returning();
	const changedKeys = Object.entries(patch)
		.filter(([k, v]) => v !== undefined && (current as Record<string, unknown>)[k] !== v)
		.map(([k]) => k);
	if (changedKeys.length > 0) {
		const snapshot = (row: Record<string, unknown>) => changedKeys.map((k) => `${k}=${String(row[k])}`).join(", ");
		await db.insert(settingsAudit).values({
			key: `fee:${key}`.slice(0, 64),
			actorId: actor.opsUserId ?? null,
			actorEmail: actor.email ?? null,
			oldValueMasked: snapshot(current as unknown as Record<string, unknown>),
			newValueMasked: snapshot(updated as unknown as Record<string, unknown>),
		});
	}
	return serializeItem(updated);
}

export async function listDestinationTariffs(): Promise<DestinationTariff[]> {
	const rows = await db
		.select({ id: destinations.id, name: destinations.name, visaFeeCents: destinations.visaFeeCents, biometricsFeeCents: destinations.biometricsFeeCents })
		.from(destinations)
		.orderBy(asc(destinations.name));
	return rows;
}

export async function updateDestinationTariff(
	id: string,
	patch: UpdateDestinationTariff,
	actor: { opsUserId?: string | null; email?: string | null },
): Promise<DestinationTariff> {
	const [current] = await db.select().from(destinations).where(eq(destinations.id, id)).limit(1);
	if (!current) throw new HttpError(404, "DESTINATION_NOT_FOUND", "No such destination");
	const [updated] = await db
		.update(destinations)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(destinations.id, id))
		.returning({ id: destinations.id, name: destinations.name, visaFeeCents: destinations.visaFeeCents, biometricsFeeCents: destinations.biometricsFeeCents });
	const changedKeys = (["visaFeeCents", "biometricsFeeCents"] as const).filter((k) => patch[k] !== undefined && current[k] !== patch[k]);
	if (changedKeys.length > 0) {
		await db.insert(settingsAudit).values({
			key: `tariff:${id}`.slice(0, 64),
			actorId: actor.opsUserId ?? null,
			actorEmail: actor.email ?? null,
			oldValueMasked: changedKeys.map((k) => `${k}=${current[k]}`).join(", "),
			newValueMasked: changedKeys.map((k) => `${k}=${updated[k]}`).join(", "),
		});
	}
	return updated;
}

/** GHS per USD — the rate the client is charged at. */
export async function exchangeRate(): Promise<number> {
	const raw = await getSetting("PLATFORM_EXCHANGE_RATE");
	const n = raw ? Number.parseFloat(raw) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_EXCHANGE_RATE;
}

/** The milestone split, kept to a whole 100 %. */
export async function serviceFeeSplit(): Promise<ServiceFeeSplit> {
	const pct = async (key: "SERVICE_FEE_DEPOSIT_PERCENT" | "SERVICE_FEE_PRE_DEPARTURE_PERCENT", fallback: number) => {
		const raw = await getSetting(key);
		const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
		return Number.isFinite(n) && n >= 1 && n <= 98 ? n : fallback;
	};
	const depositPercent = await pct("SERVICE_FEE_DEPOSIT_PERCENT", DEFAULT_SERVICE_FEE_SPLIT.depositPercent);
	let preDeparturePercent = await pct("SERVICE_FEE_PRE_DEPARTURE_PERCENT", DEFAULT_SERVICE_FEE_SPLIT.preDeparturePercent);
	if (depositPercent + preDeparturePercent >= 100) preDeparturePercent = Math.max(1, 99 - depositPercent);
	return { depositPercent, preDeparturePercent, postArrivalPercent: 100 - depositPercent - preDeparturePercent };
}

/** Admissions on its own: the share due on acceptance, the rest on the first offer. */
export async function admissionsStartPercent(): Promise<number> {
	const raw = await getSetting("SERVICE_FEE_ADMISSIONS_START_PERCENT");
	const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
	return Number.isFinite(n) && n >= 1 && n <= 99 ? n : DEFAULT_ADMISSIONS_START_PERCENT;
}

/** Everything `milestoneLines` needs, in one read. */
export async function milestoneSplit(): Promise<MilestoneSplit> {
	const [split, admissions] = await Promise.all([serviceFeeSplit(), admissionsStartPercent()]);
	return { depositPercent: split.depositPercent, preDeparturePercent: split.preDeparturePercent, admissionsStartPercent: admissions };
}

/** What the client may pick for the post-arrival remainder — from settings, with the defaults behind them. */
export async function postArrivalCatalogue(): Promise<PostArrivalCatalogue> {
	const d = DEFAULT_POST_ARRIVAL_CATALOGUE;
	const ints = (raw: string | undefined, min: number, max: number) =>
		(raw ?? "")
			.split(",")
			.map((x) => Number.parseInt(x.trim(), 10))
			.filter((n) => Number.isFinite(n) && n >= min && n <= max);
	const durations = ints(await getSetting("POST_ARRIVAL_DURATIONS"), 1, 36);
	const frequencies = (await getSetting("POST_ARRIVAL_FREQUENCIES") ?? "")
		.split(",")
		.map((x) => x.trim())
		.filter((x): x is PostArrivalFrequency => (POST_ARRIVAL_FREQUENCIES as readonly string[]).includes(x));
	const days = async (key: "POST_ARRIVAL_GRACE_DAYS" | "POST_ARRIVAL_REMIND_DAYS" | "POST_ARRIVAL_INTEREST_PCT", fallback: number, max: number) => {
		const n = Number.parseInt((await getSetting(key)) ?? "", 10);
		return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
	};
	return {
		durations: durations.length > 0 ? [...new Set(durations)].sort((a, b) => a - b) : d.durations,
		frequencies: frequencies.length > 0 ? [...new Set(frequencies)] : d.frequencies,
		graceDays: await days("POST_ARRIVAL_GRACE_DAYS", d.graceDays, 180),
		remindDays: await days("POST_ARRIVAL_REMIND_DAYS", d.remindDays, 60),
		interestPct: await days("POST_ARRIVAL_INTEREST_PCT", d.interestPct, 100),
	};
}

export async function feeCatalogue(): Promise<FeeCatalogue> {
	const [items, tariffs, rate, split, postArrival, admissions] = await Promise.all([
		listFeeItems(),
		listDestinationTariffs(),
		exchangeRate(),
		serviceFeeSplit(),
		postArrivalCatalogue(),
		admissionsStartPercent(),
	]);
	return { items, destinations: tariffs, exchangeRate: rate, serviceFeeSplit: split, admissionsStartPercent: admissions, postArrival };
}
