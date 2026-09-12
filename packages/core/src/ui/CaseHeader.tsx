import { JOURNEY_STAGE_LABELS, PORTAL_STAGE_LABELS } from "century-nit-shared";
import { StatusPill } from "./StatusPill.js";

/**
 * The top of every case view, in ops and in the portal: who, which case,
 * where they are (the applicant's own step — the same `deriveJourney`
 * answer the portal shows, so support and applicant use the same words),
 * and who is handling it. Pages add their stage-specific body under it.
 */
export function CaseHeader({
	name,
	reference,
	branch,
	stage,
	portalStage,
	handlerName,
	stageHandlers,
	contact,
	extra,
	children,
}: {
	name: string;
	/** APP-2026-0001 / CNS-… */
	reference?: string | null;
	branch?: string | null;
	/** Coarse ops stage (JourneyStage). */
	stage?: string | null;
	/** The applicant's step (portal stage id). */
	portalStage?: string | null;
	handlerName?: string | null;
	/** Stage specialists on the case (visa officer, travel desk…), shown as chips. */
	stageHandlers?: { stage: string; name: string }[];
	/** Applicant contact — shown as mailto / tel links. */
	contact?: { email?: string | null; phone?: string | null };
	/** Small facts to append (country, programme…). */
	extra?: { label: string; value: React.ReactNode }[];
	/** Right-hand slot — an AssignControl, an action button. */
	children?: React.ReactNode;
}) {
	return (
		<div className="cn-case">
			<div className="cn-case__top">
				<h2 className="cn-case__name">{name}</h2>
				{reference && <span className="cn-case__ref">{reference}</span>}
				{portalStage && <StatusPill tone="current" dot>{PORTAL_STAGE_LABELS[portalStage] ?? portalStage}</StatusPill>}
			</div>
			<div className="cn-case__facts">
				{stage && <span>Stage <strong>{JOURNEY_STAGE_LABELS[stage as keyof typeof JOURNEY_STAGE_LABELS] ?? stage}</strong></span>}
				{branch && <span>Branch <strong>{branch}</strong></span>}
				<span>Handler <strong>{handlerName ?? "Unassigned"}</strong></span>
				{stageHandlers?.map((h) => (
					<span key={h.stage}>
						{JOURNEY_STAGE_LABELS[h.stage as keyof typeof JOURNEY_STAGE_LABELS] ?? h.stage} <strong>{h.name}</strong>
					</span>
				))}
				{extra?.map((f) => (
					<span key={f.label}>{f.label} <strong>{f.value}</strong></span>
				))}
			</div>
			{(contact?.email || contact?.phone) && (
				<div className="cn-case__contact">
					{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
					{contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
				</div>
			)}
			{children}
		</div>
	);
}
