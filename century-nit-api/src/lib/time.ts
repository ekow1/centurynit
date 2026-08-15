/**
 * Timezone conversion built on the platform's IANA database (§15).
 *
 * Offsets are never stored or added by hand. A stored "+00:00" is wrong twice a
 * year in any zone with DST, and Ghana's UTC+0 makes that class of bug invisible
 * in local testing and obvious to an applicant in London. Everything here goes
 * through `Intl`, which knows the actual rules for a given instant.
 *
 * Convention: instants are `Date` (UTC). Wall-clock values are (date, time,
 * zone) triples and only become instants through `zonedTimeToUtc`.
 */

type Parts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = cache.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hour12: false,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		cache.set(timeZone, f);
	}
	return f;
}

/** Wall-clock reading of `instant` in `timeZone`. */
export function partsInZone(instant: Date, timeZone: string): Parts {
	const map: Record<string, string> = {};
	for (const p of formatter(timeZone).formatToParts(instant)) {
		if (p.type !== "literal") map[p.type] = p.value;
	}
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
		// Some ICU builds render midnight as "24" under hour12:false.
		hour: Number(map.hour) % 24,
		minute: Number(map.minute),
		second: Number(map.second),
	};
}

/** Minutes `timeZone` is ahead of UTC at `instant`. */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
	const p = partsInZone(instant, timeZone);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return (asUtc - instant.getTime()) / 60_000;
}

/**
 * Turn a wall-clock time in `timeZone` into a UTC instant.
 *
 * Two passes: the first offset is looked up from an approximate instant, the
 * second re-checks it, which is what makes DST transitions come out right. On a
 * spring-forward gap the result normalises to the following valid instant, and
 * on a fall-back overlap it resolves to the first occurrence — the same choices
 * a scheduling system should make consistently rather than accidentally.
 */
export function zonedTimeToUtc(
	date: string,
	time: string,
	timeZone: string,
): Date {
	const [y, mo, d] = date.split("-").map(Number);
	const [h, mi] = time.split(":").map(Number);

	const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
	const firstOffset = zoneOffsetMinutes(timeZone, new Date(naive));
	let utc = naive - firstOffset * 60_000;

	const secondOffset = zoneOffsetMinutes(timeZone, new Date(utc));
	if (secondOffset !== firstOffset) {
		utc = naive - secondOffset * 60_000;
	}
	return new Date(utc);
}

/** `YYYY-MM-DD` for `instant` as seen in `timeZone`. */
export function dateKeyInZone(instant: Date, timeZone: string): string {
	const p = partsInZone(instant, timeZone);
	return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** `HH:MM` for `instant` as seen in `timeZone`. */
export function timeKeyInZone(instant: Date, timeZone: string): string {
	const p = partsInZone(instant, timeZone);
	return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** 0 = Sunday … 6 = Saturday, as seen in `timeZone`. */
export function dayOfWeekInZone(instant: Date, timeZone: string): number {
	const p = partsInZone(instant, timeZone);
	// Date.UTC on the zone's own wall clock gives the right weekday without
	// the local machine's zone leaking in.
	return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

export function minutesToTime(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeToMinutes(time: string): number {
	const [h, m] = time.split(":").map(Number);
	return h * 60 + m;
}

export function addMinutes(instant: Date, minutes: number): Date {
	return new Date(instant.getTime() + minutes * 60_000);
}

/** Half-open overlap: touching intervals do not conflict. */
export function overlaps(
	aStart: Date,
	aEnd: Date,
	bStart: Date,
	bEnd: Date,
): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/**
 * Render an instant for a human in a given zone, e.g.
 * "Thu 20 Aug 2026, 10:00 (GMT)". Used in emails, where the recipient's zone
 * differs from the server's and an unqualified time is a missed meeting.
 */
export function formatInZone(instant: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone,
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(instant);
}

/**
 * Validate an IANA zone before trusting client input.
 *
 * A plain `new Intl.DateTimeFormat({ timeZone })` check is not enough: current
 * ICU also accepts fixed offsets such as "+01:00" and "GMT+1". Those are exactly
 * what §15 rules out — an offset is correct only until the next DST transition,
 * after which every booking made under it is an hour wrong. Only named zones
 * carry the rules needed to stay right.
 */
const OFFSET_LIKE = /^(?:[+-]\d{1,2}(?::?\d{2})?|(?:GMT|UTC)[+-]\d{1,2}(?::?\d{2})?)$/i;

export function isValidTimeZone(timeZone: string): boolean {
	if (!timeZone || OFFSET_LIKE.test(timeZone.trim())) return false;
	try {
		// Node 18+/modern browsers expose the canonical list; prefer it when present.
		const supported = (
			Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
		).supportedValuesOf?.("timeZone");
		if (supported) {
			const needle = timeZone.toLowerCase();
			// UTC is canonical but omitted from the list in some runtimes.
			if (needle === "utc") return true;
			return supported.some((z) => z.toLowerCase() === needle);
		}
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}
