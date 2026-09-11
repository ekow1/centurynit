import type { ApiInvoice } from "century-nit-shared";
import { INVOICE_STATUS_LABELS } from "century-nit-shared";
import { formatMoney } from "century-nit-core/ui";

/** Plain-text receipt for a paid invoice, downloaded from the invoice card. */
export function downloadReceipt(invoice: ApiInvoice, title: string): void {
	const lines = invoice.lines.map((l) => `  ${l.label}${l.detail ? ` — ${l.detail}` : ""}: ${formatMoney(l.amountCents, "usd")}`);
	const paidAt = invoice.payments.length ? invoice.payments[invoice.payments.length - 1].at : invoice.updatedAt;
	const text = [
		"CENTURY NIT CONSULT",
		"====================================",
		"",
		`Invoice: ${invoice.invoiceNumber}`,
		`Title: ${title}`,
		`Status: ${(INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status).toUpperCase()}`,
		`Date: ${new Date(paidAt).toLocaleString()}`,
		"",
		"Items:",
		...lines,
		"",
		`Total: ${formatMoney(invoice.subtotalCents, "usd")}`,
		`Paid: ${formatMoney(invoice.paidCents, "usd")}`,
		`Balance: ${formatMoney(invoice.balanceCents, "usd")}`,
		"",
		"This is a system-generated receipt for your records.",
	].join("\n");
	const blob = new Blob([text], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `receipt-${invoice.invoiceNumber}.txt`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
