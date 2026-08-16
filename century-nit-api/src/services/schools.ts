import { and, desc, eq } from "drizzle-orm";
import type {
	AddSchoolApplication,
	SchoolApplication,
	SchoolApplicationList,
	UpdateSchoolStatus,
} from "century-nit-shared";

import { db } from "../db/index.js";
import {
	applicants,
	applications,
	schoolApplications,
	schoolTrackEvents,
} from "../db/schema.js";
import { createInvoice } from "./invoice.js";
import { HttpError } from "../middleware/error.js";

const APP_INVOICE_BASE_CENTS = 35000; // $350.00
const APP_INVOICE_PER_SCHOOL_CENTS = 10000; // $100.00 per school

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

	// Auto-raise Stage II Invoice if not already raised
	const [applicantRow] = await db
		.select()
		.from(applicants)

		.where(eq(applicants.id, applicantId))
		.limit(1);

	const invoice = await createInvoice({
		data: {
			applicantName: applicantRow?.name ?? user.name ?? "Applicant",
			applicantEmail: applicantRow?.email ?? user.email,
			clientUserId: user.id,
			type: "application",
			lines: [
				{
					label: "Stage II — University Application Processing Base Fee",
					detail: `Document verification, portal account creation, credential review`,
					amountCents: APP_INVOICE_BASE_CENTS,
				},
				{
					label: `University Application Fee (${rows.length} Institution${rows.length > 1 ? "s" : ""})`,
					detail: `$100 per selected university application track`,
					amountCents: rows.length * APP_INVOICE_PER_SCHOOL_CENTS,
				},
			],
			note: `Stage II Application Fee for ${rows.length} locked school applications.`,
		},
		actor: {
			opsUserId: "00000000-0000-0000-0000-000000000000",
			name: "System Automation",
			email: "system@centurynit.com",
		},
	});

	if (app) {
		await db
			.update(applications)
			.set({
				stage: "School Applications Locked",
				updatedAt: new Date(),
			})
			.where(eq(applications.id, app.id));
	}

	const updated = await listSchoolsForApplicant(applicantId);
	return {
		...updated,
		selectionDoneAt: new Date().toISOString(),
		invoiceId: invoice.id,
	};
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
