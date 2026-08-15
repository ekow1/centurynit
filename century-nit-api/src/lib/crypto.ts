import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "../env.js";

/**
 * Authenticated encryption for OAuth tokens at rest.
 *
 * §16 requires that OAuth credentials are never exposed to the frontend. That
 * starts with not storing them in plaintext: a refresh token grants ongoing
 * access to an employee's calendar, so a leaked database dump is a leak of
 * every connected calendar. AES-256-GCM gives confidentiality *and*
 * tamper-detection — a modified ciphertext fails to decrypt rather than
 * silently yielding altered bytes.
 *
 * Format: `v1.<iv>.<authTag>.<ciphertext>`, all base64url. The version prefix
 * exists so the scheme can be rotated later without guessing at old rows.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const VERSION = "v1";

/**
 * 32-byte key derived from ENCRYPTION_KEY.
 *
 * SHA-256 of the configured secret, so any sufficiently strong passphrase works
 * and the caller does not have to supply exactly 32 raw bytes.
 */
function key(): Buffer {
	return createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

export function encrypt(plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return [
		VERSION,
		iv.toString("base64url"),
		authTag.toString("base64url"),
		ciphertext.toString("base64url"),
	].join(".");
}

export function decrypt(payload: string): string {
	const parts = payload.split(".");
	if (parts.length !== 4 || parts[0] !== VERSION) {
		throw new Error("Malformed or unsupported ciphertext");
	}
	const [, ivB64, tagB64, dataB64] = parts;
	const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64url"));
	decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(dataB64, "base64url")),
		decipher.final(),
	]).toString("utf8");
}

/** Encrypt when present; keep null as null so optional tokens stay optional. */
export function encryptNullable(value: string | null | undefined): string | null {
	return value ? encrypt(value) : null;
}

/**
 * Decrypt, treating undecryptable data as absent rather than throwing.
 *
 * A row encrypted under a rotated or lost key should force a reconnect, not
 * crash every availability lookup that touches that employee.
 */
export function decryptNullable(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		return decrypt(value);
	} catch {
		return null;
	}
}
