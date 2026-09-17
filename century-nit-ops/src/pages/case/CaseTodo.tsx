import { useState } from "react";
import type { NextAction } from "century-nit-core/ui";

/**
 * What a case needs from us. The first task is the headline — "Next: …"
 * with its control — because a handler opening a case should see the one
 * thing to do before the list of things to do. The rest sit under a
 * "+N more" toggle. What is waiting on someone else follows, hollow and
 * unnumbered; the reason the next chapter is out of reach is one muted
 * line at the end, not a card.
 */
export function CaseTodo({
	items,
	waitingOn,
	blockedBy,
}: {
	items: NextAction[];
	/** What the other side has to do first — shown when nothing is owed here. */
	waitingOn?: string | null;
	/** Why the next stage is out of reach — a state, never counted. */
	blockedBy?: string | null;
}) {
	const [expanded, setExpanded] = useState(false);
	const work = items.filter((i) => i.tone !== "waiting");
	const waits = items.filter((i) => i.tone === "waiting");
	if (items.length === 0 && !waitingOn && !blockedBy) return null;
	const [next, ...rest] = work;
	const shown = expanded ? rest : rest.slice(0, 0);
	return (
		<section className="cn-todo" aria-label="To do">
			{next ? (
				<div className="cn-todo__next">
					<span className="cn-todo__next-k">Next</span>
					<span className="cn-todo__t">
						{next.title}
						{next.detail && <span> — {next.detail}</span>}
					</span>
					<span className="cn-todo__a">{next.action}</span>
				</div>
			) : (
				<div className="cn-todo__h">
					<b>Nothing to do</b>
					<span className="cn-todo__r">{waitingOn ?? ""}</span>
				</div>
			)}
			{shown.map((item, i) => (
				<div key={item.id} className="cn-todo__row">
					<span className="cn-todo__n">{i + 2}</span>
					<span className="cn-todo__t">
						{item.title}
						{item.detail && <span> — {item.detail}</span>}
					</span>
					<span className="cn-todo__a">{item.action}</span>
				</div>
			))}
			{rest.length > 0 && (
				<button type="button" className="cn-todo__more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
					{expanded ? "show less ↑" : `+${rest.length} more ↓`}
				</button>
			)}
			{waits.map((item) => (
				<div key={item.id} className="cn-todo__row cn-todo__row--wait">
					<span className="cn-todo__n" />
					<span className="cn-todo__t">
						{item.title}
						{item.detail && <span> — {item.detail}</span>}
					</span>
					<span className="cn-todo__a">{item.action ?? <span className="cn-todo__k">wait</span>}</span>
				</div>
			))}
			{blockedBy && <p className="cn-todo__block">{blockedBy}</p>}
		</section>
	);
}
