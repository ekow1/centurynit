
import type { Content, TDocumentDefinitions, TableCell } from "pdfmake/interfaces.js";
import { formatUsd } from "./receiptEmail.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// pdfmake's server-side pieces have no type declarations (@types/pdfmake only
// covers the browser API), so they're pulled in through require. In 0.3.x the
// Printer constructor wants a virtual filesystem and a URL resolver — the
// URL resolver is what fetches remote font/image URLs before layout; without
// it createPdfKitDocument crashes on `this.urlResolver`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require("pdfmake/js/Printer.js").default as new (
	fonts: Record<string, Record<string, string>>,
	virtualfs: unknown,
	urlResolver: unknown,
	options?: unknown,
) => {
	createPdfKitDocument(d: TDocumentDefinitions): Promise<{
		on(event: "data", cb: (chunk: Buffer) => void): void;
		on(event: "end" | "error", cb: (err?: unknown) => void): void;
		end(): void;
	}>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const virtualfs = require("pdfmake/js/virtual-fs.js").default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const URLResolver = require("pdfmake/js/URLResolver.js").default as new (fs: unknown, options?: unknown) => unknown;

const fonts = {
	Helvetica: {
		normal: "Helvetica",
		bold: "Helvetica-Bold",
		italics: "Helvetica-Oblique",
		bolditalics: "Helvetica-BoldOblique",
	},
};

const urlResolver = new URLResolver(virtualfs, undefined);
const printer = new PdfPrinter(fonts, virtualfs, urlResolver, undefined);

const INK = "#000000";
const GRAY = "#666666";
const HAIR = "#d4d4d8";

// The built-in Helvetica has no cedi glyph (₵) — PDFs spell the currency out.
function formatGhsPdf(amount: number): string {
	return `GHS ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function generatePdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
	// createPdfKitDocument resolves fonts/images first — it's async in 0.3.x
	// and returns a Promise for the pdfkit stream, not the stream itself.
	const pdfDoc = await printer.createPdfKitDocument(docDefinition);
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));
		pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
		pdfDoc.on("error", reject);
		pdfDoc.end();
	});
}

export type LineItemInput = {
	label: string;
	detail?: string | null;
	amountUsd: number;
	amountGhs: number;
};

export type PdfInvoiceInput = {
	invoiceNumber: string;
	clientName: string;
	clientEmail: string;
	clientPhone?: string | null;
	dueAt: string;
	issueDate: string;
	lineItems: LineItemInput[];
	totalGhs: number;
	totalUsd?: number | null;
	/** Journey label — "Chapter III · Applications". */
	chapter?: string | null;
	/** Amount already settled (USD) — drives "Paid to date" and the balance row. */
	paidUsd?: number | null;
	/** Word under the invoice number — "Issued", "Part paid", "Paid". */
	statusLabel?: string | null;
};

export type PdfReceiptPayment = {
	date: string;
	channel: string;
	reference: string;
	amountUsd: number;
	amountGhs: number;
};

export type PdfReceiptInput = {
	receiptNumber: string;
	invoiceNumber: string;
	clientName: string;
	clientEmail: string;
	paymentDate: string;
	paymentChannel: string;
	reference: string;
	lineItems: LineItemInput[];
	totalGhs: number;
	totalUsd?: number | null;
	/** Journey label — "Chapter III · Applications". */
	chapter?: string | null;
	/** What is still owed after this payment (USD) — "settled in full" when 0. */
	balanceUsd?: number | null;
	/**
	 * Every payment recorded on the invoice, oldest first. When present the
	 * document itemizes them and the totals describe the whole invoice, not
	 * just one settlement.
	 */
	payments?: PdfReceiptPayment[];
	/** The invoice's full subtotal (USD). Defaults to totalUsd. */
	invoiceTotalUsd?: number | null;
	/** Total received across all payments (USD). Defaults to totalUsd. */
	paidUsd?: number | null;
};

/* ── shared document parts ───────────────────────────────────────────────── */

/** Black masthead — the bordered CENTURY NIT tag, the company, the document
 * kind + number on the right. Same on invoice and receipt. */
function masthead(kind: string, number: string, statusLabel?: string | null): Content {
	return {
		table: {
			widths: ["*", "auto"],
			body: [
				[
					{
						stack: [
							{
								table: {
									widths: ["auto"],
									body: [[{ text: "CENTURY NIT", fontSize: 7, bold: true, color: "#ffffff", margin: [5, 3, 5, 3] }]],
								},
								layout: {
									hLineWidth: () => 0.75,
									vLineWidth: () => 0.75,
									hLineColor: () => "#ffffff",
									vLineColor: () => "#ffffff",
								},
							},
							{ text: "Century NIT Consult", fontSize: 15, bold: true, color: "#ffffff", margin: [0, 7, 0, 0] },
							{ text: "Accra, Ghana · London, United Kingdom", fontSize: 7.5, color: "#bbbbbb", margin: [0, 3, 0, 0] },
						],
						border: [false, false, false, false],
						fillColor: INK,
						margin: [18, 16, 0, 18],
					},
					{
						stack: [
							{ text: kind.toUpperCase(), fontSize: 7, color: "#bbbbbb", alignment: "right" as const, characterSpacing: 1.5 },
							{ text: number, fontSize: 16, bold: true, color: "#ffffff", alignment: "right" as const, margin: [0, 3, 0, 0] },
							...(statusLabel
								? [{
										table: {
											widths: ["auto"],
											body: [[{ text: statusLabel.toUpperCase(), fontSize: 7, bold: true, color: "#ffffff", margin: [5, 2, 5, 2] }]],
										},
										layout: {
											hLineWidth: () => 0.75,
											vLineWidth: () => 0.75,
											hLineColor: () => "#ffffff",
											vLineColor: () => "#ffffff",
										},
										alignment: "right" as const,
										margin: [0, 6, 0, 0],
									} as Content]
								: []),
						],
						border: [false, false, false, false],
						fillColor: INK,
						margin: [0, 16, 18, 18],
					},
				],
			],
		},
		layout: "noBorders",
	};
}

/** The four-cell meta strip — label in mono-smallcaps, value below. */
function metaStrip(cells: { label: string; value: string; sub?: string }[]): Content {
	const body: TableCell[][] = [
		cells.map((cell): TableCell => ({
			stack: [
				{ text: cell.label.toUpperCase(), fontSize: 6.5, color: GRAY, characterSpacing: 1 },
				{ text: cell.value, fontSize: 9.5, bold: true, margin: [0, 4, 0, 0] as [number, number, number, number] },
				...(cell.sub ? [{ text: cell.sub, fontSize: 8, color: GRAY, margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
			],
			margin: [10, 9, 10, 10],
		})),
	];
	return {
		table: {
			widths: cells.map(() => "*"),
			body,
		},
		layout: {
			hLineWidth: (i: number) => (i === 0 ? 0 : 1.25),
			vLineWidth: (i: number) => (i === 0 || i === cells.length ? 0 : 0.5),
			hLineColor: () => INK,
			vLineColor: () => HAIR,
		},
		margin: [0, 0, 0, 18],
	};
}

/** The line-items table — hairline rows, mono amounts. */
function itemsTable(items: LineItemInput[]): Content {
	const body: TableCell[][] = [
		[
			{ text: "ITEM", fontSize: 6.5, color: GRAY, characterSpacing: 1, border: [false, false, false, false], margin: [0, 0, 0, 6] },
			{ text: "AMOUNT", fontSize: 6.5, color: GRAY, characterSpacing: 1, alignment: "right" as const, border: [false, false, false, false], margin: [0, 0, 0, 6] },
		],
		...items.map((item): TableCell[] => [
			{
				stack: [
					{ text: item.label, fontSize: 9.5, bold: true },
					...(item.detail ? [{ text: item.detail, fontSize: 8, color: GRAY, margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
				],
				border: [false, false, false, false],
				margin: [0, 7, 0, 7],
			},
			{
				text: formatUsd(item.amountUsd),
				fontSize: 9.5,
				alignment: "right" as const,
				border: [false, false, false, false],
				margin: [0, 7, 0, 7],
			},
		]),
	];
	return {
		table: { headerRows: 1, widths: ["*", "auto"], body },
		layout: {
			hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
				i === 0 ? 0 : i === 1 ? 1.25 : i === node.table.body.length ? 0 : 0.5,
			vLineWidth: () => 0,
			hLineColor: (i: number) => (i === 1 ? INK : HAIR),
		},
	};
}

/** Right-aligned totals column; the last row can be the inverted one
 * (black cell, white type — the number that matters). */
function totalsTable(rows: { label: string; value: string; inverted?: boolean; muted?: boolean }[]): Content {
	return {
		columns: [
			{ text: "", width: "*" },
			{
				width: "auto",
				table: {
					widths: ["auto", "auto"],
					body: rows.map((row) => [
						{
							text: row.label,
							fontSize: row.inverted ? 7.5 : 9,
							bold: !!row.inverted,
							characterSpacing: row.inverted ? 1 : 0,
							color: row.inverted ? "#ffffff" : row.muted ? GRAY : INK,
							fillColor: row.inverted ? INK : undefined,
							margin: [10, row.inverted ? 7 : 4, 10, row.inverted ? 7 : 4],
							border: [false, false, false, false],
						},
						{
							text: row.value,
							fontSize: row.inverted ? 12 : 9,
							bold: true,
							color: row.inverted ? "#ffffff" : row.muted ? GRAY : INK,
							fillColor: row.inverted ? INK : undefined,
							alignment: "right" as const,
							margin: [10, row.inverted ? 5 : 4, 10, row.inverted ? 5 : 4],
							border: [false, false, false, false],
						},
					]),
				},
				layout: {
					hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
					vLineWidth: () => 0,
					hLineColor: () => HAIR,
				},
			},
		],
		margin: [0, 0, 0, 18],
	};
}

/** The itemized payments table — every settlement on the invoice, oldest
 * first. A receipt covering four instalments shows four rows, not just the
 * last payment's reference. */
function paymentsTable(payments: PdfReceiptPayment[]): Content {
	const head = (text: string, right = false): TableCell => ({
		text,
		fontSize: 6.5,
		color: GRAY,
		characterSpacing: 1,
		alignment: right ? ("right" as const) : ("left" as const),
		border: [false, false, false, false],
		margin: [0, 0, 0, 6],
	});
	const body: TableCell[][] = [
		[head("PAYMENT"), head("DATE"), head("METHOD"), head("REFERENCE"), head("AMOUNT", true)],
		...payments.map((p, i): TableCell[] => [
			{ text: `${i + 1} / ${payments.length}`, fontSize: 8.5, color: GRAY, border: [false, false, false, false], margin: [0, 6, 0, 6] },
			{ text: p.date, fontSize: 9, border: [false, false, false, false], margin: [0, 6, 0, 6] },
			{ text: p.channel.replace(/_/g, " "), fontSize: 9, border: [false, false, false, false], margin: [0, 6, 0, 6] },
			{ text: p.reference || "—", fontSize: 8.5, border: [false, false, false, false], margin: [0, 6, 0, 6] },
			{ text: formatUsd(p.amountUsd), fontSize: 9, bold: true, alignment: "right" as const, border: [false, false, false, false], margin: [0, 6, 0, 6] },
		]),
	];
	return {
		stack: [
			{ text: "PAYMENTS RECEIVED", fontSize: 6.5, color: GRAY, characterSpacing: 1, margin: [0, 14, 0, 4] },
			{
				table: { headerRows: 1, widths: ["auto", "auto", "*", "auto", "auto"], body },
				layout: {
					hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
						i === 0 ? 0 : i === 1 ? 1.25 : i === node.table.body.length ? 0 : 0.5,
					vLineWidth: () => 0,
					hLineColor: (i: number) => (i === 1 ? INK : HAIR),
				},
			},
		],
	};
}

/** Two-column notes block — terms / company record. */
function notesBlock(left: { head: string; body: string }, right: { head: string; body: string }): Content {
	return {
		table: {
			widths: ["*", "*"],
			body: [
				[
					{
						stack: [
							{ text: left.head.toUpperCase(), fontSize: 6.5, bold: true, characterSpacing: 1, margin: [0, 0, 0, 4] },
							{ text: left.body, fontSize: 8, color: GRAY, lineHeight: 1.4 },
						],
						border: [false, false, false, false],
						margin: [12, 10, 12, 12],
					},
					{
						stack: [
							{ text: right.head.toUpperCase(), fontSize: 6.5, bold: true, characterSpacing: 1, margin: [0, 0, 0, 4] },
							{ text: right.body, fontSize: 8, color: GRAY, lineHeight: 1.4 },
						],
						border: [false, false, false, false],
						margin: [12, 10, 12, 12],
					},
				],
			],
		},
		layout: {
			hLineWidth: (i: number) => (i === 0 ? 1.25 : 0),
			vLineWidth: (i: number) => (i === 1 ? 0.5 : 0),
			hLineColor: () => INK,
			vLineColor: () => HAIR,
		},
	};
}

/** `INVOICE · PAGE 1 OF 1` — same on every document. */
function pageFooter(left: string): TDocumentDefinitions["footer"] {
	return (currentPage: number, pageCount: number) => ({
		columns: [
			{ text: "CENTURY NIT CONSULT", fontSize: 6.5, color: GRAY, characterSpacing: 1 },
			{ text: `${left} · PAGE ${currentPage} OF ${pageCount}`, fontSize: 6.5, color: GRAY, alignment: "right" as const },
		],
		margin: [40, 8, 40, 0],
	});
}

/* ── the documents ───────────────────────────────────────────────────────── */

export async function generateInvoicePdf(input: PdfInvoiceInput): Promise<Buffer> {
	const totalUsd = input.totalUsd ?? input.lineItems.reduce((sum, i) => sum + i.amountUsd, 0);
	const paidUsd = input.paidUsd ?? 0;
	const balanceUsd = Math.max(0, totalUsd - paidUsd);
	const statusLabel = input.statusLabel ?? (balanceUsd <= 0 ? "Paid" : paidUsd > 0 ? "Part paid" : "Issued");

	const docDefinition: TDocumentDefinitions = {
		defaultStyle: { font: "Helvetica", fontSize: 10 },
		pageMargins: [40, 36, 40, 48],
		footer: pageFooter(input.invoiceNumber),
		content: [
			masthead("Invoice", input.invoiceNumber, statusLabel),
			metaStrip([
				{ label: "Issued", value: input.issueDate },
				{ label: "Due", value: input.dueAt },
				{ label: "Billed to", value: input.clientName, sub: input.clientEmail },
				{ label: "Chapter", value: input.chapter ?? "—" },
			]),
			itemsTable(input.lineItems),
			totalsTable([
				{ label: "Subtotal", value: formatUsd(totalUsd), muted: true },
				{ label: "Paid to date", value: formatUsd(paidUsd), muted: true },
				{ label: "GHS equivalent", value: formatGhsPdf(input.totalGhs), muted: true },
				{ label: "BALANCE DUE", value: formatUsd(balanceUsd), inverted: true },
			]),
			notesBlock(
				{
					head: "How to pay",
					body: "Pay through your portal — the Money ledger — or the secure link in your invoice email. Card and mobile money are accepted via Paystack. A receipt issues automatically on settlement.",
				},
				{
					head: "Terms",
					body: "Due by the date above. Pass-through charges (application, visa and travel costs) are non-refundable once submitted to the institution. Questions — reply to your consultant.",
				},
			),
		],
	};

	return generatePdfBuffer(docDefinition);
}

export async function generateReceiptPdf(input: PdfReceiptInput): Promise<Buffer> {
	const invoiceTotalUsd =
		input.invoiceTotalUsd ?? input.totalUsd ?? input.lineItems.reduce((sum, i) => sum + i.amountUsd, 0);
	const paidUsd = input.paidUsd ?? input.totalUsd ?? invoiceTotalUsd;
	const balanceUsd = input.balanceUsd ?? Math.max(0, invoiceTotalUsd - paidUsd);
	const settled = balanceUsd <= 0.004;
	const payments = input.payments ?? [];
	const latest = payments[payments.length - 1];
	const paymentCount = payments.length;

	const docDefinition: TDocumentDefinitions = {
		defaultStyle: { font: "Helvetica", fontSize: 10 },
		pageMargins: [40, 36, 40, 48],
		footer: pageFooter(input.receiptNumber),
		content: [
			masthead("Official receipt", input.receiptNumber, settled ? "Paid" : "Partially paid"),
			// the stamp — the seal describes the invoice's settlement state, so a
			// part-paid invoice never wears a PAID stamp.
			{
				columns: [
					{
						width: "auto",
						table: {
							widths: ["auto"],
							body: [[{ text: settled ? "PAID" : "PART PAID", fontSize: 11, bold: true, characterSpacing: 2, margin: [10, 6, 10, 6] }]],
						},
						layout: {
							hLineWidth: () => 1.5,
							vLineWidth: () => 1.5,
							hLineColor: () => INK,
							vLineColor: () => INK,
						},
						margin: [0, 6, 0, 0],
					},
					{
						width: "*",
						stack: [
							{
								text: [
									{ text: formatUsd(paidUsd), fontSize: 22, bold: true },
									...(settled ? [] : [{ text: `  of ${formatUsd(invoiceTotalUsd)}`, fontSize: 10, color: GRAY }]),
								],
							},
							{
								text: paymentCount > 0
									? `${paymentCount} payment${paymentCount === 1 ? "" : "s"} · latest ${latest.date} · via ${latest.channel}`
									: `${input.paymentDate} · via ${input.paymentChannel}`,
								fontSize: 8.5,
								color: GRAY,
								margin: [0, 3, 0, 0],
							},
						],
						margin: [16, 0, 0, 0],
					},
				],
				margin: [0, 16, 0, 20],
			},
			metaStrip([
				{ label: "Received from", value: input.clientName, sub: input.clientEmail },
				{ label: "Invoice", value: input.invoiceNumber, sub: input.chapter ?? undefined },
				{
					label: "Method",
					value: (latest?.channel ?? input.paymentChannel).replace(/_/g, " ").toUpperCase(),
				},
				{ label: "Reference", value: latest?.reference || input.reference },
			]),
			itemsTable(input.lineItems),
			...(payments.length > 0 ? [paymentsTable(payments)] : []),
			totalsTable([
				{ label: "Invoice total", value: formatUsd(invoiceTotalUsd), muted: true },
				{ label: "Paid in GHS", value: formatGhsPdf(input.totalGhs), muted: true },
				{ label: "AMOUNT PAID", value: formatUsd(paidUsd), inverted: true },
				{
					label: "Balance remaining",
					value: settled ? `${formatUsd(0)} — settled in full` : formatUsd(balanceUsd),
					muted: true,
				},
			]),
			notesBlock(
				{
					head: "Record",
					body: `Verified against payment reference ${input.reference}. This receipt is proof of payment — keep it with your file.`,
				},
				{
					head: "Century NIT Consult",
					body: "Accra, Ghana · London, United Kingdom · support@centurynit.com",
				},
			),
		],
	};

	return generatePdfBuffer(docDefinition);
}
