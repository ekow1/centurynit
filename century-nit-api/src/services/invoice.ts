import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type {
	ApiInvoice,
	CreateInvoice,
	InvoiceStatus,
	InvoiceStoredStatus,
} from "century-nit-shared";
import { db } from "../db/index.js";
import {
	invoiceEvents,
	invoiceLines,
	invoicePayments,
	invoices,
	applications,
	applicants,
	caseComments,
	catalogPrograms,
	catalogUniversities,
	schoolApplications,
	servicePackages,
	travelAssistanceRequests,
	opsUsers,
} from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { activeFeeItem } from "./fees.js";
import { formatGhs, formatUsd } from "./receiptEmail.js";
import { invoiceRaisedForClient } from "./notifications.js";
import { queueEmails } from "../worker/queues.js";
import type { DomainEventType } from "century-nit-shared";
import { emitDomain } from "../worker/pubsub.js";

/**
 * Invoice lifecycle — commands, not CRUD (API_MIGRATION_PLAN.md §4).
 *
 * `recordPayment`, `voidInvoice` and `creditInvoice` each carry their own
 * validation and write an audit event, so the invariants live here rather than
 * in whichever client happens to call PATCH.
 *
 * All amounts are integer cents. "overdue" is computed at read time from
 * `dueAt` and the outstanding balance — never stored.
 */

export type InvoiceRow = typeof invoices.$inferSelect;

type Actor = { opsUserId?: string | null; name: string; email: string };

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** `INV-2026-0007`. Advisory-locked so concurrent creates cannot collide. */
export async function nextInvoiceNumber(tx: typeof db): Promise<string> {
	const year = new Date().getUTCFullYear();
	await tx.execute(sql`SELECT pg_advisory_xact_lock(710002, ${year})`);
	const [row] = await tx
		.select({
			max: sql<number>`coalesce(max(split_part(${invoices.invoiceNumber}, '-', 3)::int), 0)::int`,
		})
		.from(invoices)
		.where(sql`${invoices.invoiceNumber} like ${`INV-${year}-%`}`);
	return `INV-${year}-${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

/** `PRO-2026-0007`. Advisory-locked so concurrent proforma creates cannot collide. */
export async function nextProformaNumber(tx: typeof db): Promise<string> {
	const year = new Date().getUTCFullYear();
	await tx.execute(sql`SELECT pg_advisory_xact_lock(710003, ${year})`);
	const [row] = await tx
		.select({
			max: sql<number>`coalesce(max(split_part(${invoices.invoiceNumber}, '-', 3)::int), 0)::int`,
		})
		.from(invoices)
		.where(sql`${invoices.invoiceNumber} like ${`PRO-${year}-%`}`);
	return `PRO-${year}-${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

export async function paidCentsOf(invoiceId: string, tx: typeof db = db): Promise<number> {
	const [row] = await tx
		.select({ total: sql<number>`coalesce(sum(amount_cents), 0)::int` })
		.from(invoicePayments)
		.where(eq(invoicePayments.invoiceId, invoiceId));
	return row?.total ?? 0;
}

/**
 * The earliest `dueAt` among the lines the payments have not yet reached —
 * lines are covered in position order. Null when nothing dated is unpaid.
 */
export async function nextUncoveredDueAt(invoiceId: string, paidCents: number, tx: typeof db = db): Promise<Date | null> {
	const lines = await tx
		.select({ amountCents: invoiceLines.amountCents, dueAt: invoiceLines.dueAt })
		.from(invoiceLines)
		.where(eq(invoiceLines.invoiceId, invoiceId))
		.orderBy(invoiceLines.position);
	let cum = 0;
	let due: Date | null = null;
	for (const line of lines) {
		cum += line.amountCents;
		if (paidCents >= cum || !line.dueAt) continue;
		if (!due || line.dueAt.getTime() < due.getTime()) due = line.dueAt;
	}
	return due;
}

export function balanceOf(row: InvoiceRow, paidCents: number): number {
	if (row.status === "void") return 0;
	return Math.max(0, row.subtotalCents - paidCents - row.creditedCents);
}

/** Stored status from the numbers — void is sticky and set explicitly. */
function storedStatusFor(row: InvoiceRow, paidCents: number): InvoiceStoredStatus {
	if (row.status === "void") return "void";
	if (row.status === "proforma") return "proforma";
	const balance = balanceOf(row, paidCents);
	if (balance === 0) return "paid";
	if (paidCents > 0 || row.creditedCents > 0) return "partial";
	return "issued";
}

/** Effective status for responses — derives "overdue", never stores it. */
function effectiveStatus(row: InvoiceRow, paidCents: number): InvoiceStatus {
	const stored = storedStatusFor(row, paidCents);
	if (stored === "proforma") return "proforma";
	if (
		(stored === "issued" || stored === "partial") &&
		row.dueAt &&
		row.dueAt.getTime() < Date.now() &&
		balanceOf(row, paidCents) > 0
	) {
		return "overdue";
	}
	return stored;
}

async function audit(
	invoiceId: string,
	action: string,
	actor: string | null,
	detail?: string,
	tx: typeof db = db,
): Promise<void> {
	await tx.insert(invoiceEvents).values({ invoiceId, action, actor, detail: detail ?? null });
}

/* ── Serialization ───────────────────────────────────────────────────────── */

/** Staff display names can carry an internal handle ("Enoch Enu (dont_punal)") — strip it anywhere a name is shown to the applicant. */
function publicName(name: string): string;
function publicName(name: string | null | undefined): string | null;
function publicName(name: string | null | undefined): string | null {
	if (name == null) return null;
	const clean = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
	return clean || name;
}

export async function serializeInvoice(row: InvoiceRow): Promise<ApiInvoice> {
	const [lines, payments, events] = await Promise.all([
		db
			.select()
			.from(invoiceLines)
			.where(eq(invoiceLines.invoiceId, row.id))
			.orderBy(invoiceLines.position),
		db
			.select()
			.from(invoicePayments)
			.where(eq(invoicePayments.invoiceId, row.id))
			.orderBy(invoicePayments.at),
		db
			.select()
			.from(invoiceEvents)
			.where(eq(invoiceEvents.invoiceId, row.id))
			.orderBy(invoiceEvents.at),
	]);

	const paidCents = payments.reduce((n, p) => n + p.amountCents, 0);

	return {
		id: row.id,
		invoiceNumber: row.invoiceNumber,
		status: effectiveStatus(row, paidCents),
		type: row.type,
		applicantName: row.applicantName,
		applicantEmail: row.applicantEmail ?? null,
		clientUserId: row.clientUserId ?? null,
		applicationId: row.applicationId ?? null,
		lines: lines.map((l) => ({
			id: l.id,
			label: l.label,
			detail: l.detail ?? null,
			amountCents: l.amountCents,
			schoolApplicationId: l.schoolApplicationId ?? null,
			dueAt: l.dueAt?.toISOString() ?? null,
			dueOn: l.dueOn ?? null,
		})),
		subtotalCents: row.subtotalCents,
		paidCents,
		creditedCents: row.creditedCents,
		balanceCents: balanceOf(row, paidCents),
		note: row.note ?? null,
		raisedByName: publicName(row.raisedByName),
		raisedAt: row.createdAt.toISOString(),
		issuedByName: publicName(row.issuedByName),
		reviewedByName: publicName(row.reviewedByName),
		reviewedAt: row.reviewedAt?.toISOString() ?? null,
		dueAt: row.dueAt?.toISOString() ?? null,
		voidedAt: row.voidedAt?.toISOString() ?? null,
		voidReason: row.voidReason ?? null,
		payments: payments.map((p) => ({
			id: p.id,
			amountCents: p.amountCents,
			method: p.method,
			gateway: p.gateway ?? null,
			reference: p.reference ?? null,
			recordedByName: publicName(p.recordedByName),
			at: p.at.toISOString(),
		})),
		history: events.map((e) => ({
			id: e.id,
			action: e.action,
			actor: e.actor ?? null,
			detail: e.detail ?? null,
			at: e.at.toISOString(),
		})),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/* ── Queries ─────────────────────────────────────────────────────────────── */

export async function getInvoice(id: string): Promise<InvoiceRow | null> {
	const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
	return row ?? null;
}

export async function listInvoices(filter: {
	status?: InvoiceStatus;
	type?: InvoiceRow["type"];
	applicationId?: string;
	q?: string;
	limit: number;
	offset: number;
}): Promise<{ rows: InvoiceRow[]; total: number }> {
	const conditions = [];
	if (filter.type) conditions.push(eq(invoices.type, filter.type));
	if (filter.applicationId) conditions.push(eq(invoices.applicationId, filter.applicationId));
	if (filter.q) {
		const term = `%${filter.q}%`;
		conditions.push(
			or(ilike(invoices.invoiceNumber, term), ilike(invoices.applicantName, term)),
		);
	}
	// "overdue" is derived: filter stored issued/partial, then refine below.
	if (filter.status === "overdue") {
		conditions.push(
			or(eq(invoices.status, "issued"), eq(invoices.status, "partial")),
			sql`${invoices.dueAt} IS NOT NULL AND ${invoices.dueAt} < now()`,
		);
	} else if (filter.status) {
		conditions.push(eq(invoices.status, filter.status));
	}

	const where = conditions.length ? and(...conditions) : undefined;

	const [rows, [count]] = await Promise.all([
		db
			.select()
			.from(invoices)
			.where(where)
			.orderBy(desc(invoices.createdAt))
			.limit(filter.limit)
			.offset(filter.offset),
		db.select({ count: sql<number>`count(*)::int` }).from(invoices).where(where),
	]);

	return { rows, total: count?.count ?? 0 };
}

export async function listInvoicesForClient(clientUserId: string): Promise<InvoiceRow[]> {
	return db
		.select()
		.from(invoices)
		.where(eq(invoices.clientUserId, clientUserId))
		.orderBy(desc(invoices.createdAt));
}

/** Whether a payment with this gateway reference is already recorded (idempotency). */
export async function paymentWithReferenceExists(
	invoiceId: string,
	reference: string,
): Promise<boolean> {
	const [row] = await db
		.select({ id: invoicePayments.id })
		.from(invoicePayments)
		.where(
			and(eq(invoicePayments.invoiceId, invoiceId), eq(invoicePayments.reference, reference)),
		)
		.limit(1);
	return Boolean(row);
}

/* ── Commands ────────────────────────────────────────────────────────────── */

const INVOICE_TYPE_LABEL: Record<string, string> = {
	application: "application",
	visa: "visa",
	travel: "travel",
	agency: "service fee",
	consultation: "consultation",
};

/**
 * In-app (SSE-delivered) event for the client when an invoice becomes payable
 * or is settled. The portal refreshes its journey on these instead of polling
 * the invoice list; email is queued separately by the caller.
 */
async function notifyClientInvoice(row: InvoiceRow, kind: "issued" | "paid"): Promise<void> {
	if (!row.clientUserId) return;
	const label = INVOICE_TYPE_LABEL[row.type] ?? row.type;
	try {
		const { notify } = await import("./notify.js");
		await notify({
			recipientUserId: row.clientUserId,
			type: kind === "issued" ? "invoice.issued" : "invoice.paid",
			title: kind === "issued" ? "Your invoice is ready" : "Payment received",
			body:
				kind === "issued"
					? `Your ${label} invoice ${row.invoiceNumber} has been issued and is ready to pay.`
					: `Your ${label} invoice ${row.invoiceNumber} is paid. Thank you.`,
			link: "/portal/financial",
			eventId: `invoice:${kind}:${row.id}`,
		});
	} catch {
		// A missed in-app ping is caught by the portal's periodic sync.
	}
}

/**
 * Refresh signal for an invoice mutation — a domain event, not a
 * notification. Published to `ops:events` so every console's invoice list,
 * payments log and work queue refetch, and to the client's own channel so
 * the portal's finance screens sync without waiting on the poll. Bell
 * entries stay with notifyClientInvoice — this only moves screens.
 */
function emitInvoiceEvent(row: InvoiceRow, type: DomainEventType, extra?: Record<string, unknown>): void {
	emitDomain(
		type,
		{
			invoiceId: row.id,
			invoiceNumber: row.invoiceNumber,
			invoiceType: row.type,
			status: row.status,
			applicationId: row.applicationId ?? null,
			...extra,
		},
		{ ops: true, userId: row.clientUserId ?? null },
	);
}

/** Invoice types that belong to a case and drive the applicant's journey. */
export const JOURNEY_INVOICE_TYPES: ReadonlySet<string> = new Set(["application", "visa", "agency", "travel"]);

/**
 * The application a new invoice belongs to. Journey-typed invoices must be
 * linked (the database enforces it); when the caller did not say which
 * application, the client's current one is used — the same rule every
 * journey read applies. Consultation and custom invoices may stand alone.
 */
async function resolveInvoiceApplication(data: CreateInvoice, txDb: typeof db): Promise<string | null> {
	if (data.applicationId) return data.applicationId;
	if (!JOURNEY_INVOICE_TYPES.has(data.type)) return null;
	const current = data.clientUserId
		? await txDb
				.select({ id: applications.id })
				.from(applications)
				.innerJoin(applicants, eq(applications.applicantId, applicants.id))
				.where(eq(applicants.userId, data.clientUserId))
				.orderBy(desc(applications.createdAt))
				.limit(1)
				.then((r) => r[0]?.id ?? null)
		: null;
	if (!current) {
		throw new HttpError(
			409,
			"INVOICE_NEEDS_APPLICATION",
			`A ${data.type} invoice belongs to a case. Raise it from the application, or use the "custom" type for a one-off charge.`,
		);
	}
	return current;
}

export async function createInvoice(input: {
	data: CreateInvoice;
	actor: Actor;
	tx?: typeof db;
}): Promise<InvoiceRow> {
	const { data, actor } = input;
	const subtotalCents = data.lines.reduce((n, l) => n + l.amountCents, 0);
	if (subtotalCents <= 0) {
		throw new HttpError(400, "VALIDATION_ERROR", "Invoice total must be greater than zero");
	}

	const doCreate = async (txDb: typeof db) => {
		const invoiceNumber = await nextInvoiceNumber(txDb);
		const status = data.status ?? "issued";
		const applicationId = await resolveInvoiceApplication(data, txDb);
		const [created] = await txDb
			.insert(invoices)
			.values({
				invoiceNumber,
				clientUserId: data.clientUserId ?? null,
				applicationId,
				applicantName: data.applicantName,
				applicantEmail: data.applicantEmail ?? null,
				type: data.type,
				subtotalCents,
				note: data.note ?? null,
				status,
				raisedBy: actor.opsUserId ?? null,
				raisedByName: actor.name,
				issuedBy: actor.opsUserId ?? null,
				issuedByName: actor.name,
				dueAt: data.dueAt && data.dueAt.trim() ? new Date(data.dueAt) : null,
			})
			.returning();

		await txDb.insert(invoiceLines).values(
			data.lines.map((l, position) => ({
				invoiceId: created.id,
				position,
				label: l.label,
				detail: l.detail ?? null,
				amountCents: l.amountCents,
				schoolApplicationId: l.schoolApplicationId ?? null,
			})),
		);

		const auditAction = status === "proforma" ? "proforma" : "issued";
		const auditDetail = status === "proforma" ? `Estimate created by ${actor.name}` : `Issued by ${actor.name}`;
		await audit(created.id, auditAction, actor.email, auditDetail, txDb);
		return created;
	};

	const row = input.tx
		? await doCreate(input.tx)
		: await db.transaction(async (tx) => doCreate(tx as unknown as typeof db));

	if (row.status === "issued") await notifyClientInvoice(row, "issued");
	emitInvoiceEvent(row, "invoice.updated");

	// Notify the client that an invoice is outstanding.
	if (row.status === "issued" && row.applicantEmail) {
		try {
			const clientName = row.applicantName || "Valued Client";
			const payUrl = `${env.FRONTEND_URL}/portal/financial`;
			const dueAtFormatted = row.dueAt
				? row.dueAt.toLocaleDateString("en-GB", {
						day: "numeric",
						month: "long",
						year: "numeric",
					})
				: null;
			await queueEmails([
				invoiceRaisedForClient({
					entityId: row.id,
					clientName,
					clientEmail: row.applicantEmail,
					invoiceNumber: row.invoiceNumber,
					invoiceType: row.type,
					amountFormatted: formatUsd(row.subtotalCents / 100),
					amountGhsFormatted: await ghsText(row.subtotalCents),
					dueAtFormatted,
					payUrl,
				}),
			]);
		} catch {
			// Email failure must not block the invoice creation.
		}
	}

	return row;
}

export async function createConsultationInvoice(input: {
	clientUserId?: string | null;
	applicantName: string;
	applicantEmail?: string | null;
	bookingId: string;
	reference: string;
	amountCents: number;
	issuedBy?: string;
	/** A verified gateway transaction (the consultation was actually paid). */
	paid?: {
		amountCents: number;
		method: string;
		gateway: string;
		reference: string;
	};
}): Promise<InvoiceRow> {
	const [existing] = await db
		.select()
		.from(invoices)
		.where(and(eq(invoices.type, "consultation"), ilike(invoices.note, `%${input.reference}%`)))
		.limit(1);
	// If the invoice already exists (e.g. POST /bookings created it as "issued"
	// before payment) and we now have a verified gateway transaction, upgrade it
	// to "paid" — insert the payment row and flip the status. Without this, the
	// invoice stays "issued" forever even though Paystack confirmed the charge.
	if (existing) {
		if (input.paid && existing.status !== "paid") {
			await db.transaction(async (tx) => {
				const txDb = tx as unknown as typeof db;
				await tx.insert(invoicePayments).values({
					invoiceId: existing.id,
					amountCents: input.paid!.amountCents,
					method: input.paid!.method,
					gateway: input.paid!.gateway,
					reference: input.paid!.reference,
					recordedBy: null,
					recordedByName: input.issuedBy ?? "System",
				});
				await tx
					.update(invoices)
					.set({ status: "paid", updatedAt: new Date() })
					.where(eq(invoices.id, existing.id));
				await audit(existing.id, "paid", input.issuedBy ?? "System", "Consultation fee paid via verified gateway transaction", txDb);
			});
		}
		return existing;
	}

	const row = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const invoiceNumber = await nextInvoiceNumber(txDb);
		const [created] = await tx
			.insert(invoices)
			.values({
				invoiceNumber,
				clientUserId: input.clientUserId ?? null,
				applicantName: input.applicantName,
				applicantEmail: input.applicantEmail ?? null,
				type: "consultation",
				subtotalCents: input.amountCents,
				note: `Consultation Booking ${input.reference}`,
				status: input.paid ? "paid" : "issued",
				issuedBy: "system",
				issuedByName: input.issuedBy ?? "System",
			})
			.returning();

		await tx.insert(invoiceLines).values([
			{
				invoiceId: created.id,
				position: 0,
				label: "Initial Advisory Consultation",
				detail: `Comprehensive evaluation session (${input.reference})`,
				amountCents: input.amountCents,
			},
		]);

		if (input.paid) {
			await tx.insert(invoicePayments).values({
				invoiceId: created.id,
				amountCents: input.paid.amountCents,
				method: input.paid.method,
				gateway: input.paid.gateway,
				reference: input.paid.reference,
				recordedBy: null,
				recordedByName: input.issuedBy ?? "System",
			});
			await audit(created.id, "paid", input.issuedBy ?? "System", "Consultation fee paid via verified gateway transaction", txDb);
		} else {
			await audit(created.id, "issued", input.issuedBy ?? "System", "Consultation invoice issued upon booking", txDb);
		}
		return created;
	});

	return row;
}

export async function recordPayment(input: {
	invoiceId: string;
	amountCents: number;
	method: string;
	gateway?: string;
	reference?: string;
	actor: Actor;
}): Promise<InvoiceRow> {
	return db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		// Lock the row so two racing payments cannot both see the same balance.
		const [row] = await tx
			.select()
			.from(invoices)
			.where(eq(invoices.id, input.invoiceId))
			.limit(1)
			.for("update");
		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.status === "void") {
			throw new HttpError(409, "INVOICE_VOID", "Cannot record a payment against a void invoice");
		}
		if (row.status === "proforma") {
			if (row.type === "agency") {
				await tx
					.update(invoices)
					.set({ status: "issued", updatedAt: new Date() })
					.where(eq(invoices.id, row.id));
				row.status = "issued";
			} else {
				throw new HttpError(
					409,
					"INVOICE_PROFORMA",
					"Cannot pay a proforma invoice before it is reviewed and issued by staff",
				);
			}
		}

		const paidCents = await paidCentsOf(row.id, txDb);
		const balance = balanceOf(row, paidCents);
		if (input.amountCents > balance) {
			throw new HttpError(
				409,
				"OVERPAYMENT",
				`Payment exceeds the outstanding balance of ${balance} cents`,
			);
		}

		await tx.insert(invoicePayments).values({
			invoiceId: row.id,
			amountCents: input.amountCents,
			method: input.method,
			gateway: input.gateway ?? null,
			reference: input.reference ?? null,
			recordedBy: input.actor.opsUserId && input.actor.opsUserId !== "00000000-0000-0000-0000-000000000000" ? input.actor.opsUserId : null,
			recordedByName: input.actor.name,
		});

		const status = storedStatusFor(row, paidCents + input.amountCents);
		// A milestone invoice falls due with its first unpaid dated line; the
		// payment may have covered that line, so the date moves on (or clears).
		const nextDueAt = row.type === "agency" ? await nextUncoveredDueAt(row.id, paidCents + input.amountCents, txDb) : row.dueAt;
		const [updated] = await tx
			.update(invoices)
			.set({ status, dueAt: nextDueAt, updatedAt: new Date() })
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(
			row.id,
			"payment",
			input.actor.email,
			`${input.amountCents} cents via ${input.method}`,
			txDb,
		);

		// Invoices are raised against an application. A legacy unlinked invoice
		// is attributed to the client's *current* (newest) application — the
		// same rule the journey uses — and linked so it stays scoped.
		const targetAppId = updated.applicationId ?? (
			updated.clientUserId
				? await txDb
						.select({ id: applications.id })
						.from(applications)
						.innerJoin(applicants, eq(applications.applicantId, applicants.id))
						.where(eq(applicants.userId, updated.clientUserId))
						.orderBy(desc(applications.createdAt))
						.limit(1)
						.then((r) => r[0]?.id ?? null)
				: null
		);

		// The paid flags on the application (appFeePaid, depositPaid, …) are
		// not written here: a database trigger derives them from the ledger
		// on every invoice / line / payment change (drizzle/0073). What follows
		// are the workflow side effects of a payment, not its bookkeeping.
		if (targetAppId) {
			if (!updated.applicationId) {
				await txDb.update(invoices).set({ applicationId: targetAppId }).where(eq(invoices.id, updated.id));
			}
			if (updated.type === "visa" && status === "paid") {
				// Paying the visa invoice is the applicant's confirmation that they
				// want to proceed with visa processing; record the stage consent so
				// the portal stops showing the consent card after payment.
				const { upsertStageConsent } = await import("./stageConsents.js");
				await upsertStageConsent({
					applicationId: targetAppId,
					stage: "visa",
					decision: "continue",
					decidedByClientUserId: updated.clientUserId ?? undefined,
				});
				// The stage transition (locked → awaiting_handler) and the handoff
				// only fire once, from "locked". Idempotent: createOrGet dedupes.
				const [paidApp] = await txDb
					.update(applications)
					.set({ visaStage: "awaiting_handler" })
					.where(and(eq(applications.id, targetAppId), eq(applications.visaStage, "locked")))
					.returning();
				if (paidApp) {
					const { ensureVisaHandoffForApplication } = await import("./handoffs.js");
					await ensureVisaHandoffForApplication({ applicationId: targetAppId, tx: txDb });
				}
			} else if (updated.type === "travel" && status === "paid") {
				// Mark the travel assistance request as ticket_paid so the handler
				// can record the booking confirmation. Only fire from `invoiced` —
				// if the TA request has already advanced to `booked` or `cleared`,
				// a late webhook must not regress it.
				try {
					const [ta] = await txDb
						.select({ id: travelAssistanceRequests.id, status: travelAssistanceRequests.status })
						.from(travelAssistanceRequests)
						.where(eq(travelAssistanceRequests.applicationId, targetAppId))
						.orderBy(desc(travelAssistanceRequests.createdAt))
						.limit(1);
					if (ta && ta.status === "invoiced") {
						await txDb
							.update(travelAssistanceRequests)
							.set({ status: "ticket_paid", updatedAt: new Date() })
							.where(eq(travelAssistanceRequests.id, ta.id));
					}
				} catch {
					/* non-fatal — the TA request status is best-effort */
				}
			} else if (updated.type === "agency") {
				// The trigger has already recomputed depositPaid / agencyStageIndex
				// from the ledger inside this transaction; read them back.
				const [paidApp] = await txDb
					.select({ stage: applications.stage, depositPaid: applications.depositPaid, assignedStaffId: applications.assignedStaffId })
					.from(applications)
					.where(eq(applications.id, targetAppId))
					.limit(1);
				// The deposit is the single trigger for the school_submission
				// handler. It fires once — on the payment that crosses the deposit
				// line while the case is still at document_verification — so later
				// installments never re-open a resolved handoff.
				if (paidApp?.depositPaid && paidApp.stage === "document_verification") {
					const { activeHandlerFor, createOrGetHandoff } = await import("./handoffs.js");
					const handler = await activeHandlerFor(targetAppId, "school_submission", txDb);
					if (handler) {
						// A handler was seated ahead of the deposit — either the
						// whole-case owner carrying through or a stage-scoped seat.
						// Open the stage; keep the handler's coverage as placed —
						// a stage-only seat must NOT be promoted to case owner.
						await txDb
							.update(applications)
							.set({ stage: "school_submission", updatedAt: new Date() })
							.where(and(eq(applications.id, targetAppId), eq(applications.stage, "document_verification")));
						await txDb.insert(caseComments).values({
							targetType: "application",
							targetId: targetAppId,
							kind: "status",
							text: "Stage → school_submission (deposit paid; handler already assigned)",
							authorName: input.actor.name,
							authorOpsUserId: null,
						});
					} else {
						const [appRow] = await txDb
							.select({ consultationId: applications.consultationId })
							.from(applications)
							.where(eq(applications.id, targetAppId))
							.limit(1);
						let fromOpsUserId: string | null = null;
						if (appRow?.consultationId) {
							const { consultations } = await import("../db/schema.js");
							const [consultation] = await txDb
								.select({ assignedOfficerId: consultations.assignedOfficerId })
								.from(consultations)
								.where(eq(consultations.id, appRow.consultationId))
								.limit(1);
							fromOpsUserId = consultation?.assignedOfficerId ?? null;
						}
						await createOrGetHandoff({
							applicationId: targetAppId,
							stage: "school_submission",
							source: "deposit_payment",
							fromOpsUserId,
							tx: txDb,
						});
					}
				}
			}
		}

		return updated;
	}).then(async (updated) => {
		if (updated.status === "paid") await notifyClientInvoice(updated, "paid");
		// Every console's invoice list / payments log / work queue and the
		// client's own finance screen refetch on this — webhook or manual
		// entry, the settlement path all lands here.
		emitInvoiceEvent(updated, "payment.recorded", {
			amountCents: input.amountCents,
			method: input.method,
			gateway: input.gateway ?? null,
		});
		// The deposit is the moment the client enrolled — the lead follows it.
		if (updated.type === "agency") {
			const { markLeadEnrolledForInvoice } = await import("./leads.js");
			await markLeadEnrolledForInvoice(updated.id, input.actor.name);
		}
		return updated;
	});
}

export async function voidInvoice(input: {
	invoiceId: string;
	reason: string;
	actor: Actor;
}): Promise<InvoiceRow> {
	const voided = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const [row] = await tx
			.select()
			.from(invoices)
			.where(eq(invoices.id, input.invoiceId))
			.limit(1)
			.for("update");
		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.status === "void") {
			throw new HttpError(409, "INVOICE_VOID", "Invoice is already void");
		}

		const paidCents = await paidCentsOf(row.id, txDb);
		if (paidCents > 0) {
			throw new HttpError(
				409,
				"INVOICE_HAS_PAYMENTS",
				"Cannot void an invoice that already has payments. Issue a credit note instead.",
			);
		}

		const [updated] = await tx
			.update(invoices)
			.set({
				status: "void",
				voidedAt: new Date(),
				voidReason: input.reason,
				updatedAt: new Date(),
			})
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(row.id, "voided", input.actor.email, input.reason, txDb);

		if (updated.applicationId) {
			// The application's paid flags follow the ledger via trigger
			// (drizzle/0073); voiding needs no bookkeeping here.
		}

		return updated;
	});
	// A declined proforma goes back to the raiser with the reason.
	if (voided.status === "void" && voided.invoiceNumber.startsWith("PRO-")) await notifyRaiser(voided, "declined", input.reason).catch(() => {});
	emitInvoiceEvent(voided, "invoice.updated");
	return voided;
}

export async function creditInvoice(input: {
	invoiceId: string;
	amountCents: number;
	reason: string;
	actor: Actor;
}): Promise<InvoiceRow> {
	return db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const [row] = await tx
			.select()
			.from(invoices)
			.where(eq(invoices.id, input.invoiceId))
			.limit(1)
			.for("update");
		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.status === "void") {
			throw new HttpError(409, "INVOICE_VOID", "Cannot credit a void invoice");
		}

		const paidCents = await paidCentsOf(row.id, txDb);
		const balance = balanceOf(row, paidCents);
		if (input.amountCents > balance) {
			throw new HttpError(
				409,
				"OVERCREDIT",
				`Credit exceeds the outstanding balance of ${balance} cents`,
			);
		}

		const creditedCents = row.creditedCents + input.amountCents;
		const status = storedStatusFor({ ...row, creditedCents }, paidCents);
		const [updated] = await tx
			.update(invoices)
			.set({ creditedCents, status, updatedAt: new Date() })
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(
			row.id,
			"credit",
			input.actor.email,
			`${input.amountCents} cents — ${input.reason}`,
			txDb,
		);
		return updated;
	}).then((updated) => {
		emitInvoiceEvent(updated, "invoice.updated");
		return updated;
	});
}

/* ── Fee Schedule ────────────────────────────────────────────────────────── */

/** Read configurable fee amounts from platform_settings, with hardcoded defaults. */
/* ── What an application's schools cost ─────────────────────────────────── */

export type ApplicationFeeLine = { label: string; detail: string; amountCents: number; schoolApplicationId: string };

/**
 * The application invoice is money paid on the client's behalf: each
 * university's own application fee (the programme's override, else the
 * university's), at cost. Century's only charge here is the extra-school
 * add-on, one per school beyond the package's allowance. Schools are
 * counted in the order they were added, so the add-on lands on the ones
 * chosen last.
 */
export async function applicationFeeLinesFor(applicationId: string): Promise<ApplicationFeeLine[]> {
	const [app] = await db
		.select({ targetSchoolCount: applications.targetSchoolCount, packageId: applications.packageId })
		.from(applications)
		.where(eq(applications.id, applicationId))
		.limit(1);
	if (!app) return [];
	const [pkg] = app.packageId
		? await db.select({ maxSchools: servicePackages.maxSchools }).from(servicePackages).where(eq(servicePackages.id, app.packageId)).limit(1)
		: [];
	// No allowance recorded means no add-ons — the package, not the code, decides what is extra.
	const allowance = app.targetSchoolCount ?? (pkg?.maxSchools && pkg.maxSchools > 0 ? pkg.maxSchools : Number.POSITIVE_INFINITY);

	const rows = await db
		.select({
			id: schoolApplications.id,
			universityName: schoolApplications.universityName,
			programName: schoolApplications.programName,
			universityFee: catalogUniversities.applicationFeeCents,
			programFee: catalogPrograms.applicationFeeCents,
		})
		.from(schoolApplications)
		.leftJoin(catalogUniversities, eq(catalogUniversities.id, schoolApplications.universityId))
		.leftJoin(catalogPrograms, eq(catalogPrograms.id, schoolApplications.programId))
		.where(eq(schoolApplications.applicationId, applicationId))
		.orderBy(asc(schoolApplications.createdAt));

	const extra = await activeFeeItem("extra_school");
	const lines: ApplicationFeeLine[] = [];
	rows.forEach((s, i) => {
		const uni = s.universityName || "University";
		const fee = s.programFee ?? s.universityFee ?? 0;
		if (fee > 0) {
			lines.push({
				label: `${uni} — application fee`,
				detail: `${s.programName || "Programme"} · paid on your behalf, at cost`,
				amountCents: fee,
				schoolApplicationId: s.id,
			});
		}
		if (i >= allowance && extra && extra.amountCents > 0) {
			lines.push({
				label: extra.clientLabel,
				detail: `${uni} — school ${i + 1}, beyond the package's ${allowance}`,
				amountCents: extra.amountCents,
				schoolApplicationId: s.id,
			});
		}
	});
	return lines;
}

/* ── Proforma (estimate, not payable) ────────────────────────────────────── */

/**
 * Create a proforma estimate — a non-payable preview of an upcoming invoice.
 *
 * The applicant sees it as "Estimated — pending review". Staff see it in the
 * review queue and can adjust line items before issuing it as a real invoice.
 * The proforma gets a real PRO-2026-XXXX number so it can be referenced in messages.
 */
export async function createProforma(input: {
	data: CreateInvoice;
	/** Who raised it — a staff member, the client from the portal, or nothing for System. */
	raisedBy?: { opsUserId?: string | null; name: string; email?: string | null } | null;
}): Promise<InvoiceRow> {
	const { data } = input;
	const raiser = input.raisedBy ?? { opsUserId: null, name: "System", email: null };
	const subtotalCents = data.lines.reduce((n, l) => n + l.amountCents, 0);

	const row = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const invoiceNumber = await nextProformaNumber(txDb);
		const [created] = await tx
			.insert(invoices)
			.values({
				invoiceNumber,
				clientUserId: data.clientUserId ?? null,
				applicationId: data.applicationId ?? null,
				applicantName: data.applicantName,
				applicantEmail: data.applicantEmail ?? null,
				type: data.type,
				subtotalCents,
				note: data.note ?? null,
				status: "proforma",
				raisedBy: raiser.opsUserId ?? null,
				raisedByName: raiser.name,
				issuedBy: raiser.opsUserId ?? null,
				issuedByName: raiser.name,
			})
			.returning();

		await tx.insert(invoiceLines).values(
			data.lines.map((l, position) => ({
				invoiceId: created.id,
				position,
				label: l.label,
				detail: l.detail ?? null,
				amountCents: l.amountCents,
				schoolApplicationId: l.schoolApplicationId ?? null,
			})),
		);

		await audit(created.id, "proforma_created", raiser.email ?? null, `Raised (${invoiceNumber}) by ${raiser.name} — awaiting approval`, txDb);
		return created;
	});

	await notifyApproversOfProforma(row, raiser.opsUserId ?? null).catch(() => {});
	return row;
}

/** The amount in cedis at the live rate — the ledger is USD cents, the client pays in GHS. */
async function ghsText(cents: number): Promise<string> {
	const { exchangeRate } = await import("./fees.js");
	return formatGhs((cents / 100) * (await exchangeRate()));
}

/**
 * A proforma was raised: everyone who may issue it is told, in the app and
 * by email — except the raiser, who knows. The link opens the case's Money
 * tab, where Approve & issue lives.
 */
async function notifyApproversOfProforma(row: InvoiceRow, raiserOpsUserId: string | null): Promise<void> {
	const { notify, getInvoiceApproverContacts } = await import("./notify.js");
	const { emailLayout, escapeHtml } = await import("../lib/email-templates.js");
	const approvers = await getInvoiceApproverContacts();
	const label = INVOICE_TYPE_LABEL[row.type] ?? row.type;
	const amount = `${formatUsd(row.subtotalCents / 100)} · ${await ghsText(row.subtotalCents)}`;
	const link = row.applicationId ? `/applications?id=${row.applicationId}&tab=payments` : `/invoices?open=${row.id}`;
	const consoleUrl = `${env.CONSOLE_URL}${link}`;
	for (const a of approvers) {
		if (a.opsUserId === raiserOpsUserId) continue;
		await notify({
			recipientUserId: a.userId,
			type: "invoice.awaiting_approval",
			title: `Awaiting your approval · ${amount}`,
			body: `${label} invoice for ${row.applicantName} · ${row.invoiceNumber} · raised by ${row.raisedByName ?? row.issuedByName}.`,
			link,
			entityType: "invoice",
			entityId: row.id,
			eventId: `invoice:awaiting:${row.id}:${a.userId}`,
			email: {
				to: a.email,
				subject: `Awaiting your approval · ${row.invoiceNumber} · ${amount}`,
				text: `${label} invoice for ${row.applicantName} — ${row.invoiceNumber}, ${amount}, raised by ${row.raisedByName ?? row.issuedByName}. Approve and issue it: ${consoleUrl}`,
				html: emailLayout({
					title: "Awaiting your approval",
					preheader: `${row.invoiceNumber} · ${amount}`,
					bodyHtml: `<p>${escapeHtml(label)} invoice for <strong>${escapeHtml(row.applicantName)}</strong> — ${escapeHtml(row.invoiceNumber)}, <strong>${escapeHtml(amount)}</strong>, raised by ${escapeHtml(row.raisedByName ?? row.issuedByName)}.</p><p>The client cannot see or pay it until it is issued.</p><p><a href="${consoleUrl}">Approve &amp; issue →</a></p>`,
				}),
				idempotencyKey: `invoice:awaiting:${row.id}:${a.email}`,
				template: "Invoice awaiting approval",
				reference: row.invoiceNumber,
			},
		});
	}
}

/** The raiser is told what became of their proforma — issued, or declined with the reason. */
async function notifyRaiser(row: InvoiceRow, kind: "issued" | "declined", reason?: string | null): Promise<void> {
	if (!row.raisedBy) return;
	const [who] = await db.select({ userId: opsUsers.userId }).from(opsUsers).where(eq(opsUsers.id, row.raisedBy)).limit(1);
	if (!who?.userId) return;
	const { notify } = await import("./notify.js");
	const label = INVOICE_TYPE_LABEL[row.type] ?? row.type;
	await notify({
		recipientUserId: who.userId,
		type: kind === "issued" ? "invoice.issued_by_finance" : "invoice.declined",
		title: kind === "issued" ? `Issued · ${row.invoiceNumber}` : `Declined · ${row.invoiceNumber}`,
		body:
			kind === "issued"
				? `Your ${label} invoice for ${row.applicantName} went out as ${row.invoiceNumber} — ${formatUsd(row.subtotalCents / 100)} · ${await ghsText(row.subtotalCents)}. The client can pay it now.`
				: `Your ${label} invoice for ${row.applicantName} was declined${reason ? ` — “${reason}”` : ""}. Raise it again from the case.`,
		link: row.applicationId ? `/applications?id=${row.applicationId}&tab=payments` : `/invoices?open=${row.id}`,
		entityType: "invoice",
		entityId: row.id,
		eventId: `invoice:${kind}:raiser:${row.id}`,
	});
}

/* ── Application invoice lines follow the school list ───────────────────── */

/**
 * While the application invoice is still a draft, its school lines follow
 * the school list and the catalogue: the school-tagged lines are rebuilt
 * from `applicationFeeLinesFor` on every change, so a school added gets its
 * fee, a school removed loses it, and a tariff edited re-prices. Lines
 * finance typed by hand (no school id) are left alone. A draft left with
 * nothing on it is voided — there is nothing to approve. Once issued the
 * invoice is a record and is never touched here.
 *
 * Returns true when anything changed.
 */
export async function syncApplicationProformaLines(
	applicationId: string,
	opts: { /** A school about to be deleted — its lines go now, before the FK nulls the reference. */ removing?: string } = {},
): Promise<boolean> {
	const [inv] = await db
		.select()
		.from(invoices)
		.where(and(eq(invoices.applicationId, applicationId), eq(invoices.type, "application"), eq(invoices.status, "proforma")))
		.orderBy(desc(invoices.createdAt))
		.limit(1);
	if (!inv) return false;

	const current = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position));
	const manual = current.filter((l) => !l.schoolApplicationId);
	const tagged = current.filter((l) => l.schoolApplicationId);
	const wanted = (await applicationFeeLinesFor(applicationId)).filter((l) => l.schoolApplicationId !== opts.removing);

	const same =
		tagged.length === wanted.length &&
		tagged.every((l, i) => l.schoolApplicationId === wanted[i].schoolApplicationId && l.amountCents === wanted[i].amountCents && l.label === wanted[i].label);
	if (same) return false;

	if (manual.length === 0 && wanted.length === 0) {
		await db.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: "Nothing due — no application fees for the chosen schools", updatedAt: new Date() }).where(eq(invoices.id, inv.id));
		await audit(inv.id, "voided", null, "Draft voided: nothing due for the chosen schools");
		return true;
	}

	await db.transaction(async (tx) => {
		if (tagged.length > 0) await tx.delete(invoiceLines).where(inArray(invoiceLines.id, tagged.map((l) => l.id)));
		for (const [i, l] of manual.entries()) {
			if (l.position !== i) await tx.update(invoiceLines).set({ position: i }).where(eq(invoiceLines.id, l.id));
		}
		if (wanted.length > 0) {
			await tx.insert(invoiceLines).values(wanted.map((l, i) => ({ invoiceId: inv.id, position: manual.length + i, ...l })));
		}
		const subtotalCents = manual.reduce((n, l) => n + l.amountCents, 0) + wanted.reduce((n, l) => n + l.amountCents, 0);
		const schools = new Set(wanted.map((l) => l.schoolApplicationId)).size;
		await tx
			.update(invoices)
			.set({ subtotalCents, note: schools > 0 ? `University application fees for ${schools} ${schools === 1 ? "school" : "schools"}, paid on your behalf.` : inv.note, updatedAt: new Date() })
			.where(eq(invoices.id, inv.id));
		await audit(inv.id, "lines_synced", null, `Draft re-priced from the school list and the catalogue: ${wanted.length} line(s) for ${schools} school(s)`, tx as unknown as typeof db);
	});
	return true;
}

/**
 * Staff action: review a proforma and issue it as a real, payable invoice.
 *
 * The staff member can adjust line items (add document fees, discounts, etc.),
 * set a due date, and add a note. The old estimate lines are replaced entirely.
 */
export async function issueProforma(input: {
	invoiceId: string;
	lines: { label: string; detail?: string; amountCents: number; schoolApplicationId?: string | null }[];
	note?: string;
	dueAt?: string | null;
	actor: Actor;
}): Promise<InvoiceRow> {
	const issued = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const [row] = await tx
			.select()
			.from(invoices)
			.where(eq(invoices.id, input.invoiceId))
			.limit(1)
			.for("update");

		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.status !== "proforma") {
			throw new HttpError(
				409,
				"NOT_PROFORMA",
				`Only proforma invoices can be issued. This invoice is "${row.status}".`,
			);
		}

		const newSubtotal = input.lines.reduce((n, l) => n + l.amountCents, 0);
		if (newSubtotal <= 0) {
			throw new HttpError(400, "VALIDATION_ERROR", "Invoice total must be greater than zero");
		}

		// Replace estimate lines with the reviewed/adjusted lines. A reviewed
		// line that kept its label keeps its school, so the invoice still
		// knows which school each line bills after finance edits amounts.
		const previous = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, row.id));
		const schoolByLabel = new Map(previous.filter((l) => l.schoolApplicationId).map((l) => [l.label, l.schoolApplicationId!]));
		await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, row.id));
		await tx.insert(invoiceLines).values(
			input.lines.map((l, position) => ({
				invoiceId: row.id,
				position,
				label: l.label,
				detail: l.detail ?? null,
				amountCents: l.amountCents,
				schoolApplicationId: l.schoolApplicationId ?? schoolByLabel.get(l.label) ?? null,
			})),
		);

		const officialInvoiceNumber = await nextInvoiceNumber(txDb);
		const isProformaNote = (n?: string | null) => Boolean(n && n.startsWith("Proforma estimate for"));
		const issuedNote =
			input.note !== undefined
				? isProformaNote(input.note)
					? null
					: input.note
				: isProformaNote(row.note)
					? null
					: row.note;

		const [updated] = await tx
			.update(invoices)
			.set({
				invoiceNumber: officialInvoiceNumber,
				status: "issued",
				subtotalCents: newSubtotal,
				note: issuedNote,
				dueAt: input.dueAt && input.dueAt.trim() ? new Date(input.dueAt) : null,
				issuedBy: input.actor.opsUserId,
				issuedByName: input.actor.name,
				reviewedBy: input.actor.opsUserId,
				reviewedByName: input.actor.name,
				reviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(
			row.id,
			"issued",
			input.actor.email,
			`Issued as ${officialInvoiceNumber} from proforma ${row.invoiceNumber} by ${input.actor.name}. Subtotal: ${newSubtotal} cents`,
			txDb,
		);
		return updated;
	}).then(async (updated) => {
		await notifyClientInvoice(updated, "issued");
		emitInvoiceEvent(updated, "invoice.updated");
		return updated;
	});
	await notifyRaiser(issued, "issued").catch(() => {});
	return issued;
}

/**
 * Applicant action: accept a proforma estimate sent by Ops, turning it into a payable invoice.
 */
export async function acceptProformaClient(input: {
	invoiceId: string;
	userId: string;
	userName: string;
	userEmail?: string;
}): Promise<InvoiceRow> {
	return db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const [row] = await tx
			.select()
			.from(invoices)
			.where(eq(invoices.id, input.invoiceId))
			.limit(1)
			.for("update");

		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.clientUserId !== input.userId) {
			throw new HttpError(403, "FORBIDDEN", "You do not have access to this invoice");
		}
if (row.status !== "proforma") {
			throw new HttpError(
				409,
				"NOT_PROFORMA",
				"Only estimates can be accepted. This invoice is already issued.",
			);
		}

		let officialInvoiceNumber = row.invoiceNumber;
		if (row.invoiceNumber.startsWith("PRO-")) {
			officialInvoiceNumber = await nextInvoiceNumber(txDb);
		}

		const [updated] = await tx
			.update(invoices)
			.set({
				invoiceNumber: officialInvoiceNumber,
				status: "issued",
				reviewedByName: input.userName,
				reviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(row.id, "issued", input.userEmail ?? input.userName, "Estimate accepted - moving to issued invoice", txDb);
		return updated;
	});
}

/**
 * Ops action: issue a proforma application invoice, turning it into a payable
 * invoice. This is the handler's explicit "issue" step after reviewing the
 * applicant's school selection. Only the assigned handler or a manager can
 * call this. The applicant cannot pay until the invoice is issued.
 */
export async function issueProformaByOps(input: {
	invoiceId: string;
	actorName: string;
}): Promise<InvoiceRow> {
	return db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const [row] = await tx
			.select()
			.from(invoices)
			.where(eq(invoices.id, input.invoiceId))
			.limit(1)
			.for("update");

		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.type !== "application") {
			throw new HttpError(409, "NOT_APPLICATION_INVOICE", "Only application invoices can be issued via this endpoint.");
		}
		if (row.status !== "proforma") {
			throw new HttpError(409, "NOT_PROFORMA", "Only proforma invoices can be issued. This invoice is already issued.");
		}

		let officialInvoiceNumber = row.invoiceNumber;
		if (row.invoiceNumber.startsWith("PRO-")) {
			officialInvoiceNumber = await nextInvoiceNumber(txDb);
		}

		const [updated] = await tx
			.update(invoices)
			.set({
				invoiceNumber: officialInvoiceNumber,
				status: "issued",
				dueAt: row.dueAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
				issuedByName: input.actorName,
				reviewedByName: input.actorName,
				reviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(row.id, "issued", input.actorName, `Approved and issued by ${input.actorName}`, txDb);
		return updated;
	}).then(async (updated) => {
		await notifyClientInvoice(updated, "issued");
		emitInvoiceEvent(updated, "invoice.updated");
		return updated;
	});
}

/**
 * Generic proforma → issued flip for any invoice type (travel, visa, agency).
 * Mirrors `issueProformaByOps` but without the `type === "application"` guard,
 * so the travel ticket invoice can go through the same approval step.
 */
export async function issueInvoiceByOps(input: {
	invoiceId: string;
	actorName: string;
	auditNote?: string;
}): Promise<InvoiceRow> {
	return db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const [row] = await tx
			.select()
			.from(invoices)
			.where(eq(invoices.id, input.invoiceId))
			.limit(1)
			.for("update");

		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
		if (row.status !== "proforma") {
			throw new HttpError(409, "NOT_PROFORMA", "Only proforma invoices can be issued. This invoice is already issued.");
		}

		let officialInvoiceNumber = row.invoiceNumber;
		if (row.invoiceNumber.startsWith("PRO-")) {
			officialInvoiceNumber = await nextInvoiceNumber(txDb);
		}

		const [updated] = await tx
			.update(invoices)
			.set({
				invoiceNumber: officialInvoiceNumber,
				status: "issued",
				dueAt: row.dueAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
				issuedByName: input.actorName,
				reviewedByName: input.actorName,
				reviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(row.id, "issued", input.actorName, input.auditNote ?? "Invoice issued by manager", txDb);
		return updated;
	}).then(async (updated) => {
		await notifyClientInvoice(updated, "issued");
		emitInvoiceEvent(updated, "invoice.updated");
		return updated;
	});
}
