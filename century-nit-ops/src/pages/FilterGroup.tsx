import { useRef } from "react";

export type FilterOption<T extends string> = {
	id: T;
	label: string;
	/** Live count shown beside the label. */
	count?: number;
	/** Draw attention while unselected — "3 overdue", "5 of them mine". */
	hot?: boolean;
};

/**
 * Single-select filter chips — a `radiogroup`, not a `tablist`: the chips
 * narrow the list below rather than switch panels, so they announce
 * themselves as options. Arrow keys (and Home/End) move and select, per the
 * radio pattern; the checked chip is the one in the Tab order.
 */
export function FilterGroup<T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: FilterOption<T>[];
	value: T;
	onChange: (id: T) => void;
}) {
	const refs = useRef(new Map<T, HTMLButtonElement>());
	const pick = (id: T) => {
		onChange(id);
		refs.current.get(id)?.focus();
	};
	const onKeyDown = (e: React.KeyboardEvent) => {
		const ids = options.map((o) => o.id);
		const i = ids.indexOf(value);
		let next: T | undefined;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") next = ids[(i + 1) % ids.length];
		else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = ids[(i - 1 + ids.length) % ids.length];
		else if (e.key === "Home") next = ids[0];
		else if (e.key === "End") next = ids[ids.length - 1];
		if (next !== undefined) {
			e.preventDefault();
			pick(next);
		}
	};
	return (
		<div className="ops-fgroup" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
			{options.map((o) => {
				const on = o.id === value;
				return (
					<button
						key={o.id}
						type="button"
						role="radio"
						aria-checked={on}
						tabIndex={on ? 0 : -1}
						ref={(el) => {
							if (el) refs.current.set(o.id, el);
							else refs.current.delete(o.id);
						}}
						className={`ops-pill ops-pill--chip${on ? " ops-pill--on" : ""}${o.hot && !on ? " ops-pill--hot" : ""}${o.count === 0 && !on ? " ops-pill--zero" : ""}`}
						onClick={() => onChange(o.id)}
					>
						{o.label}
						{o.count !== undefined && <span className="ops-pill__n">{o.count}</span>}
					</button>
				);
			})}
		</div>
	);
}
