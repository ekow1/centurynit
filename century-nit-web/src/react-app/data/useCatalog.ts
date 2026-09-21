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
			scholarships: ((s?.scholarships as Scholarship[] | undefined) ?? staticScholarships).map((x) => ({
				...x,
				type: x.type ?? "",
				deadline: x.deadline ?? "",
				eligibility: x.eligibility ?? "",
			})),
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
