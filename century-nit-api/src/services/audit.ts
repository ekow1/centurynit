import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { db } from "../db/index.js";
import { adminAudit, authSettings, settingsAudit } from "../db/schema.js";

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
	| "Notifications"
	| "Data"
	| "System";

export type AuditActorType = "staff" | "client" | "system";
export type AuditTargetType =
	| "staff" | "client" | "case" | "invoice" | "setting"
	| "booking" | "lead" | "conversation" | "session" | "system";
export type AuditSeverity = "info" | "warn" | "bad" | "good";

export interface AdminEventInput {
	category: AdminAuditCategory;
	action: string;
	actorId?: string | null;
	actorEmail?: string | null;
	actorType?: AuditActorType;
	target?: string | null;
	targetType?: AuditTargetType;
	severity?: AuditSeverity;
	detail?: string | null;
	ip?: string | null;
	userAgent?: string | null;
}

/**
 * Hash chain — every row seals the previous one. `hash` covers the canonical
 * content + the previous row's hash, so an UPDATE or DELETE anywhere in the
 * chain breaks every later row. Tamper-evident, not tamper-proof: it answers
 * "was the log rewritten?" honestly, which is what an auditor asks first.
 */
function sealRow(prevHash: string | null, row: {
	category: string; action: string; actorEmail: string | null;
	target: string | null; detail: string | null; ip: string | null;
}): string {
	return createHash("sha256")
		.update(`${prevHash ?? "GENESIS"}|${row.category}|${row.action}|${row.actorEmail ?? ""}|${row.target ?? ""}|${row.detail ?? ""}|${row.ip ?? ""}`)
		.digest("hex");
}

export async function recordAdminEvent(ev: AdminEventInput): Promise<void> {
	try {
		const [prev] = await db
			.select({ hash: adminAudit.hash })
			.from(adminAudit)
			.orderBy(desc(adminAudit.at))
			.limit(1);
		const prevHash = prev?.hash ?? null;
		const hash = sealRow(prevHash, {
			category: ev.category,
			action: ev.action,
			actorEmail: ev.actorEmail ?? null,
			target: ev.target ?? null,
			detail: ev.detail ?? null,
			ip: ev.ip ?? null,
		});
		await db.insert(adminAudit).values({
			category: ev.category,
			action: ev.action,
			actorId: ev.actorId ?? null,
			actorEmail: ev.actorEmail ?? null,
			actorType: ev.actorType ?? "staff",
			target: ev.target ?? null,
			targetType: ev.targetType ?? "system",
			severity: ev.severity ?? "info",
			detail: ev.detail ?? null,
			ip: ev.ip ?? null,
			userAgent: ev.userAgent ?? null,
			prevHash,
			hash,
		});
		// Alert rules ride the same write — they evaluate the row just written.
		void evaluateAuditAlerts(ev).catch(() => {});
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
	/** Per-category counts over the full filtered set (minus the category filter itself) — feeds the filter chips. */
	facets: Record<string, number>;
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

	// The same category rules as settingsCategory(), expressed in SQL so the
	// category filter, counts, and facet counts are all computed in the
	// database rather than by loading every row.
	const settingsCatSql = sql<string>`CASE
		WHEN ${settingsAudit.key} LIKE 'role:%' THEN 'Roles & Access'
		WHEN ${settingsAudit.key} ~* 'PAYSTACK|PAYMENT|FEE|PRICE|CURRENCY|RATE' THEN 'Financials'
		WHEN ${settingsAudit.key} ~* 'AUTH|MFA|SESSION|GOOGLE_(CLIENT|AUTH)|OAUTH|TOTP' THEN 'Authentication'
		ELSE 'Configuration'
	END`;

	const baseSettingsConds = [
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

	// Rows/counts honour the category filter; facets deliberately don't (the
	// chips need counts for every category to switch between).
	const settingsConds = [
		...baseSettingsConds,
		query.category && query.category !== "all"
			? sql`${settingsCatSql} = ${query.category}`
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

	// Each side over-fetches so the merged page boundary is correct.
	const [settingsRows, settingsCount, adminRows, adminCount, settingsFacets, adminFacets] = await Promise.all([
		db
			.select()
			.from(settingsAudit)
			.where(and(...settingsConds))
			.orderBy(desc(settingsAudit.at))
			.limit(limit + offset),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(settingsAudit)
			.where(and(...settingsConds)),
		db
			.select()
			.from(adminAudit)
			.where(and(...adminConds))
			.orderBy(desc(adminAudit.at))
			.limit(limit + offset),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(adminAudit)
			.where(and(...adminConds)),
		// Facets ignore the category filter — the chips need counts to switch on.
		db
			.select({ cat: settingsCatSql, n: sql<number>`count(*)::int` })
			.from(settingsAudit)
			.where(and(...baseSettingsConds))
			.groupBy(settingsCatSql),
		db
			.select({ cat: adminAudit.category, n: sql<number>`count(*)::int` })
			.from(adminAudit)
			.where(and(...adminConds.slice(1)))
			.groupBy(adminAudit.category),
	]);

	const facets: Record<string, number> = {};
	for (const r of [...settingsFacets, ...adminFacets]) {
		facets[r.cat] = (facets[r.cat] ?? 0) + r.n;
	}

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

	return {
		entries: merged.slice(offset, offset + limit),
		total: (settingsCount[0]?.n ?? 0) + (adminCount[0]?.n ?? 0),
		facets,
	};
}



/* ══════════════════════════════════════════════════════════════════════════
 * audit_events — the unified stream (view from migration 0112)
 * ══════════════════════════════════════════════════════════════════════════ */

export interface AuditEvent {
	id: string;
	source: string;
	at: string;
	category: string;
	action: string;
	actorLabel: string;
	actorId: string | null;
	actorType: string;
	targetLabel: string | null;
	targetId: string | null;
	targetType: string;
	severity: string;
	detail: string | null;
	ip: string | null;
	userAgent: string | null;
	oldMasked: string | null;
	newMasked: string | null;
}

export interface AuditEventsQuery {
	category?: string;
	severity?: string;
	source?: string;
	actor?: string;
	target?: string;
	q?: string;
	from?: string;
	to?: string;
	limit?: number;
	/** Keyset cursor "at|id" — OFFSET drifts under a live feed. */
	before?: string;
}

interface AuditEventRow {
	id: string; source: string; at: Date; category: string; action: string;
	actor_label: string; actor_id: string | null; actor_type: string;
	target_label: string | null; target_id: string | null; target_type: string;
	severity: string; detail: string | null; ip: string | null;
	user_agent: string | null; old_masked: string | null; new_masked: string | null;
}

function eventConds(q: AuditEventsQuery, forFacets = false): ReturnType<typeof sql>[] {
	const conds: ReturnType<typeof sql>[] = [sql`1=1`];
	if (!forFacets && q.category && q.category !== "all") conds.push(sql`category = ${q.category}`);
	if (q.severity && q.severity !== "all") conds.push(sql`severity = ${q.severity}`);
	if (q.source && q.source !== "all") conds.push(sql`source = ${q.source}`);
	if (q.actor) conds.push(sql`actor_label ILIKE ${"%" + q.actor + "%"}`);
	if (q.target) conds.push(sql`target_label ILIKE ${"%" + q.target + "%"}`);
	if (q.from) conds.push(sql`at >= ${new Date(q.from)}`);
	if (q.to) conds.push(sql`at <= ${new Date(q.to + "T23:59:59.999Z")}`);
	if (q.q) {
		const p = "%" + q.q + "%";
		conds.push(sql`(action ILIKE ${p} OR actor_label ILIKE ${p} OR target_label ILIKE ${p} OR ip ILIKE ${p})`);
	}
	if (q.before) {
		const [ts, id] = q.before.split("|");
		if (ts && id) conds.push(sql`(at, id) < (${new Date(ts)}::timestamptz, ${id}::uuid)`);
	}
	return conds;
}

export interface AuditEventsPage {
	entries: AuditEvent[];
	total: number;
	nextBefore: string | null;
	facets: Record<string, number>;
}

export async function queryAuditEvents(q: AuditEventsQuery): Promise<AuditEventsPage> {
	const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
	const where = sql.join(eventConds(q), sql` AND `);
	const facetWhere = sql.join(eventConds({ ...q, category: "all" }, true), sql` AND `);

	const [rowsRes, totalRes, facetRes] = await Promise.all([
		db.execute(sql`
			SELECT id, source, at, category, action, actor_label, actor_id, actor_type,
				target_label, target_id, target_type, severity, detail, ip, user_agent,
				old_masked, new_masked
			FROM audit_events WHERE ${where}
			ORDER BY at DESC, id DESC LIMIT ${limit + 1}
		`),
		db.execute(sql`SELECT count(*)::int AS n FROM audit_events WHERE ${where}`),
		db.execute(sql`SELECT category, count(*)::int AS n FROM audit_events WHERE ${facetWhere} GROUP BY category`),
	]);

	const rows = (rowsRes.rows ?? rowsRes) as unknown as AuditEventRow[];
	const totalRows = (totalRes.rows ?? totalRes) as unknown as { n: number }[];
	const facetRows = (facetRes.rows ?? facetRes) as unknown as { category: string; n: number }[];

	const hasMore = rows.length > limit;
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];

	return {
		entries: page.map((r) => ({
			id: r.id,
			source: r.source,
			at: new Date(r.at).toISOString(),
			category: r.category,
			action: r.action,
			actorLabel: r.actor_label,
			actorId: r.actor_id,
			actorType: r.actor_type,
			targetLabel: r.target_label,
			targetId: r.target_id,
			targetType: r.target_type,
			severity: r.severity,
			detail: r.detail,
			ip: r.ip,
			userAgent: r.user_agent,
			oldMasked: r.old_masked,
			newMasked: r.new_masked,
		})),
		total: totalRows[0]?.n ?? 0,
		nextBefore: hasMore && last ? `${new Date(last.at).toISOString()}|${last.id}` : null,
		facets: Object.fromEntries(facetRows.map((f) => [f.category, f.n])),
	};
}

/** CSV of the whole filtered query — not the loaded page. */
export async function exportAuditEventsCsv(q: AuditEventsQuery): Promise<string> {
	const where = sql.join(eventConds(q), sql` AND `);
	const res = await db.execute(sql`
		SELECT at, category, severity, actor_label, actor_type, action, target_label,
			target_type, source, ip, detail
		FROM audit_events WHERE ${where}
		ORDER BY at DESC LIMIT 10000
	`);
	const rows = (res.rows ?? res) as unknown as Record<string, unknown>[];
	const esc = (v: unknown) => {
		const s = v == null ? "" : String(v);
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const head = "at,category,severity,actor,actor_type,action,target,target_type,source,ip,detail";
	const lines = rows.map((r) =>
		[r.at, r.category, r.severity, r.actor_label, r.actor_type, r.action,
			r.target_label, r.target_type, r.source, r.ip, r.detail].map(esc).join(","),
	);
	return [head, ...lines].join("\n");
}

/** Related events for the detail pane — same actor OR same target, recent. */
export async function relatedAuditEvents(actorLabel: string, targetLabel: string | null, excludeId: string, limit = 6): Promise<AuditEvent[]> {
	const conds = targetLabel
		? sql`(actor_label = ${actorLabel} OR target_label = ${targetLabel})`
		: sql`actor_label = ${actorLabel}`;
	const res = await db.execute(sql`
		SELECT id, source, at, category, action, actor_label, actor_id, actor_type,
			target_label, target_id, target_type, severity, detail, ip, user_agent,
			old_masked, new_masked
		FROM audit_events
		WHERE ${conds} AND id <> ${excludeId}::uuid
		ORDER BY at DESC LIMIT ${limit}
	`);
	const rows = (res.rows ?? res) as unknown as AuditEventRow[];
	return rows.map((r) => ({
		id: r.id, source: r.source, at: new Date(r.at).toISOString(), category: r.category,
		action: r.action, actorLabel: r.actor_label, actorId: r.actor_id, actorType: r.actor_type,
		targetLabel: r.target_label, targetId: r.target_id, targetType: r.target_type,
		severity: r.severity, detail: r.detail, ip: r.ip, userAgent: r.user_agent,
		oldMasked: r.old_masked, newMasked: r.new_masked,
	}));
}

/** Chain-check a slice — verifies hash continuity over the newest N rows. */
export async function verifyAuditChain(limit = 200): Promise<{ checked: number; brokenAt: string | null }> {
	const rows = await db
		.select({
			id: adminAudit.id, category: adminAudit.category, action: adminAudit.action,
			actorEmail: adminAudit.actorEmail, target: adminAudit.target,
			detail: adminAudit.detail, ip: adminAudit.ip,
			prevHash: adminAudit.prevHash, hash: adminAudit.hash,
		})
		.from(adminAudit)
		.orderBy(desc(adminAudit.at))
		.limit(limit);
	// Rows arrive newest-first; the chain reads oldest→newest.
	const chain = [...rows].reverse().filter((r) => r.hash != null);
	let expectedPrev: string | null = chain[0]?.prevHash ?? null;
	for (const r of chain) {
		if (r.prevHash !== expectedPrev) return { checked: chain.length, brokenAt: r.id };
		const recomputed = sealRow(r.prevHash, {
			category: r.category, action: r.action, actorEmail: r.actorEmail,
			target: r.target, detail: r.detail, ip: r.ip,
		});
		if (recomputed !== r.hash) return { checked: chain.length, brokenAt: r.id };
		expectedPrev = r.hash;
	}
	return { checked: chain.length, brokenAt: null };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Auth policy — real settings the middleware enforces (auth_settings key)
 * ══════════════════════════════════════════════════════════════════════════ */

export interface AuthPolicy {
	sessionDays: number;
	idleHours: number;
	lockoutThreshold: number;
	lockoutWindowMin: number;
	lockoutMinutes: number;
	passwordMinLength: number;
	breachedCheck: boolean;
	staffRotationDays: number;
	mfaGraceDays: number;
	rememberDeviceDays: number;
}

export const DEFAULT_AUTH_POLICY: AuthPolicy = {
	sessionDays: 14,
	idleHours: 8,
	lockoutThreshold: 5,
	lockoutWindowMin: 10,
	lockoutMinutes: 15,
	passwordMinLength: 12,
	breachedCheck: true,
	staffRotationDays: 180,
	mfaGraceDays: 7,
	rememberDeviceDays: 30,
};

export async function getAuthPolicy(): Promise<AuthPolicy> {
	const [row] = await db
		.select({ value: authSettings.value })
		.from(authSettings)
		.where(eq(authSettings.key, "authPolicy"))
		.limit(1);
	const v = (row?.value ?? {}) as Partial<AuthPolicy>;
	return { ...DEFAULT_AUTH_POLICY, ...v };
}

export async function updateAuthPolicy(patch: Partial<AuthPolicy>, updatedBy: string): Promise<AuthPolicy> {
	const next = { ...(await getAuthPolicy()), ...patch };
	await db
		.insert(authSettings)
		.values({ key: "authPolicy", value: next, updatedBy })
		.onConflictDoUpdate({ target: authSettings.key, set: { value: next, updatedBy, updatedAt: new Date() } });
	return next;
}

/**
 * Lockout check, run inside the sign-in before-hook. The lock is derived
 * state — a lock row younger than lockoutMinutes with no later unlock row.
 * "Unlock" is just an audited event, not a flag on the user.
 */
export async function signInLockRemaining(email: string): Promise<number> {
	const policy = await getAuthPolicy();
	const since = new Date(Date.now() - policy.lockoutMinutes * 60_000);
	const [lock] = await db
		.select({ at: adminAudit.at })
		.from(adminAudit)
		.where(and(
			eq(adminAudit.action, "Account locked — repeated failed sign-ins"),
			sql`${adminAudit.target} = ${email}`,
			gte(adminAudit.at, since),
		))
		.orderBy(desc(adminAudit.at))
		.limit(1);
	if (!lock) return 0;
	const [unlock] = await db
		.select({ at: adminAudit.at })
		.from(adminAudit)
		.where(and(
			ilike(adminAudit.action, "Account unlocked%"),
			sql`${adminAudit.target} = ${email}`,
			gte(adminAudit.at, lock.at),
		))
		.limit(1);
	if (unlock) return 0;
	return Math.max(0, policy.lockoutMinutes * 60_000 - (Date.now() - lock.at.getTime()));
}

/**
 * Record a failed sign-in and lock the account when the threshold trips.
 * Called from better-auth's onAPIError hook — failures never mint sessions.
 */
export async function recordFailedSignIn(email: string, ip: string | null, userAgent: string | null): Promise<void> {
	const policy = await getAuthPolicy();
	await recordAdminEvent({
		category: "Authentication",
		action: "Sign-in failed",
		actorEmail: email,
		actorType: "client",
		target: email,
		targetType: "client",
		severity: "warn",
		ip,
		userAgent,
	});
	const windowStart = new Date(Date.now() - policy.lockoutWindowMin * 60_000);
	const [count] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(adminAudit)
		.where(and(
			eq(adminAudit.action, "Sign-in failed"),
			sql`${adminAudit.target} = ${email}`,
			gte(adminAudit.at, windowStart),
		));
	if ((count?.n ?? 0) >= policy.lockoutThreshold) {
		const remaining = await signInLockRemaining(email);
		if (remaining === 0) {
			await recordAdminEvent({
				category: "Authentication",
				action: "Account locked — repeated failed sign-ins",
				actorEmail: "system",
				actorType: "system",
				target: email,
				targetType: "client",
				severity: "bad",
				detail: `${count!.n} failures in ${policy.lockoutWindowMin} min — locked for ${policy.lockoutMinutes} min`,
				ip,
				userAgent,
			});
		}
	}
}

/* ══════════════════════════════════════════════════════════════════════════
 * Alert rules — evaluated inside recordAdminEvent on every write
 * ══════════════════════════════════════════════════════════════════════════ */

export interface AlertRules {
	failedSignins: boolean;
	roleGrants: boolean;
	newIpSignin: boolean;
	moneyMoves: boolean;
}

const DEFAULT_ALERT_RULES: AlertRules = {
	failedSignins: true,
	roleGrants: true,
	newIpSignin: true,
	moneyMoves: true,
};

export async function getAlertRules(): Promise<AlertRules> {
	const [row] = await db
		.select({ value: authSettings.value })
		.from(authSettings)
		.where(eq(authSettings.key, "alertRules"))
		.limit(1);
	return { ...DEFAULT_ALERT_RULES, ...((row?.value ?? {}) as Partial<AlertRules>) };
}

export async function setAlertRules(patch: Partial<AlertRules>, updatedBy: string): Promise<AlertRules> {
	const next = { ...(await getAlertRules()), ...patch };
	await db
		.insert(authSettings)
		.values({ key: "alertRules", value: next, updatedBy })
		.onConflictDoUpdate({ target: authSettings.key, set: { value: next, updatedBy, updatedAt: new Date() } });
	return next;
}

/**
 * The four default rules from the desk mock. Each rule fires a notification —
 * the dedupe is natural (one notification per triggering event).
 */
async function evaluateAuditAlerts(ev: AdminEventInput): Promise<void> {
	const rules = await getAlertRules();
	const { notifyMany, getManagerAndCoordinatorUserIds, getStaffUserIdByEmail } = await import("./notify.js");
	const managerIds = async () => (await getManagerAndCoordinatorUserIds()).map((r) => r.userId);

	// 1 · Lockout just landed → page the desk.
	if (rules.failedSignins && ev.action === "Account locked — repeated failed sign-ins") {
		const ids = await managerIds();
		if (ids.length) {
			await notifyMany(ids.map((id) => ({
				recipientUserId: id,
				type: "audit.alert",
				title: "Account locked",
				body: `${ev.target} locked after repeated failed sign-ins.`,
				link: "/administration?tab=audit",
			})));
		}
	}

	// 2 · Role grant to a privileged role → every manager hears of it.
	if (rules.roleGrants && ev.category === "Roles & Access" && /manager|admin/i.test(ev.action)) {
		const ids = await managerIds();
		if (ids.length) {
			await notifyMany(ids.map((id) => ({
				recipientUserId: id,
				type: "audit.alert",
				title: "Privileged role granted",
				body: ev.action,
				link: "/administration?tab=audit",
			})));
		}
	}

	// 3 · Staff sign-in from an IP they've never used → flag it.
	if (rules.newIpSignin && ev.action === "Signed in to the ops console" && ev.ip && ev.actorEmail) {
		const [seen] = await db
			.select({ id: adminAudit.id })
			.from(adminAudit)
			.where(and(
				eq(adminAudit.action, "Signed in to the ops console"),
				sql`${adminAudit.actorEmail} = ${ev.actorEmail}`,
				sql`${adminAudit.ip} = ${ev.ip}`,
			))
			.limit(1);
		if (!seen) {
			const uid = await getStaffUserIdByEmail(ev.actorEmail);
			const ids = [...(await managerIds()), ...(uid ? [uid] : [])];
			await notifyMany([...new Set(ids)].map((id) => ({
				recipientUserId: id,
				type: "audit.alert",
				title: "Sign-in from a new IP",
				body: `${ev.actorEmail} signed in from ${ev.ip} — first time this address.`,
				link: "/administration?tab=auth",
			})));
		}
	}

	// 4 · Money moves — refunds, voids, manual payments → managers.
	if (rules.moneyMoves && ev.category === "Financials" && /refund|void|manual/i.test(ev.action)) {
		const ids = await managerIds();
		if (ids.length) {
			await notifyMany(ids.map((id) => ({
				recipientUserId: id,
				type: "audit.alert",
				title: "Money event",
				body: ev.action,
				link: "/administration?tab=audit",
			})));
		}
	}
}
