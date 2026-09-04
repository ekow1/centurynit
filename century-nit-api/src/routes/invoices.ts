import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
	createInvoiceSchema,
	creditInvoiceSchema,
	invoiceListSchema,
	invoiceSchema,
	issueProformaSchema,
	listInvoicesQuerySchema,
	recordPaymentSchema,
	voidInvoiceSchema,
} from "century-nit-shared";
import { HttpError } from "../middleware/error.js";
import {
	requireAuth,
	requireMfa,
	requireModule,
	type AuthVariables,
	type StaffContext,
} from "../middleware/auth.js";
import {
	createInvoice,
	creditInvoice,
	getInvoice,
	issueProforma,
	listInvoices,
	listInvoicesForClient,
	recordPayment,
	serializeInvoice,
	voidInvoice,
} from "../services/invoice.js";
import { getApplicantByUserId } from "../services/cases.js";
import { postPaymentSettlement } from "../services/paymentSettlement.js";


/**
 * Invoice routes — commands, not CRUD (API_MIGRATION_PLAN.md §4).
 *
 * Every staff route is gated by the shared permission matrix via
 * `requireModule("invoices")` — manager and finance only. Applicants can list
 * and view their own invoices (matched by `clientUserId`), nothing else.
 */

const invoicesRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

const idParams = z.object({
	id: z.string().uuid(),
});

function actorFrom(staff: StaffContext) {
	return { opsUserId: staff.opsUserId, name: staff.name, email: staff.email };
}

/* ── POST /api/v1/invoices ──────────────────────────────────────────────────── */

invoicesRouter.openapi(
	createRoute({
		method: "post",
		path: "/",
		tags: ["Invoices"],
		middleware: [requireAuth, requireMfa, requireModule("invoices")] as const,
		request: {
			body: {
				content: { "application/json": { schema: createInvoiceSchema } },
				description: "Invoice to issue",
				required: true,
			},
		},
		responses: {
			201: {
				description: "Invoice issued",
				content: { "application/json": { schema: invoiceSchema } },
			},
		},
	}),
	async (c) => {
		const staff = c.get("staff")!;
		const body = c.req.valid("json");
		const row = await createInvoice({ data: body, actor: actorFrom(staff) });
		return c.json(await serializeInvoice(row), 201);
	},
);

/* ── GET /api/v1/invoices ───────────────────────────────────────────────────── */

invoicesRouter.openapi(
	createRoute({
		method: "get",
		path: "/",
		tags: ["Invoices"],
		middleware: [requireAuth, requireMfa] as const,
		request: { query: listInvoicesQuerySchema },
		responses: {
			200: {
				description: "Invoices — staff see all, applicants only their own",
				content: { "application/json": { schema: invoiceListSchema } },
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const staff = c.get("staff");
		const query = c.req.valid("query");

		// Applicants: their own invoices only, no filters to leak through.
		// A user who is BOTH staff and an applicant (e.g. a customer_service rep
		// with their own application) is still an applicant here — the portal
		// calls this route to load their own invoices, so we prefer the applicant
		// view before applying staff module gating.
		const applicant = await getApplicantByUserId(user.id);
		if (applicant) {
			const rows = await listInvoicesForClient(user.id);
			const list = await Promise.all(rows.map(serializeInvoice));
			return c.json({ invoices: list, total: list.length });
		}

		// Staff-only beyond this point.
		if (!staff) {
			throw new HttpError(403, "FORBIDDEN", "Staff access required");
		}

		// Staff: module-gated — same rule requireModule enforces, applied here
		// because this route serves both audiences.
		const { roleCanAccess } = await import("century-nit-shared");
		if (!roleCanAccess(staff.role, "invoices")) {
			throw new HttpError(403, "FORBIDDEN", 'Your role does not include the "invoices" module');
		}

		const { rows, total } = await listInvoices({
			status: query.status,
			type: query.type,
			q: query.q,
			limit: query.limit,
			offset: query.offset,
		});
		let list = await Promise.all(rows.map(serializeInvoice));
		// "overdue" is derived: the SQL filter narrows, this refines exactly.
		if (query.status === "overdue") list = list.filter((i) => i.status === "overdue");
		return c.json({ invoices: list, total });
	},
);

/* ── GET /api/v1/invoices/:id ───────────────────────────────────────────────── */

invoicesRouter.openapi(
	createRoute({
		method: "get",
		path: "/{id}",
		tags: ["Invoices"],
		middleware: [requireAuth, requireMfa] as const,
		request: { params: idParams },
		responses: {
			200: {
				description: "Invoice",
				content: { "application/json": { schema: invoiceSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const user = c.get("user");
		const staff = c.get("staff");

		const row = await getInvoice(id);
		if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");

		const { roleCanAccess } = await import("century-nit-shared");
		const isOwner = row.clientUserId === user.id;
		const isStaffAllowed = staff ? roleCanAccess(staff.role, "invoices") : false;
		if (!isOwner && !isStaffAllowed) {
			throw new HttpError(403, "FORBIDDEN", "Not allowed to view this invoice");
		}
		return c.json(await serializeInvoice(row));
	},
);

/* ── POST /api/v1/invoices/:id/payments ─────────────────────────────────────── */

invoicesRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/payments",
		tags: ["Invoices"],
		middleware: [requireAuth, requireMfa, requireModule("payments")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: recordPaymentSchema } },
				description: "Payment to record",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Invoice after payment",
				content: { "application/json": { schema: invoiceSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const staff = c.get("staff")!;
		const row = await recordPayment({
			invoiceId: id,
			amountCents: body.amountCents,
			method: body.method,
			gateway: body.gateway,
			reference: body.reference,
			actor: actorFrom(staff),
		});
		await postPaymentSettlement({
			invoice: row,
			payment: {
				amountCents: body.amountCents,
				method: body.method,
				reference: body.reference,
			},
			actor: actorFrom(staff),
			options: { recordGatewayTransaction: false },
		});
		return c.json(await serializeInvoice(row));
	},
);

/* ── POST /api/v1/invoices/:id/void ─────────────────────────────────────────── */

invoicesRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/void",
		tags: ["Invoices"],
		middleware: [requireAuth, requireMfa, requireModule("invoices")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: voidInvoiceSchema } },
				description: "Void reason",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Voided invoice",
				content: { "application/json": { schema: invoiceSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const staff = c.get("staff")!;
		const row = await voidInvoice({ invoiceId: id, reason: body.reason, actor: actorFrom(staff) });
		return c.json(await serializeInvoice(row));
	},
);

/* ── POST /api/v1/invoices/:id/credit ───────────────────────────────────────── */

invoicesRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/credit",
		tags: ["Invoices"],
		middleware: [requireAuth, requireMfa, requireModule("invoices")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: creditInvoiceSchema } },
				description: "Credit note",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Credited invoice",
				content: { "application/json": { schema: invoiceSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const staff = c.get("staff")!;
		const row = await creditInvoice({
			invoiceId: id,
			amountCents: body.amountCents,
			reason: body.reason,
			actor: actorFrom(staff),
		});
		return c.json(await serializeInvoice(row));
	},
);

/* ── POST /api/v1/invoices/:id/issue ────────────────────────────────────────── */

invoicesRouter.openapi(
	createRoute({
		method: "post",
		path: "/{id}/issue",
		tags: ["Invoices"],
		middleware: [requireAuth, requireMfa, requireModule("invoices")] as const,
		request: {
			params: idParams,
			body: {
				content: { "application/json": { schema: issueProformaSchema } },
				description: "Reviewed lines and terms to issue the invoice",
				required: true,
			},
		},
		responses: {
			200: {
				description: "Issued invoice",
				content: { "application/json": { schema: invoiceSchema } },
			},
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const staff = c.get("staff")!;
		const row = await issueProforma({
			invoiceId: id,
			lines: body.lines,
			note: body.note,
			dueAt: body.dueAt,
			actor: actorFrom(staff),
		});
		return c.json(await serializeInvoice(row));
	},
);

export { invoicesRouter };

