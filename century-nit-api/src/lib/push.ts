import webPush from "web-push";
import { env } from "../env.js";
import { db } from "../db/index.js";
import { platformSettings } from "../db/schema.js";
import { getSetting } from "../services/settings.js";
import { encrypt } from "./crypto.js";

/**
 * Web Push (browser push notifications) via the VAPID protocol.
 *
 * VAPID keys are read from platform settings (DB-stored, encrypted, managed
 * from the ops UI) with a fallback to the `VAPID_*` env vars — the same pattern
 * as lib/resend.ts. If neither source has a pair, one is generated on first use
 * and persisted to platform_settings, so the feature is zero-config.
 *
 * The `web-push` library is configured per send rather than via the global
 * `setVapidDetails`, so a key rotated from the UI takes effect on the next call
 * without a restart and without racing other in-flight sends.
 */

/** Shape of a browser PushSubscription as stored in the DB and sent by clients. */
export type PushSubscriptionLike = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

/** Result of a send attempt. `gone` marks a subscription for deletion. */
export type SendPushResult = { ok: boolean; gone: boolean; statusCode?: number };

/**
 * VAPID subject — the contact/origin the push service associates with this
 * application server. The spec wants either an HTTPS URL or a mailto:.
 */
function vapidSubject(): string {
	const url = env.BETTER_AUTH_URL;
	if (url && /^https:\/\//i.test(url)) return url;
	return "mailto:noreply@centurynit.com";
}

/**
 * Read the VAPID key pair from settings, falling back to env.
 * Returns `null` when neither source has a complete pair.
 */
async function readVapidKeys(): Promise<{
	publicKey: string;
	privateKey: string;
} | null> {
	const publicKey = await getSetting("VAPID_PUBLIC_KEY");
	const privateKey = await getSetting("VAPID_PRIVATE_KEY");
	if (publicKey && privateKey) return { publicKey, privateKey };
	if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
		return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
	}
	return null;
}

/**
 * Persist a freshly generated VAPID key pair to platform_settings.
 *
 * Auto-generation has no human actor, so this writes directly rather than via
 * `writeSetting` (which records an audit entry attributed to a staff member).
 * `updatedBy` is left null; the audit trail starts the first time an admin
 * rotates the key from the UI.
 */
async function storeVapidKeys(publicKey: string, privateKey: string): Promise<void> {
	const now = new Date();
	/*
	 * Two upserts against the `key` PK. The public-key row is inserted first;
	 * the private-key row is inserted-or-updated separately because each row
	 * needs a different `encryptedValue`.
	 */
	await db
		.insert(platformSettings)
		.values({ key: "VAPID_PUBLIC_KEY", encryptedValue: encrypt(publicKey) })
		.onConflictDoUpdate({
			target: platformSettings.key,
			set: { encryptedValue: encrypt(publicKey), updatedAt: now },
		})
		.catch((err) => {
			console.error("[push] failed to persist VAPID public key:", err);
		});

	await db
		.insert(platformSettings)
		.values({ key: "VAPID_PRIVATE_KEY", encryptedValue: encrypt(privateKey) })
		.onConflictDoUpdate({
			target: platformSettings.key,
			set: { encryptedValue: encrypt(privateKey), updatedAt: now },
		})
		.catch((err) => {
			console.error("[push] failed to persist VAPID private key:", err);
		});
}

/**
 * Ensure a VAPID key pair exists, generating one if needed.
 *
 * Returns the pair. The public key is what browsers hand to
 * `pushManager.subscribe({ applicationServerKey })`.
 */
async function ensureVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
	const existing = await readVapidKeys();
	if (existing) return existing;

	const { publicKey, privateKey } = webPush.generateVAPIDKeys();
	console.log("[push] generated new VAPID key pair and persisting to platform_settings");
	await storeVapidKeys(publicKey, privateKey);
	return { publicKey, privateKey };
}

/**
 * The VAPID public key clients pass to `pushManager.subscribe()`.
 *
 * Generates and persists a pair on first call if none is configured, so the
 * feature works with zero setup. The value is URL-safe base64 as the
 * `web-push` library produces it; browsers expect exactly that encoding.
 */
export async function getVapidPublicKey(): Promise<string> {
	const { publicKey } = await ensureVapidKeys();
	return publicKey;
}

/**
 * Send a Web Push notification to one subscription.
 *
 * `payload` is a JSON string (the caller serialises it) — the library encrypts
 * it per the Message Encryption for Web Push standard before it leaves this
 * process.
 *
 * VAPID details are passed per-call so a key changed from the UI takes effect
 * immediately, without the global state of `setVapidDetails` racing other
 * in-flight sends.
 *
 * Returns `{ gone: true }` for 404 / 410 responses — the push service has
 * expired or revoked the subscription and the caller must delete the row.
 * Other failures return `{ ok: false }` without throwing, so the worker can
 * continue to the next subscription and decide whether the whole job retries.
 */
export async function sendPushNotification(
	subscription: PushSubscriptionLike,
	payload: string,
): Promise<SendPushResult> {
	const { publicKey, privateKey } = await ensureVapidKeys();

	try {
		await webPush.sendNotification(subscription, payload, {
			vapidDetails: {
				subject: vapidSubject(),
				publicKey,
				privateKey,
			},
			contentEncoding: "aes128gcm",
		});
		return { ok: true, gone: false };
	} catch (err) {
		if (err instanceof webPush.WebPushError) {
			const statusCode = err.statusCode;
			// 410 Gone — the subscription is no longer valid; 404 — endpoint expired.
			// Either way the row must be pruned or every future send retries it.
			if (statusCode === 410 || statusCode === 404) {
				return { ok: false, gone: true, statusCode };
			}
			console.error(
				`[push] send failed (${statusCode}) to ${subscription.endpoint}:`,
				err.message,
			);
			return { ok: false, gone: false, statusCode };
		}
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[push] send errored to ${subscription.endpoint}:`, message);
		return { ok: false, gone: false };
	}
}
