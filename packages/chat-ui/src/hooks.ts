import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Long-press detection for touch devices.
 *
 * WhatsApp's contextual action menu opens on long-press on mobile and on
 * hover on desktop. This hook fires `onLongPress` after `delay` ms of
 * continuous press and cancels if the pointer moves or releases early.
 *
 * Returns props to spread onto the target element. The `onContextMenu`
 * handler is included so right-click on desktop also triggers the menu.
 */
export function useLongPress(
	onLongPress: () => void,
	{ delay = 450, moveTolerance = 10 }: { delay?: number; moveTolerance?: number } = {},
) {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const startRef = useRef<{ x: number; y: number } | null>(null);

	const clear = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		startRef.current = null;
	}, []);

	const start = useCallback(
		(x: number, y: number) => {
			startRef.current = { x, y };
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				onLongPress();
				clear();
			}, delay);
		},
		[onLongPress, delay, clear],
	);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (e.pointerType === "mouse") return; // desktop uses hover, not press
			start(e.clientX, e.clientY);
		},
		[start],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!startRef.current) return;
			const dx = Math.abs(e.clientX - startRef.current.x);
			const dy = Math.abs(e.clientY - startRef.current.y);
			if (dx > moveTolerance || dy > moveTolerance) clear();
		},
		[moveTolerance, clear],
	);

	const onPointerUp = useCallback(() => clear(), [clear]);
	const onPointerLeave = useCallback(() => clear(), [clear]);
	const onContextMenu = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		onLongPress();
	}, [onLongPress]);

	useEffect(() => () => clear(), [clear]);

	return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onContextMenu };
}

/**
 * Track whether the user is pinned to the bottom of a scroll container.
 *
 * Used to auto-scroll on new messages only when the user is already at the
 * bottom — jumping down while they're reading history would be jarring.
 */
export function usePinnedToBottom<T extends HTMLElement>() {
	const ref = useRef<T | null>(null);
	const [pinned, setPinned] = useState(true);

	const onScroll = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		const threshold = 40;
		setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
	}, []);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
		const el = ref.current;
		if (!el) return;
		el.scrollTo({ top: el.scrollHeight, behavior });
	}, []);

	return { ref, pinned, onScroll, scrollToBottom };
}
