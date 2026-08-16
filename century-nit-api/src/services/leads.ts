import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { leads, opsUsers } from "../db/schema.js";

export interface LeadView {
	id: string;
	name: string;
	email: string;
	phone: string | null;
	source: string;
	stage: "New Lead" | "Contacted" | "Consultation Booked" | "Assessment Complete" | "Enrolled" | "Lost";
	targetCountry: string | null;
	assignedStaffId: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

/**
 * Backfill any existing registered client accounts into the CRM leads pipeline.
 */
export async function syncLeadsFromRegisteredUsers(): Promise<void> {
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

		await db.insert(leads).values({
			name: displayName,
			email: normalizedEmail,
			phone: user.phoneNumber || null,
			source,
			stage: "New Lead",
			notes: `Captured automatically on ${source.toLowerCase()} (${new Date().toLocaleDateString()}).`,
		});

		console.log(`[CRM] Auto-captured new lead for user: ${normalizedEmail} (source: ${source})`);
	} catch (err) {
		console.error("[CRM] Failed to capture lead from user auth:", err);
	}
}

export async function listLeads(query?: { stage?: string; search?: string }): Promise<LeadView[]> {
	await syncLeadsFromRegisteredUsers();

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

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		email: r.email,
		phone: r.phone,
		source: r.source,
		stage: r.stage,
		targetCountry: r.targetCountry,
		assignedStaffId: r.assignedStaffId,
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

	return {
		id: created.id,
		name: created.name,
		email: created.email,
		phone: created.phone,
		source: created.source,
		stage: created.stage,
		targetCountry: created.targetCountry,
		assignedStaffId: created.assignedStaffId,
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
		notes: string | null;
	}>,
): Promise<LeadView | null> {
	const [updated] = await db
		.update(leads)
		.set({
			...patch,
			updatedAt: new Date(),
		})
		.where(eq(leads.id, id))
		.returning();

	if (!updated) return null;

	return {
		id: updated.id,
		name: updated.name,
		email: updated.email,
		phone: updated.phone,
		source: updated.source,
		stage: updated.stage,
		targetCountry: updated.targetCountry,
		assignedStaffId: updated.assignedStaffId,
		notes: updated.notes,
		createdAt: updated.createdAt.toISOString(),
		updatedAt: updated.updatedAt.toISOString(),
	};
}

export async function deleteLead(id: string): Promise<boolean> {
	const res = await db.delete(leads).where(eq(leads.id, id)).returning({ id: leads.id });
	return res.length > 0;
}
