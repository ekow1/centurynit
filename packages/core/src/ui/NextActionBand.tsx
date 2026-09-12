import type { ReactNode } from "react";
import { StatusPill, type Tone } from "./StatusPill.js";

/** One thing a case is waiting on, and the control that clears it if there is one. */
export type NextAction = {
	id: string;
	title: string;
	detail?: string | null;
	tone?: Tone;
	/** The control that clears it — a button, an AssignControl, a link. */
	action?: ReactNode;
};

/**
 * The band under a case header that says what needs doing next, on every
 * tab. In the console the items are the same tasks the dashboard lists for
 * this case, so a handler opening the case sees the same next step they
 * were sent to do; in the portal they are the applicant's own next steps.
 * When nothing is owed on this side it says who the case is waiting on.
 */
export function NextActionBand({
	items,
	waitingOn,
	title = "Needs attention",
	emptyTitle = "Nothing needed from you right now",
}: {
	items: NextAction[];
	/** Shown when `items` is empty: what the other side has to do first. */
	waitingOn?: string | null;
	title?: string;
	emptyTitle?: string;
}) {
	if (items.length === 0) {
		if (!waitingOn) return null;
		return (
			<section className="cn-next cn-next--waiting" aria-label={title}>
				<div className="cn-next__row">
					<StatusPill tone="waiting" dot>
						Waiting
					</StatusPill>
					<div className="cn-next__text">
						<p className="cn-next__title">{emptyTitle}</p>
						<p className="cn-next__detail">{waitingOn}</p>
					</div>
				</div>
			</section>
		);
	}
	return (
		<section className="cn-next" aria-label={title}>
			<h3 className="cn-next__heading">
				{title}
				<span className="cn-next__count">{items.length}</span>
			</h3>
			<ul className="cn-next__list">
				{items.map((item) => (
					<li key={item.id} className="cn-next__row">
						<StatusPill tone={item.tone ?? "current"} dot>
							Now
						</StatusPill>
						<div className="cn-next__text">
							<p className="cn-next__title">{item.title}</p>
							{item.detail && <p className="cn-next__detail">{item.detail}</p>}
						</div>
						{item.action && <div className="cn-next__action">{item.action}</div>}
					</li>
				))}
			</ul>
		</section>
	);
}
