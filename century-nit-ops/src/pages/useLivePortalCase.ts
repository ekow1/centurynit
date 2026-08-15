import { useEffect, useRef, useState } from "react";
import {
	AUTH_STORAGE_KEY,
	BOOKING_STORAGE_KEY,
	CONSULTATION_FEE_AMOUNT,
	PORTAL_DOCS_KEY,
	PROCESS_STAGES,
	SCHOOL_APPS_KEY,
	STORAGE_KEY,
	getProgram,
	getUniversity,
} from "century-nit-core";
import type { LiveCaseSnapshot } from "century-nit-core/ops";

/**
 * Reads the applicant portal's own localStorage and projects it into a snapshot
 * the ops side can display.
 *
 * Deliberately read-only and one-directional: the portal already persists every
 * state change to these keys, so ops sees the live applicant with no changes to
 * the portal at all. Because `storage` events fire across tabs, opening the
 * portal in one window and ops in another makes updates appear live - which is
 * the two-window demo.
 */

const WATCHED_KEYS = new Set([
	STORAGE_KEY,
	BOOKING_STORAGE_KEY,
	AUTH_STORAGE_KEY,
	SCHOOL_APPS_KEY,
	PORTAL_DOCS_KEY,
]);

function readJSON<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

/* Minimal structural shapes - we only read, so we don't import the portal's types. */

type StoredAuth = { name?: string; email?: string };

type StoredBooking = {
	confirmationId?: string | null;
	paymentStatus?: string;
	eligibilityOutcome?: string;
	assessment?: {
		firstName?: string;
		lastName?: string;
		email?: string;
		phone?: string;
		preferredCountries?: string;
	};
};

type StoredApplication = {
	firstName?: string;
	lastName?: string;
	email?: string;
	phone?: string;
	applicationId?: string | null;
	destinationId?: string;
	universityId?: string;
	programId?: string;
	schoolFundingTrack?: string;
	schoolDegreeLevel?: string;
	schoolSelectionDoneAt?: string | null;
	packageChosenAt?: string | null;
	paymentPlanId?: string;
	completedAt?: string | null;
	visaStatus?: string;
	applicationInvoice?: { status?: string; amount?: number };
	visaInvoice?: { status?: string; amount?: number };
	agencyTotal?: number;
	agencyPaid?: number;
	agencyDepositPaid?: boolean;
	agencySettledAt?: string | null;
	agencyStageIndex?: number;
	postArrivalSchedule?: string | null;
	postArrivalPaymentIndex?: number;
};

type StoredSchool = {
	id: string;
	universityId: string;
	programId: string;
	status: string;
};

type StoredDoc = { id: string; fileName: string | null; status: string };

/** Mirrors AppState.getCurrentProcessStage without importing it. */
function deriveStage(
	app: StoredApplication,
	booking: StoredBooking,
	schools: StoredSchool[],
): string {
	const consulted = Boolean(booking.confirmationId && booking.paymentStatus === "success");
	const eligible =
		booking.paymentStatus === "success" &&
		(booking.eligibilityOutcome === "eligible" || booking.eligibilityOutcome === "conditional");
	const pkg = Boolean(app.packageChosenAt && app.schoolFundingTrack && app.schoolDegreeLevel);
	const selectionConfirmed = Boolean(app.schoolSelectionDoneAt);
	const appPaid = app.applicationInvoice?.status === "paid";
	const visaPaid = app.visaInvoice?.status === "paid";
	const admitted = schools.some((s) => s.status === "accepted");
	const visaDone = app.visaStatus === "complete";

	if (app.completedAt) return "completed";
	// Mirrors the portal spine: travel follows the visa, money is not a stage
	if (admitted && visaDone) return "pre_departure";
	if (admitted && visaPaid) return "visa";
	if (admitted && !visaPaid) return "visa_invoice";
	if (appPaid && selectionConfirmed) return "school_tracking";
	if (selectionConfirmed && !appPaid) return "application_invoice";
	if (pkg) return "school_select";
	if (eligible) return "school_package";
	if (consulted) return "eligibility";
	return "consultation";
}

function buildSnapshot(): LiveCaseSnapshot | null {
	const auth = readJSON<StoredAuth>(AUTH_STORAGE_KEY);
	if (!auth?.email) return null; // nobody signed into the portal

	const app = readJSON<StoredApplication>(STORAGE_KEY) ?? {};
	const booking = readJSON<StoredBooking>(BOOKING_STORAGE_KEY) ?? {};
	const schools = readJSON<StoredSchool[]>(SCHOOL_APPS_KEY) ?? [];
	const docs = readJSON<StoredDoc[]>(PORTAL_DOCS_KEY) ?? [];

	const stage = deriveStage(app, booking, schools);
	const meta = PROCESS_STAGES.find((s) => s.id === stage);

	const uni = app.universityId ? getUniversity(app.universityId) : null;
	const prog = app.programId ? getProgram(app.programId) : null;

	const firstSchool = schools[0];
	const firstUni = firstSchool ? getUniversity(firstSchool.universityId) : null;
	const firstProg = firstSchool ? getProgram(firstSchool.programId) : null;

	return {
		present: true,
		name:
			auth.name ||
			[app.firstName, app.lastName].filter(Boolean).join(" ") ||
			"Portal Applicant",
		email: auth.email,
		phone: app.phone || booking.assessment?.phone || "",
		stage,
		stageLabel: meta?.label ?? stage,
		stageIndex: meta?.index ?? 1,
		totalStages: PROCESS_STAGES.length,
		consultationRef: booking.confirmationId ?? null,
		applicationId: app.applicationId ?? null,
		consultationPaid: booking.paymentStatus === "success",
		consultationAmount: booking.paymentStatus === "success" ? CONSULTATION_FEE_AMOUNT : 0,
		eligibility: booking.eligibilityOutcome ?? "pending",
		targetCountry: booking.assessment?.preferredCountries || app.destinationId || "",
		university: uni?.name ?? firstUni?.name ?? "",
		program: prog?.name ?? firstProg?.name ?? "",
		fundingTrack: app.schoolFundingTrack ?? "",
		degreeLevel: app.schoolDegreeLevel ?? "",
		schools: schools.map((s) => ({
			id: s.id,
			university: getUniversity(s.universityId)?.name ?? s.universityId,
			program: getProgram(s.programId)?.name ?? s.programId,
			status: s.status,
		})),
		appInvoiceStatus: app.applicationInvoice?.status ?? "none",
		appInvoiceAmount: app.applicationInvoice?.amount ?? 0,
		visaInvoiceStatus: app.visaInvoice?.status ?? "none",
		visaInvoiceAmount: app.visaInvoice?.amount ?? 0,
		agencyTotal: app.agencyTotal ?? 0,
		agencyPaid: app.agencyPaid ?? 0,
		agencyDepositPaid: app.agencyDepositPaid ?? false,
		paymentPlanId: app.paymentPlanId ?? null,
		postArrivalSchedule: app.postArrivalSchedule ?? null,
		postArrivalPaymentIndex: app.postArrivalPaymentIndex ?? 0,
		agencyStageIndex: app.agencyStageIndex ?? 0,
		agencySettled: !!app.agencySettledAt,
		documents: docs
			.filter((d) => d.fileName)
			.map((d) => ({
				name: d.fileName ?? d.id,
				category: d.id,
				status:
					d.status === "verified"
						? "Verified"
						: d.status === "rejected"
							? "Rejected"
							: "Pending Review",
			})),
		updatedAt: new Date().toISOString(),
	};
}

/** Identity of a snapshot ignoring `updatedAt`, so polling doesn't churn renders. */
function fingerprint(snap: LiveCaseSnapshot | null): string {
	if (!snap) return "none";
	return JSON.stringify({ ...snap, updatedAt: "" });
}

export function useLivePortalCase(): LiveCaseSnapshot | null {
	const [snapshot, setSnapshot] = useState<LiveCaseSnapshot | null>(buildSnapshot);
	const fingerprintRef = useRef<string>(fingerprint(snapshot));

	useEffect(() => {
		function refresh() {
			const next = buildSnapshot();
			const fp = fingerprint(next);
			// Only re-render when something the ops side actually displays changed.
			if (fp === fingerprintRef.current) return;
			fingerprintRef.current = fp;
			setSnapshot(next);
		}

		// Cross-tab: portal writes in another window land here.
		function onStorage(e: StorageEvent) {
			if (e.key && !WATCHED_KEYS.has(e.key)) return;
			refresh();
		}
		window.addEventListener("storage", onStorage);

		// Same-tab: storage events don't fire for our own writes, so poll gently.
		// 1.5s is invisible to a demo audience and costs nothing at this data size.
		const id = window.setInterval(refresh, 1500);

		return () => {
			window.removeEventListener("storage", onStorage);
			window.clearInterval(id);
		};
	}, []);

	return snapshot;
}
