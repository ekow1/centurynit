import { useEffect, useState } from "react";
import { feesApi } from "century-nit-core/api";
import type { FeeCatalogue, FeeItem } from "century-nit-shared";

/**
 * The fee catalogue, fetched once per session and shared by every consumer.
 * Loading it also sets the exchange rate every GHS figure renders at, so
 * the console shows what the client is charged. `reload()` after finance
 * edits the schedule.
 */

let cached: FeeCatalogue | null = null;
let inflight: Promise<FeeCatalogue> | null = null;
const listeners = new Set<(c: FeeCatalogue) => void>();

function fetchCatalogue(): Promise<FeeCatalogue> {
	const p = feesApi
		.catalogue()
		.then((c) => {
			cached = c;
			listeners.forEach((fn) => fn(c));
			return c;
		})
		.finally(() => {
			if (inflight === p) inflight = null;
		});
	inflight = p;
	return p;
}

async function load(force = false): Promise<FeeCatalogue> {
	if (cached && !force) return cached;
	if (inflight) {
		if (!force) return inflight;
		// A forced reload must not resolve with a request that started before
		// it — that would hand back pre-save data. Chain the fresh fetch behind
		// the one already running.
		return inflight.then(fetchCatalogue, fetchCatalogue);
	}
	return fetchCatalogue();
}

export function useFeeCatalogue(): { catalogue: FeeCatalogue | null; error: string | null; reload: () => Promise<FeeCatalogue> } {
	const [catalogue, setCatalogue] = useState<FeeCatalogue | null>(cached);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		listeners.add(setCatalogue);
		if (!cached) {
			load().catch((e) => setError(e instanceof Error ? e.message : "Could not load the fee schedule"));
		}
		return () => {
			listeners.delete(setCatalogue);
		};
	}, []);
	return { catalogue, error, reload: () => load(true) };
}

/** The chapter an invoice type's optional items belong to. */
export function chapterOfInvoiceType(type: string): string | null {
	switch (type) {
		case "application":
			return "apply";
		case "visa":
			return "visa";
		case "travel":
			return "depart";
		case "consultation":
			return "consult";
		default:
			return null;
	}
}

/** Active optional items offered when raising or approving an invoice of this type (any chapter for custom). */
export function optionalItemsFor(catalogue: FeeCatalogue | null, type: string): FeeItem[] {
	if (!catalogue) return [];
	const chapter = chapterOfInvoiceType(type);
	return catalogue.items.filter((i) => i.active && i.optional && (chapter === null || i.chapter === chapter));
}
