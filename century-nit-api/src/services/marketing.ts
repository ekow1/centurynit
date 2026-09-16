import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { marketingCampaigns, mailingListContacts, campaignRecipients } from "../db/schema.js";
import { sendEmail } from "../lib/resend.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
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
		const merged = mergeFields(campaign.subject ?? "", campaign.body, {
			name: recipient.name,
			email: recipient.email,
		});

		const unsubscribeUrl = await buildUnsubscribeUrl(recipient.contactId);
		const footerNote = `You're receiving this because you subscribed to Century NIT updates. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#000000;text-decoration:underline;">Unsubscribe</a>.`;

		const html = emailLayout({
			title: merged.subject,
			bodyHtml: merged.body,
			footerNote,
		});

		try {
			const result = await sendEmail({
				to: recipient.email,
				subject: merged.subject,
				html,
			});
			delivered++;
			await db
				.update(campaignRecipients)
				.set({
					status: "sent",
					sentAt: new Date(),
					error: null,
					providerMessageId: result?.id ?? null,
				})
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

/* ── Merge fields ───────────────────────────────────────────────────────── */

/**
 * The only substitutions the campaign engine performs. Anything else in the
 * body goes out literally — the compose UI advertises exactly this set so an
 * operator can never write a placeholder that silently survives to delivery.
 *
 * `{{date}}` renders today's date in a reader-friendly long form.
 */
export function mergeFields(
	subject: string,
	body: string,
	contact: { name: string | null; email: string },
): { subject: string; body: string } {
	const name = contact.name?.trim() || "there";
	const today = new Date().toLocaleDateString("en-GB", {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});
	const apply = (s: string) =>
		s
			.replace(/\{\{\s*name\s*\}\}/gi, name)
			.replace(/\{\{\s*email\s*\}\}/gi, contact.email)
			.replace(/\{\{\s*date\s*\}\}/gi, today);
	return { subject: apply(subject), body: apply(body) };
}

/* ── Preview + test send ────────────────────────────────────────────────── */

/**
 * Render a campaign's email exactly as the worker would — same layout, same
 * merge set, same unsubscribe footer — so the preview IS the artifact.
 * A sample contact is used for the merge when no real one is supplied.
 */
export async function renderCampaignPreview(input: {
	subject: string;
	body: string;
	sampleName?: string;
	sampleEmail?: string;
}): Promise<{ html: string; subject: string }> {
	const merged = mergeFields(input.subject, input.body, {
		name: input.sampleName ?? "Ama Serwaa",
		email: input.sampleEmail ?? "ama.s@example.com",
	});
	const footerNote = `You're receiving this because you subscribed to Century NIT updates. <span style="color:#000000;text-decoration:underline;">Unsubscribe</span>.`;
	return {
		subject: merged.subject,
		html: emailLayout({ title: merged.subject, bodyHtml: merged.body, footerNote }),
	};
}

/**
 * Send a campaign draft to a single address — the same personalize + layout +
 * footer path the worker runs, addressed to the operator instead of the list.
 * Does not touch the recipient ledger or the campaign's lifecycle.
 */
export async function sendCampaignTest(
	campaignId: string,
	to: string,
): Promise<void> {
	const [campaign] = await db
		.select()
		.from(marketingCampaigns)
		.where(eq(marketingCampaigns.id, campaignId))
		.limit(1);
	if (!campaign) {
		throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
	}
	if (campaign.channel === "sms") {
		throw new HttpError(422, "SMS_NOT_SUPPORTED", "SMS delivery isn't configured — email campaigns only.");
	}
	if (!campaign.subject) {
		throw new HttpError(422, "CAMPAIGN_INCOMPLETE", "The campaign needs a subject before a test can send.");
	}

	const merged = mergeFields(campaign.subject, campaign.body, {
		name: "Ama Serwaa",
		email: to,
	});
	const footerNote = `This is a test send of “${escapeHtml(campaign.name)}”. <a href="${escapeHtml(env.FRONTEND_URL)}" style="color:#000000;text-decoration:underline;">Unsubscribe</a>.`;
	await sendEmail({
		to,
		subject: `[TEST] ${merged.subject}`,
		html: emailLayout({ title: merged.subject, bodyHtml: merged.body, footerNote }),
		log: { template: `campaign-test:${campaign.name}` },
	});
}

/**
 * Re-enqueue delivery for only the failed rows of a sent campaign. Rows are
 * flipped back to `pending` and the queue job walks just those — the delivered
 * half of the ledger is untouched.
 */
export async function retryFailedRecipients(campaignId: string): Promise<number> {
	const [campaign] = await db
		.select()
		.from(marketingCampaigns)
		.where(eq(marketingCampaigns.id, campaignId))
		.limit(1);
	if (!campaign) throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
	if (campaign.channel === "sms") {
		throw new HttpError(422, "SMS_NOT_SUPPORTED", "SMS delivery isn't configured — email campaigns only.");
	}

	const failed = await db
		.select({ id: campaignRecipients.id })
		.from(campaignRecipients)
		.where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "failed")));
	if (failed.length === 0) return 0;

	await db
		.update(campaignRecipients)
		.set({ status: "pending", error: null })
		.where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "failed")));

	await db
		.update(marketingCampaigns)
		.set({ status: "sending", updatedAt: new Date() })
		.where(eq(marketingCampaigns.id, campaignId));

	await queueCampaignSend(campaignId);
	return failed.length;
}

/* ── Resend delivery webhook ────────────────────────────────────────────── */

/**
 * Map a Resend webhook event onto the recipient row it belongs to. Resend
 * identifies the email by the id it returned at send, stored on
 * `providerMessageId` — we never match by address (a recipient can appear in
 * many campaigns).
 */
export async function applyResendEvent(event: {
	type: string;
	data?: { email_id?: string; created_at?: string };
}): Promise<void> {
	const providerId = event.data?.email_id;
	if (!providerId) return;

	const at = event.data?.created_at ? new Date(event.data.created_at) : new Date();
	const set: Record<string, unknown> = {};
	if (event.type === "email.opened") {
		set.openedAt = at;
	} else if (event.type === "email.bounced" || event.type === "email.complained") {
		set.bouncedAt = at;
		set.status = "failed";
		set.error = event.type === "email.bounced" ? "Bounced (provider report)" : "Spam complaint";
	} else {
		return; // delivered/sent/clicked — nothing to record yet
	}

	await db
		.update(campaignRecipients)
		.set(set)
		.where(eq(campaignRecipients.providerMessageId, providerId));
}