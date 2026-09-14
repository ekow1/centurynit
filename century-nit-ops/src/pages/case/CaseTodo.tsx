import type { NextAction } from "century-nit-core/ui";

/**
 * What a case needs from us, as a numbered list under the state line: the
 * things to do in the order to take them, each with its one control; what
 * is waiting on someone else follows, hollow and unnumbered. The reason the
 * next chapter is out of reach is one muted line at the end, not a card.
 * The items are the same tasks the Workspace lists for this case.
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
	const work = items.filter((i) => i.tone !== "waiting");
	const waits = items.filter((i) => i.tone === "waiting");
	if (items.length === 0 && !waitingOn && !blockedBy) return null;
	return (
		<section className="cn-todo" aria-label="To do">
			<div className="cn-todo__h">
				<b>{work.length > 0 ? "To do" : "Nothing to do"}</b>
				{work.length > 0 && <span>{work.length}</span>}
				<span className="cn-todo__r">{work.length > 1 ? "in the order to take them" : work.length === 0 && waitingOn ? waitingOn : ""}</span>
			</div>
			{work.map((item, i) => (
				<div key={item.id} className="cn-todo__row">
					<span className="cn-todo__n">{i + 1}</span>
					<span className="cn-todo__t">
						{item.title}
						{item.detail && <span> — {item.detail}</span>}
					</span>
					<span className="cn-todo__a">{item.action}</span>
				</div>
			))}
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
