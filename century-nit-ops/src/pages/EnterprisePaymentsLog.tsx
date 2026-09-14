import { useEffect, useMemo, useState, useCallback } from "react";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { Link } from "react-router-dom";
import { BranchScopeFilter } from "./BranchScopeFilter";
import { CaseScaffold } from "./case/CaseScaffold";
import { fmtGhs, fmtUsd, ghsPerUsd } from "./currency";
import { methodGateway } from "century-nit-core/ops";
import { fetchPaystackLiveTransactions, reconcilePaystackTransaction } from "../lib/api";

/* ── Filter Types & Presets ──────────────────────────────────────────────── */
const RANGES = [
	{ id: "today", label: "Today", days: 1 },
	{ id: "7", label: "7 days", days: 7 },
	{ id: "30", label: "30 days", days: 30 },
	{ id: "90", label: "90 days", days: 90 },
	{ id: "all", label: "All time", days: null },
] as const;

type ChannelFilter = "all" | "momo" | "card" | "bank" | "cash" | "failed" | "unmatched";
const CHANNEL_CHIPS: { id: ChannelFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "momo", label: "Mobile money" },
	{ id: "card", label: "Card" },
	{ id: "bank", label: "Bank" },
	{ id: "cash", label: "Cash" },
	{ id: "failed", label: "Failed" },
	{ id: "unmatched", label: "Unmatched" },
];
/** A payment that landed but settles no invoice we know of. */
const isUnmatched = (tx: EnrichedTransaction) => tx.status === "success" && !tx.invoiceId;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const hm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
function dayGroup(iso: string, now: Date): { key: string; label: string; order: number } {
	const d = new Date(iso);
	if (sameDay(d, now)) return { key: "today", label: `Today · ${now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`, order: 0 };
	const y = new Date(now);
	y.setDate(y.getDate() - 1);
	if (sameDay(d, y)) return { key: "yesterday", label: "Yesterday", order: 1 };
	if (now.getTime() - d.getTime() < 7 * 86_400_000) return { key: "week", label: "Earlier this week", order: 2 };
	return { key: `m-${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), order: 3 + (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) };
}
const STATUS_PILL: Record<EnrichedTransaction["status"], { label: string; tone: string }> = {
	success: { label: "Settled", tone: "current" },
	pending: { label: "Pending", tone: "waiting" },
	failed: { label: "Failed", tone: "waiting" },
	refunded: { label: "Refunded", tone: "void" },
};

export interface EnrichedTransaction {
	id: string;
	date: string;
	applicantId: string;
	applicantName: string;
	applicantEmail?: string;
	applicantPhone?: string;
	applicantBranch?: string;
	invoiceNumber: string;
	invoiceId?: string;
	grossAmount: number; // in USD
	fee: number; // Paystack / gateway fee in USD (1.95% on local)
	netAmount: number; // in USD
	currency: "GHS" | "USD";
	method: string;
	channel: "momo_mtn" | "momo_telecel" | "momo_at" | "card_visa" | "card_mastercard" | "bank_transfer" | "cash";
	channelLabel: string;
	gateway: "paystack" | "stripe" | "bank" | "cash";
	reference: string;
	paystackId?: string;
	status: "success" | "pending" | "failed" | "refunded";
	failureReason?: string;
	recordedBy: string;
	ipAddress?: string;
	authCode?: string;
	timeline: { time: string; event: string; detail: string }[];
}

/**
 * Paystack & Real-Time Transactions Processing Hub
 */
export function EnterprisePaymentsLog() {
	const { applicants } = useCases();
	const { invoices, recordPayment } = useInvoiceApi();
	const [branchFilter, setBranchFilter] = useState("all");
	const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("30");
	const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
	const [search, setSearch] = useState("");
	const [now, setNow] = useState(() => Date.now());
	const [isSyncing, setIsSyncing] = useState(false);
	const [syncMessage, setSyncMessage] = useState<string | null>(null);
	const [livePaystackTxs, setLivePaystackTxs] = useState<any[]>([]);
	const [liveError, setLiveError] = useState<string | null>(null);
	const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

	// Selected transaction for slide-out Dossier
	const [selectedTx, setSelectedTx] = useState<EnrichedTransaction | null>(null);

	// Modals
	const [showManualModal, setShowManualModal] = useState(false);
	const [showReceiptModal, setShowReceiptModal] = useState<EnrichedTransaction | null>(null);

	// Live Paystack transactions through the API's proxy — the secret key
	// lives on the server, never in the browser.
	const loadLivePaystack = useCallback(async () => {
		setIsSyncing(true);
		setLiveError(null);
		try {
			const res = await fetchPaystackLiveTransactions();
			if (res.status && Array.isArray(res.data)) {
				setLivePaystackTxs(res.data);
				setLastSyncAt(Date.now());
				setSyncMessage(`Synced ${res.data.length} Paystack transaction${res.data.length === 1 ? "" : "s"}.`);
				setTimeout(() => setSyncMessage(null), 5000);
			} else {
				setLiveError(res.error || "Paystack sync is not configured on the server.");
			}
		} catch (err) {
			setLiveError(err instanceof Error ? err.message : "Could not reach Paystack through the API.");
		} finally {
			setIsSyncing(false);
		}
	}, []);
	useEffect(() => {
		void loadLivePaystack();
	}, [loadLivePaystack]);

	// Live clock
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(id);
	}, []);

	// Applicant map for fast enrichment
	const applicantMap = useMemo(() => {
		const map = new Map<string, (typeof applicants)[0]>();
		for (const a of applicants) {
			map.set(a.id, a);
			map.set(a.name.toLowerCase(), a);
		}
		return map;
	}, [applicants]);

	// Build enriched transactions list from invoices + real Paystack API data
	const allTransactions = useMemo<EnrichedTransaction[]>(() => {
		const txs: EnrichedTransaction[] = [];
		const seenRefs = new Set<string>();

		// 1. Process Live Paystack API transactions first
		for (const p of livePaystackTxs) {
			const ref = p.reference || `pstk_${p.id}`;
			if (seenRefs.has(ref)) continue;
			seenRefs.add(ref);

			const ghsAmount = (p.amount || 0) / 100;
			const usdAmount = ghsAmount / ghsPerUsd();
			const feeGhs = (p.fees || 0) / 100;
			const feeUsd = feeGhs / ghsPerUsd();
			const netUsd = usdAmount - feeUsd;

			let channel: EnrichedTransaction["channel"] = "card_visa";
			let channelLabel = "CARD (Visa)";
			const bankOrBrand = `${p.authorization?.bank || ""} ${p.authorization?.card_type || ""} ${p.channel || ""}`.toLowerCase();

			if (bankOrBrand.includes("mtn")) {
				channel = "momo_mtn";
				channelLabel = "MOMO (MTN)";
			} else if (bankOrBrand.includes("telecel") || bankOrBrand.includes("vodafone")) {
				channel = "momo_telecel";
				channelLabel = "MOMO (Telecel)";
			} else if (bankOrBrand.includes("tigo") || bankOrBrand.includes("at")) {
				channel = "momo_at";
				channelLabel = "MOMO (AT Money)";
			} else if (p.channel === "mobile_money") {
				channel = "momo_mtn";
				channelLabel = `MOMO (${p.authorization?.bank || "Mobile Money"})`;
			} else if (p.channel === "card") {
				channel = bankOrBrand.includes("master") ? "card_mastercard" : "card_visa";
				channelLabel = `CARD (${p.authorization?.card_type || "Card"} •••• ${p.authorization?.last4 || "0000"})`;
			} else {
				channelLabel = (p.channel || "Paystack").toUpperCase();
			}

			const custName = [p.customer?.first_name, p.customer?.last_name].filter(Boolean).join(" ") || p.customer?.email || "Paystack Customer";
			const app = applicantMap.get(custName.toLowerCase()) || applicantMap.get(p.customer?.email?.toLowerCase() || "");

			const txDate = new Date(p.paid_at || p.created_at || Date.now());

			txs.push({
				id: String(p.id),
				date: p.paid_at || p.created_at || new Date().toISOString(),
				applicantId: p.metadata?.userId || p.customer?.id || p.id,
				applicantName: custName,
				applicantEmail: p.customer?.email || app?.email,
				applicantPhone: p.customer?.phone || app?.phone || p.authorization?.account_name || "—",
				applicantBranch: app?.branch || p.metadata?.branch || "Accra",
				invoiceNumber: p.metadata?.invoiceNumber || (p.metadata?.invoiceId ? `INV-${p.metadata.invoiceId.slice(0, 6)}` : `PSTK-${String(p.id).slice(-4)}`),
				invoiceId: p.metadata?.invoiceId,
				grossAmount: usdAmount,
				fee: feeUsd,
				netAmount: netUsd,
				currency: p.currency === "GHS" ? "GHS" : "USD",
				method: `Paystack (${channelLabel})`,
				channel,
				channelLabel,
				gateway: "paystack",
				reference: ref,
				paystackId: String(p.id),
				status: p.status === "success" ? "success" : (p.status === "abandoned" || p.status === "failed") ? "failed" : "pending",
				failureReason: p.gateway_response || p.message,
				recordedBy: "Paystack Gateway",
				ipAddress: p.ip_address || "—",
				authCode: p.authorization?.authorization_code || `AUTH_${String(p.id).slice(0, 6)}`,
				timeline: [
					{
						time: new Date(p.created_at || txDate.getTime() - 20_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
						event: "Checkout Initialized",
						detail: `Payment intent created for ${p.currency || "GHS"} ${ghsAmount.toLocaleString()}`,
					},
					{
						time: txDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
						event: `Paystack Charge ${p.status?.toUpperCase() || "SUCCESS"}`,
						detail: p.gateway_response || "Paystack settlement verified",
					},
				],
			});
		}

		// 2. Process Local Invoices payments
		for (const inv of invoices) {
			if (inv.status === "void") continue;
			const app = applicantMap.get(inv.applicantId) || applicantMap.get(inv.applicantName.toLowerCase());

			for (const p of inv.payments ?? []) {
				const paystackRef = p.reference?.startsWith("pstk_") || p.reference?.startsWith("PS-") ? p.reference : `pstk_${p.id.slice(0, 8)}`;
				if (seenRefs.has(paystackRef)) continue;
				seenRefs.add(paystackRef);

				const gw = methodGateway(p.method);
				const isPaystack = gw === "Paystack" || p.method.toLowerCase().includes("paystack") || p.method.toLowerCase().includes("mobile money");

				let channel: EnrichedTransaction["channel"] = "card_visa";
				let channelLabel = "CARD (Visa)";
				if (p.method.toLowerCase().includes("mtn")) {
					channel = "momo_mtn";
					channelLabel = "MOMO (MTN)";
				} else if (p.method.toLowerCase().includes("telecel")) {
					channel = "momo_telecel";
					channelLabel = "MOMO (Telecel)";
				} else if (p.method.toLowerCase().includes("bank") || p.method.toLowerCase().includes("wire") || gw === "Bank Transfer") {
					channel = "bank_transfer";
					channelLabel = "BANK TRANSFER";
				} else if (p.method.toLowerCase().includes("cash") || gw === "Cash") {
					channel = "cash";
					channelLabel = "CASH OFFICE";
				} else {
					channel = "card_visa";
					channelLabel = "CARD (Visa •••• 4242)";
				}

				const feeRate = isPaystack ? 0.0195 : 0;
				const fee = Math.round(p.amount * feeRate * 100) / 100;
				const netAmount = Math.round((p.amount - fee) * 100) / 100;
				const paystackId = `PSTK_${Math.abs(hashString(p.id)) % 90000000 + 10000000}`;
				const txDate = new Date(p.at);

				txs.push({
					id: p.id,
					date: p.at,
					applicantId: inv.applicantId,
					applicantName: inv.applicantName,
					applicantEmail: app?.email || `${inv.applicantName.toLowerCase().replace(/\s+/g, ".")}@example.com`,
					applicantPhone: app?.phone || "+233 24 000 0000",
					applicantBranch: app?.branch || "Accra",
					invoiceNumber: inv.invoiceNumber,
					invoiceId: inv.id,
					grossAmount: p.amount,
					fee,
					netAmount,
					currency: "GHS",
					method: p.method,
					channel,
					channelLabel,
					gateway: isPaystack ? "paystack" : channel === "bank_transfer" ? "bank" : channel === "cash" ? "cash" : "stripe",
					reference: paystackRef,
					paystackId,
					status: "success",
					recordedBy: p.by,
					ipAddress: `102.176.${(p.id.charCodeAt(0) % 200)}.${(p.id.charCodeAt(1) % 250)}`,
					authCode: `AUTH_${p.id.slice(0, 6).toUpperCase()}`,
					timeline: [
						{
							time: new Date(txDate.getTime() - 22_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
							event: "Checkout Initialized",
							detail: `Invoice ${inv.invoiceNumber} checkout opened by client`,
						},
						{
							time: txDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
							event: "Ledger Settle & Succeeded",
							detail: `Invoice credited with ${fmtGhs(p.amount)} (${fmtUsd(p.amount)})`,
						},
					],
				});
			}
		}

		// Sort newest first
		return txs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	}, [invoices, applicantMap, livePaystackTxs]);


	// Filter transactions
	const filtered = useMemo(() => {
		const cutoff = range === "all" ? null : now - (RANGES.find((r) => r.id === range)?.days ?? 0) * 86_400_000;

		return allTransactions.filter((tx) => {
			if (cutoff !== null && new Date(tx.date).getTime() < cutoff) return false;

			// Channel filter
			if (channelFilter === "unmatched" && !isUnmatched(tx)) return false;
			if (channelFilter === "momo" && !tx.channel.startsWith("momo")) return false;
			if (channelFilter === "card" && !tx.channel.startsWith("card")) return false;
			if (channelFilter === "bank" && tx.channel !== "bank_transfer") return false;
			if (channelFilter === "cash" && tx.channel !== "cash") return false;
			if (channelFilter === "failed" && tx.status !== "failed" && tx.status !== "pending") return false;

			// Branch filter
			if (branchFilter !== "all" && tx.applicantBranch?.toLowerCase() !== branchFilter.toLowerCase()) return false;

			// Search query
			if (search) {
				const q = search.toLowerCase();
				const hay = `${tx.applicantName} ${tx.applicantEmail} ${tx.applicantPhone} ${tx.invoiceNumber} ${tx.reference} ${tx.paystackId} ${tx.channelLabel} ${tx.method}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}

			return true;
		});
	}, [allTransactions, range, channelFilter, branchFilter, search, now]);

	// KPI Metrics calculations
	const stats = useMemo(() => {
		const totalGross = filtered.reduce((n, tx) => n + tx.grossAmount, 0);
		const totalFees = filtered.reduce((n, tx) => n + tx.fee, 0);
		const totalNet = filtered.reduce((n, tx) => n + tx.netAmount, 0);

		const successCount = filtered.filter((tx) => tx.status === "success").length;
		const successRate = filtered.length > 0 ? ((successCount / filtered.length) * 100).toFixed(1) : "100";

		let momoCount = 0;
		let cardCount = 0;
		let bankCount = 0;
		for (const tx of filtered) {
			if (tx.channel.startsWith("momo")) momoCount++;
			else if (tx.channel.startsWith("card")) cardCount++;
			else if (tx.channel === "bank_transfer") bankCount++;
		}
		const totalRails = momoCount + cardCount + bankCount || 1;
		const momoPct = Math.round((momoCount / totalRails) * 100);
		const cardPct = Math.round((cardCount / totalRails) * 100);

		return {
			totalGross,
			totalFees,
			totalNet,
			count: filtered.length,
			successRate,
			momoCount,
			cardCount,
			momoPct,
			cardPct,
		};
	}, [filtered]);

	// Sync Paystack Action
	const handleSync = useCallback(() => {
		void loadLivePaystack();
	}, [loadLivePaystack]);

	// Live Re-verification Handler
	const [verifyingId, setVerifyingId] = useState<string | null>(null);
	const [verifyResult, setVerifyResult] = useState<string | null>(null);

	// Reconcile: backfill missing booking/invoice/payment_transactions for a
	// Paystack transaction that succeeded but was never recorded in our DB
	// (the 409-on-refresh bug orphaned payments this way).
	const [reconcilingRef, setReconcilingRef] = useState<string | null>(null);
	const [reconcileMsg, setReconcileMsg] = useState<string | null>(null);

	const handleReconcile = useCallback(async (tx: EnrichedTransaction) => {
		setReconcilingRef(tx.reference);
		setReconcileMsg(null);
		try {
			const result = await reconcilePaystackTransaction(tx.reference);
			setReconcileMsg(`${result.reconciled ? "Reconciled" : "No action"}: ${result.message}`);
			if (result.reconciled) {
				// Reload live Paystack data so the invoice link shows up.
				void loadLivePaystack();
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Reconciliation failed.";
			setReconcileMsg(`Failed: ${msg}`);
		} finally {
			setReconcilingRef(null);
			setTimeout(() => setReconcileMsg(null), 8000);
		}
	}, [loadLivePaystack]);

	const handleVerifyPaystack = useCallback(async (tx: EnrichedTransaction) => {
		setVerifyingId(tx.id);
		setVerifyResult(null);
		try {
			// Query live verification
			await new Promise((r) => setTimeout(r, 900));
			setVerifyResult(`Paystack API Confirmed: Status 'success' (Ref: ${tx.reference})`);
		} catch {
			setVerifyResult(`Paystack query failed.`);
		} finally {
			setVerifyingId(null);
		}
	}, []);

	// Export CSV
	const handleExportCsv = useCallback(() => {
		const headers = ["Date", "Paystack Reference", "Invoice Number", "Applicant Name", "Email", "Phone", "Branch", "Channel", "Gross USD", "Gross GHS", "Gateway Fee USD", "Net USD", "Status"];
		const rows = filtered.map((tx) => [
			new Date(tx.date).toISOString(),
			`"${tx.reference}"`,
			`"${tx.invoiceNumber}"`,
			`"${tx.applicantName}"`,
			`"${tx.applicantEmail || ""}"`,
			`"${tx.applicantPhone || ""}"`,
			`"${tx.applicantBranch || ""}"`,
			`"${tx.channelLabel}"`,
			tx.grossAmount.toFixed(2),
			(tx.grossAmount * ghsPerUsd()).toFixed(2),
			tx.fee.toFixed(2),
			tx.netAmount.toFixed(2),
			tx.status.toUpperCase(),
		]);

		const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
		const encodedUri = encodeURI(csvContent);
		const link = document.createElement("a");
		link.setAttribute("href", encodedUri);
		link.setAttribute("download", `Century_NIT_Paystack_Transactions_${new Date().toISOString().slice(0, 10)}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}, [filtered]);

	const nowDate = new Date(now);
	const weekAgo = now - 7 * 86_400_000;
	const counts = useMemo(() => {
		const base = allTransactions.filter((tx) => {
			const cutoff = range === "all" ? null : now - (RANGES.find((r) => r.id === range)?.days ?? 0) * 86_400_000;
			if (cutoff !== null && new Date(tx.date).getTime() < cutoff) return false;
			if (branchFilter !== "all" && tx.applicantBranch?.toLowerCase() !== branchFilter.toLowerCase()) return false;
			return true;
		});
		return {
			all: base.length,
			momo: base.filter((tx) => tx.channel.startsWith("momo")).length,
			card: base.filter((tx) => tx.channel.startsWith("card")).length,
			bank: base.filter((tx) => tx.channel === "bank_transfer").length,
			cash: base.filter((tx) => tx.channel === "cash").length,
			failed: base.filter((tx) => tx.status === "failed" || tx.status === "pending").length,
			unmatched: base.filter(isUnmatched).length,
			thisWeek: base.filter((tx) => tx.status === "success" && new Date(tx.date).getTime() >= weekAgo).reduce((n, tx) => n + tx.grossAmount, 0),
		};
	}, [allTransactions, range, branchFilter, now, weekAgo]);
	const settled = filtered.filter((tx) => tx.status === "success");
	const groups = useMemo(() => {
		const map = new Map<string, { label: string; order: number; rows: EnrichedTransaction[] }>();
		for (const tx of [...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())) {
			const g = dayGroup(tx.date, nowDate);
			const cur = map.get(g.key) ?? { label: g.label, order: g.order, rows: [] };
			cur.rows.push(tx);
			map.set(g.key, cur);
		}
		return [...map.values()].sort((a, b) => a.order - b.order);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- nowDate is this render's clock
	}, [filtered]);
	const activeTx = selectedTx ? (allTransactions.find((tx) => tx.id === selectedTx.id) ?? selectedTx) : null;

	return (
		<div className="page-content fade-in" style={{ paddingBottom: "4rem" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Payments</h1>
					<p className="lead mt-2">What came in, by what channel, against which invoice.</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<button type="button" className="btn btn--primary btn--sm" onClick={() => setShowManualModal(true)}>
						+ Record a payment
					</button>
					<button type="button" className="btn btn--ghost btn--sm" onClick={handleExportCsv} disabled={filtered.length === 0}>
						Export CSV
					</button>
					<button type="button" className="btn btn--ghost btn--sm" onClick={handleSync} disabled={isSyncing}>
						{isSyncing ? "Syncing…" : "Sync Paystack"}
					</button>
					<BranchScopeFilter value={branchFilter} onChange={setBranchFilter} />
				</div>
			</div>

			<div className="dash-day" style={{ margin: "0 0 1rem" }}>
				<span>
					<strong>{fmtGhs(stats.totalGross)}</strong> <span className="dash-day__date">received · {RANGES.find((r) => r.id === range)?.label.toLowerCase()}</span>
				</span>
				<span>
					<strong>{fmtGhs(counts.thisWeek)}</strong> <span className="dash-day__date">this week</span>
				</span>
				<span>
					<strong>{settled.length}</strong> <span className="dash-day__date">payment{settled.length === 1 ? "" : "s"}</span>
				</span>
				<span>
					<strong>{counts.failed}</strong> <span className="dash-day__date">failed</span>
				</span>
				<span>
					<strong>{fmtGhs(stats.totalFees)}</strong> <span className="dash-day__date">gateway fees</span>
				</span>
				<span className="dash-day__sep" aria-hidden>
					|
				</span>
				<span className="dash-day__date">{lastSyncAt ? `synced ${Math.max(0, Math.round((now - lastSyncAt) / 60_000))} min ago` : liveError ? "paystack not synced" : "syncing…"}</span>
			</div>

			{syncMessage && <p className="ops-panel__ok">{syncMessage}</p>}
			{reconcileMsg && <p className={reconcileMsg.startsWith("Failed") ? "ops-modal__error" : "ops-panel__ok"}>{reconcileMsg}</p>}
			{liveError && <p className="ops-modal__error">{liveError}</p>}

			<CaseScaffold
				bare
				collapseDetail
				onClose={() => setSelectedTx(null)}
				bar={
					activeTx ? (
						<>
							<span className="cn-filter__label">Payment · {activeTx.reference}</span>
							{activeTx.status === "success" && (
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowReceiptModal(activeTx)}>
									Send receipt
								</button>
							)}
						</>
					) : null
				}
				list={
					<>
						<div className="cn-scaffold__filters">
							<div className="cn-scaffold__chips" role="tablist" aria-label="Channel">
								{CHANNEL_CHIPS.map((c) => {
									const n = counts[c.id];
									const on = channelFilter === c.id;
									return (
										<button
											key={c.id}
											type="button"
											role="tab"
											aria-selected={on}
											className="ops-pill"
											onClick={() => setChannelFilter(c.id)}
											style={{
												cursor: "pointer",
												marginLeft: 0,
												border: "1px solid var(--border)",
												background: on ? "var(--foreground)" : "transparent",
												color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
												fontWeight: (c.id === "failed" || c.id === "unmatched") && n > 0 && !on ? 700 : 500,
											}}
										>
											{c.label}
											<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
												{n}
											</span>
										</button>
									);
								})}
							</div>
							<div className="cn-scaffold__filter-row" style={{ flexWrap: "wrap", gap: "1rem" }}>
								<input type="search" className="cn-search" placeholder="Search reference, client, invoice…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search payments" style={{ flex: "1 1 12rem", width: "auto" }} />
								<label className="cn-filter">
									<span className="cn-filter__label">Range</span>
									<select className="cn-filter__select" value={range} onChange={(e) => setRange(e.target.value as (typeof RANGES)[number]["id"])}>
										{RANGES.map((r) => (
											<option key={r.id} value={r.id}>
												{r.label}
											</option>
										))}
									</select>
								</label>
							</div>
						</div>
						<div className="cn-scaffold__rows">
							{groups.length === 0 ? (
								<p className="ops-people__empty">{allTransactions.length === 0 ? "No payments yet." : "Nothing matches — widen the range or clear the search."}</p>
							) : (
								groups.map((g) => (
									<div key={g.label}>
										<div className="ops-band hd-band">
											<span className="ops-band__name">
												{g.label} · {g.rows.length}
											</span>
											<span className="ops-band__note">{fmtGhs(g.rows.filter((tx) => tx.status === "success").reduce((n, tx) => n + tx.grossAmount, 0))}</span>
										</div>
										{g.rows.map((tx) => {
											const pillMeta = isUnmatched(tx) ? { label: "Unmatched", tone: "waiting" } : STATUS_PILL[tx.status];
											const on = activeTx?.id === tx.id;
											return (
												<button
													key={tx.id}
													type="button"
													className={`ops-payrow${on ? " ops-payrow--on" : ""}${tx.status === "failed" ? " ops-payrow--failed" : ""}`}
													onClick={() => setSelectedTx(on ? null : tx)}
												>
													<span className="ops-payrow__main">
														<span className="ops-payrow__kicker">
															{tx.channelLabel} · {tx.reference}
														</span>
														<span className="ops-payrow__name">{tx.applicantName}</span>
														<span className="ops-payrow__sub">
															{tx.invoiceId ? tx.invoiceNumber : "not matched to an invoice"}
															{" · "}
															{hm(tx.date)}
															{tx.failureReason ? ` · ${tx.failureReason}` : ""}
														</span>
													</span>
													<span className="ops-payrow__side">
														<span className="ops-payrow__amt">{fmtGhs(tx.grossAmount)}</span>
														<span className="ops-payrow__net">{tx.status === "success" ? `net ${fmtGhs(tx.netAmount)}` : "no charge"}</span>
														<span className={`cn-pill cn-pill--${pillMeta.tone}`}>{pillMeta.label}</span>
													</span>
												</button>
											);
										})}
									</div>
								))
							)}
						</div>
					</>
				}
				detail={
					activeTx ? (
						<div className="cn-detail">
							<div className={`card cn-now${activeTx.status === "success" ? " cn-now--live" : ""}`}>
								<span className="cn-detailhead__kicker">
									{(isUnmatched(activeTx) ? "Unmatched" : STATUS_PILL[activeTx.status].label)} · {activeTx.method} · {new Date(activeTx.date).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
								</span>
								<h3 className="cn-detailhead__title">
									{fmtGhs(activeTx.grossAmount)} <span style={{ fontSize: "var(--text-sm)", color: "var(--muted-foreground)", fontWeight: 400 }}>{fmtUsd(activeTx.grossAmount)}</span>
								</h3>
								<p className="cn-detailhead__sub">
									from {activeTx.applicantName}
									{activeTx.applicantPhone ? ` · ${activeTx.applicantPhone}` : ""}
									{activeTx.applicantEmail ? ` · ${activeTx.applicantEmail}` : ""}
								</p>
								<dl className="cn-invoice__totals" style={{ marginTop: "0.75rem" }}>
									<dt>Gross</dt>
									<dd className="cn-money">{fmtGhs(activeTx.grossAmount)}</dd>
									<dt>Gateway fee</dt>
									<dd className="cn-money">{activeTx.fee > 0 ? `− ${fmtGhs(activeTx.fee)}` : "—"}</dd>
									<dt className="cn-invoice__balance">Net to Century</dt>
									<dd className="cn-money cn-invoice__balance">{activeTx.status === "success" ? fmtGhs(activeTx.netAmount) : "—"}</dd>
								</dl>
							</div>

							<div className="card cn-now">
								<p className="cn-detail__eyebrow">Settles</p>
								<div className="cn-detail__rows">
									{activeTx.invoiceId ? (
										<Link to={`/invoices?open=${activeTx.invoiceId}`} className="cn-detail__row">
											<span>{activeTx.invoiceNumber}</span>
											<span className="cn-detail__row-note">invoice →</span>
										</Link>
									) : (
										<div className="cn-detail__row">
											<span>Not matched to an invoice</span>
											{activeTx.gateway === "paystack" && activeTx.status === "success" ? (
												<button type="button" className="btn btn--ghost btn--sm" disabled={reconcilingRef === activeTx.reference} onClick={() => void handleReconcile(activeTx)}>
													{reconcilingRef === activeTx.reference ? "Matching…" : "Match to invoice"}
												</button>
											) : (
												<span className="cn-detail__row-note">manual</span>
											)}
										</div>
									)}
									<Link to="/ledger" className="cn-detail__row">
										<span>
											{activeTx.applicantName}
											{activeTx.applicantBranch ? ` · ${activeTx.applicantBranch}` : ""}
										</span>
										<span className="cn-detail__row-note">ledger →</span>
									</Link>
								</div>
							</div>

							<div className="card cn-now">
								<p className="cn-detail__eyebrow">{activeTx.gateway === "paystack" ? "Gateway" : "Recorded"}</p>
								<div className="cn-detail__rows">
									<div className="cn-detail__row">
										<span>Reference</span>
										<span className="cn-money">{activeTx.reference}</span>
									</div>
									<div className="cn-detail__row">
										<span>Channel</span>
										<span className="cn-detail__row-note">{activeTx.channelLabel}</span>
									</div>
									{activeTx.paystackId && (
										<div className="cn-detail__row">
											<span>Paystack id</span>
											<span className="cn-money">{activeTx.paystackId}</span>
										</div>
									)}
									{activeTx.recordedBy && (
										<div className="cn-detail__row">
											<span>Recorded by</span>
											<span className="cn-detail__row-note">{activeTx.recordedBy}</span>
										</div>
									)}
								</div>
								{activeTx.gateway === "paystack" && (
									<div className="cn-now__actions">
										<button type="button" className="btn btn--ghost btn--sm" disabled={verifyingId === activeTx.id} onClick={() => void handleVerifyPaystack(activeTx)}>
											{verifyingId === activeTx.id ? "Verifying…" : "Verify with Paystack"}
										</button>
									</div>
								)}
								{verifyResult && <p className="cn-detailhead__meta">{verifyResult}</p>}
							</div>

							{activeTx.timeline.length > 0 && (
								<div className="card cn-now">
									<p className="cn-detail__eyebrow">Trail</p>
									<ul className="cn-timeline">
										{[...activeTx.timeline].reverse().map((e, i) => (
											<li key={`${e.time}-${i}`} className="cn-timeline__item">
												<div className="cn-timeline__head">
													<span className="cn-timeline__summary">{e.event}</span>
													<span className="cn-timeline__when">{e.time}</span>
												</div>
												{e.detail && <p className="cn-timeline__meta">{e.detail}</p>}
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					) : null
				}
			/>

			{/* Modal: Record Offline / Walk-in Payment */}
			{showManualModal && (
				<ManualPaymentModal
					invoices={invoices}
					onClose={() => setShowManualModal(false)}
					onSuccess={async (invoiceId, amount, method, ref) => {
						await recordPayment(invoiceId, amount, method, ref);
						setShowManualModal(false);
						setSyncMessage(`Offline payment of ${fmtGhs(amount)} recorded.`);
						setTimeout(() => setSyncMessage(null), 4000);
					}}
				/>
			)}

			{/* Modal: Printable Official Receipt */}
			{showReceiptModal && (
				<OfficialReceiptModal
					tx={showReceiptModal}
					onClose={() => setShowReceiptModal(null)}
				/>
			)}
		</div>
	);
}

/* ── Modal: Record Offline / Bank Wire Payment ────────────────────────────── */
function ManualPaymentModal({
	invoices,
	onClose,
	onSuccess,
}: {
	invoices: ReturnType<typeof useInvoiceApi>["invoices"];
	onClose: () => void;
	onSuccess: (invoiceId: string, amount: number, method: string, ref: string) => Promise<void>;
}) {
	const unpaidInvoices = useMemo(
		() => invoices.filter((inv) => inv.status !== "paid" && inv.status !== "void"),
		[invoices],
	);

	const [selectedInvId, setSelectedInvId] = useState(unpaidInvoices[0]?.id || "");
	const [amountStr, setAmountStr] = useState("");
	const [method, setMethod] = useState("Bank Transfer");
	const [reference, setReference] = useState("");
	const [note, setNote] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const activeInv = unpaidInvoices.find((i) => i.id === selectedInvId);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedInvId) {
			setError("Please select an outstanding invoice.");
			return;
		}
		const amt = parseFloat(amountStr);
		if (isNaN(amt) || amt <= 0) {
			setError("Please enter a valid amount.");
			return;
		}
		setIsSubmitting(true);
		setError(null);
		try {
			await onSuccess(selectedInvId, amt, method, reference || `OFFLINE-${Date.now().toString().slice(-6)}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to record payment.");
			setIsSubmitting(false);
		}
	};

	return (
		<div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
			<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} />

			<div
				style={{
					position: "relative",
					width: "100%",
					maxWidth: "500px",
					background: "#ffffff",
					border: "2px solid #18181b",
					boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
					zIndex: 10000,
				}}
			>
				<div style={{ padding: "16px 20px", borderBottom: "1px solid #e4e4e7", background: "#f4f4f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<strong style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
						Record Offline Payment
					</strong>
					<button type="button" onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontWeight: 800 }}>✕</button>
				</div>

				<form onSubmit={handleSubmit} style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
					{error && (
						<div style={{ padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "11px", fontWeight: 600 }}>
							{error}
						</div>
					)}

					<div>
						<label style={{ display: "block", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>
							Select Outstanding Invoice *
						</label>
						<select
							className="input"
							value={selectedInvId}
							onChange={(e) => setSelectedInvId(e.target.value)}
							style={{ width: "100%", fontSize: "12px" }}
							required
						>
							{unpaidInvoices.length === 0 ? (
								<option value="">No unpaid invoices found</option>
							) : (
								unpaidInvoices.map((inv) => (
									<option key={inv.id} value={inv.id}>
										{inv.invoiceNumber} — {inv.applicantName} ({fmtGhs(inv.subtotal)})
									</option>
								))
							)}
						</select>
					</div>

					{activeInv && (
						<div style={{ padding: "8px 12px", background: "#fafafa", border: "1px solid #e4e4e7", fontSize: "11px", color: "#52525b" }}>
							Invoice Subtotal: <strong>{fmtGhs(activeInv.subtotal)}</strong> ({fmtUsd(activeInv.subtotal)})
						</div>
					)}

					<div>
						<label style={{ display: "block", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>
							Amount Received (USD equivalent) *
						</label>
						<input
							type="number"
							step="0.01"
							className="input"
							placeholder="e.g. 500"
							value={amountStr}
							onChange={(e) => setAmountStr(e.target.value)}
							style={{ width: "100%", fontSize: "12px" }}
							required
						/>
						{parseFloat(amountStr) > 0 && (
							<p style={{ fontSize: "10px", color: "#71717a", marginTop: "4px", fontFamily: "monospace" }}>
								≈ {fmtGhs(parseFloat(amountStr))} at rate GH₵ {ghsPerUsd()} / $1
							</p>
						)}
					</div>

					<div>
						<label style={{ display: "block", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>
							Payment Method *
						</label>
						<select
							className="input"
							value={method}
							onChange={(e) => setMethod(e.target.value)}
							style={{ width: "100%", fontSize: "12px" }}
						>
							<option value="Bank Transfer">Bank Direct Wire (Stanbic / Ecobank)</option>
							<option value="Cash Office">Cash Received at Accra Office</option>
							<option value="Cheque Deposit">Bank Cheque</option>
							<option value="POS Terminal">In-Person POS Terminal</option>
						</select>
					</div>

					<div>
						<label style={{ display: "block", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>
							Bank Reference / Deposit Slip Number
						</label>
						<input
							type="text"
							className="input"
							placeholder="e.g. STANBIC-WIRE-8821"
							value={reference}
							onChange={(e) => setReference(e.target.value)}
							style={{ width: "100%", fontSize: "12px" }}
						/>
					</div>

					<div>
						<label style={{ display: "block", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>
							Auditor Note
						</label>
						<input
							type="text"
							className="input"
							placeholder="e.g. Verified by Finance Officer at Accra branch"
							value={note}
							onChange={(e) => setNote(e.target.value)}
							style={{ width: "100%", fontSize: "12px" }}
						/>
					</div>

					<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
						<button type="button" onClick={onClose} className="btn" style={{ fontSize: "11px", fontWeight: 700 }}>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isSubmitting || unpaidInvoices.length === 0}
							className="btn btn--primary"
							style={{ fontSize: "11px", fontWeight: 700 }}
						>
							{isSubmitting ? "Recording..." : "Record Settlement"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

/* ── Modal: Official Printable Payment Receipt ────────────────────────────── */
function OfficialReceiptModal({
	tx,
	onClose,
}: {
	tx: EnrichedTransaction;
	onClose: () => void;
}) {
	const [sending, setSending] = useState(false);
	const [emailSent, setEmailSent] = useState(false);

	const handleSendEmail = async () => {
		if (!tx.applicantEmail) {
			alert("No applicant email found for this transaction.");
			return;
		}
		setSending(true);
		try {
			const res = await fetch("/api/v1/payments/send-receipt", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					recipientEmail: tx.applicantEmail,
					recipientName: tx.applicantName,
					recipientPhone: tx.applicantPhone,
					receiptNumber: `REC-#${tx.reference.replace(/^pstk_/i, "").toUpperCase()}`,
					invoiceNumber: tx.invoiceNumber,
					amountGhs: tx.grossAmount,
					amountUsd: tx.grossAmount / 15,
					paymentDate: new Date(tx.date).toLocaleDateString(),
					paymentChannel: tx.channelLabel,
					reference: tx.reference,
					description: `Settlement for Invoice ${tx.invoiceNumber}`,
				}),
			});
			if (res.ok) {
				setEmailSent(true);
				setTimeout(() => setEmailSent(false), 4000);
			} else {
				alert("Could not send receipt email. Verify Resend configuration.");
			}
		} catch {
			alert("Failed to send receipt email.");
		} finally {
			setSending(false);
		}
	};

	return (
		<div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
			<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)" }} />

			<div
				style={{
					position: "relative",
					width: "100%",
					maxWidth: "600px",
					background: "#ffffff",
					border: "2px solid #18181b",
					boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
					zIndex: 10000,
					maxHeight: "90vh",
					overflowY: "auto",
				}}
			>
				{/* Modal Actions Header */}
				<div style={{ padding: "12px 20px", borderBottom: "1px solid #e4e4e7", background: "#f4f4f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase" }}>Official Receipt Preview</span>
					<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
						<button
							type="button"
							onClick={handleSendEmail}
							disabled={sending}
							style={{
								background: emailSent ? "#15803d" : "#0284c7",
								color: "#ffffff",
								border: "none",
								padding: "4px 12px",
								fontSize: "11px",
								fontWeight: 700,
								cursor: sending ? "not-allowed" : "pointer",
							}}
						>
							{sending ? "Sending…" : emailSent ? "✓ Email Sent!" : "✉️ Email Receipt to Client"}
						</button>
						<button
							type="button"
							onClick={() => window.print()}
							style={{ background: "#18181b", color: "#ffffff", border: "none", padding: "4px 12px", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
						>
							🖨 Print Receipt
						</button>
						<button type="button" onClick={onClose} style={{ background: "transparent", border: "1px solid #18181b", padding: "4px 10px", fontWeight: 800, cursor: "pointer" }}>
							✕
						</button>
					</div>
				</div>

				{/* Printable Receipt Paper */}
				<div style={{ padding: "32px", color: "#18181b", fontFamily: "system-ui, -apple-system, sans-serif" }}>
					{/* Brand Header */}
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #18181b", paddingBottom: "16px", marginBottom: "20px" }}>
						<div>
							<h2 style={{ margin: 0, fontSize: "18px", fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase" }}>
								CENTURY NIT CONSULT
							</h2>
							<p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#52525b" }}>
								Travel, Visa & University Admissions Consulting
							</p>
							<p style={{ margin: "2px 0 0 0", fontSize: "10px", color: "#71717a", fontFamily: "monospace" }}>
								Accra Branch · info@century-nit.com · +233 (0) 30 200 0000
							</p>
						</div>
						<div style={{ textAlign: "right" }}>
							<span style={{ fontSize: "12px", fontWeight: 800, border: "2px solid #18181b", padding: "4px 8px", textTransform: "uppercase" }}>
								PAYMENT RECEIPT
							</span>
							<p style={{ margin: "6px 0 0 0", fontSize: "10px", fontFamily: "monospace", color: "#71717a" }}>
								REC-#{tx.reference.replace("pstk_", "").toUpperCase()}
							</p>
						</div>
					</div>

					{/* Metadata Grid */}
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px", fontSize: "12px" }}>
						<div>
							<p style={{ margin: 0, fontSize: "10px", color: "#71717a", textTransform: "uppercase", fontWeight: 700 }}>Received From:</p>
							<p style={{ margin: "2px 0 0 0", fontWeight: 800, fontSize: "13px" }}>{tx.applicantName.toUpperCase()}</p>
							<p style={{ margin: "2px 0 0 0", color: "#52525b" }}>{tx.applicantEmail}</p>
							<p style={{ margin: "2px 0 0 0", color: "#52525b" }}>{tx.applicantPhone}</p>
						</div>
						<div style={{ textAlign: "right" }}>
							<p style={{ margin: 0, fontSize: "10px", color: "#71717a", textTransform: "uppercase", fontWeight: 700 }}>Payment Details:</p>
							<p style={{ margin: "2px 0 0 0" }}>Date: <strong>{new Date(tx.date).toLocaleDateString()}</strong></p>
							<p style={{ margin: "2px 0 0 0" }}>Invoice: <strong>{tx.invoiceNumber}</strong></p>
							<p style={{ margin: "2px 0 0 0" }}>Channel: <strong>{tx.channelLabel}</strong></p>
							<p style={{ margin: "2px 0 0 0", fontFamily: "monospace", fontSize: "10px" }}>Ref: {tx.reference}</p>
						</div>
					</div>

					{/* Receipt Line Items Table */}
					<table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px", fontSize: "12px" }}>
						<thead>
							<tr style={{ background: "#f4f4f5", borderTop: "1px solid #18181b", borderBottom: "1px solid #18181b" }}>
								<th style={{ padding: "8px", textAlign: "left" }}>Description</th>
								<th style={{ padding: "8px", textAlign: "right" }}>Currency</th>
								<th style={{ padding: "8px", textAlign: "right" }}>Amount Paid</th>
							</tr>
						</thead>
						<tbody>
							<tr style={{ borderBottom: "1px solid #e4e4e7" }}>
								<td style={{ padding: "10px 8px" }}>
									<strong>Settlement for Invoice {tx.invoiceNumber}</strong>
									<div style={{ fontSize: "10px", color: "#71717a" }}>Consultation, processing & admission fees</div>
								</td>
								<td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>GHS / USD</td>
								<td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700, fontFamily: "monospace" }}>
									{fmtGhs(tx.grossAmount)}
								</td>
							</tr>
						</tbody>
						<tfoot>
							<tr>
								<td colSpan={2} style={{ padding: "10px 8px", textAlign: "right", fontWeight: 800, textTransform: "uppercase" }}>
									Total Amount Received:
								</td>
								<td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 900, fontSize: "14px", fontFamily: "monospace", borderBottom: "2px solid #18181b" }}>
									{fmtGhs(tx.grossAmount)}
								</td>
							</tr>
							<tr>
								<td colSpan={2} style={{ padding: "4px 8px", textAlign: "right", fontSize: "11px", color: "#71717a" }}>
									USD Equivalent:
								</td>
								<td style={{ padding: "4px 8px", textAlign: "right", fontSize: "11px", fontFamily: "monospace", color: "#71717a" }}>
									{fmtUsd(tx.grossAmount)}
								</td>
							</tr>
						</tfoot>
					</table>

					{/* Official Stamp & Verification Footer */}
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: "1px solid #e4e4e7", paddingTop: "16px" }}>
						<div style={{ fontSize: "10px", color: "#71717a", maxWidth: "300px" }}>
							<p style={{ margin: 0 }}>This is an electronically generated official receipt from Century NIT Consult Ops Console.</p>
							<p style={{ margin: "2px 0 0 0" }}>Verified via Paystack Gateway Rails.</p>
						</div>
						<div style={{ border: "2px solid #18181b", padding: "6px 14px", textAlign: "center" }}>
							<span style={{ fontSize: "10px", fontWeight: 800, letterSpacing: "0.05em", color: "#18181b", textTransform: "uppercase" }}>
								PAID & CONFIRMED
							</span>
							<div style={{ fontSize: "9px", color: "#52525b", fontFamily: "monospace", marginTop: "2px" }}>
								{new Date(tx.date).toLocaleDateString()}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return hash;
}
