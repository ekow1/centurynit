import { DOCUMENT_TYPES } from "century-nit-core/content";
import type { PreDepartureTask } from "century-nit-core/content";
import { Button } from "./ui/Button";

/**
 * The client's side of the pre-departure checklist — the same list the
 * departure officer works from in the case. The client ticks their own
 * items (uploading proof where an item asks for it); Century's items are
 * shown as progress the officer closes.
 */
export function PreDepartureChecklist({
	tasks,
	onToggle,
	locked = false,
}: {
	tasks: PreDepartureTask[];
	onToggle: (id: string) => void;
	/** The chapter is closed — read-only. */
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
	const mine = tasks.filter((t) => (t.owner ?? "client") === "client");
	const theirs = tasks.filter((t) => t.owner === "century");
	const required = tasks.filter((t) => t.required !== false);
	const closed = (t: PreDepartureTask) => t.done || Boolean(t.waivedReason);
	const requiredDone = required.filter(closed).length;
	const docName = (id: string) => DOCUMENT_TYPES.find((d) => d.id === id)?.name ?? id;

	const Row = ({ t, editable }: { t: PreDepartureTask; editable: boolean }) => {
		const isClosed = closed(t);
		return (
			<li style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", padding: "0.6rem 0", borderBottom: "1px solid var(--border-light)" }}>
				<button
					type="button"
					onClick={() => editable && !t.evidence && onToggle(t.id)}
					disabled={!editable || Boolean(t.evidence)}
					aria-label={t.done ? `Untick ${t.label}` : `Tick ${t.label}`}
					style={{
						width: "22px",
						height: "22px",
						flexShrink: 0,
						marginTop: "0.1rem",
						border: "2px solid",
						borderColor: isClosed ? "var(--foreground)" : "var(--border)",
						background: isClosed ? "var(--foreground)" : "transparent",
						color: "var(--background)",
						fontSize: "0.75rem",
						fontWeight: 700,
						cursor: editable ? "pointer" : "default",
						padding: 0,
					}}
				>
					{t.done ? "✓" : t.waivedReason ? "–" : ""}
				</button>
				<div style={{ flex: 1, minWidth: 0 }}>
					<p style={{ fontWeight: isClosed ? 400 : 600, textDecoration: t.done ? "line-through" : "none", opacity: isClosed ? 0.7 : 1 }}>
						{t.label}
						{t.required === false ? <span className="muted"> · optional</span> : null}
					</p>
					{t.detail ? (
						<p className="muted" style={{ fontSize: "0.85rem" }}>
							{t.detail}
						</p>
					) : null}
					{t.evidence && !t.done ? (
						<p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>
							{t.proofStatus === "UPLOADED"
								? `${docName(t.evidence)} uploaded — your consultant is checking it; this closes once it is verified.`
								: t.proofStatus === "REJECTED"
									? `${docName(t.evidence)} was not accepted — please upload it again.`
									: `Proof needed: ${docName(t.evidence)}.`}{" "}
							{t.proofStatus !== "UPLOADED" ? (
								<Button to="/portal/documents" variant="ghost" className="btn--sm">
									{t.proofStatus === "REJECTED" ? "Re-upload in your vault" : "Upload to your vault"}
								</Button>
							) : null}
						</p>
					) : null}
					{t.evidence && t.done ? (
						<p className="muted" style={{ fontSize: "0.8rem" }}>
							{docName(t.evidence)} verified{t.doneBy && t.doneBy !== "client" ? ` by ${t.doneBy}` : ""}
						</p>
					) : null}
					{t.waivedReason ? (
						<p className="muted" style={{ fontSize: "0.8rem" }}>
							Waived by your consultant — {t.waivedReason}
						</p>
					) : null}
					{t.done && !t.evidence && t.doneBy && t.doneBy !== "client" ? (
						<p className="muted" style={{ fontSize: "0.8rem" }}>
							Done by {t.doneBy}
							{t.doneAt ? ` · ${new Date(t.doneAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : ""}
						</p>
					) : null}
				</div>
			</li>
		);
	};

	return (
		<div className="sharp-card">
			<div className="between" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
				<p className="eyebrow">Pre-departure checklist</p>
				<span className="mono muted" style={{ fontSize: "0.8rem" }}>
					{requiredDone}/{required.length} from Century NIT done
				</span>
			</div>
			<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
				{requiredDone === required.length ? "Everything Century NIT owes you is done — you can complete your journey below." : "Century NIT closes what it does for you; your own list is a set of reminders for the move — tick them as you go, they never hold you back."}
			</p>

			{mine.length > 0 ? (
				<>
					<p className="eyebrow mt-4" style={{ fontSize: "0.7rem" }}>
						Your own reminders
					</p>
					<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
						{mine.map((t) => (
							<Row key={t.id} t={t} editable={!locked} />
						))}
					</ul>
				</>
			) : null}
			{theirs.length > 0 ? (
				<>
					<p className="eyebrow mt-4" style={{ fontSize: "0.7rem" }}>
						What Century NIT does for you
					</p>
					<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
						{theirs.map((t) => (
							<Row key={t.id} t={t} editable={false} />
						))}
					</ul>
				</>
			) : null}
		</div>
	);
}
