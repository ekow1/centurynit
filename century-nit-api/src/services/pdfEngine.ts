
import type { TDocumentDefinitions, TableCell, StyleDictionary } from "pdfmake/interfaces.js";
import { formatGhs, formatUsd } from "./receiptEmail.js";
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



const defaultStyles: StyleDictionary = {
	header: {
		fontSize: 18,
		bold: true,
		margin: [0, 0, 0, 10],
	},
	subheader: {
		fontSize: 12,
		bold: true,
		margin: [0, 10, 0, 5],
	},
	tableExample: {
		margin: [0, 5, 0, 15],
	},
	tableHeader: {
		bold: true,
		fontSize: 10,
		color: "black",
	},
};

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
};

export async function generateInvoicePdf(input: PdfInvoiceInput): Promise<Buffer> {
	const tableBody: TableCell[][] = [
		[
			{ text: "DESCRIPTION", style: "tableHeader", border: [false, true, false, true] },
			{ text: "AMOUNT", style: "tableHeader", border: [false, true, false, true], alignment: "right" as const },
		],
	];

	for (const item of input.lineItems) {
		tableBody.push([
			{
				stack: [
					{ text: item.label, bold: true },
					...(item.detail ? [{ text: item.detail, fontSize: 9, color: "gray", margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
				],
				border: [false, false, false, true],
				margin: [0, 5, 0, 5] as [number, number, number, number],
			},
			{
				text: formatGhs(item.amountGhs),
				alignment: "right" as const,
				border: [false, false, false, true],
				margin: [0, 5, 0, 5] as [number, number, number, number],
			},
		]);
	}

	const docDefinition: TDocumentDefinitions = {
		defaultStyle: { font: "Helvetica", fontSize: 10 },
		styles: defaultStyles,
		content: [
			{
				columns: [
					{
						text: "CENTURY NIT CONSULT",
						fontSize: 16,
						bold: true,
					},
					{
						text: "INVOICE",
						fontSize: 24,
						bold: true,
						alignment: "right" as const,
					},
				],
				margin: [0, 0, 0, 20],
			},
			{
				canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2 }],
				margin: [0, 0, 0, 20],
			},
			{
				columns: [
					{
						stack: [
							{ text: "BILLED TO:", bold: true, fontSize: 8 },
							{ text: input.clientName, bold: true, margin: [0, 2, 0, 0] },
							{ text: input.clientEmail },
							...(input.clientPhone ? [{ text: input.clientPhone }] : []),
						],
					},
					{
						stack: [
							{ text: `Invoice Number: ${input.invoiceNumber}`, alignment: "right" as const },
							{ text: `Date Issued: ${input.issueDate}`, alignment: "right" as const },
							{ text: `Due Date: ${input.dueAt}`, alignment: "right" as const },
						],
					},
				],
				margin: [0, 0, 0, 30],
			},
			{
				table: {
					headerRows: 1,
					widths: ["*", "auto"],
					body: tableBody,
				},
				layout: {
					hLineWidth: (i: number, node: any) => {
						return (i === 0 || i === node.table.body.length) ? 2 : 1;
					},
					vLineWidth: () => 0,
					hLineColor: (i: number, node: any) => {
						return (i === 0 || i === node.table.body.length) ? "black" : "#cccccc";
					},
				},
			},
			{
				columns: [
					{ text: "", width: "*" },
					{
						table: {
							widths: ["auto", "auto"],
							body: [
								[
									{ text: "TOTAL DUE", bold: true, margin: [0, 10, 10, 0] as [number, number, number, number], border: [false, false, false, false] as [boolean, boolean, boolean, boolean] },
									{ text: formatGhs(input.totalGhs), bold: true, fontSize: 14, margin: [0, 10, 0, 0] as [number, number, number, number], alignment: "right" as const, border: [false, false, false, false] as [boolean, boolean, boolean, boolean] },
								],
								...(input.totalUsd
									? [[
											{ text: "USD EQUIVALENT", fontSize: 8, margin: [0, 2, 10, 0] as [number, number, number, number], border: [false, false, false, false] as [boolean, boolean, boolean, boolean] },
											{ text: formatUsd(input.totalUsd), fontSize: 8, alignment: "right" as const, margin: [0, 2, 0, 0] as [number, number, number, number], border: [false, false, false, false] as [boolean, boolean, boolean, boolean] },
									  ]]
									: []),
							],
						},
						layout: "noBorders",
					},
				],
				margin: [0, 10, 0, 0],
			},
		],
	};

	return generatePdfBuffer(docDefinition);
}

export async function generateReceiptPdf(input: PdfReceiptInput): Promise<Buffer> {
	const tableBody: TableCell[][] = [
		[
			{ text: "DESCRIPTION", style: "tableHeader", border: [false, true, false, true] },
			{ text: "AMOUNT", style: "tableHeader", border: [false, true, false, true], alignment: "right" as const },
		],
	];

	for (const item of input.lineItems) {
		tableBody.push([
			{
				stack: [
					{ text: item.label, bold: true },
					...(item.detail ? [{ text: item.detail, fontSize: 9, color: "gray", margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
				],
				border: [false, false, false, true],
				margin: [0, 5, 0, 5] as [number, number, number, number],
			},
			{
				text: formatGhs(item.amountGhs),
				alignment: "right" as const,
				border: [false, false, false, true],
				margin: [0, 5, 0, 5] as [number, number, number, number],
			},
		]);
	}

	const docDefinition: TDocumentDefinitions = {
		defaultStyle: { font: "Helvetica", fontSize: 10 },
		styles: defaultStyles,
		content: [
			{
				columns: [
					{
						text: "CENTURY NIT CONSULT",
						fontSize: 16,
						bold: true,
					},
					{
						text: "RECEIPT",
						fontSize: 24,
						bold: true,
						alignment: "right" as const,
					},
				],
				margin: [0, 0, 0, 20],
			},
			{
				canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2 }],
				margin: [0, 0, 0, 20],
			},
			{
				columns: [
					{
						stack: [
							{ text: "RECEIVED FROM:", bold: true, fontSize: 8 },
							{ text: input.clientName, bold: true, margin: [0, 2, 0, 0] },
							{ text: input.clientEmail },
						],
					},
					{
						stack: [
							{ text: `Receipt Number: ${input.receiptNumber}`, alignment: "right" as const },
							{ text: `Invoice Number: ${input.invoiceNumber}`, alignment: "right" as const },
							{ text: `Date Paid: ${input.paymentDate}`, alignment: "right" as const },
							{ text: `Payment Method: ${input.paymentChannel}`, alignment: "right" as const },
							{ text: `Reference: ${input.reference}`, alignment: "right" as const },
						],
					},
				],
				margin: [0, 0, 0, 30],
			},
			{
				table: {
					headerRows: 1,
					widths: ["*", "auto"],
					body: tableBody,
				},
				layout: {
					hLineWidth: (i: number, node: any) => {
						return (i === 0 || i === node.table.body.length) ? 2 : 1;
					},
					vLineWidth: () => 0,
					hLineColor: (i: number, node: any) => {
						return (i === 0 || i === node.table.body.length) ? "black" : "#cccccc";
					},
				},
			},
			{
				columns: [
					{ text: "", width: "*" },
					{
						table: {
							widths: ["auto", "auto"],
							body: [
								[
									{ text: "TOTAL PAID", bold: true, margin: [0, 10, 10, 0] as [number, number, number, number], border: [false, false, false, false] as [boolean, boolean, boolean, boolean] },
									{ text: formatGhs(input.totalGhs), bold: true, fontSize: 14, margin: [0, 10, 0, 0] as [number, number, number, number], alignment: "right" as const, border: [false, false, false, false] as [boolean, boolean, boolean, boolean] },
								],
								...(input.totalUsd
									? [[
											{ text: "USD EQUIVALENT", fontSize: 8, margin: [0, 2, 10, 0] as [number, number, number, number], border: [false, false, false, false] as [boolean, boolean, boolean, boolean] },
											{ text: formatUsd(input.totalUsd), fontSize: 8, alignment: "right" as const, margin: [0, 2, 0, 0] as [number, number, number, number], border: [false, false, false, false] as [boolean, boolean, boolean, boolean] },
									  ]]
									: []),
							],
						},
						layout: "noBorders",
					},
				],
				margin: [0, 10, 0, 0],
			},
			{
				text: "PAID IN FULL",
				bold: true,
				fontSize: 16,
				color: "black",
				alignment: "center" as const,
				margin: [0, 40, 0, 0],
			},
		],
	};

	return generatePdfBuffer(docDefinition);
}
