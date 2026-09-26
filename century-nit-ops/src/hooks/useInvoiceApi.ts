/**
 * Hook that bridges the invoice API to the ops app's existing Invoice type.
 *
 * The API stores amounts in cents (integers); the ops app works in USD dollars
 * (floats). This hook handles the conversion and provides reactive state that
 * components can drop in place of the mock `invoices` from OpsStateContext.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useOpsAuth } from "../pages/OpsAuthContext";
import { useOpsSSE } from "./useChatStream";
import {
	type Invoice,
	type InvoiceStatus,
	type InvoiceType,
	type InvoicePayment,
	type InvoiceEvent,
	type OpsInvoiceLine,
} from "century-nit-core/ops";
import {
	listInvoices as apiListInvoices,
	createInvoice as apiCreateInvoice,
	issueInvoice as apiIssueInvoice,
	recordPayment as apiRecordPayment,
	voidInvoice as apiVoidInvoice,
	creditInvoice as apiCreditInvoice,
	type ApiInvoice,
} from "../lib/api";


const TYPE_MAP: Record<ApiInvoice["type"], InvoiceType> = {
	application: "Application",
	visa: "Visa",
	consultation: "Consultation",
	agency: "Agency",
	travel: "Travel",
	custom: "Custom",
};

function adaptInvoice(api: ApiInvoice): Invoice {
	const lines: OpsInvoiceLine[] = api.lines.map((l) => ({
		id: l.id,
		label: l.label,
		detail: l.detail ?? "",
		amount: l.amountCents / 100,
		schoolApplicationId: l.schoolApplicationId ?? null,
		dueAt: l.dueAt ?? null,
		dueOn: l.dueOn ?? null,
	}));

	const payments: InvoicePayment[] = api.payments.map((p) => ({
		id: p.id,
		amount: p.amountCents / 100,
		at: p.at,
		method: p.method,
		reference: p.reference ?? "",
		by: p.recordedByName,
	}));

	const history: InvoiceEvent[] = api.history.map((h) => ({
		at: h.at,
		by: h.actor ?? "",
		action: h.action,
		detail: h.detail ?? undefined,
	}));

	return {
		id: api.id,
		invoiceNumber: api.invoiceNumber,
		applicantId: api.clientUserId ?? api.applicantName,
		applicantName: api.applicantName,
		applicationId: api.applicationId ?? null,
		type: TYPE_MAP[api.type],
		lines,
		subtotal: api.subtotalCents / 100,
		note: api.note ?? "",
		status: api.status as InvoiceStatus,
		issuedAt: api.createdAt,
		issuedBy: api.issuedByName,
		dueAt: api.dueAt ?? undefined,
		payments,
		voidedAt: api.voidedAt ?? undefined,
		voidReason: api.voidReason ?? undefined,
		creditedAmount: api.creditedCents / 100,
		history,
	};
}

function toIso(date?: string) {
	if (!date || !date.trim()) return undefined;
	if (date.includes("T")) return date;
	return `${date}T00:00:00.000Z`;
}

const PAGE = 200;

export function useInvoiceApi() {
	const { hasPermission } = useOpsAuth();
	const [invoices, setInvoices] = useState<Invoice[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	/**
	 * Whether this user may read invoices at all. Without it a permissionless
	 * role and an empty ledger look identical — "nobody is behind" stated as
	 * fact when the page simply never saw the data.
	 */
	const [permitted, setPermitted] = useState(true);

	const refresh = useCallback(async () => {
		if (!hasPermission("invoices")) {
			setInvoices([]);
			setPermitted(false);
			setError(null);
			setLoading(false);
			return;
		}
		setPermitted(true);
		setLoading(true);
		setError(null);
		try {
			// Walk every page so the behind/coverage tiles count the whole
			// ledger, not a silent first-200 sample of it.
			const all: ApiInvoice[] = [];
			for (let offset = 0; ; offset += PAGE) {
				const page = await apiListInvoices({ limit: PAGE, offset });
				all.push(...page.invoices);
				if (all.length >= page.total || page.invoices.length < PAGE) break;
			}
			setInvoices(all.map(adaptInvoice));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load invoices");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Live refresh on invoice/payment events — issued, paid, voided, credited,
	// payment.recorded from webhooks — debounced so a settlement burst is one
	// refetch.
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	useOpsSSE((event) => {
		const t = String(event.type ?? "").replace(/_/g, ".");
		if (t.startsWith("invoice.") || t.startsWith("payment.")) {
			if (refreshTimer.current) clearTimeout(refreshTimer.current);
			refreshTimer.current = setTimeout(() => void refreshRef.current(), 1500);
		}
	});

	const createInvoice = useCallback(
		async (input: {
			applicantName: string;
			applicantEmail?: string;
			clientUserId?: string;
			type: InvoiceType;
			lines: OpsInvoiceLine[];
			note?: string;
			dueAt?: string;
		}) => {
			const apiType = (
				{ Application: "application", Visa: "visa", Consultation: "consultation", Agency: "agency", Travel: "travel", Custom: "custom" } as const
			)[input.type];

			const created = await apiCreateInvoice({
				applicantName: input.applicantName,
				applicantEmail: input.applicantEmail,
				clientUserId: input.clientUserId,
				type: apiType,
				lines: input.lines.map((l) => ({
					label: l.label,
					detail: l.detail || undefined,
					amountCents: Math.round(l.amount * 100),
				})),
				note: input.note || undefined,
				dueAt: toIso(input.dueAt),
			});
			setInvoices((prev) => [adaptInvoice(created), ...prev]);
			return adaptInvoice(created);
		},
		[],
	);

	const issueInvoice = useCallback(
		async (id: string, lines: OpsInvoiceLine[], note?: string, dueAt?: string) => {
			const updated = await apiIssueInvoice(id, {
				lines: lines.map((l) => ({
					label: l.label,
					detail: l.detail || undefined,
					amountCents: Math.round(l.amount * 100),
					schoolApplicationId: l.schoolApplicationId ?? null,
				})),
				note: note || undefined,
				dueAt: toIso(dueAt),
			});
			const adapted = adaptInvoice(updated);
			setInvoices((prev) => prev.map((inv) => (inv.id === id ? adapted : inv)));
			return adapted;
		},
		[],
	);

	const recordPayment = useCallback(
		async (id: string, amount: number, method: string, reference: string) => {
			const updated = await apiRecordPayment(id, {
				amountCents: Math.round(amount * 100),
				method,
				reference: reference || undefined,
			});
			const adapted = adaptInvoice(updated);
			setInvoices((prev) => prev.map((inv) => (inv.id === id ? adapted : inv)));
			return adapted;
		},
		[],
	);

	const voidInvoice = useCallback(async (id: string, reason: string) => {
		const updated = await apiVoidInvoice(id, reason);
		const adapted = adaptInvoice(updated);
		setInvoices((prev) => prev.map((inv) => (inv.id === id ? adapted : inv)));
		return adapted;
	}, []);

	const creditInvoice = useCallback(async (id: string, amount: number, reason: string) => {
		const updated = await apiCreditInvoice(id, {
			amountCents: Math.round(amount * 100),
			reason,
		});
		const adapted = adaptInvoice(updated);
		setInvoices((prev) => prev.map((inv) => (inv.id === id ? adapted : inv)));
		return adapted;
	}, []);

	return {
		invoices,
		loading,
		error,
		permitted,
		refresh,
		createInvoice,
		issueInvoice,
		recordPayment,
		voidInvoice,
		creditInvoice,
	};
}

