import { normaliseScope, scopeLabel, SERVICE_STAGES, SERVICE_STAGE_LABELS, type ServiceStage } from "century-nit-shared";

/**
 * The journey drawn the same way the portal and the homepage draw it —
 * The consultation (always on for a live case) plus the three service
 * stages, inked when they're on the client's plan, hollow when the scope
 * skipped them, amber-ringed when ops or the client has flagged one as
 * recommended next.
 */

function dotState(
	stage: ServiceStage,
	scope: readonly ServiceStage[],
	recommended: readonly ServiceStage[],
): "on" | "off" | "rec" {
	if (scope.includes(stage)) return "on";
	if (recommended.includes(stage)) return "rec";
	return "off";
}

/** The four-dot mini route + scope label — on cards, directory rows, task lines. */
export function ScopeChip({
	scopeStages,
	recommended,
	className,
}: {
	scopeStages?: readonly string[] | null;
	recommended?: readonly ServiceStage[];
	className?: string;
}) {
	const scope = normaliseScope(scopeStages);
	const rec = recommended ?? [];
	return (
		<span className={`scoperoute${className ? ` ${className}` : ""}`} title={`Scope: ${scopeLabel(scopeStages)}`}>
			<span className="scoperoute__dots" aria-hidden>
				<i className="scoperoute__dot scoperoute__dot--entry" />
				{SERVICE_STAGES.map((s) => (
					<i key={s} className={`scoperoute__dot scoperoute__dot--${dotState(s, scope, rec)}`} />
				))}
			</span>
			{scopeLabel(scopeStages)}
		</span>
	);
}

/** The full-width route for the case header — stage names under the dots. */
export function ScopeRoute({
	scopeStages,
	recommended,
	consulted = true,
}: {
	scopeStages?: readonly string[] | null;
	recommended?: readonly ServiceStage[];
	/** False while the file is still pre-consultation (a lead, an intake). */
	consulted?: boolean;
}) {
	const scope = normaliseScope(scopeStages);
	const rec = recommended ?? [];
	const legs: { no: string; name: string; state: "on" | "off" | "rec" | "entry" }[] = [
		// Named, never numbered: the chapters carry the numerals (I–VI); a service
		// stage is a thing bought, not a step counted.
		{ no: "Start", name: "Consultation", state: consulted ? "entry" : "off" },
		...SERVICE_STAGES.map((s, i) => ({
			no: ["First", "Then", "Last"][i],
			name: SERVICE_STAGE_LABELS[s],
			state: dotState(s, scope, rec),
		})),
	];
	return (
		<ol className="scoperoute-lg">
			{legs.map((l) => (
				<li key={l.no} className={`scoperoute-lg__leg scoperoute-lg__leg--${l.state}`}>
					<span className="scoperoute-lg__rail" aria-hidden>
						<i className="scoperoute-lg__dot" />
						<i className="scoperoute-lg__seg" />
					</span>
					<span className="scoperoute-lg__no">{l.no}</span>
					<span className="scoperoute-lg__name">{l.name}</span>
					{l.state === "off" ? <span className="scoperoute-lg__tag">not on this plan</span> : null}
					{l.state === "rec" ? <span className="scoperoute-lg__tag scoperoute-lg__tag--rec">recommended</span> : null}
				</li>
			))}
		</ol>
	);
}
