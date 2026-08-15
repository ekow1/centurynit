import { useMemo, useSyncExternalStore } from "react";
import { safeRemoveItem } from "century-nit-core";
import type { LiveCaseSnapshot } from "century-nit-core/ops";

/**
 * Read-only window onto the ops store, for the presenter panel.
 *
 * `DemoControls` lives in the public app but reports on both halves. It used to
 * consume `useOpsState()` directly; with the Operations Center now a separate
 * app and bundle, it observes the same `localStorage` key instead — read-only,
 * plus the demo reset.
 *
 * This is demo scaffolding. It goes away with the rest of the simulation in
 * Phase 7 of docs/API_MIGRATION_PLAN.md.
 */

const OPS_STATE_KEY = "century-nit-ops-state";
const APPLIED_DIRECTIVES_KEY = "century-nit-applied-directives";

type OpsStateBlob = {
	liveCase?: LiveCaseSnapshot | null;
	activityLog?: unknown[];
};

function getSnapshot(): string | null {
	try {
		return localStorage.getItem(OPS_STATE_KEY);
	} catch {
		return null;
	}
}

function subscribe(onChange: () => void) {
	window.addEventListener("storage", onChange);
	const id = window.setInterval(onChange, 1500);
	return () => {
		window.removeEventListener("storage", onChange);
		window.clearInterval(id);
	};
}

export function useOpsSnapshot() {
	const raw = useSyncExternalStore(subscribe, getSnapshot);

	return useMemo(() => {
		if (!raw) return { present: false, liveCaseName: null, activityCount: 0 };
		try {
			const blob = JSON.parse(raw) as OpsStateBlob;
			return {
				present: true,
				liveCaseName: blob.liveCase?.present ? blob.liveCase.name : null,
				activityCount: blob.activityLog?.length ?? 0,
			};
		} catch {
			return { present: false, liveCaseName: null, activityCount: 0 };
		}
	}, [raw]);
}

/**
 * Clear the ops store and the directive idempotency ledger.
 *
 * An Operations Center window that is already open holds its state in React and
 * ignores a `storage` event whose `newValue` is null, so it needs a refresh to
 * pick this up. Callers should say so.
 */
export function resetOpsStorage(): void {
	safeRemoveItem(OPS_STATE_KEY);
	safeRemoveItem(APPLIED_DIRECTIVES_KEY);
}
