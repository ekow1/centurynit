import { useEffect, useState } from "react";

/**
 * A ticking clock for render — `Date.now()` is impure, so "how long ago" /
 * "elapsed" UI can't call it mid-render. The value starts correct (the
 * initializer runs once) and re-ticks on the interval.
 */
export function useNow(intervalMs = 15_000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return now;
}
