import { and, eq, inArray } from "drizzle-orm";
import { DEFAULT_REQUIRED_DOCUMENT_IDS, VISA_DOCUMENT_IDS, documentTypesFor } from "century-nit-core/content";
import { ENTRY_EVIDENCE_IDS, STAGE_DOCUMENT_IDS, intentScope, normaliseScope, type ServiceIntent, type ServiceStage } from "century-nit-shared";
import type { DocumentChecklistItem } from "century-nit-shared";
import { db } from "../db/index.js";
import { applicantDocuments, applications, consultations, servicePackages } from "../db/schema.js";

/**
 * The documents a client must have verified, and where each one stands.
 *
 * Collected during the Consultation chapter so applications never wait on
 * paperwork. Which documents: the chosen package's list; before a package is
 * chosen, the package the assessment recommended; before that, the standard
 * set. Where each stands: the client's most advanced upload of that type.
 */
export async function requiredDocumentIdsFor(input: {
	applicationPackageId?: string | null;
	recommendedPackage?: string | null;
	/** The accepted plan's stages; null until accepted. */
	scopeStages?: readonly string[] | null;
	/** The consultant's recommendation, before acceptance. */
	recStages?: readonly string[] | null;
	/** Where the client said they were at booking — before any recommendation. */
	entryIntent?: string | null;
}): Promise<string[]> {
	const scope = plannedStagesFor(input);
	const entry = scope[0];
	const admissionsIds = scope.includes("admissions") ? await admissionsDocumentIdsFor(input) : [];
	const ids = [
		...ENTRY_EVIDENCE_IDS[entry],
		...admissionsIds,
		...(scope.includes("visa") ? STAGE_DOCUMENT_IDS.visa : []),
		...(scope.includes("departure") ? STAGE_DOCUMENT_IDS.departure : []),
	];
	return [...new Set(ids)];
}

/**
 * The plan as it stands, from the one place each input lives: the accepted
 * scope on the case (truth), else the consultant's recommendation, else what
 * the client said at booking, else the full journey. Nothing is copied
 * between them — a builder pre-fills from this, the ledger and the gates
 * read `scopeStages` only.
 */
export function plannedStagesFor(input: {
	scopeStages?: readonly string[] | null;
	recStages?: readonly string[] | null;
	entryIntent?: string | null;
}): ServiceStage[] {
	if (input.scopeStages) return normaliseScope(input.scopeStages);
	if (input.recStages && input.recStages.length > 0) return normaliseScope(input.recStages);
	if (input.entryIntent) return intentScope(input.entryIntent as ServiceIntent);
	return normaliseScope(null);
}

/** The Admissions set is the package's — by track — with the standard set behind it. */
async function admissionsDocumentIdsFor(input: { applicationPackageId?: string | null; recommendedPackage?: string | null }): Promise<string[]> {
	if (input.applicationPackageId) {
		const [pkg] = await db
			.select({ requiredDocuments: servicePackages.requiredDocuments })
			.from(servicePackages)
			.where(eq(servicePackages.id, input.applicationPackageId))
			.limit(1);
		if (pkg && pkg.requiredDocuments.length > 0) return pkg.requiredDocuments;
	}
	const rec = input.recommendedPackage?.trim().toLowerCase();
	if (rec) {
		const rows = await db
			.select({ code: servicePackages.code, name: servicePackages.name, requiredDocuments: servicePackages.requiredDocuments })
			.from(servicePackages)
			.where(eq(servicePackages.active, true));
		const hit = rows.find((r) => r.code.toLowerCase() === rec || r.name.toLowerCase() === rec);
		if (hit && hit.requiredDocuments.length > 0) return hit.requiredDocuments;
	}
	return [...DEFAULT_REQUIRED_DOCUMENT_IDS];
}

const RANK: Record<string, number> = { VERIFIED: 3, UPLOADED: 2, REJECTED: 1, PENDING_UPLOAD: 0 };

/** The checklist for a client: required types with the status of their best upload. */
export async function documentChecklistFor(input: {
	ownerUserId: string | null | undefined;
	applicationPackageId?: string | null;
	recommendedPackage?: string | null;
	scopeStages?: readonly string[] | null;
	recStages?: readonly string[] | null;
	entryIntent?: string | null;
}): Promise<DocumentChecklistItem[]> {
	const ids = await requiredDocumentIdsFor(input);
	return checklistForIds(input.ownerUserId, ids);
}

/** The visa-stage set against the client's uploads — the visa officer's working list. */
export async function visaDocumentChecklistFor(ownerUserId: string | null | undefined): Promise<DocumentChecklistItem[]> {
	return checklistForIds(ownerUserId, VISA_DOCUMENT_IDS);
}

async function checklistForIds(ownerUserId: string | null | undefined, ids: readonly string[]): Promise<DocumentChecklistItem[]> {
	const meta = documentTypesFor(ids);
	const best = new Map<string, { status: string; documentId: string }>();
	if (ownerUserId && ids.length > 0) {
		const rows = await db
			.select({ id: applicantDocuments.id, documentType: applicantDocuments.documentType, status: applicantDocuments.status })
			.from(applicantDocuments)
			.where(
				and(eq(applicantDocuments.ownerUserId, ownerUserId), inArray(applicantDocuments.documentType, [...ids])),
			);
		for (const r of rows) {
			const cur = best.get(r.documentType);
			if (!cur || (RANK[r.status] ?? 0) > (RANK[cur.status] ?? 0)) best.set(r.documentType, { status: r.status, documentId: r.id });
		}
	}
	return meta.map((m) => {
		const b = best.get(m.id);
		return {
			id: m.id,
			name: m.name,
			hint: m.hint,
			status: (b?.status ?? "PENDING_UPLOAD") as DocumentChecklistItem["status"],
			documentId: b?.documentId ?? null,
		};
	});
}

/** The checklist for an application: its package (or the assessment's recommendation) and its client's uploads. */
export async function documentChecklistForApplication(applicationId: string): Promise<DocumentChecklistItem[]> {
	const [row] = await db
		.select({
			packageId: applications.packageId,
			scopeStages: applications.scopeStages,
			consultationId: applications.consultationId,
			applicantId: applications.applicantId,
		})
		.from(applications)
		.where(eq(applications.id, applicationId))
		.limit(1);
	if (!row) return [];
	const { getApplicant } = await import("./cases.js");
	const applicant = await getApplicant(row.applicantId);
	let recommended: string | null = null;
	let recStages: string[] | null = null;
	if (row.consultationId && (!row.packageId || !row.scopeStages)) {
		const [c] = await db
			.select({ assessmentResult: consultations.assessmentResult })
			.from(consultations)
			.where(eq(consultations.id, row.consultationId))
			.limit(1);
		const rec = c?.assessmentResult as { recPackage?: string; recStages?: string[] } | null;
		recommended = rec?.recPackage ?? null;
		recStages = rec?.recStages ?? null;
	}
	return documentChecklistFor({
		ownerUserId: applicant?.userId ?? null,
		applicationPackageId: row.packageId,
		recommendedPackage: recommended,
		scopeStages: row.scopeStages ?? null,
		recStages,
		entryIntent: (applicant?.profile as { entryIntent?: string } | null)?.entryIntent ?? null,
	});
}

/** The names of the required documents that are not yet verified. */
export function outstandingDocuments(list: DocumentChecklistItem[]): string[] {
	return list.filter((d) => d.status !== "VERIFIED").map((d) => d.name);
}
