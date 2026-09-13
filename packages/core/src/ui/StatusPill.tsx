import {
	INVOICE_STATUS_LABELS,
	SCHOOL_OUTCOME_LABELS,
	SCHOOL_TRACK_STATUS_LABELS,
	TRAVEL_STATUS_LABELS,
	VISA_STAGE_LABELS,
	type SchoolOutcome,
	type SchoolTrackStatus,
} from "century-nit-shared";

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
		case "booked": return "done";
		case "invoiced": case "ticket_paid": return "current";
		case "review": case "decision_pending": return "waiting";
		case "on_hold": return "neutral";
		case "declined": return "void";
		default: return "neutral";
	}
}

/**
 * A school application's state in one word: the outcome once decided,
 * otherwise where it is in the track.
 */
export function schoolTone(status: string, outcome?: string | null): Tone {
	if (status === "Decision Reached") {
		switch (outcome) {
			case "Admitted": return "done";
			case "Waitlisted": return "waiting";
			case "Application Rejected": case "Withdrawn": return "void";
			default: return "neutral";
		}
	}
	return status === "Submitted" ? "current" : "neutral";
}
export function schoolStateLabel(status: string, outcome?: string | null): string {
	if (status === "Decision Reached" && outcome) return SCHOOL_OUTCOME_LABELS[outcome as SchoolOutcome] ?? outcome;
	return SCHOOL_TRACK_STATUS_LABELS[status as SchoolTrackStatus] ?? status;
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
export function SchoolStatePill({ status, outcome }: { status: string; outcome?: string | null }) {
	return <StatusPill tone={schoolTone(status, outcome)}>{schoolStateLabel(status, outcome)}</StatusPill>;
}
