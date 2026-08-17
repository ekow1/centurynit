import { useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { MAX_AVATAR_BYTES } from "century-nit-shared";
import { meApi } from "century-nit-core/api";
import { Button } from "../ui/Button";
import { UploadProgressModal, type UploadStage } from "./UploadProgressModal";
import { cropImage, prepareAvatarForUpload } from "../../lib/upload";

const AVATAR_ACCEPT = "image/jpeg,image/png";

/**
 * The profile-picture flow: pick a photo, crop it to a square, save.
 *
 * Selecting a file opens a crop stage (react-easy-crop) on top of the existing
 * avatar. Saving crops to a square canvas, re-encodes it small, then runs the
 * normal signed-URL upload — with the same progress modal the vault uses.
 */
export function AvatarCropModal({
	open,
	onClose,
	onSaved,
}: {
	open: boolean;
	onClose: () => void;
	/** Called with the fresh signed URL once the upload commits. */
	onSaved: (url: string) => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [src, setSrc] = useState<string | null>(null);
	const [originalType, setOriginalType] = useState("image/jpeg");
	const [originalName, setOriginalName] = useState("photo");
	const [crop, setCrop] = useState({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const [cropPixels, setCropPixels] = useState<Area | null>(null);
	const [phase, setPhase] = useState<"pick" | "crop" | "upload">("pick");
	const [stage, setStage] = useState<UploadStage>("preparing");
	const [percent, setPercent] = useState(0);
	const [error, setError] = useState<string | null>(null);

	function reset() {
		setSrc(null);
		setCrop({ x: 0, y: 0 });
		setZoom(1);
		setCropPixels(null);
		setPhase("pick");
		setStage("preparing");
		setPercent(0);
		setError(null);
	}

	function handleClose() {
		reset();
		onClose();
	}

	function processFile(file: File) {
		setError(null);

		if (!(file.type === "image/jpeg" || file.type === "image/png")) {
			setError("Choose a JPEG or PNG photo.");
			return;
		}
		if (file.size > MAX_AVATAR_BYTES) {
			setError("That photo is larger than 5 MB. Please choose a smaller one.");
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			setOriginalType(file.type);
			setOriginalName(file.name.replace(/\.[^/.]+$/, "") || "photo");
			setSrc(reader.result as string);
			setPhase("crop");
		};
		reader.onerror = () => setError("Could not read that photo. Please try another.");
		reader.readAsDataURL(file);
	}

	function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (file) processFile(file);
	}

	const pickDragCounter = useRef(0);
	const [pickDragOver, setPickDragOver] = useState(false);

	function onPickDragEnter(e: React.DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current += 1;
		if (pickDragCounter.current === 1) setPickDragOver(true);
	}
	function onPickDragLeave(e: React.DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current -= 1;
		if (pickDragCounter.current <= 0) {
			pickDragCounter.current = 0;
			setPickDragOver(false);
		}
	}
	function onPickDragOver(e: React.DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}
	function onPickDrop(e: React.DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		pickDragCounter.current = 0;
		setPickDragOver(false);
		const file = e.dataTransfer.files?.[0];
		if (file) processFile(file);
	}

	async function handleSave() {
		if (!src || !cropPixels) return;
		setPhase("upload");
		setStage("preparing");
		setPercent(0);
		setError(null);

		try {
			const cropped = await cropImage(src, cropPixels, originalType);
			const file = new File([cropped], `${originalName}.${originalType === "image/png" ? "png" : "jpg"}`, {
				type: originalType,
			});
			const ready = await prepareAvatarForUpload(file, (p) => {
				setStage("preparing");
				setPercent(p);
			});
			setStage("uploading");
			setPercent(0);
			const result = await meApi.uploadAvatar(ready, (p) => {
				setStage("uploading");
				setPercent(p);
			});
			setStage("done");
			onSaved(result.url ?? "");
			handleClose();
		} catch (err) {
			setStage("error");
			setError(
				err instanceof Error
					? err.message
					: "Could not upload your photo. Please try again.",
			);
		}
	}

	return (
		<>
			{open && phase === "crop" && src ? (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Crop your photo"
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
							padding: "1.25rem",
							boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.75rem" }}>
							<div>
								<p className="eyebrow" style={{ margin: 0 }}>
									Profile photo
								</p>
								<p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
									Drag to position, pinch or scroll to zoom
								</p>
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={handleClose} style={{ flexShrink: 0 }}>
								Cancel
							</button>
						</div>

						<div style={{ position: "relative", height: 320, background: "#000", borderRadius: 8, overflow: "hidden" }}>
							<Cropper
								image={src}
								crop={crop}
								zoom={zoom}
								aspect={1}
								cropShape="round"
								showGrid
								onCropChange={setCrop}
								onZoomChange={setZoom}
								onCropComplete={(_area, pixels) => setCropPixels(pixels)}
							/>
						</div>

						<div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "1rem 0" }}>
							<span className="muted" style={{ fontSize: "0.75rem" }}>Zoom</span>
							<input
								type="range"
								min={1}
								max={3}
								step={0.01}
								value={zoom}
								onChange={(e) => setZoom(Number(e.target.value))}
								style={{ flex: 1 }}
								aria-label="Zoom"
							/>
						</div>

						{error ? (
							<p role="alert" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "#e53935" }}>
								{error}
							</p>
						) : null}

						<div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
							<Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
								Choose another
							</Button>
							<Button size="sm" onClick={() => void handleSave()} disabled={!cropPixels}>
								Save photo
							</Button>
						</div>
					</div>
				</div>
			) : null}

			{open && phase === "pick" ? (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Add a profile photo"
					onDragEnter={onPickDragEnter}
					onDragLeave={onPickDragLeave}
					onDragOver={onPickDragOver}
					onDrop={onPickDrop}
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
							maxWidth: "420px",
							padding: "1.5rem",
							boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
							position: "relative",
						}}
					>
						<p className="eyebrow" style={{ margin: 0 }}>
							Profile photo
						</p>
						<p style={{ margin: "0.5rem 0 1rem", fontSize: "0.95rem" }}>
							Add a photo so your consultant can recognise you at a glance.
						</p>
						<div
							className={`drop-zone${pickDragOver ? " drop-zone--active" : ""}`}
						>
							<p className="drop-zone__label">
								Drop a photo here
							</p>
							<Button
								size="sm"
								onClick={() => fileRef.current?.click()}
							>
								Browse files
							</Button>
							<p className="drop-zone__hint">
								JPEG or PNG, up to 5 MB
							</p>
						</div>
						{error ? (
							<p role="alert" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "#e53935" }}>
								{error}
							</p>
						) : null}
						<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
							<Button variant="ghost" size="sm" onClick={handleClose}>
								Cancel
							</Button>
						</div>
					</div>
				</div>
			) : null}

			<input
				ref={fileRef}
				type="file"
				accept={AVATAR_ACCEPT}
				hidden
				onChange={handleFile}
			/>

			<UploadProgressModal
				open={open && phase === "upload"}
				fileName={originalName}
				stage={stage}
				percent={percent}
				error={error}
				onClose={handleClose}
			/>
		</>
	);
}
