import { useCallback, useEffect, useMemo, useState } from "react";
import {
	API_PREFIX,
	generateSlots,
	effectiveDayValues,
	validateScheduleConfig,
	timeToMinutes,
	type WeeklySlotScheduleGeneral,
	type WeeklySlotScheduleDay,
} from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";
import { Link } from "react-router-dom";
import { bookingsApi, calendarApi } from "century-nit-core/api";
import type { Booking } from "century-nit-shared";
import { branchName } from "century-nit-core/ops";

/**
 * Scheduling Configuration — general template + per-weekday custom overrides.
 *
 * The admin sets a **general** template (start, end, interval, max slots per
 * day) that applies to every day by default. A weekday can optionally override
 * the general template when its "Custom Schedule" toggle is ON. When OFF, the day
 * inherits the general settings. Stored custom values are preserved, but only
 * take effect while the toggle is ON.
 */

/** Monday first — the working week reads better than Sunday-first here. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type StaffHours = { opsUserId: string; name: string; email: string; branch: string | null; hours: { dayOfWeek: number; start: string; end: string; timezone: string }[] };
/** "Mon–Fri 09:00–17:00 · Sat 10:00–13:00" — a person's week in one breath. */
function hoursSummary(hours: StaffHours["hours"]): string {
	const byDay = new Map(hours.map((h) => [h.dayOfWeek, `${h.start}–${h.end}`]));
	const runs: string[] = [];
	let i = 0;
	while (i < WEEK_ORDER.length) {
		const dow = WEEK_ORDER[i];
		const win = byDay.get(dow);
		if (!win) {
			i++;
			continue;
		}
		let j = i;
		while (j + 1 < WEEK_ORDER.length && byDay.get(WEEK_ORDER[j + 1]) === win) j++;
		runs.push(`${DAY_SHORT[dow]}${j > i ? `–${DAY_SHORT[WEEK_ORDER[j]]}` : ""} ${win}`);
		i = j + 1;
	}
	return runs.join(" · ") || "no hours set";
}
const weeklyHours = (hours: StaffHours["hours"]) => Math.round(hours.reduce((n, h) => n + (timeToMinutes(h.end) - timeToMinutes(h.start)) / 60, 0));

type General = WeeklySlotScheduleGeneral;

type SchedulingDay = WeeklySlotScheduleDay & { preview: string[] };

interface SchedulingConfig {
	timezone: string;
	general: General;
	days: SchedulingDay[];
}

function updateDayPreview(day: SchedulingDay, general: General): SchedulingDay {
	const eff = effectiveDayValues(day, general);
	return { ...day, preview: generateSlots(eff.openStart, eff.openEnd, eff.intervalMinutes, eff.maxSlotsPerDay) };
}

/** Compare ignoring the derived preview, so only real edits mark the form dirty. */
function sameSchedule(a: SchedulingDay[], b: SchedulingDay[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((day, i) => {
		const other = b[i];
		return (
			day.dayOfWeek === other.dayOfWeek &&
			day.customEnabled === other.customEnabled &&
			day.openStart === other.openStart &&
			day.openEnd === other.openEnd &&
			day.intervalMinutes === other.intervalMinutes &&
			((day.maxSlotsPerDay ?? null) === (other.maxSlotsPerDay ?? null))
		);
	});
}

function sameGeneral(a: General, b: General): boolean {
	return (
		a.openStart === b.openStart &&
		a.openEnd === b.openEnd &&
		a.intervalMinutes === b.intervalMinutes &&
		((a.maxSlotsPerDay ?? null) === (b.maxSlotsPerDay ?? null))
	);
}

export function SchedulingConfig() {
	const [days, setDays] = useState<SchedulingDay[]>([]);
	const [savedDays, setSavedDays] = useState<SchedulingDay[]>([]);
	const [general, setGeneral] = useState<General>({
		openStart: "09:00",
		openEnd: "17:00",
		intervalMinutes: 60,
		maxSlotsPerDay: null,
	});
	const [savedGeneral, setSavedGeneral] = useState<General>(general);
	const [timezone, setTimezone] = useState<string>("Africa/Accra");
	const [savedTimezone, setSavedTimezone] = useState<string>("Africa/Accra");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [selectedDow, setSelectedDow] = useState<number | null>(null);
	const [staff, setStaff] = useState<StaffHours[]>([]);
	const [nextWeek, setNextWeek] = useState<Booking[]>([]);

	// Who can take the slots, and what is already booked next week — read once.
	useEffect(() => {
		calendarApi
			.staffWorkingHours()
			.then((res) => setStaff(res.staff))
			.catch(() => setStaff([]));
		bookingsApi
			.list()
			.then((res) => {
				const from = new Date();
				from.setHours(0, 0, 0, 0);
				const to = new Date(from.getTime() + 7 * 86_400_000);
				setNextWeek(res.bookings.filter((b) => b.status !== "CANCELLED" && new Date(b.startsAt) >= from && new Date(b.startsAt) < to));
			})
			.catch(() => setNextWeek([]));
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<SchedulingConfig & { openStart?: string; openEnd?: string }>(
				`${API_PREFIX}/scheduling`,
			);
			const g: General = {
				openStart: res.general?.openStart ?? res.openStart ?? "09:00",
				openEnd: res.general?.openEnd ?? res.openEnd ?? "17:00",
				intervalMinutes: res.general?.intervalMinutes ?? 60,
				maxSlotsPerDay: res.general?.maxSlotsPerDay ?? null,
			};
			const fresh: SchedulingDay[] = res.days.map((d) => {
				const openStart = d.openStart ?? g.openStart;
				const openEnd = d.openEnd ?? g.openEnd;
				let intervalMinutes = d.intervalMinutes;
				if (!intervalMinutes) {
					const total = timeToMinutes(openEnd) - timeToMinutes(openStart);
					const count = (d as { slotsPerDay?: number }).slotsPerDay ?? 1;
					intervalMinutes = total > 0 && count > 0 ? Math.max(5, Math.floor(total / count)) : 60;
				}
				const customEnabled =
					"customEnabled" in d
						? d.customEnabled
						: ((d as { override?: boolean }).override ?? false);
				return {
					dayOfWeek: d.dayOfWeek,
					customEnabled,
					openStart,
					openEnd,
					intervalMinutes,
					maxSlotsPerDay: d.maxSlotsPerDay ?? null,
					preview: [],
				};
			});
			const withPreviews = fresh.map((d) => updateDayPreview(d, g));
			setGeneral(g);
			setSavedGeneral(g);
			setTimezone(res.timezone);
			setSavedTimezone(res.timezone);
			setDays(withPreviews);
			setSavedDays(withPreviews.map((d) => ({ ...d })));
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not load scheduling configuration.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const orderedDays = useMemo(
		() =>
			WEEK_ORDER.map((dow) => days.find((d) => d.dayOfWeek === dow)).filter(
				(d): d is SchedulingDay => Boolean(d),
			),
		[days],
	);
	const dirty =
		timezone !== savedTimezone ||
		!sameGeneral(general, savedGeneral) ||
		!sameSchedule(days, savedDays);
	const customCount = days.filter((d) => d.customEnabled).length;
	const weeklySlots = days.reduce(
		(sum, d) =>
			sum +
			generateSlots(
				effectiveDayValues(d, general).openStart,
				effectiveDayValues(d, general).openEnd,
				effectiveDayValues(d, general).intervalMinutes,
				effectiveDayValues(d, general).maxSlotsPerDay,
			).length,
		0,
	);

	function updateGeneral(patch: Partial<General>) {
		setGeneral((prev) => {
			const next = { ...prev, ...patch };
			setDays((prevDays) => prevDays.map((d) => updateDayPreview(d, next)));
			return next;
		});
		setSuccess(null);
	}

	function resetAllDays() {
		setDays((prev) => prev.map((d) => updateDayPreview({ ...d, customEnabled: false }, general)));
		setSuccess(null);
	}

	function updateDay(dayOfWeek: number, patch: Partial<SchedulingDay>) {
		setDays((prev) =>
			prev.map((d) => (d.dayOfWeek === dayOfWeek ? updateDayPreview({ ...d, ...patch }, general) : d)),
		);
		setSuccess(null);
	}

	function validate(): string | null {
		const validationError = validateScheduleConfig(general, days);
		return validationError ? validationError.message : null;
	}

	async function handleSubmit(e?: { preventDefault?: () => void }) {
		e?.preventDefault?.();
		setError(null);
		setSuccess(null);

		const validationError = validate();
		if (validationError) {
			setError(validationError);
			return;
		}

		setSaving(true);
		try {
			const body = {
				timezone,
				general,
				days: days.map((d) => ({
					dayOfWeek: d.dayOfWeek,
					customEnabled: d.customEnabled,
					openStart: d.openStart,
					openEnd: d.openEnd,
					intervalMinutes: d.intervalMinutes,
					maxSlotsPerDay: d.maxSlotsPerDay,
				})),
			};
			const res = await apiFetch<SchedulingConfig>(`${API_PREFIX}/scheduling`, {
				method: "PUT",
				body: JSON.stringify(body),
			});
			const fresh = res.days.map((d) => ({ ...d }));
			setDays(fresh.map((d) => updateDayPreview(d, res.general)));
			setSavedDays(fresh.map((d) => ({ ...d })));
			setGeneral(res.general);
			setSavedGeneral(res.general);
			setSavedTimezone(res.timezone);
			setSuccess("Scheduling configuration saved. The portal will show the updated slot times.");
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not save scheduling configuration.");
		} finally {
			setSaving(false);
		}
	}

	/** Bookings next week by weekday and hour — the chips they fall on read as taken. */
	const bookedAt = useMemo(() => {
		const set = new Set<string>();
		for (const b of nextWeek) {
			const d = new Date(b.startsAt);
			set.add(`${d.getDay()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
		}
		return set;
	}, [nextWeek]);
	const selectedDay = selectedDow === null ? null : (orderedDays.find((d) => d.dayOfWeek === selectedDow) ?? null);
	const openDays = orderedDays.filter((d) => d.preview.length > 0);
	/** The general run of days, for the day line. */
	const generalRun = (() => {
		const run = orderedDays.filter((d) => !d.customEnabled && d.preview.length > 0).map((d) => DAY_SHORT[d.dayOfWeek]);
		return run.length === 0 ? null : run.length === 1 ? run[0] : `${run[0]}–${run[run.length - 1]}`;
	})();
	/** Slots only one person can take, or nobody — the day's exposure. */
	const coverage = (d: SchedulingDay): { covered: number; thin: number; none: number } => {
		const who = staff.map((p) => p.hours.find((h) => h.dayOfWeek === d.dayOfWeek)).filter((h): h is NonNullable<typeof h> => Boolean(h));
		let thin = 0;
		let none = 0;
		for (const slot of d.preview) {
			const m = timeToMinutes(slot);
			const n = who.filter((h) => timeToMinutes(h.start) <= m && m < timeToMinutes(h.end)).length;
			if (n === 0) none++;
			else if (n === 1) thin++;
		}
		return { covered: d.preview.length - thin - none, thin, none };
	};
	const exposure = orderedDays.map((d) => ({ d, ...coverage(d) })).filter((x) => x.none > 0 || x.thin > 0);

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Scheduling</h1>
					<p className="lead mt-2">The week the branch offers — the general hours, and the days that differ.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					{dirty && (
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => void load()} disabled={saving}>
							Discard
						</button>
					)}
					<button type="button" className="btn btn--primary btn--sm" disabled={!dirty || saving} onClick={() => void handleSubmit()}>
						{saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
					</button>
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				{generalRun && (
					<span>
						<strong>{generalRun}</strong> <span className="dash-day__date">{general.openStart} – {general.openEnd}</span>
					</span>
				)}
				<span>
					<strong>{general.intervalMinutes} min</strong> <span className="dash-day__date">interval</span>
				</span>
				<span>
					<strong>{weeklySlots}</strong> <span className="dash-day__date">slots a week</span>
				</span>
				{orderedDays
					.filter((d) => d.customEnabled)
					.map((d) => (
						<span key={d.dayOfWeek}>
							<strong>{DAY_SHORT[d.dayOfWeek]}</strong> <span className="dash-day__date">{d.preview.length === 0 ? "closed" : `${d.openStart} – ${d.openEnd}`}</span>
						</span>
					))}
				<span>
					<strong>{timezone}</strong>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<Link to="/my-calendar" className="dash-link">
					My Availability →
				</Link>
			</div>

			{error && (
				<p className="ops-modal__error" role="alert">
					{error}
				</p>
			)}
			{success && <p className="ops-panel__ok">{success}</p>}

			{loading ? (
				<p className="ops-panel__muted">Loading configuration…</p>
			) : (
				<>
					<div className="ops-gen">
						<label className="ops-fld">
							<span className="ops-fld__l">General · start</span>
							<input type="time" className="ops-fld__in" value={general.openStart} onChange={(e) => updateGeneral({ openStart: e.target.value })} />
						</label>
						<label className="ops-fld">
							<span className="ops-fld__l">End</span>
							<input type="time" className="ops-fld__in" value={general.openEnd} onChange={(e) => updateGeneral({ openEnd: e.target.value })} />
						</label>
						<label className="ops-fld">
							<span className="ops-fld__l">Every (min)</span>
							<input type="number" min={5} step={5} className="ops-fld__in" value={general.intervalMinutes} onChange={(e) => updateGeneral({ intervalMinutes: Number(e.target.value) || 60 })} />
						</label>
						<label className="ops-fld">
							<span className="ops-fld__l">Max slots a day</span>
							<input type="number" min={0} className="ops-fld__in" value={general.maxSlotsPerDay ?? ""} placeholder="no cap" onChange={(e) => updateGeneral({ maxSlotsPerDay: e.target.value === "" ? null : Number(e.target.value) })} />
						</label>
						<label className="ops-fld">
							<span className="ops-fld__l">Timezone</span>
							<input type="text" className="ops-fld__in" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
						</label>
					</div>

					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "1rem 0 0.5rem", gap: "0.75rem", flexWrap: "wrap" }}>
						<span className="eyebrow">The week · click a day to give it its own hours</span>
						<span className="cn-filter__label">
							▮ booked in the next 7 days
							{customCount > 0 && (
								<>
									{" · "}
									<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={resetAllDays}>
										use the general hours everywhere
									</button>
								</>
							)}
						</span>
					</div>
					<div className="ops-wk">
						{orderedDays.map((d) => {
							const eff = effectiveDayValues(d, general);
							const on = selectedDow === d.dayOfWeek;
							const closed = d.preview.length === 0;
							return (
								<button
									key={d.dayOfWeek}
									type="button"
									className={`ops-wkday${closed ? " ops-wkday--off" : ""}${d.customEnabled ? " ops-wkday--custom" : ""}${on ? " ops-wkday--on" : ""}`}
									onClick={() => setSelectedDow(on ? null : d.dayOfWeek)}
									aria-pressed={on}
								>
									<span className="ops-wkday__h">
										<span className="ops-wkday__n">{DAY_SHORT[d.dayOfWeek]}</span>
										<span className="ops-wkday__k">{closed ? "closed" : d.customEnabled ? "custom" : "general"}</span>
									</span>
									<span className="ops-wkday__hours">{closed ? "—" : `${eff.openStart} – ${eff.openEnd}`}</span>
									<span className="ops-wkday__k">{closed ? "" : `${d.preview.length} slot${d.preview.length === 1 ? "" : "s"}`}</span>
									<span className="ops-wkday__slots">
										{d.preview.map((t) => (
											<span key={t} className={bookedAt.has(`${d.dayOfWeek} ${t}`) ? "ops-wkday__slot ops-wkday__slot--busy" : "ops-wkday__slot"}>
												{t}
											</span>
										))}
									</span>
								</button>
							);
						})}
					</div>

					<div className="dash-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: "1rem" }}>
						<section className="dash-panel">
							{selectedDay ? (
								<>
									<header className="dash-panel__head">
										<h2 className="dash-panel__title">
											{DAY_NAMES[selectedDay.dayOfWeek]} · {selectedDay.customEnabled ? "custom hours" : "the general hours"}
										</h2>
										{selectedDay.customEnabled ? (
											<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => updateDay(selectedDay.dayOfWeek, { customEnabled: false })}>
												use the general hours
											</button>
										) : (
											<button type="button" className="dash-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => updateDay(selectedDay.dayOfWeek, { customEnabled: true, openStart: general.openStart, openEnd: general.openEnd, intervalMinutes: general.intervalMinutes, maxSlotsPerDay: general.maxSlotsPerDay })}>
												give it its own hours
											</button>
										)}
									</header>
									{selectedDay.customEnabled ? (
										<div className="ops-gen" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", border: "none", padding: 0 }}>
											<label className="ops-fld">
												<span className="ops-fld__l">Start</span>
												<input type="time" className="ops-fld__in" value={selectedDay.openStart} onChange={(e) => updateDay(selectedDay.dayOfWeek, { openStart: e.target.value })} />
											</label>
											<label className="ops-fld">
												<span className="ops-fld__l">End</span>
												<input type="time" className="ops-fld__in" value={selectedDay.openEnd} onChange={(e) => updateDay(selectedDay.dayOfWeek, { openEnd: e.target.value })} />
											</label>
											<label className="ops-fld">
												<span className="ops-fld__l">Every (min)</span>
												<input type="number" min={5} step={5} className="ops-fld__in" value={selectedDay.intervalMinutes} onChange={(e) => updateDay(selectedDay.dayOfWeek, { intervalMinutes: Number(e.target.value) || 60 })} />
											</label>
											<label className="ops-fld">
												<span className="ops-fld__l">Max slots</span>
												<input type="number" min={0} className="ops-fld__in" value={selectedDay.maxSlotsPerDay ?? ""} placeholder="no cap" onChange={(e) => updateDay(selectedDay.dayOfWeek, { maxSlotsPerDay: e.target.value === "" ? null : Number(e.target.value) })} />
											</label>
										</div>
									) : (
										<p className="dash-empty">
											{DAY_NAMES[selectedDay.dayOfWeek]} follows the general hours — {general.openStart} to {general.openEnd}, every {general.intervalMinutes} minutes.
										</p>
									)}
									<p className="cn-detailhead__meta">{selectedDay.preview.length === 0 ? "No slots — the day reads as closed." : `Slots: ${selectedDay.preview.join(" · ")}`}</p>
								</>
							) : (
								<>
									<header className="dash-panel__head">
										<h2 className="dash-panel__title">A day's own hours</h2>
									</header>
									<p className="dash-empty">
										Pick a day above. {customCount === 0 ? "Every day follows the general hours." : `${customCount} day${customCount === 1 ? " has" : "s have"} their own.`}
									</p>
								</>
							)}
						</section>

						<section className="dash-panel">
							<header className="dash-panel__head">
								<h2 className="dash-panel__title">Who can take these slots</h2>
								<Link to="/users" className="dash-link">
									Staff →
								</Link>
							</header>
							{staff.length === 0 ? (
								<p className="dash-empty">No staff have set their hours yet — each person sets theirs under My Availability.</p>
							) : (
								<div className="cn-detail__rows">
									{staff.map((p) => (
										<div key={p.opsUserId} className="cn-detail__row">
											<span>
												{p.name}
												{p.branch ? <span className="cn-detail__row-note"> {branchName(p.branch) || p.branch}</span> : null}
											</span>
											<span className="cn-detail__row-note">
												{hoursSummary(p.hours)} · {weeklyHours(p.hours)} h
											</span>
										</div>
									))}
									{exposure.map(({ d, thin, none }) => (
										<div key={d.dayOfWeek} className="cn-detail__row">
											<span>
												{DAY_NAMES[d.dayOfWeek]}
												{none > 0 ? ` · ${none} slot${none === 1 ? "" : "s"} nobody can take` : ""}
												{thin > 0 ? `${none > 0 ? " ·" : " ·"} ${thin} covered by one person` : ""}
											</span>
											<span className="cn-detail__row-note">
												<strong>{none > 0 ? "exposed" : "thin"}</strong>
											</span>
										</div>
									))}
									{exposure.length === 0 && openDays.length > 0 && (
										<div className="cn-detail__row">
											<span>Every offered slot has at least two people who can take it.</span>
											<span className="cn-detail__row-note">covered</span>
										</div>
									)}
								</div>
							)}
						</section>
					</div>
				</>
			)}
		</div>
	);

}
