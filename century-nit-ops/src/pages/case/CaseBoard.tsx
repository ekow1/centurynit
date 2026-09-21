import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useOpsAuth } from "../OpsAuthContext";
import { ageDays, gateFor, normaliseStage, signalsOf, type Gate } from "../../lib/caseGate";
import { useCases } from "../../hooks/useCases";
import type { MockApplication } from "century-nit-core/ops";
import {
	CHAPTERS,
	JOURNEY_STAGES,
	JOURNEY_STAGE_LABELS,
	STAGE_CHAPTER,
	canAdvanceToStage,
	type ChapterId,
	type JourneyStage,
} from "century-nit-shared";
import { caseHandlerName } from "../../lib/pendingTasks";
import { ScopeChip } from "../../components/ScopeRoute";

/**
 * The cases as columns, one per stage, under a rail of the chapters the
 * client sees. Cards can be dragged one column on or advanced with the
 * arrow — both write to the case, so the list and the dashboard move with
 * them. `JOURNEY_STAGES` is the shared source of truth; column keys are the
 * enum values and labels come from the vocabulary.
 *
 * Every card says what holds it where it is, read from the same rule the
 * drag uses (`canAdvanceToStage`, with the record signals the server also
 * checks): ● filled is Century's work, ○ hollow is waiting on the client;
 * nothing blocking is Ready, and the arrow shows. A view of the Cases
 * page, not a page of its own.
 */

const STALLED_AFTER_DAYS = 7;
// payment_execution was folded into travel_assistance (0079): never a column.
const IN_FLIGHT = JOURNEY_STAGES.filter((s) => s !== "completed" && s !== "payment_execution");
const CHAPTER_STAGES: Record<ChapterId, JourneyStage[]> = CHAPTERS.reduce(
	(acc, c) => ({ ...acc, [c.id]: JOURNEY_STAGES.filter((s) => STAGE_CHAPTER[s] === c.id && s !== "payment_execution") }),
	{} as Record<ChapterId, JourneyStage[]>,
);

/**
 * The rail speaks the chapters — the one numbering (I–VI) the case detail,
 * the caseload and the list filters use. A column is a journey stage; a
 * chapter spans its columns. A visa-only file sits in IV with III struck on
 * its card; the plan is on the card, never on the rail.
 */
const STAGE_RAIL: { id: string; no: string; label: string; stages: JourneyStage[] }[] = [
	{ id: "enrolment", no: "II", label: "Enrolment", stages: ["document_verification"] },
	{ id: "applications", no: "III", label: "Applications", stages: ["school_submission", "offer_letter_review"] },
	{ id: "visa", no: "IV", label: "Visa", stages: ["visa_processing"] },
	{ id: "departure", no: "V", label: "Departure", stages: ["travel_assistance"] },
];

export type BoardOrder = "age" | "recent" | "name";
export const BOARD_ORDERS: { id: BoardOrder; label: string }[] = [
	{ id: "age", label: "Longest in stage first" },
	{ id: "recent", label: "Recently moved first" },
	{ id: "name", label: "By client name" },
];

/** Legacy payment_execution rows live in Departure; anything else unrecognised lands in the first column. */

function ageLabel(days: number): string {
	if (days === 0) return "today";
	return `${days} d`;
}

export function CaseBoard({
	apps,
	onOpen,
	chapter = "all",
	order = "age",
	onAssign,
}: {
	apps: MockApplication[];
	onOpen: (app: MockApplication) => void;
	/** Narrow the board to one chapter's stage columns. */
	chapter?: "all" | ChapterId;
	order?: BoardOrder;
	/** Offered on an unowned card, for those who assign work. */
	onAssign?: (app: MockApplication) => void;
}) {
	const { opsUser, opsRole } = useOpsAuth();
	const { setApplicationStage } = useCases();
	const [dragging, setDragging] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState<JourneyStage | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [doneOpen, setDoneOpen] = useState(false);

	// Manager and coordinator route any case; the assigned owner moves their own.
	const canMoveAny = opsRole === "manager" || opsRole === "coordinator";
	const ownsCase = (a: MockApplication) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name;
	const canMoveCase = (a: MockApplication) => canMoveAny || ownsCase(a);

	const stages: JourneyStage[] = (chapter === "all" ? IN_FLIGHT : (CHAPTER_STAGES[chapter] ?? IN_FLIGHT)).filter((s) => s !== "completed");
	const showDone = chapter === "all" || chapter === "done";
	// The rail and the columns share one grid, so a chapter spans exactly its stages.
	const template = `${stages.map(() => "minmax(15rem, 1fr)").join(" ")}${showDone ? (chapter === "done" || doneOpen ? " minmax(15rem, 1fr)" : " 3rem") : ""}`;

	const columns = useMemo(() => {
		const map = new Map<JourneyStage, { app: MockApplication; gate: Gate; age: number }[]>();
		for (const stage of JOURNEY_STAGES) map.set(stage, []);
		for (const app of apps) map.get(normaliseStage(app.stage))!.push({ app, gate: gateFor(app), age: ageDays(app) });
		for (const list of map.values()) {
			list.sort((a, b) =>
				order === "name" ? a.app.applicantName.localeCompare(b.app.applicantName) : order === "recent" ? a.age - b.age : b.age - a.age,
			);
		}
		return map;
	}, [apps, order]);

	const shown = [...stages, ...(showDone ? (["completed"] as JourneyStage[]) : [])];
	const hidden = apps.filter((a) => !shown.includes(normaliseStage(a.stage))).length;
	const shape = (cards: { gate: Gate; age: number }[]) => ({
		ready: cards.filter((c) => c.gate.kind === "ready").length,
		wait: cards.filter((c) => c.gate.kind === "wait").length,
		stalled: cards.filter((c) => c.age >= STALLED_AFTER_DAYS).length,
	});
	const shapeText = (s: { ready: number; wait: number; stalled: number }) =>
		[s.ready > 0 ? `${s.ready} ready` : null, s.wait > 0 ? `${s.wait} waiting on client` : null, s.stalled > 0 ? `${s.stalled} stalled` : null].filter(Boolean).join(" · ");
	const boardShape = shape(stages.flatMap((s) => columns.get(s) ?? []));
	const doneCount = columns.get("completed")?.length ?? 0;

	// The service stages over the shown columns, each spanning its columns.
	const rail = STAGE_RAIL.filter((r) => r.stages.some((s) => stages.includes(s))).map((r) => ({
		...r,
		span: r.stages.filter((s) => stages.includes(s)).length,
		count: r.stages.reduce((n, s) => n + (columns.get(s)?.length ?? 0), 0),
	}));

	async function move(app: MockApplication, to: JourneyStage) {
		const reason = canAdvanceToStage(normaliseStage(app.stage), to, signalsOf(app));
		if (reason) {
			setActionError(reason);
			return;
		}
		try {
			await setApplicationStage(app.appId, to);
			setActionError(null);
		} catch (err: unknown) {
			setActionError(err instanceof Error ? err.message : "Could not move case");
		}
	}

	const dropProps = (stage: JourneyStage) => ({
		onDragOver: (e: DragEvent) => {
			e.preventDefault();
			setDragOver(stage);
		},
		onDragLeave: () => setDragOver((s) => (s === stage ? null : s)),
		onDrop: (e: DragEvent) => {
			e.preventDefault();
			const app = dragging ? apps.find((a) => a.appId === dragging) : undefined;
			if (app) void move(app, stage);
			setDragging(null);
			setDragOver(null);
		},
	});

	const card = ({ app, gate, age }: { app: MockApplication; gate: Gate; age: number }): ReactNode => {
		const stalled = age >= STALLED_AFTER_DAYS && gate.next !== null;
		const canDrag = canMoveCase(app) && gate.kind === "ready" && gate.next !== null;
		const unowned = !app.assignedStaff;
		return (
			<div
				key={app.id}
				draggable={canDrag}
				onDragStart={() => canDrag && setDragging(app.appId)}
				onDragEnd={() => {
					setDragging(null);
					setDragOver(null);
				}}
				onClick={() => onOpen(app)}
				className={`ops-kase${gate.kind === "ready" && gate.next ? " ops-kase--ready" : ""}${stalled ? " ops-kase--stalled" : ""}${gate.hold ? " ops-kase--hold" : ""}${dragging === app.appId ? " ops-kase--dragging" : ""}`}
				style={canDrag ? { cursor: "grab" } : undefined}
				title={gate.reason ?? undefined}
			>
				{/* Name + the plan's shape; the one thing holding the case; then
				    where it is and who holds it. Everything else is in the detail. */}
				<div className="ops-kase__name">
					<span title={app.appId}>{app.applicantName}</span>
					<ScopeChip scopeStages={app.scopeStages} />
				</div>
				<div className="ops-kase__gate">
					<span className={`ops-gate-dot${gate.kind === "wait" ? " ops-gate-dot--hollow" : ""}`} aria-hidden />
					<span className={`ops-kase__gate-text${gate.kind === "wait" ? " ops-kase__gate-text--wait" : ""}`}>{gate.label}</span>
				</div>
				<div className="ops-kase__foot">
					<span title={app.university || app.appId}>{app.university || app.appId}</span>
					{unowned && onAssign ? (
						<button
							type="button"
							className="cn-row__assign"
							onClick={(e) => {
								e.stopPropagation();
								onAssign(app);
							}}
						>
							Assign
						</button>
					) : (
						<span>{caseHandlerName(app) || "Unassigned"}</span>
					)}
					<span className={`ops-kase__age${stalled ? " ops-kase__age--stalled" : ""}`} title={app.updatedAt ? `Last moved ${new Date(app.updatedAt).toLocaleString()}` : undefined}>
						{ageLabel(age)}
					</span>
				</div>
				{canMoveCase(app) && gate.kind === "ready" && gate.next && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							void move(app, gate.next!);
						}}
						className="btn btn--ghost btn--sm ops-kase__go"
						title={`Advance to ${JOURNEY_STAGE_LABELS[gate.next]}`}
					>
						→ {JOURNEY_STAGE_LABELS[gate.next]}
					</button>
				)}
			</div>
		);
	};

	return (
		<div>
			{actionError && (
				<div role="alert" className="ops-modal__error" style={{ marginBottom: "1rem" }}>
					{actionError}
				</div>
			)}

			<div className="ops-board__scroll">
			<div className="ops-board__rail" style={{ gridTemplateColumns: template }}>
				{rail.map((c) => (
					<div key={c.id} className="ops-board__chapter" style={{ gridColumn: `span ${c.span}` }}>
						<span className="ops-board__numeral">{c.no}</span>
						{c.label}
						<span className="ops-board__chapter-n">{c.count}</span>
					</div>
				))}
				{showDone && chapter === "all" && (
					<div className="ops-board__chapter ops-board__chapter--done" title={`${doneCount} completed`}>
						<span className="ops-board__numeral">✓</span>
					</div>
				)}
				{chapter === "done" && (
					<div className="ops-board__chapter">
						<span className="ops-board__numeral">✓</span>
						Done
						<span className="ops-board__chapter-n">{doneCount}</span>
					</div>
				)}
			</div>

			<div className="ops-board" style={{ gridTemplateColumns: template }}>
				{stages.map((stage, i) => {
					const cards = columns.get(stage) ?? [];
					const isTarget = dragOver === stage;
					const s = shape(cards);
					return (
						<div key={stage} {...dropProps(stage)} className={`ops-col${isTarget ? " ops-col--target" : ""}`}>
							<div className="ops-col__head">
								<div className="ops-col__title">
									<span>
										<span className="ops-col__num">{JOURNEY_STAGES.indexOf(stage) + 1}</span>
										{JOURNEY_STAGE_LABELS[stage]}
									</span>
									<span className="ops-col__count">{cards.length}</span>
								</div>
								<div className="ops-col__shape">{shapeText(s) || (i === 0 ? "nothing here" : "")}</div>
							</div>
							<div className="ops-col__body">
								{cards.length === 0 ? <div className="ops-col__empty">{isTarget ? "Drop here" : "Empty"}</div> : cards.map(card)}
							</div>
						</div>
					);
				})}
				{showDone &&
					(chapter === "done" || doneOpen ? (
						<div {...dropProps("completed")} className={`ops-col${dragOver === "completed" ? " ops-col--target" : ""}`}>
							<div className="ops-col__head">
								<div className="ops-col__title">
									<span>
										<span className="ops-col__num">{JOURNEY_STAGES.length}</span>
										{JOURNEY_STAGE_LABELS.completed}
									</span>
									<span className="ops-col__count">{doneCount}</span>
								</div>
								<div className="ops-col__shape">
									{chapter === "all" ? (
										<button type="button" className="ops-col__fold" onClick={() => setDoneOpen(false)}>
											fold ◂
										</button>
									) : (
										"closed cases"
									)}
								</div>
							</div>
							<div className="ops-col__body">{doneCount === 0 ? <div className="ops-col__empty">Empty</div> : columns.get("completed")!.map(card)}</div>
						</div>
					) : (
						<button type="button" {...dropProps("completed")} className={`ops-done${dragOver === "completed" ? " ops-done--target" : ""}`} onClick={() => setDoneOpen(true)} title="Show completed cases">
							<span className="ops-done__n">{doneCount}</span>
							<span className="ops-done__l">Done</span>
							<span className="ops-done__arrow" aria-hidden>
								▸
							</span>
						</button>
					))}
			</div>
			</div>

			<p className="ops-board__foot">
				Every case on the board entered at Stage 0 · Consultation — the amber dot on each card.{" "}
				{apps.length - hidden} case{apps.length - hidden === 1 ? "" : "s"} on the board
				{shapeText(boardShape) ? ` · ${shapeText(boardShape)}` : ""}
				{hidden > 0 ? ` · ${hidden} further along — see the list` : ""}
			</p>
		</div>
	);
}
