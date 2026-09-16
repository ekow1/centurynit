import { and, desc, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index.js";
import { adminAudit, settingsAudit } from "../db/schema.js";

/** Client IP behind Cloudflare/Traefik — cf-connecting-ip wins, xff falls back. */
export function requestIp(c: Context): string | null {
	return (
		c.req.header("cf-connecting-ip") ??
		c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
		null
	);
}

/**
 * The unified admin audit trail.
 *
 * Two sources are unioned into one list:
 *   - `settings_audit` — every platform-setting write (already recorded with
 *     masked values by services/settings.ts).
 *   - `admin_audit`   — everything else: invites, access control, role grants,
 *     sign-ins. Call sites write a human `action` string; nothing is derived
 *     at render time, so the page can never show an event that didn't happen.
 */

export type AdminAuditCategory =
	| "Configuration"
	| "Authentication"
	| "Roles & Access"
	| "Financials"
	| "Staff"
	| "Clients"
	| "System";

export interface AdminEventInput {
	category: AdminAuditCategory;
	action: string;
	actorId?: string | null;
	actorEmail?: string | null;
	target?: string | null;
	detail?: string | null;
	ip?: string | null;
	userAgent?: string | null;
}

export async function recordAdminEvent(ev: AdminEventInput): Promise<void> {
	try {
		await db.insert(adminAudit).values({
			category: ev.category,
			action: ev.action,
			actorId: ev.actorId ?? null,
			actorEmail: ev.actorEmail ?? null,
			target: ev.target ?? null,
			detail: ev.detail ?? null,
			ip: ev.ip ?? null,
			userAgent: ev.userAgent ?? null,
		});
	} catch (err) {
		// Audit must never break the action it records — log and move on.
		console.error("[audit] failed to record admin event:", err);
	}
}

export interface AuditQuery {
	category?: string;
	q?: string;
	from?: string;
	to?: string;
	limit?: number;
	offset?: number;
}

export interface UnifiedAuditEntry {
	id: string;
	source: "settings" | "admin";
	category: string;
	action: string;
	actorEmail: string | null;
	target: string | null;
	detail: string | null;
	oldValueMasked: string | null;
	newValueMasked: string | null;
	ip: string | null;
	at: string;
}

export interface UnifiedAuditPage {
	entries: UnifiedAuditEntry[];
	total: number;
}

/**
 * Settings keys grouped into the categories the page filters on. This is a
 * lookup, not a guess — the key itself determines the category deterministically.
 */
function settingsCategory(key: string): string {
	if (key.startsWith("role:")) return "Roles & Access";
	if (/PAYSTACK|PAYMENT|FEE|PRICE|CURRENCY|RATE/i.test(key)) return "Financials";
	if (/AUTH|MFA|SESSION|GOOGLE_(CLIENT|AUTH)|OAUTH|TOTP/i.test(key)) return "Authentication";
	return "Configuration";
}

export async function getUnifiedAuditLog(query: AuditQuery): Promise<UnifiedAuditPage> {
	const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
	const offset = Math.max(query.offset ?? 0, 0);
	const from = query.from ? new Date(query.from) : null;
	const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : null;
	const q = query.q?.trim();

	const settingsConds = [
		from ? gte(settingsAudit.at, from) : undefined,
		to ? lte(settingsAudit.at, to) : undefined,
		q
			? or(
					ilike(settingsAudit.key, `%${q}%`),
					ilike(settingsAudit.actorEmail, `%${q}%`),
					ilike(settingsAudit.action, `%${q}%`),
					ilike(settingsAudit.actorIp, `%${q}%`),
				)
			: undefined,
	].filter(Boolean);

	const adminConds = [
		query.category && query.category !== "all" ? sql`${adminAudit.category} = ${query.category}` : undefined,
		from ? gte(adminAudit.at, from) : undefined,
		to ? lte(adminAudit.at, to) : undefined,
		q
			? or(
					ilike(adminAudit.action, `%${q}%`),
					ilike(adminAudit.actorEmail, `%${q}%`),
					ilike(adminAudit.target, `%${q}%`),
					ilike(adminAudit.ip, `%${q}%`),
				)
			: undefined,
	].filter(Boolean);

	// Both sources can produce any category (settings rows derive theirs from
	// the key), so a category filter is applied post-merge, not per-source.
	const wantSettings = true;
	const wantAdmin = true;

	// Each side over-fetches so the merged page boundary is correct.
	const [settingsRows, settingsCount, adminRows, adminCount] = await Promise.all([
		wantSettings
			? db
					.select()
					.from(settingsAudit)
					.where(and(...settingsConds))
					.orderBy(desc(settingsAudit.at))
					.limit(limit + offset)
			: Promise.resolve([]),
		wantSettings
			? db
					.select({ n: sql<number>`count(*)::int` })
					.from(settingsAudit)
					.where(and(...settingsConds))
			: Promise.resolve([{ n: 0 }]),
		wantAdmin
			? db
					.select()
					.from(adminAudit)
					.where(and(...adminConds))
					.orderBy(desc(adminAudit.at))
					.limit(limit + offset)
			: Promise.resolve([]),
		wantAdmin
			? db
					.select({ n: sql<number>`count(*)::int` })
					.from(adminAudit)
					.where(and(...adminConds))
			: Promise.resolve([{ n: 0 }]),
	]);

	const settingsEntries: UnifiedAuditEntry[] = settingsRows.map((r) => ({
		id: r.id,
		source: "settings",
		category: settingsCategory(r.key),
		action: r.action ?? `Updated ${r.key}`,
		actorEmail: r.actorEmail,
		target: r.key,
		detail: null,
		oldValueMasked: r.oldValueMasked,
		newValueMasked: r.newValueMasked,
		ip: r.actorIp,
		at: r.at.toISOString(),
	}));

	const adminEntries: UnifiedAuditEntry[] = adminRows.map((r) => ({
		id: r.id,
		source: "admin",
		category: r.category,
		action: r.action,
		actorEmail: r.actorEmail,
		target: r.target,
		detail: r.detail,
		oldValueMasked: null,
		newValueMasked: null,
		ip: r.ip,
		at: r.at.toISOString(),
	}));

	// Category filter applies to the derived settings category too.
	const categoryOk = (e: UnifiedAuditEntry) =>
		!query.category || query.category === "all" || e.category === query.category;

	const merged = [...settingsEntries, ...adminEntries]
		.filter(categoryOk)
		.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

	// `total` is exact only without a category filter — a filtered count would
	// need a second pass; the page shows the loaded count plus "load more".
	return {
		entries: merged.slice(offset, offset + limit),
		total: (settingsCount[0]?.n ?? 0) + (adminCount[0]?.n ?? 0),
	};
}
