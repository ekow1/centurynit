import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Scheduling Configuration — per-weekday branch consultation slot setup.
 *
 * Only roles with the "scheduling" module (manager, system administrator, and
 * super_admin by default) reach this page. The slot times here are derived from
 * the configured opening hours and slots-per-day for each weekday; they are not
 * tied to any individual consultant's calendar.
 */

/** Monday first — the working week reads better than Sunday-first here. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface SchedulingDay {
	dayOfWeek: number;
	enabled: boolean;
	slotsPerDay: number;
	openStart: string;
	openEnd: string;
	preview: string[];
}

interface SchedulingConfig {
	timezone: string;
	days: SchedulingDay[];
}

function timeToMinutes(value: string): number {
	const [h, m] = value.split(":").map(Number);
	return h * 60 + m;
}

function computeSlotTimes(openStart: string, openEnd: string, count: number): string[] {
	const startMin = timeToMinutes(openStart);
	const endMin = timeToMinutes(openEnd);
	const total = endMin - startMin;
	if (total <= 0 || count <= 0) return [];
	const step = Math.floor(total / count);
	if (step <= 0) return [openStart];
	const times: string[] = [];
	for (let i = 0; i < count; i++) {
		const min = startMin + i * step;
		const h = Math.floor(min / 60).toString().padStart(2, "0");
		const m = (min % 60).toString().padStart(2, "0");
		times.push(`${h}:${m}`);
	}
	return times;
}

/** Minutes between consecutive slots — the number staff actually reason about. */
function slotInterval(day: SchedulingDay): number {
	const total = timeToMinutes(day.openEnd) - timeToMinutes(day.openStart);
	if (total <= 0 || day.slotsPerDay <= 0) return 0;
	return Math.floor(total / day.slotsPerDay);
}

function updateDayPreview(day: SchedulingDay): SchedulingDay {
	return {
		...day,
		preview: day.enabled ? computeSlotTimes(day.openStart, day.openEnd, day.slotsPerDay) : [],
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
			day.slotsPerDay === other.slotsPerDay &&
			day.openStart === other.openStart &&
			day.openEnd === other.openEnd
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
			const res = await apiFetch<SchedulingConfig>(`${API_PREFIX}/scheduling`);
			const fresh = res.days.map((d) => ({ ...d }));
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

	const previewDays = useMemo(() => days.map((d) => updateDayPreview(d)), [days]);
	const orderedDays = useMemo(
		() =>
			WEEK_ORDER.map((dow) => previewDays.find((d) => d.dayOfWeek === dow)).filter(
				(d): d is SchedulingDay => Boolean(d),
			),
		[previewDays],
	);
	const dirty = timezone !== savedTimezone || !sameSchedule(days, saved);
	const activeCount = days.filter((d) => d.enabled).length;
	const weeklyTotal = days.reduce((sum, d) => sum + (d.enabled ? d.slotsPerDay : 0), 0);

	function updateDay(dayOfWeek: number, patch: Partial<SchedulingDay>) {
		setDays((prev) =>
			prev.map((d) => (d.dayOfWeek === dayOfWeek ? updateDayPreview({ ...d, ...patch }) : d)),
		);
		setSuccess(null);
	}

	/** Copy one day's hours and slot count onto every other active day. */
	function copyToAll(sourceDayOfWeek: number) {
		const source = days.find((d) => d.dayOfWeek === sourceDayOfWeek);
		if (!source) return;
		setDays((prev) =>
			prev.map((d) =>
				d.dayOfWeek === sourceDayOfWeek || !d.enabled
					? d
					: updateDayPreview({
							...d,
							slotsPerDay: source.slotsPerDay,
							openStart: source.openStart,
							openEnd: source.openEnd,
						}),
			),
		);
		setSuccess(null);
	}

	/** Enable exactly the given weekdays, leaving each day's own hours intact. */
	function setActiveDays(active: number[]) {
		setDays((prev) =>
			prev.map((d) => updateDayPreview({ ...d, enabled: active.includes(d.dayOfWeek) })),
		);
		setSuccess(null);
	}

	function validate(): string | null {
		for (const day of days) {
			if (!day.enabled) continue;
			if (day.slotsPerDay < 1 || day.slotsPerDay > 48) {
				return `${DAY_NAMES[day.dayOfWeek]}: slots must be between 1 and 48.`;
			}
			if (timeToMinutes(day.openEnd) <= timeToMinutes(day.openStart)) {
				return `${DAY_NAMES[day.dayOfWeek]}: closing time must be after opening time.`;
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
					slotsPerDay: d.slotsPerDay,
					openStart: d.openStart,
					openEnd: d.openEnd,
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
					The branch-wide slot template. Applicants can only book the times generated
					here; consultants set their own working hours separately in{" "}
					<strong>My Availability</strong>.
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
							<button
								type="button"
								className="perm-quick-btn"
								onClick={() => copyToAll(1)}
							>
								Copy Monday to all
							</button>
							<button type="button" className="perm-quick-btn" onClick={() => setActiveDays([])}>
								Close all
							</button>

							<span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
								<label className="slotcfg__presets-label" htmlFor="timezone" style={{ margin: 0 }}>
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
							</span>
						</div>

						<table className="slotcfg-table">
							<thead>
								<tr>
									<th scope="col">Day</th>
									<th scope="col">Open</th>
									<th scope="col">Slots</th>
									<th scope="col">From</th>
									<th scope="col">To</th>
									<th scope="col">Every</th>
									<th scope="col">Generated times</th>
								</tr>
							</thead>
							<tbody>
								{orderedDays.map((day) => {
									const interval = slotInterval(day);
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
											<td data-col="slots">
												<input
													type="number"
													min={1}
													max={48}
													className="slotcfg__num"
													value={day.slotsPerDay}
													disabled={!day.enabled}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} slots per day`}
													onChange={(e) =>
														updateDay(day.dayOfWeek, {
															slotsPerDay: Number.parseInt(e.target.value, 10) || 0,
														})
													}
												/>
											</td>
											<td data-col="from">
												<input
													type="time"
													className="slotcfg__time"
													value={day.openStart}
													disabled={!day.enabled}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} opening time`}
													onChange={(e) => updateDay(day.dayOfWeek, { openStart: e.target.value })}
												/>
											</td>
											<td data-col="to">
												<input
													type="time"
													className="slotcfg__time"
													value={day.openEnd}
													disabled={!day.enabled}
													aria-label={`${DAY_NAMES[day.dayOfWeek]} closing time`}
													onChange={(e) => updateDay(day.dayOfWeek, { openEnd: e.target.value })}
												/>
											</td>
											<td data-col="every">
												<span className="slotcfg__interval">
													{day.enabled && interval > 0 ? `${interval} min` : "—"}
												</span>
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
													</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>

						<p className="ops-panel__muted" style={{ marginTop: "1rem" }}>
							{activeCount} open {activeCount === 1 ? "day" : "days"} · {weeklyTotal} bookable
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
