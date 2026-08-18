import { useState } from "react";
import {
	COMMENT_KIND_LABELS,
	branchName,
	type Assignee,
	type CaseComment,
	type CommentKind,
} from "century-nit-core/ops";
import { ReschedulePanel } from "./ReschedulePanel";

/**
 * Shown above the detail tabs on a case drawer.
 *
 * The manager sees routing controls; the assigned consultant sees the actions
 * they are allowed to take. Anyone else gets the record read-only - which is
 * the whole point of the access model.
 */
export function CaseWorkPanel({
	assignedName,
	assignedEmail,
	comments,
	requestedDocuments,
	canAssign,
	isMine,
	actor,
	kind,
	closedNote,
	onAssign,
	onComment,
	onRequestDocs,
	onReschedule,
	branchLabel = "",
	currentWhen = "",
	assignees = [],
}: {
	assignedName: string;
	assignedEmail: string;
	comments: CaseComment[];
	requestedDocuments: string[];
	canAssign: boolean;
	isMine: boolean;
	actor: string;
	/** Consultations can be rescheduled; application cases cannot. */
	kind: "consultation" | "application";
	/** Slot context for rescheduling — required when `onReschedule` is given. */
	branchLabel?: string;
	currentWhen?: string;
	/**
	 * Why this case is locked, when the reason is the case's own state rather
	 * than the viewer's access - e.g. a completed consultation. Without this a
	 * manager looking at a closed case was told "not assigned to you", which is
	 * both untrue and not the reason they cannot act.
	 */
	closedNote?: string;
	onAssign: (to: Assignee) => void;
	onComment: (kind: CommentKind, text: string) => void;
	onRequestDocs: (docs: string[]) => void;
	onReschedule?: (date: string, time: string, reason: string) => void;
	/** Staff the manager can route this case to. Defaults to the seed roster. */
	assignees?: Assignee[];
}) {
	const [comment, setComment] = useState("");
	const [commentKind, setCommentKind] = useState<CommentKind>("comment");
	const [docs, setDocs] = useState("");
	const [open, setOpen] = useState<"none" | "docs" | "reschedule">("none");

	const assigned = Boolean(assignedName);
	const canWork = isMine || canAssign;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
			{/* Assignment */}
			<div
				className="card"
				style={{
					background: assigned ? "var(--muted)" : "var(--foreground)",
					color: assigned ? "inherit" : "var(--background)",
				}}
			>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
					<div>
						<p className="eyebrow" style={{ color: assigned ? undefined : "var(--muted)" }}>
							Assignment
						</p>
						<p style={{ fontWeight: 600, marginTop: "0.2rem" }}>
							{assigned
								? assignedName
								: closedNote
									? "Not assigned"
									: canAssign
										? "Unassigned - pick a consultant to begin"
										: "Unassigned - awaiting the manager"}
						</p>
						{assigned && (
							<p style={{ fontSize: "var(--text-xs)", opacity: 0.7 }}>{assignedEmail}</p>
						)}
					</div>

					{canAssign ? (
						<select
							className="input input--sm"
							value={assignedEmail}
							onChange={(e) => {
								const to = assignees.find((c) => c.email === e.target.value);
								if (to) onAssign(to);
							}}
							style={{ minWidth: "210px", color: "var(--foreground)" }}
						>
							<option value="">Assign to…</option>
							{assignees.map((c) => (
								<option key={c.email} value={c.email}>
									{c.name} · {branchName(c.branch)}
								</option>
							))}
						</select>
					) : (
						<span
							className="portal-pill"
							style={{
								fontSize: "var(--text-xs)",
								whiteSpace: "nowrap",
								// Explicit: .portal-pill's white background inherited the dark
								// card's white text, rendering as an empty white box
								background: "var(--background)",
								color: "var(--foreground)",
								borderColor: "var(--foreground)",
							}}
						>
							{closedNote ? "Closed" : isMine ? "Assigned to you" : "Not assigned to you"}
						</span>
					)}
				</div>
			</div>

			{canWork ? (
				<div className="card">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", gap: "0.5rem", flexWrap: "wrap" }}>
						<p className="eyebrow">Case actions</p>
						<div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
							<button
								type="button"
								className={`btn btn--sm ${open === "docs" ? "btn--primary" : "btn--ghost"}`}
								onClick={() => setOpen(open === "docs" ? "none" : "docs")}
							>
								Request documents
							</button>
							{kind === "consultation" && onReschedule && (
								<button
									type="button"
									className={`btn btn--sm ${open === "reschedule" ? "btn--primary" : "btn--ghost"}`}
									onClick={() => setOpen(open === "reschedule" ? "none" : "reschedule")}
								>
									Reschedule
								</button>
							)}
						</div>
					</div>

					{open === "docs" && (
						<div style={{ marginBottom: "1rem" }}>
							<textarea
								className="input"
								style={{ width: "100%" }}
								rows={2}
								placeholder="Documents needed, comma separated - e.g. Bank statement, Sponsor letter"
								value={docs}
								onChange={(e) => setDocs(e.target.value)}
							/>
							<button
								type="button"
								className="btn btn--primary btn--sm mt-2"
								disabled={!docs.trim()}
								onClick={() => {
									onRequestDocs(
										docs
											.split(",")
											.map((d) => d.trim())
											.filter(Boolean),
									);
									setDocs("");
									setOpen("none");
								}}
							>
								Send request
							</button>
						</div>
					)}

					{/*
					 * The control here used to be a single free-text field
					 * ("New date & time - e.g. Tomorrow, 3:00 PM"), so this path
					 * bypassed every rule the drawer's own reschedule enforced:
					 * branch opening days, past dates, and slots already taken.
					 * Both paths now share one picker.
					 */}
					{open === "reschedule" && onReschedule && (
						<div style={{ marginBottom: "1rem" }}>
							<ReschedulePanel
								currentWhen={currentWhen}
								branchLabel={branchLabel}
								onConfirm={(date, time, why) => {
									onReschedule(date, time, why);
									setOpen("none");
								}}
								onCancel={() => setOpen("none")}
							/>
						</div>
					)}

					<div className="ops-case-comment-form" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
						<select
							className="input input--sm"
							value={commentKind}
							onChange={(e) => setCommentKind(e.target.value as CommentKind)}
							style={{ width: "165px", flexShrink: 0 }}
						>
							<option value="comment">Comment</option>
							<option value="recommendation">Recommendation</option>
							<option value="status">Status update</option>
						</select>
						<textarea
							className="input"
							style={{ flex: 1 }}
							rows={2}
							placeholder={`Add a note as ${actor}…`}
							value={comment}
							onChange={(e) => setComment(e.target.value)}
						/>
						<button
							type="button"
							className="btn btn--primary btn--sm"
							disabled={!comment.trim()}
							onClick={() => {
								onComment(commentKind, comment.trim());
								setComment("");
							}}
						>
							Post
						</button>
					</div>
				</div>
			) : (
				<p className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
					{closedNote ?? "Read-only - this case is not assigned to you."}
				</p>
			)}

			{requestedDocuments.length > 0 && (
				<div className="card">
					<p className="eyebrow mb-2">Outstanding document requests</p>
					<ul style={{ paddingLeft: "1.2rem", fontSize: "var(--text-sm)" }}>
						{requestedDocuments.map((d, i) => (
							<li key={`${d}-${i}`}>{d}</li>
						))}
					</ul>
				</div>
			)}

			{comments.length > 0 && (
				<div className="card">
					<p className="eyebrow mb-2">Case activity</p>
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{[...comments].reverse().map((c) => (
							<li key={c.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border-light)" }}>
								<div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
									<span style={{ fontWeight: 600, fontSize: "var(--text-xs)" }}>{c.author}</span>
									<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
										{COMMENT_KIND_LABELS[c.kind]}
									</span>
								</div>
								<p style={{ fontSize: "var(--text-sm)", marginTop: "0.2rem" }}>{c.text}</p>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
