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

async function load(force = false): Promise<FeeCatalogue> {
	if (cached && !force) return cached;
	if (!inflight) {
		inflight = feesApi
			.catalogue()
			.then((c) => {
				cached = c;
				listeners.forEach((fn) => fn(c));
				return c;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

export function useFeeCatalogue(): { catalogue: FeeCatalogue | null; reload: () => Promise<FeeCatalogue> } {
	const [catalogue, setCatalogue] = useState<FeeCatalogue | null>(cached);
	useEffect(() => {
		listeners.add(setCatalogue);
		if (!cached) load().catch(() => {});
		return () => {
			listeners.delete(setCatalogue);
		};
	}, []);
	return { catalogue, reload: () => load(true) };
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
