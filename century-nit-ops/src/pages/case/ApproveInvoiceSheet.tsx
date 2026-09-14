import { useEffect, useState } from "react";
import { Sheet, formatMoney } from "century-nit-core/ui";
import { INVOICE_TYPE_LABELS } from "century-nit-shared";
import { issueInvoice, voidInvoice, type ApiInvoice } from "../../lib/api";
import { optionalItemsFor, useFeeCatalogue } from "../../hooks/useFeeCatalogue";
import { centsFromGhs, ghsOfCents } from "../currency";

/**
 * Approval happens in the case, on the invoice card: the reviewer sees the
 * lines the raiser put together, adjusts them if needed, sets the due date
 * and the note the client reads, and issues — or declines with a reason,
 * which voids the draft. The raiser stays on the record; the approver is
 * written next to them.
 */

type Line = { key: string; label: string; detail: string; amount: string; schoolApplicationId: string | null };

function fromInvoice(inv: ApiInvoice): Line[] {
	return inv.lines.map((l) => ({
		key: l.id,
		label: l.label,
		detail: l.detail ?? "",
		amount: ghsOfCents(l.amountCents).toFixed(2),
		schoolApplicationId: l.schoolApplicationId ?? null,
	}));
}

function cents(v: string): number {
	const n = Number(v.replace(/[^0-9.]/g, ""));
	return Number.isNaN(n) ? 0 : centsFromGhs(n);
}

export function ApproveInvoiceSheet({
	invoice,
	onClose,
	onIssued,
	onDeclined,
}: {
	/** The draft to review; `null` keeps the sheet closed. */
	invoice: ApiInvoice | null;
	onClose: () => void;
	onIssued: (updated: ApiInvoice) => void;
	onDeclined?: (voided: ApiInvoice) => void;
}) {
	const [lines, setLines] = useState<Line[]>([]);
	const [note, setNote] = useState("");
	const [dueAt, setDueAt] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [declining, setDeclining] = useState(false);
	const [reason, setReason] = useState("");
	const { catalogue } = useFeeCatalogue();
	const optional = invoice ? optionalItemsFor(catalogue, invoice.type) : [];

	useEffect(() => {
		if (!invoice) return;
		setLines(fromInvoice(invoice));
		setNote(invoice.note && !invoice.note.startsWith("Proforma estimate for") ? invoice.note : "");
		setDueAt(invoice.dueAt ? invoice.dueAt.slice(0, 10) : new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
		setError(null);
		setDeclining(false);
		setReason("");
	}, [invoice]);

	const total = lines.reduce((n, l) => n + cents(l.amount), 0);
	const open = Boolean(invoice);

	async function approve() {
		if (!invoice) return;
		setBusy(true);
		setError(null);
		try {
			const updated = await issueInvoice(invoice.id, {
				lines: lines.map((l) => ({
					label: l.label.trim(),
					detail: l.detail.trim() || undefined,
					amountCents: cents(l.amount),
					schoolApplicationId: l.schoolApplicationId,
				})),
				note: note.trim() || undefined,
				dueAt: dueAt ? `${dueAt}T00:00:00.000Z` : undefined,
			});
			onIssued(updated);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not issue the invoice");
		} finally {
			setBusy(false);
		}
	}

	async function decline() {
		if (!invoice || !reason.trim()) return;
		setBusy(true);
		setError(null);
		try {
			const voided = await voidInvoice(invoice.id, reason.trim());
			onDeclined?.(voided);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not decline the invoice");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onClose={onClose} title={invoice ? `Approve ${INVOICE_TYPE_LABELS[invoice.type] ?? invoice.type} invoice` : "Approve invoice"}>
			{invoice && (
				<div className="cn-stack">
					<p className="muted text-sm">
						{invoice.invoiceNumber} · raised by {invoice.raisedByName ?? invoice.issuedByName}
						{invoice.raisedAt && ` on ${new Date(invoice.raisedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`} for {invoice.applicantName}.
						Check the lines, set the due date, and issue — the client is told and can pay.
					</p>

					<div className="cn-stack" style={{ gap: "0.4rem" }}>
						<div className="rl-head">
							<span>Line</span>
							<span>Detail the client reads</span>
							<span style={{ textAlign: "right" }}>GH₵</span>
							<span />
						</div>
						{lines.map((l, idx) => (
							<div key={l.key} className="rl-row">
								<input className="input input--sm" value={l.label} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))} placeholder="Line" />
								<input className="input input--sm" value={l.detail} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, detail: e.target.value } : x)))} placeholder="Detail" />
								<input className="input input--sm su-mono" inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} placeholder="0.00" style={{ textAlign: "right" }} />
								<button type="button" className="btn btn--ghost btn--sm" style={{ padding: "0.2rem 0.4rem" }} onClick={() => setLines(lines.filter((_, i) => i !== idx))} title="Remove line">
									✕
								</button>
							</div>
						))}
						<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
							<button
								type="button"
								className="btn btn--ghost btn--sm"
								onClick={() => setLines([...lines, { key: `new-${Date.now()}`, label: "", detail: "", amount: "0.00", schoolApplicationId: null }])}
							>
								+ Add line
							</button>
							{optional.length > 0 && (
								<select
									className="input input--sm"
									style={{ width: "auto" }}
									value=""
									onChange={(e) => {
										const item = optional.find((i) => i.key === e.target.value);
										if (!item) return;
										setLines([...lines, { key: `fee-${item.key}-${Date.now()}`, label: item.clientLabel, detail: item.description ?? "", amount: (item.amountCents / 100).toFixed(2), schoolApplicationId: null }]);
									}}
									aria-label="Add a catalogue item"
								>
									<option value="">+ From the fee schedule…</option>
									{optional.map((i) => (
										<option key={i.key} value={i.key}>
											{i.name} · GH₵{ghsOfCents(i.amountCents).toLocaleString()}
										</option>
									))}
								</select>
							)}
						</div>
					</div>

					<div className="cn-facts">
						<label>
							<span className="muted text-xs">Due date</span>
							<input className="input input--sm" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
						</label>
						<label>
							<span className="muted text-xs">Note the client reads</span>
							<input className="input input--sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
						</label>
					</div>

					<div className="rl-total">
						<span className="su-k">Total · {lines.length} line{lines.length === 1 ? "" : "s"}</span>
						<b>{formatMoney(total, "both")}</b>
					</div>

					{declining ? (
						<div style={{ border: "1px solid var(--danger, #b91c1c)", padding: "0.6rem 0.75rem" }}>
							<p className="muted text-xs" style={{ marginBottom: "0.25rem" }}>
								Reason — the draft is voided and the raiser sees why in the case history
							</p>
							<input className="input input--sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong package — raise again with the 5-school fee" autoFocus />
							<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
								<button type="button" className="btn btn--sm btn--ghost" onClick={() => setDeclining(false)} disabled={busy}>
									Back
								</button>
								<button type="button" className="btn btn--sm btn--primary" onClick={decline} disabled={busy || !reason.trim()}>
									{busy ? "Declining…" : "Decline & void"}
								</button>
							</div>
						</div>
					) : (
						<div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between", flexWrap: "wrap" }}>
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setDeclining(true)} disabled={busy}>
								Decline…
							</button>
							<div style={{ display: "flex", gap: "0.5rem" }}>
								<button type="button" className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
									Cancel
								</button>
								<button type="button" className="btn btn--sm btn--primary" onClick={approve} disabled={busy || lines.length === 0 || total <= 0 || lines.some((l) => !l.label.trim())}>
									{busy ? "Issuing…" : "Approve & issue"}
								</button>
							</div>
						</div>
					)}
					{error && <p className="cn-assign__error">{error}</p>}
				</div>
			)}
		</Sheet>
	);
}
