import { useRef, useState } from "react";
import { post } from "./mkt";
import { MERGE_FIELDS, type EmailBlock } from "./mkt";

/**
 * The block composer — palette on the left, ordered blocks in the middle,
 * merge-field picker and a server-rendered preview on the right. Campaigns
 * and templates both edit this model; the API renders blocks → the same
 * table layout the worker sends.
 */

const PALETTE: { type: EmailBlock["type"]; label: string; hint: string }[] = [
	{ type: "heading", label: "Heading", hint: "Section title" },
	{ type: "paragraph", label: "Paragraph", hint: "Body copy" },
	{ type: "button", label: "Button", hint: "Link CTA" },
	{ type: "two_col", label: "Two columns", hint: "Side-by-side" },
	{ type: "divider", label: "Divider", hint: "Rule line" },
];

function newBlock(type: EmailBlock["type"]): EmailBlock {
	switch (type) {
		case "heading":
			return { type, text: "Section heading" };
		case "paragraph":
			return { type, text: "Write something…" };
		case "button":
			return { type, text: "Open your portal", url: "{{portal_link}}" };
		case "two_col":
			return { type, left: "Left column", right: "Right column" };
		case "divider":
			return { type };
	}
}

export function Composer({
	blocks,
	onChange,
	subject,
	onSubject,
	preheader,
	onPreheader,
	sampleEmail,
	showSendFields,
	fromName,
	onFromName,
	replyTo,
	onReplyTo,
}: {
	blocks: EmailBlock[];
	onChange: (b: EmailBlock[]) => void;
	subject: string;
	onSubject: (v: string) => void;
	preheader?: string;
	onPreheader?: (v: string) => void;
	/** Email to merge the preview against — a real recipient's context. */
	sampleEmail?: string;
	/** Campaigns only — sender identity + preheader. */
	showSendFields?: boolean;
	fromName?: string;
	onFromName?: (v: string) => void;
	replyTo?: string;
	onReplyTo?: (v: string) => void;
}) {
	const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
	const [previewBusy, setPreviewBusy] = useState(false);
	const [dragFrom, setDragFrom] = useState<number | null>(null);
	const bodyRef = useRef<HTMLTextAreaElement | null>(null);

	const update = (i: number, patch: Partial<EmailBlock>) =>
		onChange(blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as EmailBlock) : b)));
	const move = (from: number, to: number) => {
		if (to < 0 || to >= blocks.length) return;
		const next = [...blocks];
		const [b] = next.splice(from, 1);
		next.splice(to, 0, b);
		onChange(next);
	};

	async function renderPreview() {
		setPreviewBusy(true);
		try {
			const res = await post<{ html: string; subject: string }>("/campaigns/preview", {
				subject,
				blocks,
				preheader: preheader || undefined,
				sampleEmail: sampleEmail || undefined,
			});
			setPreview(res);
		} finally {
			setPreviewBusy(false);
		}
	}

	const insertToken = (token: string) => {
		// Append into the last paragraph/heading block, or a fresh paragraph.
		const idx = [...blocks].reverse().findIndex((b) => b.type === "paragraph" || b.type === "heading");
		if (idx === -1) {
			onChange([...blocks, { type: "paragraph", text: token }]);
			return;
		}
		const i = blocks.length - 1 - idx;
		const b = blocks[i];
		if (b.type === "paragraph" || b.type === "heading") update(i, { text: `${b.text}${b.text.endsWith(" ") || b.text === "" ? "" : " "}${token}` });
	};

	return (
		<div className="composer">
			<div className="composer__main">
				<label className="label">
					Subject
					<input className="input" value={subject} onChange={(e) => onSubject(e.target.value)} placeholder="Subject line" />
				</label>
				{showSendFields && (
					<div className="composer__sendgrid">
						<label className="label">
							Preheader
							<input className="input" value={preheader ?? ""} onChange={(e) => onPreheader?.(e.target.value)} placeholder="Inbox preview text" />
						</label>
						<label className="label">
							From name
							<input className="input" value={fromName ?? ""} onChange={(e) => onFromName?.(e.target.value)} placeholder="Century NIT · Accra" />
						</label>
						<label className="label">
							Reply-to
							<input className="input" value={replyTo ?? ""} onChange={(e) => onReplyTo?.(e.target.value)} placeholder="accra@centurynit.com" />
						</label>
					</div>
				)}

				<div className="composer__blocks">
					{blocks.length === 0 && <p className="muted">Pick a block to start the email.</p>}
					{blocks.map((b, i) => (
						<div
							key={i}
							className="composer__block"
							draggable
							onDragStart={() => setDragFrom(i)}
							onDragOver={(e) => e.preventDefault()}
							onDrop={() => {
								if (dragFrom !== null && dragFrom !== i) move(dragFrom, i);
								setDragFrom(null);
							}}
						>
							<div className="composer__blockbar">
								<span className="mkt-chip">{b.type.replace("_", " ")}</span>
								<span className="composer__blockops">
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => move(i, i - 1)} aria-label="Move up">↑</button>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => move(i, i + 1)} aria-label="Move down">↓</button>
									<button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(blocks.filter((_, j) => j !== i))} aria-label="Remove">×</button>
								</span>
							</div>
							{b.type === "heading" && (
								<input className="input" value={b.text} onChange={(e) => update(i, { text: e.target.value })} />
							)}
							{b.type === "paragraph" && (
								<textarea ref={bodyRef} className="input" rows={3} value={b.text} onChange={(e) => update(i, { text: e.target.value })} />
							)}
							{b.type === "button" && (
								<div className="composer__btnrow">
									<input className="input" value={b.text} onChange={(e) => update(i, { text: e.target.value })} placeholder="Button text" />
									<input className="input" value={b.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://… or {{portal_link}}" />
								</div>
							)}
							{b.type === "two_col" && (
								<div className="composer__btnrow">
									<textarea className="input" rows={3} value={b.left} onChange={(e) => update(i, { left: e.target.value })} />
									<textarea className="input" rows={3} value={b.right} onChange={(e) => update(i, { right: e.target.value })} />
								</div>
							)}
						</div>
					))}
				</div>
			</div>

			<aside className="composer__side">
				<div className="composer__palette">
					<div className="label">Blocks</div>
					{PALETTE.map((p) => (
						<button key={p.type} type="button" className="composer__paletteitem" onClick={() => onChange([...blocks, newBlock(p.type)])}>
							<strong>{p.label}</strong>
							<span>{p.hint}</span>
						</button>
					))}
				</div>
				<div className="composer__merges">
					<div className="label">Merge fields</div>
					{MERGE_FIELDS.map((f) => (
						<button key={f.token} type="button" className="composer__merge" title={f.label} onClick={() => insertToken(f.token)}>
							{f.token}
						</button>
					))}
				</div>
				<button type="button" className="btn btn--primary" onClick={renderPreview} disabled={previewBusy}>
					{previewBusy ? "Rendering…" : sampleEmail ? `Preview as ${sampleEmail}` : "Server preview"}
				</button>
				{preview && (
					<div className="composer__preview">
						<div className="label">Preview — {preview.subject}</div>
						<iframe title="Email preview" sandbox="" srcDoc={preview.html} className="composer__previewframe" />
					</div>
				)}
			</aside>
		</div>
	);
}
