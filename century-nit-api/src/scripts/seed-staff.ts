import { eq } from "drizzle-orm";
import { SUPPORT_ROSTER } from "century-nit-core/ops";
import { db } from "../db/index.js";
import { opsUsers, users } from "../db/schema.js";
import { env } from "../env.js";
import { authInstance } from "../routes/auth.js";
import { ensureDefaultWorkingHours } from "../services/availability.js";

/**
 * Provision staff accounts.
 *
 * `requireStaff` derives staff identity from `ops_users.user_id` pointing at a
 * Better Auth user. Nothing populated that link, so every staff-only endpoint
 * would have rejected everyone — the Operations Center could not have called its
 * own API. This closes that gap.
 *
 * Accounts are created through Better Auth's own sign-up API rather than by
 * inserting rows, so passwords are hashed exactly the way sign-in expects. That
 * is the whole point: a hand-rolled insert produces an account that can never
 * log in.
 *
 * Idempotent — re-running links existing rows instead of duplicating them.
 *
 *   npm run seed:staff --workspace=century-nit-api
 *
 * A password may be supplied via STAFF_SEED_PASSWORD. In production a random one
 * is generated and printed once, because a known shared password across every
 * staff account is not a starting position worth having.
 */

/** Map the roster's display roles onto the ops permission vocabulary. */
const ROLE_MAP: Record<string, string> = {
	"Super Admin": "super_admin",
	Manager: "manager",
	Coordinator: "coordinator",
	Consultant: "consultant",
	Finance: "finance",
	Admin: "admin",
};

function generatePassword(): string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
	return Array.from(
		{ length: 20 },
		() => alphabet[Math.floor(Math.random() * alphabet.length)],
	).join("");
}

async function findUserByEmail(email: string) {
	const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	return row ?? null;
}

async function seed() {
	const explicit = process.env.STAFF_SEED_PASSWORD;
	if (!explicit && env.NODE_ENV === "production") {
		console.log("No STAFF_SEED_PASSWORD set — generating a unique password per account.\n");
	}

	const results: { email: string; role: string; password?: string; status: string }[] = [];

	for (const person of SUPPORT_ROSTER) {
		const role = ROLE_MAP[person.role] ?? person.role.toLowerCase();
		const password = explicit ?? generatePassword();

		let user = await findUserByEmail(person.email);
		let status = "linked existing user";

		if (!user) {
			try {
				await authInstance.api.signUpEmail({
					body: { email: person.email, password, name: person.name },
				});
				user = await findUserByEmail(person.email);
				status = "created";
			} catch (err) {
				results.push({
					email: person.email,
					role,
					status: `FAILED: ${err instanceof Error ? err.message : "sign-up error"}`,
				});
				continue;
			}
		}

		if (!user) {
			results.push({ email: person.email, role, status: "FAILED: user not found after sign-up" });
			continue;
		}

		// Upsert the ops profile and link it to the auth identity.
		const [existing] = await db
			.select()
			.from(opsUsers)
			.where(eq(opsUsers.email, person.email))
			.limit(1);

		let opsUserId: string;
		if (existing) {
			opsUserId = existing.id;
			await db
				.update(opsUsers)
				.set({ userId: user.id, name: person.name, role, branch: person.branch, active: true, updatedAt: new Date() })
				.where(eq(opsUsers.id, existing.id));
		} else {
			const [created] = await db
				.insert(opsUsers)
				.values({
					userId: user.id,
					email: person.email,
					name: person.name,
					role,
					branch: person.branch,
					active: true,
				})
				.returning();
			opsUserId = created.id;
		}

		// Without working hours an employee is never available to assign (§3).
		await ensureDefaultWorkingHours(opsUserId);

		results.push({
			email: person.email,
			role,
			status,
			password: status === "created" ? password : undefined,
		});
	}

	console.log("\nStaff accounts\n");
	for (const r of results) {
		const pw = r.password ? `  password: ${r.password}` : "";
		console.log(`  ${r.email.padEnd(34)} ${r.role.padEnd(12)} ${r.status}${pw}`);
	}
	if (results.some((r) => r.password)) {
		console.log("\nPasswords are shown once. Staff should change them on first sign-in.\n");
	}
}

seed()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Staff seeding failed:", err);
		process.exit(1);
	});
