import { sendEmail } from "../lib/resend.js";
import type { QueuedEmail } from "./notifications.js";

export interface ReceiptLineItem {
	label: string;
	detail?: string | null;
	amountUsd: number;
	amountGhs: number;
}

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
	/** Real invoice line items — when provided, rendered instead of the
	 * hardcoded single-row fallback. */
	lineItems?: ReceiptLineItem[];
}

export function formatGhs(amount: number): string {
	return `GH₵ ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsd(amount: number): string {
	return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateReceiptHtml(data: ReceiptEmailData): string {
	const ghsStr = formatGhs(data.amountGhs);
	const usdStr = data.amountUsd != null ? formatUsd(data.amountUsd) : "";
	const desc = data.description || `Settlement for Invoice ${data.invoiceNumber}`;

	const lineItemsHtml =
		data.lineItems && data.lineItems.length > 0
			? data.lineItems
					.map(
						(item) => `
						<tr>
							<td style="padding: 8px 0 16px 0; vertical-align: top;">
								<strong style="color: #1d1d1f; font-size: 14px; display: block; font-weight: 600;">${item.label}</strong>
								${item.detail ? `<span style="font-size: 13px; color: #687385; display: block; margin-top: 4px;">${item.detail}</span>` : ""}
							</td>
							<td style="padding: 8px 0 16px 0; text-align: right; color: #1d1d1f; font-size: 14px; vertical-align: top; font-weight: 500;">
								${formatGhs(item.amountGhs)}
							</td>
						</tr>`,
					)
					.join("")
			: `
					<tr>
						<td style="padding: 8px 0 16px 0; vertical-align: top;">
							<strong style="color: #1d1d1f; font-size: 14px; display: block; font-weight: 600;">${desc}</strong>
						</td>
						<td style="padding: 8px 0 16px 0; text-align: right; color: #1d1d1f; font-size: 14px; vertical-align: top; font-weight: 500;">
							${ghsStr}
						</td>
					</tr>`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Receipt from Century NIT Consult</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
	<table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f6f9fc; padding: 40px 20px;">
		<tr>
			<td>
				<table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; margin: 0 auto;">
					<!-- Header / Logo -->
					<tr>
						<td align="center" style="padding-bottom: 24px;">
							<h2 style="margin: 0; color: #1d1d1f; font-size: 16px; font-weight: 700; letter-spacing: 0.5px;">CENTURY NIT CONSULT</h2>
						</td>
					</tr>
					
					<!-- Card 1: Summary -->
					<tr>
						<td style="padding-bottom: 16px;">
							<table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);">
								<tr>
									<td style="padding: 32px 40px;">
										<p style="margin: 0; color: #687385; font-size: 14px; font-weight: 500;">Receipt from Century NIT Consult</p>
										<h1 style="margin: 12px 0; color: #1d1d1f; font-size: 36px; font-weight: 700; letter-spacing: -0.5px;">${ghsStr}</h1>
										<p style="margin: 0; color: #687385; font-size: 14px;">Paid ${data.paymentDate}</p>
										
										<div style="margin: 24px 0; border-top: 1px solid #e6ebf1;"></div>
										
										<table width="100%" border="0" cellpadding="0" cellspacing="0">
											<tr>
												<td style="padding: 6px 0; color: #687385; font-size: 14px; width: 40%;">Receipt number</td>
												<td style="padding: 6px 0; color: #1d1d1f; font-size: 14px; font-weight: 500; text-align: right;">${data.receiptNumber}</td>
											</tr>
											<tr>
												<td style="padding: 6px 0; color: #687385; font-size: 14px;">Invoice number</td>
												<td style="padding: 6px 0; color: #1d1d1f; font-size: 14px; font-weight: 500; text-align: right;">${data.invoiceNumber}</td>
											</tr>
											<tr>
												<td style="padding: 6px 0; color: #687385; font-size: 14px;">Payment method</td>
												<td style="padding: 6px 0; color: #1d1d1f; font-size: 14px; font-weight: 500; text-align: right;">${data.paymentChannel}</td>
											</tr>
										</table>
									</td>
								</tr>
							</table>
						</td>
					</tr>
					
					<!-- Card 2: Details -->
					<tr>
						<td>
							<table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);">
								<tr>
									<td style="padding: 32px 40px;">
										<h3 style="margin: 0 0 24px 0; color: #1d1d1f; font-size: 16px; font-weight: 600;">Receipt ${data.receiptNumber}</h3>
										
										<table width="100%" border="0" cellpadding="0" cellspacing="0">
											${lineItemsHtml}
											
											<tr>
												<td colspan="2" style="padding: 16px 0; border-top: 1px solid #e6ebf1; border-bottom: 1px solid #e6ebf1;">
													<table width="100%" border="0" cellpadding="0" cellspacing="0">
														<tr>
															<td style="padding: 8px 0; color: #1d1d1f; font-size: 14px; font-weight: 600;">Total</td>
															<td style="padding: 8px 0; color: #1d1d1f; font-size: 14px; font-weight: 600; text-align: right;">${ghsStr}</td>
														</tr>
														<tr>
															<td style="padding: 8px 0; color: #1d1d1f; font-size: 14px; font-weight: 600;">Amount paid</td>
															<td style="padding: 8px 0; color: #1d1d1f; font-size: 14px; font-weight: 600; text-align: right;">${ghsStr}</td>
														</tr>
													</table>
												</td>
											</tr>
											
											${usdStr ? `
											<tr>
												<td colspan="2" style="padding: 16px 0 0 0;">
													<table width="100%" border="0" cellpadding="0" cellspacing="0">
														<tr>
															<td style="padding: 4px 0; color: #687385; font-size: 13px;">USD Equivalent</td>
															<td style="padding: 4px 0; color: #687385; font-size: 13px; text-align: right; font-weight: 500;">${usdStr}</td>
														</tr>
													</table>
												</td>
											</tr>
											` : ""}
										</table>
									</td>
								</tr>
							</table>
						</td>
					</tr>
					
					<!-- Footer -->
					<tr>
						<td align="center" style="padding: 32px 0 16px 0;">
							<p style="margin: 0; color: #687385; font-size: 13px;">
								Questions? Contact us at <a href="mailto:info@century-nit.com" style="color: #635bff; text-decoration: none; font-weight: 500;">info@century-nit.com</a>.
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>`;
}

/**
 * The receipt as a queueable message — the settlement path enqueues it so a
 * Resend outage retries instead of losing the client's proof of payment, and
 * the delivery lands in notification_log. Keyed on the payment reference so
 * a manual resend updates the same audit row.
 */
export function receiptEmailMessage(data: ReceiptEmailData): QueuedEmail {
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

	return {
		to: data.recipientEmail,
		subject: `Official Payment Receipt: ${data.invoiceNumber} (Century NIT Consult)`,
		html,
		text,
		idempotencyKey: `receipt:${data.reference || data.receiptNumber}`,
		template: "Payment receipt",
		reference: data.invoiceNumber,
	};
}

/**
 * Manual resend (ops "Send receipt") — sent inline so the route can report a
 * delivery failure, and logged to notification_log by sendEmail itself.
 */
export async function sendPaymentReceiptEmail(data: ReceiptEmailData): Promise<void> {
	if (!data.recipientEmail) return;

	const message = receiptEmailMessage(data);
	try {
		await sendEmail({
			to: message.to,
			subject: message.subject,
			html: message.html,
			text: message.text,
			log: { template: message.template, reference: message.reference, idempotencyKey: message.idempotencyKey },
		});
		console.log(`[receipt] Sent official branded receipt to ${data.recipientEmail} for invoice ${data.invoiceNumber}`);
	} catch (err) {
		console.error(`[receipt] Failed to send receipt email to ${data.recipientEmail}:`, err);
		// Surface the failure so callers (and the API route) can tell the user
		// the receipt was NOT delivered instead of reporting a false success.
		throw err;
	}
}
