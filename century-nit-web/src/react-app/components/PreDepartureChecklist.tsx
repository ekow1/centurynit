import { DOCUMENT_TYPES } from "century-nit-core/content";
import type { PreDepartureTask } from "century-nit-core/content";
import { Button } from "./ui/Button";

/**
 * The client's side of the pre-departure checklist. The same list the
 * departure officer works from in the case. One list, open items first:
 * the client ticks their own items (uploading proof where an item asks for
 * it); Century's items carry an owner chip and a read-only tick.
 */
export function PreDepartureChecklist({
	tasks,
	onToggle,
	locked = false,
}: {
	tasks: PreDepartureTask[];
	onToggle: (id: string) => void;
	/** The chapter is closed. Read-only. */
	locked?: boolean;
}) {
	if (tasks.length === 0) {
		return (
			<div className="sharp-card">
				<p className="eyebrow">Pre-departure checklist</p>
				<p className="muted mt-2">Your checklist appears here once your visa is approved.</p>
			</div>
		);
	}
	const closed = (t: PreDepartureTask) => t.done || Boolean(t.waivedReason);
	// One list: what you can still do on top, then theirs, done items last.
	const ordered = [...tasks].sort((a, b) => {
		const ac = closed(a) ? 1 : 0;
		const bc = closed(b) ? 1 : 0;
		if (ac !== bc) return ac - bc;
		const ao = (a.owner ?? "client") === "client" ? 0 : 1;
		const bo = (b.owner ?? "client") === "client" ? 0 : 1;
		return ao - bo;
	});
	const required = tasks.filter((t) => t.required !== false);
	const requiredDone = required.filter(closed).length;
	const docName = (id: string) => DOCUMENT_TYPES.find((d) => d.id === id)?.name ?? id;

	return (
		<div className="sharp-card">
			<div className="between" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
				<p className="eyebrow">Pre-departure checklist</p>
				<span className="mono muted" style={{ fontSize: "0.8rem" }}>
					{requiredDone}/{required.length} from Century NIT done
				</span>
			</div>
			<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
				{requiredDone === required.length ? "Everything Century NIT owes you is done. You can complete your journey below." : "Century NIT closes what it does for you; your own list is a set of reminders for the move. Tick them as you go, they never hold you back."}
			</p>

			<ul className="chk">
				{ordered.map((t) => {
					const isClosed = closed(t);
					const isMine = (t.owner ?? "client") === "client";
					const editable = isMine && !locked;
					return (
						<li key={t.id} className="chk__row">
							<button
								type="button"
								className={`chk__tick${isClosed ? " chk__tick--on" : ""}${isMine ? "" : " chk__tick--staff"}`}
								onClick={() => editable && !t.evidence && onToggle(t.id)}
								disabled={!editable || Boolean(t.evidence)}
								aria-label={t.done ? `Untick ${t.label}` : `Tick ${t.label}`}
							>
								{t.done ? "✓" : t.waivedReason ? "–" : ""}
							</button>
							<div className="chk__body">
								<p className={`chk__nm${t.done ? " chk__nm--done" : ""}${isClosed && !t.done ? " chk__nm--closed" : ""}`}>
									{t.label}
									{t.required === false ? <span className="muted"> · optional</span> : null}
								</p>
								{t.detail ? <p className="chk__hint">{t.detail}</p> : null}
								{t.evidence && !t.done ? (
									<p className="chk__hint">
										{t.proofStatus === "UPLOADED"
											? `${docName(t.evidence)} uploaded. Your consultant is checking it; this closes once it is verified.`
											: t.proofStatus === "REJECTED"
												? `${docName(t.evidence)} was not accepted. Please upload it again.`
												: `Proof needed: ${docName(t.evidence)}.`}
									</p>
								) : null}
								{t.evidence && t.done ? (
									<p className="chk__hint">
										{docName(t.evidence)} verified{t.doneBy && t.doneBy !== "client" ? ` by ${t.doneBy}` : ""}
									</p>
								) : null}
								{t.waivedReason ? <p className="chk__hint">Waived by your consultant · {t.waivedReason}</p> : null}
								{t.done && !t.evidence && t.doneBy && t.doneBy !== "client" ? (
									<p className="chk__hint">
										Done by {t.doneBy}
										{t.doneAt ? ` · ${new Date(t.doneAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : ""}
									</p>
								) : null}
							</div>
							<span className={`chk__owner${isMine ? " chk__owner--you" : ""}`}>{isMine ? "You" : "Century NIT"}</span>
							{t.evidence && !t.done && t.proofStatus !== "UPLOADED" ? (
								<Button to={`/portal/documents?doc=${t.evidence}`} variant="ghost" size="sm" className="chk__act">
									{t.proofStatus === "REJECTED" ? "Re-upload ↑" : "Upload ↑"}
								</Button>
							) : null}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
