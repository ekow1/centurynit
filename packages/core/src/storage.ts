/**
 * Guarded localStorage writes.
 *
 * Every piece of application state currently lives in localStorage, which has a
 * ~5MB per-origin ceiling. An unguarded `setItem` that trips that ceiling throws
 * a QuotaExceededError, and because these writes happen inside React effects the
 * throw unmounts the tree — the whole app goes blank on what should be a saved
 * field. Safari in private mode throws on `setItem` unconditionally, which is
 * the same failure by a different route.
 *
 * These helpers make a failed write a logged no-op instead. Losing one autosave
 * is recoverable; losing the running application is not.
 */

let quotaWarned = false;

/**
 * Write to localStorage, swallowing quota and private-mode failures.
 * Returns whether the value was actually persisted.
 */
export function safeSetItem(key: string, value: string): boolean {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch (err) {
		// One warning per session — these fire from effects and would otherwise
		// spam the console on every keystroke.
		if (!quotaWarned) {
			quotaWarned = true;
			console.warn(
				`[century-nit] localStorage write failed for "${key}". State is kept in memory ` +
					`for this session but will not survive a reload.`,
				err,
			);
		}
		return false;
	}
}

/** JSON-serialise and write. Returns whether the value was persisted. */
export function safeSetJSON(key: string, value: unknown): boolean {
	try {
		return safeSetItem(key, JSON.stringify(value));
	} catch (err) {
		console.warn(`[century-nit] could not serialise state for "${key}".`, err);
		return false;
	}
}

/** Read and parse, returning `null` for missing or malformed values. */
export function safeGetJSON<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

/** Remove a key, ignoring storage failures. */
export function safeRemoveItem(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		/* nothing useful to do */
	}
}
