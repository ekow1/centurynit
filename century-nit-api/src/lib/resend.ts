import { env } from "../env.js";
import { getSetting } from "../services/settings.js";

/**
 * Email delivery via Resend.
 *
 * The API key and from address are read from the platform settings service
 * (DB-stored, encrypted, managed from the ops UI) with a fallback to the
 * `RESEND_*` env vars. The client is created lazily on each send so a key
 * changed from the UI takes effect without a restart.
 *
 * The SDK itself is imported lazily too, and that is load-bearing rather than an
 * optimisation. `resend` depends on `@react-email/render`, which pulls in
 * `react-dom/server` as an import side effect; that renderer reaches for React 18
 * internals (`ReactCurrentDispatcher`) while this workspace pins React 19, so
 * merely importing it throws. A static import here made every module that
 * transitively reaches this one unloadable — which is most of the API, since
 * `routes/auth.ts` sends password-reset and OTP mail and everything reaches
 * `routes/auth.ts` for the session. Deferring it keeps React out of the process
 * unless an email is genuinely being sent.
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
		if (env.NODE_ENV === "production") {
			console.warn("[email] RESEND_API_KEY is not set — message dropped.", { to, subject });
		} else {
			console.log(
				`\n[email → ${to}]\n  ${subject}\n${(text ?? html ?? "")
					.split("\n")
					.map((line) => `  ${line}`)
					.join("\n")}\n`,
			);
		}
		return null;
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
		console.error(`[email] Resend delivery error to ${to}:`, res.error);
		throw new Error(`Resend error: ${res.error.message}`);
	}

	console.log(`[email] Successfully sent to ${to} (id: ${res.data?.id})`);
	return res.data;
}

