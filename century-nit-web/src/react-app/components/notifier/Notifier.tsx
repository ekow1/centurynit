import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * App-wide notifier: transient toasts + a blocking confirm modal.
 *
 * Replaces every former `window.alert` / `window.confirm` site so success and
 * error feedback use the in-app chrome instead of native browser dialogs — the
 * latter break the brutalist/minimal design language, cannot be styled, and
 * (alert) are non-blocking-only and un-dismissible by intent.
 *
 * One provider mounts at the app root; anyone may call `useNotifier()` for a
 * `{ toast, confirm }` pair. The viewport is rendered through a portal to
 * `document.body` so it floats above route boundaries and route Suspense.
 *
 * Visual palette is the project's own dark/light inverse — no new color tokens
 * are introduced. Error accent uses the same isolated-hex pattern already used
 * for `.cal-dot--warn` (`#b26a00`) in the ops app: one stroke of `#b91c1c` on
 * the error icon, kept out of the theme layer on purpose.
 */

type ToastType = "success" | "error" | "info";

type Toast = {
	id: string;
	type: ToastType;
	title: string;
	message: string;
	durationMs: number;
};

type ToastInput = {
	title?: string;
	durationMs?: number;
};

type ConfirmOptions = {
	title: string;
	message: string;
	/** Confirm button label. */
	confirmText?: string;
	/** Cancel button label. */
	cancelText?: string;
	/** Visual treatment of the confirm button. "danger" inverts it. */
	tone?: "primary" | "danger";
};

type ConfirmState = ConfirmOptions & {
	open: boolean;
	resolve: ((value: boolean) => void) | null;
};

type NotifierValue = {
	toast: {
		success: (message: string, opts?: ToastInput) => void;
		error: (message: string, opts?: ToastInput) => void;
		info: (message: string, opts?: ToastInput) => void;
	};
	confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const NotifierContext = createContext<NotifierValue | null>(null);

const MAX_TOASTS = 4;
const DEFAULT_DURATION = 6000;
const ERROR_DURATION = 8000;

function makeId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NotifierProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const [confirmState, setConfirmState] = useState<ConfirmState>({
		open: false,
		title: "",
		message: "",
		resolve: null,
	});
	const resolverRef = useRef<((value: boolean) => void) | null>(null);

	const pushToast = useCallback(
		(type: ToastType, message: string, opts: ToastInput | undefined) => {
			const id = makeId();
			const durationMs = opts?.durationMs ?? (type === "error" ? ERROR_DURATION : DEFAULT_DURATION);
			const title =
				opts?.title ??
				(type === "success" ? "Done" : type === "error" ? "Something went wrong" : "Heads up");
			const next: Toast = { id, type, title, message, durationMs };
			setToasts((prev) => [...prev.slice(-MAX_TOASTS + 1), next]);
		},
		[],
	);

	const dismissToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	const toast = useMemo<NotifierValue["toast"]>(
		() => ({
			success: (m, o) => pushToast("success", m, o),
			error: (m, o) => pushToast("error", m, o),
			info: (m, o) => pushToast("info", m, o),
		}),
		[pushToast],
	);

	const confirm = useCallback((opts: ConfirmOptions) => {
		return new Promise<boolean>((resolve) => {
			resolverRef.current = resolve;
			setConfirmState({ open: true, resolve, ...opts });
		});
	}, []);

	const resolveConfirm = useCallback((value: boolean) => {
		resolverRef.current?.(value);
		resolverRef.current = null;
		setConfirmState((prev) => ({ ...prev, open: false, resolve: null }));
	}, []);

	const value: NotifierValue = { toast, confirm };

	return (
		<NotifierContext.Provider value={value}>
			{children}
			<NotifierViewport
				toasts={toasts}
				dismissToast={dismissToast}
				confirmState={confirmState}
				onResolveConfirm={resolveConfirm}
			/>
		</NotifierContext.Provider>
	);
}

export function useNotifier(): NotifierValue {
	const ctx = useContext(NotifierContext);
	if (!ctx) {
		throw new Error("useNotifier must be used within <NotifierProvider>");
	}
	return ctx;
}

/* ── Viewport ─────────────────────────────────────────────────────────────── */

function NotifierViewport({
	toasts,
	dismissToast,
	confirmState,
	onResolveConfirm,
}: {
	toasts: Toast[];
	dismissToast: (id: string) => void;
	confirmState: ConfirmState;
	onResolveConfirm: (value: boolean) => void;
}) {
	// This is a Vite CSR SPA — `document.body` is present by render time, but
	// defensively bail (render no portal) if it is somehow unavailable rather
	// than crash on a null container.
	if (typeof document === "undefined" || !document.body) return null;

	return (
		<>
			<ToastStack toasts={toasts} onDismiss={dismissToast} />
			{confirmState.open ? (
				<ConfirmDialog state={confirmState} onResolve={onResolveConfirm} />
			) : null}
		</>
	);
}

/* ── Toasts ───────────────────────────────────────────────────────────────── */

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
	if (toasts.length === 0) return null;
	return createPortal(
		<div className="notifier__stack" role="region" aria-label="Notifications">
			{toasts.map((t) => (
				<ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
			))}
		</div>,
		document.body,
	);
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
	useEffect(() => {
		if (toast.durationMs <= 0) return;
		const handle = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
		return () => window.clearTimeout(handle);
	}, [toast.id, toast.durationMs, onDismiss]);

	const variant = TOAST_VARIANTS[toast.type];

	return (
		<div
			className={`notifier__toast ${variant.className}`}
			style={variant.style}
			role={toast.type === "error" ? "alert" : "status"}
			aria-live={toast.type === "error" ? "assertive" : "polite"}
		>
			<span className="notifier__toast-icon" aria-hidden style={variant.iconStyle}>
				{variant.icon}
			</span>
			<div className="notifier__toast-body" style={{ minWidth: 0, flex: 1 }}>
				<p className="notifier__toast-title" style={variant.titleStyle}>
					{toast.title}
				</p>
				<p className="notifier__toast-msg" style={variant.msgStyle}>
					{toast.message}
				</p>
			</div>
			<button
				type="button"
				className="notifier__toast-close"
				onClick={() => onDismiss(toast.id)}
				aria-label="Dismiss notification"
				style={variant.closeStyle}
			>
				×
			</button>
		</div>
	);
}

/* ── Confirm ──────────────────────────────────────────────────────────────── */

function ConfirmDialog({
	state,
	onResolve,
}: {
	state: ConfirmState;
	onResolve: (value: boolean) => void;
}) {
	const confirmRef = useRef<HTMLButtonElement | null>(null);

	// Autofocus the confirm button so Enter continues; Escape cancels. The
	// backdrop click also resolves `false` — same as cancel — because the
	// caller treats both negative outcomes identically.
	useEffect(() => {
		confirmRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onResolve(false);
			} else if (e.key === "Enter") {
				e.preventDefault();
				confirmRef.current?.click();
			}
		};
		document.addEventListener("keydown", onKey);
		// Lock the page underneath — the modal is a blocking decision.
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [onResolve]);

	const isDanger = state.tone === "danger";
	const confirmText = state.confirmText ?? (isDanger ? "Delete" : "Confirm");
	const cancelText = state.cancelText ?? "Cancel";

	return createPortal(
		<div
			className="notifier__overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="notifier-confirm-title"
			aria-describedby="notifier-confirm-msg"
			onClick={() => onResolve(false)}
			style={OVERLAY_STYLE}
		>
			<div
				className="notifier__dialog card"
				onClick={(e) => e.stopPropagation()}
				style={{ ...DIALOG_STYLE, background: "var(--card)" }}
			>
				<h2 id="notifier-confirm-title" className="notifier__dialog-title" style={{ margin: 0 }}>
					{state.title}
				</h2>
				<p id="notifier-confirm-msg" className="muted mt-2" style={{ margin: 0 }}>
					{state.message}
				</p>
				<div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
					<button
						type="button"
						className="btn btn--ghost btn--sm"
						onClick={() => onResolve(false)}
					>
						{cancelText}
					</button>
					<button
						ref={confirmRef}
						type="button"
						className={`btn btn--sm ${isDanger ? "btn--inverted" : "btn--primary"}`}
						onClick={() => onResolve(true)}
					>
						{confirmText}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

/* ── Visual variants ──────────────────────────────────────────────────────── */

const CHECK_ICON = (
	<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ display: "block" }}>
		<path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
	</svg>
);

const ERROR_ICON = (
	<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ display: "block" }}>
		<path d="M8 4v5M8 12v0.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
	</svg>
);

const INFO_ICON = (
	<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ display: "block" }}>
		<path d="M8 4v0.5M8 7v5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
	</svg>
);

const BASE_TOAST_STYLE: CSSProperties = {
	display: "flex",
	gap: "0.6rem",
	alignItems: "flex-start",
	padding: "0.7rem 0.9rem",
	borderRadius: "8px",
	boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
	minWidth: "280px",
	maxWidth: "380px",
	pointerEvents: "auto",
};

const BASE_ICON_STYLE: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	width: "24px",
	height: "24px",
	borderRadius: "6px",
	flexShrink: 0,
	marginTop: "0.05rem",
};

const BASE_CLOSE_STYLE: CSSProperties = {
	background: "transparent",
	border: "none",
	cursor: "pointer",
	padding: "0 0.25rem",
	fontSize: "1.1rem",
	lineHeight: 1,
	opacity: 0.6,
	transition: "opacity 120ms",
	alignSelf: "flex-start",
};

const TOAST_VARIANTS: Record<
	ToastType,
	{
		className: string;
		style: CSSProperties;
		icon: ReactNode;
		iconStyle: CSSProperties;
		titleStyle: CSSProperties;
		msgStyle: CSSProperties;
		closeStyle: CSSProperties;
	}
> = {
	success: {
		className: "notifier__toast--success",
		style: {
			...BASE_TOAST_STYLE,
			background: "var(--foreground)",
			color: "var(--accent-foreground)",
			border: "1px solid var(--foreground)",
		},
		icon: CHECK_ICON,
		iconStyle: {
			...BASE_ICON_STYLE,
			background: "var(--accent-foreground)",
			color: "var(--foreground)",
		},
		titleStyle: { margin: 0, fontWeight: 700, fontSize: "0.85rem" },
		msgStyle: { margin: "0.2rem 0 0", fontSize: "0.82rem", opacity: 0.92 },
		closeStyle: {
			...BASE_CLOSE_STYLE,
			color: "var(--accent-foreground)",
		},
	},
	error: {
		className: "notifier__toast--error",
		style: {
			...BASE_TOAST_STYLE,
			background: "var(--card)",
			color: "var(--foreground)",
			border: "2px solid var(--foreground)",
		},
		icon: ERROR_ICON,
		iconStyle: {
			...BASE_ICON_STYLE,
			background: "#b91c1c",
			color: "#fff",
		},
		titleStyle: { margin: 0, fontWeight: 700, fontSize: "0.85rem" },
		msgStyle: { margin: "0.2rem 0 0", fontSize: "0.82rem", color: "var(--muted-foreground)" },
		closeStyle: BASE_CLOSE_STYLE,
	},
	info: {
		className: "notifier__toast--info",
		style: {
			...BASE_TOAST_STYLE,
			background: "var(--card)",
			color: "var(--foreground)",
			border: "1px solid var(--border)",
		},
		icon: INFO_ICON,
		iconStyle: {
			...BASE_ICON_STYLE,
			background: "var(--muted)",
			color: "var(--foreground)",
		},
		titleStyle: { margin: 0, fontWeight: 700, fontSize: "0.85rem" },
		msgStyle: { margin: "0.2rem 0 0", fontSize: "0.82rem", color: "var(--muted-foreground)" },
		closeStyle: BASE_CLOSE_STYLE,
	},
};

const OVERLAY_STYLE: CSSProperties = {
	position: "fixed",
	inset: 0,
	background: "rgba(0,0,0,0.55)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "1rem",
	zIndex: 10001,
};

const DIALOG_STYLE: CSSProperties = {
	width: "100%",
	maxWidth: "440px",
	padding: "1.6rem",
	borderRadius: "12px",
	boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
};