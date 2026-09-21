import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiInvoice } from "century-nit-shared";
import { meApi, ApiError } from "century-nit-core/api";
import { formatMoney } from "century-nit-core/ui";
import { downloadInvoice, downloadReceipt } from "../../lib/receipt";

/**
 * The in-portal checkout sheet. The transaction is initialized server-side
 * (`/invoices/:id/paystack/checkout`) and Paystack's own inline modal runs
 * over this page via `PaystackPop.resumeTransaction(accessCode)` — it offers
 * whichever channels the account has enabled (card, Mobile Money, bank
 * transfer). When no publishable key is configured the sheet falls back to
 * the hosted checkout redirect.
 *
 * The webhook remains the source of truth: a payment settles even if the
 * client closes this sheet, and the verify path is idempotent on the
 * reference.
 */

type Phase = "form" | "sending" | "paid" | "failed";

type PaystackPopInstance = {
	resumeTransaction(
		accessCode: string,
		callbacks?: {
			onSuccess?: (txn: { reference?: string }) => void;
			onCancel?: () => void;
			onError?: (err: unknown) => void;
		},
	): void;
};

declare global {
	interface Window {
		PaystackPop?: new () => PaystackPopInstance;
	}
}

let inlineLoader: Promise<void> | null = null;
function loadPaystackInline(): Promise<void> {
	if (window.PaystackPop) return Promise.resolve();
	if (!inlineLoader) {
		inlineLoader = new Promise((resolve, reject) => {
			const s = document.createElement("script");
			s.src = "https://js.paystack.co/v2/inline.js";
			s.async = true;
			s.onload = () => resolve();
			s.onerror = () => reject(new Error("Could not load the secure checkout."));
			document.head.appendChild(s);
		});
	}
	return inlineLoader;
}

export function PaySheet({
	invoice,
	onClose,
	onPaid,
}: {
	invoice: ApiInvoice;
	onClose: () => void;
	onPaid: (invoice: ApiInvoice) => void;
}) {
	const [phase, setPhase] = useState<Phase>("form");
	const [error, setError] = useState<string | null>(null);
	const [paidInvoice, setPaidInvoice] = useState<ApiInvoice | null>(null);
	const stopped = useRef(false);

	useEffect(() => {
		stopped.current = false;
		return () => {
			stopped.current = true;
		};
	}, []);

	const finish = useCallback((inv: ApiInvoice) => {
		setPaidInvoice(inv);
		setPhase("paid");
	}, []);

	async function payWithPaystack() {
		setError(null);
		setPhase("sending");
		try {
			const [{ publicKey }, checkout] = await Promise.all([
				meApi.paystackConfig(),
				meApi.paystackCheckout(invoice.id),
			]);
			if (!publicKey || !checkout.accessCode) {
				// No publishable key configured — the hosted redirect still works.
				window.location.href = checkout.authorizationUrl;
				return;
			}
			await loadPaystackInline();
			if (stopped.current) return;
			const popup = new window.PaystackPop!();
			setPhase("form");
			popup.resumeTransaction(checkout.accessCode, {
				onSuccess: (txn) => {
					const ref = txn.reference ?? checkout.reference;
					void meApi
						.paystackVerify(invoice.id, ref)
						.then((res) => finish(res.invoice))
						.catch(() => {
							setPhase("failed");
							setError("The payment went through but we couldn't confirm it yet — check your ledger in a moment.");
						});
				},
				onCancel: () => setPhase("form"),
				onError: () => {
					setPhase("form");
					setError("The checkout hit an error. You can try again.");
				},
			});
		} catch (err) {
			setPhase("form");
			setError(err instanceof ApiError ? err.message : "Could not open the checkout. Please try again.");
		}
	}

	return (
		<div className="paysheet" role="dialog" aria-modal="true" aria-label={`Pay ${invoice.invoiceNumber}`}>
			<div className="paysheet__panel">
				<div className="paysheet__head">
					<h3>{phase === "paid" ? "Payment received" : invoice.nextDue ? "Pay the next milestone" : "Pay the balance"}</h3>
					<span className="paysheet__inv">{invoice.invoiceNumber}</span>
					<button type="button" className="paysheet__x" onClick={onClose} aria-label="Close">✕</button>
				</div>

				<div className="paysheet__body">
					{phase === "form" || phase === "sending" ? (
						<>
							<div className="paysheet__sum">
								<span>
									{invoice.nextDue ? invoice.nextDue.label : invoice.lines.map((l) => l.label).join(" · ") || "Invoice balance"}
									<small>
										{invoice.nextDue
											? `${invoice.nextDue.dueAt ? `due ${new Date(invoice.nextDue.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ` : ""}then ${formatMoney(invoice.nextDue.remainingCents)} over the rest of your plan`
											: invoice.status === "issued" ? "outstanding balance" : invoice.status}
									</small>
								</span>
								<span className="paysheet__amt">{formatMoney(invoice.nextDue?.amountCents ?? invoice.balanceCents)}</span>
							</div>

							<p className="paysheet__note">A secure Paystack checkout opens over this page — pay by card or Mobile Money. Your payment details never touch our servers.</p>
							{error ? <p className="paysheet__err">{error}</p> : null}
							<button type="button" className="paysheet__pay" disabled={phase === "sending"} onClick={() => void payWithPaystack()}>
								{phase === "sending" ? "Opening…" : `Pay ${formatMoney(invoice.nextDue?.amountCents ?? invoice.balanceCents, "ghs")}`}
							</button>
							<p className="paysheet__secure">Paystack hosts the checkout · PCI stays with them</p>
						</>
					) : null}

					{phase === "paid" && paidInvoice ? (
						<>
							<div className="paysheet__ok">
								<span className="paysheet__seal">Paid</span>
								<p className="paysheet__ok-amt">{formatMoney(paidInvoice.paidCents, "ghs")}</p>
								<p className="paysheet__pend-s">
									{(() => { const p = paidInvoice.payments[paidInvoice.payments.length - 1]; return `${p?.method === "mobile_money" ? "Mobile Money" : "Card"} · ref ${p?.reference ?? ""}`; })()}
								</p>
								<div className="paysheet__docs">
									<button type="button" className="doc-link" onClick={() => downloadInvoice(paidInvoice, paidInvoice.invoiceNumber)}>↓ invoice</button>
									<button type="button" className="doc-link" onClick={() => downloadReceipt(paidInvoice, paidInvoice.invoiceNumber)}>↓ receipt</button>
								</div>
							</div>
							<button type="button" className="paysheet__pay" onClick={() => onPaid(paidInvoice)}>Done</button>
						</>
					) : null}

					{phase === "failed" ? (
						<>
							<p className="paysheet__err">{error ?? "The payment didn't go through."}</p>
							<button type="button" className="paysheet__pay" onClick={() => { setPhase("form"); setError(null); }}>Try again</button>
							<button type="button" className="paysheet__ghost" onClick={onClose}>Close</button>
						</>
					) : null}
				</div>
			</div>
		</div>
	);
}

/**
 * Owns the sheet's open state for a page: `pay(invoice)` opens it,
 * `sheet` renders it. `onPaid` fires once with the settled invoice so the page
 * can re-sync its money surfaces.
 */
export function usePaySheet(onPaid?: (invoice: ApiInvoice) => void) {
	const [invoice, setInvoice] = useState<ApiInvoice | null>(null);
	const close = useCallback(() => setInvoice(null), []);
	const sheet = invoice ? (
		<PaySheet
			invoice={invoice}
			onClose={close}
			onPaid={(inv) => {
				setInvoice(null);
				onPaid?.(inv);
			}}
		/>
	) : null;
	return { pay: setInvoice, sheet, close };
}
