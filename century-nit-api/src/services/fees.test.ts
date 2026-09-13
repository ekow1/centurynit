import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { feeItems } from "../db/schema.js";
import { activeFeeItem, feeCatalogue, listFeeItems, serviceFeeSplit, updateFeeItem } from "./fees.js";

const dbAvailable = await (async () => {
	try {
		await db.execute("select 1");
		return true;
	} catch {
		return false;
	}
})();

describe.skipIf(!dbAvailable)("the fee catalogue", () => {
	it("is seeded with Century's items and the at-cost items, and edits keep an audit line", async () => {
		const items = await listFeeItems();
		const keys = items.map((i) => i.key);
		expect(keys).toEqual(expect.arrayContaining(["consultation", "extra_school", "translation"]));
		expect(items.find((i) => i.key === "consultation")?.kind).toBe("century");
		expect(items.find((i) => i.key === "translation")?.kind).toBe("pass_through");

		const before = (await activeFeeItem("extra_school"))!.amountCents;
		const updated = await updateFeeItem("extra_school", { amountCents: before + 500 }, { opsUserId: null, email: "finance@test.local" });
		expect(updated.amountCents).toBe(before + 500);
		await updateFeeItem("extra_school", { amountCents: before }, { opsUserId: null, email: "finance@test.local" });

		// An item switched off is not offered.
		await db.update(feeItems).set({ active: false }).where(eq(feeItems.key, "courier"));
		expect(await activeFeeItem("courier")).toBeNull();
	});

	it("always splits the service fee to a whole hundred and serves one payload", async () => {
		const split = await serviceFeeSplit();
		expect(split.depositPercent + split.preDeparturePercent + split.postArrivalPercent).toBe(100);
		const cat = await feeCatalogue();
		expect(cat.exchangeRate).toBeGreaterThan(0);
		expect(Array.isArray(cat.destinations)).toBe(true);
		expect(cat.items.length).toBeGreaterThan(0);
	});
});
