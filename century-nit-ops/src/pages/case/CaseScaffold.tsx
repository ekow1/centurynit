import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The shell every case queue shares — Applications, Visa, Travel,
 * Consultations: a filtered list on the left, the selected record's detail
 * on the right. Pages supply the list and the detail; the shell owns the
 * split, the empty state and the close control, so a handler moving
 * between queues finds the same frame every time.
 *
 * The detail has no header of its own: the record's `CaseHeader` inside
 * the detail is the one header, so the same facts are not painted twice.
 *
 * The detail can be expanded: the same pane lifts into a modal over the
 * page for work that wants the width (a long document list, the board), and
 * drops back into the split on Escape, the scrim or Collapse. Close always
 * closes the record, expanded or not.
 */
export function CaseScaffold({
	list,
	detail,
	onClose,
	emptyHint = "Select a record from the list to review it and take action.",
	bar,
	collapseDetail = false,
	bare = false,
	rail = null,
}: {
	/** The list pane: filters, search and rows. */
	list: ReactNode;
	/** The selected record's detail; null when nothing is selected. */
	detail: ReactNode | null;
	onClose: () => void;
	emptyHint?: string;
	/** Optional controls beside the close button (a link to the applicant, a queue badge). */
	bar?: ReactNode;
	/**
	 * When true, the detail pane is only rendered while a record is selected —
	 * the list keeps the full width instead of surrendering it to an empty
	 * pane. For queues whose list is wide (a table, not row-cards).
	 */
	collapseDetail?: boolean;
	/** Drop the pane frames — for queues whose list is a bordered data table. */
	bare?: boolean;
	/**
	 * What the detail pane shows while nothing is selected — the pane stays
	 * open at a fixed rail width instead of collapsing or showing the empty
	 * hint. The rail brings its own bar. Selecting a record replaces it.
	 */
	rail?: ReactNode;
}) {
	const open = detail !== null;
	const [expanded, setExpanded] = useState(false);
	const expandBtn = useRef<HTMLButtonElement>(null);
	const overlay = useRef<HTMLDivElement>(null);

	// Closing the record drops the expansion with it (state adjusted during
	// render, the React way, rather than synced from an effect).
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (!open) setExpanded(false);
	}

	// Expanded: lock the page, take focus, and let Escape collapse — unless a
	// sheet or dialog opened from inside the detail is the thing on top.
	useEffect(() => {
		if (!expanded) return;
		document.body.classList.add("sheet-lock");
		overlay.current?.querySelector<HTMLElement>(".cn-scaffold__bar-actions button")?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (document.querySelector(".sheet, .ops-modal-backdrop")) return;
			setExpanded(false);
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.classList.remove("sheet-lock");
			// The inline Expand button has remounted by the time this cleanup runs.
			expandBtn.current?.focus();
		};
	}, [expanded]);

	const controls = (
		<div className="cn-scaffold__bar">
			<div className="cn-scaffold__bar-slot">{bar}</div>
			<div className="cn-scaffold__bar-actions">
				<button
					type="button"
					ref={expandBtn}
					className="btn btn--sm btn--ghost"
					onClick={() => setExpanded((v) => !v)}
					aria-pressed={expanded}
					aria-label={expanded ? "Collapse detail back into the page" : "Expand detail"}
					title={expanded ? "Collapse (Esc)" : "Expand"}
				>
					{expanded ? "⤡ Collapse" : "⤢ Expand"}
				</button>
				<button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close detail">
					✕ Close
				</button>
			</div>
		</div>
	);

	return (
		<div
			className={`ops-split cn-scaffold${collapseDetail ? " cn-scaffold--collapse" : ""}${
				open ? " cn-scaffold--open" : ""
			}${bare ? " cn-scaffold--bare" : ""}${rail ? " cn-scaffold--rail" : ""}`}
		>
			<div className="ops-split__list cn-scaffold__list">{list}</div>
			{(!collapseDetail || open || rail) && (
				<div className="ops-split__detail cn-scaffold__detail">
					{!open && rail ? (
						rail
					) : !open ? (
						<div className="cn-scaffold__empty">
							<span className="cn-scaffold__empty-mark" aria-hidden>
								◈
							</span>
							<p className="muted">{emptyHint}</p>
						</div>
					) : expanded ? (
						// The record is in the large view; hold its place here.
						<div className="cn-scaffold__empty">
							<span className="cn-scaffold__empty-mark" aria-hidden>
								⤢
							</span>
							<p className="muted">Showing in the large view.</p>
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setExpanded(false)}>
								Back to the pane
							</button>
						</div>
					) : (
						<>
							{controls}
							<div className="cn-scaffold__body">{detail}</div>
						</>
					)}
				</div>
			)}
			{open && expanded && (
				<div className="cn-scaffold__scrim" onClick={() => setExpanded(false)}>
					<div
						ref={overlay}
						className="cn-scaffold__detail cn-scaffold__detail--expanded"
						role="dialog"
						aria-modal="true"
						aria-label="Record detail"
						onClick={(e) => e.stopPropagation()}
					>
						{controls}
						<div className="cn-scaffold__body">{detail}</div>
					</div>
				</div>
			)}
		</div>
	);
}
