import { useCallback, useEffect, useMemo, useState } from "react";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch, ApiError } from "../lib/api";

/**
 * Scheduling Configuration — branch consultation slot setup.
 *
 * Only roles with the "scheduling" module (manager, system administrator, and
 * super_admin by default) reach this page. The slot times here are derived from
 * the configured opening hours and slots-per-day; they are not tied to any
 * individual consultant's calendar.
 */

interface SchedulingConfig {
	slotsPerDay: number;
	openStart: string;
	openEnd: string;
	timezone: string;
	preview: string[];
}

function timeToMinutes(value: string): number {
	const [h, m] = value.split(":").map(Number);
	return h * 60 + m;
}

function formatPreview(start: string, end: string, count: number): string[] {
	const startMin = timeToMinutes(start);
	const endMin = timeToMinutes(end);
	const total = endMin - startMin;
	if (total <= 0 || count <= 0) return [];
	const step = Math.floor(total / count);
	if (step <= 0) return [start];
	const times: string[] = [];
	for (let i = 0; i < count; i++) {
		const min = startMin + i * step;
		const h = Math.floor(min / 60).toString().padStart(2, "0");
		const m = (min % 60).toString().padStart(2, "0");
		times.push(`${h}:${m}`);
	}
	return times;
}

export function SchedulingConfig() {
	const [config, setConfig] = useState<SchedulingConfig | null>(null);
	const [slots, setSlots] = useState<number>(8);
	const [start, setStart] = useState<string>("09:00");
	const [end, setEnd] = useState<string>("17:00");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiFetch<SchedulingConfig>(`${API_PREFIX}/scheduling`);
			setConfig(res);
			setSlots(res.slotsPerDay);
			setStart(res.openStart);
			setEnd(res.openEnd);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Could not load scheduling configuration.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const preview = useMemo(() => formatPreview(start, end, slots), [start, end, slots]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSuccess(null);

		if (timeToMinutes(end) <= timeToMinutes(start)) {
			setError("Closing time must be after opening time.");
			return;
		}
		if (slots < 1 || slots > 48) {
			setError("Slots per day must be between 1 and 48.");
			return;
		}

		setSaving(true);
		try {
			const res = await apiFetch<SchedulingConfig>(`${API_PREFIX}/scheduling`, {
				method: "PUT",
				body: JSON.stringify({ slotsPerDay: slots, openStart: start, openEnd: end }),
			});
			setConfig(res);
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
					Set the branch-wide consultation slot template. The times below are calculated
					automatically and shown to applicants in the portal.
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
						<div style={{ display: "grid", gap: "1.25rem", maxWidth: "28rem" }}>
							<div>
								<label htmlFor="slotsPerDay" className="label">
									Consultation slots per day
								</label>
								<input
									id="slotsPerDay"
									type="number"
									min={1}
									max={48}
									value={slots}
									onChange={(e) => setSlots(Number.parseInt(e.target.value, 10) || 0)}
									className="input input--full-border"
									style={{ maxWidth: "10rem" }}
									required
								/>
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.35rem" }}>
									How many appointment start times are offered across the branch's
									opening hours.
								</p>
							</div>

							<div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
								<div>
									<label htmlFor="openStart" className="label">
										Opening time
									</label>
									<input
										id="openStart"
										type="time"
										value={start}
										onChange={(e) => setStart(e.target.value)}
										className="input input--full-border"
										required
									/>
								</div>
								<div>
									<label htmlFor="openEnd" className="label">
										Closing time
									</label>
									<input
										id="openEnd"
										type="time"
										value={end}
										onChange={(e) => setEnd(e.target.value)}
										className="input input--full-border"
										required
									/>
								</div>
							</div>

							<div>
								<h3 className="section-title" style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
									Computed slot times
								</h3>
								{preview.length === 0 ? (
									<p className="muted">Invalid range or slot count.</p>
								) : (
									<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
										{preview.map((t) => (
											<span
												key={t}
												style={{
													padding: "0.35rem 0.7rem",
													border: "var(--medium)",
													fontFamily: "var(--font-mono)",
													fontSize: "var(--text-sm)",
												}}
											>
												{t}
											</span>
										))}
									</div>
								)}
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
									Timezone: {config?.timezone ?? "Africa/Accra"}. Each slot ends based on the
									consultation duration requested by the applicant.
								</p>
							</div>

							<div style={{ marginTop: "0.5rem" }}>
								<button
									type="submit"
									className="btn btn--primary"
									disabled={saving}
								>
									{saving ? "Saving…" : "Save scheduling configuration"}
								</button>
							</div>
						</div>
					</form>
				)}
			</div>
		</div>
	);
}
