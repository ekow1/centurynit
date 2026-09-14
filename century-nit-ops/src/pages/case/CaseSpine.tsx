import type { TabId } from "./tabs/types";

/**
 * The case's tabs as one chip row — the chip the cases list uses for its
 * filters. Overview first (where a case opens), then the six chapters in
 * the portal's I–VI vocabulary, then the case's other views (Money, Docs)
 * with the count that matters. Ink is the tab being viewed; ■ marks the
 * chapter the case is in; ✓ a chapter passed; dashed a chapter locked.
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
	const nowIdx = chapters.findIndex((x) => x.id === nowId);
	const view = (v: ViewTab) => (
		<button
			key={v.id}
			type="button"
			role="tab"
			aria-selected={current === v.id}
			className={`cn-chip${current === v.id ? " cn-chip--on" : ""}`}
			onClick={() => onChange(v.id)}
		>
			<b>{v.label}</b>
			{v.note ? <span className="cn-chip__n">{v.note}</span> : null}
		</button>
	);
	return (
		<div className="cn-spine" role="tablist" aria-label="Case tabs">
			{view(overview)}
			<span className="cn-spine__gap" aria-hidden />
			{chapters.map((c, i) => {
				const isNow = c.id === nowId && !c.locked;
				const isOn = c.id === current;
				// A closed case has passed every chapter — all show ✓ even though
				// `nowId` resolves to a utility cell (payments) rather than V.
				const passed = done || (!c.locked && nowIdx >= 0 && i < nowIdx);
				return (
					<button
						key={c.id}
						type="button"
						role="tab"
						aria-selected={isOn}
						aria-disabled={c.locked}
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
							{passed ? "✓ " : ""}
							{c.numeral} {c.label}
						</b>
					</button>
				);
			})}
			<div
				className={`cn-chip${done ? " cn-chip--passed" : " cn-chip--locked"}`}
				title={done ? "File closed" : "Closes when the journey completes"}
				aria-hidden
			>
				<b>{done ? "✓ " : ""}VI Complete</b>
			</div>
			<span className="cn-spine__gap" aria-hidden />
			{views.map(view)}
		</div>
	);
}
