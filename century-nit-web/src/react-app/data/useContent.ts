import { useEffect, useState } from "react";
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

/** media/… keys resolve through the public media redirect; anything else passes through. */
export function contentImage(value: unknown): string {
	if (typeof value !== "string" || !value) return "";
	return value.startsWith("media/") ? `${API_PREFIX}/media/${value}` : value;
}
