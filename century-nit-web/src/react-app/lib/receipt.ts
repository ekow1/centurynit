import type { ApiInvoice } from "century-nit-shared";
import { INVOICE_STATUS_LABELS } from "century-nit-shared";
import { formatMoney } from "century-nit-core/ui";

function esc(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const CHAPTERS: Record<string, string> = {
	consultation: "Chapter I · Consultation",
	agency: "Chapter II · Enrolment",
	application: "Chapter III · Applications",
	visa: "Chapter IV · Visa",
	travel: "Chapter V · Departure",
};

const dateFmt = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const DOC_CSS = `
	*{box-sizing:border-box;margin:0}
	body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#fff;color:#0a0a0a;font-size:.875rem}
	.mono{font-family:ui-monospace,"Cascadia Code",Consolas,monospace}
	.muted{color:#52525b}
	.doc{max-width:820px;margin:0 auto;padding:2.5rem 1.5rem 3rem}
	.doc__head{background:#0a0a0a;color:#fff;padding:1.75rem 2.5rem;display:flex;justify-content:space-between;align-items:flex-end;gap:2rem}
	.seal{display:inline-block;border:1.5px solid #fff;padding:.25rem .55rem;font-family:ui-monospace,Consolas,monospace;font-size:.62rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase}
	.co{font-family:Georgia,serif;font-size:1.35rem;font-weight:700;margin-top:.55rem}
	.addr{font-size:.68rem;opacity:.7;margin-top:.25rem;line-height:1.6}
	.kind{text-align:right}
	.kind .k{font-family:ui-monospace,Consolas,monospace;font-size:.62rem;letter-spacing:.15em;text-transform:uppercase;opacity:.65}
	.kind .no{font-family:ui-monospace,Consolas,monospace;font-size:1.4rem;font-weight:800;margin-top:.2rem}
	.kind .st{display:inline-block;border:1.5px solid #fff;padding:.15rem .6rem;margin-top:.5rem;font-family:ui-monospace,Consolas,monospace;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase}
	.paid{display:flex;align-items:center;gap:1.25rem;padding:1.5rem 2.5rem;border-bottom:1.5px solid #0a0a0a}
	.paid__seal{border:2px solid #0a0a0a;padding:.45rem .9rem;font-weight:800;letter-spacing:.2em;font-family:ui-monospace,Consolas,monospace;font-size:.8rem}
	.paid__amt{font-family:Georgia,serif;font-size:1.9rem;font-weight:800;letter-spacing:-.02em}
	.paid__when{font-size:.72rem;color:#52525b;margin-top:.2rem;font-family:ui-monospace,Consolas,monospace}
	.meta{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1.5px solid #0a0a0a}
	.meta>div{padding:1rem 1.25rem;border-right:1px solid #d4d4d8}
	.meta>div:last-child{border-right:none}
	.meta .k{font-family:ui-monospace,Consolas,monospace;font-size:.58rem;text-transform:uppercase;letter-spacing:.1em;color:#52525b}
	.meta .v{font-weight:650;font-size:.85rem;margin-top:.3rem}
	.meta .v small{display:block;font-weight:400;color:#52525b;font-size:.72rem;margin-top:.1rem}
	.lines{width:100%;border-collapse:collapse}
	.lines th{font-family:ui-monospace,Consolas,monospace;font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:#52525b;text-align:left;padding:.7rem 1.25rem;border-bottom:1.5px solid #0a0a0a}
	.lines th:last-child,.lines td:last-child{text-align:right}
	.lines td{padding:.85rem 1.25rem;border-bottom:1px solid #d4d4d8;vertical-align:top}
	.lines td small{display:block;color:#52525b;font-size:.72rem;margin-top:.15rem}
	.lines .amt{font-family:ui-monospace,Consolas,monospace;font-weight:600;white-space:nowrap}
	.totals{display:flex;justify-content:flex-end}
	.totals>div{width:20rem}
	.trow{display:flex;justify-content:space-between;padding:.6rem 1.25rem;font-size:.85rem;border-bottom:1px solid #d4d4d8}
	.trow .amt{font-family:ui-monospace,Consolas,monospace;font-weight:600}
	.trow--inv{background:#0a0a0a;color:#fff;border-bottom:none}
	.trow--inv .amt{font-weight:800;font-size:1.05rem}
	.trow--inv .k{font-family:ui-monospace,Consolas,monospace;font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;padding-top:.35rem}
	.terms{display:grid;grid-template-columns:1fr 1fr;border-top:1.5px solid #0a0a0a;margin-top:1.5rem}
	.terms>div{padding:1.25rem 1.5rem;font-size:.72rem;color:#52525b;line-height:1.65}
	.terms>div:first-child{border-right:1px solid #d4d4d8}
	.terms .h{font-family:ui-monospace,Consolas,monospace;font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:#0a0a0a;margin-bottom:.4rem}
	.foot{border-top:1px solid #d4d4d8;padding:.9rem 1.5rem;display:flex;justify-content:space-between;font-family:ui-monospace,Consolas,monospace;font-size:.62rem;color:#52525b;margin-top:1.5rem}
	.bar{position:sticky;top:0;background:#0a0a0a;color:#fff;padding:.7rem 1.5rem;display:flex;justify-content:space-between;align-items:center;font-family:ui-monospace,Consolas,monospace;font-size:.68rem}
	.bar button{background:#fff;color:#0a0a0a;border:none;padding:.45rem 1rem;font-family:inherit;font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
	@media print{.bar{display:none}.doc{padding:0;max-width:none}}
	@media (max-width:700px){.meta{grid-template-columns:1fr 1fr}.doc__head{flex-direction:column;align-items:flex-start}.doc{padding:1rem .75rem}}
`;

function linesTable(invoice: ApiInvoice): string {
	const rows = invoice.lines
		.map(
			(l) => `<tr>
				<td>${esc(l.label)}${l.detail ? `<small>${esc(l.detail)}</small>` : ""}</td>
				<td class="amt">${formatMoney(l.amountCents, "both")}</td>
			</tr>`,
		)
		.join("");
	return `<table class="lines">
		<thead><tr><th>Item</th><th>Amount</th></tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
}

function masthead(kind: string, number: string, statusLabel: string): string {
	return `<div class="doc__head">
		<div>
			<span class="seal">Century NIT</span>
			<p class="co">Century NIT Consult</p>
			<p class="addr">Accra, Ghana — London, United Kingdom</p>
		</div>
		<div class="kind">
			<p class="k">${kind}</p>
			<p class="no">${esc(number)}</p>
			<p><span class="st">${esc(statusLabel)}</span></p>
		</div>
	</div>`;
}

function metaCell(label: string, value: string, sub?: string): string {
	return `<div><p class="k">${label}</p><p class="v">${esc(value)}${sub ? `<small>${esc(sub)}</small>` : ""}</p></div>`;
}

function openDocument(title: string, body: string): void {
	const win = window.open("", "_blank", "width=880,height=1100");
	if (!win) return;
	win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_CSS}</style></head>
		<body>
		<div class="bar"><span>${esc(title)}</span><button onclick="window.print()">Print / Save as PDF</button></div>
		<div class="doc">${body}</div>
		</body></html>`);
	win.document.close();
}

/** The printable invoice — same document the API attaches to emails, rendered
 * client-side from the live invoice record. */
export function downloadInvoice(invoice: ApiInvoice, title: string): void {
	const status = INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status;
	const issued = invoice.raisedAt ?? invoice.createdAt;
	const chapter = CHAPTERS[invoice.type];

	openDocument(
		`Invoice ${invoice.invoiceNumber} — Century NIT`,
		`${masthead("Invoice", invoice.invoiceNumber, status)}
		<div class="meta">
			${metaCell("Issued", dateFmt(issued))}
			${metaCell("Due", invoice.dueAt ? dateFmt(invoice.dueAt) : "On issue")}
			${metaCell("Billed to", invoice.applicantName, invoice.applicantEmail ?? undefined)}
			${metaCell("Chapter", chapter ?? "—", title)}
		</div>
		${linesTable(invoice)}
		<div class="totals"><div>
			<div class="trow"><span class="muted">Subtotal</span><span class="amt">${formatMoney(invoice.subtotalCents, "both")}</span></div>
			${invoice.creditedCents > 0 ? `<div class="trow"><span class="muted">Credited</span><span class="amt">−${formatMoney(invoice.creditedCents, "both")}</span></div>` : ""}
			${invoice.paidCents > 0 ? `<div class="trow"><span class="muted">Paid to date</span><span class="amt">${formatMoney(invoice.paidCents, "both")}</span></div>` : ""}
			<div class="trow trow--inv"><span class="k">Balance due</span><span class="amt">${formatMoney(invoice.balanceCents, "both")}</span></div>
		</div></div>
		<div class="terms">
			<div><p class="h">How to pay</p><p>Pay through your portal — the Money ledger — or the secure link in your invoice email. Card and mobile money are accepted via Paystack. A receipt issues automatically on settlement.</p></div>
			<div><p class="h">Terms</p><p>Due by the date above. Pass-through charges (application, visa and travel costs) are non-refundable once submitted to the institution.</p></div>
		</div>
		<div class="foot"><span>CENTURY NIT CONSULT</span><span>${esc(invoice.invoiceNumber)}</span></div>`,
	);
}

/** The printable receipt — the paid counterpart of the invoice document. */
export function downloadReceipt(invoice: ApiInvoice, title: string): void {
	const payment = invoice.payments[invoice.payments.length - 1];
	const paidAt = payment?.at ?? invoice.updatedAt;
	const chapter = CHAPTERS[invoice.type];
	const settled = invoice.balanceCents <= 0;
	// A partially-settled invoice is still the invoice document — the receipt
	// is for money actually received.
	if (!payment) {
		downloadInvoice(invoice, title);
		return;
	}

	openDocument(
		`Receipt ${invoice.invoiceNumber} — Century NIT`,
		`${masthead("Official receipt", invoice.invoiceNumber, "Paid")}
		<div class="paid">
			<span class="paid__seal">Paid</span>
			<div>
				<p class="paid__amt">${formatMoney(invoice.paidCents, "both")}</p>
				<p class="paid__when">${dateFmt(paidAt)} · via ${esc(payment.gateway ?? payment.method)}</p>
			</div>
		</div>
		<div class="meta">
			${metaCell("Received from", invoice.applicantName, invoice.applicantEmail ?? undefined)}
			${metaCell("Invoice", invoice.invoiceNumber, chapter)}
			${metaCell("Method", payment.method.replace(/_/g, " ").toUpperCase())}
			${metaCell("Reference", payment.reference ?? "—")}
		</div>
		${linesTable(invoice)}
		<div class="totals"><div>
			<div class="trow"><span class="muted">Invoice total</span><span class="amt">${formatMoney(invoice.subtotalCents, "both")}</span></div>
			<div class="trow trow--inv"><span class="k">Amount paid</span><span class="amt">${formatMoney(invoice.paidCents, "both")}</span></div>
			<div class="trow"><span class="muted">Balance remaining</span><span class="amt muted">${settled ? "settled in full" : formatMoney(invoice.balanceCents, "both")}</span></div>
		</div></div>
		<div class="terms">
			<div><p class="h">Record</p><p>Verified against payment reference ${esc(payment.reference ?? "—")}. This receipt is proof of payment — keep it with your file.</p></div>
			<div><p class="h">Century NIT Consult</p><p>Accra, Ghana · London, United Kingdom · support@centurynit.com</p></div>
		</div>
		<div class="foot"><span>CENTURY NIT CONSULT</span><span>${esc(invoice.invoiceNumber)} · ${esc(title)}</span></div>`,
	);
}
