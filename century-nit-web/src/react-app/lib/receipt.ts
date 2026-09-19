import type { ApiInvoice } from "century-nit-shared";
import { API_PREFIX } from "century-nit-shared";

/**
 * Invoice and receipt downloads — the real PDFs.
 *
 * `GET /api/v1/me/invoices/:id/pdf?kind=invoice|receipt` streams the same
 * pdfmake document the settlement email attaches, so the file the client
 * downloads is byte-identical to the one the office sent. `inline`
 * disposition opens it in the browser's PDF viewer — save and print are
 * built in there, and a popup-blocked window can't silently swallow it the
 * way the old document.write print page could.
 */

export function openInvoiceDocument(invoice: ApiInvoice, kind: "invoice" | "receipt"): void {
	window.open(`${API_PREFIX}/me/invoices/${invoice.id}/pdf?kind=${kind}`, "_blank", "noopener");
}

/** The invoice document — what the money is for. */
export function downloadInvoice(invoice: ApiInvoice, _title: string): void {
	openInvoiceDocument(invoice, "invoice");
}

/** The receipt document — proof of payment, every payment itemized. Before
 * the first payment there is no receipt, so fall back to the invoice. */
export function downloadReceipt(invoice: ApiInvoice, _title: string): void {
	openInvoiceDocument(invoice, invoice.payments.length > 0 ? "receipt" : "invoice");
}
