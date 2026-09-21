import { useSearchParams } from "react-router-dom";

/**
 * One URL query param as state. The URL is the source of truth — read at
 * render, never copied into local state — so a deep link or a refresh always
 * shows what the address bar says, and two params written in the same tick
 * can't clobber each other: the setter merges into the *live* address bar,
 * not the params captured at render.
 *
 * That distinction is the whole hook. react-router's functional
 * `setSearchParams(prev => …)` hands back the params from the last render,
 * so `setDoc(id); setClient(key)` in one handler navigated twice from the
 * same stale base and the second write dropped the first — the Documents
 * page opened the folder and lost the file. `BrowserRouter` replaces the
 * history entry synchronously, so `window.location.search` already carries
 * the first write by the time the second reads it.
 *
 * `allowed` guards retired values: a stale `?filter=overdue` falls back
 * instead of silently emptying a list. Writing the fallback removes the
 * param so clean URLs stay clean.
 */
export function useUrlParam<T extends string = string>(
	key: string,
	{ allowed, fallback = "" as T }: { allowed?: readonly T[]; fallback?: T } = {},
): [T, (next: T | null) => void] {
	const [searchParams, setSearchParams] = useSearchParams();
	const raw = searchParams.get(key);
	const value = raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as T) : fallback;
	const set = (next: T | null) => {
		const p = new URLSearchParams(typeof window !== "undefined" ? window.location.search : searchParams);
		if (next === null || next === fallback) p.delete(key);
		else p.set(key, next);
		setSearchParams(p, { replace: true });
	};
	return [value, set];
}
