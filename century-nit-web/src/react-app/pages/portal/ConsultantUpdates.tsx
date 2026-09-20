import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CaseComment } from "century-nit-shared";

/**
 * The case history the consultant marked for the client, rendered as a real
 * timeline: a rail with kind-coded square markers, a mono chip naming what
 * the line is (status / note / document needed / decision / handover), the
 * first line of the comment as the headline, and a per-kind action link.
 *
 * `seenKey` enables the "new since your last visit" divider: the timestamp of
 * the newest entry is remembered in localStorage under that key, so lines that
 * arrived over SSE since the client last looked are grouped above a red rule.
 */

type UpdatableComment = Pick<CaseComment, "id" | "at" | "author" | "text"> & {
	kind?: CaseComment["kind"];
};

type Kind = "status" | "note" | "document_request" | "decision" | "assignment";

const KIND_META: Record<Kind, { mark: string; chip: string }> = {
	status: { mark: "upd__mark--status", chip: "Status" },
	note: { mark: "upd__mark--note", chip: "Note" },
	document_request: { mark: "upd__mark--docreq", chip: "Document needed" },
	decision: { mark: "upd__mark--decision", chip: "Decision" },
	assignment: { mark: "upd__mark--assign", chip: "Handover" },
};

/** Map a comment to a lane. `kind` wins; visa/decision text lines fall back to the regex. */
function kindOf(c: UpdatableComment): Kind {
	if (c.kind === "status") return "status";
	if (c.kind === "document_request") return "document_request";
	if (c.kind === "assignment") return "assignment";
	if (c.kind === "recommendation" || c.kind === "comment") return "note";
	if (isVisaUpdate(c as CaseComment) && /\b(approved|refused|rejected|decision issued|granted)\b/i.test(c.text)) {
		return "decision";
	}
	if (/^visa\b|^biometrics\b|^passport \/ permit/i.test(c.text)) return "status";
	return "note";
}

/** What the update links to, if anything. */
function actionFor(kind: Kind): { label: string; to: string } | null {
	if (kind === "document_request") return { label: "Open document vault →", to: "/portal/documents" };
	if (kind === "decision") return { label: "Open departure chapter →", to: "/portal/pre-departure" };
	return null;
}

function relTime(iso: string): string {
	const then = new Date(iso).getTime();
	const diff = Date.now() - then;
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fullWhen(iso: string): string {
	const d = new Date(iso);
	return `${relTime(iso)} · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** First line is the headline; the rest is muted body. */
function splitText(text: string): { title: string; body: string } {
	const nl = text.indexOf("\n");
	if (nl === -1) {
		// Single-line: split on the first sentence boundary past ~40 chars if long.
		if (text.length <= 110) return { title: text, body: "" };
		const dot = text.indexOf(". ");
		if (dot > 20 && dot < 110) return { title: text.slice(0, dot + 1), body: text.slice(dot + 2) };
		return { title: text, body: "" };
	}
	return { title: text.slice(0, nl), body: text.slice(nl + 1) };
}

const seenKey = (k: string) => `updatesSeenAt:${k}`;
const COLLAPSE_AFTER = 4;

/** Staff names can arrive as a login email or "Super Admin"; clients see the studio. */
export function displayAuthor(name: string): string {
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name) || /^super ?admin$/i.test(name)) return "Century NIT";
	return name;
}

export type UpdateChapter = "applications" | "visa" | "departure";

// First lines emitted by describeDepartureDetails (cases.ts) — Chapter V content.
const DEPARTURE_LINE =
	/^(Report to the school|Report-by date|Orientation|Pre-departure briefing|Briefing date|Airport pickup|Accommodation|Emergency contact|Arriv)/i;

export const chapterOf = (c: { text: string }): UpdateChapter =>
	isVisaUpdate(c) ? "visa" : DEPARTURE_LINE.test(c.text.split("\n", 1)[0]) ? "departure" : "applications";

const DAY_MS = 86_400_000;

/** Jaccard similarity over whitespace-split tokens. */
function similar(a: string, b: string): number {
	const wa = new Set(a.toLowerCase().split(/\s+/));
	const wb = new Set(b.toLowerCase().split(/\s+/));
	let inter = 0;
	for (const w of wa) if (wb.has(w)) inter += 1;
	return inter / (wa.size + wb.size - inter || 1);
}

export type UpdateGroup = { latest: UpdatableComment; count: number; all: UpdatableComment[] };

/**
 * Consecutive entries from the same author, same lane, within 24h, whose first
 * lines match or whose text is ≥80% identical fold into one entry — a staff
 * edit of a briefing re-emits the whole thing, and that read as five updates.
 */
export function coalesce(list: UpdatableComment[]): UpdateGroup[] {
	const groups: UpdateGroup[] = [];
	for (const c of list) {
		const prev = groups[groups.length - 1];
		if (
			prev &&
			displayAuthor(prev.latest.author) === displayAuthor(c.author) &&
			kindOf(prev.latest) === kindOf(c) &&
			Math.abs(new Date(prev.latest.at).getTime() - new Date(c.at).getTime()) < DAY_MS &&
			(prev.latest.text.split("\n", 1)[0] === c.text.split("\n", 1)[0] || similar(prev.latest.text, c.text) >= 0.8)
		) {
			prev.all.push(c);
			prev.count += 1;
			continue;
		}
		groups.push({ latest: c, count: 1, all: [c] });
	}
	return groups;
}

export function ConsultantUpdates({
	comments,
	title = "Updates from your consultant",
	limit,
	filter,
	chapter,
	className = "",
	seenKey: sk,
	showEmpty = false,
}: {
	comments: UpdatableComment[];
	title?: string;
	limit?: number;
	filter?: (c: UpdatableComment) => boolean;
	/** Route entries to the chapter they belong to. Combines with `filter`. */
	chapter?: UpdateChapter;
	className?: string;
	/** localStorage key for the unread divider — pass a stable per-case id. */
	seenKey?: string;
	/** Render a quiet placeholder instead of vanishing when there's nothing. */
	showEmpty?: boolean;
}) {
	let list = filter ? comments.filter(filter) : comments;
	if (chapter) list = list.filter((c) => chapterOf(c) === chapter);
	list = [...list].sort((a, b) => b.at.localeCompare(a.at));
	if (limit) list = list.slice(0, limit);
	const groups = coalesce(list);

	const [expanded, setExpanded] = useState(false);
	const [openEdits, setOpenEdits] = useState<Set<string>>(new Set());
	const [openMore, setOpenMore] = useState<Set<string>>(new Set());
	const flip = (set: Set<string>, id: string) => {
		const next = new Set(set);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		return next;
	};

	// Snapshot the previous "seen" timestamp once, then record now. Whatever is
	// newer than the snapshot renders above the red divider; next visit the bar
	// moves forward.
	const [lastSeen] = useState(() => (sk ? (localStorage.getItem(seenKey(sk)) ?? "") : ""));
	useEffect(() => {
		if (sk && list.length > 0) localStorage.setItem(seenKey(sk), list[0].at);
	}, [sk, list.length > 0 ? list[0].at : null]); // eslint-disable-line react-hooks/exhaustive-deps

	const freshCount = lastSeen ? groups.filter((g) => g.latest.at > lastSeen).length : 0;
	if (list.length === 0 && !showEmpty) return null;

	const visible = expanded ? groups : groups.slice(0, Math.max(COLLAPSE_AFTER, freshCount));
	const hidden = groups.length - visible.length;
	const dividerIdx = lastSeen ? visible.findIndex((g) => g.latest.at > lastSeen) : -1;

	return (
		<div className={`upd-card sharp-card ${className}`.trim()}>
			<div className="upd-card__head">
				<span className="eyebrow">{title}</span>
				{freshCount > 0 ? <span className="upd-card__count">{freshCount} new</span> : null}
			</div>
			{list.length === 0 ? (
				<div className="upd-empty">
					<p className="eyebrow">Nothing yet</p>
					<p>When your consultant writes on your file — a stage move, a request, a decision — it lands here the moment it's saved. No refresh needed.</p>
				</div>
			) : (
				<div className="upd-card__body">
					<ol className="upd">
						{visible.map((g, gi) => {
							const cm = g.latest;
							const isFresh = lastSeen !== "" && cm.at > lastSeen;
							const showDivider = gi === dividerIdx;
							const kind = kindOf(cm);
							const meta = KIND_META[kind];
							const { title: headline, body } = splitText(cm.text);
							const lines = body ? body.split("\n").filter((l) => l.trim()) : [];
							const shownAll = openMore.has(cm.id);
							const shownLines = shownAll ? lines : lines.slice(0, 4);
							const act = actionFor(kind);
							return (
								<Fragment key={cm.id}>
									{showDivider ? (
										<li className="upd__new" aria-hidden>
											<span>New since your last visit</span>
										</li>
									) : null}
									<li className={`upd__item${isFresh ? " upd__item--fresh" : ""}`}>
										<span className={`upd__mark ${meta.mark}`} />
										<div className="upd__head">
											<span className="upd__kind">{meta.chip}</span>
											<span className="upd__who">{displayAuthor(cm.author)}</span>
											<span className="upd__when" title={new Date(cm.at).toLocaleString()}>
												{fullWhen(cm.at)}
											</span>
											{g.count > 1 ? <span className="upd__co">updated ×{g.count}</span> : null}
										</div>
										<p className="upd__title">{headline}</p>
										{lines.length > 0 ? (
											<>
												<ul className="upd__list">
													{shownLines.map((l, i) => (
														<li key={i}>{l}</li>
													))}
												</ul>
												{lines.length > 4 ? (
													<button type="button" className="jlink upd__co" onClick={() => setOpenMore((s) => flip(s, cm.id))}>
														{shownAll ? "show less" : `+${lines.length - 4} more`}
													</button>
												) : null}
											</>
										) : null}
										{g.count > 1 ? (
											<button type="button" className="jlink upd__co" onClick={() => setOpenEdits((s) => flip(s, cm.id))}>
												show edits
											</button>
										) : null}
										{act ? (
											<div className="upd__act">
												<Link className="doc-link" to={act.to}>
													{act.label}
												</Link>
											</div>
										) : null}
									</li>
									{g.count > 1 && openEdits.has(cm.id)
										? g.all.slice(1).map((old) => (
												<li key={old.id} className="upd__edit">
													<span className={`upd__mark ${KIND_META[kindOf(old)].mark}`} />
													<div className="upd__head">
														<span className="upd__who">{displayAuthor(old.author)}</span>
														<span className="upd__when" title={new Date(old.at).toLocaleString()}>
															{fullWhen(old.at)}
														</span>
													</div>
													<p className="upd__title">{splitText(old.text).title}</p>
												</li>
											))
										: null}
								</Fragment>
							);
						})}
					</ol>
					{hidden > 0 ? (
						<button type="button" className="upd__more" onClick={() => setExpanded(true)}>
							{hidden} earlier update{hidden === 1 ? "" : "s"} ↓
						</button>
					) : null}
				</div>
			)}
		</div>
	);
}

/** Visa-chapter lines. What the officer records as the application moves. */
export const isVisaUpdate = (c: { text: string }) => /^visa\b|^biometrics\b|^passport \/ permit/i.test(c.text);
