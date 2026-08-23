import { sendEmail } from "../lib/resend.js";

export interface ReceiptEmailData {
	recipientEmail: string;
	recipientName: string;
	recipientPhone?: string | null;
	receiptNumber: string;
	invoiceNumber: string;
	amountGhs: number;
	amountUsd?: number | null;
	paymentDate: string;
	paymentChannel: string;
	reference: string;
	description?: string;
}

export function formatGhs(amount: number): string {
	return `GH₵ ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsd(amount: number): string {
	return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateReceiptHtml(data: ReceiptEmailData): string {
	const ghsStr = formatGhs(data.amountGhs);
	const usdStr = data.amountUsd ? formatUsd(data.amountUsd) : formatUsd(data.amountGhs / 15);
	const desc = data.description || `Settlement for Invoice ${data.invoiceNumber}`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Official Payment Receipt - Century NIT Consult</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #18181b;">
	<table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
		<!-- Header -->
		<tr>
			<td style="padding: 28px 32px; border-bottom: 2px solid #18181b; background-color: #ffffff;">
				<table width="100%" border="0" cellpadding="0" cellspacing="0">
					<tr>
						<td style="vertical-align: top;">
							<h1 style="margin: 0; font-size: 20px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: #18181b;">
								CENTURY NIT CONSULT
							</h1>
							<p style="margin: 4px 0 0 0; font-size: 12px; color: #52525b;">
								Travel, Visa & University Admissions Consulting
							</p>
							<p style="margin: 4px 0 0 0; font-size: 11px; color: #71717a; font-family: monospace;">
								Accra Branch · info@century-nit.com · +233 (0) 30 200 0000
							</p>
						</td>
						<td style="vertical-align: top; text-align: right;">
							<div style="display: inline-block; font-size: 11px; font-weight: 800; border: 2px solid #18181b; padding: 4px 8px; text-transform: uppercase; letter-spacing: 0.05em;">
								PAYMENT RECEIPT
							</div>
							<p style="margin: 6px 0 0 0; font-size: 11px; font-family: monospace; color: #71717a;">
								${data.receiptNumber}
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>

		<!-- Meta Section -->
		<tr>
			<td style="padding: 24px 32px 16px 32px;">
				<table width="100%" border="0" cellpadding="0" cellspacing="0">
					<tr>
						<td style="width: 50%; vertical-align: top;">
							<p style="margin: 0; font-size: 10px; color: #71717a; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">
								Received From:
							</p>
							<p style="margin: 4px 0 0 0; font-size: 14px; font-weight: 800; text-transform: uppercase; color: #18181b;">
								${data.recipientName}
							</p>
							<p style="margin: 2px 0 0 0; font-size: 12px; color: #52525b;">
								${data.recipientEmail}
							</p>
							${data.recipientPhone ? `<p style="margin: 2px 0 0 0; font-size: 12px; color: #52525b;">${data.recipientPhone}</p>` : ""}
						</td>
						<td style="width: 50%; vertical-align: top; text-align: right;">
							<p style="margin: 0; font-size: 10px; color: #71717a; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">
								Payment Details:
							</p>
							<p style="margin: 4px 0 0 0; font-size: 12px; color: #18181b;">
								Date: <strong>${data.paymentDate}</strong>
							</p>
							<p style="margin: 2px 0 0 0; font-size: 12px; color: #18181b;">
								Invoice: <strong>${data.invoiceNumber}</strong>
							</p>
							<p style="margin: 2px 0 0 0; font-size: 12px; color: #18181b;">
								Channel: <strong>${data.paymentChannel}</strong>
							</p>
							<p style="margin: 2px 0 0 0; font-size: 10px; font-family: monospace; color: #71717a;">
								Ref: ${data.reference}
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>

		<!-- Table -->
		<tr>
			<td style="padding: 16px 32px 24px 32px;">
				<table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-size: 13px;">
					<thead>
						<tr style="background-color: #f4f4f5; border-top: 1px solid #18181b; border-bottom: 1px solid #18181b;">
							<th style="padding: 10px 8px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;">Description</th>
							<th style="padding: 10px 8px; text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;">Currency</th>
							<th style="padding: 10px 8px; text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;">Amount Paid</th>
						</tr>
					</thead>
					<tbody>
						<tr style="border-bottom: 1px solid #e4e4e7;">
							<td style="padding: 14px 8px; vertical-align: top;">
								<strong style="color: #18181b;">${desc}</strong>
								<div style="font-size: 11px; color: #71717a; margin-top: 2px;">Consultation, processing & admission fees</div>
							</td>
							<td style="padding: 14px 8px; text-align: right; font-family: monospace; vertical-align: top;">
								GHS / USD
							</td>
							<td style="padding: 14px 8px; text-align: right; font-weight: 700; font-family: monospace; vertical-align: top; color: #18181b;">
								${ghsStr}
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr>
							<td colspan="2" style="padding: 14px 8px 4px 8px; text-align: right; font-weight: 800; text-transform: uppercase; font-size: 12px; color: #18181b;">
								Total Amount Received:
							</td>
							<td style="padding: 14px 8px 4px 8px; text-align: right; font-weight: 900; font-size: 16px; font-family: monospace; border-bottom: 2px solid #18181b; color: #18181b;">
								${ghsStr}
							</td>
						</tr>
						<tr>
							<td colspan="2" style="padding: 4px 8px 12px 8px; text-align: right; font-size: 11px; color: #71717a;">
								USD Equivalent:
							</td>
							<td style="padding: 4px 8px 12px 8px; text-align: right; font-size: 11px; font-family: monospace; color: #71717a;">
								${usdStr}
							</td>
						</tr>
					</tfoot>
				</table>
			</td>
		</tr>

		<!-- Official Stamp & Verification Footer -->
		<tr>
			<td style="padding: 20px 32px 28px 32px; border-top: 1px solid #e4e4e7; background-color: #fafafa;">
				<table width="100%" border="0" cellpadding="0" cellspacing="0">
					<tr>
						<td style="vertical-align: middle; font-size: 11px; color: #71717a; line-height: 1.5;">
							<p style="margin: 0; font-weight: 600; color: #52525b;">Century NIT Consult Official Electronic Receipt</p>
							<p style="margin: 2px 0 0 0;">Verified and settled via Paystack Gateway Rails.</p>
							<p style="margin: 2px 0 0 0;">For questions, email <strong>info@century-nit.com</strong> or call <strong>+233 30 200 0000</strong>.</p>
						</td>
						<td style="vertical-align: middle; text-align: right;">
							<div style="display: inline-block; border: 2px solid #18181b; padding: 6px 14px; text-align: center; background-color: #ffffff;">
								<span style="font-size: 10px; font-weight: 900; letter-spacing: 0.05em; color: #18181b; text-transform: uppercase; display: block;">
									PAID &amp; CONFIRMED
								</span>
								<div style="font-size: 9px; color: #52525b; font-family: monospace; margin-top: 2px;">
									${data.paymentDate}
								</div>
							</div>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>`;
}

export async function sendPaymentReceiptEmail(data: ReceiptEmailData): Promise<void> {
	if (!data.recipientEmail) return;

	const html = generateReceiptHtml(data);
	const text = `CENTURY NIT CONSULT - PAYMENT RECEIPT\n` +
		`Receipt: ${data.receiptNumber}\n` +
		`Received From: ${data.recipientName} (${data.recipientEmail})\n` +
		`Invoice: ${data.invoiceNumber}\n` +
		`Amount: ${formatGhs(data.amountGhs)} (${data.amountUsd ? formatUsd(data.amountUsd) : ""})\n` +
		`Date: ${data.paymentDate}\n` +
		`Channel: ${data.paymentChannel}\n` +
		`Ref: ${data.reference}\n\n` +
		`Thank you for choosing Century NIT Consult.`;

	try {
		await sendEmail({
			to: data.recipientEmail,
			subject: `Official Payment Receipt: ${data.invoiceNumber} (Century NIT Consult)`,
			html,
			text,
		});
		console.log(`[receipt] Sent official branded receipt to ${data.recipientEmail} for invoice ${data.invoiceNumber}`);
	} catch (err) {
		console.error(`[receipt] Failed to send receipt email to ${data.recipientEmail}:`, err);
	}
}
