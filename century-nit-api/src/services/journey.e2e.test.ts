import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
	applicantDocuments,
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
	assignApplication,
	canAccessApplication,
	getApplicantByUserId,
	latestApplicationForApplicant,
	listApplications,
	serializeApplication,
	setApplicationPackage,
	setApplicationVisaStage,
	updateVisaDetails,
} from "./cases.js";
import {
	completeConsultationAssessment,
} from "./consultations.js";
import { getApplicationActivity } from "./applicationActivity.js";
import { releaseOfficerCases } from "./caseOwnership.js";
import { pendingHandoffForApplication, resolveStageHandoff } from "./handoffs.js";
import { issueProformaByOps, listInvoices, recordPayment, serializeInvoice } from "./invoice.js";
import { journeyForApplicant } from "./journey.js";
import { acceptOffer, addSchoolForApplicant, lockSchoolsForApplicant, removeSchoolByStaff, updateSchoolStatus } from "./schools.js";
import { activeFeeItem } from "./fees.js";
import { resolvePreDepartureTasks, seedPreDepartureTasks, setPreDepartureTask } from "./preDeparture.js";
import { processConsentDecision } from "../routes/me.js";

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
const staff = { manager: "", handler: "", visa: "", finance: "" };
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
	await db.execute(sql`DELETE FROM invoices WHERE client_user_id = ${CLIENT_ID} OR applicant_email = ${"client" + SUFFIX}`);
	await db.execute(sql`DELETE FROM applicant_documents WHERE owner_user_id = ${CLIENT_ID}`);
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
	const [visa] = await db
		.insert(opsUsers)
		.values({ email: `visa${SUFFIX}`, name: "Visa Specialist", role: "consultant", branch: "accra" })
		.returning();
	const [finance] = await db
		.insert(opsUsers)
		.values({ email: `finance${SUFFIX}`, name: "Finance", role: "finance", branch: "accra" })
		.returning();
	staff.manager = manager.id;
	staff.handler = handler.id;
	staff.visa = visa.id;
	staff.finance = finance.id;
	ACTOR.opsUserId = manager.id;

	await db
		.insert(servicePackages)
		.values({ code: "non_scholarship", name: "Non-Scholarship Track", priceCents: 200_000, maxSchools: 3 })
		.onConflictDoNothing();
	// Third-party tariffs on the catalogue: what the client pays through Century, at cost.
	await db.insert(destinations).values({ id: "e2e-ca", name: "Canada", region: "North America", visaFeeCents: 15_000, biometricsFeeCents: 8_500 }).onConflictDoNothing();
	await db.update(destinations).set({ visaFeeCents: 15_000, biometricsFeeCents: 8_500 }).where(eq(destinations.id, "e2e-ca"));
	await db
		.insert(catalogUniversities)
		.values({ id: "e2e-uni", name: "E2E University", destinationId: "e2e-ca", applicationFeeCents: 12_000 })
		.onConflictDoNothing();
	await db.update(catalogUniversities).set({ applicationFeeCents: 12_000 }).where(eq(catalogUniversities.id, "e2e-uni"));
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
		// One line per school: the university's own fee, at cost — no Century charge inside the allowance.
		expect(proforma.api.lines.map((l) => l.schoolApplicationId).filter(Boolean)).toHaveLength(1);
		expect(proforma.row.subtotalCents).toBe(12_000);
		expect(proforma.api.lines[0].label).toContain("application fee");
		// The trail: raised by the client from the portal, not yet approved.
		expect(proforma.api.raisedByName).toContain("client");
		expect(proforma.api.reviewedByName).toBeNull();

		// ── The draft follows the school list ───────────────────────────
		const second = await addSchoolForApplicant(applicant.id, {
			destinationId: "e2e-ca",
			universityId: "e2e-uni",
			programId: "e2e-prog",
			intake: "Jan 2028",
		});
		const grown = (await invoiceOfType("application"))!;
		expect(grown.api.lines).toHaveLength(2);
		expect(grown.api.lines.some((l) => l.schoolApplicationId === second.id)).toBe(true);
		expect(grown.row.subtotalCents).toBe(24_000);
		await removeSchoolByStaff(second.id);
		const shrunk = (await invoiceOfType("application"))!;
		expect(shrunk.api.lines).toHaveLength(1);
		expect(shrunk.row.subtotalCents).toBe(12_000);
		// Beyond the package's allowance (3), Century's extra-school add-on lands on the school added last.
		const extra = (await activeFeeItem("extra_school"))!;
		const added: string[] = [];
		for (const intake of ["May 2028", "Sept 2028", "Jan 2029"]) {
			added.push((await addSchoolForApplicant(applicant.id, { destinationId: "e2e-ca", universityId: "e2e-uni", programId: "e2e-prog", intake })).id);
		}
		const over = (await invoiceOfType("application"))!;
		expect(over.api.lines.filter((l) => l.label === extra.clientLabel)).toHaveLength(1);
		expect(over.api.lines.find((l) => l.label === extra.clientLabel)?.schoolApplicationId).toBe(added[2]);
		expect(over.row.subtotalCents).toBe(4 * 12_000 + extra.amountCents);
		for (const id of added) await removeSchoolByStaff(id);
		expect((await invoiceOfType("application"))!.row.subtotalCents).toBe(12_000);

		// ── Handler issues, applicant pays ───────────────────────────────
		await issueProformaByOps({ invoiceId: proforma.row.id, actorName: "Handler" });
		expect(await stage()).toBe("application_invoice");
		const issued = (await invoiceOfType("application"))!;
		// …approved by the handler; the raiser stays on record.
		expect(issued.api.issuedByName).toBe("Handler");
		expect(issued.api.raisedByName).toContain("client");
		await recordPayment({ invoiceId: issued.row.id, amountCents: issued.api.balanceCents, method: "card", actor: ACTOR });
		expect(await stage()).toBe("school_tracking");
		const [afterAppFee] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(afterAppFee.appFeePaid).toBe(true);

		// ── Admission → visa consent ─────────────────────────────────────
		const [school] = (await db.execute<{ id: string }>(sql`SELECT id FROM school_applications WHERE application_id = ${appId}`)).rows;
		// Submitted schools cannot be removed; the client accepts the admitted one.
		await updateSchoolStatus(school.id, { status: "Submitted", institutionReference: "UNI-2027-001" }, "Handler");
		await expect(removeSchoolByStaff(school.id)).rejects.toMatchObject({ code: "CANNOT_DELETE_ACTIVE_APPLICATION" });
		await expect(acceptOffer(school.id, { name: "Handler", opsUserId: staff.handler })).rejects.toMatchObject({ code: "NOT_ADMITTED" });
		await updateSchoolStatus(school.id, { status: "Decision Reached", outcome: "Admitted" }, "Handler");
		expect(await stage()).toBe("school_tracking");
		const acceptedRow = await acceptOffer(school.id, { name: "Ama Mensah", applicantId: applicant.id });
		expect(acceptedRow.institutionReference).toBe("UNI-2027-001");
		const [afterAccept] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(afterAccept.acceptedSchoolId).toBe(school.id);
		expect(afterAccept.offerAcceptedAt).not.toBeNull();
		// Once issued, the invoice is a record: a later school change leaves it alone.
		const issuedLater = (await invoiceOfType("application"))!;
		expect(issuedLater.api.lines).toHaveLength(1);

		// ── Pre-departure: one list, two owners, proof verified on the Documents tab ──
		expect(await seedPreDepartureTasks(appId)).toBe(true);
		expect(await seedPreDepartureTasks(appId)).toBe(false);
		const appRow = () => db.select().from(applications).where(eq(applications.id, appId)).then((r) => r[0]);
		// The client cannot close Century's items, nor a proof item by ticking.
		await expect(setPreDepartureTask(appId, "pd-briefing", { done: true }, { kind: "client", name: "Ama" })).rejects.toMatchObject({ code: "NOT_YOUR_ITEM" });
		await expect(setPreDepartureTask(appId, "pd-insurance", { done: true }, { kind: "client", name: "Ama" })).rejects.toMatchObject({ code: "PROOF_REQUIRED" });
		await setPreDepartureTask(appId, "pd-orientation", { done: true }, { kind: "client", name: "Ama" });
		let resolved = await resolvePreDepartureTasks(await appRow());
		expect(resolved.find((t) => t.id === "pd-orientation")).toMatchObject({ done: true, doneBy: "client" });
		expect(resolved.find((t) => t.id === "pd-insurance")).toMatchObject({ done: false, proofStatus: "PENDING_UPLOAD" });
		// The upload shows as under review; verification closes the item with the verifier's name.
		const [doc] = await db
			.insert(applicantDocuments)
			.values({ ownerUserId: CLIENT_ID, documentType: "insurance", fileName: "cover.pdf", contentType: "application/pdf", sizeBytes: 100, storageKey: `${CLIENT_ID}/insurance/cover.pdf`, status: "UPLOADED", uploadedAt: new Date() })
			.returning();
		resolved = await resolvePreDepartureTasks(await appRow());
		expect(resolved.find((t) => t.id === "pd-insurance")).toMatchObject({ done: false, proofStatus: "UPLOADED", proofDocumentId: doc.id });
		await db.update(applicantDocuments).set({ status: "VERIFIED", reviewedBy: staff.handler, reviewedAt: new Date() }).where(eq(applicantDocuments.id, doc.id));
		resolved = await resolvePreDepartureTasks(await appRow());
		expect(resolved.find((t) => t.id === "pd-insurance")).toMatchObject({ done: true, proofStatus: "VERIFIED", doneBy: "Handler" });
		// The officer waives a required item with a reason; advice items never gate.
		await setPreDepartureTask(appId, "pd-accommodation", { done: false, waivedReason: "Staying with family — no tenancy" }, { kind: "staff", name: "Handler", opsUserId: staff.handler });
		resolved = await resolvePreDepartureTasks(await appRow());
		expect(resolved.find((t) => t.id === "pd-accommodation")?.waivedReason).toContain("family");
		await processConsentDecision({ userId: CLIENT_ID, stage: "visa", decision: "continue" });
		expect(await stage()).toBe("visa_invoice");

		// Ops and the portal describe the same step.
		const [final] = await db.select().from(applications).where(eq(applications.id, appId));
		const journey = await journeyForApplicant(applicant, final);
		expect(journey.stageStatuses.application_invoice).toBe("done");
		expect(journey.stageStatuses.visa_invoice).toBe("current");
		expect(Object.values(journey.stageStatuses)).not.toContain("skipped");

		// The ops serializer ships the chapter unlocks too, so the console
		// gates its tabs on the same rule the portal gates its chapters on.
		const serialized = await serializeApplication(final);
		expect(serialized.journey?.chapterUnlocks).toEqual(journey.chapterUnlocks);
		expect(serialized.journey?.chapterUnlocks?.visa).toBe(true);
		expect(serialized.journey?.chapterUnlocks?.travel_assistance).toBe(false);
		// The visa document set is asked once the chapter opens (consent given).
		expect(serialized.visaDocumentChecklist.map((d) => d.id)).toContain("admission_letter");

		// ── Visa facts: recorded milestone by milestone, merged, and told ──
		await updateVisaDetails(appId, { visaType: "UK Student visa", reference: "GWF0001", appointmentAt: "2027-01-10T09:00:00.000Z", appointmentCentre: "VFS Accra" }, ACTOR);
		await expect(setApplicationVisaStage(appId, "biometrics", undefined, ACTOR, undefined, { biometricsAt: "2027-01-10T12:00:00.000Z" })).rejects.toMatchObject({
			code: "VISA_ASSIGNMENT_PENDING",
		});
		const [withFacts] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(withFacts.visaDetails).toMatchObject({ visaType: "UK Student visa", reference: "GWF0001", appointmentCentre: "VFS Accra" });
		// `null` clears one fact and leaves the rest.
		await updateVisaDetails(appId, { appointmentCentre: null }, ACTOR);
		const [cleared] = await db.select().from(applications).where(eq(applications.id, appId));
		expect(cleared.visaDetails).toMatchObject({ reference: "GWF0001" });
		expect((cleared.visaDetails as Record<string, unknown>).appointmentCentre).toBeUndefined();

		// The application timeline is assembled from what the walk wrote.
		const events = await getApplicationActivity(appId);
		const types = events.map((e) => e.type);
		expect(types).toContain("invoice_issued");
		expect(types).toContain("payment_recorded");
		expect(types).toContain("school_admitted");
		expect(types).toContain("consent_decided");
		expect(types).toContain("stage_assigned");
		// Newest first.
		for (let i = 1; i < events.length; i++) expect(events[i - 1].at >= events[i].at).toBe(true);

		// Invoices can be listed by the application they belong to.
		const byApp = await listInvoices({ applicationId: appId, limit: 50, offset: 0 });
		expect(byApp.rows.length).toBeGreaterThan(0);
		expect(byApp.rows.every((r) => r.applicationId === appId)).toBe(true);
	});

	maybe()("stage specialists see their case; roles that cannot own a stage are refused; leaving releases work", async () => {
		const applicant = (await getApplicantByUserId(CLIENT_ID))!;
		const app = (await latestApplicationForApplicant(applicant.id))!;
		const asStaff = (opsUserId: string, role: string) =>
			({ opsUserId, role, name: "", email: "", branch: "accra" }) as unknown as Parameters<typeof canAccessApplication>[2];

		// The visa consent raised a visa_processing handoff. Resolve it to a
		// second consultant who is NOT the case owner.
		const pendingVisa = (await db.select().from(stageHandoffs).where(eq(stageHandoffs.applicationId, app.id))).find(
			(h) => h.status === "pending" && h.stage === "visa_processing",
		);
		expect(pendingVisa).toBeTruthy();
		await resolveStageHandoff({ handoffId: pendingVisa!.id, decision: "assign", opsUserId: staff.visa, actor: ACTOR });
		// Assigning the officer raises the visa draft: the destination's tariffs, at cost — nothing of Century's in it.
		const visaDraft = (await invoiceOfType("visa"))!;
		expect(visaDraft.row.status).toBe("proforma");
		expect(visaDraft.api.lines.map((l) => l.amountCents).sort()).toEqual([15_000, 8_500].sort());
		expect(visaDraft.row.subtotalCents).toBe(23_500);

		// Read and write agree: the specialist can open the case, and it is in
		// their list, without being the whole-case owner.
		expect(await canAccessApplication(app.id, "nobody", asStaff(staff.visa, "consultant"))).toBe(true);
		expect((await listApplications(asStaff(staff.visa, "consultant") as never)).map((a) => a.id)).toContain(app.id);
		const [afterVisa] = await db.select().from(applications).where(eq(applications.id, app.id));
		expect(afterVisa.assignedStaffId).toBe(staff.handler);
		// An unrelated consultant still cannot.
		expect(await canAccessApplication(app.id, "nobody", asStaff(staff.finance, "consultant"))).toBe(false);

		// A finance user cannot be made the school handler.
		await expect(assignApplication({ id: app.id, employeeId: staff.finance, actor: ACTOR })).rejects.toMatchObject({
			code: "ROLE_CANNOT_OWN_STAGE",
		});

		// The school handler leaves: the case is released and queued for a
		// manager, the applicant's contact is cleared, history is ended.
		const released = await releaseOfficerCases({ opsUserId: staff.handler, actor: { opsUserId: staff.manager, name: "Manager" } });
		expect(released.applications).toBe(1);
		const [afterRelease] = await db.select().from(applications).where(eq(applications.id, app.id));
		expect(afterRelease.assignedStaffId).toBeNull();
		const handoffs = await db.select().from(stageHandoffs).where(eq(stageHandoffs.applicationId, app.id));
		expect(handoffs.some((h) => h.status === "pending" && h.source === "offboarding")).toBe(true);
		const [contact] = await db.select({ officer: applicants.assignedOfficerId }).from(applicants).where(eq(applicants.id, applicant.id));
		expect(contact.officer).toBeNull();
		// The visa specialist is untouched.
		expect(await canAccessApplication(app.id, "nobody", asStaff(staff.visa, "consultant"))).toBe(true);
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

	maybe()("purging the client keeps their invoices as detached one-off charges", async () => {
		// Invoices outlive the case (the FK only nulls application_id), and a
		// journey-typed invoice must name its application — so the purge has
		// to detach them itself or the cascade is refused by the database.
		const { deleteClientUser } = await import("./clientUsers.js");
		const before = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.clientUserId, CLIENT_ID));
		expect(before.length).toBeGreaterThan(0);

		const result = await deleteClientUser(CLIENT_ID, "purge", "Manager");
		expect(result.success).toBe(true);

		const survivors = await db.select().from(invoices).where(inArray(invoices.id, before.map((i) => i.id)));
		expect(survivors).toHaveLength(before.length);
		for (const inv of survivors) {
			expect(inv.applicationId).toBeNull();
			expect(["custom", "consultation"]).toContain(inv.type);
		}
		expect(await getApplicantByUserId(CLIENT_ID)).toBeNull();
	});
});
