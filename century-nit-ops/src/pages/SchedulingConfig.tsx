import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Scheduling Configuration — per-weekday branch consultation slot setup.
 *
 * Each day has its own opening window (start/end) and slot interval. Monday
 * can be 09:00–17:00 every 60 minutes while Saturday is 10:00–14:00 every 90.
 * Only roles with the "scheduling" module reach this page.
 */

/** Monday first — the working week reads better than Sunday-first here. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface SchedulingDay {
	dayOfWeek: number;
	enabled: boolean;
	openStart: string;
	openEnd: string;
	intervalMinutes: number;
	preview: string[];
}

interface SchedulingConfig {
	timezone: string;
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

/** Slot start times from start to end at the given interval. */
function computeSlotTimes(
	openStart: string | undefined,
	openEnd: string | undefined,
	intervalMinutes: number | undefined,
): string[] {
	if (!openStart || !openEnd || !intervalMinutes || intervalMinutes <= 0) return [];
	const startMin = timeToMinutes(openStart);
	const endMin = timeToMinutes(openEnd);
	if (endMin <= startMin) return [];
	const times: string[] = [];
	for (let t = startMin; t < endMin; t += intervalMinutes) {
		times.push(minutesToTime(t));
	}
	return times;
}

function updateDayPreview(day: SchedulingDay): SchedulingDay {
	return {
		...day,
		preview: day.enabled ? computeSlotTimes(day.openStart, day.openEnd, day.intervalMinutes) : [],
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
			day.openStart === other.openStart &&
			day.openEnd === other.openEnd &&
			day.intervalMinutes === other.intervalMinutes
		);
	});
}

export function SchedulingConfig() {
	const [days, setDays] = useState<SchedulingDay[]>([]);
	const [saved, setSaved] = useState<SchedulingDay[]>([]);
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
			// Tolerate the legacy API shape (global openStart/openEnd + per-day
			// slotsPerDay) by lifting the global window onto any day missing its
			// own and converting slotsPerDay into an interval.
			const globalStart = res.openStart ?? "09:00";
			const globalEnd = res.openEnd ?? "17:00";
			const fresh: SchedulingDay[] = res.days.map((d) => {
				const openStart = d.openStart ?? globalStart;
				const openEnd = d.openEnd ?? globalEnd;
				let intervalMinutes = d.intervalMinutes;
				if (!intervalMinutes) {
					const total = timeToMinutes(openEnd) - timeToMinutes(openStart);
					const count = (d as { slotsPerDay?: number }).slotsPerDay ?? 1;
					intervalMinutes = total > 0 && count > 0 ? Math.max(5, Math.floor(total / count)) : 60;
				}
				return {
					dayOfWeek: d.dayOfWeek,
					enabled: d.enabled,
					openStart,
					openEnd,
					intervalMinutes,
					preview: d.preview ?? [],
				};
			});
			setTimezone(res.timezone);
			setSavedTimezone(res.timezone);
			setDays(fresh);
			setSaved(fresh.map((d) => ({ ...d })));
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
	const dirty = timezone !== savedTimezone || !sameSchedule(days, saved);
	const activeCount = days.filter((d) => d.enabled).length;
	const weeklySlots = days
		.filter((d) => d.enabled)
		.reduce((sum, d) => sum + computeSlotTimes(d.openStart, d.openEnd, d.intervalMinutes).length, 0);

	function updateDay(dayOfWeek: number, patch: Partial<SchedulingDay>) {
		setDays((prev) =>
			prev.map((d) => (d.dayOfWeek === dayOfWeek ? updateDayPreview({ ...d, ...patch }) : d)),
		);
		setSuccess(null);
	}

	/** Copy one day's window + interval onto every other active day. */
	function copyToAll(sourceDayOfWeek: number) {
		const source = days.find((d) => d.dayOfWeek === sourceDayOfWeek);
		if (!source) return;
		setDays((prev) =>
			prev.map((d) =>
				d.dayOfWeek === sourceDayOfWeek || !d.enabled
					? d
					: updateDayPreview({
							...d,
							openStart: source.openStart,
							openEnd: source.openEnd,
							intervalMinutes: source.intervalMinutes,
						}),
			),
		);
		setSuccess(null);
	}

	/** Enable exactly the given weekdays, leaving each day's own window intact. */
	function setActiveDays(active: number[]) {
		setDays((prev) => prev.map((d) => updateDayPreview({ ...d, enabled: active.includes(d.dayOfWeek) })));
		setSuccess(null);
	}

	function validate(): string | null {
		for (const day of days) {
			if (!day.enabled) continue;
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
				days: days.map((d) => ({
					dayOfWeek: d.dayOfWeek,
					enabled: d.enabled,
					openStart: d.openStart,
					openEnd: d.openEnd,
					intervalMinutes: d.intervalMinutes,
				})),
			};
			const res = await apiFetch<SchedulingConfig>(`${API_PREFIX}/scheduling`, {
				method: "PUT",
				body: JSON.stringify(body),
			});
			const fresh = res.days.map((d) => ({ ...d }));
			setDays(fresh);
			setSaved(fresh.map((d) => ({ ...d })));
			setSavedTimezone(res.timezone);
			setSuccess("Scheduling configuration saved. The portal will show the updated slot times.");
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not save scheduling configuration.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "1.25rem" }}>
				<h1 className="page-title">Scheduling Configuration</h1>
				<p className="lead mt-2">
					The branch-wide slot template. Each day has its own opening hours and slot
					interval — applicants can only book the times generated here.
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
								All slot times are shown in this timezone. Each day below sets its own
								opening window and interval.
							</p>
						</div>

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
							<button type="button" className="perm-quick-btn" onClick={() => copyToAll(1)}>
								Copy Monday to all open days
							</button>
							<button type="button" className="perm-quick-btn" onClick={() => setActiveDays([])}>
								Close all
							</button>
						</div>

						<table className="slotcfg-table">
							<thead>
								<tr>
									<th scope="col">Day</th>
									<th scope="col">Open</th>
									<th scope="col">Start</th>
									<th scope="col">End</th>
									<th scope="col">Every (min)</th>
									<th scope="col">Generated times</th>
								</tr>
							</thead>
							<tbody>
								{orderedDays.map((day) => {
									const slotCount = day.enabled ? computeSlotTimes(day.openStart, day.openEnd, day.intervalMinutes).length : 0;
									return (
										<tr
											key={day.dayOfWeek}
											className={day.enabled ? undefined : "slotcfg-row--off"}
										>
											<td className="slotcfg__day" data-col="day">
												{DAY_NAMES[day.dayOfWeek]}
											</td>
											<td data-col="open">
												<label className="perm-switch" title={`Toggle ${DAY_NAMES[day.dayOfWeek]}`}>
													<input
														type="checkbox"
														checked={day.enabled}
														aria-label={`${DAY_NAMES[day.dayOfWeek]} open for bookings`}
														onChange={(e) =>
															updateDay(day.dayOfWeek, { enabled: e.target.checked })
														}
													/>
													<span className="perm-switch__slider" />
												</label>
											</td>
											<td data-col="start">
												<input
													type="time"
													className="slotcfg__time"
													value={day.openStart}
													disabled={!day.enabled}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} opening time`}
													onChange={(e) =>
														updateDay(day.dayOfWeek, { openStart: e.target.value })
													}
													required
												/>
											</td>
											<td data-col="end">
												<input
													type="time"
													className="slotcfg__time"
													value={day.openEnd}
													disabled={!day.enabled}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} closing time`}
													onChange={(e) =>
														updateDay(day.dayOfWeek, { openEnd: e.target.value })
													}
													required
												/>
											</td>
											<td data-col="interval">
												<input
													type="number"
													min={5}
													max={480}
													step={5}
													className="slotcfg__num"
													value={day.intervalMinutes}
													disabled={!day.enabled}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} slot interval in minutes`}
													onChange={(e) =>
														updateDay(day.dayOfWeek, {
															intervalMinutes: Number.parseInt(e.target.value, 10) || 0,
														})
													}
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
															({slotCount} slots)
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
											setDays(saved.map((d) => ({ ...d })));
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
