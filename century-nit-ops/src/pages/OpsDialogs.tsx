import { useEffect, useRef } from "react";

/* ─── Confirm Dialog ─── */

type ConfirmProps = {
	open: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	danger = false,
	onConfirm,
	onCancel,
}: ConfirmProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		if (open && !el.open) el.showModal();
		if (!open && el.open) el.close();
	}, [open]);

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		const handleClose = () => onCancel();
		el.addEventListener("close", handleClose);
		return () => el.removeEventListener("close", handleClose);
	}, [onCancel]);

	return (
		<dialog
			ref={dialogRef}
			style={{
				border: "var(--medium)",
				background: "var(--background)",
				padding: 0,
				maxWidth: "28rem",
				width: "100%",
			}}
		>
			<div style={{ padding: "1.5rem" }}>
				<h3
					style={{
						margin: "0 0 0.5rem",
						fontSize: "var(--text-lg, 1.125rem)",
						fontWeight: 700,
					}}
				>
					{title}
				</h3>
				<p style={{ margin: 0, color: "var(--text-muted, #666)" }}>{message}</p>
			</div>
			<div
				style={{
					display: "flex",
					justifyContent: "flex-end",
					gap: "0.5rem",
					padding: "1rem 1.5rem",
					borderTop: "var(--hairline)",
				}}
			>
				<button
					type="button"
					onClick={onCancel}
					style={{
						background: "var(--background)",
						border: "var(--thin)",
						padding: "0.5rem 1rem",
						fontSize: "var(--text-sm)",
						cursor: "pointer",
					}}
				>
					{cancelLabel}
				</button>
				<button
					type="button"
					onClick={onConfirm}
					style={{
						background: danger ? "#b00020" : "#000",
						color: "#fff",
						border: "var(--thin)",
						borderColor: danger ? "#b00020" : "#000",
						padding: "0.5rem 1rem",
						fontSize: "var(--text-sm)",
						cursor: "pointer",
					}}
				>
					{confirmLabel}
				</button>
			</div>
		</dialog>
	);
}

/* ─── Alert Banner ─── */

type AlertProps = {
	type?: "error" | "success" | "info";
	message: string;
	onDismiss: () => void;
};

export function AlertBanner({ type = "error", message, onDismiss }: AlertProps) {
	const borderColor =
		type === "error" ? "#b00020" : type === "success" ? "#007a33" : "#000";
	const icon =
		type === "error" ? "\u2716" : type === "success" ? "\u2714" : "\u2139";

	return (
		<div
			style={{
				display: "flex",
				alignItems: "flex-start",
				gap: "0.75rem",
				border: "var(--medium)",
				borderLeftWidth: 3,
				borderLeftColor: borderColor,
				padding: "0.75rem 1rem",
				marginBottom: "1rem",
				fontSize: "var(--text-sm, 0.875rem)",
			}}
		>
			<span style={{ fontSize: "1rem", lineHeight: 1 }}>{icon}</span>
			<span style={{ flex: 1 }}>{message}</span>
			<button
				type="button"
				onClick={onDismiss}
				style={{
					background: "none",
					border: "none",
					cursor: "pointer",
					padding: 0,
					fontSize: "1rem",
					lineHeight: 1,
					color: "var(--text-muted, #666)",
				}}
			>
				\u2716
			</button>
		</div>
	);
}

/* ─── Toast (auto-dismiss) ─── */

type ToastProps = {
	type?: "error" | "success" | "info";
	message: string;
	onDone: () => void;
	duration?: number;
};

export function Toast({ type = "info", message, onDone, duration = 4000 }: ToastProps) {
	useEffect(() => {
		const t = setTimeout(onDone, duration);
		return () => clearTimeout(t);
	}, [onDone, duration]);

	const borderColor =
		type === "error" ? "#b00020" : type === "success" ? "#007a33" : "#000";

	return (
		<div
			style={{
				position: "fixed",
				bottom: "1.5rem",
				right: "1.5rem",
				zIndex: 300,
				border: "var(--medium)",
				borderLeftWidth: 3,
				borderLeftColor: borderColor,
				background: "var(--background)",
				padding: "0.75rem 1.25rem",
				fontSize: "var(--text-sm, 0.875rem)",
				maxWidth: "24rem",
				boxShadow: "4px 4px 0 rgba(0,0,0,0.15)",
			}}
		>
			{message}
		</div>
	);
}
