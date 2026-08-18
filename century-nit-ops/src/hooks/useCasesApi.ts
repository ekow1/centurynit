import { useCallback, useEffect, useState } from "react";
import {
	applicantsApi,
	applicationsApi,
	consultationsApi,
	staffApi,
	bookingsApi,
} from "century-nit-core/api";
import {
	APPLICATION_STATUS_TO_OPS,
	CONSULTATION_STATUS_TO_OPS,
	type ApiApplicant,
	type ApiApplication,
	type ApiConsultation,
	type AssessmentResult,
	type CommentKind,
} from "century-nit-shared";
import type {
	Assignee,
	MockApplicant,
	MockApplication,
	MockConsultation,
} from "century-nit-core/ops";

function toConsultation(row: ApiConsultation): MockConsultation {
	const p = row.profile ?? {};
	return {
		id: row.id,
		applicantId: row.applicantId,
		ref: row.reference,
		bookingId: row.bookingId,
		applicantName: row.applicantName,
		email: row.email,
		phone: row.phone ?? "",
		branch: row.branch,
		dateTime: row.startsAt
			? new Date(row.startsAt).toLocaleString(undefined, {
					dateStyle: "medium",
					timeStyle: "short",
					timeZone: row.timezone ?? undefined,
				})
			: "Unscheduled",
		type: row.type === "in_person" ? "In-Person" : "Online",
		assignedOfficer: row.assignedOfficerName ?? "",
		assignedOfficerEmail: row.assignedOfficerEmail ?? "",
		targetCountry: row.targetCountry ?? "",
		status: CONSULTATION_STATUS_TO_OPS[row.status] as MockConsultation["status"],
		personal: {
			nationality: p.nationality ?? "-",
			residence: p.residence ?? "-",
			dob: p.dob ?? "-",
		},
		passport: {
			number: p.passportNumber ?? "-",
			expiry: p.passportExpiry ?? "-",
			previousRefusals: p.previousRefusals ?? "None",
		},
		education: {
			degree: p.degree ?? "-",
			institution: p.institution ?? "-",
			gpa: p.gpa ?? "-",
			gradYear: p.gradYear ?? "-",
		},
		employment: {
			currentRole: p.currentRole ?? "-",
			company: p.company ?? "-",
			experienceYears: p.experienceYears ?? "-",
		},
		financial: {
			source: p.fundingSource ?? "-",
			budget: p.budget ?? "-",
		},
		goals: {
			degreeLevel: p.degreeLevel ?? "-",
			intake: p.intake ?? "-",
			major: p.major ?? "-",
		},
		documents: (row.requestedDocuments ?? []).map((name) => ({ name, status: "Pending Review" })),
		assessmentResult: row.assessmentResult ?? undefined,
		slotConfirmed: row.slotConfirmed,
		comments: row.comments,
		requestedDocuments: row.requestedDocuments,
		meetingLink: row.meetingUrl ?? undefined,
		slotDate: row.startsAt ? row.startsAt.slice(0, 10) : undefined,
		slotTime: row.startsAt
			? new Date(row.startsAt).toLocaleTimeString("en-GB", {
					hour: "2-digit",
					minute: "2-digit",
					hourCycle: "h23",
					timeZone: row.timezone ?? undefined,
				})
			: undefined,
		slotBranchId: row.branch,
		isLive: true,
		rescheduleRequestedAt: row.rescheduleRequestedAt,
		rescheduleRequestedStartsAt: row.rescheduleRequestedStartsAt,
		rescheduleRequestReason: row.rescheduleRequestReason,
		coordinatorName: row.coordinatorName ?? null,
		coordinatorEmail: row.coordinatorEmail ?? null,
		coordinatorAssignedAt: row.coordinatorAssignedAt ?? null,
		coordinatorAssignedByName: row.coordinatorAssignedByName ?? null,
		delegationNote: row.delegationNote ?? null,
	};
}

function toApplication(row: ApiApplication): MockApplication {
	return {
		id: row.id,
		appId: row.appNumber,
		applicantName: row.applicantName,
		email: row.email,
		phone: row.phone ?? "",
		branch: row.branch,
		university: row.university,
		program: row.program,
		country: row.country,
		degreeLevel: row.degreeLevel,
		assignedStaff: row.assignedStaffName ?? "",
		assignedStaffEmail: row.assignedStaffEmail ?? "",
		stage: row.stage,
		status: APPLICATION_STATUS_TO_OPS[row.status] as MockApplication["status"],
		submittedDate: (row.submittedAt ?? row.createdAt).slice(0, 10),
		checklist: row.checklist,
		fundingTrack: row.fundingTrack ?? "",
		notes: row.notes ?? "",
		comments: row.comments,
		requestedDocuments: row.requestedDocuments,
		visaStage: row.visaStage,
		visaInvoicePaid: row.visaInvoicePaid,
		visaCounselorNote: row.visaCounselorNote ?? undefined,
		paymentPlanId: (row.paymentPlanId as MockApplication["paymentPlanId"]) ?? "",
		agencyStageIndex: row.agencyStageIndex,
		agencySettled: row.agencySettled,
		travelClearance: row.travelClearance,
	};
}

/** Map raw API stage strings to PROCESS_STAGES index (1-based). */
function stageIndex(raw: string): number {
	const map: Record<string, number> = {
		Consultation: 1,
		Eligibility: 2,
		"School Package": 3,
		"School Selection": 4,
		"Application Invoice": 5,
		"Application Tracking": 6,
		"Visa Invoice": 7,
		"Visa Tracking": 8,
		"Pre-Departure": 9,
		Completed: 10,
		New: 0,
	};
	return map[raw] ?? 0;
}

function toApplicant(row: ApiApplicant, allApps: ApiApplication[]): MockApplicant {
	const app = allApps.filter((a) => a.applicantId === row.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

	const idx = stageIndex(row.currentStage);
	const total = 10;

	const financials = app
		? {
				totalAmount: "$0",
				paidAmount: app.status === "ACCEPTED" ? "$0" : "$0",
				outstanding: "$0",
				plan: app.fundingTrack ?? "",
			}
		: { totalAmount: "$0", paidAmount: "$0", outstanding: "$0", plan: "" };

	const timeline = app
		? [
				{ stage: "Application submitted", status: app.status === "UNDER_REVIEW" ? "Active" : app.status === "ACCEPTED" ? "Complete" : app.status, date: (app.submittedAt ?? app.createdAt).slice(0, 10) },
				{ stage: "University", status: app.university || "—", date: "" },
				{ stage: "Program", status: app.program || "—", date: "" },
				{ stage: "Country", status: app.country || "—", date: "" },
			]
		: [];

	return {
		id: row.id,
		applicantId: row.id.slice(0, 8).toUpperCase(),
		name: row.name,
		email: row.email,
		phone: row.phone ?? "",
		branch: row.branch,
		assignedOfficer: row.assignedOfficerName ?? "",
		assignedOfficerEmail: row.assignedOfficerEmail ?? "",
		country: app?.country ?? row.targetCountry ?? "",
		university: app?.university ?? "",
		program: app?.program ?? "",
		package: app?.fundingTrack ?? "",
		currentStage: row.currentStage,
		stageNumber: idx,
		totalStages: total,
		status: row.status,
		enrolledDate: app ? (app.submittedAt ?? app.createdAt).slice(0, 10) : "",
		financials,
		timeline,
		documents: app
			? app.requestedDocuments.map((d) => ({ name: d, category: "Required", date: "", status: "Pending" }))
			: [],
		messages: app
			? app.comments.filter((c) => c.kind === "comment").map((c) => ({ sender: c.author, time: c.at.slice(0, 10), text: c.text }))
			: [],
		auditLog: app
			? app.comments.map((c) => ({ action: c.kind === "status" ? "Status update" : c.kind === "assignment" ? "Assignment" : c.kind === "document_request" ? "Document request" : c.kind === "recommendation" ? "Recommendation" : "Comment", user: c.author, timestamp: c.at.slice(0, 16) }))
			: [],
		visaStage: app?.visaStage as MockApplicant["visaStage"],
		visaInvoicePaid: app?.visaInvoicePaid,
		visaCounselorNote: app?.visaCounselorNote ?? undefined,
		paymentPlanId: (app?.paymentPlanId as MockApplicant["paymentPlanId"]) ?? undefined,
		agencyStageIndex: app?.agencyStageIndex,
		agencySettled: app?.agencySettled,
		travelClearance: app?.travelClearance as MockApplicant["travelClearance"],
	};
}

export function useCasesApi() {
	const [consultations, setConsultations] = useState<MockConsultation[]>([]);
	const [applications, setApplications] = useState<MockApplication[]>([]);
	const [applicants, setApplicants] = useState<MockApplicant[]>([]);
	const [assignees, setAssignees] = useState<Assignee[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setError(null);
		try {
			const [c, a, p, staff] = await Promise.all([
				consultationsApi.list(),
				applicationsApi.list(),
				applicantsApi.list(),
				staffApi.list().catch(() => ({ staff: [] })),
			]);
			const apps = a.applications;
			setConsultations(c.consultations.map(toConsultation));
			setApplications(apps.map(toApplication));
			setApplicants(p.applicants.map((row) => toApplicant(row, apps)));
			setAssignees(
				staff.staff
					.filter((s) => s.active && (s.role === "consultant" || s.role === "coordinator"))
					.map((s) => ({ name: s.name, email: s.email, branch: s.branch ?? "" })),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load cases");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const replaceConsultation = (row: ApiConsultation) => {
		const adapted = toConsultation(row);
		setConsultations((prev) => {
			const next = prev.filter((c) => c.id !== adapted.id);
			return [adapted, ...next];
		});
		return adapted;
	};
	const replaceApplication = (row: ApiApplication) => {
		const adapted = toApplication(row);
		setApplications((prev) => {
			const next = prev.filter((c) => c.id !== adapted.id);
			return [adapted, ...next];
		});
		return adapted;
	};

	const staffIdByEmail = useCallback(async (email: string) => {
		const { staff } = await staffApi.list();
		const match = staff.find((s) => s.email === email);
		if (!match) throw new Error("That staff member is not on the directory");
		return match.id;
	}, []);

	const rescheduleConsultation = useCallback(
		async (_id: string, bookingId: string, date: string, time: string, reason: string) => {
			await bookingsApi.reschedule(bookingId, { date, time, reason });
			await refresh();
		},
		[refresh],
	);

	const decideReschedule = useCallback(
		async (bookingId: string, decision: "approve" | "reject") => {
			await bookingsApi.rescheduleDecision(bookingId, decision);
			await refresh();
		},
		[refresh],
	);

	return {
		consultations,
		applications,
		applicants,
		assignees,
		loading,
		error,
		refresh,
		assignConsultation: async (id: string, to: Assignee) =>
			replaceConsultation(await consultationsApi.assign(id, await staffIdByEmail(to.email))),
		confirmConsultationSlot: async (id: string) =>
			replaceConsultation(await consultationsApi.confirmSlot(id)),
		startConsultationAssessment: async (id: string) =>
			replaceConsultation(await consultationsApi.startAssessment(id)),
		completeConsultationAssessment: async (id: string, result: AssessmentResult) => {
			const res = await consultationsApi.completeAssessment(id, result);
			replaceConsultation(res.consultation);
			if (res.application) replaceApplication(res.application);
			return res;
		},
		commentOnConsultation: async (id: string, kind: CommentKind, text: string) =>
			replaceConsultation(await consultationsApi.comment(id, { kind, text })),
		requestConsultationDocs: async (id: string, documents: string[]) =>
			replaceConsultation(await consultationsApi.requestDocuments(id, documents)),
		cancelConsultation: async (id: string, reason?: string) =>
			replaceConsultation(await consultationsApi.cancel(id, reason)),
		rescheduleConsultation,
		decideReschedule,
		assignApplication: async (id: string, to: Assignee) =>
			replaceApplication(await applicationsApi.assign(id, await staffIdByEmail(to.email))),
		acceptApplication: async (id: string) => replaceApplication(await applicationsApi.accept(id)),
		toggleApplicationChecklist: async (id: string, itemId: string, checked: boolean) =>
			replaceApplication(await applicationsApi.toggleChecklist(id, itemId, checked)),
		commentOnApplication: async (id: string, kind: CommentKind, text: string) =>
			replaceApplication(await applicationsApi.comment(id, { kind, text })),
		requestApplicationDocs: async (id: string, documents: string[]) =>
			replaceApplication(await applicationsApi.requestDocuments(id, documents)),
		delegateCoordinator: async (id: string, coordinatorOpsUserId: string, note?: string) =>
			replaceConsultation(await consultationsApi.delegate(id, { coordinatorOpsUserId, delegationNote: note })),
		reassignCoordinator: async (id: string, newCoordinatorOpsUserId: string, reason?: string) =>
			replaceConsultation(await consultationsApi.reassign(id, { newCoordinatorOpsUserId, reason })),
		getWorkload: () => consultationsApi.workload(),
		getActivity: (id: string) => consultationsApi.getActivity(id),
	};
}
