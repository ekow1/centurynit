import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { applicantDocuments, bookings, opsUsers, users } from "../db/schema.js";

/**
 * Who may read whose documents.
 *
 * The listing carried the comment "Consultants see their own caseload's" while
 * applying no caseload filter whatsoever, so every consultant could read every
 * applicant's passport scan and bank statement. Nothing in the ops UI offered a
 * way to ask for it, which is why it survived — and is exactly why the rule
 * needs a test that speaks HTTP rather than a screen that declines to offer the
 * button.
 *
 * These run against the real router and the real database. The only thing stood
 * in for is the session, because the question here is what the API does with an
 * identity, not how it establishes one.
 */

const SUFFIX = "@doc-access-test.local";

/** Who the mocked session belongs to. Reassigned per case. */
let sessionUserId = "";

/*
 * Only `getSession` is stood in for. The rest of the module — including the
 * Hono app the router mounts at /api/auth — has to stay real, or `createApp`
 * has nothing to mount.
 */
vi.mock("../routes/auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../routes/auth.js")>();
	const mockedAuthInstance = {
		...actual.authInstance,
		api: {
			...actual.authInstance.api,
			getSession: async () =>
				sessionUserId
					? {
							user: {
								id: sessionUserId,
								email: `${sessionUserId}${SUFFIX}`,
								name: sessionUserId,
							},
						}
					: null,
		},
	};
	return {
		...actual,
		authInstance: mockedAuthInstance,
		getAuthInstance: async () => mockedAuthInstance,
	};
});

const dbAvailable = await (async () => {
	try {
		await db.execute(sql`SELECT 1 FROM applicant_documents LIMIT 1`);
		return true;
	} catch {
		console.warn("\n[documents.access] Postgres not reachable — skipping.\n");
		return false;
	}
})();

const maybe = () => (dbAvailable ? it : it.skip);

const ids = {
	applicantA: "doc-access-applicant-a",
	applicantB: "doc-access-applicant-b",
	consultant: "doc-access-consultant",
	manager: "doc-access-manager",
	consultantOpsId: "",
	docA: "",
	docB: "",
};

let request: (path: string, init?: RequestInit) => Promise<Response>;

async function seedUser(id: string) {
	await db.insert(users).values({
		id,
		name: id,
		email: `${id}${SUFFIX}`,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
}

async function seedDocument(ownerUserId: string): Promise<string> {
	const [row] = await db
		.insert(applicantDocuments)
		.values({
			ownerUserId,
			documentType: "passport",
			fileName: "passport.pdf",
			contentType: "application/pdf",
			sizeBytes: 1024,
			storageKey: `${ownerUserId}/passport/test.pdf`,
			status: "UPLOADED",
			uploadedAt: new Date(),
		})
		.returning();
	return row.id;
}

async function wipe() {
	await db.execute(sql`DELETE FROM bookings WHERE client_email LIKE ${"%" + SUFFIX}`);
	await db.execute(
		sql`DELETE FROM applicant_documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${"%" + SUFFIX})`,
	);
	await db.execute(sql`DELETE FROM ops_users WHERE email LIKE ${"%" + SUFFIX}`);
	await db.execute(sql`DELETE FROM users WHERE email LIKE ${"%" + SUFFIX}`);
}

beforeAll(async () => {
	if (!dbAvailable) return;
	// Imported after the mock is registered, so the router picks up the fake session.
	const { createApp } = await import("../app.js");
	const app = createApp();
	request = (path, init) => app.request(path, init);
});

beforeEach(async () => {
	if (!dbAvailable) return;
	await wipe();

	for (const id of [ids.applicantA, ids.applicantB, ids.consultant, ids.manager]) {
		await seedUser(id);
	}

	const [consultantOps] = await db
		.insert(opsUsers)
		.values({
			email: `${ids.consultant}${SUFFIX}`,
			name: "Consultant",
			role: "consultant",
			branch: "accra-hq",
			userId: ids.consultant,
		})
		.returning();
	ids.consultantOpsId = consultantOps.id;

	await db.insert(opsUsers).values({
		email: `${ids.manager}${SUFFIX}`,
		name: "Manager",
		role: "manager",
		branch: "accra-hq",
		userId: ids.manager,
	});

	ids.docA = await seedDocument(ids.applicantA);
	ids.docB = await seedDocument(ids.applicantB);

	// Applicant A is on the consultant's caseload. Applicant B is not.
	const start = new Date(Date.now() + 86_400_000);
	await db.insert(bookings).values({
		reference: "CNS-DOCACCESS-1",
		clientUserId: ids.applicantA,
		clientName: "Applicant A",
		clientEmail: `${ids.applicantA}${SUFFIX}`,
		serviceId: "consultation",
		serviceName: "Consultation",
		branchId: "accra-hq",
		startsAt: start,
		endsAt: new Date(start.getTime() + 45 * 60_000),
		timezone: "Africa/Accra",
		durationMinutes: 45,
		status: "ASSIGNED",
		employeeId: ids.consultantOpsId,
		assignedAt: new Date(),
	});
});

afterAll(async () => {
	if (dbAvailable) await wipe();
});

async function listAs(userId: string): Promise<{ documents: { id: string }[] }> {
	sessionUserId = userId;
	const res = await request("/api/v1/documents");
	expect(res.status).toBe(200);
	return (await res.json()) as { documents: { id: string }[] };
}

describe("document listing scope", () => {
	maybe()("an applicant sees only their own", async () => {
		const body = await listAs(ids.applicantA);
		expect(body.documents.map((d) => d.id)).toEqual([ids.docA]);
	});

	maybe()("a manager sees the whole queue", async () => {
		const body = await listAs(ids.manager);
		expect(body.documents.map((d) => d.id).sort()).toEqual([ids.docA, ids.docB].sort());
	});

	maybe()("a consultant sees their caseload and not the rest", async () => {
		// The regression: this returned both documents, because no filter was applied.
		const body = await listAs(ids.consultant);
		expect(body.documents.map((d) => d.id)).toEqual([ids.docA]);
	});

	maybe()("a consultant with no assignments sees nothing, not everything", async () => {
		// The dangerous edge: an unfiltered query with an empty caseload is not
		// "no rows", it is "every row".
		await db.execute(sql`DELETE FROM bookings WHERE client_email LIKE ${"%" + SUFFIX}`);
		const body = await listAs(ids.consultant);
		expect(body.documents).toEqual([]);
	});
});

describe("named-applicant lookup", () => {
	maybe()("a consultant may name an applicant on their caseload", async () => {
		sessionUserId = ids.consultant;
		const res = await request(`/api/v1/documents?ownerUserId=${ids.applicantA}`);
		expect(res.status).toBe(200);
	});

	maybe()("a consultant may not name one who is not", async () => {
		sessionUserId = ids.consultant;
		const res = await request(`/api/v1/documents?ownerUserId=${ids.applicantB}`);
		expect(res.status).toBe(403);
	});

	maybe()("an applicant may not name another applicant", async () => {
		sessionUserId = ids.applicantA;
		const res = await request(`/api/v1/documents?ownerUserId=${ids.applicantB}`);
		expect(res.status).toBe(403);
	});
});

describe("acting on a single document", () => {
	maybe()("a consultant cannot review a document outside their caseload", async () => {
		sessionUserId = ids.consultant;
		const res = await request(`/api/v1/documents/${ids.docB}/review`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "VERIFIED" }),
		});
		// Holding the documents module is not the same as holding this applicant.
		expect(res.status).toBe(403);
	});

	maybe()("a consultant can review one inside it", async () => {
		sessionUserId = ids.consultant;
		const res = await request(`/api/v1/documents/${ids.docA}/review`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "VERIFIED" }),
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { status: string }).status).toBe("VERIFIED");
	});

	maybe()("a consultant cannot delete a document outside their caseload", async () => {
		sessionUserId = ids.consultant;
		const res = await request(`/api/v1/documents/${ids.docB}`, { method: "DELETE" });
		expect(res.status).toBe(403);
	});

	maybe()("an applicant cannot download another applicant's document", async () => {
		sessionUserId = ids.applicantA;
		const res = await request(`/api/v1/documents/${ids.docB}/download`);
		// 403 for the ownership check, never 200. Storage being unconfigured
		// (503) would also mean the check was never reached, so exclude it.
		expect(res.status).toBe(403);
	});
});
