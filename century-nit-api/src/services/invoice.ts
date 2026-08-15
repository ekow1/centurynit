import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
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
} from "../db/schema.js";
import { HttpError } from "../middleware/error.js";

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

/** `INV-2026-0007`. Counted within the year so numbers restart annually. */
async function nextInvoiceNumber(tx: typeof db): Promise<string> {
	const year = new Date().getUTCFullYear();
	const [row] = await tx
		.select({ count: sql<number>`count(*)::int` })
		.from(invoices)
		.where(gte(invoices.createdAt, new Date(Date.UTC(year, 0, 1))));
	return `INV-${year}-${String((row?.count ?? 0) + 1).padStart(4, "0")}`;
}

async function paidCentsOf(invoiceId: string, tx: typeof db = db): Promise<number> {
	const [row] = await tx
		.select({ total: sql<number>`coalesce(sum(amount_cents), 0)::int` })
		.from(invoicePayments)
		.where(eq(invoicePayments.invoiceId, invoiceId));
	return row?.total ?? 0;
}

function balanceOf(row: InvoiceRow, paidCents: number): number {
	if (row.status === "void") return 0;
	return Math.max(0, row.subtotalCents - paidCents - row.creditedCents);
}

/** Stored status from the numbers — void is sticky and set explicitly. */
function storedStatusFor(row: InvoiceRow, paidCents: number): InvoiceStoredStatus {
	if (row.status === "void") return "void";
	const balance = balanceOf(row, paidCents);
	if (balance === 0) return "paid";
	if (paidCents > 0 || row.creditedCents > 0) return "partial";
	return "issued";
}

/** Effective status for responses — derives "overdue", never stores it. */
function effectiveStatus(row: InvoiceRow, paidCents: number): InvoiceStatus {
	const stored = storedStatusFor(row, paidCents);
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
		const [created] = await tx
			.insert(invoices)
			.values({
				invoiceNumber,
				clientUserId: data.clientUserId ?? null,
				applicantName: data.applicantName,
				applicantEmail: data.applicantEmail ?? null,
				type: data.type,
				subtotalCents,
				note: data.note ?? null,
				status: "issued",
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

		await audit(created.id, "issued", actor.email, `Issued by ${actor.name}`, txDb);
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

		await audit(row.id, "void", input.actor.email, input.reason, txDb);
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
