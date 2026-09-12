import { desc, eq, inArray } from "drizzle-orm";
import { INVOICE_TYPE_LABELS, JOURNEY_STAGE_LABELS, type ApplicationActivityEvent } from "century-nit-shared";
import { db } from "../db/index.js";
import {
	caseAssignments,
	caseComments,
	invoicePayments,
	invoices,
	opsUsers,
	schoolApplications,
	stageAssignments,
	stageConsents,
	stageHandoffs,
	travelAssistanceRequests,
} from "../db/schema.js";

type Draft = Omit<ApplicationActivityEvent, "applicationId" | "at"> & { at: Date | null | undefined };

/**
 * An application's timeline, assembled from the tables that already record
 * its history. Applications have no activity table of their own (unlike
 * consultations); rather than add one and backfill, the timeline is a read
 * model over what is already written, so it is complete for old cases too.
 */
export async function getApplicationActivity(applicationId: string, limit = 100): Promise<ApplicationActivityEvent[]> {
	const [comments, owners, stages, handoffs, consents, invoiceRows, schools, travel] = await Promise.all([
		db.select().from(caseComments).where(eq(caseComments.targetId, applicationId)).orderBy(desc(caseComments.at)).limit(limit),
		db.select().from(caseAssignments).where(eq(caseAssignments.targetId, applicationId)),
		db.select().from(stageAssignments).where(eq(stageAssignments.applicationId, applicationId)),
		db.select().from(stageHandoffs).where(eq(stageHandoffs.applicationId, applicationId)),
		db.select().from(stageConsents).where(eq(stageConsents.applicationId, applicationId)),
		db.select().from(invoices).where(eq(invoices.applicationId, applicationId)),
		db.select().from(schoolApplications).where(eq(schoolApplications.applicationId, applicationId)),
		db.select().from(travelAssistanceRequests).where(eq(travelAssistanceRequests.applicationId, applicationId)),
	]);

	const payments = invoiceRows.length
		? await db
				.select()
				.from(invoicePayments)
				.where(
					inArray(
						invoicePayments.invoiceId,
						invoiceRows.map((i) => i.id),
					),
				)
		: [];

	// Resolve every ops user referenced, once.
	const userIds = new Set<string>();
	for (const o of owners) for (const id of [o.opsUserId, o.assignedBy, o.endedBy]) if (id) userIds.add(id);
	for (const s of stages) for (const id of [s.opsUserId, s.assignedBy]) if (id) userIds.add(id);
	for (const h of handoffs) for (const id of [h.fromOpsUserId, h.resolvedOpsUserId, h.decidedBy]) if (id) userIds.add(id);
	const names = new Map<string, string>();
	if (userIds.size) {
		const rows = await db
			.select({ id: opsUsers.id, name: opsUsers.name })
			.from(opsUsers)
			.where(inArray(opsUsers.id, [...userIds]));
		for (const r of rows) names.set(r.id, r.name);
	}
	const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null);
	const stageLabel = (stage: string) => JOURNEY_STAGE_LABELS[stage as keyof typeof JOURNEY_STAGE_LABELS] ?? stage;
	const invoiceTitle = (type: string) => `${INVOICE_TYPE_LABELS[type] ?? type} invoice`;
	const words = (s: string) => s.replace(/_/g, " ");

	const events: ApplicationActivityEvent[] = [];
	const push = (e: Draft) => {
		if (!e.at) return;
		events.push({ ...e, applicationId, at: e.at.toISOString() });
	};

	for (const c of comments) {
		push({
			id: `comment:${c.id}`,
			type: c.kind === "document_request" ? "document_request" : "comment",
			summary: c.kind === "document_request" ? "Documents requested" : c.kind === "comment" ? "Note added" : words(c.kind),
			detail: c.text,
			actorName: c.authorName,
			stage: null,
			at: c.at,
		});
	}

	for (const o of owners) {
		push({
			id: `owner:${o.id}`,
			type: "owner_assigned",
			summary: `${nameOf(o.opsUserId) ?? "A handler"} took ownership of the case`,
			detail: o.note ?? null,
			actorName: nameOf(o.assignedBy),
			stage: null,
			at: o.assignedAt,
		});
		if (o.endedAt) {
			push({
				id: `owner-end:${o.id}`,
				type: "owner_released",
				summary: `${nameOf(o.opsUserId) ?? "A handler"} released the case${o.endReason ? ` (${words(o.endReason)})` : ""}`,
				detail: null,
				actorName: nameOf(o.endedBy),
				stage: null,
				at: o.endedAt,
			});
		}
	}

	for (const s of stages) {
		push({
			id: `stage:${s.id}`,
			type: "stage_assigned",
			summary: `${nameOf(s.opsUserId) ?? "A specialist"} assigned to ${stageLabel(s.stage)}`,
			detail: null,
			actorName: nameOf(s.assignedBy),
			stage: s.stage,
			at: s.assignedAt,
		});
		if (s.endedAt) {
			push({
				id: `stage-end:${s.id}`,
				type: "stage_assignment_ended",
				summary: `${nameOf(s.opsUserId) ?? "A specialist"} left ${stageLabel(s.stage)}`,
				detail: s.endedReason ?? null,
				actorName: null,
				stage: s.stage,
				at: s.endedAt,
			});
		}
	}

	for (const h of handoffs) {
		push({
			id: `handoff:${h.id}`,
			type: "handoff_opened",
			summary: `${stageLabel(h.stage)} needs a handler`,
			detail: h.reason ?? null,
			actorName: nameOf(h.fromOpsUserId),
			stage: h.stage,
			at: h.createdAt,
		});
		if (h.decidedAt) {
			push({
				id: `handoff-done:${h.id}`,
				type: "handoff_resolved",
				summary: `${nameOf(h.resolvedOpsUserId) ?? "A handler"} ${h.decision === "keep" ? "kept" : "took"} ${stageLabel(h.stage)}`,
				detail: null,
				actorName: nameOf(h.decidedBy),
				stage: h.stage,
				at: h.decidedAt,
			});
		}
	}

	for (const c of consents) {
		if (c.decision === "pending") continue;
		push({
			id: `consent:${c.id}`,
			type: "consent_decided",
			summary: `Applicant chose to ${words(c.decision)} at ${words(c.stage)}`,
			detail: c.reason ?? null,
			actorName: c.decidedByClientUserId ? "Applicant" : null,
			stage: c.stage,
			at: c.decidedAt ?? c.updatedAt,
		});
	}

	for (const i of invoiceRows) {
		const title = invoiceTitle(i.type);
		push({
			id: `invoice:${i.id}`,
			type: "invoice_created",
			summary: `${title} ${i.invoiceNumber} prepared`,
			detail: i.note ?? null,
			actorName: i.issuedByName ?? null,
			stage: null,
			at: i.createdAt,
		});
		if (i.reviewedAt) {
			push({
				id: `invoice-issued:${i.id}`,
				type: "invoice_issued",
				summary: `${title} ${i.invoiceNumber} issued`,
				detail: null,
				actorName: i.reviewedByName ?? null,
				stage: null,
				at: i.reviewedAt,
			});
		}
		if (i.voidedAt) {
			push({
				id: `invoice-void:${i.id}`,
				type: "invoice_voided",
				summary: `${title} ${i.invoiceNumber} voided`,
				detail: i.voidReason ?? null,
				actorName: null,
				stage: null,
				at: i.voidedAt,
			});
		}
	}
	const invoiceById = new Map(invoiceRows.map((i) => [i.id, i]));
	for (const p of payments) {
		const inv = invoiceById.get(p.invoiceId);
		push({
			id: `payment:${p.id}`,
			type: "payment_recorded",
			summary: `Payment of ${(p.amountCents / 100).toFixed(2)} on ${inv ? `${invoiceTitle(inv.type)} ${inv.invoiceNumber}` : "an invoice"} (${p.method})`,
			detail: p.reference ?? null,
			actorName: p.recordedByName,
			stage: null,
			at: p.at,
		});
	}

	for (const s of schools) {
		const school = `${s.universityName} — ${s.programName}`;
		push({
			id: `school:${s.id}`,
			type: "school_added",
			summary: `${school} added to the application`,
			detail: null,
			actorName: null,
			stage: "school_submission",
			at: s.createdAt,
		});
		if (s.outcome === "Admitted") {
			push({
				id: `school-admit:${s.id}`,
				type: "school_admitted",
				summary: `Admitted to ${school}`,
				detail: null,
				actorName: null,
				stage: "offer_letter_review",
				at: s.updatedAt,
			});
		} else if (s.outcome === "Application Rejected" || s.outcome === "Withdrawn") {
			push({
				id: `school-reject:${s.id}`,
				type: "school_rejected",
				summary: `${school}: ${s.outcome.toLowerCase()}`,
				detail: null,
				actorName: null,
				stage: "offer_letter_review",
				at: s.updatedAt,
			});
		}
	}

	for (const t of travel) {
		push({
			id: `travel:${t.id}`,
			type: "travel_requested",
			summary: "Travel assistance decision opened",
			detail: null,
			actorName: null,
			stage: "travel_assistance",
			at: t.createdAt,
		});
		if (t.decision) {
			push({
				id: `travel-decision:${t.id}`,
				type: "travel_decided",
				summary:
					t.decision === "yes"
						? "Applicant asked us to book their travel"
						: t.decision === "hold"
							? "Applicant put travel assistance on hold"
							: "Applicant will arrange their own travel",
				detail: null,
				actorName: "Applicant",
				stage: "travel_assistance",
				at: t.updatedAt,
			});
		}
	}

	events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
	return events.slice(0, limit);
}
