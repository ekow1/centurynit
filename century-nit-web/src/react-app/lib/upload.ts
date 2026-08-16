import imageCompression from "browser-image-compression";
import { MAX_AVATAR_BYTES, MAX_DOCUMENT_BYTES } from "century-nit-shared";

/**
 * Client-side preparation for the two upload paths.
 *
 * Images are re-encoded in the browser so they fit comfortably under the size
 * ceiling; PDFs and Word documents cannot be recompressed in a browser, so they
 * pass through untouched and their limit is enforced by the server. Nothing here
 * is a security boundary — the server re-checks type and size before issuing a
 * signed URL.
 */

/** Images at or above this are re-encoded; smaller files keep their bytes. */
const IMAGE_COMPRESS_THRESHOLD_BYTES = 8 * 1024 * 1024;

function compressToFit(
	file: File,
	maxBytes: number,
	maxWidthOrHeight: number | undefined,
	onProgress?: (percent: number) => void,
): Promise<File> {
	return imageCompression(file, {
		// Target 80% of the ceiling so the binary search has room to land under it.
		maxSizeMB: (maxBytes * 0.8) / (1024 * 1024),
		...(maxWidthOrHeight ? { maxWidthOrHeight } : {}),
		useWebWorker: false,
		initialQuality: 0.9,
		onProgress,
	});
}

/**
 * Prepare a document for upload.
 *
 * Images are compressed only when they are large enough to matter — a small
 * scan keeps its original bytes, so no quality is traded for no reason. Any
 * non-image, or an image that could not be re-encoded, is returned unchanged.
 */
export function prepareDocumentForUpload(
	file: File,
	onProgress?: (percent: number) => void,
): Promise<File> {
	if (!file.type.startsWith("image/")) return Promise.resolve(file);
	if (file.size <= IMAGE_COMPRESS_THRESHOLD_BYTES) return Promise.resolve(file);
	return compressToFit(file, MAX_DOCUMENT_BYTES, undefined, onProgress).catch(() => file);
}

/**
 * Prepare an avatar photo.
 *
 * The photo is already cropped to a square before this runs; this just keeps
 * the stored file small — 1024 px is plenty for any avatar slot.
 */
export function prepareAvatarForUpload(
	file: File,
	onProgress?: (percent: number) => void,
): Promise<File> {
	return compressToFit(file, MAX_AVATAR_BYTES, 1024, onProgress).catch(() => file);
}

export type CropRect = { x: number; y: number; width: number; height: number };

/**
 * Cut a region out of an image and return it as a Blob.
 *
 * Used after the crop modal settles on its selection; the numbers come from
 * `react-easy-crop`'s `croppedAreaPixels`, in source-image pixels.
 */
export function cropImage(
	imageSrc: string,
	crop: CropRect,
	fileType = "image/jpeg",
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(crop.width));
			canvas.height = Math.max(1, Math.round(crop.height));
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Canvas is not supported in this browser"));
				return;
			}
			ctx.drawImage(
				image,
				crop.x,
				crop.y,
				crop.width,
				crop.height,
				0,
				0,
				canvas.width,
				canvas.height,
			);
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("Could not crop the image"))),
				fileType,
				0.92,
			);
		};
		image.onerror = () => reject(new Error("Could not load the image"));
		image.src = imageSrc;
	});
}
