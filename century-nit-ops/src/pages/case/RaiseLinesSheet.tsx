import { useEffect, useState } from "react";
import { Sheet, formatMoney } from "century-nit-core/ui";
import { centsFromGhs, ghsOfCents } from "../currency";

/**
 * The officer raises an invoice with the lines in front of them — the
 * application invoice from the school list and the catalogue, the visa
 * invoice from the destination's tariff. The suggested lines only pre-fill:
 * change an amount, zero one, add a line, remove one, write the note. It
 * is raised awaiting approval; finance approves and issues it; the client
 * sees it once issued. Amounts are entered in cedis — what the client
 * pays — and written to the ledger as USD cents at the same rate.
 */

export type RaiseLine = { key: string; label: string; detail: string; amount: string; schoolApplicationId: string | null };

function cents(v: string): number {
	const n = Number(v.replace(/[^0-9.]/g, ""));
	return Number.isNaN(n) ? 0 : centsFromGhs(n);
}

export function RaiseLinesSheet({
	open,
	title,
	intro,
	suggested,
	sees,
	cta = "Raise for approval →",
	onRaise,
	onClose,
}: {
	open: boolean;
	title: string;
	intro: string;
	/** The lines the sheet starts from; refreshed each time it opens. */
	suggested: { label: string; detail?: string | null; amountCents: number; schoolApplicationId?: string | null }[] | null;
	/** What the client will see once issued — one line. */
	sees: (totalCents: number, count: number) => string;
	cta?: string;
	onRaise: (input: { lines: { label: string; detail?: string; amountCents: number; schoolApplicationId?: string | null }[]; note?: string }) => Promise<void>;
	onClose: () => void;
}) {
	const [lines, setLines] = useState<RaiseLine[]>([]);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setLines(
			(suggested ?? []).map((l, i) => ({
				key: `s${i}`,
				label: l.label,
				detail: l.detail ?? "",
				amount: ghsOfCents(l.amountCents).toFixed(2),
				schoolApplicationId: l.schoolApplicationId ?? null,
			})),
		);
		setNote("");
		setError(null);
	}, [open, suggested]);

	const total = lines.reduce((n, l) => n + cents(l.amount), 0);
	const ready = lines.length > 0 && lines.every((l) => l.label.trim()) && total > 0;

	async function raise() {
		setBusy(true);
		setError(null);
		try {
			await onRaise({
				lines: lines.map((l) => ({ label: l.label.trim(), detail: l.detail.trim() || undefined, amountCents: cents(l.amount), schoolApplicationId: l.schoolApplicationId })),
				note: note.trim() || undefined,
			});
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not raise the invoice");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onClose={() => (busy ? undefined : onClose())} title={title}>
			<div className="cn-stack">
				<p className="muted text-sm">{intro}</p>
				{suggested === null ? (
					<p className="muted text-xs">Reading the catalogue…</p>
				) : (
					<div className="cn-stack" style={{ gap: "0.4rem" }}>
						<div className="rl-head">
							<span>Line</span>
							<span>Detail the client reads</span>
							<span style={{ textAlign: "right" }}>GH₵</span>
							<span />
						</div>
						{lines.map((l, idx) => (
							<div key={l.key} className="rl-row">
								<input className="input input--sm" value={l.label} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))} placeholder="What for" />
								<input className="input input--sm" value={l.detail} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, detail: e.target.value } : x)))} placeholder="Detail (optional)" />
								<input className="input input--sm su-mono" inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} placeholder="0.00" style={{ textAlign: "right" }} />
								<button type="button" className="btn btn--ghost btn--sm" style={{ padding: "0.2rem 0.4rem" }} onClick={() => setLines(lines.filter((_, i) => i !== idx))} title="Remove line">
									✕
								</button>
							</div>
						))}
						<div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setLines([...lines, { key: `l${Date.now()}`, label: "", detail: "", amount: "", schoolApplicationId: null }])}>
								+ Add a line
							</button>
						</div>
					</div>
				)}
				<label className="su-fld">
					<span className="su-k">Note the client reads (optional)</span>
					<input className="input input--sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UCL's fee is waived on the scholarship route" />
				</label>
				<div className="rl-total">
					<span className="su-k">Total · {lines.length} line{lines.length === 1 ? "" : "s"}</span>
					<b>{formatMoney(total, "both")}</b>
				</div>
				{total > 0 && <p className="su-preview"><span className="su-k">The client will see</span>{sees(total, lines.length)}</p>}
				{error && <p className="cn-assign__error">{error}</p>}
				<div className="cn-assign__row" style={{ justifyContent: "flex-end" }}>
					<button type="button" className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
						Cancel
					</button>
					<button type="button" className="btn btn--sm btn--primary" onClick={() => void raise()} disabled={busy || !ready}>
						{busy ? "Raising…" : cta}
					</button>
				</div>
			</div>
		</Sheet>
	);
}
