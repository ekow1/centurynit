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
	type VisaDetails,
	type DepartureDetails,
	type JourneyStage,
	type PackageCode,
	type ServiceStage,
	type UpdateSchoolStatus,
	type OpsAddSchoolApplication,
	type StageHandoff,
	type StageHandoffDecision,
	type TravelAssistanceRequest,
	API_PREFIX,
} from "century-nit-shared";
import { apiFetch } from "../lib/api";
import { useOpsAuth } from "../pages/OpsAuthContext";
import { useOpsSSE } from "./useChatStream";
import type {
	Assignee,
	MockApplicant,
	MockApplication,
	MockConsultation,
} from "century-nit-core/ops";

/**
 * Event-type prefixes that mean "the case data on screen may have moved".
 * Types are normalized (`_` → `.`) before matching, so `invoice_issued`,
 * `payment.recorded`, `consent_decided` and `handoff.opened` all match.
 */
const OPS_CASE_EVENT_PREFIXES = [
	"case.",
	"application.",
	"consultation.",
	"stage.",
	"assignment.",
	"assessment.",
	"booking.",
	"lead.",
	"visa.",
	"document.",
	"handoff.",
	"travel.",
	"consent.",
	"school.",
	"invoice.",
	"payment.",
	"coordinator.",
	"coordination.",
	"owner.",
	"status.",
	"consultant.",
	"auto.",
	"staff.",
	"roles.",
] as const;

function toConsultation(row: ApiConsultation): MockConsultation {
	const p = row.profile ?? {};
	return {
		id: row.id,
		applicantId: row.applicantId,
		updatedAt: row.updatedAt,
		applicantUserId: row.applicantUserId ?? null,
		ref: row.reference,
		bookingId: row.bookingId,
		applicantName: row.applicantName,
		email: row.email,
		phone: row.phone ?? "",
		branch: row.branch,
		dateTime: row.startsAt
			? new Date(row.startsAt).toLocaleString(undefined, {
					month: "short",
					day: "numeric",
					year: "numeric",
					hour: "numeric",
					minute: "2-digit",
					timeZone: row.timezone ?? undefined,
					timeZoneName: "short",
				})
			: "Unscheduled",
		timezone: row.timezone ?? null,
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
		entryIntent: p.entryIntent ?? "",
		entry: {
			offerUniversity: p.offerUniversity ?? "",
			offerProgram: p.offerProgram ?? "",
			offerCountry: p.offerCountry ?? "",
			offerType: p.offerType ?? "",
			offerReference: p.offerReference ?? "",
			offerIntake: p.offerIntake ?? "",
			offerTuition: p.offerTuition ?? "",
			offerDepositPaid: p.offerDepositPaid ?? "",
			visaGrantReference: p.visaGrantReference ?? "",
			visaGrantDate: p.visaGrantDate ?? "",
			arrivalWindow: p.arrivalWindow ?? "",
		},
		goals: {
			degreeLevel: p.degreeLevel ?? "-",
			intake: p.intake ?? "-",
			major: p.major ?? "-",
			choices: p.studyChoices ?? [],
		},
		documents: [],
		assessmentResult: row.assessmentResult ?? undefined,
		slotConfirmed: row.slotConfirmed,
		comments: row.comments,
		requestedDocuments: row.requestedDocuments,
		documentChecklist: row.documentChecklist ?? [],
		meetingLink: row.meetingUrl ?? undefined,
		startsAt: row.startsAt ?? null,
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
		coordinatorId: row.coordinatorId ?? null,
		coordinatorName: row.coordinatorName ?? null,
		coordinatorEmail: row.coordinatorEmail ?? null,
		coordinatedVia: row.coordinatedVia ?? null,
		coordinatorAssignedAt: row.coordinatorAssignedAt,
		coordinatorAssignedByName: row.coordinatorAssignedByName ?? null,
		delegationNote: row.delegationNote ?? null,
		handlerCarriesCase: row.handlerCarriesCase ?? false,
		workflow: row.workflow,
		applicationId: row.applicationId ?? null,
		applicationNumber: row.applicationNumber ?? null,
		applicationStage: row.applicationStage ?? null,
		cancelledAt: row.cancelledAt ?? null,
		cancelledBy: row.cancelledBy ?? null,
		cancellationReason: row.cancellationReason ?? null,
		freeRebooking: row.freeRebooking ?? false,
		rebookedFromId: row.rebookedFromId ?? null,
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
		updatedAt: row.updatedAt,
		applicantName: row.applicantName,
		email: row.email,
		phone: row.phone ?? "",
		branch: row.branch,
		university: uniStr,
		program: progStr,
		country: ctryStr,
		degreeLevel: row.degreeLevel,
		assignedStaff: row.assignedStaffName ?? "",
		journeyCoordinatorName: row.journeyCoordinatorName ?? null,
		journeyCoordinatorEmail: row.journeyCoordinatorEmail ?? null,
		assignedStaffEmail: row.assignedStaffEmail ?? "",
		stage: row.stage,
		status: APPLICATION_STATUS_TO_OPS[row.status] as MockApplication["status"],
		submittedDate: (row.submittedAt ?? row.createdAt).slice(0, 10),
		checklist: row.checklist,
		fundingTrack: row.fundingTrack ?? "",
		scopeStages: row.scopeStages ?? null,
		plannedStages: row.plannedStages ?? undefined,
		notes: row.notes ?? "",
		comments: row.comments,
		requestedDocuments: row.requestedDocuments,
		documentChecklist: row.documentChecklist ?? [],
		visaStage: row.visaStage,
		visaOutcome: row.visaOutcome ?? null,
		visaInvoicePaid: row.visaInvoicePaid,
		visaCounselorNote: row.visaCounselorNote ?? undefined,
		visaDetails: row.visaDetails ?? {},
		departureDetails: row.departureDetails ?? {},
		preDepartureTasks: (row.preDepartureTasks ?? []).map((t) => ({
			...t,
			category: t.category ?? "documents",
			detail: t.detail ?? "",
		})),
		visaDocumentChecklist: row.visaDocumentChecklist ?? [],
		paymentPlanId: (row.paymentPlanId as MockApplication["paymentPlanId"]) ?? "",
		postArrivalMonths: row.postArrivalMonths ?? null,
		postArrivalFrequency: row.postArrivalFrequency ?? null,
		postArrivalStatus: row.postArrivalStatus ?? null,
		postArrivalStartAt: row.postArrivalStartAt ?? null,
		postArrivalReviewedBy: row.postArrivalReviewedBy ?? null,
		postArrivalDeclineReason: row.postArrivalDeclineReason ?? null,
		postArrivalInterestPct: row.postArrivalInterestPct ?? null,
		agencyStageIndex: row.agencyStageIndex,
		agencySettled: row.agencySettled,
		depositPaid: row.depositPaid,
		appFeePaid: row.appFeePaid,
		proceedStatus: row.proceedStatus ?? "invited",
		proceededAt: row.proceededAt ?? null,
		declinedReason: row.declinedReason ?? null,
		journey: row.journey ?? null,
		stageHandlers: row.stageHandlers ?? [],
		applicantUserId: row.applicantUserId ?? null,
		assignedStaffId: row.assignedStaffId ?? null,
		travelInvoicePaid: row.travelInvoicePaid,
		applicationConsent: row.applicationConsent ?? null,
		visaConsent: row.visaConsent ?? null,
		travelConsent: row.travelConsent ?? null,
		completedAtStage: row.completedAtStage ?? null,
		completionNote: row.completionNote ?? null,
		pendingContinuation: row.pendingContinuation ?? null,
		lastContinuation: row.lastContinuation ?? null,
		travelAssistanceStatus: row.travelAssistanceStatus ?? null,
		targetSchoolCount: row.targetSchoolCount ?? null,
		acceptedSchoolId: row.acceptedSchoolId ?? null,
		offerAcceptedAt: row.offerAcceptedAt ?? null,
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
		updatedAt: row.updatedAt,
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
		targetSchoolCount: app?.targetSchoolCount ?? null,
	};
}

export function useCasesApi() {
	// The pending-handoff queue is manager-only on the server; handlers get
	// an empty list without a request that would only be refused.
	const { canAssignWork } = useOpsAuth();
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
				canAssignWork
					? apiFetch<{ handoffs: StageHandoff[] }>(`${API_PREFIX}/applications/handoffs?status=pending`).catch(() => ({ handoffs: [] }))
					: Promise.resolve({ handoffs: [] as StageHandoff[] }),
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
						presence: s.presence,
						lastSeenAt: s.lastSeenAt,
						openCases: s.openCases,
						openStageSeats: s.openStageSeats,
					})),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load cases");
		} finally {
			setLoading(false);
		}
	}, [canAssignWork]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Real-time refresh: listen to the shared SSE singleton for case-relevant
	// events and debounce-refresh so a burst only triggers one API call.
	//
	// Matching is by prefix, not a whitelist — the API emits both bell
	// notifications (booking.new, invoice_issued, consent_decided) and
	// ephemeral domain events (case.updated, payment.recorded,
	// handoff.opened, school.updated, consultation.updated) and new event
	// types land constantly. Normalizing `_` to `.` makes both naming styles
	// one family, so nothing meaningful is ever missed.
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	useOpsSSE((event) => {
		const t = String(event.type ?? "").replace(/_/g, ".");
		if (!OPS_CASE_EVENT_PREFIXES.some((p) => t.startsWith(p))) return;
		// Targeted refresh: when the event names the entity, refetch just that
		// row and patch it into the list instead of pulling the whole caseload.
		const applicationId = (
			event.targetType === "consultation" ? undefined : (event.applicationId ?? event.caseId)
		) as string | undefined;
		const consultationId = (
			event.targetType === "consultation" ? event.caseId : event.consultationId
		) as string | undefined;
		if (applicationId) {
			applicationsApi
				.get(applicationId)
				.then((row) => replaceApplication(row))
				// A stale/foreign id must not swallow the refresh — fall back to
				// the full pull so the screen still converges.
				.catch(() => void refreshRef.current());
			// These events move collections the application row doesn't carry —
			// refresh the aux slice alongside the case.
			if (t.startsWith("handoff.") && canAssignWork) {
				apiFetch<{ handoffs: StageHandoff[] }>(`${API_PREFIX}/applications/handoffs?status=pending`)
					.then((hf) => setHandoffs(Array.isArray(hf?.handoffs) ? hf.handoffs : []))
					.catch(() => {});
			}
			if (t.startsWith("travel.")) {
				applicationsApi
					.listTravelAssistance()
					.then((ta) => setTravelRequests(Array.isArray(ta) ? ta : []))
					.catch(() => {});
			}
			return;
		}
		if (consultationId) {
			consultationsApi
				.get(consultationId)
				.then((row) => replaceConsultation(row))
				.catch(() => void refreshRef.current());
			return;
		}
		if (refreshTimer.current) clearTimeout(refreshTimer.current);
		refreshTimer.current = setTimeout(() => void refreshRef.current(), 1500);
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
		setApplicationStage: async (appId: string, stage: JourneyStage, note?: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.setStage(app.id, stage, note));
			await refresh();
		},
		decideContinuation: async (appId: string, requestId: string, decision: "approved" | "declined", note?: string) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) throw new Error("Application not found");
			await applicationsApi.decideContinuation(app.id, requestId, { decision, note });
			replaceApplication(await applicationsApi.get(app.id));
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
		setVisaStage: async (appId: string, stage: VisaStage, note?: string, outcome?: "approved" | "refused", details?: VisaDetails) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.setVisaStage(app.id, stage, note, outcome, details));
			await refresh();
		},
		setVisaDetails: async (appId: string, details: VisaDetails) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.setVisaDetails(app.id, details));
			await refresh();
		},
		setReleaseOverride: async (appId: string, input: { reason?: string; revoke?: boolean }) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.setReleaseOverride(app.id, input));
			await refresh();
		},
		setDepartureDetails: async (appId: string, details: DepartureDetails) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.setDepartureDetails(app.id, details));
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
				status: (app.schoolApplications?.find((s) => s.id === schoolId)?.status ?? "Preparing Application") as UpdateSchoolStatus["status"],
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
		/** Correct the school allowance or payment plan. Package changes go through selectPackage. */
		updateCaseFacts: async (appId: string, input: { paymentPlanId?: string; targetSchoolCount?: number | null }) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(await applicationsApi.patch(app.id, input));
			await refresh();
		},
		/** Bind the service package on the client's behalf — same server flow as the portal's, repricing included. */
		selectPackage: async (appId: string, input: { packageCode?: PackageCode; degreeLevel: string; targetSchoolCount?: number; stages?: ServiceStage[]; reason?: string }) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			const res = await applicationsApi.choosePackage(app.id, input);
			replaceApplication(res.application);
			await refresh();
		},
		/** Tick, untick or waive one pre-departure item — the officer's or, on the client's word, the client's. */
		setPreDepartureTask: async (appId: string, taskId: string, input: { done: boolean; waivedReason?: string | null }) => {
			const app = applications.find((a) => a.appId === appId);
			if (!app) return;
			replaceApplication(
				await apiFetch<ApiApplication>(`${API_PREFIX}/applications/${app.id}/pre-departure/${taskId}`, {
					method: "POST",
					body: JSON.stringify(input),
				}),
			);
		},
		assignConsultation: async (
			id: string,
			to: Assignee,
			opts?: { scope?: "stage" | "all"; branch?: string },
		) =>
			replaceConsultation(
				await consultationsApi.assign(id, to.opsUserId ?? (await staffIdByEmail(to.email)), opts),
			),
		/** Refer the consultation to another handling branch — no handler picked. */
		referConsultation: async (id: string, branch: string, note?: string) =>
			replaceConsultation(await consultationsApi.refer(id, { branch, note })),
		/** Re-fetch one consultation — a detail opened from the cached list can be stale. */
		refreshConsultation: async (id: string) => {
			replaceConsultation(await consultationsApi.get(id));
		},
		/** Re-fetch one application — a detail opened from the cached list can be stale. */
		refreshApplication: async (id: string) => {
			replaceApplication(await applicationsApi.get(id));
		},
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
		commentOnConsultation: async (id: string, kind: CommentKind, text: string, visibility: "internal" | "applicant" = "internal") =>
			replaceConsultation(await consultationsApi.comment(id, { kind, text, visibility })),
		requestConsultationDocs: async (id: string, documents: string[]) =>
			replaceConsultation(await consultationsApi.requestDocuments(id, documents)),
		cancelConsultation: async (id: string, reason?: string) =>
			replaceConsultation(await consultationsApi.cancel(id, reason)),
		/** Issue a free rebooking — the client's next checkout skips payment. */
		issueRebookingCredit: async (id: string) =>
			replaceConsultation(await consultationsApi.rebookCredit(id)),
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
		addApplication: async (applicantId: string, input: Omit<OpsAddSchoolApplication, "applicantId">) =>
			applicationsApi.addForApplicant(applicantId, input),
		assignApplication: async (
			id: string,
			to: Assignee,
			opts?: { scope?: "stage" | "all"; branch?: string; reason?: string },
		) =>
			replaceApplication(
				await applicationsApi.assign(id, to.opsUserId ?? (await staffIdByEmail(to.email)), opts),
			),
		/** The case's seats — owner, coordinator, specialists, open stages, history. */
		getCaseTeam: (id: string) => applicationsApi.team(id),
		/** Return a seat to the staffing queue — "owner" or a journey stage key. */
		releaseSeat: async (id: string, seat: string, note?: string) => {
			await applicationsApi.releaseSeat(id, seat, note);
			await refresh();
		},
		/** Self-serve staffing — claim the case's pending handoff. */
		claimApplication: async (id: string) => {
			await applicationsApi.claim(id);
			await refresh();
		},
		/** Refer the case to another handling branch — no handler picked. */
		referApplication: async (id: string, branch: string, note?: string) =>
			replaceApplication(await applicationsApi.refer(id, { branch, note })),
		toggleApplicationChecklist: async (id: string, itemId: string, checked: boolean) =>
			replaceApplication(await applicationsApi.toggleChecklist(id, itemId, checked)),
		commentOnApplication: async (id: string, kind: CommentKind, text: string, visibility: "internal" | "applicant" = "internal") =>
			replaceApplication(await applicationsApi.comment(id, { kind, text, visibility })),
		requestApplicationDocs: async (id: string, documents: string[]) =>
			replaceApplication(await applicationsApi.requestDocuments(id, documents)),
		delegateCoordinator: async (id: string, coordinatorOpsUserId: string, note?: string, scope?: "case" | "journey") =>
			replaceConsultation(await consultationsApi.delegate(id, { coordinatorOpsUserId, delegationNote: note, scope })),
		reassignCoordinator: async (id: string, newCoordinatorOpsUserId: string, reason?: string) =>
			replaceConsultation(await consultationsApi.reassign(id, { newCoordinatorOpsUserId, reason })),
		reclaimCoordination: async (id: string) =>
			replaceConsultation(await consultationsApi.reclaim(id)),
		returnToConfirmed: async (id: string) =>
			replaceConsultation(await consultationsApi.backToConfirmed(id)),
		delegateJourney: (applicantId: string, coordinatorOpsUserId: string) =>
			applicantsApi.delegateCoordination(applicantId, coordinatorOpsUserId),
		releaseJourney: (applicantId: string) => applicantsApi.releaseCoordination(applicantId),
		getDuty: (branch: string) => consultationsApi.duty(branch),
		setDuty: (branch: string, coordinatorOpsUserId: string | null) =>
			consultationsApi.setDuty({ branch, coordinatorOpsUserId }),
		getWorkload: () => consultationsApi.workload(),
		getActivity: (id: string) => consultationsApi.getActivity(id),
		resolveHandoff: async (
			handoffId: string,
			decision: StageHandoffDecision,
			opts?: { opsUserId?: string; reason?: string; scope?: "stage" | "all"; branch?: string },
		) => {
			await apiFetch<StageHandoff>(`${API_PREFIX}/applications/handoffs/${handoffId}/resolve`, {
				method: "POST",
				body: JSON.stringify({
					decision,
					opsUserId: opts?.opsUserId,
					reason: opts?.reason,
					scope: opts?.scope,
					branch: opts?.branch,
				}),
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
