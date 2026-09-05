import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { applications, consultations, opsUsers, applicants } from "../db/schema.js";
import type { StaffContext } from "../middleware/auth.js";

export type TeamAssignment = {
	id: string;
	type: "case" | "consultation";
	reference: string;
	clientName: string;
	clientEmail: string | null;
	assignedStaffId: string | null;
	assignedStaffName: string | null;
	assignedStaffEmail: string | null;
	stageOrStatus: string;
	stageOrStatusLabel: string;
	priority: string | null;
	updatedAt: string;
	link: string;
};

async function visibleStaffIds(staff: StaffContext): Promise<string[] | undefined> {
	if (staff.role === "super_admin") return undefined;
	const rows = await db
		.select({ id: opsUsers.id })
		.from(opsUsers)
		.where(and(eq(opsUsers.branch, staff.branch ?? ""), eq(opsUsers.active, true)));
	return rows.map((r) => r.id);
}

function toIso(d: Date | string | null | undefined): string {
	if (!d) return new Date().toISOString();
	return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export async function getTeamAssignments(
	staff: StaffContext,
	limit = 200,
): Promise<TeamAssignment[]> {
	const staffIds = await visibleStaffIds(staff);

	const appWhere = staffIds
		? and(isNotNull(applications.assignedStaffId), inArray(applications.assignedStaffId, staffIds))
		: isNotNull(applications.assignedStaffId);
	const consultWhere = staffIds
		? and(isNotNull(consultations.assignedOfficerId), inArray(consultations.assignedOfficerId, staffIds))
		: isNotNull(consultations.assignedOfficerId);

	const [caseRows, consultationRows] = await Promise.all([
		db
			.select({
				id: applications.id,
				reference: applications.appNumber,
				clientName: applicants.name,
				clientEmail: applicants.email,
				assignedStaffId: applications.assignedStaffId,
				assignedStaffName: opsUsers.name,
				assignedStaffEmail: opsUsers.email,
				stage: applications.stage,
				status: applications.status,
				updatedAt: applications.updatedAt,
			})
			.from(applications)
			.innerJoin(applicants, eq(applications.applicantId, applicants.id))
			.leftJoin(opsUsers, eq(applications.assignedStaffId, opsUsers.id))
			.where(appWhere),

		db
			.select({
				id: consultations.id,
				reference: consultations.reference,
				clientName: applicants.name,
				clientEmail: applicants.email,
				assignedStaffId: consultations.assignedOfficerId,
				assignedStaffName: opsUsers.name,
				assignedStaffEmail: opsUsers.email,
				status: consultations.status,
				updatedAt: consultations.updatedAt,
			})
			.from(consultations)
			.innerJoin(applicants, eq(consultations.applicantId, applicants.id))
			.leftJoin(opsUsers, eq(consultations.assignedOfficerId, opsUsers.id))
			.where(consultWhere),
	]);

	const out: TeamAssignment[] = [
		...caseRows.map((r) => ({
			id: r.id,
			type: "case" as const,
			reference: r.reference ?? r.id,
			clientName: r.clientName ?? "Client",
			clientEmail: r.clientEmail ?? null,
			assignedStaffId: r.assignedStaffId,
			assignedStaffName: r.assignedStaffName,
			assignedStaffEmail: r.assignedStaffEmail,
			stageOrStatus: r.stage ?? "unknown",
			stageOrStatusLabel: r.stage
				? (r.stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
				: (r.status ?? "Unknown"),
			priority: null,
			updatedAt: toIso(r.updatedAt),
			link: `/applications`,
		})),
		...consultationRows.map((r) => ({
			id: r.id,
			type: "consultation" as const,
			reference: r.reference ?? r.id,
			clientName: r.clientName ?? "Client",
			clientEmail: r.clientEmail ?? null,
			assignedStaffId: r.assignedStaffId,
			assignedStaffName: r.assignedStaffName,
			assignedStaffEmail: r.assignedStaffEmail,
			stageOrStatus: r.status ?? "unknown",
			stageOrStatusLabel: r.status ? r.status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown",
			priority: null,
			updatedAt: toIso(r.updatedAt),
			link: `/consultations`,
		})),
	];

	out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
	return out.slice(0, limit);
}
