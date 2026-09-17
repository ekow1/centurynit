import { useSearchParams } from "react-router-dom";

/**
 * The tab bar every case detail uses — applications and consultations alike.
 *
 * One bar, one behaviour: sticky under the pane's top edge, the current tab
 * in the URL (`?tab=`) so a notification or a handoff can deep-link to a
 * chapter and a refresh keeps it, a lock with a hint for chapters the case
 * has not reached, and a dot on the chapter the case is currently in. The
 * tabs *are* the timeline — there is no separate stepper.
 */

export type CaseTab<T extends string> = {
	id: T;
	label: string;
	locked?: boolean;
	/** Why it is locked — shown as the tooltip. */
	hint?: string;
};

/**
 * Tab state that IS the URL — `?tab=` is read at render, not copied into
 * state, so a deep link that lands while the page is mounted (a
 * notification, a handoff, browser back) always takes effect. Precedence:
 * the URL, then the host's preset, then the record's own chapter.
 */
export function useCaseTab<T extends string>(
	ids: readonly T[],
	fallback: () => T,
	preset?: T,
): [T, (next: T) => void] {
	const [searchParams, setSearchParams] = useSearchParams();
	const urlTab = searchParams.get("tab");
	const tab: T = urlTab !== null && (ids as readonly string[]).includes(urlTab) ? (urlTab as T) : (preset ?? fallback());
	const setTab = (next: T) => {
		setSearchParams(
			(prev) => {
				const p = new URLSearchParams(prev);
				// Landing on the tab the case would open anyway removes the
				// param — clean URLs stay clean, and the record keeps driving
				// the default as it moves through the journey.
				if (next === (preset ?? fallback())) p.delete("tab");
				else p.set("tab", next);
				return p;
			},
			{ replace: true },
		);
	};
	return [tab, setTab];
}

export function CaseTabs<T extends string>({
	tabs,
	current,
	onChange,
	nowId,
	pageLevel,
}: {
	tabs: CaseTab<T>[];
	current: T;
	onChange: (id: T) => void;
	/** The chapter the case is in right now — gets the dot. */
	nowId?: T | null;
	/** Host is a full page, not a scaffold pane — no edge bleed. */
	pageLevel?: boolean;
}) {
	return (
		<div className={`cn-tabs-sticky${pageLevel ? " cn-tabs-sticky--page" : ""}`}>
			<div className="cn-tabs" role="tablist">
				{tabs.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={current === t.id}
						aria-disabled={t.locked}
						title={t.locked ? t.hint : undefined}
						className={`cn-tab${current === t.id ? " cn-tab--active" : ""}${t.locked ? " cn-tab--locked" : ""}`}
						onClick={() => !t.locked && onChange(t.id)}
					>
						{t.locked && <span aria-hidden>🔒 </span>}
						{t.label}
						{t.id === nowId && !t.locked && <span className="cn-tab__now" title="Current chapter" aria-label="current chapter" />}
					</button>
				))}
			</div>
		</div>
	);
}
