import { useRef } from "react";
import type { TabId } from "./tabs/types";

/**
 * The case's tabs as a journey track — Overview first (where a case opens),
 * then the five working chapters in the portal's I–VI vocabulary joined by
 * a connector that fills as the case passes them, then the case's other
 * views (Billing, Docs) with the count that matters. Ink is the tab being
 * viewed; ■ marks the chapter the case is in; ✓ a chapter passed; dashed a
 * chapter locked.
 *
 * It's a tablist, so it takes the tablist keys: ←/→ move and select among
 * the open chapters, Home/End jump to the ends, and only the current tab
 * is in the Tab order.
 */

type ChapterTab = { id: TabId; numeral: string; label: string; locked: boolean; hint?: string };
type ViewTab = { id: TabId; label: string; note?: string | null };

export function CaseSpine({
	overview,
	chapters,
	current,
	nowId,
	done,
	onChange,
	views,
}: {
	overview: ViewTab;
	/** The five working chapters, in journey order. */
	chapters: ChapterTab[];
	current: TabId;
	/** The chapter the case is in — the ■ chip. */
	nowId?: TabId | null;
	/** The case is closed — VI carries ✓. */
	done: boolean;
	onChange: (id: TabId) => void;
	/** The case's other views: money, documents. */
	views: ViewTab[];
}) {
	const refs = useRef(new Map<TabId, HTMLButtonElement>());
	const setRef = (id: TabId) => (el: HTMLButtonElement | null) => {
		if (el) refs.current.set(id, el);
		else refs.current.delete(id);
	};

	// The selectable tabs, in order — locked chapters are skipped.
	const selectable: TabId[] = [
		overview.id,
		...chapters.filter((c) => !c.locked).map((c) => c.id),
		...views.map((v) => v.id),
	];
	const onKeyDown = (e: React.KeyboardEvent) => {
		const i = selectable.indexOf(current);
		let next: TabId | undefined;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") next = selectable[(i + 1) % selectable.length];
		else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = selectable[(i - 1 + selectable.length) % selectable.length];
		else if (e.key === "Home") next = selectable[0];
		else if (e.key === "End") next = selectable[selectable.length - 1];
		if (next !== undefined) {
			e.preventDefault();
			onChange(next);
			refs.current.get(next)?.focus();
		}
	};

	const nowIdx = chapters.findIndex((x) => x.id === nowId);
	const view = (v: ViewTab) => (
		<button
			key={v.id}
			type="button"
			role="tab"
			aria-selected={current === v.id}
			tabIndex={current === v.id ? 0 : -1}
			ref={setRef(v.id)}
			className={`cn-chip${current === v.id ? " cn-chip--on" : ""}`}
			onClick={() => onChange(v.id)}
		>
			<b>{v.label}</b>
			{v.note ? <span className="cn-chip__n">{v.note}</span> : null}
		</button>
	);
	return (
		<div className="cn-spine" role="tablist" aria-label="Case tabs" onKeyDown={onKeyDown}>
			{view(overview)}
			<span className="cn-spine__gap" aria-hidden />
			{chapters.map((c, i) => {
				const isNow = c.id === nowId && !c.locked;
				const isOn = c.id === current;
				// A closed case has passed every chapter — all show ✓ even though
				// `nowId` resolves to a utility cell (payments) rather than V.
				const passed = done || (!c.locked && nowIdx >= 0 && i < nowIdx);
				const link = i > 0 && <span className={`cn-track__link${passed || (done || (nowIdx >= 0 && i <= nowIdx)) ? " cn-track__link--done" : ""}`} aria-hidden />;
				return (
					<span key={c.id} className="cn-track__node">
						{link}
						<button
							type="button"
							role="tab"
							aria-selected={isOn}
							aria-disabled={c.locked}
							tabIndex={isOn ? 0 : -1}
							ref={setRef(c.id)}
							title={c.locked ? c.hint : isNow ? "The chapter the case is in" : undefined}
							className={[
								"cn-chip",
								passed ? "cn-chip--passed" : "",
								isNow ? "cn-chip--now" : "",
								isOn ? "cn-chip--on" : "",
								c.locked ? "cn-chip--locked" : "",
							]
								.filter(Boolean)
								.join(" ")}
							onClick={() => !c.locked && onChange(c.id)}
						>
							<b>
								{passed ? "✓ " : isNow ? "■ " : ""}
								{c.numeral} {c.label}
							</b>
						</button>
					</span>
				);
			})}
			{/* The journey's end — readable text, not a hidden chip, so the
			    track's destination is announced too. */}
			<span className={`cn-chip cn-chip--end${done ? " cn-chip--passed" : " cn-chip--locked"}`} title={done ? "File closed" : "Closes when the journey completes"}>
				<b>{done ? "✓ " : ""}VI Complete</b>
			</span>
			<span className="cn-spine__gap" aria-hidden />
			{views.map(view)}
		</div>
	);
}
