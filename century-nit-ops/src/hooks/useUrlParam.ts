import { useSearchParams } from "react-router-dom";

/**
 * One URL query param as state. The URL is the source of truth — read at
 * render, never copied into local state — so a deep link or a refresh always
 * shows what the address bar says, and two params written in the same tick
 * can't clobber each other (the setter merges into the live params).
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
		setSearchParams(
			(prev) => {
				const p = new URLSearchParams(prev);
				if (next === null || next === fallback) p.delete(key);
				else p.set(key, next);
				return p;
			},
			{ replace: true },
		);
	};
	return [value, set];
}
