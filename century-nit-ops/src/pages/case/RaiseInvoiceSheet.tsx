import { useState } from "react";
import { Sheet, formatMoney } from "century-nit-core/ui";
import type { MockApplication } from "century-nit-core/ops";
import { createInvoice, type ApiInvoice } from "../../lib/api";
import { FEE_KIND_LABELS } from "century-nit-shared";
import { useFeeCatalogue } from "../../hooks/useFeeCatalogue";
import { centsFromGhs, ghsOfCents } from "../currency";

/**
 * Anything the journey does not raise on its own — a courier fee, a
 * translation, an extra school beyond the package — is raised here, on the
 * case, by whoever works it. It is born awaiting approval like every other
 * invoice; the client sees it once it is issued.
 */

type Line = { key: string; label: string; detail: string; amount: string };

function cents(v: string): number {
	const n = Number(v.replace(/[^0-9.]/g, ""));
	return Number.isNaN(n) ? 0 : centsFromGhs(n);
}

export function RaiseInvoiceSheet({
	app,
	open,
	onClose,
	onRaised,
}: {
	app: MockApplication;
	open: boolean;
	onClose: () => void;
	onRaised: (raised: ApiInvoice) => void;
}) {
	const [lines, setLines] = useState<Line[]>([{ key: "l1", label: "", detail: "", amount: "" }]);
	const { catalogue } = useFeeCatalogue();
	// Anything in the schedule can be raised here; the consultation is booked, not raised.
	const fromCatalogue = (catalogue?.items ?? []).filter((i) => i.active && i.key !== "consultation");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const total = lines.reduce((n, l) => n + cents(l.amount), 0);
	const ready = lines.length > 0 && lines.every((l) => l.label.trim() && cents(l.amount) > 0);

	async function raise() {
		setBusy(true);
		setError(null);
		try {
			const raised = await createInvoice({
				applicantName: app.applicantName,
				applicantEmail: app.email || undefined,
				clientUserId: app.applicantUserId ?? undefined,
				applicationId: app.id,
				type: "custom",
				lines: lines.map((l) => ({ label: l.label.trim(), detail: l.detail.trim() || undefined, amountCents: cents(l.amount) })),
				note: note.trim() || undefined,
			});
			onRaised(raised);
			setLines([{ key: "l1", label: "", detail: "", amount: "" }]);
			setNote("");
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not raise the invoice");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onClose={onClose} title="Raise an invoice">
			<div className="cn-stack">
				<p className="muted text-sm">
					For {app.applicantName} · {app.appId}. Raised awaiting approval — the client sees it once it is issued.
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
							<input className="input input--sm" value={l.label} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))} placeholder="What for — e.g. Courier to embassy" />
							<input className="input input--sm" value={l.detail} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, detail: e.target.value } : x)))} placeholder="Detail (optional)" />
							<input className="input input--sm su-mono" inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} placeholder="0.00" style={{ textAlign: "right" }} />
							<button type="button" className="btn btn--ghost btn--sm" style={{ padding: "0.2rem 0.4rem" }} onClick={() => setLines(lines.filter((_, i) => i !== idx))} disabled={lines.length === 1} title="Remove line">
								✕
							</button>
						</div>
					))}
					<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setLines([...lines, { key: `l${Date.now()}`, label: "", detail: "", amount: "" }])}>
							+ Add line
						</button>
						{fromCatalogue.length > 0 && (
							<select
								className="input input--sm"
								style={{ width: "auto" }}
								value=""
								onChange={(e) => {
									const item = fromCatalogue.find((i) => i.key === e.target.value);
									if (!item) return;
									const blank = lines.length === 1 && !lines[0].label && !lines[0].amount;
									const next = { key: `fee-${item.key}-${Date.now()}`, label: item.clientLabel, detail: item.description ?? "", amount: ghsOfCents(item.amountCents).toFixed(2) };
									setLines(blank ? [next] : [...lines, next]);
								}}
								aria-label="Add a catalogue item"
							>
								<option value="">+ From the fee schedule…</option>
								{fromCatalogue.map((i) => (
									<option key={i.key} value={i.key}>
										{FEE_KIND_LABELS[i.kind]} · {i.name} · GH₵{ghsOfCents(i.amountCents).toLocaleString()}
									</option>
								))}
							</select>
						)}
					</div>
				</div>
				<label>
					<span className="muted text-xs">Note the client reads (optional)</span>
					<input className="input input--sm" value={note} onChange={(e) => setNote(e.target.value)} />
				</label>
				<div className="rl-total">
					<span className="su-k">Total · {lines.length} line{lines.length === 1 ? "" : "s"}</span>
					<b>{formatMoney(total, "both")}</b>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
					<button type="button" className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
						Cancel
					</button>
					<button type="button" className="btn btn--sm btn--primary" onClick={raise} disabled={busy || !ready}>
						{busy ? "Raising…" : "Raise for approval"}
					</button>
				</div>
				{error && <p className="cn-assign__error">{error}</p>}
			</div>
		</Sheet>
	);
}
