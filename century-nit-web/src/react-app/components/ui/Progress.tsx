type ProgressProps = {
	current: number;
	total: number;
	label?: string;
	/** Optional current step title, e.g. "Personal" */
	stepName?: string;
};

export function Progress({ current, total, label, stepName }: ProgressProps) {
	const pct = Math.round((current / total) * 100);
	return (
		<div
			className="progress"
			role="progressbar"
			aria-valuenow={pct}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label={stepName ? `Step ${current} of ${total}: ${stepName}` : undefined}
		>
			<div className="progress__meta">
				<span className="mono">
					Step {current} of {total}
					{stepName ? <span className="progress__step-name"> · {stepName}</span> : null}
				</span>
				<span className="mono">{label ?? `${pct}% complete`}</span>
			</div>
			<div className="progress__bar">
				<div className="progress__fill" style={{ width: `${pct}%` }} />
			</div>
		</div>
	);
}

type StepperProps = {
	steps: string[];
	current: number;
};

/**
 * Stage grid with number + stage name.
 * CSS grid wraps - no horizontal scrollbar.
 */
export function Stepper({ steps, current }: StepperProps) {
	return (
		<nav className="stepper" aria-label="Application stages">
			{steps.map((s, i) => {
				const n = i + 1;
				const active = n === current;
				const done = n < current;
				return (
					<div
						key={s}
						className={[
							"stepper__item",
							active ? "stepper__item--active" : "",
							done ? "stepper__item--done" : "",
						]
							.filter(Boolean)
							.join(" ")}
						aria-current={active ? "step" : undefined}
						aria-label={`Stage ${n}: ${s}${active ? " (current)" : done ? " (completed)" : ""}`}
					>
						<span className="stepper__num">{String(n).padStart(2, "0")}</span>
						<span className="stepper__label">{s}</span>
					</div>
				);
			})}
		</nav>
	);
}
