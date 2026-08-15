import { useEffect, useRef } from "react";
import { useAppState, type VisaStatus } from "./AppState";
import { EMPTY_DIRECTIVES, type OpsDirectives, type VisaStage } from "century-nit-core/ops";
import { safeSetJSON } from "century-nit-core";

const GHS_RATE = 15;
function formatDualCurrency(usd: number): string {
	const ghs = Math.round(usd * GHS_RATE);
	return `GH₵${ghs.toLocaleString()} / $${usd.toLocaleString()} USD`;
}

/** Ops uses "installments" (plural), portal uses "installment" (singular). */
function opsPlanToPortal(plan: string): "full" | "installment" | "" {
	if (plan === "full") return "full";
	if (plan === "installments" || plan === "installment") return "installment";
	return "";
}

/** VisaStage (ops) and VisaStatus (portal) share the same union, but keep the cast explicit. */
function opsVisaToPortal(stage: VisaStage): VisaStatus {
	return stage as VisaStatus;
}

/**
 * Applies decisions made in the Operations Center to the applicant's portal
 * state - the ops → portal half of the simulation bridge.
 *
 * Mount once inside AppStateProvider:
 *
 *     <AppStateProvider>
 *       <OpsDirectiveBridge />
 *       ...
 *     </AppStateProvider>
 *
 * It reads the ops store straight out of localStorage rather than through
 * OpsStateProvider, so the portal stays independent of the ops React tree and
 * this works across browser tabs: staff act in one window, the applicant's
 * screen updates in the other.
 *
 * Each directive carries an `at` timestamp which we use as an idempotency key,
 * so a directive is applied exactly once per browser even across reloads.
 */

const OPS_STATE_KEY = "century-nit-ops-state";
const APPLIED_KEY = "century-nit-applied-directives";

function readDirectives(): OpsDirectives {
	try {
		const raw = localStorage.getItem(OPS_STATE_KEY);
		if (!raw) return EMPTY_DIRECTIVES;
		const parsed = JSON.parse(raw) as { directives?: Partial<OpsDirectives> };
		return { ...EMPTY_DIRECTIVES, ...(parsed.directives ?? {}) };
	} catch {
		return EMPTY_DIRECTIVES;
	}
}

function readApplied(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(APPLIED_KEY) ?? "{}") as Record<string, string>;
	} catch {
		return {};
	}
}

function markApplied(kind: string, at: string) {
	const applied = readApplied();
	applied[kind] = at;
	// If this write fails the directive is re-applied on the next poll, which is
	// noisy but harmless — far better than throwing out of the effect.
	safeSetJSON(APPLIED_KEY, applied);
}

export function OpsDirectiveBridge() {
	const { application, updateApplication, setEligibilityOutcome, pushNotification, setEnabledPostArrivalSchedules, setCustomPostArrivalSchedules } = useAppState();

	// Keep the latest state and setters in a ref so the polling effect never restarts.
	const apiRef = useRef({ application, updateApplication, setEligibilityOutcome, pushNotification, setEnabledPostArrivalSchedules, setCustomPostArrivalSchedules });
	useEffect(() => {
		apiRef.current = { application, updateApplication, setEligibilityOutcome, pushNotification, setEnabledPostArrivalSchedules, setCustomPostArrivalSchedules };
	});

	useEffect(() => {
		function apply() {
			const directives = readDirectives();
			const applied = readApplied();
			const api = apiRef.current;

			// ─ Eligibility decision from the consultant ─
			const elig = directives.eligibility;
			if (elig && applied.eligibility !== elig.at) {
				api.setEligibilityOutcome(elig.outcome, `${elig.note} - ${elig.by}`);
				api.pushNotification({
					title: "Eligibility decision received",
					body: `${elig.by}: ${elig.note}`,
					type: "stage",
				});
				markApplied("eligibility", elig.at);
			}

			// ─ Application invoice issued by finance ─
			const appInv = directives.appInvoice;
			if (appInv && applied.appInvoice !== appInv.at) {
				const current = api.application.applicationInvoice;
				if (current.status !== "paid") {
					api.updateApplication({
						applicationInvoice: {
							...current,
							id: current.id ?? `INV-APP-${Date.now().toString(36).toUpperCase()}`,
							status: "raised",
							raisedAt: appInv.at,
							amount: appInv.amount,
							actualAmount: appInv.amount,
							actualLines: appInv.lines,
							consultantNote: `${appInv.note} - ${appInv.by}`,
						},
						counselorNote: `Application invoice issued: ${formatDualCurrency(appInv.amount)} by ${appInv.by}.`,
					});
					api.pushNotification({
						title: "Application invoice issued",
						body: `${formatDualCurrency(appInv.amount)} is ready to pay.`,
						type: "invoice",
					});
				}
				markApplied("appInvoice", appInv.at);
			}

			// ─ Visa invoice issued by finance ─
			const visaInv = directives.visaInvoice;
			if (visaInv && applied.visaInvoice !== visaInv.at) {
				const current = api.application.visaInvoice;
				if (current.status !== "paid") {
					api.updateApplication({
						visaInvoice: {
							...current,
							id: current.id ?? `INV-VISA-${Date.now().toString(36).toUpperCase()}`,
							status: "raised",
							raisedAt: visaInv.at,
							amount: visaInv.amount,
							actualAmount: visaInv.amount,
							actualLines: visaInv.lines,
							consultantNote: `${visaInv.note} - ${visaInv.by}`,
						},
						counselorNote: `Visa invoice issued: ${formatDualCurrency(visaInv.amount)} by ${visaInv.by}.`,
					});
					api.pushNotification({
						title: "Visa invoice issued",
						body: `${formatDualCurrency(visaInv.amount)} is ready to pay.`,
						type: "invoice",
					});
				}
				markApplied("visaInvoice", visaInv.at);
			}

			// ─ Visa sub-stage advanced by ops ─
			const visaStg = directives.visaStage;
			if (visaStg && applied.visaStage !== visaStg.at) {
				const portalStatus = opsVisaToPortal(visaStg.stage);
				api.updateApplication({
					visaStatus: portalStatus,
					visaUpdatedAt: visaStg.at,
					counselorNote: visaStg.note ?? `Visa status updated to ${portalStatus} by ${visaStg.by}.`,
				});
				api.pushNotification({
					title: "Visa status updated",
					body: `${visaStg.by}: ${portalStatus}${visaStg.note ? ` — ${visaStg.note}` : ""}`,
					type: "stage",
				});
				markApplied("visaStage", visaStg.at);
			}

			// ─ Payment plan selected by ops ─
			const pp = directives.paymentPlan;
			if (pp && applied.paymentPlan !== pp.at) {
				const portalPlan = opsPlanToPortal(pp.plan);
				api.updateApplication({
					paymentPlanId: portalPlan,
					paymentPlanChosenAt: pp.at,
					counselorNote: `Payment plan set to ${portalPlan === "full" ? "full payment" : "installments"} by ${pp.by}.`,
				});
				api.pushNotification({
					title: "Payment plan set",
					body: `${pp.by} selected ${portalPlan === "full" ? "full payment" : "installment plan"} for you.`,
					type: "stage",
				});
				markApplied("paymentPlan", pp.at);
			}

			// ─ Agency milestone advanced by ops ─
			const ag = directives.agencyAdvance;
			if (ag && applied.agencyAdvance !== ag.at) {
				api.updateApplication({
					agencyStageIndex: ag.stageIndex,
					agencySettledAt: ag.settled ? ag.at : null,
					completedAt: ag.settled && api.application.visaStatus === "complete" ? ag.at : api.application.completedAt,
					counselorNote: ag.settled
						? `Agency settlement complete — cleared by ${ag.by}.`
						: `Agency installment ${ag.stageIndex} of 3 recorded by ${ag.by}.`,
				});
				api.pushNotification({
					title: ag.settled ? "Agency settled" : "Agency installment recorded",
					body: ag.settled
						? `${ag.by}: All agency fees paid. You're cleared for travel.`
						: `${ag.by}: Installment ${ag.stageIndex} of 3 recorded.`,
					type: "stage",
				});
				markApplied("agencyAdvance", ag.at);
			}

			// ─ Travel clearance granted by ops ─
			const tc = directives.travelClearance;
			if (tc && applied.travelClearance !== tc.at) {
				if (tc.cleared) {
					api.updateApplication({
						completedAt: tc.at,
						counselorNote: `Travel clearance granted by ${tc.by}. Journey complete.`,
					});
				}
				api.pushNotification({
					title: tc.cleared ? "Travel cleared" : "Travel clearance revoked",
					body: tc.cleared
						? `${tc.by}: You are cleared for departure. Safe travels!`
						: `${tc.by}: Travel clearance has been revoked. Please contact your consultant.`,
					type: "stage",
				});
				markApplied("travelClearance", tc.at);
			}

			// ─ Post-arrival schedule options configured by ops ─
			const sc = directives.scheduleConfig;
			if (sc && applied.scheduleConfig !== sc.at) {
				api.setEnabledPostArrivalSchedules(sc.enabledScheduleIds);
				api.setCustomPostArrivalSchedules(sc.customSchedules ?? []);
				api.pushNotification({
					title: "Payment schedule options updated",
					body: `${sc.by}: ${sc.enabledScheduleIds.length} option${sc.enabledScheduleIds.length === 1 ? "" : "s"} available for post-arrival payments${sc.customSchedules?.length ? `, ${sc.customSchedules.length} custom` : ""}.`,
					type: "stage",
				});
				markApplied("scheduleConfig", sc.at);
			}
		}

		apply();

		// Cross-tab: ops acting in another window fires a storage event here.
		function onStorage(e: StorageEvent) {
			if (e.key === OPS_STATE_KEY) apply();
		}
		window.addEventListener("storage", onStorage);

		// Same-tab fallback (storage events don't fire for same-document writes).
		const id = window.setInterval(apply, 1500);

		return () => {
			window.removeEventListener("storage", onStorage);
			window.clearInterval(id);
		};
	}, []);

	return null;
}
