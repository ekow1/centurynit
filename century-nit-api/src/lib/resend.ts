import { Resend } from "resend";
import { env } from "../env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

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
	if (!resend) {
		/*
		 * No provider configured — print the message instead of dropping it.
		 *
		 * The body matters, not just the envelope: invitation links, one-time
		 * codes and password resets are all delivered by email, so logging only
		 * "to" and "subject" makes those flows impossible to complete locally or
		 * to verify without buying a mail provider first.
		 *
		 * Development only. In production a missing key is a misconfiguration, and
		 * printing one-time codes to the log would be a real disclosure, so that
		 * case stays quiet.
		 */
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

	return resend.emails.send({
		from: env.RESEND_FROM,
		to,
		subject,
		...(html ? { html } : {}),
		...(text ? { text } : {}),
	} as never);
}
