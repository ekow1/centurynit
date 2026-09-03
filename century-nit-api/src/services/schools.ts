import { and, desc, eq } from "drizzle-orm";
import type {
	AddSchoolApplication,
	SchoolApplication,
	SchoolApplicationList,
	UpdateSchoolStatus,
	AssignScholarship,
	StudentScholarship,
} from "century-nit-shared";

import { db } from "../db/index.js";
import {
	applicants,
	applications,
	invoiceLines,
	invoices,
	schoolApplications,
	schoolTrackEvents,
	studentScholarships,
	catalogScholarships,
} from "../db/schema.js";
import { createProforma, getFeeSchedule } from "./invoice.js";
import { HttpError } from "../middleware/error.js";

export async function lockSchoolsForApplicant(
	applicantId: string,
	user: { id: string; email: string; name?: string | null },
): Promise<SchoolApplicationList> {
	const rows = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.applicantId, applicantId));

	if (rows.length === 0) {
		throw new HttpError(400, "NO_SCHOOLS_SELECTED", "Please select at least one university/program before locking.");
	}

	const [app] = await db
		.select()
		.from(applications)
		.where(eq(applications.applicantId, applicantId))
		.orderBy(desc(applications.createdAt))
		.limit(1);

	// Update all draft schools to "Preparing Application"
	for (const row of rows) {
		if (row.status === "Draft") {
			await db
				.update(schoolApplications)
				.set({ status: "Preparing Application", updatedAt: new Date() })
				.where(eq(schoolApplications.id, row.id));

			await db.insert(schoolTrackEvents).values({
				schoolApplicationId: row.id,
				status: "Preparing Application",
				note: "Selection locked by applicant. Moving to preparation.",
			});
		}
	}

	// Read configurable fees from platform_settings
	const fees = await getFeeSchedule();

	// Find applicant details
	const [applicantRow] = await db
		.select()
		.from(applicants)
		.where(eq(applicants.id, applicantId))
		.limit(1);

	// Check if an application invoice already exists for this client to prevent duplicate invoices on re-lock
	const existingInvoices = await db
		.select()
		.from(invoices)
		.where(and(eq(invoices.clientUserId, user.id), eq(invoices.type, "application")))
		.orderBy(desc(invoices.createdAt));

	const activeInvoice = existingInvoices.find((i) => i.status !== "void");
	let invoiceId: string;

	if (activeInvoice) {
		invoiceId = activeInvoice.id;
		// If it is still a proforma, update lines to reflect current selected schools count & current pricing
		if (activeInvoice.status === "proforma") {
			const subtotalCents =
				fees.appBaseCents + rows.length * fees.appPerSchoolCents + fees.appDocVerifyCents;
			await db.transaction(async (tx) => {
				await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, activeInvoice.id));
				await tx.insert(invoiceLines).values([
					{
						invoiceId: activeInvoice.id,
						position: 0,
						label: "Application Processing Base Fee",
						detail: "Document verification, portal account creation, credential review",
						amountCents: fees.appBaseCents,
					},
					{
						invoiceId: activeInvoice.id,
						position: 1,
						label: `University Application Fee (${rows.length} Institution${rows.length > 1 ? "s" : ""})`,
						detail: `Per-institution submission & liaison fee`,
						amountCents: rows.length * fees.appPerSchoolCents,
					},
					{
						invoiceId: activeInvoice.id,
						position: 2,
						label: "Document Verification & Courier",
						detail: "Transcripts and certificates verified and shipped",
						amountCents: fees.appDocVerifyCents,
					},
				]);
				await tx
					.update(invoices)
					.set({
						subtotalCents,
						note: `Proforma estimate for ${rows.length} school application(s). Your consultant will review and confirm the final amount.`,
						updatedAt: new Date(),
					})
					.where(eq(invoices.id, activeInvoice.id));
			});
		}
	} else {
		// Create a new PROFORMA estimate — not payable until a staff member reviews and issues it
		const proforma = await createProforma({
			data: {
				applicantName: applicantRow?.name ?? user.name ?? "Applicant",
				applicantEmail: applicantRow?.email ?? user.email,
				clientUserId: user.id,
				type: "application",
				lines: [
					{
						label: "Application Processing Base Fee",
						detail: "Document verification, portal account creation, credential review",
						amountCents: fees.appBaseCents,
					},
					{
						label: `University Application Fee (${rows.length} Institution${rows.length > 1 ? "s" : ""})`,
						detail: `Per-institution submission & liaison fee`,
						amountCents: rows.length * fees.appPerSchoolCents,
					},
					{
						label: "Document Verification & Courier",
						detail: "Transcripts and certificates verified and shipped",
						amountCents: fees.appDocVerifyCents,
					},
				],
				note: `Proforma estimate for ${rows.length} school application(s). Your consultant will review and confirm the final amount.`,
			},
		});
		invoiceId = proforma.id;
	}

	if (app) {
		await db
			.update(applications)
			.set({
				stage: "offer_letter_review",
				updatedAt: new Date(),
			})
			.where(eq(applications.id, app.id));
	}

	const updated = await listSchoolsForApplicant(applicantId);
	return {
		...updated,
		selectionDoneAt: new Date().toISOString(),
		invoiceId,
	};
}


export async function serializeSchool(
	row: typeof schoolApplications.$inferSelect,
): Promise<SchoolApplication> {
	const events = await db
		.select()
		.from(schoolTrackEvents)
		.where(eq(schoolTrackEvents.schoolApplicationId, row.id))
		.orderBy(desc(schoolTrackEvents.at));

	return {
		id: row.id,
		applicantId: row.applicantId,
		applicationId: row.applicationId,
		destinationId: row.destinationId,
		universityId: row.universityId,
		programId: row.programId,
		intake: row.intake,
		status: row.status,
		handlerNote: row.handlerNote,
		financialNote: row.financialNote,
		events: events.map((e) => ({
			id: e.id,
			at: e.at.toISOString(),
			status: e.status,
			note: e.note,
			financialNote: e.financialNote ?? undefined,
		})),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export async function listSchoolsForApplicant(applicantId: string): Promise<SchoolApplicationList> {
	const rows = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.applicantId, applicantId))
		.orderBy(schoolApplications.createdAt);

	const schools = await Promise.all(rows.map(serializeSchool));
	return {
		schools,
		total: schools.length,
	};
}

export async function addSchoolForApplicant(
	applicantId: string,
	input: AddSchoolApplication,
): Promise<SchoolApplication> {
	// Find active application
	const [app] = await db
		.select()
		.from(applications)
		.where(eq(applications.applicantId, applicantId))
		.orderBy(desc(applications.createdAt))
		.limit(1);

	const [created] = await db
		.insert(schoolApplications)
		.values({
			applicantId,
			applicationId: app?.id ?? null,
			destinationId: input.destinationId,
			universityId: input.universityId,
			programId: input.programId,
			intake: input.intake,
			status: "Draft",
		})
		.returning();

	// Insert initial event
	await db.insert(schoolTrackEvents).values({
		schoolApplicationId: created.id,
		status: "Draft",
		note: "School selection added to draft profile",
	});

	return serializeSchool(created);
}

export async function removeSchoolForApplicant(
	applicantId: string,
	schoolId: string,
): Promise<void> {
	const [target] = await db
		.select()
		.from(schoolApplications)
		.where(and(eq(schoolApplications.id, schoolId), eq(schoolApplications.applicantId, applicantId)))
		.limit(1);

	if (!target) {
		throw new HttpError(404, "SCHOOL_NOT_FOUND", "School application not found");
	}

	if (target.status !== "Draft") {
		throw new HttpError(
			400,
			"CANNOT_DELETE_ACTIVE_APPLICATION",
			"Only draft school applications can be removed",
		);
	}

	await db.delete(schoolApplications).where(eq(schoolApplications.id, schoolId));
}

export async function updateSchoolStatus(
	schoolId: string,
	input: UpdateSchoolStatus,
	actorName: string,
): Promise<SchoolApplication> {
	const [target] = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.id, schoolId))
		.limit(1);

	if (!target) {
		throw new HttpError(404, "SCHOOL_NOT_FOUND", "School application not found");
	}

	const [updated] = await db
		.update(schoolApplications)
		.set({
			status: input.status,
			handlerNote: input.handlerNote ?? target.handlerNote,
			financialNote: input.financialNote ?? target.financialNote,
			updatedAt: new Date(),
		})
		.where(eq(schoolApplications.id, schoolId))
		.returning();

	await db.insert(schoolTrackEvents).values({
		schoolApplicationId: schoolId,
		status: input.status,
		note: input.note || input.handlerNote || `Status updated to ${input.status} by ${actorName}`,
		financialNote: input.financialNote,
	});

	return serializeSchool(updated);
}

export async function listScholarshipsForApplicant(applicantId: string): Promise<StudentScholarship[]> {
	const rows = await db
		.select()
		.from(studentScholarships)
		.where(eq(studentScholarships.applicantId, applicantId));
	return rows.map((r) => ({
		id: r.id,
		applicantId: r.applicantId,
		scholarshipId: r.scholarshipId,
		awardedAt: r.awardedAt!.toISOString(),
		notes: r.notes,
	}));
}

export async function assignScholarshipForApplicant(
	applicantId: string,
	data: AssignScholarship,
): Promise<StudentScholarship> {
	// Verify scholarship exists
	const [scholarship] = await db
		.select()
		.from(catalogScholarships)
		.where(eq(catalogScholarships.id, data.scholarshipId));
	if (!scholarship) {
		throw new HttpError(404, "SCHOLARSHIP_NOT_FOUND", "Scholarship not found in catalog");
	}

	const [created] = await db
		.insert(studentScholarships)
		.values({
			applicantId,
			scholarshipId: data.scholarshipId,
			notes: data.notes,
		})
		.returning();

	return {
		id: created.id,
		applicantId: created.applicantId,
		scholarshipId: created.scholarshipId,
		awardedAt: created.awardedAt!.toISOString(),
		notes: created.notes,
	};
}

export async function removeScholarshipForApplicant(applicantId: string, scholarshipId: string): Promise<void> {
	await db
		.delete(studentScholarships)
		.where(
			and(
				eq(studentScholarships.applicantId, applicantId),
				eq(studentScholarships.scholarshipId, scholarshipId)
			)
		);
}