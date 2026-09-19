/**
 * Real-time domain event contract — every refresh signal the API publishes
 * over SSE (`/api/v1/events/stream`).
 *
 * Domain events are pure refresh signals: they write no notification row,
 * queue no push, send no email — they exist to move screens. Payloads carry
 * entity ids so clients can invalidate just the affected slice instead of
 * refetching everything.
 *
 * Declared as a TypeScript union rather than a zod schema (same convention as
 * `ChatRealtimeEvent`): these are server-authored and trusted; there is no
 * untrusted boundary to validate. `emitDomain` in the API types its `type`
 * parameter against `DomainEvent["type"]`, so emitting an undeclared event is
 * a compile error — adding a variant here forces the decision of how each
 * client should react.
 *
 * Audiences are decided at emit time: `{ userId }` targets the applicant's
 * personal channel, `{ ops: true }` broadcasts to every connected console.
 */
export type DomainEvent =
	| {
			type: "case.updated";
			caseId: string;
			appNumber?: string;
			stage?: string;
			actor?: string;
	  }
	| {
			type: "document.uploaded" | "document.updated";
			documentId: string;
			ownerUserId?: string;
			documentType?: string;
			status?: string;
	  }
	| {
			type: "handoff.opened" | "handoff.resolved" | "handoff.updated";
			handoffId: string;
			applicationId?: string;
			stage?: string;
	  }
	| {
			type: "lead.created" | "lead.updated";
			leadId: string;
			stage?: string | null;
			name?: string;
			source?: string;
			touched?: boolean;
			deleted?: boolean;
	  }
	| {
			type: "school.updated";
			schoolId: string;
			applicationId?: string | null;
			universityName?: string | null;
			accepted?: boolean;
	  }
	| {
			type: "consent.decided";
			consentId: string;
			applicationId?: string;
			stage?: string;
			decision?: string;
	  }
	| {
			type: "task.created" | "task.updated";
			taskId: string;
			leadId?: string | null;
			applicationId?: string | null;
			done?: boolean;
	  }
	| {
			type: "travel.updated";
			requestId: string;
			applicationId?: string;
			status?: string;
	  }
	| {
			type: "invoice.updated" | "payment.recorded";
			invoiceId: string;
			invoiceNumber?: string;
			invoiceType?: string;
			status?: string;
			applicationId?: string | null;
	  }
	| {
			type:
				| "booking.created"
				| "booking.assigned"
				| "booking.rescheduled"
				| "booking.reschedule_requested"
				| "booking.cancelled"
				| "booking.updated";
			bookingId: string;
			reference?: string;
			status?: string;
	  }
	| {
			type: "consultation.created" | "consultation.updated";
			consultationId: string;
			reference?: string;
			status?: string;
	  };

export type DomainEventType = DomainEvent["type"];
