import { useEffect, useState } from "react";
import { documentsApi } from "century-nit-core/api";
import { formatBytes, openInNewTab } from "century-nit-core";
import type { ApplicantDocument } from "century-nit-shared";
import { Button } from "../ui/Button";
import { useNotifier } from "../notifier/Notifier";
import { useMediaQuery } from "../../hooks/useMediaQuery";

export const STATUS_META: Record<string, { label: string; pill: string }> = {
	missing: { label: "Missing", pill: "portal-pill--hollow" },
	uploaded: { label: "In review", pill: "portal-pill--hollow" },
	verified: { label: "Verified", pill: "portal-pill--solid" },
	rejected: { label: "Resubmit", pill: "portal-pill--act" },
};

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function DocumentSheet({
	row,
	onClose,
	onReplace,
	onRemove,
	busy,
}: {
	row: { id: string; name: string; status: string; live: ApplicantDocument; history: ApplicantDocument[] };
	onClose: () => void;
	onReplace: () => void;
	onRemove?: () => void;
	busy: boolean;
}) {
	const { toast } = useNotifier();
	const mobile = useMediaQuery("(max-width: 900px)");
	const [result, setResult] = useState<{ id: string; url?: string; error?: string } | null>(null);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const docId = row.live.id;
		documentsApi
			.downloadUrl(docId, { inline: true })
			.then((t) => {
				if (!cancelled) setResult({ id: docId, url: t.url });
			})
			.catch((err) => {
				if (!cancelled) setResult({ id: docId, error: err instanceof Error ? err.message : "Could not load the document." });
			});
		return () => {
			cancelled = true;
		};
	}, [row.live.id, tick]);

	const current = result?.id === row.live.id ? result : null;
	const url = current?.url ?? null;
	const loadError = current?.error ?? null;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	useEffect(() => {
		if (!mobile) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, [mobile]);

	const doc = row.live;
	const statusLabel = STATUS_META[row.status]?.label ?? row.status;
	const isImage = IMAGE_FILE.test(doc.fileName);

	async function openTab(inline: boolean) {
		try {
			await openInNewTab(documentsApi.downloadUrl(doc.id, inline ? { inline: true } : undefined));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not open that document.");
		}
	}

	return (
		<div className="dsheet">
			<div className="dsheet__handle" />
			<button type="button" className="dsheet__close" aria-label="Close preview" onClick={onClose}>
				×
			</button>
			<p className="eyebrow">
				{row.name} · {statusLabel}
			</p>
			<p className="mono muted" style={{ fontSize: "0.68rem", marginTop: "0.2rem" }}>
				{doc.fileName}
				{doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ""} · uploaded {fmtDay(doc.uploadedAt ?? doc.createdAt)}
			</p>
			{loadError ? (
				<div className="dsheet__frame" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.5rem", padding: "1rem" }}>
					<p className="mono" style={{ fontSize: "0.7rem" }}>{loadError}</p>
					<p className="muted" style={{ fontSize: "0.7rem" }}>The signed link may have expired or storage is unavailable.</p>
					<Button type="button" variant="ghost" size="sm" onClick={() => { setResult(null); setTick((t) => t + 1); }}>
						Retry
					</Button>
				</div>
			) : url ? (
				isImage ? (
					<img className="dsheet__frame" src={url} alt={doc.fileName} style={{ objectFit: "contain" }} />
				) : doc.contentType === "application/pdf" || doc.fileName.toLowerCase().endsWith(".pdf") ? (
					<iframe className="dsheet__frame" title={doc.fileName} src={url} />
				) : (
					<div className="dsheet__frame" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
						<p className="mono muted" style={{ fontSize: "0.7rem" }}>Preview not available for this format — download it.</p>
					</div>
				)
			) : (
				<div className="dsheet__frame" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
					<p className="mono muted" style={{ fontSize: "0.7rem" }}>Loading document…</p>
				</div>
			)}
			{doc.reviewNote ? (
				<div className="drow__note">
					<strong>Your consultant{doc.reviewedAt ? ` · ${fmtDay(doc.reviewedAt)}` : ""}:</strong> {doc.reviewNote}
				</div>
			) : null}
			<div className="dsheet__acts">
				{row.status !== "verified" ? (
					<Button type="button" variant="primary" size="sm" onClick={onReplace} disabled={busy}>
						{busy ? "Working…" : "Replace"}
					</Button>
				) : null}
				<Button type="button" variant="ghost" size="sm" onClick={() => void openTab(false)}>
					Download ↓
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={() => void openTab(true)}>
					Open in tab ↗
				</Button>
				{onRemove ? (
					<Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={busy}>
						Remove
					</Button>
				) : null}
			</div>
			{row.history.length > 1 ? (
				<>
					<p className="eyebrow" style={{ marginTop: "1rem" }}>History</p>
					<ol className="dsheet__hist">
						{row.history.flatMap((d) => {
							const items = [];
							if (d.status === "REJECTED" && d.reviewNote) {
								items.push(
									<li key={`${d.id}-r`}>
										{d.id === row.live.id ? "●" : "○"} {d.reviewedAt ? `${fmtDay(d.reviewedAt)} · ` : ""}Rejected · {d.reviewNote}
									</li>,
								);
							}
							items.push(
								<li key={d.id}>
									{d.id === row.live.id ? "●" : "○"} {fmtDay(d.uploadedAt ?? d.createdAt)} · Uploaded · {d.fileName}
								</li>,
							);
							return items;
						})}
					</ol>
				</>
			) : null}
		</div>
	);
}
