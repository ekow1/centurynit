import { sendEmail } from "../lib/resend.js";
import { emailLayout, escapeHtml } from "../lib/email-templates.js";
import { env } from "../env.js";
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
	/** Invoice kind — rendered as the chapter line ("Chapter III · Applications"). */
	invoiceType?: string;
	/** What is still owed on the invoice after this payment (USD). Rendered
	 * as a "Balance remaining" row only when positive. */
	balanceUsd?: number | null;
}

export function formatGhs(amount: number): string {
	return `GH₵ ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsd(amount: number): string {
	return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Which journey chapter an invoice belongs to — the receipt reads in the
 * client's vocabulary, not the ledger's. */
export const INVOICE_CHAPTERS: Record<string, string> = {
	consultation: "Chapter I · Consultation",
	agency: "Chapter II · Enrolment",
	application: "Chapter III · Applications",
	visa: "Chapter IV · Visa",
	travel: "Chapter V · Departure",
};

export function generateReceiptHtml(data: ReceiptEmailData): string {
	const ghsStr = formatGhs(data.amountGhs);
	const usdStr = data.amountUsd != null ? formatUsd(data.amountUsd) : "";
	const desc = escapeHtml(data.description || `Settlement for Invoice ${data.invoiceNumber}`);
	const ledgerUrl = `${env.FRONTEND_URL}/portal/financial`;
	const chapter = data.invoiceType ? INVOICE_CHAPTERS[data.invoiceType] : undefined;
	const channel = escapeHtml(data.paymentChannel.replace(/_/g, " ").toUpperCase());
	const remaining = data.balanceUsd != null && data.balanceUsd > 0.004 ? formatUsd(data.balanceUsd) : null;

	const itemRow = (label: string, detail: string | null | undefined, amount: string, last = false) => {
		const border = last ? "border-bottom:1px solid #d4d4d8;" : "";
		return `
						<tr>
							<td style="padding:8px 0 14px;vertical-align:top;${border}">
								<strong style="font-size:14px;font-weight:600">${label}</strong>
								${detail ? `<span style="display:block;font-size:12px;color:#666666;margin-top:3px">${detail}</span>` : ""}
							</td>
							<td style="padding:8px 0 14px;text-align:right;font-size:14px;font-weight:500;vertical-align:top;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;${border}">${amount}</td>
						</tr>`;
	};

	const items = data.lineItems && data.lineItems.length > 0
		? data.lineItems
		: [{ label: desc, detail: null, amountUsd: data.amountUsd ?? 0, amountGhs: data.amountGhs }];

	const lineItemsHtml = items
		.map((item, i) =>
			itemRow(
				escapeHtml(item.label),
				item.detail ? escapeHtml(item.detail) : null,
				formatUsd(item.amountUsd),
				i === items.length - 1,
			),
		)
		.join("");

	const subtotalUsd = items.reduce((sum, item) => sum + item.amountUsd, 0);

	const bodyHtml = `
		<!-- Summary — amount first, then the refs -->
		<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
			<td style="padding:28px 36px 24px;border-bottom:1px solid #d4d4d8;">
				<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
					<td>
						<p style="margin:0;color:#666666;font-size:13px;">Receipt from Century NIT Consult</p>
						<p style="margin:10px 0 0;font-size:34px;font-weight:800;letter-spacing:-1px;font-family:Georgia,'Times New Roman',Times,serif;">${ghsStr}</p>
						<p style="margin:6px 0 0;color:#666666;font-size:13px;">Paid ${escapeHtml(data.paymentDate)}${usdStr ? ` · ≈ ${usdStr}` : ""}</p>
						<p style="margin:16px 0 0;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:12px;">
							<a href="${escapeHtml(ledgerUrl)}" style="color:#000000;text-decoration:underline;text-underline-offset:3px;">↓ Download invoice</a>
							&nbsp;&nbsp;
							<a href="${escapeHtml(ledgerUrl)}" style="color:#000000;text-decoration:underline;text-underline-offset:3px;">↓ Download receipt</a>
						</p>
					</td>
					<td align="right" valign="top" style="width:64px;">
						<div style="width:44px;height:56px;border:2px solid #000000;padding:8px 7px;">
							<div style="height:2px;background:#000000;margin-bottom:5px;"></div>
							<div style="height:2px;background:#000000;margin-bottom:5px;"></div>
							<div style="height:2px;background:#000000;margin-bottom:5px;"></div>
							<div style="height:2px;background:#000000;width:60%;"></div>
						</div>
					</td>
				</tr></table>

				<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top:20px;">
					<tr>
						<td style="padding:6px 0;color:#666666;font-size:13px;width:45%;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:.3px;">Receipt number</td>
						<td style="padding:6px 0;color:#000000;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(data.receiptNumber)}</td>
					</tr>
					<tr>
						<td style="padding:6px 0;color:#666666;font-size:13px;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:.3px;">Invoice number</td>
						<td style="padding:6px 0;color:#000000;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(data.invoiceNumber)}</td>
					</tr>
					<tr>
						<td style="padding:6px 0;color:#666666;font-size:13px;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:.3px;">Payment method</td>
						<td style="padding:6px 0;color:#000000;font-size:13px;font-weight:600;text-align:right;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">${channel}</td>
					</tr>
				</table>
			</td>
		</tr></table>

		<!-- Detail — what the payment covered -->
		<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
			<td style="padding:28px 36px;">
				<p style="margin:0 0 4px;font-size:15px;font-weight:700;">Receipt ${escapeHtml(data.receiptNumber)}</p>
				<p style="margin:0 0 20px;color:#666666;font-size:12px;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">${escapeHtml(chapter ?? desc)} — paid ${escapeHtml(data.paymentDate)}</p>

				<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
					${lineItemsHtml}
					<tr>
						<td colspan="2" style="padding:14px 0 0;">
							<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
								<tr>
									<td style="padding:5px 0;color:#666666;font-size:13px;">Subtotal</td>
									<td style="padding:5px 0;color:#000000;font-size:13px;text-align:right;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">${formatUsd(subtotalUsd)}</td>
								</tr>
								<tr>
									<td style="padding:10px 0 5px;color:#000000;font-size:14px;font-weight:700;border-top:1.5px solid #000000;">Total</td>
									<td style="padding:10px 0 5px;color:#000000;font-size:14px;font-weight:700;text-align:right;border-top:1.5px solid #000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">${formatUsd(subtotalUsd)}</td>
								</tr>
								<tr>
									<td style="padding:5px 0;color:#000000;font-size:14px;font-weight:700;">Amount paid</td>
									<td style="padding:5px 0;color:#000000;font-size:14px;font-weight:700;text-align:right;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">${usdStr || ghsStr}</td>
								</tr>
								${remaining ? `
								<tr>
									<td style="padding:5px 0;color:#666666;font-size:13px;">Balance remaining</td>
									<td style="padding:5px 0;color:#666666;font-size:13px;text-align:right;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">${remaining}</td>
								</tr>` : ""}
								<tr>
									<td style="padding:5px 0;color:#666666;font-size:12px;">Paid in GHS</td>
									<td style="padding:5px 0;color:#666666;font-size:12px;text-align:right;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">${ghsStr}</td>
								</tr>
							</table>
						</td>
					</tr>
				</table>

				<p style="margin:22px 0 0;color:#666666;font-size:13px;">
					Invoice and receipt are attached as PDFs. Questions? Reply to this email or visit your
					<a href="${escapeHtml(ledgerUrl)}" style="color:#000000;text-decoration:underline;text-underline-offset:3px;">Money ledger</a>.
				</p>
			</td>
		</tr></table>

		<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
			<td align="center" style="padding:0 36px 20px;">
				<p style="margin:0;color:#999999;font-size:11px;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;letter-spacing:.5px;">PAYMENTS PROCESSED BY PAYSTACK</p>
			</td>
		</tr></table>`;

	return emailLayout({
		title: "Your receipt from Century NIT Consult",
		preheader: `${ghsStr} received — receipt ${data.receiptNumber}`,
		bodyHtml,
		footerNote: `Reference: ${escapeHtml(data.reference)}`,
		flush: true,
	});
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
		`Your invoice and receipt are attached as PDFs.\n` +
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
