import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type {
	ApiInvoice,
	CreateInvoice,
	InvoiceStatus,
	InvoiceStoredStatus,
} from "century-nit-shared";
import { DEFAULT_FEE_CENTS } from "century-nit-shared";
import { db } from "../db/index.js";
import {
	invoiceEvents,
	invoiceLines,
	invoicePayments,
	invoices,
	applications,
} from "../db/schema.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { getSetting } from "./settings.js";
import { formatGhs, formatUsd } from "./receiptEmail.js";
import { invoiceRaisedForClient } from "./notifications.js";
import { queueEmails } from "../worker/queues.js";

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

type Actor = { opsUserId: string; name: string; email: string };

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** `INV-2026-0007`. Advisory-locked so concurrent creates cannot collide. */
async function nextInvoiceNumber(tx: typeof db): Promise<string> {
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
		})),
		subtotalCents: row.subtotalCents,
		paidCents,
		creditedCents: row.creditedCents,
		balanceCents: balanceOf(row, paidCents),
		note: row.note ?? null,
		issuedByName: row.issuedByName,
		reviewedByName: row.reviewedByName ?? null,
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
			recordedByName: p.recordedByName,
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
	q?: string;
	limit: number;
	offset: number;
}): Promise<{ rows: InvoiceRow[]; total: number }> {
	const conditions = [];
	if (filter.type) conditions.push(eq(invoices.type, filter.type));
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

export async function createInvoice(input: {
	data: CreateInvoice;
	actor: Actor;
}): Promise<InvoiceRow> {
	const { data, actor } = input;
	const subtotalCents = data.lines.reduce((n, l) => n + l.amountCents, 0);
	if (subtotalCents <= 0) {
		throw new HttpError(400, "VALIDATION_ERROR", "Invoice total must be greater than zero");
	}

	const row = await db.transaction(async (tx) => {
		const txDb = tx as unknown as typeof db;
		const invoiceNumber = await nextInvoiceNumber(txDb);
		const status = data.status ?? "issued";
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
				status,
				issuedBy: actor.opsUserId,
				issuedByName: actor.name,
				dueAt: data.dueAt ? new Date(data.dueAt) : null,
			})
			.returning();

		await tx.insert(invoiceLines).values(
			data.lines.map((l, position) => ({
				invoiceId: created.id,
				position,
				label: l.label,
				detail: l.detail ?? null,
				amountCents: l.amountCents,
			})),
		);

		const auditAction = status === "proforma" ? "proforma" : "issued";
		const auditDetail = status === "proforma" ? `Estimate created by ${actor.name}` : `Issued by ${actor.name}`;
		await audit(created.id, auditAction, actor.email, auditDetail, txDb);
		return created;
	});

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
					clientName,
					clientEmail: row.applicantEmail,
					invoiceNumber: row.invoiceNumber,
					invoiceType: row.type,
					amountFormatted: formatUsd(row.subtotalCents / 100),
					amountGhsFormatted: formatGhs(row.subtotalCents / 100),
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
}): Promise<InvoiceRow> {
	const [existing] = await db
		.select()
		.from(invoices)
		.where(and(eq(invoices.type, "consultation"), ilike(invoices.note, `%${input.reference}%`)))
		.limit(1);
	if (existing) return existing;

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
				status: "paid",
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

		await tx.insert(invoicePayments).values({
			invoiceId: created.id,
			amountCents: input.amountCents,
			method: "Card Payment",
			gateway: "Paystack",
			reference: `PAY-${input.reference}`,
			recordedBy: "system",
			recordedByName: input.issuedBy ?? "System",
		});

		await audit(created.id, "paid", input.issuedBy ?? "System", "Consultation fee paid upon booking", txDb);
		return created;
	});

	return row;
}

/**
 * Applicant self-service: record a payment against one of their own invoices.
 *
 * The staff-gated `recordPayment` above is the only writer for staff; this is
 * the mirror for a logged-in applicant, restricted to invoices that carry their
 * `clientUserId`. The actor is derived from the session, never from the body.
 */
export async function recordClientPayment(input: {
	invoiceId: string;
	userId: string;
	userName: string;
	userEmail: string;
	amountCents: number;
	method: string;
	gateway?: string;
	reference?: string;
}): Promise<InvoiceRow> {
	const row = await getInvoice(input.invoiceId);
	if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
	if (row.clientUserId !== input.userId) {
		throw new HttpError(403, "FORBIDDEN", "Not allowed to pay this invoice");
	}
	return recordPayment({
		invoiceId: input.invoiceId,
		amountCents: input.amountCents,
		method: input.method,
		gateway: input.gateway,
		reference: input.reference,
		actor: {
			opsUserId: input.userId,
			name: input.userName || "Applicant",
			email: input.userEmail,
		},
	});
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
			throw new HttpError(
				409,
				"INVOICE_PROFORMA",
				"Cannot pay a proforma invoice before it is reviewed and issued by staff",
			);
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
			recordedBy: input.actor.opsUserId,
			recordedByName: input.actor.name,
		});

		const status = storedStatusFor(row, paidCents + input.amountCents);
		const [updated] = await tx
			.update(invoices)
			.set({ status, updatedAt: new Date() })
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(
			row.id,
			"payment",
			input.actor.email,
			`${input.amountCents} cents via ${input.method}`,
			txDb,
		);

		if (updated.applicationId) {
			if (updated.type === "application" && status === "paid") {
				await txDb.update(applications).set({ appFeePaid: true }).where(eq(applications.id, updated.applicationId));
			} else if (updated.type === "visa" && status === "paid") {
				await txDb.update(applications).set({ visaInvoicePaid: true }).where(eq(applications.id, updated.applicationId));
			} else if (updated.type === "travel" && status === "paid") {
				await txDb.update(applications).set({ travelInvoicePaid: true }).where(eq(applications.id, updated.applicationId));
			} else if (updated.type === "agency") {
				const lines = await txDb.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, row.id)).orderBy(invoiceLines.position);
				let totalPaid = paidCents + input.amountCents;
				let agencyStageIndex = 0;
				for (const line of lines) {
					if (totalPaid >= line.amountCents) {
						agencyStageIndex++;
						totalPaid -= line.amountCents;
					} else {
						break;
					}
				}
				await txDb.update(applications).set({ 
					agencyStageIndex, 
					agencySettled: agencyStageIndex >= lines.length 
				}).where(eq(applications.id, updated.applicationId));
			}
		}

		return updated;
	});
}

export async function voidInvoice(input: {
	invoiceId: string;
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
			if (updated.type === "application") {
				await txDb.update(applications).set({ appFeePaid: false }).where(eq(applications.id, updated.applicationId));
			} else if (updated.type === "visa") {
				await txDb.update(applications).set({ visaInvoicePaid: false }).where(eq(applications.id, updated.applicationId));
			} else if (updated.type === "travel") {
				await txDb.update(applications).set({ travelInvoicePaid: false }).where(eq(applications.id, updated.applicationId));
			} else if (updated.type === "agency") {
				await txDb.update(applications).set({ agencySettled: false, agencyStageIndex: 0 }).where(eq(applications.id, updated.applicationId));
			}
		}

		return updated;
	});
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
	});
}

/* ── Fee Schedule ────────────────────────────────────────────────────────── */

/** Read configurable fee amounts from platform_settings, with hardcoded defaults. */
export async function getFeeSchedule(): Promise<{
	appBaseCents: number;
	appPerSchoolCents: number;
	appDocVerifyCents: number;
	appMatchReviewCents: number;
	visaBaseCents: number;
	visaBiometricsCents: number;
	visaTranslationCents: number;
	consultationCents: number;
}> {
	const parse = async (key: Parameters<typeof getSetting>[0], fallback: number) => {
		const v = await getSetting(key);
		const n = v ? Number.parseInt(v, 10) : NaN;
		return Number.isFinite(n) && n >= 0 ? n : fallback;
	};
	return {
		appBaseCents: await parse("APP_BASE_FEE_CENTS", DEFAULT_FEE_CENTS.appBase),
		appPerSchoolCents: await parse("APP_PER_SCHOOL_FEE_CENTS", DEFAULT_FEE_CENTS.appPerSchool),
		appDocVerifyCents: await parse("APP_DOC_VERIFY_FEE_CENTS", DEFAULT_FEE_CENTS.appDocVerify),
		appMatchReviewCents: await parse("APP_MATCH_REVIEW_FEE_CENTS", DEFAULT_FEE_CENTS.appMatchReview),
		visaBaseCents: await parse("VISA_BASE_FEE_CENTS", DEFAULT_FEE_CENTS.visaBase),
		visaBiometricsCents: await parse("VISA_BIOMETRICS_FEE_CENTS", DEFAULT_FEE_CENTS.visaBiometrics),
		visaTranslationCents: await parse("VISA_TRANSLATION_FEE_CENTS", DEFAULT_FEE_CENTS.visaTranslation),
		consultationCents: await parse("CONSULTATION_FEE_CENTS", DEFAULT_FEE_CENTS.consultation),
	};
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
}): Promise<InvoiceRow> {
	const { data } = input;
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
				issuedBy: null,
				issuedByName: "System Estimate",
			})
			.returning();

		await tx.insert(invoiceLines).values(
			data.lines.map((l, position) => ({
				invoiceId: created.id,
				position,
				label: l.label,
				detail: l.detail ?? null,
				amountCents: l.amountCents,
			})),
		);

		await audit(created.id, "proforma_created", null, `Estimate generated (${invoiceNumber}) — pending staff review`, txDb);
		return created;
	});

	return row;
}

/**
 * Staff action: review a proforma and issue it as a real, payable invoice.
 *
 * The staff member can adjust line items (add document fees, discounts, etc.),
 * set a due date, and add a note. The old estimate lines are replaced entirely.
 */
export async function issueProforma(input: {
	invoiceId: string;
	lines: { label: string; detail?: string; amountCents: number }[];
	note?: string;
	dueAt?: string;
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

		// Replace estimate lines with the reviewed/adjusted lines
		await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, row.id));
		await tx.insert(invoiceLines).values(
			input.lines.map((l, position) => ({
				invoiceId: row.id,
				position,
				label: l.label,
				detail: l.detail ?? null,
				amountCents: l.amountCents,
			})),
		);

		const officialInvoiceNumber = await nextInvoiceNumber(txDb);
		const [updated] = await tx
			.update(invoices)
			.set({
				invoiceNumber: officialInvoiceNumber,
				status: "issued",
				subtotalCents: newSubtotal,
				note: input.note ?? row.note,
				dueAt: input.dueAt ? new Date(input.dueAt) : null,
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
	});
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
				updatedAt: new Date(),
			})
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(row.id, "issued", input.userEmail ?? input.userName, "Estimate accepted - moving to issued invoice", txDb);
		return updated;
	});
}
