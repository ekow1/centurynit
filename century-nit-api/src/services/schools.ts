import { and, desc, eq, isNull, not, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
	AddSchoolApplication,
	SchoolApplication,
	SchoolApplicationList,
	UpdateSchoolStatus,
	AssignScholarship,
	StudentScholarship,
} from "century-nit-shared";

import { schoolDecisionNote } from "century-nit-shared";

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
	catalogUniversities,
	catalogPrograms,
	destinations,
} from "../db/schema.js";
import { createProforma, getFeeSchedule } from "./invoice.js";
import { HttpError } from "../middleware/error.js";
import { sendEmail } from "../lib/resend.js";
import { renderSchoolOfferEmail } from "../lib/email-templates.js";
import { formatUsd } from "./receiptEmail.js";
import { getDocumentStorage } from "./storage/index.js";
import { activeHandlerFor } from "./handoffs.js";

/**
 * The applicant's current application — the newest row. Every school and
 * invoice read in the journey is scoped to this application, never to the
 * applicant, so a returning client's earlier application cannot leak its
 * school tracks or paid invoices into the new one.
 */
export async function currentApplicationForApplicant(applicantId: string) {
	const [app] = await db
		.select()
		.from(applications)
		.where(eq(applications.applicantId, applicantId))
		.orderBy(desc(applications.createdAt))
		.limit(1);
	return app ?? null;
}

export async function lockSchoolsForApplicant(
	applicantId: string,
	user: { id: string; email: string; name?: string | null },
): Promise<SchoolApplicationList> {
	const app = await currentApplicationForApplicant(applicantId);
	if (!app) {
		throw new HttpError(409, "APPLICATION_NOT_FOUND", "There is no open application to lock schools for.");
	}

	const rows = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.applicationId, app.id));

	if (rows.length === 0) {
		throw new HttpError(400, "NO_SCHOOLS_SELECTED", "Please select at least one university/program before locking.");
	}

	// Handler-assignment gate: the applicant cannot lock school selection
	// until ops has explicitly assigned a handler for the school application
	// stage. assignedStaffId is the authoritative whole-case owner.
	if (!app.assignedStaffId) {
		const handler = await activeHandlerFor(app.id, "school_submission");
		if (!handler) {
			throw new HttpError(
				409,
				"HANDLER_NOT_ASSIGNED",
				"A handler must be assigned to your case before you can lock school selection. Please wait for your handler to be assigned.",
			);
		}
	}

	// Update all draft schools to "Preparing Application"
	for (const row of rows) {
		if (row.status === "Preparing Application") {
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

	// Reuse this application's live application invoice on re-lock rather than
	// raising a duplicate. Only an invoice already linked to THIS application
	// qualifies, or a legacy one with no link at all (raised before invoices
	// carried application_id) — never one that belongs to another application,
	// because relinking a paid invoice from an earlier application would make
	// the new one look paid.
	const existingInvoices = await db
		.select()
		.from(invoices)
		.where(
			and(
				eq(invoices.type, "application"),
				not(eq(invoices.status, "void")),
				or(eq(invoices.applicationId, app.id), and(isNull(invoices.applicationId), eq(invoices.clientUserId, user.id))),
			),
		)
		.orderBy(desc(invoices.createdAt));

	const activeInvoice =
		existingInvoices.find((i) => i.applicationId === app.id) ??
		existingInvoices.find((i) => i.status !== "paid");
	let invoiceId: string;

	if (activeInvoice) {
		invoiceId = activeInvoice.id;
		// Adopt a legacy unlinked invoice so it is scoped from here on.
		if (!activeInvoice.applicationId) {
			await db
				.update(invoices)
				.set({ applicationId: app.id, updatedAt: new Date() })
				.where(eq(invoices.id, activeInvoice.id));
		}
		// If it is still a proforma, update lines to reflect current selected schools count & direct university fees
		if (activeInvoice.status === "proforma") {
			const subtotalCents = rows.length * fees.appPerSchoolCents;
			const schoolLines = rows.map((r, idx) => ({
				invoiceId: activeInvoice.id,
				position: idx,
				label: `${r.universityName || "University"} - ${r.programName || "Programme"} Application Fee`,
				detail: `Direct institutional submission & processing (${r.intake})`,
				amountCents: fees.appPerSchoolCents,
			}));

			await db.transaction(async (tx) => {
				await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, activeInvoice.id));
				await tx.insert(invoiceLines).values(
					schoolLines.length > 0
						? schoolLines
						: [
								{
									invoiceId: activeInvoice.id,
									position: 0,
									label: "University Application Fee",
									detail: "Per-institution submission fee",
									amountCents: fees.appPerSchoolCents,
								},
							],
				);
				await tx
					.update(invoices)
					.set({
						subtotalCents,
						note: `Proforma estimate for ${rows.length} university application(s). Consultant will confirm exact institutional fees.`,
						updatedAt: new Date(),
					})
					.where(eq(invoices.id, activeInvoice.id));
			});
		}
	} else {
		// Create a new PROFORMA estimate — consultant reviews & issues exact university fees
		const schoolLines = rows.map((r) => ({
			label: `${r.universityName || "University"} - ${r.programName || "Programme"} Application Fee`,
			detail: `Direct institutional submission & processing (${r.intake})`,
			amountCents: fees.appPerSchoolCents,
		}));

		const proforma = await createProforma({
			data: {
				applicantName: applicantRow?.name ?? user.name ?? "Applicant",
				applicantEmail: applicantRow?.email ?? user.email,
				clientUserId: user.id,
				applicationId: app.id,
				type: "application",
				status: "proforma",
				lines:
					schoolLines.length > 0
						? schoolLines
						: [
								{
									label: "University Application Fee",
									detail: "Per-institution submission fee",
									amountCents: fees.appPerSchoolCents,
								},
							],
				note: `Proforma estimate for ${rows.length} university application(s). Consultant will confirm exact institutional fees.`,
			},
		});
		invoiceId = proforma.id;
	}

	// Entering school_submission is gated on the 10% deposit elsewhere
	// (see setApplicationStage). Only mirror that advance when the deposit is
	// actually paid, so an applicant can add schools without their case being
	// pushed past the deposit gate on a technicality.
	if (app.stage === "document_verification" && app.depositPaid) {
		// Just in case it hasn't advanced to school_submission automatically yet
		await db
			.update(applications)
			.set({
				stage: "school_submission",
				updatedAt: new Date(),
			})
			.where(eq(applications.id, app.id));
	}

	const updated = await listSchoolsForApplication(app.id);
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
		universityName: row.universityName,
		programName: row.programName,
		countryName: row.countryName,
		tuitionUsd: row.tuitionUsd,
		intake: row.intake,
		status: row.status,
		outcome: row.outcome ?? undefined,
		handlerNote: row.handlerNote,
		financialNote: row.financialNote,
		events: events.map((e) => ({
			id: e.id,
			at: e.at.toISOString(),
			status: e.status,
			outcome: e.outcome ?? undefined,
			note: e.note,
			financialNote: e.financialNote ?? undefined,
		})),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		offerTuitionUsd: row.offerTuitionUsd,
		offerTuitionLabel: row.offerTuitionLabel,
		offerDepositUsd: row.offerDepositUsd,
		offerDepositDueAt: row.offerDepositDueAt?.toISOString() ?? null,
		offerDepositPaidAt: row.offerDepositPaidAt?.toISOString() ?? null,
		offerLetterStorageKey: row.offerLetterUrl ?? null,
		offerLetterUrl: row.offerLetterUrl ?? null,
	};
}

/** School tracks of one application. This is the journey's read. */
export async function listSchoolsForApplication(applicationId: string): Promise<SchoolApplicationList> {
	const rows = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.applicationId, applicationId))
		.orderBy(schoolApplications.createdAt);

	const schools = await Promise.all(rows.map(serializeSchool));
	return {
		schools,
		total: schools.length,
	};
}

/**
 * School tracks of the applicant's *current* application. An applicant with
 * no application has no school tracks — earlier applications' tracks are
 * history, not the live selection.
 */
export async function listSchoolsForApplicant(applicantId: string): Promise<SchoolApplicationList> {
	const app = await currentApplicationForApplicant(applicantId);
	if (!app) return { schools: [], total: 0 };
	return listSchoolsForApplication(app.id);
}

export async function addSchoolForApplicant(
	applicantId: string,
	input: AddSchoolApplication,
): Promise<SchoolApplication> {
	// Schools always belong to an application; without one there is nothing
	// to select for and the row would be unscoped forever.
	const app = await currentApplicationForApplicant(applicantId);
	if (!app) {
		throw new HttpError(409, "APPLICATION_NOT_FOUND", "Schools can only be selected once an application is open.");
	}

	// Freeze snapshots of the catalog rows so the applicant's choice survives
	// later catalog edits/deletions and keeps the quotation stable.
	const [university] = await db
		.select()
		.from(catalogUniversities)
		.where(eq(catalogUniversities.id, input.universityId))
		.limit(1);
	const [program] = await db
		.select()
		.from(catalogPrograms)
		.where(eq(catalogPrograms.id, input.programId))
		.limit(1);
	const [destination] = input.destinationId
		? await db
				.select()
				.from(destinations)
				.where(eq(destinations.id, input.destinationId))
				.limit(1)
		: [];

	const [created] = await db
		.insert(schoolApplications)
		.values({
			applicantId,
			applicationId: app.id,
			destinationId: input.destinationId,
			universityId: input.universityId,
			programId: input.programId,
			universityName: university?.name ?? null,
			programName: program?.name ?? null,
			countryName: destination?.name ?? university?.name ?? null,
			tuitionUsd: program?.tuitionUsd ?? null,
			intake: input.intake,
			status: "Preparing Application",
		})
		.returning();

	// Insert initial event
	await db.insert(schoolTrackEvents).values({
		schoolApplicationId: created.id,
		status: "Preparing Application",
		note: "School selection added to profile",
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

	if (target.status !== "Preparing Application") {
		throw new HttpError(
			400,
			"CANNOT_DELETE_ACTIVE_APPLICATION",
			"Only preparing school applications can be removed",
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

	// Application fee gate: the handler cannot begin actual school application
	// processing (status updates, submissions, decisions) until the applicant
	// has paid the application fee. This is the hard boundary between school
	// selection and actual school application processing.
	const parentCondition = target.applicationId
		? eq(applications.id, target.applicationId)
		: eq(applications.applicantId, target.applicantId);
	const [parentApp] = await db
		.select({ appFeePaid: applications.appFeePaid })
		.from(applications)
		.where(parentCondition)
		.orderBy(desc(applications.createdAt))
		.limit(1);
	if (parentApp && !parentApp.appFeePaid) {
		throw new HttpError(
			409,
			"APP_FEE_NOT_PAID",
			"The application fee must be paid before school application processing can begin.",
		);
	}

	const clearNote =
		input.handlerNote === null || (typeof input.handlerNote === "string" && input.handlerNote.trim() === "");
	const providedNote = [input.handlerNote, input.consultantNote, input.note]
		.map((n) => n?.trim())
		.find(Boolean);
	const fallbackNote =
		input.status === "Decision Reached"
			? schoolDecisionNote({
					outcome: input.outcome,
					universityName: target.universityName,
					programName: target.programName,
				})
			: null;
	const nextHandlerNote = clearNote ? null : providedNote || target.handlerNote;
	const nextOfferLetterUrl =
		input.offerLetterUrl !== undefined
			? input.offerLetterUrl
			: input.offerLetterStorageKey !== undefined
				? input.offerLetterStorageKey
				: target.offerLetterUrl;

	const [updated] = await db
		.update(schoolApplications)
		.set({
			status: input.status,
			outcome: input.outcome,
			handlerNote: nextHandlerNote,
			financialNote: input.financialNote ?? target.financialNote,
			offerTuitionUsd: input.offerTuitionUsd !== undefined ? input.offerTuitionUsd : target.offerTuitionUsd,
			offerTuitionLabel: input.offerTuitionLabel !== undefined ? input.offerTuitionLabel : target.offerTuitionLabel,
			offerDepositUsd: input.offerDepositUsd !== undefined ? input.offerDepositUsd : target.offerDepositUsd,
			offerDepositDueAt:
				input.offerDepositDueAt !== undefined
					? input.offerDepositDueAt
						? new Date(input.offerDepositDueAt)
						: null
					: target.offerDepositDueAt,
			offerDepositPaidAt:
				input.offerDepositPaidAt !== undefined
					? input.offerDepositPaidAt
						? new Date(input.offerDepositPaidAt)
						: null
					: target.offerDepositPaidAt,
			offerLetterUrl: nextOfferLetterUrl,
			updatedAt: new Date(),
		})
		.where(eq(schoolApplications.id, schoolId))
		.returning();

	await db.insert(schoolTrackEvents).values({
		schoolApplicationId: schoolId,
		status: input.status,
		outcome: input.outcome,
		note: providedNote || fallbackNote || `Status updated to ${input.status} by ${actorName}`,
		financialNote: input.financialNote,
	});

	if (input.sendUpdateEmail) {
		try {
			const [appRow] = await db
				.select()
				.from(applicants)
				.where(eq(applicants.id, target.applicantId))
				.limit(1);
			if (appRow?.email) {
				const frontendUrl = process.env.APP_URL || "https://centurynit.com";
				
				let subject = `Application Update: ${target.universityName || "University"}`;
				if (input.outcome === "Admitted") {
					subject = `🎉 Admission Offer: ${target.universityName || "University"} has accepted your application!`;
				} else if (input.outcome === "Application Rejected") {
					subject = `Application Update: Decision from ${target.universityName || "University"}`;
				}

				const storedLetter = nextOfferLetterUrl;
				let attachmentUrl: string | null = null;
				if (storedLetter) {
					if (/^https?:\/\//i.test(storedLetter)) {
						attachmentUrl = storedLetter;
					} else {
						try {
							const storage = await getDocumentStorage();
							if (storage.enabled) {
								const ticket = await storage.createDownloadUrl({ key: storedLetter });
								attachmentUrl = ticket.url;
							}
						} catch {
							/* storage not configured — email still sends without the attachment */
						}
					}
				}

				const emailContent = renderSchoolOfferEmail({
					clientName: appRow.name || "Applicant",
					universityName: target.universityName || "University",
					programName: target.programName || "Programme",
					outcome: input.outcome,
					// Offer terms come from the row just saved, so the email says
					// what the portal shows.
					tuitionFormatted:
						updated.offerTuitionLabel?.trim() ||
						(updated.offerTuitionUsd != null ? formatUsd(updated.offerTuitionUsd) : null),
					depositFormatted: updated.offerDepositUsd != null ? formatUsd(updated.offerDepositUsd) : null,
					depositDeadlineFormatted: updated.offerDepositDueAt
						? updated.offerDepositDueAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
						: null,
					consultantNote: providedNote || fallbackNote,
					portalUrl: frontendUrl,
					hasAttachment: Boolean(attachmentUrl),
				});

				await sendEmail({
					to: appRow.email,
					subject,
					html: emailContent.html,
					text: emailContent.text,
					...(attachmentUrl
						? {
								attachments: [
									{
										filename: `Document_${(target.universityName || "University").replace(/\s+/g, "_")}.pdf`,
										path: attachmentUrl,
									},
								],
							}
						: {}),
				});
			}
		} catch (err) {
			console.warn("[schools] Failed to send update email to applicant:", err);
		}
	}

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

/* ── Admission letters (offer letters) ────────────────────────────────────── */

/**
 * Admission / offer letters live in the same private document vault as applicant
 * uploads, under a sub-directory keyed by the applicant's name so a reviewer
 * browsing the bucket sees a sensible layout. The applicant's *original* filename
 * is never used as the path — it is attacker-controlled — only as a stored label.
 *
 * Structure: `admission-letters/{nameSlug}/{nameSlug}-admission-letter-{suffix}.{ext}`
 */
function buildAdmissionLetterKey(applicantName: string | null, fileName: string): string {
	const extension = (fileName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "pdf").toLowerCase();
	const nameSlug = sanitizeApplicantSlug(applicantName ?? "applicant");
	const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
	return `admission-letters/${nameSlug}/${nameSlug}-admission-letter-${suffix}.${extension}`;
}

function sanitizeApplicantSlug(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 64) || "applicant"
	);
}

/**
 * Resolve the applicant name for a school application row, so the storage path
 * can be built from it.
 */
async function applicantNameFor(schoolRow: { applicantId: string }): Promise<string | null> {
	const [appRow] = await db
		.select({ name: applicants.name })
		.from(applicants)
		.where(eq(applicants.id, schoolRow.applicantId))
		.limit(1);
	return appRow?.name ?? null;
}

export async function createAdmissionLetterUpload(
	schoolId: string,
	input: { fileName: string; contentType: string },
): Promise<{ uploadUrl: string; storageKey: string; expiresAt: string; headers?: Record<string, string> }> {
	const [target] = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.id, schoolId))
		.limit(1);
	if (!target) {
		throw new HttpError(404, "SCHOOL_NOT_FOUND", "School application not found");
	}

	const storage = await getDocumentStorage();
	if (!storage.enabled) {
		throw new HttpError(
			503,
			"STORAGE_NOT_CONFIGURED",
			"Document storage is not configured on this server.",
		);
	}

	const applicantName = await applicantNameFor(target);
	const storageKey = buildAdmissionLetterKey(applicantName, input.fileName);

	const ticket = await storage.createUploadUrl({
		key: storageKey,
		contentType: input.contentType,
	});

	return {
		uploadUrl: ticket.url,
		storageKey,
		expiresAt: ticket.expiresAt.toISOString(),
		headers: ticket.headers,
	};
}

export async function completeAdmissionLetterUpload(
	schoolId: string,
	storageKey: string,
): Promise<SchoolApplication> {
	const [target] = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.id, schoolId))
		.limit(1);
	if (!target) {
		throw new HttpError(404, "SCHOOL_NOT_FOUND", "School application not found");
	}

	const storage = await getDocumentStorage();
	if (!storage.enabled) {
		throw new HttpError(
			503,
			"STORAGE_NOT_CONFIGURED",
			"Document storage is not configured on this server.",
		);
	}

	// Trusting the client here would let anyone point the record at a key that
	// was never uploaded. Verify the object exists before committing the key.
	const object = await storage.head(storageKey);
	if (!object) {
		throw new HttpError(409, "UPLOAD_NOT_COMPLETED", "The file has not finished uploading");
	}

	// Remove any previous letter object so the vault folder has only the latest.
	if (target.offerLetterUrl && target.offerLetterUrl !== storageKey && !/^https?:\/\//i.test(target.offerLetterUrl)) {
		await storage.remove(target.offerLetterUrl).catch(() => {
			/* orphaned object; not worth failing the replacement */
		});
	}

	const [updated] = await db
		.update(schoolApplications)
		.set({ offerLetterUrl: storageKey, updatedAt: new Date() })
		.where(eq(schoolApplications.id, schoolId))
		.returning();

	return serializeSchool(updated);
}

export async function removeAdmissionLetter(schoolId: string): Promise<SchoolApplication> {
	const [target] = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.id, schoolId))
		.limit(1);
	if (!target) {
		throw new HttpError(404, "SCHOOL_NOT_FOUND", "School application not found");
	}

	if (target.offerLetterUrl && !/^https?:\/\//i.test(target.offerLetterUrl)) {
		try {
			const storage = await getDocumentStorage();
			if (storage.enabled) {
				await storage.remove(target.offerLetterUrl);
			}
		} catch {
			/* storage not configured or object already gone — clear the row regardless */
		}
	}

	const [updated] = await db
		.update(schoolApplications)
		.set({ offerLetterUrl: null, updatedAt: new Date() })
		.where(eq(schoolApplications.id, schoolId))
		.returning();

	return serializeSchool(updated);
}

export async function getAdmissionLetterDownloadUrl(
	schoolId: string,
): Promise<{ url: string; expiresAt: string }> {
	const [target] = await db
		.select()
		.from(schoolApplications)
		.where(eq(schoolApplications.id, schoolId))
		.limit(1);
	if (!target) {
		throw new HttpError(404, "SCHOOL_NOT_FOUND", "School application not found");
	}
	if (!target.offerLetterUrl) {
		throw new HttpError(404, "DOCUMENT_NOT_FOUND", "No admission letter has been uploaded");
	}

	if (/^https?:\/\//i.test(target.offerLetterUrl)) {
		return { url: target.offerLetterUrl, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
	}

	const storage = await getDocumentStorage();
	if (!storage.enabled) {
		throw new HttpError(
			503,
			"STORAGE_NOT_CONFIGURED",
			"Document storage is not configured on this server.",
		);
	}

	const ticket = await storage.createDownloadUrl({ key: target.offerLetterUrl });
	return { url: ticket.url, expiresAt: ticket.expiresAt.toISOString() };
}