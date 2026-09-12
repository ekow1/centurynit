import { useCallback, useEffect, useRef, useState } from "react";
import {
	applicantsApi,
	applicationsApi,
	consultationsApi,
	staffApi,
	bookingsApi,
	schoolsApi,
} from "century-nit-core/api";
import {
	APPLICATION_STATUS_TO_OPS,
	CONSULTATION_STATUS_TO_OPS,
	JOURNEY_STAGES,
	type ApiApplicant,
	type ApiApplication,
	type ApiConsultation,
	type AssessmentResult,
	type CommentKind,
	type AssignScholarship,
	type StudentScholarship,
	type VisaStage,
	type JourneyStage,
	type UpdateSchoolStatus,
	type StageHandoff,
	type StageHandoffDecision,
	type TravelAssistanceRequest,
	API_PREFIX,
} from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { useOpsSSE } from "./useChatStream";
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
		applicantUserId: row.applicantUserId ?? null,
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
		documents: [],
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
		coordinatorAssignedAt: row.coordinatorAssignedAt,
		coordinatorAssignedByName: row.coordinatorAssignedByName ?? null,
		delegationNote: row.delegationNote ?? null,
		workflow: row.workflow,
		applicationId: row.applicationId ?? null,
		applicationNumber: row.applicationNumber ?? null,
		applicationStage: row.applicationStage ?? null,
	};
}

function toApplication(row: ApiApplication): MockApplication {
	const hasSchools = row.schoolApplications && row.schoolApplications.length > 0;
	const uniStr = hasSchools ? row.schoolApplications.map(s => s.universityName ?? s.universityId).join(", ") : (row.university ?? "");
	const progStr = hasSchools ? row.schoolApplications.map(s => s.programName ?? s.programId).join(", ") : (row.program ?? "");
	const ctryStr = hasSchools ? Array.from(new Set(row.schoolApplications.map(s => s.countryName ?? row.country ?? ""))).join(", ") : (row.country ?? "");

	return {
		id: row.id,
		appId: row.appNumber,
		applicantId: row.applicantId,
		applicantName: row.applicantName,
		email: row.email,
		phone: row.phone ?? "",
		branch: row.branch,
		university: uniStr,
		program: progStr,
		country: ctryStr,
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
		visaOutcome: row.visaOutcome ?? null,
		visaInvoicePaid: row.visaInvoicePaid,
		visaCounselorNote: row.visaCounselorNote ?? undefined,
		paymentPlanId: (row.paymentPlanId as MockApplication["paymentPlanId"]) ?? "",
		agencyStageIndex: row.agencyStageIndex,
		agencySettled: row.agencySettled,
		depositPaid: row.depositPaid,
		appFeePaid: row.appFeePaid,
		travelClearance: row.travelClearance,
		proceedStatus: row.proceedStatus ?? "invited",
		journey: row.journey ?? null,
		stageHandlers: row.stageHandlers ?? [],
		applicantUserId: row.applicantUserId ?? null,
		assignedStaffId: row.assignedStaffId ?? null,
		travelInvoicePaid: row.travelInvoicePaid,
		applicationConsent: row.applicationConsent ? { decision: row.applicationConsent.decision } : null,
		visaConsent: row.visaConsent ? { decision: row.visaConsent.decision } : null,
		travelConsent: row.travelConsent ? { decision: row.travelConsent.decision } : null,
		targetSchoolCount: row.targetSchoolCount ?? null,
		consultationId: row.consultationId ?? null,
		consultationNumber: row.consultationNumber ?? null,
		schoolApplications: row.schoolApplications ?? [],
	};
}

function toApplicant(row: ApiApplicant, allApps: ApiApplication[]): MockApplicant {
	const app = allApps.filter((a) => a.applicantId === row.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

	const idx = JOURNEY_STAGES.indexOf(row.currentStage as JourneyStage) + 1;
	const total = JOURNEY_STAGES.length;

	const financials = app
		? {
				totalAmount: "-",
				paidAmount: "-",
				outstanding: "-",
				plan: app.fundingTrack ?? "",
			}
		: { totalAmount: "-", paidAmount: "-", outstanding: "-", plan: "" };

	const hasSchools = app?.schoolApplications && app.schoolApplications.length > 0;
	const uniStr = hasSchools ? app.schoolApplications.map(s => s.universityName ?? s.universityId).join(", ") : (app?.university ?? "");
	const progStr = hasSchools ? app.schoolApplications.map(s => s.programName ?? s.programId).join(", ") : (app?.program ?? "");
	const ctryStr = hasSchools ? Array.from(new Set(app.schoolApplications.map(s => s.countryName ?? app?.country ?? ""))).join(", ") : (app?.country ?? row.targetCountry ?? "");

	const timeline = app
		? [
				{ stage: "Application submitted", status: app.status === "UNDER_REVIEW" ? "Active" : app.status === "ACCEPTED" ? "Complete" : app.status, date: (app.submittedAt ?? app.createdAt).slice(0, 10) },
				{ stage: "University", status: uniStr || "—", date: "" },
				{ stage: "Program", status: progStr || "—", date: "" },
				{ stage: "Country", status: ctryStr || "—", date: "" },
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
		country: ctryStr,
		university: uniStr,
		program: progStr,
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
		targetSchoolCount: app?.targetSchoolCount ?? null,
	};
}

export function useCasesApi() {
	const [consultations, setConsultations] = useState<MockConsultation[]>([]);
	const [applications, setApplications] = useState<MockApplication[]>([]);
	const [applicants, setApplicants] = useState<MockApplicant[]>([]);
	const [assignees, setAssignees] = useState<Assignee[]>([]);
	const [handoffs, setHandoffs] = useState<StageHandoff[]>([]);
	const [travelRequests, setTravelRequests] = useState<TravelAssistanceRequest[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const refresh = useCallback(async () => {
		setError(null);
		try {
			const [c, a, p, staff, hf, ta] = await Promise.all([
				consultationsApi.list(),
				applicationsApi.list(),
				applicantsApi.list(),
				staffApi.list().catch(() => ({ staff: [] })),
				apiFetch<{ handoffs: StageHandoff[] }>(`${API_PREFIX}/applications/handoffs?status=pending`).catch(() => ({ handoffs: [] })),
				applicationsApi.listTravelAssistance().catch(() => [] as TravelAssistanceRequest[]),
			]);
			const apps = Array.isArray(a?.applications) ? a.applications : [];
			const rawConsultations = Array.isArray(c?.consultations) ? c.consultations : [];
			const rawApplicants = Array.isArray(p?.applicants) ? p.applicants : [];
			const rawStaff = Array.isArray(staff?.staff) ? staff.staff : [];

			setConsultations(rawConsultations.map(toConsultation));
			setApplications(apps.map(toApplication));
			setApplicants(rawApplicants.map((row) => toApplicant(row, apps)));
			setHandoffs(Array.isArray(hf?.handoffs) ? hf.handoffs : []);
			setTravelRequests(Array.isArray(ta) ? ta : []);
			setAssignees(
				rawStaff
					.filter((s) => s.active)
					.map((s) => ({
						name: s.name,
						email: s.email,
						branch: s.branch ?? "",
						role: s.role,
						opsUserId: s.id,
					})),
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

	// Real-time refresh: listen to the shared SSE singleton for case-relevant
	// notifications and debounce-refresh so a burst of events only triggers
	// one API call.
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	useOpsSSE((event) => {
		const t = event.type;
		if (
			t === "booking.new" ||
			t === "booking.assigned" ||
			t === "booking.rescheduled" ||
			t === "booking.cancelled" ||
			t === "lead.new" ||
			t === "consultation.assigned" ||
			t === "assessment.complete" ||
			t === "case.assigned" ||
			t === "case.updated" ||
			t === "stage.changed" ||
			t === "stage.needs_handler" ||
			t === "assignment.handoff_resolved" ||
			t === "visa.stage_changed" ||
			t === "coordinator_delegated" ||
			t === "coordinator_reassigned" ||
			t === "status_changed" ||
			t === "consultant_assigned" ||
			t === "auto_escalated" ||
			t === "document.uploaded"
		) {
			if (refreshTimer.current) clearTimeout(refreshTimer.current);
			refreshTimer.current = setTimeout(() => void refreshRef.current(), 1500);
		}
	});

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
		handoffs,
		travelRequests,
		loading,
		error,
		refresh,
		setApplicationStage: async (appId: string, stage: JourneyStage) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.setStage(app.id, stage));
			await refresh();
		},
		recordProceed: async (appId: string, reason: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) throw new Error("Application not found");
			await apiFetch(`${API_PREFIX}/cases/${app.id}/proceed`, {
				method: "POST",
				body: JSON.stringify({ overrideReason: reason }),
			});
			await refresh();
		},
		declineProceed: async (appId: string, reason: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) throw new Error("Application not found");
			await apiFetch(`${API_PREFIX}/cases/${app.id}/proceed/decline`, {
				method: "POST",
				body: JSON.stringify({ reason }),
			});
			await refresh();
		},
		reinviteProceed: async (appId: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) throw new Error("Application not found");
			await apiFetch(`${API_PREFIX}/cases/${app.id}/proceed/reinvite`, {
				method: "POST",
			});
			await refresh();
		},
		setVisaStage: async (appId: string, stage: VisaStage, note?: string, outcome?: "approved" | "refused") => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.setVisaStage(app.id, stage, note, outcome));
			await refresh();
		},
		updateSchoolApplication: async (
			appId: string,
			schoolId: string,
			patch: Partial<UpdateSchoolStatus>,
		) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			await schoolsApi.updateStatus(schoolId, {
				status: (app.schoolApplications?.find((s) => s.id === schoolId)?.status ?? "Preparing Application") as any,
				...patch,
			});
			await refresh();
		},
		setVisaCounselorNote: async (appId: string, note: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			await apiFetch<ApiApplication>(`${API_PREFIX}/applications/${app.id}`, {
				method: "PATCH",
				body: JSON.stringify({ visaCounselorNote: note }),
			});
			await refresh();
		},
		/** Staff-only case notes — the running context the next handler reads first. */
		setApplicationNotes: async (appId: string, notes: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			await apiFetch<ApiApplication>(`${API_PREFIX}/applications/${app.id}`, {
				method: "PATCH",
				body: JSON.stringify({ notes }),
			});
			await refresh();
		},
		setPaymentPlan: async (appId: string, plan: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			await apiFetch<ApiApplication>(`${API_PREFIX}/applications/${app.id}`, {
				method: "PATCH",
				body: JSON.stringify({ paymentPlanId: plan }),
			});
			await refresh();
		},
		setTravelClearance: async (appId: string, cleared: boolean) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.setTravelClearance(app.id, cleared));
			await refresh();
		},
		togglePreDepartureTask: async (appId: string, taskId: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			const tasks = app.preDepartureTasks ?? [];
			const updated = tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
			await apiFetch<ApiApplication>(`${API_PREFIX}/applications/${app.id}`, {
				method: "PATCH",
				body: JSON.stringify({ preDepartureTasks: updated }),
			});
			await refresh();
		},
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
		listScholarships: (applicantId: string) => 
			apiFetch<{ scholarships: StudentScholarship[] }>(`${API_PREFIX}/schools/${applicantId}/scholarships`),
		assignScholarship: (applicantId: string, data: AssignScholarship) =>
			apiFetch<StudentScholarship>(`${API_PREFIX}/schools/${applicantId}/scholarships`, {
				method: "POST",
				body: JSON.stringify(data),
			}),
		removeScholarship: (applicantId: string, scholarshipId: string) =>
			apiFetch(`${API_PREFIX}/schools/${applicantId}/scholarships/${scholarshipId}`, {
				method: "DELETE",
			}),
		addApplication: async (applicantId: string, input: any) =>
			applicationsApi.addForApplicant(applicantId, input),
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
		resolveHandoff: async (
			handoffId: string,
			decision: StageHandoffDecision,
			opts?: { opsUserId?: string; reason?: string },
		) => {
			await apiFetch<StageHandoff>(`${API_PREFIX}/applications/handoffs/${handoffId}/resolve`, {
				method: "POST",
				body: JSON.stringify({ decision, opsUserId: opts?.opsUserId, reason: opts?.reason }),
			});
			await refresh();
		},
		deferHandoff: async (handoffId: string, reason?: string) => {
			await apiFetch<StageHandoff>(`${API_PREFIX}/applications/handoffs/${handoffId}/defer`, {
				method: "POST",
				body: JSON.stringify({ reason }),
			});
			await refresh();
		},
	};
}
