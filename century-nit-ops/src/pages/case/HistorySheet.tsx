import { useState } from "react";
import { JOURNEY_STAGE_LABELS, type CommentVisibility } from "century-nit-shared";
import { COMMENT_KIND_LABELS, type CommentKind } from "century-nit-core/ops";
import { Sheet, StatusPill } from "century-nit-core/ui";
import { timeAgo } from "../../lib/pendingTasks";

const POSTABLE_KINDS: CommentKind[] = ["comment", "recommendation", "status"];

/** One line of a case's history — what both timelines (application, consultation) reduce to. */
export type HistoryEvent = {
	id: string;
	at: string;
	summary: string;
	detail?: string | null;
	actorName?: string | null;
	stage?: string | null;
	visibility?: CommentVisibility | null;
};

/**
 * The case's one history surface: the timeline the API assembles from every
 * table that records the case (notes, assignments, handoffs, consents,
 * invoices, payments, school and travel moves), with the note composer at
 * the top. It is a log, not a chapter, so it opens from the header rather
 * than sitting among the stage tabs.
 *
 * A note is staff-only unless the author says the applicant may read it;
 * the flag is stored with the note and the portal only ever receives the
 * applicant-visible ones.
 */
export function HistorySheet({
	open,
	onClose,
	events,
	loading,
	canPost,
	actor,
	onPost,
	emptyText = "Nothing recorded on this case yet.",
}: {
	open: boolean;
	onClose: () => void;
	events: HistoryEvent[];
	loading: boolean;
	canPost: boolean;
	actor: string;
	onPost: (kind: CommentKind, text: string, visibility: CommentVisibility) => Promise<unknown>;
	emptyText?: string;
}) {
	const [kind, setKind] = useState<CommentKind>("comment");
	const [visibility, setVisibility] = useState<CommentVisibility>("internal");
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function post() {
		if (!text.trim()) return;
		setBusy(true);
		setError(null);
		try {
			await onPost(kind, text.trim(), visibility);
			setText("");
			setVisibility("internal");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not post the note");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Sheet open={open} onClose={onClose} title="Case history" size="tall">
			{canPost ? (
				<form
					className="cn-assign"
					style={{ marginBottom: "1rem" }}
					onSubmit={(e) => {
						e.preventDefault();
						void post();
					}}
				>
					<div className="cn-assign__row">
						<select
							className="select input input--sm"
							value={kind}
							onChange={(e) => setKind(e.target.value as CommentKind)}
							disabled={busy}
							aria-label="Note kind"
							style={{ flex: "0 1 11rem", minWidth: "9rem" }}
						>
							{POSTABLE_KINDS.map((k) => (
								<option key={k} value={k}>
									{COMMENT_KIND_LABELS[k]}
								</option>
							))}
						</select>
						<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "var(--text-sm)" }}>
							<input
								type="checkbox"
								checked={visibility === "applicant"}
								onChange={(e) => setVisibility(e.target.checked ? "applicant" : "internal")}
								disabled={busy}
							/>
							Applicant can read this
						</label>
					</div>
					<textarea
						className="input"
						rows={3}
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder={visibility === "applicant" ? "A message the applicant will see in their portal…" : `Staff-only note as ${actor}…`}
						disabled={busy}
					/>
					<div className="cn-assign__row">
						<button type="submit" className="btn btn--primary btn--sm" disabled={busy || !text.trim()}>
							{busy ? "Posting…" : visibility === "applicant" ? "Post to applicant" : "Post note"}
						</button>
						{error && <p className="cn-assign__error">{error}</p>}
					</div>
				</form>
			) : (
				<p className="muted mb-3" style={{ fontSize: "var(--text-xs)" }}>
					Read-only — this case is not assigned to you.
				</p>
			)}

			<div className="cn-case__top">
				<h3 style={{ fontSize: "var(--text-sm)", fontWeight: 600, margin: 0 }}>Timeline</h3>
				<span className="cn-case__ref">{events.length} events</span>
			</div>
			{loading ? (
				<p className="muted">Loading timeline…</p>
			) : events.length === 0 ? (
				<p className="muted">{emptyText}</p>
			) : (
				<ol className="cn-timeline">
					{events.map((e) => (
						<li key={e.id} className="cn-timeline__item">
							<div className="cn-timeline__head">
								<span className="cn-timeline__summary">
									{e.summary}
									{e.visibility === "applicant" && (
										<>
											{" "}
											<StatusPill tone="current">Applicant sees this</StatusPill>
										</>
									)}
								</span>
								<time className="cn-timeline__when" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
									{timeAgo(e.at)}
								</time>
							</div>
							{(e.actorName || e.stage) && (
								<p className="cn-timeline__meta">
									{e.actorName}
									{e.actorName && e.stage ? " · " : ""}
									{e.stage ? (JOURNEY_STAGE_LABELS[e.stage as keyof typeof JOURNEY_STAGE_LABELS] ?? e.stage) : ""}
								</p>
							)}
							{e.detail && <p className="cn-timeline__detail">{e.detail}</p>}
						</li>
					))}
				</ol>
			)}
		</Sheet>
	);
}
