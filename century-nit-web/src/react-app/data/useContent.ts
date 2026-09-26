import { useEffect, useMemo, useState } from "react";
import { API_PREFIX, type CmsEntry } from "century-nit-shared";

/**
 * Published CMS entries for a collection, live from the API.
 *
 * Same contract as `useCatalog`: compiled content stays the initial value
 * so first paint is instant and identical, then published CMS rows swap
 * in when the fetch lands. `live` stays false when the collection is
 * empty or the fetch fails — an empty CMS never blanks a page.
 */
export function useContentEntries(collection: string): { entries: CmsEntry[]; live: boolean } {
	const [entries, setEntries] = useState<CmsEntry[] | null>(null);

	useEffect(() => {
		let active = true;
		fetch(`${API_PREFIX}/content/${collection}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				const rows = Array.isArray(d?.entries) ? (d.entries as CmsEntry[]) : [];
				if (active && rows.length) setEntries(rows);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [collection]);

	return { entries: entries ?? [], live: entries !== null };
}

/** One published entry by collection+slug — for detail routes like /blog/:slug. */
export function useContentEntry(collection: string, slug: string | undefined): {
	entry: CmsEntry | null;
	loaded: boolean;
} {
	const [state, setState] = useState<{ entry: CmsEntry | null; loaded: boolean }>({ entry: null, loaded: false });

	useEffect(() => {
		if (!slug) return;
		let active = true;
		setState({ entry: null, loaded: false });
		fetch(`${API_PREFIX}/content/${collection}/${slug}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => active && setState({ entry: (d?.entry as CmsEntry) ?? null, loaded: true }))
			.catch(() => active && setState({ entry: null, loaded: true }));
		return () => {
			active = false;
		};
	}, [collection, slug]);

	return state;
}

/**
 * Page-copy merge: the compiled fallback (PAGE_COPY / HOME_COPY from
 * century-nit-core) is the base; a published pages/{slug} entry overrides
 * per key. Keys absent from the entry keep the compiled value, so partial
 * payloads can't blank a page.
 */
export function usePageCopy<T extends Record<string, unknown>>(slug: string, fallback: T): T {
	const { entry } = useContentEntry("pages", slug);
	const payload = (entry?.payload ?? {}) as Record<string, unknown>;
	const merged = { ...fallback };
	for (const key of Object.keys(fallback) as (keyof T)[]) {
		const v = payload[key as string];
		if (v !== undefined && v !== null && v !== "") merged[key] = v as T[keyof T];
	}
	return merged;
}

/** media/… keys resolve through the public media redirect; anything else passes through. */
export function contentImage(value: unknown): string {
	if (typeof value !== "string" || !value) return "";
	return value.startsWith("media/") ? `${API_PREFIX}/media/${value}` : value;
}

/**
 * Video testimonials ("On camera") — published `films` entries merge over the
 * compiled set by slug; poster/video resolve media/… keys. Compiled list is
 * the fallback when the collection is empty or the fetch fails.
 */
export function useFilms<T extends { id: string }>(fallback: readonly T[]): T[] {
	const { entries, live } = useContentEntries("films");
	return useMemo(() => {
		if (!live || !entries.length) return [...fallback];
		const byId = new Map(fallback.map((f) => [f.id, f]));
		const merged = entries.map((e) => ({ ...(byId.get(e.slug) ?? {}), ...e.payload, id: e.slug }) as T);
		for (const v of merged) {
			const m = v as { poster?: unknown; videoUrl?: unknown };
			if (typeof m.poster === "string") m.poster = contentImage(m.poster);
			if (typeof m.videoUrl === "string") m.videoUrl = contentImage(m.videoUrl);
		}
		return merged;
	}, [entries, live, fallback]);
}
