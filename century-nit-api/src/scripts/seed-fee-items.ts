/**
 * One-off after migration 0084: copy the fee amounts finance had set in
 * platform settings (encrypted, so the migration could not read them) onto
 * the fee items that replace them. Safe to re-run; only overwrites when a
 * setting is present.
 *
 *   DOTENV_CONFIG_PATH=.env.production npx tsx src/scripts/seed-fee-items.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { feeItems } from "../db/schema.js";
import { getSetting, type SettingKey } from "../services/settings.js";

const MAP: { key: string; setting: SettingKey }[] = [
	{ key: "consultation", setting: "CONSULTATION_FEE_CENTS" },
	{ key: "extra_school", setting: "APP_PER_SCHOOL_FEE_CENTS" },
	{ key: "translation", setting: "VISA_TRANSLATION_FEE_CENTS" },
];

for (const { key, setting } of MAP) {
	const raw = await getSetting(setting);
	const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
	if (!Number.isFinite(n) || n < 0) {
		console.log(`${key}: ${setting} unset — keeping the seeded default`);
		continue;
	}
	await db.update(feeItems).set({ amountCents: n, updatedAt: new Date() }).where(eq(feeItems.key, key));
	console.log(`${key}: ${n} cents (from ${setting})`);
}
process.exit(0);
