import fs from "fs/promises";
import { generateInvoicePdf, generateReceiptPdf } from "../services/pdfEngine.js";

async function main() {
	const baseData = {
		invoiceNumber: "INV-2026-001",
		receiptNumber: "REC-2026-001",
		clientName: "John Doe",
		clientEmail: "john.doe@example.com",
		clientPhone: "+1234567890",
		dueAt: "10/10/2026",
		issueDate: "09/10/2026",
		paymentDate: "09/10/2026",
		paymentChannel: "Stripe",
		reference: "ch_1234567890",
		totalGhs: 1500,
		totalUsd: 100,
		lineItems: [
			{
				label: "Pre-departure Service Fee",
				detail: "Includes visa and ticket processing",
				amountGhs: 1500,
				amountUsd: 100,
			},
		],
	};

	try {
		console.log("Generating Invoice PDF...");
		const invoiceBuffer = await generateInvoicePdf(baseData);
		await fs.writeFile("test-invoice.pdf", invoiceBuffer);
		console.log("Invoice PDF saved to test-invoice.pdf");

		console.log("Generating Receipt PDF...");
		const receiptBuffer = await generateReceiptPdf(baseData);
		await fs.writeFile("test-receipt.pdf", receiptBuffer);
		console.log("Receipt PDF saved to test-receipt.pdf");
	} catch (error) {
		console.error("Error generating PDFs:", error);
	}
}

main().catch(console.error);
