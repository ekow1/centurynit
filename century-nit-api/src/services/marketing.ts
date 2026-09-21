import { and, count, desc, eq, inArray, isNotNull, isNull, lt, sql, type SQLWrapper } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
	applicants,
	applications,
	automationSends,
	campaignLinks,
	campaignRecipients,
	emailTemplate,
	invoiceLines,
	invoices,
	leads,
	mailingListContacts,
	marketingAutomations,
	marketingCampaigns,
	marketingOptins,
	marketingSegments,
	marketingSuppressions,
	opsUsers,
} from "../db/schema.js";
import { sendEmail } from "../lib/resend.js";
import { formatUsd } from "./receiptEmail.js";
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
	preheader,
}: {
	title: string;
	bodyHtml: string;
	footerNote?: string;
	/** Inbox preview text — hidden in the body, shown by the mail client. */
	preheader?: string;
}): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Georgia,'Times New Roman',Times,serif;-webkit-font-smoothing:antialiased;color:#000000;">
${preheader ? `	<span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:#f5f5f5;">${escapeHtml(preheader)}</span>` : ""}
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
 * Resolve the campaign's audience into `campaign_recipients`.
 *
 * Two audience kinds:
 *  - segment_id → evaluated live right now; only opted-in, unsuppressed
 *    matches land as `pending`; suppressed/never-asked matches land as
 *    `skipped` so the ledger honestly shows why they weren't mailed.
 *  - mailing_list_id → the list's confirmed contacts, minus anything on the
 *    suppression table.
 *
 * Called at enqueue (so the queue row shows a real count) and again at send
 * for scheduled campaigns — the enqueue snapshot is never trusted blindly.
 * Already-sent rows are preserved; only pending/skipped rows are re-derived.
 */
export async function snapshotRecipientsForCampaign(campaignId: string, preserveSent = false): Promise<number> {
	const [campaign] = await db
		.select()
		.from(marketingCampaigns)
		.where(eq(marketingCampaigns.id, campaignId))
		.limit(1);
	if (!campaign?.mailingListId && !campaign?.segmentId) return 0;

	// Replace only rows the worker hasn't touched — a resnapshot mid-flight or
	// after a partial send must never resurrect or delete sent rows.
	await db
		.delete(campaignRecipients)
		.where(
			and(
				eq(campaignRecipients.campaignId, campaignId),
				preserveSent ? inArray(campaignRecipients.status, ["pending", "skipped"]) : undefined,
			),
		);

	let audience: AudienceRow[];
	if (campaign.segmentId) {
		const [segment] = await db.select().from(marketingSegments).where(eq(marketingSegments.id, campaign.segmentId)).limit(1);
		if (!segment) return 0;
		audience = await evaluateSegment({ entity: segment.entity, filters: segment.filters });
	} else {
		const contacts = await db
			.select({ email: mailingListContacts.email, name: mailingListContacts.name, contactId: mailingListContacts.id })
			.from(mailingListContacts)
			.where(and(eq(mailingListContacts.mailingListId, campaign.mailingListId!), eq(mailingListContacts.status, "confirmed")));
		audience = contacts.map((c) => ({ ...c, email: normEmail(c.email) }));
	}

	const consent = await consentStatesFor(audience.map((r) => r.email));
	const already = preserveSent
		? new Set(
				(await db
					.select({ email: campaignRecipients.email })
					.from(campaignRecipients)
					.where(eq(campaignRecipients.campaignId, campaignId))
				).map((r) => normEmail(r.email)),
			)
		: new Set<string>();

	const rows = audience
		.filter((r) => !already.has(normEmail(r.email)))
		.map((r) => {
			const state = consent.get(normEmail(r.email)) ?? "never_asked";
			return {
				campaignId,
				contactId: r.contactId,
				email: normEmail(r.email),
				name: r.name,
				status: state === "opted_in" ? "pending" : "skipped",
			};
		});

	if (rows.length > 0) {
		await db.insert(campaignRecipients).values(rows);
	}
	return rows.filter((r) => r.status === "pending").length;
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

	// Scheduled sends must not mail a stale audience — re-derive the segment
	// or list now, keeping any rows the worker already delivered.
	if (campaign.segmentId || campaign.mailingListId) {
		await snapshotRecipientsForCampaign(campaignId, true);
	}

	await db
		.update(marketingCampaigns)
		.set({ status: "sending", updatedAt: new Date() })
		.where(eq(marketingCampaigns.id, campaignId));

	const bodySource = blocksToHtml(campaign.body, campaign.blocks);
	const mergeContexts = await loadMergeContexts(
		(await db.select({ email: campaignRecipients.email }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId))).map((r) => r.email),
	);

	let delivered = 0;
	let failed = 0;

	// Pending-only batches: delivered/skipped rows are never walked again, so
	// a BullMQ retry after a crash can't double-send, and `skipped` is honored.
	for (;;) {
		const batch = await db
			.select()
			.from(campaignRecipients)
			.where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "pending")))
			.limit(200);
		if (batch.length === 0) break;

		// Send-time consent: an unsubscribe or bounce between enqueue and now
		// must stop the send — the snapshot is not authoritative.
		const live = await consentStatesFor(batch.map((r) => r.email));

		for (const recipient of batch) {
			if (live.get(normEmail(recipient.email)) === "suppressed") {
				await db.update(campaignRecipients).set({ status: "skipped" }).where(eq(campaignRecipients.id, recipient.id));
				continue;
			}
			const merged = mergeFields(campaign.subject ?? "", bodySource, {
				name: recipient.name,
				email: recipient.email,
				ctx: mergeContexts.get(normEmail(recipient.email)),
			});

			const unsubscribeUrl = await buildUnsubscribeUrl(recipient.contactId, recipient.email);
			const preferencesUrl = buildPreferencesUrl(recipient.email);
			const footerNote = `You're receiving this because you subscribed to Century NIT updates. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#000000;text-decoration:underline;">Unsubscribe</a> &middot; <a href="${escapeHtml(preferencesUrl)}" style="color:#000000;text-decoration:underline;">Email preferences</a>.`;

			let html = emailLayout({
				title: merged.subject,
				bodyHtml: merged.body,
				footerNote,
				preheader: campaign.preheader ?? undefined,
			});
			html = await buildTrackedLinks(campaignId, recipient.id, html);

			try {
				const result = await sendEmail({
					to: recipient.email,
					subject: merged.subject,
					html,
					replyTo: campaign.replyTo ?? undefined,
					fromName: campaign.fromName ?? undefined,
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
	}

	// Counters derive from the ledger, not from this pass — a retried run only
	// counts what it actually sent.
	const [totals] = await db
		.select({
			total: count(),
			sent: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'sent')`,
			failed: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'failed')`,
		})
		.from(campaignRecipients)
		.where(eq(campaignRecipients.campaignId, campaignId));

	await db
		.update(marketingCampaigns)
		.set({
			status: "sent",
			sentAt: new Date(),
			recipientCount: Number(totals.total),
			deliveredCount: Number(totals.sent),
			failedCount: Number(totals.failed),
			updatedAt: new Date(),
		})
		.where(eq(marketingCampaigns.id, campaignId));

	console.log(
		`[marketing] Campaign ${campaignId} finished: ${delivered} delivered, ${failed} failed this pass of ${totals.total} ledger rows`,
	);
}

/**
 * Token-less unsubscribe identity for people who aren't list contacts —
 * an HMAC of the address under the auth secret, verified on the way in.
 */
export function unsubKeyFor(email: string): string {
	return createHmac("sha256", env.BETTER_AUTH_SECRET).update(normEmail(email)).digest("hex").slice(0, 32);
}

function unsubscribeUrlForEmail(email: string): string {
	return `${env.FRONTEND_URL}/newsletter/unsubscribe?email=${encodeURIComponent(normEmail(email))}&key=${unsubKeyFor(email)}`;
}

async function buildUnsubscribeUrl(contactId: string | null, email?: string): Promise<string> {
	if (!contactId) return unsubscribeUrlForEmail(email ?? "");
	const [contact] = await db
		.select({ confirmToken: mailingListContacts.confirmToken })
		.from(mailingListContacts)
		.where(eq(mailingListContacts.id, contactId))
		.limit(1);
	const token = await ensureConfirmToken(contactId, contact?.confirmToken ?? null);
	return `${env.FRONTEND_URL}/newsletter/unsubscribe?token=${token}`;
}

function buildPreferencesUrl(email?: string): string {
	if (!email) return `${env.FRONTEND_URL}/newsletter/preferences`;
	return `${env.FRONTEND_URL}/newsletter/preferences?email=${encodeURIComponent(normEmail(email))}&key=${unsubKeyFor(email)}`;
}

/* ── Merge fields ───────────────────────────────────────────────────────── */

/**
 * The only substitutions the campaign engine performs. Anything else in the
 * body goes out literally — the compose UI advertises exactly this set so an
 * operator can never write a placeholder that silently survives to delivery.
 *
 * `{{date}}` renders today's date in a reader-friendly long form. The suite
 * fields (`case_ref`, `stage`, `officer`, `branch`, `next_due`, …) come from
 * the per-campaign merge context loaded once per send — a recipient with no
 * case just gets the fallbacks.
 */
export function mergeFields(
	subject: string,
	body: string,
	contact: { name: string | null; email: string; ctx?: MergeContext },
): { subject: string; body: string } {
	const name = contact.name?.trim() || "there";
	const ctx = contact.ctx;
	const today = new Date().toLocaleDateString("en-GB", {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});
	const apply = (s: string) =>
		s
			.replace(/\{\{\s*name\s*\}\}/gi, name)
			.replace(/\{\{\s*first_name\s*\}\}/gi, name.split(" ")[0] || "there")
			.replace(/\{\{\s*email\s*\}\}/gi, contact.email)
			.replace(/\{\{\s*date\s*\}\}/gi, today)
			.replace(/\{\{\s*case_ref\s*\}\}/gi, ctx?.caseRef ?? "—")
			.replace(/\{\{\s*stage\s*\}\}/gi, ctx?.stage ?? "—")
			.replace(/\{\{\s*officer\s*\}\}/gi, ctx?.officer ?? "Your handler")
			.replace(/\{\{\s*branch\s*\}\}/gi, ctx?.branch ?? "—")
			.replace(/\{\{\s*next_due\s*\}\}/gi, ctx?.nextDue ?? "—")
			.replace(/\{\{\s*arrival_window\s*\}\}/gi, ctx?.arrivalWindow ?? "to be confirmed")
			.replace(/\{\{\s*portal_link\s*\}\}/gi, ctx?.portalLink ?? `${env.FRONTEND_URL}/portal`)
			.replace(/\{\{\s*preferences_link\s*\}\}/gi, ctx?.preferencesLink ?? `${env.FRONTEND_URL}/newsletter/preferences`);
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
	body?: string;
	blocks?: unknown;
	preheader?: string;
	sampleName?: string;
	sampleEmail?: string;
}): Promise<{ html: string; subject: string }> {
	const ctx = input.sampleEmail ? (await loadMergeContexts([input.sampleEmail])).get(normEmail(input.sampleEmail)) : undefined;
	const merged = mergeFields(input.subject, blocksToHtml(input.body, input.blocks), {
		name: input.sampleName ?? "Ama Serwaa",
		email: input.sampleEmail ?? "ama.s@example.com",
		ctx,
	});
	const footerNote = `You're receiving this because you subscribed to Century NIT updates. <span style="color:#000000;text-decoration:underline;">Unsubscribe</span> &middot; <span style="color:#000000;text-decoration:underline;">Email preferences</span>.`;
	return {
		subject: merged.subject,
		html: emailLayout({ title: merged.subject, bodyHtml: merged.body, footerNote, preheader: input.preheader }),
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

	const ctx = (await loadMergeContexts([to])).get(normEmail(to));
	const merged = mergeFields(campaign.subject, blocksToHtml(campaign.body, campaign.blocks), {
		name: "Ama Serwaa",
		email: to,
		ctx,
	});
	const footerNote = `This is a test send of “${escapeHtml(campaign.name)}”. <a href="${escapeHtml(env.FRONTEND_URL)}" style="color:#000000;text-decoration:underline;">Unsubscribe</a>.`;
	await sendEmail({
		to,
		subject: `[TEST] ${merged.subject}`,
		html: emailLayout({ title: merged.subject, bodyHtml: merged.body, footerNote, preheader: campaign.preheader ?? undefined }),
		replyTo: campaign.replyTo ?? undefined,
		fromName: campaign.fromName ?? undefined,
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
	const isBounce = event.type === "email.bounced" || event.type === "email.complained";
	if (event.type !== "email.opened" && !isBounce) return; // delivered/sent — nothing to record

	const set: Record<string, unknown> = event.type === "email.opened"
		? { openedAt: at }
		: {
				bouncedAt: at,
				status: "failed",
				error: event.type === "email.bounced" ? "Bounced (provider report)" : "Spam complaint",
			};

	const rows = await db
		.update(campaignRecipients)
		.set(set)
		.where(eq(campaignRecipients.providerMessageId, providerId))
		.returning({ email: campaignRecipients.email, campaignId: campaignRecipients.campaignId });

	// Automation sends ledger the same way — same provider id join.
	await db
		.update(automationSends)
		.set(set)
		.where(eq(automationSends.providerMessageId, providerId));

	// A bounce or complaint suppresses the address everywhere — the next
	// campaign skips it at send time even if a list still says "confirmed".
	if (isBounce) {
		for (const row of rows) {
			await suppressEmail(row.email, event.type === "email.bounced" ? "bounced" : "complained", undefined, row.campaignId);
		}
	}
}
/* ══════════════════════════════════════════════════════════════════════════
 * Consent & suppression — the person is the email address, not the list row.
 * ══════════════════════════════════════════════════════════════════════════ */

const normEmail = (email: string) => email.trim().toLowerCase();

/** Hard stop — never mail this address, whatever list or segment it's on. */
export async function isSuppressed(email: string): Promise<boolean> {
	const [row] = await db
		.select({ email: marketingSuppressions.email })
		.from(marketingSuppressions)
		.where(eq(marketingSuppressions.email, normEmail(email)))
		.limit(1);
	return Boolean(row);
}

export async function suppressEmail(email: string, reason: "bounced" | "complained" | "unsubscribed" | "manual", detail?: string, campaignId?: string): Promise<void> {
	await db
		.insert(marketingSuppressions)
		.values({ email: normEmail(email), reason, detail: detail ?? null, campaignId: campaignId ?? null })
		.onConflictDoUpdate({
			target: marketingSuppressions.email,
			set: { reason, detail: detail ?? null, campaignId: campaignId ?? null },
		});
}

export async function unsuppressEmail(email: string): Promise<void> {
	await db.delete(marketingSuppressions).where(eq(marketingSuppressions.email, normEmail(email)));
}

/** Record positive consent for an address. `note` is required for offline/staff consent — the audit trail. */
export async function recordOptIn(email: string, source: "confirm_link" | "portal" | "offline_note" | "staff_verified" | "import_confirm" | "grandfathered", note?: string): Promise<void> {
	await db
		.insert(marketingOptins)
		.values({ email: normEmail(email), source, note: note ?? null })
		.onConflictDoUpdate({
			target: marketingOptins.email,
			set: { source, note: note ?? null, updatedAt: new Date() },
		});
}

export async function removeOptIn(email: string): Promise<void> {
	await db.delete(marketingOptins).where(eq(marketingOptins.email, normEmail(email)));
}

export type ConsentState = "opted_in" | "never_asked" | "unsubscribed" | "suppressed";

/**
 * Consent for one address — suppression always wins, then opt-in, then the
 * list-level unsubscribe, then "we never asked".
 */
export async function consentStatesFor(emails: string[]): Promise<Map<string, ConsentState>> {
	const normed = [...new Set(emails.map(normEmail))];
	const out = new Map<string, ConsentState>(normed.map((e) => [e, "never_asked" as ConsentState]));
	if (normed.length === 0) return out;
	const [opts, sups, unsubs] = await Promise.all([
		db.select({ email: marketingOptins.email }).from(marketingOptins).where(inArray(marketingOptins.email, normed)),
		db.select({ email: marketingSuppressions.email, reason: marketingSuppressions.reason }).from(marketingSuppressions).where(inArray(marketingSuppressions.email, normed)),
		db.select({ email: mailingListContacts.email }).from(mailingListContacts).where(and(inArray(mailingListContacts.email, normed), eq(mailingListContacts.status, "unsubscribed"))),
	]);
	for (const r of unsubs) out.set(r.email.toLowerCase(), "unsubscribed");
	for (const r of opts) out.set(r.email.toLowerCase(), "opted_in");
	for (const r of sups) out.set(r.email.toLowerCase(), r.reason === "unsubscribed" ? "unsubscribed" : "suppressed");
	return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Segments — saved filters evaluated live over the suite's own data.
 * Each entity's field registry maps a filter onto a SQL fragment; ops:
 * is | is_not | within_days | older_than_days.
 * ══════════════════════════════════════════════════════════════════════════ */

type SegmentFilter = { field: string; op: string; value?: unknown };
type AudienceRow = { email: string; name: string | null; contactId: string | null };

const within = (col: unknown, days: number) => sql`${col} >= NOW() - make_interval(days => ${days})`;
const older = (col: unknown, days: number) => sql`(${col} IS NULL OR ${col} < NOW() - make_interval(days => ${days}))`;

function applicantFilterSql(f: SegmentFilter) {
	const v = String(f.value ?? "");
	switch (f.field) {
		case "country":
			return f.op === "is_not" ? sql`COALESCE(${applications.country}, ${applicants.targetCountry}) <> ${v}` : sql`COALESCE(${applications.country}, ${applicants.targetCountry}) = ${v}`;
		case "branch":
			return f.op === "is_not" ? sql`COALESCE(${applications.branch}, ${applicants.branch}) <> ${v}` : sql`COALESCE(${applications.branch}, ${applicants.branch}) = ${v}`;
		case "stage":
			return f.op === "is_not" ? sql`${applications.stage} <> ${v}` : sql`${applications.stage} = ${v}`;
		case "scope":
			return f.op === "is_not" ? sql`NOT COALESCE(${applications.scopeStages}, '[]'::jsonb) @> ${JSON.stringify([v])}::jsonb` : sql`COALESCE(${applications.scopeStages}, '[]'::jsonb) @> ${JSON.stringify([v])}::jsonb`;
		case "offer":
			return v === "none" ? isNull(applications.offerAcceptedAt) : isNotNull(applications.offerAcceptedAt);
		case "visaStage":
			return f.op === "is_not" ? sql`${applications.visaStage} <> ${v}` : sql`${applications.visaStage} = ${v}`;
		case "invoice":
			return v === "unpaid"
				? sql`EXISTS (SELECT 1 FROM ${invoices} WHERE ${invoices.applicationId} = ${applications.id} AND ${invoices.status} IN ('issued','partial'))`
				: sql`NOT EXISTS (SELECT 1 FROM ${invoices} WHERE ${invoices.applicationId} = ${applications.id} AND ${invoices.status} IN ('issued','partial'))`;
		case "lastActivity":
			return f.op === "within_days" ? within(applications.updatedAt, Number(v) || 30) : older(applications.updatedAt, Number(v) || 30);
		case "created":
			return f.op === "within_days" ? within(applications.createdAt, Number(v) || 30) : older(applications.createdAt, Number(v) || 30);
		default:
			return null;
	}
}

function leadFilterSql(f: SegmentFilter) {
	const v = String(f.value ?? "");
	switch (f.field) {
		case "stage":
			return f.op === "is_not" ? sql`${leads.stage} <> ${v}` : sql`${leads.stage} = ${v}`;
		case "source":
			return f.op === "is_not" ? sql`${leads.source} <> ${v}` : sql`${leads.source} = ${v}`;
		case "country":
			return f.op === "is_not" ? sql`${leads.targetCountry} <> ${v}` : sql`${leads.targetCountry} = ${v}`;
		case "converted":
			return v === "yes" ? isNotNull(leads.applicationId) : isNull(leads.applicationId);
		case "lost":
			return v === "yes" ? isNotNull(leads.lostReason) : isNull(leads.lostReason);
		case "lastTouch":
			return f.op === "within_days" ? within(leads.lastClientTouchAt, Number(v) || 30) : older(leads.lastClientTouchAt, Number(v) || 30);
		case "created":
			return f.op === "within_days" ? within(leads.createdAt, Number(v) || 30) : older(leads.createdAt, Number(v) || 30);
		default:
			return null;
	}
}

function contactFilterSql(f: SegmentFilter) {
	const v = String(f.value ?? "");
	switch (f.field) {
		case "list":
			return eq(mailingListContacts.mailingListId, v);
		case "status":
			return f.op === "is_not" ? sql`${mailingListContacts.status} <> ${v}` : sql`${mailingListContacts.status} = ${v}`;
		case "engagement":
			if (v === "opened") return sql`EXISTS (SELECT 1 FROM ${campaignRecipients} cr WHERE lower(cr.email) = lower(${mailingListContacts.email}) AND cr.opened_at IS NOT NULL)`;
			if (v === "clicked") return sql`EXISTS (SELECT 1 FROM ${campaignRecipients} cr WHERE lower(cr.email) = lower(${mailingListContacts.email}) AND cr.clicked_at IS NOT NULL)`;
			return sql`NOT EXISTS (SELECT 1 FROM ${campaignRecipients} cr WHERE lower(cr.email) = lower(${mailingListContacts.email}) AND cr.opened_at IS NOT NULL)`;
		case "created":
			return f.op === "within_days" ? within(mailingListContacts.createdAt, Number(v) || 30) : older(mailingListContacts.createdAt, Number(v) || 30);
		default:
			return null;
	}
}

/**
 * Evaluate a segment live — the audience is whoever matches right now, not
 * who matched when it was saved. Returns deduped addresses with whatever
 * identity the suite holds.
 */
export async function evaluateSegment(segment: { entity: string; filters: SegmentFilter[] }): Promise<AudienceRow[]> {
	const conds: (SQLWrapper | undefined)[] = [];
	if (segment.entity === "applicants") {
		for (const f of segment.filters) conds.push(applicantFilterSql(f) ?? undefined);
		const rows = await db
			.selectDistinct({ email: applicants.email, name: applicants.name, contactId: mailingListContacts.id })
			.from(applicants)
			.innerJoin(applications, eq(applications.applicantId, applicants.id))
			.leftJoin(mailingListContacts, eq(sql`lower(${mailingListContacts.email})`, sql`lower(${applicants.email})`))
			.where(conds.length ? and(...conds) : undefined);
		return dedupeRows(rows);
	}
	if (segment.entity === "leads") {
		for (const f of segment.filters) conds.push(leadFilterSql(f) ?? undefined);
		const rows = await db
			.selectDistinct({ email: leads.email, name: leads.name, contactId: mailingListContacts.id })
			.from(leads)
			.leftJoin(mailingListContacts, eq(sql`lower(${mailingListContacts.email})`, sql`lower(${leads.email})`))
			.where(conds.length ? and(...conds) : undefined);
		return dedupeRows(rows);
	}
	// contacts — the list people, deduped by address across lists
	for (const f of segment.filters) conds.push(contactFilterSql(f) ?? undefined);
	const rows = await db
		.selectDistinct({ email: mailingListContacts.email, name: mailingListContacts.name, contactId: mailingListContacts.id })
		.from(mailingListContacts)
		.where(conds.length ? and(...conds) : undefined);
	return dedupeRows(rows);
}

function dedupeRows(rows: AudienceRow[]): AudienceRow[] {
	const seen = new Map<string, AudienceRow>();
	for (const r of rows) {
		const key = normEmail(r.email);
		if (!seen.has(key)) seen.set(key, { ...r, email: key });
	}
	return [...seen.values()];
}

/**
 * The sendable audience for a segment: matched AND opted-in AND not
 * suppressed. `never_asked` is counted separately so the estimate is honest.
 */
export async function segmentAudience(segment: { entity: string; filters: SegmentFilter[] }): Promise<{ sendable: AudienceRow[]; matched: number; neverAsked: number; suppressed: number }> {
	const matched = await evaluateSegment(segment);
	const consent = await consentStatesFor(matched.map((r) => r.email));
	const sendable: AudienceRow[] = [];
	let neverAsked = 0;
	let suppressed = 0;
	for (const r of matched) {
		const state = consent.get(normEmail(r.email)) ?? "never_asked";
		if (state === "opted_in") sendable.push(r);
		else if (state === "never_asked") neverAsked++;
		else suppressed++;
	}
	return { sendable, matched: matched.length, neverAsked, suppressed };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Merge context — one batch load gives every recipient their real fields:
 * case ref, stage, officer, branch, next unpaid line, arrival window.
 * ══════════════════════════════════════════════════════════════════════════ */

export type MergeContext = {
	firstName: string;
	caseRef: string;
	stage: string;
	officer: string;
	branch: string;
	nextDue: string;
	arrivalWindow: string;
	portalLink: string;
	preferencesLink: string;
};

const STAGE_LABEL: Record<string, string> = {
	document_verification: "Enrolment",
	school_submission: "Applications",
	offer_letter_review: "Applications",
	visa_processing: "Visa",
	travel_assistance: "Departure",
	payment_execution: "Departure",
	completed: "Complete",
};

export async function loadMergeContexts(emails: string[]): Promise<Map<string, MergeContext>> {
	const normed = [...new Set(emails.map(normEmail))];
	const out = new Map<string, MergeContext>();
	if (normed.length === 0) return out;

	const appRows = await db
		.selectDistinctOn([sql`lower(${applicants.email})`], {
			email: applicants.email,
			appNumber: applications.appNumber,
			stage: applications.stage,
			branch: applications.branch,
			applicantBranch: applicants.branch,
			assignedStaffId: applications.assignedStaffId,
			appId: applications.id,
			departureDetails: applications.departureDetails,
		})
		.from(applicants)
		.innerJoin(applications, eq(applications.applicantId, applicants.id))
		.where(inArray(sql`lower(${applicants.email})`, normed))
		.orderBy(sql`lower(${applicants.email})`, desc(applications.createdAt));

	const officerIds = [...new Set(appRows.map((r) => r.assignedStaffId).filter((x): x is string => Boolean(x)))];
	const officerRows = officerIds.length
		? await db.select({ id: opsUsers.id, name: opsUsers.name }).from(opsUsers).where(inArray(opsUsers.id, officerIds))
		: [];
	const officerBy = new Map(officerRows.map((r) => [r.id, r.name]));

	const appIds = appRows.map((r) => r.appId);
	const dueRows = appIds.length
		? await db
				.selectDistinctOn([invoices.applicationId], {
					applicationId: invoices.applicationId,
					label: invoiceLines.label,
					amountCents: invoiceLines.amountCents,
				})
				.from(invoiceLines)
				.innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
				.where(and(inArray(invoices.applicationId, appIds), inArray(invoices.status, ["issued", "partial"])))
				.orderBy(invoices.applicationId, invoiceLines.position)
		: [];
	const dueBy = new Map(dueRows.map((r) => [r.applicationId, r]));

	const tokenRows = await db
		.selectDistinctOn([sql`lower(${mailingListContacts.email})`], {
			email: mailingListContacts.email,
			token: mailingListContacts.confirmToken,
		})
		.from(mailingListContacts)
		.where(inArray(sql`lower(${mailingListContacts.email})`, normed));
	const tokenBy = new Map(tokenRows.map((r) => [r.email.toLowerCase(), r.token]));

	for (const r of appRows) {
		const due = dueBy.get(r.appId);
		const token = tokenBy.get(r.email.toLowerCase());
		const arrival = (r.departureDetails as Record<string, unknown> | null)?.arrivalWindow;
		out.set(r.email.toLowerCase(), {
			firstName: "",
			caseRef: r.appNumber,
			stage: STAGE_LABEL[r.stage] ?? r.stage,
			officer: (r.assignedStaffId && officerBy.get(r.assignedStaffId)) || "Your handler",
			branch: r.branch ?? r.applicantBranch,
			nextDue: due ? `${due.label} · ${formatUsd(due.amountCents / 100)}` : "—",
			arrivalWindow: typeof arrival === "string" && arrival ? arrival : "to be confirmed",
			portalLink: `${env.FRONTEND_URL}/portal`,
			preferencesLink: token
				? `${env.FRONTEND_URL}/newsletter/preferences?token=${token}`
				: `${env.FRONTEND_URL}/portal/profile`,
		});
	}
	return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Tracked links — every external <a href> in the body is swapped for
 * /m/c/:linkId/:recipientId; the redirect counts the click on the link row
 * and stamps the recipient, then 302s to the real URL. Unsubscribe and
 * preferences links are never wrapped.
 * ────────────────────────────────────────────────────────────────────────── */

export async function buildTrackedLinks(campaignId: string, recipientId: string, html: string): Promise<string> {
	const urls = new Map<string, string>();
	for (const m of html.matchAll(/href="([^"]+)"/g)) {
		const url = m[1];
		if (!/^https?:/i.test(url) || url.includes("/newsletter/unsubscribe") || url.includes("/newsletter/preferences")) continue;
		urls.set(url, url);
	}
	const linkIdByUrl = new Map<string, string>();
	for (const url of urls.keys()) {
		await db.insert(campaignLinks).values({ campaignId, url }).onConflictDoNothing({ target: [campaignLinks.campaignId, campaignLinks.url] });
		const [row] = await db.select({ id: campaignLinks.id }).from(campaignLinks)
			.where(and(eq(campaignLinks.campaignId, campaignId), eq(campaignLinks.url, url))).limit(1);
		if (row) linkIdByUrl.set(url, row.id);
	}
	return html.replace(/href="([^"]+)"/g, (match, url: string) => {
		const linkId = linkIdByUrl.get(url);
		return linkId ? `href="${env.BETTER_AUTH_URL}/api/v1/newsletter/click/${linkId}/${recipientId}"` : match;
	});
}

export async function recordLinkClick(linkId: string, recipientId: string): Promise<string | null> {
	const [link] = await db.select().from(campaignLinks).where(eq(campaignLinks.id, linkId)).limit(1);
	if (!link) return null;
	const [recipient] = await db.select().from(campaignRecipients)
		.where(and(eq(campaignRecipients.id, recipientId), eq(campaignRecipients.campaignId, link.campaignId))).limit(1);
	if (!recipient) return link.url;
	if (!recipient.clickedAt) {
		await db.update(campaignRecipients).set({ clickedAt: new Date(), clickedUrl: link.url }).where(eq(campaignRecipients.id, recipient.id));
		await db.update(campaignLinks).set({ clicks: sql`${campaignLinks.clicks} + 1` }).where(eq(campaignLinks.id, link.id));
	}
	return link.url;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Blocks — the composer stores a JSON block list; this renderer emits the
 * same table layout campaigns have always used.
 * ────────────────────────────────────────────────────────────────────────── */

export type EmailBlock =
	| { type: "heading"; text: string }
	| { type: "paragraph"; text: string }
	| { type: "button"; text: string; url: string }
	| { type: "divider" }
	| { type: "two_col"; left: string; right: string };

const BLOCK_STYLE = "margin:0 0 14px;font-size:15px;line-height:1.6;color:#2a2a28";

export function renderBlocks(blocks: EmailBlock[]): string {
	return blocks
		.map((b) => {
			switch (b.type) {
				case "heading":
					return `<h2 style="margin:0 0 12px;font-size:18px;font-weight:700;color:#141413">${escapeHtml(b.text)}</h2>`;
				case "paragraph":
					return `<p style="${BLOCK_STYLE}">${escapeHtml(b.text).replace(/\n/g, "<br>")}</p>`;
				case "button":
					return `<p style="margin:0 0 14px"><a href="${escapeHtml(b.url)}" style="display:inline-block;background:#141413;color:#fafaf8;padding:11px 20px;text-decoration:none;font-size:14px;font-weight:600">${escapeHtml(b.text)}</a></p>`;
				case "divider":
					return `<hr style="border:none;border-top:1px solid #e5e5e0;margin:18px 0">`;
				case "two_col":
					return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr><td width="50%" valign="top" style="font-size:14px;line-height:1.6;color:#2a2a28;padding-right:10px">${escapeHtml(b.left).replace(/\n/g, "<br>")}</td><td width="50%" valign="top" style="font-size:14px;line-height:1.6;color:#2a2a28;padding-left:10px">${escapeHtml(b.right).replace(/\n/g, "<br>")}</td></tr></table>`;
			}
		})
		.join("");
}

export function blocksToHtml(content: string | null | undefined, blocksJson: unknown): string {
	if (Array.isArray(blocksJson) && blocksJson.length) return renderBlocks(blocksJson as EmailBlock[]);
	return content ?? "";
}

/* ══════════════════════════════════════════════════════════════════════════
 * Automations — domain event → segment → template → delay.
 *
 * `emitAutomationEvent` is called from the domain code that owns the moment
 * (offer landed, visa approved, no-show, …). It expands the event's audience
 * — the event's own emails plus the automation's segment — filters by
 * consent, and ledgers one `automation_sends` row per (automation, trigger,
 * email) so nothing ever mails twice for the same firing.
 * `runDueAutomationSends` is the worker half: it walks due pending rows in
 * batches and delivers exactly like a campaign — same layout, merge fields,
 * tracked links, unsubscribe footer, suppression check at send time.
 * ══════════════════════════════════════════════════════════════════════════ */

export async function emitAutomationEvent(
	event: string,
	triggerKey: string,
	emails: { email: string; name?: string | null }[],
): Promise<number> {
	const autos = await db
		.select()
		.from(marketingAutomations)
		.where(and(eq(marketingAutomations.event, event), eq(marketingAutomations.status, "live")));
	if (autos.length === 0) return 0;

	let queued = 0;
	for (const auto of autos) {
		let audience = emails.map((e) => ({ email: normEmail(e.email), name: e.name ?? null }));
		if (auto.segmentId) {
			const [segment] = await db.select().from(marketingSegments).where(eq(marketingSegments.id, auto.segmentId)).limit(1);
			if (segment) {
				const segRows = await evaluateSegment({ entity: segment.entity, filters: segment.filters });
				const segEmails = new Set(segRows.map((r) => normEmail(r.email)));
				audience = audience.filter((r) => segEmails.has(r.email));
			}
		}
		const consent = await consentStatesFor(audience.map((r) => r.email));
		const scheduledFor = new Date(Date.now() + auto.delayMinutes * 60_000);
		for (const r of audience) {
			const state = consent.get(r.email) ?? "never_asked";
			const res = await db
				.insert(automationSends)
				.values({
					automationId: auto.id,
					triggerKey,
					email: r.email,
					name: r.name,
					status: state === "opted_in" ? "pending" : "skipped",
					scheduledFor,
				})
				.onConflictDoNothing()
				.returning({ id: automationSends.id });
			if (res.length) queued++;
		}
	}
	return queued;
}

export async function runDueAutomationSends(limit = 100): Promise<number> {
	const due = await db
		.select({ send: automationSends, automation: marketingAutomations })
		.from(automationSends)
		.innerJoin(marketingAutomations, eq(automationSends.automationId, marketingAutomations.id))
		.where(and(eq(automationSends.status, "pending"), lt(automationSends.scheduledFor, new Date())))
		.orderBy(automationSends.scheduledFor)
		.limit(limit);
	if (due.length === 0) return 0;

	const consent = await consentStatesFor(due.map((r) => r.send.email));
	const contexts = await loadMergeContexts(due.map((r) => r.send.email));
	let sent = 0;

	for (const { send, automation } of due) {
		if (automation.status !== "live" || consent.get(normEmail(send.email)) !== "opted_in") {
			await db.update(automationSends).set({ status: "skipped" }).where(eq(automationSends.id, send.id));
			continue;
		}
		let subject = automation.subject;
		let body = automation.body ?? "";
		let preheader: string | undefined;
		let replyTo: string | undefined;
		let fromName: string | undefined;
		if (automation.templateId) {
			const [tpl] = await db.select().from(emailTemplate).where(eq(emailTemplate.id, automation.templateId)).limit(1);
			if (tpl) {
				subject = subject ?? tpl.subject ?? tpl.name;
				body = blocksToHtml(tpl.body, tpl.blocks);
				preheader = tpl.preheader ?? undefined;
				replyTo = tpl.replyTo ?? undefined;
				fromName = tpl.fromName ?? undefined;
			}
		}
		if (!subject || !body) {
			await db.update(automationSends).set({ status: "failed", error: "Automation has no subject/body" }).where(eq(automationSends.id, send.id));
			continue;
		}

		const merged = mergeFields(subject, body, { name: send.name, email: send.email, ctx: contexts.get(normEmail(send.email)) });
		const unsub = unsubscribeUrlForEmail(send.email);
		const prefs = buildPreferencesUrl(send.email);
		const footerNote = `You're receiving this because you subscribed to Century NIT updates. <a href="${escapeHtml(unsub)}" style="color:#000000;text-decoration:underline;">Unsubscribe</a> &middot; <a href="${escapeHtml(prefs)}" style="color:#000000;text-decoration:underline;">Email preferences</a>.`;
		const html = emailLayout({ title: merged.subject, bodyHtml: merged.body, footerNote, preheader });
		try {
			const result = await sendEmail({ to: send.email, subject: merged.subject, html, replyTo, fromName, log: { template: `automation:${automation.name}` } });
			sent++;
			await db
				.update(automationSends)
				.set({ status: "sent", sentAt: new Date(), error: null, providerMessageId: result?.id ?? null })
				.where(eq(automationSends.id, send.id));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[marketing] Automation ${automation.id} send to ${send.email} failed:`, message);
			await db.update(automationSends).set({ status: "failed", error: message }).where(eq(automationSends.id, send.id));
		}
	}
	return sent;
}
