import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { leads, leadEvents, opsUsers, staffInvitations } from "../db/schema.js";
import { notifyMany, getManagerAndCoordinatorContacts } from "./notify.js";
import { queueEmails } from "../worker/queues.js";
import { leadCreatedForManager } from "./notifications.js";

export interface LeadView {
	id: string;
	name: string;
	email: string;
	phone: string | null;
	source: string;
	stage: "New Lead" | "Contacted" | "Consultation Booked" | "Assessment Complete" | "Enrolled" | "Lost";
	targetCountry: string | null;
	assignedStaffId: string | null;
	assignedStaffName?: string | null;
	consultationId: string | null;
	applicationId: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

/** In-memory flag so sync only runs once per server lifetime, not per request. */
let syncRan = false;

/**
 * Remove any leads that belong to staff members (ops_users) or accepted invitations.
 * Called once on server boot to clean up the race condition from invitation acceptance.
 */
export async function cleanupStaffLeads(): Promise<void> {
	try {
		const staffMembers = await db.query.opsUsers.findMany();
		const staffEmails = new Set(staffMembers.map((s) => s.email.toLowerCase().trim()));

		// Also include emails of accepted invitations
		const acceptedInvites = await db.query.staffInvitations.findMany();
		for (const inv of acceptedInvites) {
			if (inv.status === "ACCEPTED" || inv.status === "PENDING") {
				staffEmails.add(inv.email.toLowerCase().trim());
			}
		}

		const allLeads = await db.query.leads.findMany();
		let removed = 0;
		for (const lead of allLeads) {
			if (staffEmails.has(lead.email.toLowerCase().trim())) {
				await db.delete(leads).where(eq(leads.id, lead.id));
				removed++;
			}
		}
		if (removed > 0) {
			console.log(`[CRM] Cleaned up ${removed} staff leads`);
		}
	} catch (err) {
		console.warn("[CRM] cleanupStaffLeads error:", err);
	}
}

/**
 * Backfill any existing registered client accounts into the CRM leads pipeline.
 * Runs once per server boot, not on every listLeads() call.
 */
export async function syncLeadsFromRegisteredUsers(): Promise<void> {
	if (syncRan) return;
	syncRan = true;

	// First, clean up any staff leads from the race condition
	await cleanupStaffLeads();

	try {
		const allUsers = await db.query.users.findMany();
		const allStaff = await db.query.opsUsers.findMany();
		const staffEmails = new Set(allStaff.map((s) => s.email.toLowerCase().trim()));

		for (const u of allUsers) {
			const email = u.email.toLowerCase().trim();
			if (staffEmails.has(email)) continue;

			const existing = await db.query.leads.findFirst({
				where: eq(leads.email, email),
			});
			if (!existing) {
				const displayName =
					u.name?.trim() ||
					email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
					"Registered Client";

				await db.insert(leads).values({
					name: displayName,
					email,
					phone: u.phoneNumber || null,
					source: "Account Registration",
					stage: "New Lead",
					notes: `Registered account captured into CRM (${new Date().toLocaleDateString()}).`,
				});
				console.log(`[CRM] Auto-backfilled lead for existing client user: ${email}`);
			}
		}
	} catch (err) {
		console.warn("[CRM] syncLeadsFromRegisteredUsers error:", err);
	}
}

/**
 * Capture an inbound user registration or sign-in as a CRM lead.
 * Does NOT create leads for internal staff members.
 */
export async function captureLeadFromUser(
	user: { id?: string; email: string; name?: string | null; phoneNumber?: string | null },
	source = "Account Registration",
): Promise<void> {
	try {
		if (!user.email) return;
		const normalizedEmail = user.email.toLowerCase().trim();

		// 1. Check if this is an internal ops staff account — do not create leads for staff
		const isStaff = await db.query.opsUsers.findFirst({
			where: eq(opsUsers.email, normalizedEmail),
		});
		if (isStaff) {
			return;
		}

		// 1b. Also check for pending staff invitations — staff are invited before opsUsers row exists
		const pendingInvite = await db.query.staffInvitations.findFirst({
			where: eq(staffInvitations.email, normalizedEmail),
		});
		if (pendingInvite && pendingInvite.status === "PENDING") {
			return;
		}

		// 2. Check if a lead already exists for this email
		const existing = await db.query.leads.findFirst({
			where: eq(leads.email, normalizedEmail),
		});

		if (existing) {
			// Update phone or name if now available
			const patch: Record<string, unknown> = { updatedAt: new Date() };
			if (!existing.phone && user.phoneNumber) patch.phone = user.phoneNumber;
			if ((!existing.name || existing.name === "New Client") && user.name) patch.name = user.name;
			if (Object.keys(patch).length > 1) {
				await db.update(leads).set(patch).where(eq(leads.id, existing.id));
			}
			return;
		}

		// 3. Create a fresh New Lead in CRM
		const displayName =
			user.name?.trim() ||
			normalizedEmail.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
			"New Client";

		const [created] = await db
			.insert(leads)
			.values({
				name: displayName,
				email: normalizedEmail,
				phone: user.phoneNumber || null,
				source,
				stage: "New Lead",
				notes: `Captured automatically on ${source.toLowerCase()} (${new Date().toLocaleDateString()}).`,
			})
			.returning({ id: leads.id });

		console.log(`[CRM] Auto-captured new lead for user: ${normalizedEmail} (source: ${source})`);

		// In-app + email: surface the new lead to managers/coordinators/super_admins.
		notifyManagersOfNewLead(displayName, source, created.id).catch(() => {});
	} catch (err) {
		console.error("[CRM] Failed to capture lead from user auth:", err);
	}
}

/** Record an event in the lead audit trail. */
export async function recordLeadEvent(
	leadId: string,
	type: string,
	actorName: string | null,
	payload?: Record<string, unknown>,
): Promise<void> {
	try {
		await db.insert(leadEvents).values({
			leadId,
			type,
			actorName,
			payload: payload ?? null,
		});
	} catch (err) {
		console.warn("[CRM] Failed to record lead event:", err);
	}
}

/**
 * Surface a freshly-captured lead to every manager/coordinator/super_admin so
 * it is not left sitting unread. Fire-and-forget at the call site.
 *
 * Fans out to all four notification channels: in-app bell, SSE, Web Push
 * (via notifyMany) and email (via queueEmails) — so a manager who has the
 * console closed still sees the lead in their inbox.
 */
async function notifyManagersOfNewLead(
	name: string,
	source: string,
	leadId: string,
): Promise<void> {
	const contacts = await getManagerAndCoordinatorContacts();
	if (contacts.length === 0) return;

	// In-app + SSE + Web Push
	await notifyMany(
		contacts.map((c) => ({
			recipientUserId: c.userId,
			type: "lead.new",
			title: "New lead received",
			body: `${name} — ${source}`,
			link: "/ops/leads",
		})),
	);

	// Email — one per manager, each with its own idempotency key
	await queueEmails(
		contacts.map((c) => leadCreatedForManager({ name, source, leadId }, c.email)),
	).catch(() => {
		// email failure must not block the lead capture
	});
}

/** Get the activity timeline for a lead. */
export async function getLeadEvents(leadId: string): Promise<{
	events: Array<{
		id: string;
		leadId: string;
		type: string;
		actorName: string | null;
		payload: unknown;
		createdAt: string;
	}>;
	total: number;
}> {
	const rows = await db.query.leadEvents.findMany({
		where: eq(leadEvents.leadId, leadId),
		orderBy: [desc(leadEvents.createdAt)],
		limit: 100,
	});
	return {
		events: rows.map((r) => ({
			id: r.id,
			leadId: r.leadId,
			type: r.type,
			actorName: r.actorName,
			payload: r.payload,
			createdAt: r.createdAt.toISOString(),
		})),
		total: rows.length,
	};
}

export async function listLeads(query?: {
	stage?: string;
	search?: string;
	assignedStaffId?: string;
}): Promise<LeadView[]> {
	await syncLeadsFromRegisteredUsers();

	// Fetch all staff for name resolution
	const staffMembers = await db.query.opsUsers.findMany();
	const staffNameMap = new Map(staffMembers.map((s) => [s.id, s.name]));

	let whereClause;
	if (query?.search?.trim()) {
		const pattern = `%${query.search.trim()}%`;
		whereClause = or(
			ilike(leads.name, pattern),
			ilike(leads.email, pattern),
			ilike(leads.phone, pattern),
			ilike(leads.source, pattern),
		);
	}

	const rows = await db.query.leads.findMany({
		where: whereClause,
		orderBy: [desc(leads.createdAt)],
	});

	// Filter by assignedStaffId if scoped (for consultant)
	const filteredRows = query?.assignedStaffId
		? rows.filter((r) => r.assignedStaffId === query.assignedStaffId || r.assignedStaffId === null)
		: rows;

	return filteredRows.map((r) => ({
		id: r.id,
		name: r.name,
		email: r.email,
		phone: r.phone,
		source: r.source,
		stage: r.stage,
		targetCountry: r.targetCountry,
		assignedStaffId: r.assignedStaffId,
		assignedStaffName: r.assignedStaffId ? staffNameMap.get(r.assignedStaffId) ?? null : null,
		consultationId: r.consultationId,
		applicationId: r.applicationId,
		notes: r.notes,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
	}));
}

export async function createManualLead(input: {
	name: string;
	email: string;
	phone?: string | null;
	source?: string;
	targetCountry?: string | null;
	notes?: string | null;
}): Promise<LeadView> {
	const normalizedEmail = input.email.toLowerCase().trim();

	const [created] = await db
		.insert(leads)
		.values({
			name: input.name.trim(),
			email: normalizedEmail,
			phone: input.phone || null,
			source: input.source || "Manual Entry",
			targetCountry: input.targetCountry || null,
			notes: input.notes || null,
			stage: "New Lead",
		})
		.returning();

	// In-app + email: surface the manually-created lead to managers/coordinators.
	notifyManagersOfNewLead(created.name, created.source, created.id).catch(() => {});

	return {
		id: created.id,
		name: created.name,
		email: created.email,
		phone: created.phone,
		source: created.source,
		stage: created.stage,
		targetCountry: created.targetCountry,
		assignedStaffId: created.assignedStaffId,
		consultationId: created.consultationId,
		applicationId: created.applicationId,
		notes: created.notes,
		createdAt: created.createdAt.toISOString(),
		updatedAt: created.updatedAt.toISOString(),
	};
}

export async function updateLead(
	id: string,
	patch: Partial<{
		name: string;
		email: string;
		phone: string | null;
		stage: "New Lead" | "Contacted" | "Consultation Booked" | "Assessment Complete" | "Enrolled" | "Lost";
		targetCountry: string | null;
		assignedStaffId: string | null;
		consultationId: string | null;
		applicationId: string | null;
		notes: string | null;
	}>,
	actorName?: string | null,
): Promise<LeadView | null> {
	// Fetch current lead to detect stage changes
	const current = await db.query.leads.findFirst({ where: eq(leads.id, id) });
	if (!current) return null;

	const [updated] = await db
		.update(leads)
		.set({
			...patch,
			updatedAt: new Date(),
		})
		.where(eq(leads.id, id))
		.returning();

	if (!updated) return null;

	// Record stage change event
	if (patch.stage && patch.stage !== current.stage) {
		await recordLeadEvent(id, "stage_changed", actorName ?? null, {
			from: current.stage,
			to: patch.stage,
		});
	}

	// Record assignment event
	if (patch.assignedStaffId !== undefined && patch.assignedStaffId !== current.assignedStaffId) {
		await recordLeadEvent(id, "assigned", actorName ?? null, {
			from: current.assignedStaffId,
			to: patch.assignedStaffId,
		});
	}

	// Record entity link events
	if (patch.consultationId !== undefined && patch.consultationId !== current.consultationId) {
		await recordLeadEvent(id, "linked_consultation", actorName ?? null, {
			consultationId: patch.consultationId,
		});
	}
	if (patch.applicationId !== undefined && patch.applicationId !== current.applicationId) {
		await recordLeadEvent(id, "linked_application", actorName ?? null, {
			applicationId: patch.applicationId,
		});
	}

	return {
		id: updated.id,
		name: updated.name,
		email: updated.email,
		phone: updated.phone,
		source: updated.source,
		stage: updated.stage,
		targetCountry: updated.targetCountry,
		assignedStaffId: updated.assignedStaffId,
		consultationId: updated.consultationId,
		applicationId: updated.applicationId,
		notes: updated.notes,
		createdAt: updated.createdAt.toISOString(),
		updatedAt: updated.updatedAt.toISOString(),
	};
}

export async function deleteLead(id: string): Promise<boolean> {
	const res = await db.delete(leads).where(eq(leads.id, id)).returning({ id: leads.id });
	return res.length > 0;
}

/**
 * Find a lead by email (used for auto-linking consultations/applications).
 */
export async function findLeadByEmail(email: string): Promise<LeadView | null> {
	const normalizedEmail = email.toLowerCase().trim();
	const row = await db.query.leads.findFirst({
		where: eq(leads.email, normalizedEmail),
	});
	if (!row) return null;

	const staffMembers = await db.query.opsUsers.findMany();
	const staffNameMap = new Map(staffMembers.map((s) => [s.id, s.name]));

	return {
		id: row.id,
		name: row.name,
		email: row.email,
		phone: row.phone,
		source: row.source,
		stage: row.stage,
		targetCountry: row.targetCountry,
		assignedStaffId: row.assignedStaffId,
		assignedStaffName: row.assignedStaffId ? staffNameMap.get(row.assignedStaffId) ?? null : null,
		consultationId: row.consultationId,
		applicationId: row.applicationId,
		notes: row.notes,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * Auto-link a consultation to a lead by email and advance the lead stage.
 * Called when a consultation is created or moves to a booked/active state.
 */
export async function linkConsultationToLead(
	consultationId: string,
	email: string,
	actorName?: string | null,
): Promise<void> {
	try {
		const lead = await findLeadByEmail(email);
		if (!lead) return;

		const patch: Record<string, unknown> = { consultationId };
		// Auto-advance stage if still early in the pipeline
		if (lead.stage === "New Lead" || lead.stage === "Contacted") {
			patch.stage = "Consultation Booked";
		}

		await db.update(leads).set({ ...patch, updatedAt: new Date() }).where(eq(leads.id, lead.id));
		await recordLeadEvent(lead.id, "linked_consultation", actorName ?? null, { consultationId });
	} catch (err) {
		console.warn("[CRM] Failed to auto-link consultation to lead:", err);
	}
}

/**
 * Auto-link an application to a lead by email and advance the lead stage.
 * Called when an application is created.
 */
export async function linkApplicationToLead(
	applicationId: string,
	email: string,
	actorName?: string | null,
): Promise<void> {
	try {
		const lead = await findLeadByEmail(email);
		if (!lead) return;

		const patch: Record<string, unknown> = { applicationId };
		// Advance to Assessment Complete if consultation is done, or keep at Consultation Booked
		if (lead.stage === "Consultation Booked") {
			patch.stage = "Assessment Complete";
		}

		await db.update(leads).set({ ...patch, updatedAt: new Date() }).where(eq(leads.id, lead.id));
		await recordLeadEvent(lead.id, "linked_application", actorName ?? null, { applicationId });
	} catch (err) {
		console.warn("[CRM] Failed to auto-link application to lead:", err);
	}
}
