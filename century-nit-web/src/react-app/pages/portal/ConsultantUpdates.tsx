import type { CaseComment } from "century-nit-shared";

/**
 * The case history the consultant marked for the client — the visa
 * milestones as they are recorded, the decision and its reason, a note
 * written for the client. The same lines Ops sees in the case History,
 * filtered server-side to the applicant-visible ones. Newest first; a
 * multi-line entry (a stage move plus the facts recorded with it) keeps
 * its lines.
 */
export function ConsultantUpdates({
	comments,
	title = "Updates from your consultant",
	limit,
	filter,
	className = "",
}: {
	comments: CaseComment[];
	title?: string;
	/** Show only the most recent N. */
	limit?: number;
	/** Narrow to one chapter's entries (e.g. visa lines). */
	filter?: (c: CaseComment) => boolean;
	className?: string;
}) {
	let list = filter ? comments.filter(filter) : comments;
	list = [...list].sort((a, b) => b.at.localeCompare(a.at));
	if (limit) list = list.slice(0, limit);
	if (list.length === 0) return null;
	return (
		<div className={`card card--pad ${className}`.trim()}>
			<p className="eyebrow mb-2">{title}</p>
			<ol className="cn-timeline">
				{list.map((cm) => (
					<li key={cm.id} className="cn-timeline__item">
						<div className="cn-timeline__head">
							<span className="cn-timeline__summary">{cm.author}</span>
							<time className="cn-timeline__when" dateTime={cm.at}>
								{new Date(cm.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
							</time>
						</div>
						<p className="cn-timeline__detail" style={{ whiteSpace: "pre-line" }}>
							{cm.text}
						</p>
					</li>
				))}
			</ol>
		</div>
	);
}

/** Visa-chapter lines — what the officer records as the application moves. */
export const isVisaUpdate = (c: CaseComment) => /^visa\b|^biometrics\b|^passport \/ permit/i.test(c.text);
