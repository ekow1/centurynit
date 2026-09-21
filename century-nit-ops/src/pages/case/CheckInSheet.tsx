import { useEffect, useMemo, useState } from "react";
import { Sheet } from "century-nit-core/ui";
import { applicationsApi, bookingsApi } from "century-nit-core/api";
import { OPS_BRANCHES } from "century-nit-core/ops";
import { CHECK_IN_PURPOSES } from "century-nit-shared";
import type { MockApplication } from "century-nit-core/ops";
import { useCases } from "../../hooks/useCases";
import { useOpsAuth } from "../OpsAuthContext";

function fmtDay(iso: string): string {
	return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * "Schedule check-in…" — a meeting on the live case. Online opens the
 * built-in call room (LiveKit) unless the handler pastes a link — Zoom,
 * Teams, Meet — which becomes the room instead. In person carries the
 * branch. The client is emailed, reminded, and the booking lands on their
 * Appointments page — none of it is a paid consultation. The slot picker
 * reads the same availability engine the consultation flow uses.
 */
export function CheckInSheet({
	app,
	open,
	onClose,
	onDone,
}: {
	app: MockApplication;
	open: boolean;
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	const { opsUser } = useOpsAuth();
	const { assignees } = useCases();

	const [purpose, setPurpose] = useState<string>(CHECK_IN_PURPOSES[0]);
	const [type, setType] = useState<"online" | "in_person">("online");
	const [branchId, setBranchId] = useState(app.branch || OPS_BRANCHES[0]?.id || "");
	const [duration, setDuration] = useState(45);
	const [hostId, setHostId] = useState(opsUser?.opsUserId ?? "");
	const [note, setNote] = useState("");
	const [meetingUrl, setMeetingUrl] = useState("");
	const [date, setDate] = useState<string | null>(null);
	const [time, setTime] = useState<string | null>(null);

	const [days, setDays] = useState<{ date: string; open: number }[] | null>(null);
	const [slots, setSlots] = useState<{ time: string; available: boolean }[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Days with anything open light up; closed days never take a click.
	useEffect(() => {
		if (!open || !branchId) return;
		setDays(null);
		bookingsApi
			.availabilityDays({ branchId, from: today(), days: 14, durationMinutes: duration })
			.then((r) => setDays(r.days))
			.catch(() => setDays([]));
	}, [open, branchId, duration]);

	// Slots for the picked day, against the chosen host's calendar.
	useEffect(() => {
		if (!open || !date || !branchId) return;
		setSlots(null);
		setTime(null);
		bookingsApi
			.availability({ branchId, date, durationMinutes: duration, ...(hostId ? { employeeId: hostId } : {}) })
			.then((r) => setSlots(r.slots))
			.catch(() => setSlots([]));
	}, [open, branchId, date, duration, hostId]);

	const hosts = useMemo(() => assignees.filter((a) => a.opsUserId), [assignees]);

	async function submit() {
		if (!date || !time) return;
		setBusy(true);
		setError(null);
		try {
			await applicationsApi.createMeeting(app.id, {
				purpose,
				branchId,
				type,
				date,
				time,
				durationMinutes: duration,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				notes: note.trim() || undefined,
				employeeId: hostId || undefined,
				meetingUrl: type === "online" && meetingUrl.trim() ? meetingUrl.trim() : undefined,
			});
			onDone(`Check-in booked — ${purpose} · ${fmtDay(date)} ${time}. The client has been emailed.`);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not book the check-in");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onClose={onClose} title={`Check-in · ${app.applicantName}`} size="tall">
			<p className="hsheet__hint" style={{ marginBottom: "0.9rem" }}>
				Free for the client — part of the plan. They are emailed, reminded, and it sits on their portal.
			</p>
			{error && <p className="cn-assign__error" role="alert">{error}</p>}

			<p className="hsheet__eyebrow">Purpose</p>
			<select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
				{CHECK_IN_PURPOSES.map((p) => (
					<option key={p} value={p}>{p}</option>
				))}
			</select>

			<p className="hsheet__eyebrow" style={{ marginTop: "1rem" }}>How</p>
			<div className="hsheet__list">
				<div
					role="radio" aria-checked={type === "online"}
					className={`hsheet__row hsheet__row--stack${type === "online" ? " hsheet__row--on" : ""}`}
					onClick={() => setType("online")}
				>
					<span>Online</span>
					<span className="hsheet__hint">Built-in call room — or paste a Zoom/Teams/Meet link to use that instead</span>
				</div>
				<div
					role="radio" aria-checked={type === "in_person"}
					className={`hsheet__row hsheet__row--stack${type === "in_person" ? " hsheet__row--on" : ""}`}
					onClick={() => setType("in_person")}
				>
					<span>In person</span>
					<span className="hsheet__hint">At a branch — the email carries the address</span>
				</div>
			</div>

			<div className="mt-3" style={{ display: "grid", gap: "0.75rem" }}>
				<label className="cn-filter">
					<span className="cn-filter__label">{type === "in_person" ? "Branch" : "Branch (host's diary)"}</span>
					<select className="cn-filter__select" value={branchId} onChange={(e) => { setBranchId(e.target.value); setDate(null); setSlots(null); }}>
						{OPS_BRANCHES.map((b) => (
							<option key={b.id} value={b.id}>{b.name}</option>
						))}
					</select>
				</label>
				<label className="cn-filter">
					<span className="cn-filter__label">Host</span>
					<select className="cn-filter__select" value={hostId} onChange={(e) => setHostId(e.target.value)}>
						{opsUser?.opsUserId && <option value={opsUser.opsUserId}>You — {opsUser.name}</option>}
						{hosts.filter((h) => h.opsUserId !== opsUser?.opsUserId).map((h) => (
							<option key={h.opsUserId} value={h.opsUserId!}>{h.name}</option>
						))}
					</select>
				</label>
				<label className="cn-filter">
					<span className="cn-filter__label">Length</span>
					<select className="cn-filter__select" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setSlots(null); setTime(null); }}>
						{[30, 45, 60].map((d) => <option key={d} value={d}>{d} min</option>)}
					</select>
				</label>
			</div>

			<p className="hsheet__eyebrow" style={{ marginTop: "1rem" }}>Day</p>
			{!days ? (
				<p className="hsheet__hint">Checking the diary…</p>
			) : (
				<div className="hsheet__list" style={{ maxHeight: "9rem", overflowY: "auto" }}>
					{days.map((d) => (
						<div
							key={d.date}
							role="radio" aria-checked={date === d.date}
							className={`hsheet__row${date === d.date ? " hsheet__row--on" : ""}`}
							style={d.open === 0 ? { opacity: 0.4, pointerEvents: "none" } : undefined}
							onClick={() => setDate(d.date)}
						>
							<span>{fmtDay(d.date)}</span>
							<span className="hsheet__hint">{d.open === 0 ? "closed" : `${d.open} open`}</span>
						</div>
					))}
				</div>
			)}

			{date && (
				<>
					<p className="hsheet__eyebrow" style={{ marginTop: "1rem" }}>Time</p>
					{!slots ? (
						<p className="hsheet__hint">Checking slots…</p>
					) : (
						<div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
							{slots.map((s) => (
								<button
									key={s.time}
									type="button"
									disabled={!s.available}
									className={`btn btn--sm ${time === s.time ? "btn--primary" : "btn--ghost"}`}
									style={!s.available ? { textDecoration: "line-through", opacity: 0.45 } : undefined}
									onClick={() => setTime(s.time)}
								>
									{s.time}
								</button>
							))}
							{slots.every((s) => !s.available) && <span className="hsheet__hint">Nothing free — pick another day.</span>}
						</div>
					)}
				</>
			)}

			{type === "online" && (
				<label className="cn-filter" style={{ marginTop: "1rem" }}>
					<span className="cn-filter__label">Meeting link — optional</span>
					<input
						className="input"
						type="url"
						value={meetingUrl}
						onChange={(e) => setMeetingUrl(e.target.value)}
						placeholder="https://… Zoom, Teams, Meet"
					/>
					<span className="hsheet__hint" style={{ marginTop: "0.3rem" }}>
						Leave blank for the built-in call room — the client's Join button opens it in the portal. Paste one to meet elsewhere; you can also set or change it on the case later.
					</span>
				</label>
			)}

			<p className="hsheet__eyebrow" style={{ marginTop: "1rem" }}>Note for the client (goes in the email)</p>
			<textarea
				className="input" rows={2} value={note}
				onChange={(e) => setNote(e.target.value)}
				placeholder="e.g. Bring your bank statements — we'll check the sponsor evidence together."
			/>

			<div className="cn-assign__row" style={{ marginTop: "1.1rem" }}>
				<button type="button" className="btn btn--primary" disabled={busy || !date || !time} onClick={() => void submit()}>
					{busy ? "Booking…" : `Book check-in${date && time ? ` — ${fmtDay(date)} ${time}` : ""}`}
				</button>
				<button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>Cancel</button>
			</div>
		</Sheet>
	);
}
