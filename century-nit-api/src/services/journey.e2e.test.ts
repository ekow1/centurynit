import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	catalogPrograms,
	catalogUniversities,
	consultations,
	destinations,
	invoices,
	opsUsers,
	servicePackages,
	stageHandoffs,
	users,
} from "../db/schema.js";
import {
	completeConsultationAssessment,
	getApplicantByUserId,
	latestApplicationForApplicant,
	setApplicationPackage,
} from "./cases.js";
import { pendingHandoffForApplication, resolveStageHandoff } from "./handoffs.js";
import { issueProformaByOps, recordPayment, serializeInvoice } from "./invoice.js";
import { journeyForApplicant } from "./journey.js";
import { addSchoolForApplicant, lockSchoolsForApplicant, updateSchoolStatus } from "./schools.js";
import { processConsentDecision } from "../routes/cases.js";

/**
 * The applicant journey, walked end to end through the real services against
 * a real database — the regression test for the flow that broke repeatedly:
 *
 *   consultation → assessment → consent → package → deposit → handler →
 *   schools → proforma → issue → pay → tracking → admission → visa consent
 *
 * After every step it asserts what the portal would show (`portalStage`),
 * because that is what the applicant sees and what support gets called about.
 * `journeyForApplicant` is the same function `/me/journey` and the ops
 * serializer call, so a green run here means both screens agree.
 *
 * It also covers the two structural rules that were the source of most of
 * the bugs: a returning client's second application starts clean, and the
 * deposit — not consent — is what requests a handler.
 */

const SUFFIX = "@journey-e2e.local";
const CLIENT_ID = "journey-e2e-client";
const staff = { manager: "", handler: "" };
const ACTOR = { opsUserId: "", name: "Manager", email: `manager${SUFFIX}` };

const dbAvailable = await (async () => {
	try {
		await db.execute(sql`SELECT 1 FROM applications LIMIT 1`);
		return true;
	} catch {
		console.warn("\n[journey.e2e] Postgres not reachable or migrations not applied — skipping.\n");
		return false;
	}
})();
const maybe = () => (dbAvailable ? it : it.skip);

async function wipe() {
	await db.execute(sql`DELETE FROM invoices WHERE client_user_id = ${CLIENT_ID}`);
	await db.execute(sql`DELETE FROM applicants WHERE user_id = ${CLIENT_ID}`);
	await db.execute(sql`DELETE FROM users WHERE id = ${CLIENT_ID}`);
	await db.execute(sql`DELETE FROM ops_users WHERE email LIKE ${"%" + SUFFIX}`);
	await db.execute(sql`DELETE FROM users WHERE email LIKE ${"%" + SUFFIX}`);
}

async function seed() {
	await db.insert(users).values([
		{ id: CLIENT_ID, email: `client${SUFFIX}`, name: "Ama Mensah", emailVerified: true },
		// Staff are Better Auth users too — the case conversation is keyed on it.
		{ id: "journey-e2e-manager", email: `manager${SUFFIX}`, name: "Manager", emailVerified: true },
		{ id: "journey-e2e-handler", email: `handler${SUFFIX}`, name: "Handler", emailVerified: true },
	]);
	const [manager] = await db
		.insert(opsUsers)
		.values({ userId: "journey-e2e-manager", email: `manager${SUFFIX}`, name: "Manager", role: "manager", branch: "accra" })
		.returning();
	const [handler] = await db
		.insert(opsUsers)
		.values({ userId: "journey-e2e-handler", email: `handler${SUFFIX}`, name: "Handler", role: "consultant", branch: "accra" })
		.returning();
	staff.manager = manager.id;
	staff.handler = handler.id;
	ACTOR.opsUserId = manager.id;

	await db
		.insert(servicePackages)
		.values({ code: "non_scholarship", name: "Non-Scholarship Track", priceCents: 200_000, maxSchools: 3 })
		.onConflictDoNothing();
	await db.insert(destinations).values({ id: "e2e-ca", name: "Canada", region: "North America" }).onConflictDoNothing();
	await db
		.insert(catalogUniversities)
		.values({ id: "e2e-uni", name: "E2E University", destinationId: "e2e-ca" })
		.onConflictDoNothing();
	await db
		.insert(catalogPrograms)
		.values({ id: "e2e-prog", name: "MSc Testing", universityId: "e2e-uni", tuitionUsd: 20_000 })
		.onConflictDoNothing();
}

/** A new consultation in assessment for the client, returning its id. */
async function openConsultation(): Promise<string> {
	const applicant = await getApplicantByUserId(CLIENT_ID);
	const applicantId =
		applicant?.id ??
		(
			await db
				.insert(applicants)
				.values({ userId: CLIENT_ID, name: "Ama Mensah", email: `client${SUFFIX}`, branch: "accra" })
				.returning()
		)[0].id;
	const [row] = await db
		.insert(consultations)
		.values({
			reference: `CNS-E2E-${Date.now().toString(36)}`,
			applicantId,
			branch: "accra",
			status: "IN_ASSESSMENT",
			assignedOfficerId: staff.handler,
		})
		.returning();
	return row.id;
}

async function stage(): Promise<string> {
	const applicant = (await getApplicantByUserId(CLIENT_ID))!;
	const application = await latestApplicationForApplicant(applicant.id);
	return (await journeyForApplicant(applicant, application)).portalStage;
}

async function invoiceOfType(type: string) {
	const rows = await db.select().from(invoices).where(eq(invoices.clientUserId, CLIENT_ID));
	const row = rows.find((i) => i.type === type && i.status !== "void");
	return row ? { row, api: await serializeInvoice(row) } : null;
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

describe("the applicant journey, end to end", () => {
	maybe()("walks from assessment to visa consent, one portal step at a time", async () => {
		const consultationId = await openConsultation();

		// ── Assessment: eligible, with a recommended package ─────────────
		const { application: opened } = await completeConsultationAssessment({
			id: consultationId,
			result: { outcome: "Eligible", notes: "", recCountry: "Canada", recUniversity: "", recProgram: "", recPackage: "non_scholarship" },
			actor: ACTOR,
		});
		expect(opened).not.toBeNull();
		const appId = opened!.id;
		// The recommendation pre-fills the package; that must not skip consent.
		expect(await stage()).toBe("proceed");

		// ── Consent ──────────────────────────────────────────────────────
		await processConsentDecision({ userId: CLIENT_ID, stage: "application", decision: "continue" });
		expect(await stage()).toBe("school_package");
		// Consent alone requests no handler — the deposit does.
		expect(await pendingHandoffForApplication(appId)).toBeNull();

		// ── Package → agency invoice, 10% deposit ─────────────────────────
		await setApplicationPackage({ id: appId, packageCode: "non_scholarship", degreeLevel: "Master's" });
		expect(await stage()).toBe("school_package");
		const agency = (await invoiceOfType("agency"))!;
		expect(agency.row.applicationId).toBe(appId);
		const depositCents = Math.round(agency.api.subtotalCents * 0.1);
		await recordPayment({ invoiceId: agency.row.id, amountCents: depositCents, method: "card", actor: ACTOR });
		expect(await stage()).toBe("awaiting_handler");
		// The paid flags are derived from the ledger by trigger, not written by hand.
		const [afterDeposit] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(afterDeposit.depositPaid).toBe(true);
		expect(afterDeposit.agencyStageIndex).toBe(1);
		expect(afterDeposit.agencySettled).toBe(false);

		// The deposit raised exactly one handoff, sourced from the payment.
		const handoff = await pendingHandoffForApplication(appId);
		expect(handoff?.source).toBe("deposit_payment");
		const [handoffRow] = await db.select().from(stageHandoffs).where(eq(stageHandoffs.applicationId, appId));

		// ── Manager assigns the handler ──────────────────────────────────
		await resolveStageHandoff({ handoffId: handoffRow.id, decision: "assign", opsUserId: staff.handler, actor: ACTOR });
		expect(await stage()).toBe("school_select");
		const [afterHandler] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(afterHandler.stage).toBe("school_submission");
		expect(afterHandler.assignedStaffId).toBe(staff.handler);
		// Ownership is written once and read everywhere: the applicant's point
		// of contact and the handler's document-access scope both follow.
		const [contact] = await db.select({ officer: applicants.assignedOfficerId }).from(applicants).where(eq(applicants.userId, CLIENT_ID));
		expect(contact.officer).toBe(staff.handler);
		const { activeApplicantUserIdsForOfficer } = await import("./caseAssignments.js");
		expect(await activeApplicantUserIdsForOfficer(staff.handler)).toContain(CLIENT_ID);

		// ── Schools: select, lock → proforma ─────────────────────────────
		const applicant = (await getApplicantByUserId(CLIENT_ID))!;
		await addSchoolForApplicant(applicant.id, {
			destinationId: "e2e-ca",
			universityId: "e2e-uni",
			programId: "e2e-prog",
			intake: "Sept 2027",
		});
		expect(await stage()).toBe("school_select");
		await lockSchoolsForApplicant(applicant.id, { id: CLIENT_ID, email: `client${SUFFIX}`, name: "Ama Mensah" });
		expect(await stage()).toBe("awaiting_invoice");
		const proforma = (await invoiceOfType("application"))!;
		expect(proforma.row.status).toBe("proforma");
		expect(proforma.row.applicationId).toBe(appId);

		// ── Handler issues, applicant pays ───────────────────────────────
		await issueProformaByOps({ invoiceId: proforma.row.id, actorName: "Handler" });
		expect(await stage()).toBe("application_invoice");
		const issued = (await invoiceOfType("application"))!;
		await recordPayment({ invoiceId: issued.row.id, amountCents: issued.api.balanceCents, method: "card", actor: ACTOR });
		expect(await stage()).toBe("school_tracking");
		const [afterAppFee] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(afterAppFee.appFeePaid).toBe(true);

		// ── Admission → visa consent ─────────────────────────────────────
		const [school] = (await db.execute<{ id: string }>(sql`SELECT id FROM school_applications WHERE application_id = ${appId}`)).rows;
		await updateSchoolStatus(school.id, { status: "Decision Reached", outcome: "Admitted" }, "Handler");
		expect(await stage()).toBe("school_tracking");
		await processConsentDecision({ userId: CLIENT_ID, stage: "visa", decision: "continue" });
		expect(await stage()).toBe("visa_invoice");

		// Ops and the portal describe the same step.
		const [final] = await db.select().from(applications).where(eq(applications.id, appId));
		const journey = await journeyForApplicant(applicant, final);
		expect(journey.stageStatuses.application_invoice).toBe("done");
		expect(journey.stageStatuses.visa_invoice).toBe("current");
		expect(Object.values(journey.stageStatuses)).not.toContain("skipped");
	});

	maybe()("a returning client's second application starts clean", async () => {
		// The first application is admitted with paid invoices; a new
		// consultation opens a second one. None of that history may count.
		const consultationId = await openConsultation();
		const { application: second } = await completeConsultationAssessment({
			id: consultationId,
			result: { outcome: "Eligible", notes: "", recCountry: "", recUniversity: "", recProgram: "", recPackage: "" },
			actor: ACTOR,
		});
		expect(second).not.toBeNull();

		expect(await stage()).toBe("proceed");
		const applicant = (await getApplicantByUserId(CLIENT_ID))!;
		const journey = await journeyForApplicant(applicant, second!);
		expect(journey.chapterUnlocks.visa).toBe(false);
		expect(journey.stageStatuses.application_invoice).toBe("locked");
	});
});
