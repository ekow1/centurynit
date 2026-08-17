import { env } from "../env.js";
import { getSetting } from "../services/settings.js";
import { HttpError } from "../middleware/error.js";

/**
 * Email delivery via Resend.
 *
 * The API key and from address are read from the platform settings service
 * (DB-stored, encrypted, managed from the ops UI) with a fallback to the
 * `RESEND_*` env vars. The client is created lazily on each send so a key
 * changed from the UI takes effect without a restart.
 */

export async function sendEmail({
	to,
	subject,
	html,
	text,
}: {
	to: string;
	subject: string;
	html?: string;
	text?: string;
}) {
	const apiKey = await getSetting("RESEND_API_KEY");
	const from = (await getSetting("RESEND_FROM")) ?? env.RESEND_FROM;

	if (!apiKey) {
		console.warn("[email] RESEND_API_KEY is not configured.", { to, subject });
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
	} as never);

	if (res.error) {
		console.error(`[email] Resend delivery error to ${to} (from ${from}):`, res.error);
		throw new HttpError(
			400,
			"EMAIL_DELIVERY_FAILED",
			`Resend delivery error: ${res.error.message}`,
		);
	}

	console.log(`[email] Successfully sent to ${to} (id: ${res.data?.id})`);
	return res.data;
}

