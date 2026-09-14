import type { TabId } from "./tabs/types";

/**
 * The case's journey as a spine — the portal's I–VI vocabulary on the ops
 * side, so "the client is in Chapter III" reads the same on both surfaces.
 *
 * One row: the five working chapters as cells — ✓ when passed, ink for the
 * chapter the case is in, an underline for the one being viewed, dashed when
 * locked — VI as a state cell (✓ when the case is closed), and the views
 * (Overview, Money, Documents) to the right as text tabs with a count.
 */

type ChapterTab = { id: TabId; numeral: string; label: string; locked: boolean; hint?: string };

export function CaseSpine({
	chapters,
	current,
	nowId,
	done,
	onChange,
	utils,
}: {
	/** The five working chapters, in journey order. */
	chapters: ChapterTab[];
	current: TabId;
	/** The chapter the case is in — the inverted cell. */
	nowId?: TabId | null;
	/** The case is closed — the VI cell carries ✓. */
	done: boolean;
	onChange: (id: TabId) => void;
	/** Non-chapter surfaces: overview, money, documents — with the count that matters. */
	utils: { id: TabId; label: string; note?: string | null }[];
}) {
	return (
		<div className="cn-spine" role="tablist" aria-label="Case chapters">
			{chapters.map((c) => {
				const isNow = c.id === nowId && !c.locked;
				const isOn = c.id === current;
				const nowIdx = chapters.findIndex((x) => x.id === nowId);
				// A closed case has passed every chapter — all show ✓ even though
				// `nowId` resolves to a utility cell (payments) rather than V.
				const reached = done || (!c.locked && nowIdx >= 0 && chapters.findIndex((x) => x.id === c.id) < nowIdx);
				return (
					<button
						key={c.id}
						type="button"
						role="tab"
						aria-selected={isOn}
						aria-disabled={c.locked}
						title={c.locked ? c.hint : undefined}
						className={[
							"cn-spine__ch",
							reached ? "cn-spine__ch--done" : "",
							isNow ? "cn-spine__ch--now" : "",
							isOn && !isNow ? "cn-spine__ch--on" : "",
							c.locked ? "cn-spine__ch--locked" : "",
						].join(" ")}
						onClick={() => !c.locked && onChange(c.id)}
					>
						<span className="cn-spine__rn">{reached ? "✓ " : ""}{c.numeral}</span>
						<span className="cn-spine__lb">{c.label}</span>
					</button>
				);
			})}
			<div
				className={`cn-spine__ch cn-spine__ch--vi${done ? " cn-spine__ch--done" : " cn-spine__ch--locked"}`}
				title={done ? "File closed" : "Closes when the journey completes"}
				aria-hidden
			>
				<span className="cn-spine__rn">{done ? "✓ " : ""}VI</span>
				<span className="cn-spine__lb">Complete</span>
			</div>
			<div className="cn-spine__utils">
				{utils.map((u) => (
					<button
						key={u.id}
						type="button"
						role="tab"
						aria-selected={current === u.id}
						className={`cn-spine__ut${current === u.id ? " cn-spine__ut--on" : ""}`}
						onClick={() => onChange(u.id)}
					>
						{u.label}
						{u.note ? <span className="cn-spine__n">{u.note}</span> : null}
					</button>
				))}
			</div>
		</div>
	);
}
