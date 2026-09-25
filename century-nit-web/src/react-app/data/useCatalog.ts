import { useEffect, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import {
	destinations as staticDestinations,
	programs as staticPrograms,
	scholarships as staticScholarships,
	universities as staticUniversities,
	type Destination,
	type Program,
	type University,
} from "century-nit-core";

type Scholarship = (typeof staticScholarships)[number];

/**
 * The public catalogue, live from the API.
 *
 * Replaces the dead `useSiteContent` localStorage overlay: destinations,
 * universities, programs and scholarships now come from the same DB-backed
 * `/catalog/*` endpoints the ops Programmes page edits, so an ops change is
 * what the site shows. The compiled `content.ts` arrays stay as the initial
 * value — first paint is instant and identical to before, then the real rows
 * swap in when the fetch lands (and stay static if it fails).
 */

type Catalog = {
	destinations: Destination[];
	universities: University[];
	programs: Program[];
	scholarships: Scholarship[];
};

const initial: Catalog = {
	destinations: staticDestinations,
	universities: staticUniversities,
	programs: staticPrograms,
	scholarships: staticScholarships,
};

let cache: Catalog | null = null;
let inflight: Promise<Catalog> | null = null;

async function fetchCatalog(): Promise<Catalog> {
	if (cache) return cache;
	inflight ??= (async () => {
		const [d, u, p, s] = await Promise.all([
			fetch(`${API_PREFIX}/catalog/destinations`).then((r) => (r.ok ? r.json() : null)),
			fetch(`${API_PREFIX}/catalog/universities`).then((r) => (r.ok ? r.json() : null)),
			fetch(`${API_PREFIX}/catalog/programs`).then((r) => (r.ok ? r.json() : null)),
			fetch(`${API_PREFIX}/catalog/scholarships`).then((r) => (r.ok ? r.json() : null)),
		]);
		// DB columns are nullable where the compiled rows weren't — normalize so
		// a catalog row never crashes a render that maps highlights or intake.
		const next: Catalog = {
			destinations: ((d?.destinations as Destination[] | undefined) ?? staticDestinations).map((x) => ({
				...x,
				tagline: x.tagline ?? "",
				description: x.description ?? "",
				highlights: x.highlights ?? [],
				universities: x.universities ?? 0,
				programs: x.programs ?? 0,
				image: x.image ?? "",
				flag: x.flag ?? "",
			})),
			universities: ((u?.universities as University[] | undefined) ?? staticUniversities).map((x) => ({
				...x,
				city: x.city ?? "",
				ranking: x.ranking ?? "",
				type: x.type ?? "",
				acceptance: x.acceptance ?? "",
				description: x.description ?? "",
				image: x.image ?? "",
				tags: x.tags ?? [],
			})),
			programs: ((p?.programs as Program[] | undefined) ?? staticPrograms).map((x) => ({
				...x,
				duration: x.duration ?? "",
				tuition: x.tuition ?? "",
				tuitionUsd: x.tuitionUsd ?? 0,
				intake: x.intake ?? [],
				description: x.description ?? "",
			})),
			scholarships: ((s?.scholarships as Scholarship[] | undefined) ?? staticScholarships)
				// isActive is an ops toggle; the compiled rows predate it and stay
				// visible.
				.filter((x) => (x as Scholarship & { isActive?: boolean | null }).isActive !== false)
				.map((x) => {
					// The catalog table stores only the summary fields. The seeded
					// rows share ids with the compiled copy, which still holds the
					// detail sections the schema has no columns for (apply steps,
					// benefits, FAQ); merge so a live row regains them. An
					// ops-created row with no static twin just renders what the
					// DB has.
					const base = staticScholarships.find((b) => b.id === x.id);
					return {
						...base,
						...x,
						type: x.type ?? "",
						amount: x.amount ?? "",
						deadline: x.deadline ?? "",
						eligibility: x.eligibility ?? "",
						image: x.image ?? "",
						description: x.description ?? "",
						amountUsd: x.amountUsd ?? base?.amountUsd ?? 0,
						amountQualifier: x.amountQualifier ?? base?.amountQualifier,
						amountNote: x.amountNote ?? base?.amountNote,
						criteria: x.criteria ?? base?.criteria ?? [],
						apply: x.apply ?? base?.apply ?? [],
						benefits: x.benefits ?? base?.benefits ?? [],
						faq: x.faq ?? base?.faq ?? [],
					};
				}),
		};
		cache = next;
		return next;
	})();
	try {
		return await inflight;
	} finally {
		inflight = null;
	}
}

export function useCatalog(): Catalog & { ready: boolean } {
	const [catalog, setCatalog] = useState<Catalog>(cache ?? initial);
	const [ready, setReady] = useState(Boolean(cache));
	useEffect(() => {
		let alive = true;
		void fetchCatalog()
			.then((c) => { if (alive) { setCatalog(c); setReady(true); } })
			.catch(() => { if (alive) setReady(true); /* static arrays stay */ });
		return () => { alive = false; };
	}, []);
	return { ...catalog, ready };
}
