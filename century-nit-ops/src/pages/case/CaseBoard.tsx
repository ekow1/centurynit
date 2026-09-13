import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useOpsAuth } from "../OpsAuthContext";
import { useCases } from "../../hooks/useCases";
import type { MockApplication } from "century-nit-core/ops";
import {
	CHAPTERS,
	JOURNEY_STAGES,
	JOURNEY_STAGE_LABELS,
	STAGE_CHAPTER,
	VISA_STAGE_LABELS,
	canAdvanceToStage,
	type ChapterId,
	type JourneyStage,
} from "century-nit-shared";

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
const IN_FLIGHT = JOURNEY_STAGES.filter((s) => s !== "completed");
const CHAPTER_STAGES: Record<ChapterId, JourneyStage[]> = CHAPTERS.reduce(
	(acc, c) => ({ ...acc, [c.id]: JOURNEY_STAGES.filter((s) => STAGE_CHAPTER[s] === c.id) }),
	{} as Record<ChapterId, JourneyStage[]>,
);

export type BoardOrder = "age" | "recent" | "name";
export const BOARD_ORDERS: { id: BoardOrder; label: string }[] = [
	{ id: "age", label: "Longest in stage first" },
	{ id: "recent", label: "Recently moved first" },
	{ id: "name", label: "By client name" },
];

/** Legacy payment_execution rows live in Departure; anything else unrecognised lands in the first column. */
function normaliseStage(stage: string): JourneyStage {
	const match = JOURNEY_STAGES.find((s) => s === (stage === "payment_execution" ? "travel_assistance" : stage));
	return match ?? JOURNEY_STAGES[0];
}

/** The rule's inputs, from the record — the same signals the server reads. */
function signalsOf(app: MockApplication) {
	const schools = app.schoolApplications ?? [];
	return {
		visaStage: app.visaStage,
		agencyStageIndex: app.agencyStageIndex,
		agencySettled: app.agencySettled,
		appFeePaid: app.appFeePaid,
		preDepartureTasks: app.preDepartureTasks,
		paymentPlanId: app.paymentPlanId,
		proceedStatus: app.proceedStatus,
		travelAssistanceStatus: app.travelAssistanceStatus,
		hasPackage: Boolean(app.fundingTrack),
		hasSelection: schools.length > 0,
		hasAdmitted: Boolean(app.acceptedSchoolId) || schools.some((s) => s.outcome === "Admitted"),
	};
}

type Gate = {
	/** ready: nothing blocks; work: Century's; wait: the client's (or the authority's). */
	kind: "ready" | "work" | "wait";
	label: string;
	/** The rule's full sentence, for the tooltip. */
	reason: string | null;
	next: JourneyStage | null;
	/** Consent paused or declined — the case is parked, not merely waiting. */
	hold: boolean;
};

/** What holds the case in its column, in a few words. */
function gateFor(app: MockApplication): Gate {
	const stage = normaliseStage(app.stage);
	const next = JOURNEY_STAGES[JOURNEY_STAGES.indexOf(stage) + 1] ?? null;
	if (!next) return { kind: "ready", label: "Completed", reason: null, next: null, hold: false };
	const reason = canAdvanceToStage(stage, next, signalsOf(app));
	if (reason === null) return { kind: "ready", label: "Ready", reason: null, next, hold: false };
	const r = reason.toLowerCase();
	const wait = (label: string, hold = false): Gate => ({ kind: "wait", label, reason, next, hold });
	const work = (label: string): Gate => ({ kind: "work", label, reason, next, hold: false });
	if (r.startsWith("stopped")) return wait("Consent declined", true);
	if (r.startsWith("paused")) return wait("On hold · consent", true);
	if (r.startsWith("locked")) return wait("Awaiting consent");
	if (r.includes("deposit")) return wait("Deposit unpaid");
	if (r.includes("application fee")) return wait("Application fee unpaid");
	if (r.includes("no service package")) return work("Choose a package");
	if (r.includes("no schools selected")) return work("Choose schools");
	if (r.includes("no accepted offer")) return wait("Awaiting an offer");
	if (r.includes("visa must be approved")) {
		if ((!app.visaStage || app.visaStage === "locked") && !app.visaInvoicePaid) return wait("Visa invoice unpaid");
		return work(`Visa · ${(VISA_STAGE_LABELS[app.visaStage ?? "locked"] ?? app.visaStage ?? "not started").toLowerCase()}`);
	}
	if (r.includes("payment plan") || r.includes("balance") || r.includes("instalment")) return wait("Fee milestone unpaid");
	if (r.includes("travel")) {
		const s = app.travelAssistanceStatus;
		if (!s || s === "decision_pending") return wait("Travel choice pending");
		return work(`Travel · ${s.replace(/_/g, " ")}`);
	}
	if (r.includes("checklist")) {
		const required = (app.preDepartureTasks ?? []).filter((t) => t.required !== false);
		const done = required.filter((t) => t.done || t.waivedReason).length;
		return work(`Checklist ${done} of ${required.length}`);
	}
	return work(reason.replace(/^cannot (advance|mark complete)[^:]*:\s*/i, ""));
}

function ageDays(app: MockApplication): number {
	const at = new Date(app.updatedAt ?? app.submittedDate).getTime();
	if (Number.isNaN(at)) return 0;
	return Math.max(0, Math.floor((Date.now() - at) / 86_400_000));
}

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

	// The chapters over the shown columns, each spanning its stages.
	const rail = CHAPTERS.filter((c) => c.id !== "consult" && c.id !== "done" && CHAPTER_STAGES[c.id].some((s) => stages.includes(s))).map((c) => ({
		...c,
		span: CHAPTER_STAGES[c.id].filter((s) => stages.includes(s)).length,
		count: CHAPTER_STAGES[c.id].reduce((n, s) => n + (columns.get(s)?.length ?? 0), 0),
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
		const checks = app.checklist.length;
		const done = app.checklist.filter((c) => c.checked).length;
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
				<div className="ops-kase__name">{app.applicantName}</div>
				<div className="ops-kase__sub" title={app.university}>
					<span className="ops-kase__ref">{app.appId}</span>
					{app.university ? ` · ${app.university}` : ""}
				</div>
				<div className="ops-kase__gate">
					<span className={`ops-gate-dot${gate.kind === "wait" ? " ops-gate-dot--hollow" : ""}`} aria-hidden />
					<span className={`ops-kase__gate-text${gate.kind === "wait" ? " ops-kase__gate-text--wait" : ""}`}>{gate.label}</span>
					{checks > 0 && (
						<span className="ops-kase__checks" title={`${done} of ${checks} checks`}>
							<span className="ops-ticks" aria-hidden>
								{Array.from({ length: checks }).map((_, i) => (
									<span key={i} className={i < done ? "ops-ticks__on" : undefined} />
								))}
							</span>
							<span className="ops-kase__checks-n">
								{done}/{checks}
							</span>
						</span>
					)}
				</div>
				<div className="ops-kase__foot">
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
						<span>{app.assignedStaff || "Unassigned"}</span>
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
						<span className="ops-board__numeral">{c.numeral}</span>
						{c.label}
						<span className="ops-board__chapter-n">{c.count}</span>
					</div>
				))}
				{showDone && chapter === "all" && (
					<div className="ops-board__chapter ops-board__chapter--done">
						<span className="ops-board__numeral">VI</span>
					</div>
				)}
				{chapter === "done" && (
					<div className="ops-board__chapter">
						<span className="ops-board__numeral">VI</span>
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
				{apps.length - hidden} case{apps.length - hidden === 1 ? "" : "s"} on the board
				{shapeText(boardShape) ? ` · ${shapeText(boardShape)}` : ""}
				{hidden > 0 ? ` · ${hidden} further along — see the list` : ""}
			</p>
		</div>
	);
}
