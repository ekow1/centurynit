import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { CmsCollectionId, CmsOverlay, CmsStatus } from "century-nit-core";

/**
 * Public-site reader for CMS edits.
 *
 * Reads the ops store straight out of localStorage rather than through
 * OpsStateProvider - the same approach OpsDirectiveBridge takes - so the public
 * site stays independent of the ops React tree and updates across browser tabs:
 * an administrator edits in one window, the site changes in the other.
 */

const OPS_STATE_KEY = "century-nit-ops-state";

function parseOverlay(raw: string | null): CmsOverlay {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as { cmsOverlay?: CmsOverlay };
		return parsed.cmsOverlay ?? {};
	} catch {
		return {};
	}
}

function getSnapshot(): string | null {
	try {
		return localStorage.getItem(OPS_STATE_KEY);
	} catch {
		return null;
	}
}

/**
 * `storage` only fires in *other* tabs, so poll as well to catch edits made
 * in this one. 1.5s is well under the threshold where a demo feels stale.
 */
function subscribe(onChange: () => void) {
	window.addEventListener("storage", onChange);
	const id = window.setInterval(onChange, 1500);
	return () => {
		window.removeEventListener("storage", onChange);
		window.clearInterval(id);
	};
}

export function useSiteContent() {
	/**
	 * `useSyncExternalStore` rather than state + effect: localStorage is an
	 * external mutable source, and this keeps the read pure while still
	 * re-rendering when it changes. The snapshot is the raw JSON string so
	 * React can compare it cheaply.
	 */
	const raw = useSyncExternalStore(subscribe, getSnapshot);
	const overlay = useMemo<CmsOverlay>(() => parseOverlay(raw), [raw]);

	/** Merge a seed record with its override */
	const apply = useCallback(
		<T extends object>(collection: CmsCollectionId, id: string, seed: T): T => {
			const o = overlay[`${collection}:${id}`];
			return o ? ({ ...seed, ...o.values } as T) : seed;
		},
		[overlay],
	);

	const statusOf = useCallback(
		(collection: CmsCollectionId, id: string): CmsStatus =>
			overlay[`${collection}:${id}`]?.status ?? "Published",
		[overlay],
	);

	/** Drop anything an administrator has taken off the site, and apply edits */
	const live = useCallback(
		<T extends { id: string }>(collection: CmsCollectionId, seed: T[]): T[] =>
			seed
				.filter((r) => statusOf(collection, r.id) === "Published")
				.map((r) => apply(collection, r.id, r)),
		[apply, statusOf],
	);

	return { overlay, apply, statusOf, live };
}
