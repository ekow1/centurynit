import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { encrypt } from "../lib/crypto.js";
import { env } from "../env.js";
import { opsUsers, platformSettings, settingsAudit } from "../db/schema.js";
import {
	bookingBufferMinutes,
	clearSettingsCache,
	defaultTimezone,
	getSetting,
	writeSetting,
} from "./settings.js";
import { getDocumentStorage } from "./storage/index.js";

/**
 * Does saving a credential in the ops console actually change anything?
 *
 * It did not, for the one that matters most. Document storage decided on the
 * first call whether it was configured and held that answer for the life of the
 * process, so a deployment that started without Supabase keys stayed disabled
 * no matter what was saved afterwards — and the error it returned told the
 * administrator to go and set the keys they had just set.
 *
 * That is the shape of bug these cover: not "is the value written", which was
 * always fine, but "does anything downstream notice".
 */

const dbAvailable = await (async () => {
	try {
		await db.execute(sql`SELECT 1 FROM platform_settings LIMIT 1`);
		return true;
	} catch {
		console.warn("\n[settings.live] Postgres not reachable — skipping.\n");
		return false;
	}
})();

const maybe = () => (dbAvailable ? it : it.skip);

/** The audit row references a real staff member, so one has to exist. */
const ACTOR = { opsUserId: "", email: "settings-test@settings-test.local" };

async function wipe() {
	await db.delete(settingsAudit);
	await db.delete(platformSettings);
	clearSettingsCache();
}

beforeAll(async () => {
	if (!dbAvailable) return;
	await db.delete(settingsAudit);
	await db.execute(sql`DELETE FROM ops_users WHERE email = ${ACTOR.email}`);
	const [actor] = await db
		.insert(opsUsers)
		.values({ email: ACTOR.email, name: "Settings Test", role: "super_admin" })
		.returning();
	ACTOR.opsUserId = actor.id;
});

beforeEach(async () => {
	if (dbAvailable) await wipe();
});

afterAll(async () => {
	if (!dbAvailable) return;
	await wipe();
	await db.execute(sql`DELETE FROM ops_users WHERE email = ${ACTOR.email}`);
});

describe("a saved setting takes effect", () => {
	maybe()("is readable immediately by the process that wrote it", async () => {
		// The ops console reloads the list straight after saving; reading back the
		// previous value would look like the save had failed.
		await writeSetting("RESEND_FROM", "first@example.com", ACTOR);
		expect(await getSetting("RESEND_FROM")).toBe("first@example.com");

		await writeSetting("RESEND_FROM", "second@example.com", ACTOR);
		expect(await getSetting("RESEND_FROM")).toBe("second@example.com");
	});

	maybe()("is picked up by a process that did not write it, once the TTL passes", async () => {
		// The background worker has its own cache and never sees the write. What
		// rescues it is the TTL, so that is what this advances the clock past —
		// clearing the cache by hand would pass either way and prove nothing.
		await writeSetting("RESEND_FROM", "before@example.com", ACTOR);
		clearSettingsCache();
		expect(await getSetting("RESEND_FROM")).toBe("before@example.com");

		// Write behind this process's back, exactly as another process would.
		await db
			.update(platformSettings)
			.set({ encryptedValue: encrypt("after@example.com") })
			.where(eq(platformSettings.key, "RESEND_FROM"));

		// Still the cached value: nothing here knows anything changed.
		expect(await getSetting("RESEND_FROM")).toBe("before@example.com");

		try {
			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + 31_000);
			expect(await getSetting("RESEND_FROM")).toBe("after@example.com");
		} finally {
			vi.useRealTimers();
		}
	});

	maybe()("stops being served from memory once deleted from the table", async () => {
		await writeSetting("SUPABASE_STORAGE_BUCKET", "a-bucket", ACTOR);
		expect(await getSetting("SUPABASE_STORAGE_BUCKET")).toBe("a-bucket");

		// A merged cache would keep answering with the stale value forever.
		await db.delete(platformSettings);
		clearSettingsCache();
		expect(await getSetting("SUPABASE_STORAGE_BUCKET")).not.toBe("a-bucket");
	});
});

describe("the non-credential settings are actually read", () => {
	maybe()("booking buffer comes from the saved value", async () => {
		// These two sit in the same Settings screen as the API keys, but every
		// consumer read process.env directly — so editing them did nothing, then
		// or ever. No restart would have helped.
		expect(await bookingBufferMinutes()).toBe(env.BOOKING_BUFFER_MINUTES);

		await writeSetting("BOOKING_BUFFER_MINUTES", "15", ACTOR);
		expect(await bookingBufferMinutes()).toBe(15);
	});

	maybe()("a nonsense buffer falls back rather than becoming zero", async () => {
		// Zero is not a safe default here: it is "no protected gap at all", which
		// is the opposite of what somebody typing into this field intends.
		await writeSetting("BOOKING_BUFFER_MINUTES", "not-a-number", ACTOR);
		expect(await bookingBufferMinutes()).toBe(env.BOOKING_BUFFER_MINUTES);

		await writeSetting("BOOKING_BUFFER_MINUTES", "-30", ACTOR);
		expect(await bookingBufferMinutes()).toBe(env.BOOKING_BUFFER_MINUTES);
	});

	maybe()("default timezone comes from the saved value", async () => {
		expect(await defaultTimezone()).toBe(env.DEFAULT_TIMEZONE);

		await writeSetting("DEFAULT_TIMEZONE", "Europe/London", ACTOR);
		expect(await defaultTimezone()).toBe("Europe/London");

		// Whitespace is what a copy-paste leaves behind.
		await writeSetting("DEFAULT_TIMEZONE", "   ", ACTOR);
		expect(await defaultTimezone()).toBe(env.DEFAULT_TIMEZONE);
	});
});

describe("document storage follows the credentials", () => {
	maybe()("is disabled while no keys are configured", async () => {
		const storage = await getDocumentStorage();
		expect(storage.enabled).toBe(false);
	});

	maybe()("becomes enabled once the keys are saved, without a restart", async () => {
		// The regression: this returned the disabled storage remembered from the
		// call above, and kept returning it until the process was restarted.
		expect((await getDocumentStorage()).enabled).toBe(false);

		await writeSetting("SUPABASE_URL", "https://example.supabase.co", ACTOR);
		await writeSetting("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-for-test", ACTOR);

		expect((await getDocumentStorage()).enabled).toBe(true);
	});

	maybe()("goes back to disabled if the keys are cleared", async () => {
		await writeSetting("SUPABASE_URL", "https://example.supabase.co", ACTOR);
		await writeSetting("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-for-test", ACTOR);
		expect((await getDocumentStorage()).enabled).toBe(true);

		await writeSetting("SUPABASE_SERVICE_ROLE_KEY", null, ACTOR);
		expect((await getDocumentStorage()).enabled).toBe(false);
	});
});
