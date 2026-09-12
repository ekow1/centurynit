import type { ReactNode } from "react";

/**
 * The shell every case queue shares — Applications, Visa, Travel,
 * Consultations: a filtered list on the left, the selected record's detail
 * on the right. Pages supply the list and the detail; the shell owns the
 * split, the empty state and the close control, so a handler moving
 * between queues finds the same frame every time.
 *
 * The detail has no header of its own: the record's `CaseHeader` inside
 * the detail is the one header, so the same facts are not painted twice.
 */
export function CaseScaffold({
	list,
	detail,
	onClose,
	emptyHint = "Select a record from the list to review it and take action.",
	bar,
}: {
	/** The list pane: filters, search and rows. */
	list: ReactNode;
	/** The selected record's detail; null when nothing is selected. */
	detail: ReactNode | null;
	onClose: () => void;
	emptyHint?: string;
	/** Optional controls beside the close button (a link to the applicant, a queue badge). */
	bar?: ReactNode;
}) {
	return (
		<div className="ops-split cn-scaffold">
			<div className="ops-split__list cn-scaffold__list">{list}</div>
			<div className="ops-split__detail cn-scaffold__detail">
				{detail === null ? (
					<div className="cn-scaffold__empty">
						<span className="cn-scaffold__empty-mark" aria-hidden>
							◈
						</span>
						<p className="muted">{emptyHint}</p>
					</div>
				) : (
					<>
						<div className="cn-scaffold__bar">
							<div className="cn-scaffold__bar-slot">{bar}</div>
							<button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close detail">
								✕ Close
							</button>
						</div>
						<div className="cn-scaffold__body">{detail}</div>
					</>
				)}
			</div>
		</div>
	);
}
