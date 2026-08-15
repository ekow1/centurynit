import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Horizontal carousel showing N items per view.
 *
 * Built on CSS scroll-snap rather than a transform track: swipe, trackpad and
 * keyboard scrolling all work natively, the arrows just call `scrollBy`, and
 * items-per-view is a CSS variable so it can drop to 2 and then 1 without any
 * JS breakpoint handling.
 */
export function Carousel({
	label,
	children,
	perView = 3,
}: {
	/** Accessible name for the region */
	label: string;
	children: React.ReactNode;
	perView?: number;
}) {
	const railRef = useRef<HTMLDivElement>(null);
	const [atStart, setAtStart] = useState(true);
	const [atEnd, setAtEnd] = useState(false);

	const sync = useCallback(() => {
		const el = railRef.current;
		if (!el) return;
		// 2px slack — sub-pixel scroll widths never land exactly on the boundary
		setAtStart(el.scrollLeft <= 2);
		setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
	}, []);

	useEffect(() => {
		const el = railRef.current;
		if (!el) return;
		sync();
		el.addEventListener("scroll", sync, { passive: true });
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => {
			el.removeEventListener("scroll", sync);
			ro.disconnect();
		};
	}, [sync]);

	/** Advance by one full view so the run stays aligned to the snap points */
	function page(dir: -1 | 1) {
		const el = railRef.current;
		if (!el) return;
		el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
	}

	const idle = atStart && atEnd; // everything fits — no controls needed

	return (
		<div className="carousel" style={{ ["--per-view" as string]: perView }}>
			<div
				className="carousel__rail"
				ref={railRef}
				role="region"
				aria-label={label}
				tabIndex={0}
			>
				{children}
			</div>

			{!idle ? (
				<div className="carousel__controls">
					<button
						type="button"
						className="carousel__btn"
						onClick={() => page(-1)}
						disabled={atStart}
						aria-label={`Previous ${label}`}
					>
						←
					</button>
					<button
						type="button"
						className="carousel__btn"
						onClick={() => page(1)}
						disabled={atEnd}
						aria-label={`Next ${label}`}
					>
						→
					</button>
				</div>
			) : null}
		</div>
	);
}
