import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiInvoice, MomoProvider } from "century-nit-shared";
import { meApi, ApiError } from "century-nit-core/api";
import { formatMoney } from "century-nit-core/ui";
import { downloadInvoice, downloadReceipt } from "../../lib/receipt";

/**
 * The in-portal checkout sheet. Paystack's hosted page used to take the whole
 * browser away mid-journey; this keeps payment inside the portal:
 *
 * - Mobile Money runs fully in our UI — the server calls Paystack's `/charge`
 *   with the wallet number + network, the client approves the prompt on their
 *   phone, and we poll `/momo/{reference}` until it settles (or the provider
 *   asks for an OTP, which gets its own step). No card data is involved, so
 *   owning this screen costs no PCI scope.
 * - Card opens Paystack's inline modal over the sheet via
 *   `PaystackPop.resumeTransaction(accessCode)` — the transaction is still
 *   initialized server-side, so the existing verify endpoint settles it. When
 *   no publishable key is configured the sheet falls back to the old redirect.
 *
 * The webhook remains the source of truth: a phone-approved charge settles
 * even if the client closes this sheet, and the verify path is idempotent on
 * the reference.
 */

type Phase = "form" | "sending" | "pending" | "otp" | "paid" | "failed";
type Channel = "momo" | "card";

const NETWORKS: { code: MomoProvider; label: string }[] = [
	{ code: "mtn", label: "MTN" },
	{ code: "vod", label: "Telecel" },
	{ code: "atl", label: "AirtelTigo" },
];

const POLL_MS = 4_000;
const POLL_LIMIT = 120; // ~8 minutes of waiting on the phone prompt

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
			s.onerror = () => reject(new Error("Could not load the secure card form."));
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
	const [channel, setChannel] = useState<Channel>("momo");
	const [phase, setPhase] = useState<Phase>("form");
	const [network, setNetwork] = useState<MomoProvider>("mtn");
	const [phone, setPhone] = useState("");
	const [otp, setOtp] = useState("");
	const [reference, setReference] = useState<string | null>(null);
	const [hint, setHint] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [paidInvoice, setPaidInvoice] = useState<ApiInvoice | null>(null);
	const polls = useRef(0);
	const stopped = useRef(false);

	useEffect(() => {
		stopped.current = false;
		return () => {
			stopped.current = true;
		};
	}, []);

	const finish = useCallback(
		(inv: ApiInvoice) => {
			setPaidInvoice(inv);
			setPhase("paid");
		},
		[],
	);

	/** Poll the charge until it settles, fails, or the sheet closes. */
	const watch = useCallback(
		(ref: string) => {
			const tick = async () => {
				if (stopped.current) return;
				if (++polls.current > POLL_LIMIT) {
					setHint("Still waiting on the approval. If you already entered your PIN, the payment still lands — check your ledger in a moment.");
					return;
				}
				try {
					const res = await meApi.momoStatus(invoice.id, ref);
					if (stopped.current) return;
					if (res.settled && res.invoice) {
						finish(res.invoice);
						return;
					}
					if (res.status === "failed") {
						setPhase("failed");
						setError("The charge was declined or timed out. Nothing was taken — you can try again.");
						return;
					}
				} catch {
					/* a flaky poll just tries again */
				}
				setTimeout(tick, POLL_MS);
			};
			void tick();
		},
		[invoice.id, finish],
	);

	async function submitMomo(e?: React.FormEvent) {
		e?.preventDefault();
		setError(null);
		setPhase("sending");
		try {
			const res = await meApi.momoCharge(invoice.id, { phone: phone.trim(), provider: network });
			setReference(res.reference);
			setHint(res.displayText);
			polls.current = 0;
			if (res.status === "send_otp") {
				setPhase("otp");
			} else if (res.status === "success") {
				const st = await meApi.momoStatus(invoice.id, res.reference);
				if (st.settled && st.invoice) finish(st.invoice);
				else {
					setPhase("pending");
					watch(res.reference);
				}
			} else if (res.status === "failed") {
				setPhase("failed");
				setError(res.displayText ?? "The charge was declined. Nothing was taken — you can try again.");
			} else {
				setPhase("pending");
				watch(res.reference);
			}
		} catch (err) {
			setPhase("form");
			setError(err instanceof ApiError ? err.message : "Could not send the charge. Please try again.");
		}
	}

	async function submitOtp(e?: React.FormEvent) {
		e?.preventDefault();
		if (!reference) return;
		setError(null);
		setPhase("sending");
		try {
			const res = await meApi.momoOtp(invoice.id, { reference, otp: otp.trim() });
			setHint(res.displayText);
			if (res.status === "success") {
				const st = await meApi.momoStatus(invoice.id, res.reference);
				if (st.settled && st.invoice) finish(st.invoice);
				else {
					setPhase("pending");
					watch(res.reference);
				}
			} else if (res.status === "failed") {
				setPhase("failed");
				setError("The code wasn't accepted. Nothing was taken — you can try again.");
			} else {
				setPhase("pending");
				watch(res.reference);
			}
		} catch (err) {
			setPhase("otp");
			setError(err instanceof ApiError ? err.message : "Could not submit the code.");
		}
	}

	async function payByCard() {
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
					setError("The card form hit an error. You can try again or pay with Mobile Money.");
				},
			});
		} catch (err) {
			setPhase("form");
			setError(err instanceof ApiError ? err.message : "Could not open the card checkout. Please try again.");
		}
	}

	const netLabel = NETWORKS.find((n) => n.code === network)?.label ?? "your wallet";

	return (
		<div className="paysheet" role="dialog" aria-modal="true" aria-label={`Pay ${invoice.invoiceNumber}`}>
			<div className="paysheet__panel">
				<div className="paysheet__head">
					<h3>{phase === "paid" ? "Payment received" : phase === "pending" || phase === "otp" ? "Approve on your phone" : "Pay the balance"}</h3>
					<span className="paysheet__inv">{invoice.invoiceNumber}</span>
					<button type="button" className="paysheet__x" onClick={onClose} aria-label="Close">✕</button>
				</div>

				<div className="paysheet__body">
					{phase === "form" || phase === "sending" ? (
						<>
							<div className="paysheet__sum">
								<span>
									{invoice.lines.map((l) => l.label).join(" · ") || "Invoice balance"}
									<small>{invoice.status === "issued" ? "outstanding balance" : invoice.status}</small>
								</span>
								<span className="paysheet__amt">{formatMoney(invoice.balanceCents)}</span>
							</div>

							<div className="paysheet__chans" role="tablist">
								<button type="button" role="tab" aria-selected={channel === "momo"} className={`paysheet__chan${channel === "momo" ? " paysheet__chan--on" : ""}`} onClick={() => setChannel("momo")}>
									<b>Mobile money</b>MTN · Telecel · AT
								</button>
								<button type="button" role="tab" aria-selected={channel === "card"} className={`paysheet__chan${channel === "card" ? " paysheet__chan--on" : ""}`} onClick={() => setChannel("card")}>
									<b>Card</b>Visa · Mastercard
								</button>
							</div>

							{channel === "momo" ? (
								<form onSubmit={submitMomo}>
									<label className="paysheet__field">
										<span>Network</span>
										<span className="paysheet__nets">
											{NETWORKS.map((n) => (
												<button key={n.code} type="button" className={`paysheet__net${network === n.code ? " paysheet__net--on" : ""}`} onClick={() => setNetwork(n.code)} aria-pressed={network === n.code}>
													{n.label}
												</button>
											))}
										</span>
									</label>
									<label className="paysheet__field">
										<span>Wallet number</span>
										<input
											value={phone}
											onChange={(e) => setPhone(e.target.value)}
											inputMode="tel"
											placeholder="024 000 0000"
											required
											autoComplete="tel"
										/>
									</label>
									{error ? <p className="paysheet__err">{error}</p> : null}
									<button type="submit" className="paysheet__pay" disabled={phase === "sending" || phone.trim().length < 7}>
										{phase === "sending" ? "Sending…" : `Pay ${formatMoney(invoice.balanceCents, "ghs")}`}
									</button>
									<p className="paysheet__secure">You approve on your phone · nothing is charged until you enter your MoMo PIN</p>
								</form>
							) : (
								<>
									<p className="paysheet__note">A secure Paystack card form opens over this page — your card details never touch our servers.</p>
									{error ? <p className="paysheet__err">{error}</p> : null}
									<button type="button" className="paysheet__pay" disabled={phase === "sending"} onClick={() => void payByCard()}>
										{phase === "sending" ? "Opening…" : `Pay ${formatMoney(invoice.balanceCents, "ghs")} by card`}
									</button>
									<p className="paysheet__secure">Paystack hosts the card form · PCI stays with them</p>
								</>
							)}
						</>
					) : null}

					{phase === "otp" ? (
						<form onSubmit={submitOtp}>
							<p className="paysheet__note">{hint ?? `${netLabel} sent a code to approve this payment.`}</p>
							<label className="paysheet__field">
								<span>Approval code</span>
								<input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" placeholder="123456" required autoFocus />
							</label>
							{error ? <p className="paysheet__err">{error}</p> : null}
							<button type="submit" className="paysheet__pay" disabled={otp.trim().length < 3}>Submit code</button>
							<button type="button" className="paysheet__ghost" onClick={() => { setPhase("form"); setReference(null); }}>Back</button>
						</form>
					) : null}

					{phase === "pending" ? (
						<>
							<div className="paysheet__pend">
								<span className="paysheet__dot" aria-hidden />
								<p className="paysheet__pend-t">{formatMoney(invoice.balanceCents, "ghs")} → {phone}</p>
								<p className="paysheet__pend-s">
									{hint ?? `An approval prompt is on its way to the ${netLabel} wallet. Enter your MoMo PIN to confirm — this page updates itself.`}
								</p>
								<p className="paysheet__pend-ref">ref {reference}</p>
							</div>
							<ol className="paysheet__steps">
								<li className="done"><span>1</span> Charge sent to {netLabel}</li>
								<li className="cur"><span>2</span> Waiting for the PIN on your phone…</li>
								<li><span>3</span> Settled → receipt issued</li>
							</ol>
							<button type="button" className="paysheet__ghost" onClick={onClose}>Close — the payment still lands if you approve</button>
						</>
					) : null}

					{phase === "paid" && paidInvoice ? (
						<>
							<div className="paysheet__ok">
								<span className="paysheet__seal">Paid</span>
								<p className="paysheet__ok-amt">{formatMoney(paidInvoice.paidCents, "ghs")}</p>
								<p className="paysheet__pend-s">
									{(() => { const p = paidInvoice.payments[paidInvoice.payments.length - 1]; return `${p?.method === "mobile_money" ? "Mobile Money" : "Card"} · ref ${p?.reference ?? reference}`; })()}
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
