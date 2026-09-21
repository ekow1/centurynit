import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { applicants, applications, consultations, invoiceLines, invoices, opsUsers, servicePackages, users } from "../db/schema.js";
import { setApplicationPackage } from "./cases.js";
import { completeConsultationAssessment } from "./consultations.js";
import { recordPayment } from "./invoice.js";
import { fireDueTrigger } from "./serviceFee.js";
import { processConsentDecision } from "../routes/me.js";

/**
 * Stage-priced plans against a real database: a plan that stops short is
 * paid per stage, a plan with money on it can only grow, and a milestone
 * falls due when its case event fires. The ledger trigger (drizzle/0073)
 * keeps deriving the paid flags from the same lines.
 */

const SUFFIX = "@stage-pricing-e2e.local";
const CLIENT_ID = "stage-pricing-e2e-client";
const ACTOR = { opsUserId: "", name: "Manager", email: `manager${SUFFIX}` };

const dbAvailable = await (async () => {
	try {
		await db.execute(sql`SELECT scope_stages FROM applications LIMIT 1`);
		return true;
	} catch {
		console.warn("\n[stagePricing.e2e] Postgres not reachable or migrations not applied — skipping.\n");
		return false;
	}
})();
const maybe = () => (dbAvailable ? it : it.skip);

async function wipe() {
	await db.execute(sql`DELETE FROM invoices WHERE client_user_id = ${CLIENT_ID} OR applicant_email = ${"client" + SUFFIX}`);
	await db.execute(sql`DELETE FROM applicants WHERE user_id = ${CLIENT_ID}`);
	await db.execute(sql`DELETE FROM users WHERE id = ${CLIENT_ID}`);
	await db.execute(sql`DELETE FROM ops_users WHERE email LIKE ${"%" + SUFFIX}`);
	await db.execute(sql`DELETE FROM users WHERE email LIKE ${"%" + SUFFIX}`);
}

/** The e2e package, priced so the bundle undercuts the stages: 700 + 700 + 300 = 1,700 vs 1,500. */
const PRICES = { admissions: 70_000, visa: 70_000, departure: 30_000 };

async function seed() {
	await db.insert(users).values([
		{ id: CLIENT_ID, email: `client${SUFFIX}`, name: "Kwame Mensah", emailVerified: true },
		{ id: "stage-pricing-e2e-manager", email: `manager${SUFFIX}`, name: "Manager", emailVerified: true },
	]);
	const [manager] = await db
		.insert(opsUsers)
		.values({ userId: "stage-pricing-e2e-manager", email: `manager${SUFFIX}`, name: "Manager", role: "manager", branch: "accra" })
		.returning();
	ACTOR.opsUserId = manager.id;
	await db
		.insert(servicePackages)
		.values({ code: "non_scholarship", name: "Non-Scholarship Track", priceCents: 150_000, stagePrices: PRICES, maxSchools: 3 })
		.onConflictDoUpdate({ target: servicePackages.code, set: { priceCents: 150_000, stagePrices: PRICES, active: true } });
}

/** A consented, eligible application ready for a plan. */
async function openCase(): Promise<string> {
	const [applicant] = await db
		.insert(applicants)
		.values({ userId: CLIENT_ID, name: "Kwame Mensah", email: `client${SUFFIX}`, branch: "accra" })
		.returning();
	const [row] = await db
		.insert(consultations)
		.values({ reference: `CNS-SP-${Date.now().toString(36)}`, applicantId: applicant.id, branch: "accra", status: "IN_ASSESSMENT" })
		.returning();
	const { application } = await completeConsultationAssessment({
		id: row.id,
		result: { outcome: "Eligible", notes: "", recCountry: "", recUniversity: "", recProgram: "", recPackage: "non_scholarship", recStages: ["admissions"] },
		actor: ACTOR,
	});
	await processConsentDecision({ userId: CLIENT_ID, stage: "application", decision: "continue" });
	return application!.id;
}

async function agencyInvoice(appId: string) {
	const [row] = await db
		.select()
		.from(invoices)
		.where(sql`${invoices.applicationId} = ${appId} AND ${invoices.type} = 'agency' AND ${invoices.status} <> 'void'`)
		.orderBy(sql`${invoices.createdAt} DESC`)
		.limit(1);
	const lines = row ? await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, row.id)).orderBy(asc(invoiceLines.position)) : [];
	return { row, lines };
}

beforeAll(async () => {
	if (!dbAvailable) return;
	await wipe();
	await seed();
});

afterAll(async () => {
	if (!dbAvailable) return;
	await wipe();
});

describe("stage-priced plans", () => {
	maybe()("prices an admissions-only plan per stage, grows it once money is on it, and dates lines from case events", async () => {
		const appId = await openCase();

		// ── Admissions only: two lines, half due now ─────────────────────
		await setApplicationPackage({ id: appId, packageCode: "non_scholarship", degreeLevel: "Master's", stages: ["admissions"] });
		let { row, lines } = await agencyInvoice(appId);
		expect(row.subtotalCents).toBe(PRICES.admissions);
		expect(row.note).toContain("Admissions only");
		expect(lines.map((l) => [l.amountCents, l.dueOn, l.dueAt != null])).toEqual([
			[35_000, "acceptance", true],
			[35_000, "offer", false],
		]);
		// The invoice falls due with its first dated line.
		expect(row.dueAt).not.toBeNull();
		const [app1] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(app1.scopeStages).toEqual(["admissions"]);

		// ── Re-choosing while unpaid voids and re-raises (the full journey at the bundle) ──
		await setApplicationPackage({ id: appId, packageCode: "non_scholarship", degreeLevel: "Master's" });
		({ row, lines } = await agencyInvoice(appId));
		expect(row.subtotalCents).toBe(150_000);
		expect(lines.map((l) => l.dueOn)).toEqual(["acceptance", "visa_approved", "arrival"]);
		const voided = await db.select().from(invoices).where(sql`${invoices.applicationId} = ${appId} AND ${invoices.status} = 'void'`);
		expect(voided).toHaveLength(1);

		// ── Back to admissions only (still unpaid), then pay the first half ──
		await setApplicationPackage({ id: appId, packageCode: "non_scholarship", degreeLevel: "Master's", stages: ["admissions"] });
		({ row, lines } = await agencyInvoice(appId));
		await recordPayment({ invoiceId: row.id, amountCents: 35_000, method: "card", actor: ACTOR });
		const [afterPay] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(afterPay.depositPaid).toBe(true);
		// The paid line no longer dates the invoice; the offer line has not fired.
		const [paidRow] = await db.select().from(invoices).where(eq(invoices.id, row.id));
		expect(paidRow.dueAt).toBeNull();

		// ── Money on the ledger: the track cannot change, stages cannot come off ──
		await expect(setApplicationPackage({ id: appId, packageCode: "non_scholarship", degreeLevel: "Master's", stages: ["admissions"], targetSchoolCount: 4 })).resolves.toBeTruthy();
		const same = await agencyInvoice(appId);
		expect(same.row.id).toBe(row.id);
		expect(same.lines).toHaveLength(2);

		// ── The offer lands: the second admissions line falls due ────────
		await fireDueTrigger(appId, "offer");
		({ row, lines } = await agencyInvoice(appId));
		expect(lines[1].dueAt).not.toBeNull();
		expect(row.dueAt).not.toBeNull();

		// ── Upgrade: Visa + Departure appended, bundle price honoured, nothing voided ──
		const before = row.id;
		await setApplicationPackage({
			id: appId,
			packageCode: "non_scholarship",
			degreeLevel: "Master's",
			stages: ["admissions", "visa", "departure"],
			actor: { name: "Manager", opsUserId: ACTOR.opsUserId, reason: "agreed by phone" },
		});
		({ row, lines } = await agencyInvoice(appId));
		expect(row.id).toBe(before);
		expect(row.subtotalCents).toBe(150_000);
		expect(lines.map((l) => [l.position, l.amountCents, l.dueOn])).toEqual([
			[0, 35_000, "acceptance"],
			[1, 35_000, "offer"],
			[2, 70_000, "visa_open"],
			[3, 10_000, "visa_approved"],
		]);
		expect(lines[3].detail).toContain("bundle discount");
		const [afterUpgrade] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(afterUpgrade.scopeStages).toEqual(["admissions", "visa", "departure"]);
		// The ledger trigger still reads the lines in order: one of four covered.
		expect(afterUpgrade.agencyStageIndex).toBe(1);
		expect(afterUpgrade.agencySettled).toBe(false);
		// Two re-selections happened while unpaid (one void each); the upgrade added none.
		const stillVoid = await db.select().from(invoices).where(sql`${invoices.applicationId} = ${appId} AND ${invoices.status} = 'void'`);
		expect(stillVoid).toHaveLength(2);

		// ── Removing a paid-for stage is refused ─────────────────────────
		await expect(
			setApplicationPackage({ id: appId, packageCode: "non_scholarship", degreeLevel: "Master's", stages: ["admissions", "visa"] }),
		).rejects.toMatchObject({ code: "PACKAGE_LOCKED" });
	});
});
