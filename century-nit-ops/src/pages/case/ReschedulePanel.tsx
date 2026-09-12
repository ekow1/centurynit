import { useMemo, useState } from "react";
import {
	CONSULTATION_DURATIONS,
	formatSlot,
	isSlotBooked,
	resolveBranchId,
	upcomingDays,
} from "century-nit-core";
import { branchName } from "century-nit-core/ops";

/**
 * Reschedule a consultation onto a real, bookable slot.
 *
 * The previous control was a single free-text field ("New date & time - e.g.
 * Tomorrow, 3:00 PM"). Staff could type anything, so the new time was not
 * checked against branch opening days, past dates, or slots already taken by
 * another applicant - and the value written back was whatever prose was typed.
 * This offers the same constrained date + slot choice the applicant gets when
 * booking, so both sides of the system agree on what a valid appointment is.
 */

/*
 * resolveBranchId, upcomingDays and the slot formatter used to be defined here.
 * They now live in century-nit-core/availability so the applicant's picker and
 * this panel apply exactly the same rules — when they drifted, one side could
 * offer a slot the other considered taken.
 */


export function ReschedulePanel({
	currentWhen,
	branchLabel,
	duration = "45",
	onConfirm,
	onCancel,
}: {
	/** What the appointment is being moved away from */
	currentWhen: string;
	branchLabel: string;
	duration?: string;
	/** Structured slot — the caller formats it for display. */
	onConfirm: (date: string, time: string, reason: string) => void;
	onCancel: () => void;
}) {
	const [date, setDate] = useState("");
	const [time, setTime] = useState("");
	const [reason, setReason] = useState("");

	const branchId = useMemo(() => resolveBranchId(branchLabel), [branchLabel]);
	const days = useMemo(() => upcomingDays(branchId), [branchId]);

	const slots =
		(CONSULTATION_DURATIONS.find((d) => d.id === duration) ?? CONSULTATION_DURATIONS[1])
			.slots as readonly string[];

	// Reason is required: it is what the applicant is told about the change
	const missing = !date
		? "Pick a date"
		: !time
			? "Pick a time slot"
			: !reason.trim()
				? "Add a reason - the applicant sees this"
				: null;

	const preview = date && time ? formatSlot(date, time) : null;

	return (
		<div className="resched">
			<div className="resched__head">
				<div>
					<p className="eyebrow">Reschedule consultation</p>
					<p className="resched__current">
						Currently <strong>{currentWhen || "unscheduled"}</strong>
						{branchLabel ? ` · ${branchName(branchLabel)}` : ""}
					</p>
				</div>
				<button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
					Cancel
				</button>
			</div>

			<div className="resched__section">
				<p className="resched__label mono">New date</p>
				<div className="resched__days scroll-x">
					{days.map((d) => (
						<button
							key={d.date}
							type="button"
							disabled={d.disabled}
							onClick={() => {
								setDate(d.date);
								setTime("");
							}}
							className={`resched__day${date === d.date ? " resched__day--on" : ""}`}
							title={d.disabled ? "Branch closed" : undefined}
						>
							<span className="resched__day-wd">{d.weekday}</span>
							<span className="resched__day-dt">{d.label}</span>
						</button>
					))}
				</div>
				{branchId ? null : (
					<p className="resched__hint muted">
						Branch not recognised - availability isn't being checked for this booking.
					</p>
				)}
			</div>

			<div className="resched__section">
				<p className="resched__label mono">
					New time{" "}
					<span className="muted">
						· {CONSULTATION_DURATIONS.find((d) => d.id === duration)?.label ?? "45 min"} ·
						branch local
					</span>
				</p>
				{date ? (
					<div className="resched__slots">
						{slots.map((t) => {
							const taken = branchId ? isSlotBooked(branchId, date, t) : false;
							return (
								<button
									key={t}
									type="button"
									disabled={taken}
									onClick={() => setTime(t)}
									className={`resched__slot${time === t ? " resched__slot--on" : ""}`}
									title={taken ? "Already booked at this branch" : undefined}
								>
									{t}
									{taken ? <span className="resched__slot-tag">booked</span> : null}
								</button>
							);
						})}
					</div>
				) : (
					<p className="resched__hint muted">Select a date to see open slots.</p>
				)}
			</div>

			<div className="resched__section">
				<label className="resched__label mono" htmlFor="resched-reason">
					Reason <span className="muted">· shown to the applicant</span>
				</label>
				<textarea
					id="resched-reason"
					className="input"
					rows={2}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder="e.g. Consultant unavailable - moved to the next open slot"
				/>
			</div>

			<div className="resched__foot">
				<button
					type="button"
					className="btn btn--primary btn--sm"
					disabled={missing !== null}
					onClick={() => onConfirm(date, time, reason.trim())}
				>
					{preview ? `Move to ${preview}` : "Confirm new time"}
				</button>
				{/* Say what is missing rather than showing a dead button */}
				{missing ? <span className="resched__missing mono">{missing}</span> : null}
			</div>
		</div>
	);
}
