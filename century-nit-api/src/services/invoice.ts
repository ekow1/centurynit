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
	applicants,
	caseComments,
	travelAssistanceRequests,
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
		const [created] = await txDb
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

		if (targetAppId) {
			if (!updated.applicationId) {
				await txDb.update(invoices).set({ applicationId: targetAppId }).where(eq(invoices.id, updated.id));
			}
			if (updated.type === "application" && status === "paid") {
				await txDb.update(applications).set({ appFeePaid: true }).where(eq(applications.id, targetAppId));
			} else if (updated.type === "visa" && status === "paid") {
				// Always mark the visa invoice as paid on the application row so the
				// portal and /me/journey see the correct status — the flag must not
				// depend on the current visaStage (ops may have already advanced it).
				await txDb
					.update(applications)
					.set({ visaInvoicePaid: true })
					.where(eq(applications.id, targetAppId));
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
				await txDb.update(applications).set({ travelInvoicePaid: true }).where(eq(applications.id, targetAppId));
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
				const depositPaid = agencyStageIndex >= 1;
				const [paidApp] = await txDb
					.update(applications)
					.set({
						agencyStageIndex,
						agencySettled: agencyStageIndex >= lines.length,
						depositPaid,
					})
					.where(eq(applications.id, targetAppId))
					.returning();
				// The deposit is the single trigger for the school_submission
				// handler. It fires once — on the payment that crosses the deposit
				// line while the case is still at document_verification — so later
				// installments never re-open a resolved handoff.
				if (paidApp && depositPaid && paidApp.stage === "document_verification") {
					const { activeHandlerFor, createOrGetHandoff } = await import("./handoffs.js");
					const handler = await activeHandlerFor(targetAppId, "school_submission", txDb);
					if (handler) {
						// A handler was assigned ahead of the deposit (directly from
						// the ops queue). Nothing to hand off — open the stage now,
						// exactly as resolving a handoff would.
						await txDb
							.update(applications)
							.set({ stage: "school_submission", assignedStaffId: handler.opsUserId, updatedAt: new Date() })
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
				await txDb.update(applications).set({ agencySettled: false, agencyStageIndex: 0, depositPaid: false }).where(eq(applications.id, updated.applicationId));
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
	dueAt?: string | null;
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
				updatedAt: new Date(),
			})
			.where(eq(invoices.id, row.id))
			.returning();

		await audit(row.id, "issued", input.actorName, "Application invoice issued by handler", txDb);
		return updated;
	}).then(async (updated) => {
		await notifyClientInvoice(updated, "issued");
		return updated;
	});
}
