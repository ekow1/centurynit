import React from "react";
import { JOURNEY_STAGE_LABELS, PORTAL_STAGE_LABELS, STAGE_OWNER_LABELS } from "century-nit-shared";
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
	handlerAction,
	stageHandlers,
	contact,
	extra,
	actions,
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
	/**
	 * The one control that changes the handler — an "Assign" / "Change"
	 * button beside the name. Assignment lives here and nowhere else in the
	 * detail, so staff always look in the same place for it.
	 */
	handlerAction?: React.ReactNode;
	/** Chapter officers on the case (visa officer, travel officer…), each with their title. */
	stageHandlers?: { stage: string; name: string }[];
	/** Applicant contact — shown as mailto / tel links. */
	contact?: { email?: string | null; phone?: string | null };
	/** Small facts to append (country, programme…). */
	extra?: { label: string; value: React.ReactNode }[];
	/** Top-right slot — case-level buttons (History, links) that are not stage work. */
	actions?: React.ReactNode;
	/** Below the facts — a stage-specific body. */
	children?: React.ReactNode;
}) {
	return (
		<div className="cn-case">
			<div className="cn-case__top">
				<h2 className="cn-case__name">{name}</h2>
				{reference && <span className="cn-case__ref">{reference}</span>}
				{portalStage && <StatusPill tone="current" dot>{PORTAL_STAGE_LABELS[portalStage] ?? portalStage}</StatusPill>}
				{actions && <div className="cn-case__actions">{actions}</div>}
			</div>
			<dl className="cn-case__facts" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 1rem", margin: 0 }}>
				{stage && <><dt className="muted" style={{ fontSize: "0.85rem" }}>Stage</dt><dd style={{ margin: 0 }}><strong>{JOURNEY_STAGE_LABELS[stage as keyof typeof JOURNEY_STAGE_LABELS] ?? stage}</strong></dd></>}
				{branch && <><dt className="muted" style={{ fontSize: "0.85rem" }}>Branch</dt><dd style={{ margin: 0 }}><strong>{branch}</strong></dd></>}
				<dt className="muted" style={{ fontSize: "0.85rem" }}>Consultant</dt>
				<dd style={{ margin: 0 }} className="cn-case__handler">
					<strong>{handlerName ?? "Unassigned"}</strong>
					{handlerAction}
				</dd>
				{stageHandlers?.map((h) => (
					<React.Fragment key={h.stage}>
						<dt className="muted" style={{ fontSize: "0.85rem" }}>{STAGE_OWNER_LABELS[h.stage] ?? JOURNEY_STAGE_LABELS[h.stage as keyof typeof JOURNEY_STAGE_LABELS] ?? h.stage}</dt>
						<dd style={{ margin: 0 }}><strong>{h.name}</strong></dd>
					</React.Fragment>
				))}
				{extra?.map((f) => (
					<React.Fragment key={f.label}>
						<dt className="muted" style={{ fontSize: "0.85rem" }}>{f.label}</dt>
						<dd style={{ margin: 0 }}><strong>{f.value}</strong></dd>
					</React.Fragment>
				))}
			</dl>
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
