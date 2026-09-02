import { useRef, useState, type DragEvent } from "react";
import { Button } from "../ui/Button";

/**
 * Pick-a-file modal.
 *
 * Opens when the user clicks "Upload file" (or "Replace"), shows the branch-wide
 * upload restrictions up front, and accepts either a drag-and-dropped file or a
 * browsed selection. The parent owns the upload pipeline — this component only
 * hands back the chosen `File` and closes.
 */
export function UploadPickModal({
	open,
	title,
	subtitle,
	acceptedFormats = "PDF, JPG, PNG, DOC, DOCX",
	maxSizeLabel = "15 MB",
	extraNotes,
	onFileChosen,
	onClose,
}: {
	open: boolean;
	title: string;
	subtitle?: string;
	acceptedFormats?: string;
	maxSizeLabel?: string;
	extraNotes?: string;
	onFileChosen: (file: File) => void;
	onClose: () => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const dragCounter = useRef(0);
	const [dragOver, setDragOver] = useState(false);

	if (!open) return null;

	function onDragEnter(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current += 1;
		if (dragCounter.current === 1) setDragOver(true);
	}
	function onDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current -= 1;
		if (dragCounter.current <= 0) {
			dragCounter.current = 0;
			setDragOver(false);
		}
	}
	function onDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current = 0;
		setDragOver(false);
		const file = e.dataTransfer.files?.[0];
		if (file) onFileChosen(file);
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={title}
			onDragEnter={onDragEnter}
			onDragLeave={onDragLeave}
			onDragOver={onDragOver}
			onDrop={onDrop}
			style={{
				position: "fixed",
				inset: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0,0,0,0.6)",
				zIndex: 9998,
				padding: "1rem",
			}}
		>
			<div
				className="card"
				style={{
					width: "100%",
					maxWidth: "480px",
					padding: "1.5rem",
					boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
				}}
			>
				<p className="eyebrow" style={{ margin: 0 }}>
					{title}
				</p>
				{subtitle ? (
					<p style={{ margin: "0.5rem 0 1rem", fontSize: "0.95rem" }}>{subtitle}</p>
				) : null}

				<div
					className="upload-pick__restrictions"
					style={{
						marginBottom: "1rem",
						padding: "0.75rem 1rem",
						background: "var(--muted)",
						borderRadius: "6px",
						fontSize: "0.85rem",
					}}
				>
					<p
						style={{
							margin: 0,
							fontWeight: 600,
							fontSize: "0.7rem",
							textTransform: "uppercase",
							letterSpacing: "0.06em",
							color: "var(--muted-foreground)",
							fontFamily: "var(--font-mono)",
						}}
					>
						Before you upload
					</p>
					<ul
						style={{
							margin: "0.5rem 0 0",
							paddingLeft: "1.2rem",
							color: "var(--muted-foreground)",
						}}
					>
						<li>
							Accepted formats: <strong>{acceptedFormats}</strong>
						</li>
						<li>
							Maximum size: <strong>{maxSizeLabel}</strong> per file
						</li>
						{extraNotes ? <li>{extraNotes}</li> : null}
					</ul>
				</div>

				<div className={`drop-zone${dragOver ? " drop-zone--active" : ""}`}>
					<p className="drop-zone__label">Drop file here</p>
					<Button size="sm" onClick={() => inputRef.current?.click()}>
						Browse files
					</Button>
					<p className="drop-zone__hint">or drag and drop</p>
				</div>

				<input
					ref={inputRef}
					type="file"
					accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
					hidden
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = "";
						if (file) onFileChosen(file);
					}}
				/>

				<div
					style={{
						display: "flex",
						gap: "0.5rem",
						justifyContent: "flex-end",
						marginTop: "1rem",
					}}
				>
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
