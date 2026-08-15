import { describe, expect, it } from "vitest";
import { decrypt, decryptNullable, encrypt, encryptNullable } from "./crypto.js";

/**
 * §16 — "OAuth credentials are never exposed to the frontend." That begins with
 * not storing them in readable form: a refresh token is standing access to an
 * employee's calendar, so a database dump must not be a calendar breach.
 */

describe("token encryption", () => {
	const token = "1//0eXaMpLe-refresh-token_value.with-punctuation";

	it("round-trips", () => {
		expect(decrypt(encrypt(token))).toBe(token);
	});

	it("does not leak the plaintext into the ciphertext", () => {
		const sealed = encrypt(token);
		expect(sealed).not.toContain(token);
		expect(sealed).not.toContain("refresh-token");
	});

	it("produces a different ciphertext each time", () => {
		// A fresh IV per call: identical tokens must not be identifiable as equal.
		expect(encrypt(token)).not.toBe(encrypt(token));
	});

	it("is versioned so the scheme can be rotated", () => {
		expect(encrypt(token).startsWith("v1.")).toBe(true);
	});

	it("rejects tampering rather than returning altered bytes", () => {
		const [version, iv, tag, data] = encrypt(token).split(".");
		// Flip a byte of the ciphertext; GCM's auth tag must catch it.
		const flipped = Buffer.from(data, "base64url");
		flipped[0] ^= 0xff;
		const tampered = [version, iv, tag, flipped.toString("base64url")].join(".");
		expect(() => decrypt(tampered)).toThrow();
	});

	it("rejects a malformed or unknown-version payload", () => {
		expect(() => decrypt("not-encrypted")).toThrow();
		expect(() => decrypt("v9.a.b.c")).toThrow();
	});

	it("handles unicode and long values", () => {
		const awkward = "ключ-🔐-" + "x".repeat(4000);
		expect(decrypt(encrypt(awkward))).toBe(awkward);
	});
});

describe("nullable helpers", () => {
	it("keeps absent values absent", () => {
		expect(encryptNullable(null)).toBeNull();
		expect(encryptNullable(undefined)).toBeNull();
		expect(encryptNullable("")).toBeNull();
		expect(decryptNullable(null)).toBeNull();
	});

	it("treats undecryptable data as absent rather than throwing", () => {
		// A row sealed under a rotated key should force a reconnect, not crash
		// every availability lookup that touches that employee.
		expect(decryptNullable("v1.garbage.garbage.garbage")).toBeNull();
	});

	it("round-trips a present value", () => {
		expect(decryptNullable(encryptNullable("abc"))).toBe("abc");
	});
});
