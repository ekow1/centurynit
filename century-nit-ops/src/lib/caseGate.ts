import { JOURNEY_STAGES, VISA_STAGE_LABELS, nextStepFor, type JourneyStage } from "century-nit-shared";
import type { MockApplication } from "century-nit-core/ops";

/**
 * What holds a case where it is — from the same rule the server's advance
 * handler runs (`nextStepFor`, plan-aware), read as one of three kinds:
 * ready (nothing blocks), work (Century's move), wait (the client's, or the
 * authority's). The board's cards, the Caseload's "waiting on us / on the
 * client" split and the officer strip all read this one function.
 */

export function normaliseStage(stage: string): JourneyStage {
	const match = JOURNEY_STAGES.find((s) => s === (stage === "payment_execution" ? "travel_assistance" : stage));
	return match ?? JOURNEY_STAGES[0];
}

/** The rule's inputs, from the record — the same signals the server reads. */
export function signalsOf(app: MockApplication) {
	const schools = app.schoolApplications ?? [];
	return {
		visaStage: app.visaStage,
		agencyStageIndex: app.agencyStageIndex,
		agencySettled: app.agencySettled,
		appFeePaid: app.appFeePaid,
		preDepartureTasks: app.preDepartureTasks,
		paymentPlanId: app.paymentPlanId,
		proceedStatus: app.proceedStatus,
		travelAssistanceStatus: app.travelAssistanceStatus,
		hasPackage: Boolean(app.fundingTrack),
		hasSelection: schools.length > 0,
		hasAdmitted: Boolean(app.acceptedSchoolId) || schools.some((s) => s.outcome === "Admitted"),
	};
}

export type Gate = {
	/** ready: nothing blocks; work: Century's; wait: the client's (or the authority's). */
	kind: "ready" | "work" | "wait";
	label: string;
	/** The rule's full sentence, for the tooltip. */
	reason: string | null;
	next: JourneyStage | null;
	/** Consent paused or declined — the case is parked, not merely waiting. */
	hold: boolean;
};

/** What holds the case in its column, in a few words. */
export function gateFor(app: MockApplication): Gate {
	const stage = normaliseStage(app.stage);
	// Plan-aware: the same rule the server's advance handler runs. A plan that
	// stops short is "ready" at its exit, or waits on the exit's own facts.
	const step = nextStepFor({
		scopeStages: app.scopeStages ?? null,
		stage,
		checks: { ...signalsOf(app), visaDone: app.visaStage === "complete" && app.visaOutcome === "approved", agencySettled: Boolean(app.agencySettled) },
	});
	if (step.kind === "done") return { kind: "ready", label: "Completed", reason: null, next: null, hold: false };
	if (step.kind === "complete") return { kind: "ready", label: "Ready to complete", reason: null, next: "completed", hold: false };
	if (step.kind === "blocked" && step.to === "completed") {
		const r0 = step.reason.toLowerCase();
		if (r0.includes("fee")) return { kind: "wait", label: "Fee unsettled · at exit", reason: step.reason, next: "completed", hold: false };
		return { kind: "work", label: step.reason.replace(/^the /, ""), reason: step.reason, next: "completed", hold: false };
	}
	const next = step.kind === "advance" ? step.to : step.to;
	const reason = step.kind === "advance" ? null : step.reason;
	if (reason === null) return { kind: "ready", label: "Ready", reason: null, next, hold: false };
	const r = reason.toLowerCase();
	const wait = (label: string, hold = false): Gate => ({ kind: "wait", label, reason, next, hold });
	const work = (label: string): Gate => ({ kind: "work", label, reason, next, hold: false });
	if (r.startsWith("stopped")) return wait("Consent declined", true);
	if (r.startsWith("paused")) return wait("On hold · consent", true);
	if (r.startsWith("locked")) return wait("Awaiting consent");
	if (r.includes("deposit")) return wait("Deposit unpaid");
	if (r.includes("application fee")) return wait("Application fee unpaid");
	if (r.includes("no service package")) return work("Choose a package");
	if (r.includes("no schools selected")) return work("Choose schools");
	if (r.includes("no accepted offer")) return wait("Awaiting an offer");
	if (r.includes("visa must be approved")) {
		if ((!app.visaStage || app.visaStage === "locked") && !app.visaInvoicePaid) return wait("Visa invoice unpaid");
		return work(`Visa · ${(VISA_STAGE_LABELS[app.visaStage ?? "locked"] ?? app.visaStage ?? "not started").toLowerCase()}`);
	}
	if (r.includes("payment plan") || r.includes("balance") || r.includes("instalment")) return wait("Fee milestone unpaid");
	if (r.includes("travel")) {
		const s = app.travelAssistanceStatus;
		if (!s || s === "decision_pending") return wait("Travel choice pending");
		return work(`Travel · ${s.replace(/_/g, " ")}`);
	}
	if (r.includes("checklist")) {
		const required = (app.preDepartureTasks ?? []).filter((t) => t.required !== false);
		const done = required.filter((t) => t.done || t.waivedReason).length;
		return work(`Checklist ${done} of ${required.length}`);
	}
	return work(reason.replace(/^cannot (advance|mark complete)[^:]*:\s*/i, ""));
}

export function ageDays(app: MockApplication): number {
	const at = new Date(app.updatedAt ?? app.submittedDate).getTime();
	if (Number.isNaN(at)) return 0;
	return Math.max(0, Math.floor((Date.now() - at) / 86_400_000));
}
