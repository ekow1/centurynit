import { INVOICE_STATUS_LABELS, TRAVEL_STATUS_LABELS, VISA_STAGE_LABELS } from "century-nit-shared";

/**
 * The five things a status can mean. Every pill in either app is one of
 * these; the words come from the shared vocabulary, the colour from the tone.
 */
export type Tone = "neutral" | "done" | "current" | "waiting" | "blocked" | "void";

export function StatusPill({ tone = "neutral", children, dot = false }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
	return (
		<span className={`cn-pill cn-pill--${tone}`}>
			{dot && <span className="cn-pill__dot" aria-hidden />}
			{children}
		</span>
	);
}

/* ── Tone maps: one place decides what colour a status is ────────────────── */

export function invoiceTone(status: string): Tone {
	switch (status) {
		case "paid": return "done";
		case "issued": return "current";
		case "partial": return "current";
		case "proforma": return "waiting";
		case "overdue": return "blocked";
		case "void": return "void";
		default: return "neutral";
	}
}

export function journeyTone(status: "done" | "current" | "locked" | "skipped"): Tone {
	return status === "done" ? "done" : status === "current" ? "current" : status === "skipped" ? "blocked" : "neutral";
}

export function visaTone(stage: string): Tone {
	return stage === "complete" ? "done" : stage === "awaiting_handler" ? "waiting" : stage === "locked" ? "neutral" : "current";
}

export function travelTone(status: string): Tone {
	switch (status) {
		case "cleared": case "booked": case "ticket_paid": return "done";
		case "invoiced": return "current";
		case "review": case "quote_prepared": case "quote_approved": case "decision_pending": return "waiting";
		case "on_hold": return "neutral";
		case "declined": return "void";
		default: return "neutral";
	}
}

/** Convenience pills that pair the shared label with its tone. */
export function InvoiceStatusPill({ status }: { status: string }) {
	return <StatusPill tone={invoiceTone(status)}>{INVOICE_STATUS_LABELS[status] ?? status}</StatusPill>;
}
export function VisaStagePill({ stage }: { stage: string }) {
	return <StatusPill tone={visaTone(stage)}>{VISA_STAGE_LABELS[stage] ?? stage}</StatusPill>;
}
export function TravelStatusPill({ status }: { status: string }) {
	return <StatusPill tone={travelTone(status)}>{TRAVEL_STATUS_LABELS[status] ?? status}</StatusPill>;
}
