import { env } from "../env.js";
import { getSetting } from "../services/settings.js";
import { HttpError } from "../middleware/error.js";
import { db } from "../db/index.js";
import { notificationLog } from "../db/schema.js";

/**
 * Email delivery via Resend.
 *
 * The API key and from address are read from the platform settings service
 * (DB-stored, encrypted, managed from the ops UI) with a fallback to the
 * `RESEND_*` env vars. The client is created lazily on each send so a key
 * changed from the UI takes effect without a restart.
 */

export type EmailLogMeta = {
	/** Human-readable template name for the audit log (e.g. "Booking created"). */
	template?: string;
	/** Business reference (booking ref, invoice number) for cross-linking. */
	reference?: string;
	/** The queue's idempotency key — retries upsert the same audit row. */
	idempotencyKey?: string;
	/** Which attempt this send was — from the BullMQ job when queued. */
	attempts?: number;
};

/**
 * Record the outcome of a send in `notification_log` — one row per logical
 * email. With an idempotency key the row is upserted, so a retry that fails
 * then succeeds ends as a single "sent · attempts 2" entry, not two rows.
 * Without a key (OTP codes, test mail) every send is its own row.
 */
async function logDelivery(e: {
	to: string;
	subject: string;
	status: "sent" | "failed";
	errorMessage?: string;
} & EmailLogMeta): Promise<void> {
	try {
		const values = {
			recipient: e.to,
			subject: e.subject,
			template: e.template ?? null,
			status: e.status,
			reference: e.reference ?? null,
			idempotencyKey: e.idempotencyKey ?? null,
			errorMessage: e.errorMessage ?? null,
			attempts: e.attempts ?? 1,
			sentAt: new Date(),
		};
		if (e.idempotencyKey) {
			await db
				.insert(notificationLog)
				.values(values)
				.onConflictDoUpdate({
					target: notificationLog.idempotencyKey,
					set: {
						status: values.status,
						errorMessage: values.errorMessage,
						attempts: values.attempts,
						sentAt: values.sentAt,
						template: values.template,
						reference: values.reference,
						recipient: values.recipient,
						subject: values.subject,
					},
				});
		} else {
			await db.insert(notificationLog).values(values);
		}
	} catch {
		/* the audit log must never break a send or a retry */
	}
}

export async function sendEmail({
	to,
	subject,
	html,
	text,
	attachments,
	log,
	fromName,
	replyTo,
}: {
	to: string;
	subject: string;
	html?: string;
	text?: string;
	attachments?: Array<{ filename: string; content?: Buffer | string; path?: string }>;
	/** Audit metadata — every send lands in notification_log, queued or not. */
	log?: EmailLogMeta;
	/** Display name over the configured sender ("Century NIT · Accra <mail@…>"). */
	fromName?: string;
	/** Where replies go — the branch mailbox for campaigns. */
	replyTo?: string;
}) {
	const apiKey = await getSetting("RESEND_API_KEY");
	const fromAddress = (await getSetting("RESEND_FROM")) ?? env.RESEND_FROM;
	const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

	if (!apiKey) {
		// Outside production every flow must stay completable without a
		// provider account: print the message instead of sending it, so an
		// invitation link or one-time code can be copied from the terminal.
		if (env.NODE_ENV !== "production") {
			console.info(`[email] (not sent — RESEND_API_KEY unset) to=${to} subject=${JSON.stringify(subject)}\n${text ?? ""}`);
			return { id: `console-${Date.now()}` };
		}
		console.warn("[email] RESEND_API_KEY is not configured.", { to, subject });
		await logDelivery({ to, subject, status: "failed", errorMessage: "RESEND_API_KEY is not configured", ...log });
		throw new HttpError(
			400,
			"EMAIL_NOT_CONFIGURED",
			"Resend API key is not configured. Please set it under Platform Settings.",
		);
	}

	const { Resend } = await import("resend");
	const resend = new Resend(apiKey);
	const res = await resend.emails.send({
		from,
		to,
		subject,
		...(html ? { html } : {}),
		...(text ? { text } : {}),
		...(replyTo ? { replyTo } : {}),
		...(attachments ? { attachments } : {}),
	} as never);

	if (res.error) {
		console.error(`[email] Resend delivery error to ${to} (from ${from}):`, res.error);
		await logDelivery({ to, subject, status: "failed", errorMessage: res.error.message, ...log });
		throw new HttpError(
			400,
			"EMAIL_DELIVERY_FAILED",
			`Resend delivery error: ${res.error.message}`,
		);
	}

	await logDelivery({ to, subject, status: "sent", ...log });
	console.log(`[email] Successfully sent to ${to} (id: ${res.data?.id})`);
	return res.data;
}
