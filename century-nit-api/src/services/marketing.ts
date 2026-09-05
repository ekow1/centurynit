import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { marketingCampaigns, mailingListContacts, campaignRecipients } from "../db/schema.js";
import { sendEmail } from "../lib/resend.js";
import { env } from "../env.js";
import { queueCampaignSend, cancelQueuedCampaignSend } from "../worker/queues.js";

/**
 * Campaign delivery — the client-facing half of the marketing queue.
 *
 * Enqueuing a send snapshots the mailing list's confirmed contacts into
 * `campaign_recipients` and hands a job to BullMQ (delayed when the campaign is
 * scheduled for the future). The worker process then runs `runCampaignSend`,
 * which walks the ledger row by row: personalize, attach an unsubscribe link,
 * send, and record the per-recipient outcome. Aggregate counters on the
 * campaign row are derived from the ledger afterwards.
 */

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function emailLayout({
	title,
	bodyHtml,
	footerNote,
}: {
	title: string;
	bodyHtml: string;
	footerNote?: string;
}): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Georgia,'Times New Roman',Times,serif;-webkit-font-smoothing:antialiased;color:#000000;">
	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f5f5f5;padding:32px 16px;">
		<tr>
			<td align="center">
				<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#ffffff;border:4px solid #000000;">
					<tr>
						<td style="background-color:#000000;padding:28px 36px;text-align:left;border-bottom:4px solid #000000;">
							<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
								<tr>
									<td>
										<div style="display:inline-block;padding:3px 8px;border:1px solid #ffffff;margin-bottom:8px;">
											<span style="color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;">Century NIT</span>
										</div>
										<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;line-height:1.3;font-family:Georgia,'Times New Roman',Times,serif;">
											${escapeHtml(title)}
										</h1>
									</td>
								</tr>
							</table>
						</td>
					</tr>
					<tr>
						<td style="padding:36px 36px 28px 36px;font-size:15px;line-height:1.65;color:#000000;">
							${bodyHtml}
						</td>
					</tr>
					<tr>
						<td style="background-color:#f5f5f5;padding:24px 36px;border-top:2px solid #000000;text-align:center;font-size:12px;line-height:1.6;color:#666666;">
							${footerNote ? `<p style="margin:0 0 8px 0;color:#999999;">${footerNote}</p>` : ""}
							<p style="margin:0;font-weight:600;color:#000000;font-family:ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace;font-size:11px;letter-spacing:0.5px;">
								Century NIT Consult
							</p>
							<p style="margin:4px 0 0 0;color:#999999;">
								Accra, Ghana &bull; London, UK &bull; support@centurynit.com
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
 * Give a contact an unsubscribe token if it somehow lacks one. Every campaign
 * email must carry a working opt-out link keyed on this token; rows minted
 * before tokens were mandatory get one lazily here.
 */
async function ensureConfirmToken(contactId: string, current: string | null): Promise<string> {
	if (current) return current;
	const token = randomUUID();
	await db
		.update(mailingListContacts)
		.set({ confirmToken: token })
		.where(eq(mailingListContacts.id, contactId));
	return token;
}

/**
 * Freeze the campaign's audience into `campaign_recipients` before the send
 * job runs. Called at enqueue time so the recipient list reflects the list at
 * the moment of scheduling, not whenever the job finally lands.
 */
export async function snapshotRecipientsForCampaign(campaignId: string): Promise<number> {
	const [campaign] = await db
		.select()
		.from(marketingCampaigns)
		.where(eq(marketingCampaigns.id, campaignId))
		.limit(1);
	if (!campaign?.mailingListId) return 0;

	// Any prior snapshot (retry after a partial failure) is replaced wholesale.
	await db
		.delete(campaignRecipients)
		.where(eq(campaignRecipients.campaignId, campaignId));

	const contacts = await db
		.select()
		.from(mailingListContacts)
		.where(eq(mailingListContacts.mailingListId, campaign.mailingListId));

	const rows = contacts
		.filter((c) => c.status === "confirmed")
		.map((c) => ({
			campaignId,
			contactId: c.id,
			email: c.email,
			name: c.name,
			status: "pending",
		}));

	if (rows.length > 0) {
		await db.insert(campaignRecipients).values(rows);
	}
	return rows.length;
}

/**
 * Enqueue (or re-enqueue) a campaign send.
 *
 * A future `scheduleFor` delays the BullMQ job, so the worker picks it up at
 * that instant. Returns the number of recipients frozen into the ledger.
 */
export async function enqueueCampaignSend(campaignId: string, scheduleFor?: Date): Promise<number> {
	const count = await snapshotRecipientsForCampaign(campaignId);
	const delay = scheduleFor ? Math.max(0, scheduleFor.getTime() - Date.now()) : 0;
	const status = scheduleFor && delay > 0 ? "scheduled" : "sending";

	await db
		.update(marketingCampaigns)
		.set({
			status,
			...((scheduleFor && delay > 0
				? { scheduledAt: scheduleFor }
				: { scheduledAt: null }) as object),
			recipientCount: count,
			updatedAt: new Date(),
		})
		.where(eq(marketingCampaigns.id, campaignId));

	if (count > 0) {
		await queueCampaignSend(campaignId, delay);
	}

	return count;
}

/** Cancel a scheduled (not yet started) campaign send job. */
export async function cancelCampaignSend(campaignId: string): Promise<void> {
	await cancelQueuedCampaignSend(campaignId);

	// Roll back from scheduled → draft. A job already running is allowed to
	// finish; only the queued-but-not-started case is cancelled here.
	await db
		.update(marketingCampaigns)
		.set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
		.where(eq(marketingCampaigns.id, campaignId));
}

/**
 * Worker-side: deliver a campaign from its recipient ledger.
 *
 * Every row is personalized and sent via the Resend-backed `sendEmail`, and
 * each outcome is recorded on its row. The campaign's aggregate counters are
 * recomputed from the ledger when the pass finishes. This reads the campaign
 * from the DB at run time, so edits made while the campaign was scheduled
 * (subject/body) apply to the actual delivery.
 */
export async function runCampaignSend(campaignId: string): Promise<void> {
	const [campaign] = await db
		.select()
		.from(marketingCampaigns)
		.where(eq(marketingCampaigns.id, campaignId))
		.limit(1);

	if (!campaign) return;

	if (!campaign.subject) {
		throw new Error(`Campaign ${campaignId} has no subject line`);
	}

	await db
		.update(marketingCampaigns)
		.set({ status: "sending", updatedAt: new Date() })
		.where(eq(marketingCampaigns.id, campaignId));

	const recipients = await db
		.select()
		.from(campaignRecipients)
		.where(eq(campaignRecipients.campaignId, campaignId));

	let delivered = 0;
	let failed = 0;

	for (const recipient of recipients) {
		const recipientName = recipient.name ?? "there";
		const personalizedSubject = campaign.subject
			.replace(/\{\{name\}\}/g, recipientName)
			.replace(/\{\{Name\}\}/g, recipientName);
		const personalizedBody = campaign.body
			.replace(/\{\{name\}\}/g, recipientName)
			.replace(/\{\{Name\}\}/g, recipientName);

		const unsubscribeUrl = await buildUnsubscribeUrl(recipient.contactId);
		const footerNote = `You're receiving this because you subscribed to Century NIT updates. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#000000;text-decoration:underline;">Unsubscribe</a>.`;

		const html = emailLayout({
			title: personalizedSubject,
			bodyHtml: personalizedBody,
			footerNote,
		});

		try {
			await sendEmail({
				to: recipient.email,
				subject: personalizedSubject,
				html,
			});
			delivered++;
			await db
				.update(campaignRecipients)
				.set({ status: "sent", sentAt: new Date(), error: null })
				.where(eq(campaignRecipients.id, recipient.id));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[marketing] Failed to send campaign ${campaignId} to ${recipient.email}:`, message);
			failed++;
			await db
				.update(campaignRecipients)
				.set({ status: "failed", error: message })
				.where(eq(campaignRecipients.id, recipient.id));
		}
	}

	await db
		.update(marketingCampaigns)
		.set({
			status: "sent",
			sentAt: new Date(),
			recipientCount: recipients.length,
			deliveredCount: delivered,
			failedCount: failed,
			updatedAt: new Date(),
		})
		.where(eq(marketingCampaigns.id, campaignId));

	console.log(
		`[marketing] Campaign ${campaignId} finished: ${delivered} delivered, ${failed} failed of ${recipients.length}`,
	);
}

async function buildUnsubscribeUrl(contactId: string | null): Promise<string> {
	if (!contactId) return `${env.FRONTEND_URL}/newsletter/unsubscribe?token=`;
	const [contact] = await db
		.select({ confirmToken: mailingListContacts.confirmToken })
		.from(mailingListContacts)
		.where(eq(mailingListContacts.id, contactId))
		.limit(1);
	const token = await ensureConfirmToken(contactId, contact?.confirmToken ?? null);
	return `${env.FRONTEND_URL}/newsletter/unsubscribe?token=${token}`;
}