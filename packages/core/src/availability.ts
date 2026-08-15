import { BRANCH_AVAILABILITY, BOOKING_STORAGE_KEY, branches } from "./content.js";

/**
 * Consultation slot availability.
 *
 * This used to be a hard-coded array of six rows in `content.ts`, commented
 * "simulates real availability like Calendly". Nothing ever wrote to it, so a
 * confirmed booking never marked its slot taken and two applicants could book
 * the same consultant at the same moment, indefinitely. The seeded dates were
 * absolute, so they also silently expired into the past and left every slot
 * looking free.
 *
 * Occupancy is now derived from what has actually been booked, read from both
 * halves of the product:
 *
 *   - `century-nit-ops-state` .consultations[]  — everything ops knows about
 *   - `century-nit-booking`                     — the portal applicant's own
 *
 * Reading the other app's storage key directly is the established pattern here
 * (`OpsDirectiveBridge` and `useSiteContent` both do it) and works because the
 * public app and the Operations Center are deliberately served from one origin.
 *
 * The appointment's `dateTime` field is a DISPLAY string ("Today, 10:00 AM"),
 * which is why a structured `slotBranchId` / `slotDate` / `slotTime` triple
 * exists alongside it. Never try to parse `dateTime` — that is what made a
 * conflict check impossible before.
 */

const OPS_STATE_KEY = "century-nit-ops-state";

/** `branch|YYYY-MM-DD|HH:MM` — the identity of one bookable slot. */
export type SlotKey = string;

export function slotKey(branchId: string, date: string, time: string): SlotKey {
	return `${branchId}|${date}|${time}`;
}

/**
 * Resolve whatever a record calls a branch to a canonical `branches` id.
 *
 * The two halves disagree: ops records store `"accra"`, the branch catalogue
 * calls it `"accra-hq"`. Matching on city is what bridges them. Everything that
 * compares slots must go through here, or two spellings of one branch look like
 * two different branches and the conflict check silently passes.
 */
export function resolveBranchId(label: string): string | null {
	if (!label) return null;
	const needle = label.trim().toLowerCase();
	const match =
		branches.find((b) => b.id === needle) ??
		branches.find((b) => b.name.toLowerCase() === needle) ??
		branches.find((b) => b.city.toLowerCase() === needle) ??
		branches.find((b) => b.name.toLowerCase().includes(needle));
	return match?.id ?? null;
}

/** Display string for a slot — "Fri 15 Aug 2026 · 10:00 AM". */
export function formatSlot(date: string, time: string): string {
	const [y, m, d] = date.split("-").map(Number);
	const [hh, mm] = time.split(":").map(Number);
	const dt = new Date(y, m - 1, d, hh, mm);
	const day = dt.toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	const clock = dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	return `${day} · ${clock}`;
}

/** A slot `dayOffset` days from today — used to seed demo data that never expires. */
export function slotFromToday(
	branchLabel: string,
	dayOffset: number,
	time: string,
): { slotBranchId: string; slotDate: string; slotTime: string; dateTime: string } {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() + dayOffset);
	const slotDate = toDateKey(d);
	return {
		slotBranchId: resolveBranchId(branchLabel) ?? branchLabel,
		slotDate,
		slotTime: time,
		dateTime: formatSlot(slotDate, time),
	};
}

/* ── Seeded occupancy ───────────────────────────────────────────────────────
 * Texture so a fresh demo does not show a completely empty calendar. Offsets
 * are relative to today on purpose: absolute dates are what let the previous
 * version rot into meaninglessness.
 */

const SEED_OFFSETS: { branchId: string; dayOffset: number; time: string }[] = [
	{ branchId: "accra-hq", dayOffset: 1, time: "09:00" },
	{ branchId: "accra-hq", dayOffset: 1, time: "10:00" },
	{ branchId: "accra-hq", dayOffset: 3, time: "14:00" },
	{ branchId: "kumasi", dayOffset: 2, time: "11:00" },
	{ branchId: "lagos", dayOffset: 4, time: "09:00" },
	{ branchId: "lagos", dayOffset: 4, time: "15:00" },
];

export function toDateKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function seededSlots(): Set<SlotKey> {
	const out = new Set<SlotKey>();
	for (const s of SEED_OFFSETS) {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() + s.dayOffset);
		out.add(slotKey(s.branchId, toDateKey(d), s.time));
	}
	return out;
}

/* ── Live occupancy ──────────────────────────────────────────────────────── */

function readJSON<T>(key: string): T | null {
	try {
		if (typeof localStorage === "undefined") return null;
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

type StoredConsultation = {
	slotBranchId?: string;
	slotDate?: string;
	slotTime?: string;
	status?: string;
};

type StoredBooking = {
	branchId?: string;
	date?: string;
	time?: string;
	confirmationId?: string | null;
	paymentStatus?: string;
};

/** A consultation that no longer occupies its slot. */
const RELEASED = new Set(["cancelled", "canceled", "no-show", "no show", "declined"]);

function liveSlots(): Set<SlotKey> {
	const out = new Set<SlotKey>();

	const ops = readJSON<{ consultations?: StoredConsultation[] }>(OPS_STATE_KEY);
	for (const c of ops?.consultations ?? []) {
		if (!c.slotBranchId || !c.slotDate || !c.slotTime) continue;
		if (c.status && RELEASED.has(c.status.toLowerCase())) continue;
		out.add(slotKey(c.slotBranchId, c.slotDate, c.slotTime));
	}

	// The portal applicant's own slot counts as taken as soon as they have paid
	// or been given a confirmation — before that it is just a draft selection.
	const booking = readJSON<StoredBooking>(BOOKING_STORAGE_KEY);
	if (booking?.branchId && booking.date && booking.time) {
		const committed = Boolean(booking.confirmationId) || booking.paymentStatus === "success";
		if (committed) out.add(slotKey(booking.branchId, booking.date, booking.time));
	}

	return out;
}

/** Every occupied slot: seeded texture plus everything actually booked. */
export function bookedSlots(): Set<SlotKey> {
	const all = seededSlots();
	for (const k of liveSlots()) all.add(k);
	return all;
}

/** Occupied times at one branch on one date — what a slot picker needs. */
export function bookedTimesOn(branchId: string, date: string): Set<string> {
	const prefix = `${branchId}|${date}|`;
	const times = new Set<string>();
	for (const key of bookedSlots()) {
		if (key.startsWith(prefix)) times.add(key.slice(prefix.length));
	}
	return times;
}

export function isSlotBooked(branchId: string, date: string, time: string): boolean {
	return bookedSlots().has(slotKey(branchId, date, time));
}

/* ── Calendar rules ──────────────────────────────────────────────────────── */

export function isBranchOpenOnDay(branchId: string, dayOfWeek: number): boolean {
	const days = BRANCH_AVAILABILITY[branchId];
	return days ? days.includes(dayOfWeek) : true;
}

export type BookableDay = {
	/** YYYY-MM-DD */
	date: string;
	/** "14 Aug" */
	label: string;
	/** "Thu" */
	weekday: string;
	disabled: boolean;
};

/**
 * The next `count` days a branch could host a session. Today is never offered —
 * same-day booking is too short notice, and it also sidesteps "is 09:00 still
 * available at 11am" entirely.
 */
export function upcomingDays(branchId: string | null, count = 21): BookableDay[] {
	const days: BookableDay[] = [];
	const cursor = new Date();
	cursor.setHours(0, 0, 0, 0);
	cursor.setDate(cursor.getDate() + 1);

	for (let i = 0; i < count; i++) {
		const dow = cursor.getDay();
		days.push({
			date: toDateKey(cursor),
			label: cursor.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
			weekday: cursor.toLocaleDateString(undefined, { weekday: "short" }),
			disabled: dow === 0 || (branchId ? !isBranchOpenOnDay(branchId, dow) : false),
		});
		cursor.setDate(cursor.getDate() + 1);
	}
	return days;
}

/** First and last selectable dates, for constraining `<input type="date">`. */
export function bookingDateRange(count = 21): { min: string; max: string } {
	const min = new Date();
	min.setHours(0, 0, 0, 0);
	min.setDate(min.getDate() + 1);
	const max = new Date(min);
	max.setDate(max.getDate() + count - 1);
	return { min: toDateKey(min), max: toDateKey(max) };
}
