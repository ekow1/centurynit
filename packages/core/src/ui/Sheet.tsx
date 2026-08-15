import { useEffect, useRef } from "react";

/**
 * Bottom sheet - the mobile-native counterpart to a dropdown.
 * Slides up from the bottom edge, dims the page behind it, and is
 * dismissed by the backdrop, the grab handle, Escape, or a downward drag.
 */
export function Sheet({
	open,
	onClose,
	title,
	label,
	children,
	size = "auto",
	closeOnLink = false,
}: {
	open: boolean;
	onClose: () => void;
	/** Visible heading inside the sheet */
	title?: string;
	/** Accessible name when there is no visible title */
	label?: string;
	children: React.ReactNode;
	/** `auto` hugs its content (max 88dvh); `tall` always takes 88dvh */
	size?: "auto" | "tall";
	/** Close when a link inside is followed - the expected behaviour for a nav sheet */
	closeOnLink?: boolean;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const dragStart = useRef<number | null>(null);

	// Lock the page behind the sheet so only the sheet scrolls
	useEffect(() => {
		if (!open) return;
		document.body.classList.add("sheet-lock");
		return () => document.body.classList.remove("sheet-lock");
	}, [open]);

	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	// Move focus into the sheet when it opens
	useEffect(() => {
		if (!open) return;
		const id = window.setTimeout(() => {
			panelRef.current
				?.querySelector<HTMLElement>(
					'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
				)
				?.focus();
		}, 60);
		return () => window.clearTimeout(id);
	}, [open]);

	if (!open) return null;

	/** Drag the handle down far enough and the sheet dismisses - standard iOS/Android gesture */
	function onTouchStart(e: React.TouchEvent) {
		dragStart.current = e.touches[0].clientY;
	}

	function onTouchMove(e: React.TouchEvent) {
		if (dragStart.current === null || !panelRef.current) return;
		const dy = e.touches[0].clientY - dragStart.current;
		if (dy > 0) panelRef.current.style.transform = `translateY(${dy}px)`;
	}

	function onTouchEnd(e: React.TouchEvent) {
		if (dragStart.current === null || !panelRef.current) return;
		const dy = e.changedTouches[0].clientY - dragStart.current;
		panelRef.current.style.transform = "";
		dragStart.current = null;
		if (dy > 90) onClose();
	}

	return (
		<div className="sheet" role="presentation">
			<div className="sheet__scrim" onClick={onClose} />
			<div
				className={`sheet__panel${size === "tall" ? " sheet__panel--tall" : ""}`}
				role="dialog"
				aria-modal="true"
				aria-label={title ?? label}
				ref={panelRef}
			>
				<div
					className="sheet__grip-zone"
					onTouchStart={onTouchStart}
					onTouchMove={onTouchMove}
					onTouchEnd={onTouchEnd}
				>
					<span className="sheet__grip" aria-hidden />
				</div>

				{title ? (
					<header className="sheet__head">
						<h2 className="sheet__title">{title}</h2>
						<button
							type="button"
							className="sheet__close"
							onClick={onClose}
							aria-label="Close"
						>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
								<path d="M18 6 6 18M6 6l12 12" />
							</svg>
						</button>
					</header>
				) : null}

				<div
					className="sheet__body"
					onClickCapture={
						closeOnLink
							? (e) => {
									if ((e.target as HTMLElement).closest("a[href]")) onClose();
								}
							: undefined
					}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
