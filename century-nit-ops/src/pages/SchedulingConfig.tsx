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

function updateDayPreview(day: SchedulingDay): SchedulingDay {
	return {
		...day,
		preview: day.enabled ? computeSlotTimes(day.openStart, day.openEnd, day.slotsPerDay) : [],
	};
}

export function SchedulingConfig() {
	const [days, setDays] = useState<SchedulingDay[]>([]);
	const [timezone, setTimezone] = useState<string>("Africa/Accra");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<SchedulingConfig>(`${API_PREFIX}/scheduling`);
			setTimezone(res.timezone);
			setDays(res.days.map((d) => ({ ...d })));
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

	function updateDay(dayOfWeek: number, patch: Partial<SchedulingDay>) {
		setDays((prev) =>
			prev.map((d) => (d.dayOfWeek === dayOfWeek ? updateDayPreview({ ...d, ...patch }) : d)),
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
			setDays(res.days.map((d) => ({ ...d })));
			setSuccess("Scheduling configuration saved. The portal will show the updated slot times.");
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not save scheduling configuration.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<h1 className="page-title">Scheduling Configuration</h1>
				<p className="lead mt-2">
					Set the branch-wide consultation slot template for each weekday. Disabled
					days have no slots. Times are calculated automatically and shown to applicants in
					the portal.
				</p>
			</div>

			<div
				className="card"
				style={{
					padding: "1rem 1.25rem",
					marginBottom: "1.5rem",
					borderLeft: "4px solid var(--primary)",
				}}
			>
				<p className="muted" style={{ margin: 0 }}>
					Only <strong>Manager, Systems, and Super Admin</strong> can edit this.
					Consultants control their own availability separately in{" "}
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

			<div className="card" style={{ padding: "1.5rem" }}>
				{loading ? (
					<p className="muted">Loading configuration…</p>
				) : (
					<form onSubmit={handleSubmit}>
						<div style={{ marginBottom: "1.25rem" }}>
							<label htmlFor="timezone" className="label">
								Timezone
							</label>
							<input
								id="timezone"
								type="text"
								value={timezone}
								onChange={(e) => setTimezone(e.target.value)}
								className="input input--full-border"
								style={{ maxWidth: "18rem" }}
								required
							/>
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.35rem" }}>
								IANA timezone used for slot labels. Example: Africa/Accra.
							</p>
						</div>

						<div
							style={{
								display: "grid",
								gap: "1rem",
								gridTemplateColumns: "repeat(auto-fill, minmax(18rem, 1fr))",
							}}
						>
							{previewDays.map((day) => (
								<div
									key={day.dayOfWeek}
									className="card"
									style={{
										padding: "1rem",
										opacity: day.enabled ? 1 : 0.6,
										borderLeft: day.enabled ? "3px solid var(--primary)" : "3px solid transparent",
									}}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											marginBottom: "0.75rem",
										}}
									>
										<h3
											className="section-title"
											style={{ fontSize: "1rem", margin: 0 }}
										>
											{DAY_NAMES[day.dayOfWeek]}
										</h3>
										<label
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.35rem",
												fontSize: "var(--text-sm)",
												cursor: "pointer",
											}}
										>
											<input
												type="checkbox"
												checked={day.enabled}
												onChange={(e) =>
													updateDay(day.dayOfWeek, { enabled: e.target.checked })
												}
											/>
											Active
										</label>
									</div>

									{day.enabled && (
										<>
											<div style={{ display: "grid", gap: "0.75rem" }}>
												<div>
													<label className="label" style={{ fontSize: "var(--text-sm)" }}>
														Slots
													</label>
													<input
														type="number"
														min={1}
														max={48}
														value={day.slotsPerDay}
														onChange={(e) =>
															updateDay(day.dayOfWeek, {
																slotsPerDay: Number.parseInt(e.target.value, 10) || 0,
															})
														}
														className="input input--full-border"
														style={{ width: "100%" }}
														required={day.enabled}
													/>
												</div>

												<div style={{ display: "flex", gap: "0.5rem" }}>
													<div style={{ flex: 1 }}>
														<label
															className="label"
															style={{ fontSize: "var(--text-sm)" }}
														>
															Open
														</label>
														<input
															type="time"
															value={day.openStart}
															onChange={(e) =>
																updateDay(day.dayOfWeek, { openStart: e.target.value })
															}
															className="input input--full-border"
															style={{ width: "100%" }}
															required={day.enabled}
														/>
													</div>
													<div style={{ flex: 1 }}>
														<label
															className="label"
															style={{ fontSize: "var(--text-sm)" }}
														>
															Close
														</label>
														<input
															type="time"
															value={day.openEnd}
															onChange={(e) =>
																updateDay(day.dayOfWeek, { openEnd: e.target.value })
															}
															className="input input--full-border"
															style={{ width: "100%" }}
															required={day.enabled}
														/>
													</div>
												</div>
											</div>

											{day.preview.length > 0 ? (
												<div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.75rem" }}>
													{day.preview.map((t) => (
														<span
															key={t}
															style={{
																padding: "0.25rem 0.5rem",
																background: "var(--surface)",
																borderRadius: "0.25rem",
																fontFamily: "var(--font-mono)",
																fontSize: "var(--text-xs)",
															}}
														>
															{t}
														</span>
													))}
												</div>
											) : (
												<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
													No valid slots for this range.
												</p>
											)}
										</>
									)}
								</div>
							))}
						</div>

						<div style={{ marginTop: "1.5rem" }}>
							<button type="submit" className="btn btn--primary" disabled={saving}>
								{saving ? "Saving…" : "Save weekly scheduling configuration"}
							</button>
						</div>
					</form>
				)}
			</div>
		</div>
	);
}
