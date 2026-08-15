import { env } from "../env.js";

/**
 * SMS delivery, behind an interface.
 *
 * Same shape as the calendar client, for the same reason: the feature has to be
 * buildable and testable before a provider is chosen, and it must not pretend to
 * have sent anything it did not. A one-time code that was never delivered but
 * reported success is worse than a clear refusal — the user sits waiting for a
 * message that is not coming.
 *
 * Add a provider by writing one more implementation; nothing else changes.
 */

export type SmsMessage = {
	/** E.164, e.g. +233241234567. */
	to: string;
	body: string;
};

export class SmsNotConfiguredError extends Error {
	constructor() {
		super("SMS is not configured on this server");
		this.name = "SmsNotConfiguredError";
	}
}

export interface SmsSender {
	/** Whether messages can actually be delivered. */
	readonly enabled: boolean;
	send(message: SmsMessage): Promise<void>;
}

/**
 * Development sender: prints the message instead of delivering it.
 *
 * Deliberately logs the code, because the alternative in local development is
 * being unable to sign in at all. Never selected when NODE_ENV=production.
 */
class ConsoleSmsSender implements SmsSender {
	readonly enabled = true;

	async send(message: SmsMessage): Promise<void> {
		console.log(`\n[sms → ${message.to}]\n  ${message.body}\n`);
	}
}

/**
 * Production default until a provider is configured.
 *
 * Refuses rather than silently dropping the message, so phone sign-in returns a
 * clear 503 and the UI can hide the option instead of offering something broken.
 */
class DisabledSmsSender implements SmsSender {
	readonly enabled = false;

	async send(): Promise<void> {
		throw new SmsNotConfiguredError();
	}
}

/*
 * Provider adapters go here. Each is a class implementing SmsSender, selected in
 * `resolveSender` on its own env vars — for example Hubtel for Ghanaian numbers
 * (local routes, GHS pricing, branded sender id) or Twilio for global coverage.
 * Neither is wired yet because no credentials have been chosen.
 */

function resolveSender(): SmsSender {
	// When a provider is added, select it here on its configured credentials.
	if (env.NODE_ENV === "production") return new DisabledSmsSender();
	return new ConsoleSmsSender();
}

let sender: SmsSender = resolveSender();

export function getSmsSender(): SmsSender {
	return sender;
}

/** Test seam. Returns a restore function. */
export function setSmsSender(next: SmsSender): () => void {
	const previous = sender;
	sender = next;
	return () => {
		sender = previous;
	};
}

export function smsConfigured(): boolean {
	return sender.enabled;
}

/** Collects messages instead of sending. Used by tests. */
export class MemorySmsSender implements SmsSender {
	readonly enabled = true;
	readonly sent: SmsMessage[] = [];

	async send(message: SmsMessage): Promise<void> {
		this.sent.push(message);
	}

	lastTo(to: string): SmsMessage | undefined {
		return [...this.sent].reverse().find((m) => m.to === to);
	}

	reset(): void {
		this.sent.length = 0;
	}
}
