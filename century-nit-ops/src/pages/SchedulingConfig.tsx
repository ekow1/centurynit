import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Scheduling Configuration — general template + per-weekday overrides.
 *
 * The admin sets a **general** template (start, end, interval, max slots per
 * day) that applies to every open day by default. Each weekday has two
 * toggles:
 *
 *   - **Open** — whether the day is open for bookings at all.
 *   - **Custom** — when ON, the day uses its own start/end/interval/maxSlots
 *     instead of inheriting the general template.
 *
 * `maxSlotsPerDay` caps the generated slot count. 0 or empty = no cap.
 */

/** Monday first — the working week reads better than Sunday-first here. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface General {
	openStart: string;
	openEnd: string;
	intervalMinutes: number;
	maxSlotsPerDay: number | null;
}

interface SchedulingDay {
	dayOfWeek: number;
	enabled: boolean;
	override: boolean;
	openStart: string;
	openEnd: string;
	intervalMinutes: number;
	maxSlotsPerDay: number | null;
	preview: string[];
}

interface SchedulingConfig {
	timezone: string;
	general: General;
	days: SchedulingDay[];
}

function timeToMinutes(value: string | undefined | null): number {
	if (!value || typeof value !== "string") return 0;
	const [h, m] = value.split(":").map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
	return h * 60 + m;
}

function minutesToTime(min: number): string {
	const h = Math.floor(min / 60).toString().padStart(2, "0");
	const m = (min % 60).toString().padStart(2, "0");
	return `${h}:${m}`;
}

/** Slot start times from start to end at the given interval, capped by maxSlots. */
function computeSlotTimes(
	openStart: string | undefined,
	openEnd: string | undefined,
	intervalMinutes: number | undefined,
	maxSlotsPerDay: number | null | undefined,
): string[] {
	if (!openStart || !openEnd || !intervalMinutes || intervalMinutes <= 0) return [];
	const startMin = timeToMinutes(openStart);
	const endMin = timeToMinutes(openEnd);
	if (endMin <= startMin) return [];
	const times: string[] = [];
	for (let t = startMin; t < endMin; t += intervalMinutes) {
		times.push(minutesToTime(t));
		if (maxSlotsPerDay && maxSlotsPerDay > 0 && times.length >= maxSlotsPerDay) break;
	}
	return times;
}

/** Resolve the effective values for a day — its own if override, else general. */
function effectiveDay(day: SchedulingDay, general: General) {
	if (day.override) {
		return {
			openStart: day.openStart,
			openEnd: day.openEnd,
			intervalMinutes: day.intervalMinutes,
			maxSlotsPerDay: day.maxSlotsPerDay,
		};
	}
	return {
		openStart: general.openStart,
		openEnd: general.openEnd,
		intervalMinutes: general.intervalMinutes,
		maxSlotsPerDay: general.maxSlotsPerDay,
	};
}

function updateDayPreview(day: SchedulingDay, general: General): SchedulingDay {
	const eff = effectiveDay(day, general);
	return {
		...day,
		preview: day.enabled ? computeSlotTimes(eff.openStart, eff.openEnd, eff.intervalMinutes, eff.maxSlotsPerDay) : [],
	};
}

/** Compare ignoring the derived preview, so only real edits mark the form dirty. */
function sameSchedule(a: SchedulingDay[], b: SchedulingDay[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((day, i) => {
		const other = b[i];
		return (
			day.dayOfWeek === other.dayOfWeek &&
			day.enabled === other.enabled &&
			day.override === other.override &&
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

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<SchedulingConfig & { openStart?: string; openEnd?: string }>(`${API_PREFIX}/scheduling`);
			// Tolerate legacy API shapes (no general, no override, no maxSlots).
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
				return {
					dayOfWeek: d.dayOfWeek,
					enabled: d.enabled,
					override: d.override ?? true, // legacy per-day hours preserved
					openStart,
					openEnd,
					intervalMinutes,
					maxSlotsPerDay: d.maxSlotsPerDay ?? null,
					preview: d.preview ?? [],
				};
			});
			setGeneral(g);
			setSavedGeneral(g);
			setTimezone(res.timezone);
			setSavedTimezone(res.timezone);
			setDays(fresh.map((d) => updateDayPreview(d, g)));
			setSavedDays(fresh.map((d) => ({ ...d })));
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
	const activeCount = days.filter((d) => d.enabled).length;
	const weeklySlots = days
		.filter((d) => d.enabled)
		.reduce(
			(sum, d) =>
				sum +
				computeSlotTimes(
					effectiveDay(d, general).openStart,
					effectiveDay(d, general).openEnd,
					effectiveDay(d, general).intervalMinutes,
					effectiveDay(d, general).maxSlotsPerDay,
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

	function updateDay(dayOfWeek: number, patch: Partial<SchedulingDay>) {
		setDays((prev) =>
			prev.map((d) => (d.dayOfWeek === dayOfWeek ? updateDayPreview({ ...d, ...patch }, general) : d)),
		);
		setSuccess(null);
	}

	/** Enable/override exactly the given weekdays. A single per-day toggle now
	 * controls both "open" and "custom": ON = open with this day's custom
	 * values, OFF = closed / no custom override. */
	function setActiveDays(active: number[]) {
		setDays((prev) =>
			prev.map((d) =>
				updateDayPreview(
					{ ...d, enabled: active.includes(d.dayOfWeek), override: active.includes(d.dayOfWeek) },
					general,
				),
			),
		);
		setSuccess(null);
	}

	function validate(): string | null {
		if (timeToMinutes(general.openEnd) <= timeToMinutes(general.openStart)) {
			return "General: closing time must be after opening time.";
		}
		if (general.intervalMinutes < 5 || general.intervalMinutes > 480) {
			return "General: interval must be between 5 and 480 minutes.";
		}
		for (const day of days) {
			if (!day.enabled || !day.override) continue;
			if (timeToMinutes(day.openEnd) <= timeToMinutes(day.openStart)) {
				return `${DAY_NAMES[day.dayOfWeek]}: closing time must be after opening time.`;
			}
			if (day.intervalMinutes < 5 || day.intervalMinutes > 480) {
				return `${DAY_NAMES[day.dayOfWeek]}: interval must be between 5 and 480 minutes.`;
			}
		}
		return null;
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
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
					enabled: d.enabled,
					override: d.override,
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

	const generalPreview = computeSlotTimes(general.openStart, general.openEnd, general.intervalMinutes, general.maxSlotsPerDay);

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "1.25rem" }}>
				<h1 className="page-title">Scheduling Configuration</h1>
				<p className="lead mt-2">
					Set general opening hours, interval and max slots per day — then override
					individual days only when they need different hours.
				</p>
			</div>

			{error && (
				<div className="ops-modal__error" style={{ marginBottom: "1.5rem" }}>
					{error}
				</div>
			)}
			{success && (
				<div
					className="ops-modal__success"
					style={{ marginBottom: "1.5rem", padding: "0.75rem 1rem", border: "var(--medium)" }}
				>
					{success}
				</div>
			)}

			<div className="ops-panel">
				{loading ? (
					<p className="ops-panel__muted">Loading configuration…</p>
				) : (
					<form onSubmit={handleSubmit}>
						<div className="slotcfg__branch-hours">
							<div className="slotcfg__branch-hours-field">
								<label className="slotcfg__presets-label" htmlFor="timezone">
									Timezone
								</label>
								<input
									id="timezone"
									type="text"
									value={timezone}
									onChange={(e) => {
										setTimezone(e.target.value);
										setSuccess(null);
									}}
									className="slotcfg__time"
									style={{ width: "11rem" }}
									required
								/>
							</div>
							<p className="ops-panel__muted" style={{ margin: 0 }}>
								All slot times are shown in this timezone.
							</p>
						</div>

						{/* ── General template ─────────────────────────────────────── */}
						<div className="slotcfg__presets" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
							<span className="slotcfg__presets-label" style={{ margin: 0 }}>
								General — default values when a day is enabled
							</span>
							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(7.5rem, 1fr))", gap: "0.5rem" }}>
								<label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
									<span className="ops-panel__muted" style={{ fontSize: "var(--text-xs)" }}>Start</span>
									<input
										type="time"
										className="slotcfg__time"
										value={general.openStart}
										onChange={(e) => updateGeneral({ openStart: e.target.value })}
										required
									/>
								</label>
								<label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
									<span className="ops-panel__muted" style={{ fontSize: "var(--text-xs)" }}>End</span>
									<input
										type="time"
										className="slotcfg__time"
										value={general.openEnd}
										onChange={(e) => updateGeneral({ openEnd: e.target.value })}
										required
									/>
								</label>
								<label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
									<span className="ops-panel__muted" style={{ fontSize: "var(--text-xs)" }}>Every (min)</span>
									<input
										type="number"
										min={5}
										max={480}
										step={5}
										className="slotcfg__num"
										value={general.intervalMinutes}
										onChange={(e) =>
											updateGeneral({ intervalMinutes: Number.parseInt(e.target.value, 10) || 0 })
										}
										required
									/>
								</label>
								<label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
									<span className="ops-panel__muted" style={{ fontSize: "var(--text-xs)" }}>Max slots/day (0 = no cap)</span>
									<input
										type="number"
										min={0}
										max={48}
										step={1}
										className="slotcfg__num"
										value={general.maxSlotsPerDay ?? 0}
										onChange={(e) => {
											const n = Number.parseInt(e.target.value, 10);
											updateGeneral({ maxSlotsPerDay: !n || n <= 0 ? null : n });
										}}
									/>
								</label>
							</div>
							<p className="ops-panel__muted" style={{ margin: 0, fontSize: "var(--text-xs)" }}>
								Preview: {generalPreview.length} slots/day · {generalPreview.join(", ") || "—"}
							</p>
						</div>

						{/* ── Quick set ────────────────────────────────────────────── */}
						<div className="slotcfg__presets">
							<span className="slotcfg__presets-label">Quick set</span>
							<button
								type="button"
								className="perm-quick-btn"
								onClick={() => setActiveDays([1, 2, 3, 4, 5])}
							>
								Weekdays only
							</button>
							<button
								type="button"
								className="perm-quick-btn"
								onClick={() => setActiveDays([1, 2, 3, 4, 5, 6])}
							>
								Include Saturday
							</button>
							<button type="button" className="perm-quick-btn" onClick={() => setActiveDays([])}>
								Close all
							</button>
						</div>

						{/* ── Per-day table ────────────────────────────────────────── */}
						<table className="slotcfg-table">
							<thead>
								<tr>
									<th scope="col">Day</th>
									<th scope="col">Custom</th>
									<th scope="col">Start</th>
									<th scope="col">End</th>
									<th scope="col">Every (min)</th>
									<th scope="col">Max slots</th>
									<th scope="col">Generated times</th>
								</tr>
							</thead>
							<tbody>
								{orderedDays.map((day) => {
									const eff = effectiveDay(day, general);
									const slotCount = day.enabled
										? computeSlotTimes(eff.openStart, eff.openEnd, eff.intervalMinutes, eff.maxSlotsPerDay).length
										: 0;
									return (
										<tr
											key={day.dayOfWeek}
											className={day.enabled ? undefined : "slotcfg-row--off"}
										>
											<td className="slotcfg__day" data-col="day">
												{DAY_NAMES[day.dayOfWeek]}
											</td>
											<td data-col="override">
												<label className="perm-switch" title={`${DAY_NAMES[day.dayOfWeek]} hours`}>
													<input
														type="checkbox"
														checked={day.override}
														aria-label={`${DAY_NAMES[day.dayOfWeek]} custom hours`}
														onChange={(e) => {
															const on = e.target.checked;
															updateDay(day.dayOfWeek, { enabled: on, override: on });
														}}
													/>
													<span className="perm-switch__slider" />
												</label>
											</td>
											<td data-col="start">
												<input
													type="time"
													className="slotcfg__time"
													value={day.override ? day.openStart : general.openStart}
													disabled={!day.enabled || !day.override}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} opening time`}
													onChange={(e) =>
														updateDay(day.dayOfWeek, { openStart: e.target.value })
													}
													required={day.override}
													style={{ width: "6rem" }}
												/>
											</td>
											<td data-col="end">
												<input
													type="time"
													className="slotcfg__time"
													value={day.override ? day.openEnd : general.openEnd}
													disabled={!day.enabled || !day.override}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} closing time`}
													onChange={(e) =>
														updateDay(day.dayOfWeek, { openEnd: e.target.value })
													}
													required={day.override}
													style={{ width: "6rem" }}
												/>
											</td>
											<td data-col="interval">
												<input
													type="number"
													min={5}
													max={480}
													step={5}
													className="slotcfg__num"
													value={day.override ? day.intervalMinutes : general.intervalMinutes}
													disabled={!day.enabled || !day.override}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} slot interval in minutes`}
													onChange={(e) =>
														updateDay(day.dayOfWeek, {
															intervalMinutes: Number.parseInt(e.target.value, 10) || 0,
														})
													}
												/>
											</td>
											<td data-col="max">
												<input
													type="number"
													min={0}
													max={48}
													step={1}
													className="slotcfg__num"
													value={(day.override ? day.maxSlotsPerDay : general.maxSlotsPerDay) ?? 0}
													disabled={!day.enabled || !day.override}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} max slots`}
													onChange={(e) => {
														const n = Number.parseInt(e.target.value, 10);
														updateDay(day.dayOfWeek, { maxSlotsPerDay: !n || n <= 0 ? null : n });
													}}
												/>
											</td>
											<td data-col="times">
												{!day.enabled ? (
													<span className="slotcfg__closed">Closed — no bookings offered</span>
												) : day.preview.length === 0 ? (
													<span className="slotcfg__closed">Closing time must be after opening time</span>
												) : (
													<span className="slotcfg__times">
														{day.preview.map((t) => (
															<span key={t} className="slotcfg__chip">
																{t}
															</span>
														))}
														<span className="muted" style={{ fontSize: "0.75rem", marginLeft: "0.4rem" }}>
															({slotCount} slots{day.override ? "" : " · general"})
														</span>
													</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>

						<p className="ops-panel__muted" style={{ marginTop: "1rem" }}>
							{activeCount} open {activeCount === 1 ? "day" : "days"} · {weeklySlots} bookable
							slots per week · times shown in {timezone}
						</p>

						{dirty && (
							<div className="slotcfg__savebar">
								<p className="slotcfg__savebar-note">
									You have unsaved changes to the branch slot template.
								</p>
								<span className="cal-actions">
									<button
										type="button"
										className="btn btn--ghost btn--sm"
										disabled={saving}
										onClick={() => {
											setDays(savedDays.map((d) => ({ ...d })));
											setGeneral(savedGeneral);
											setTimezone(savedTimezone);
											setError(null);
										}}
									>
										Discard
									</button>
									<button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
										{saving ? "Saving…" : "Save changes"}
									</button>
								</span>
							</div>
						)}
					</form>
				)}
			</div>
		</div>
	);
}
