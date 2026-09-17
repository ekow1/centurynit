import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { applicationsApi } from "century-nit-core/api";
import type { Assignee } from "century-nit-core/ops";
import type { Booking } from "century-nit-shared";
import { branchName } from "century-nit-core/ops";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useWorkQueue } from "../hooks/useWorkQueue";
import { AssignDialog } from "./UnassignedBookings";
import { AssignSheet, type HandlerPlacement } from "./case/AssignSheet";
import {
	isOverdue,
	isDueToday,
	timeAgo,
	priorityNotches,
	queueBand,
	QUEUE_BAND_LABEL,
	type QueueBand,
	handoffOffersKeep,
	taskActionLabel,
	taskKindLabel,
	taskRef,
	TASK_KIND_LABEL,
	whenLabel,
	type PendingTask,
} from "../lib/pendingTasks";

/**
 * "Pending tasks" — the unified triage surface.
 *
 * The Dashboard used to show only unassigned calendar bookings here; that
 * panel is now the whole pending backlog (unassigned bookings, consultations
 * to assess, cases to assign, visa steps, documents, invoices, leads and stage
 * handoffs) in a single table, and the Workspace shows the identical table.
 *
 * Every assignable row carries the same inline "Assign" affordance:
 *  - unassigned booking   → the availability-checked AssignDialog
 *  - consultation/case    → assignee selector (assignConsultation/assignApplication)
 *  - stage handoff        → assignee selector + reason (resolveHandoff)
 */

/**
 * The placement sheet for a queue task — the shared branch → handler →
 * coverage sheet (AssignSheet). Travel keeps a stage-only seat (nothing
 * follows it); consultations, applications and handoffs offer coverage.
 */
export function AssignTaskDialog({
	task,
	assignees,
	onClose,
	onAssign,
	onKeepHandler,
	onLeaveOpen,
}: {
	task: PendingTask;
	assignees: Assignee[];
	onClose: () => void;
	onAssign: (to: Assignee, placement: HandlerPlacement) => Promise<unknown>;
	onKeepHandler?: (reason?: string) => Promise<unknown>;
	onLeaveOpen?: (branch: string) => Promise<unknown>;
}) {
	// Which stage the picker is staffing — decides which roles are offered.
	const stageForRoles =
		task.kind === "handoff"
			? task.record.stage
			: task.kind === "travel"
				? "travel_assistance"
				: task.kind === "application"
					? task.record.stage
					: "consultation";
	const open = !task.owner || task.owner === "Unassigned" || task.owner === "—" || task.owner === "— open";
	const current = open ? null : task.owner;
	const handoff = task.kind === "handoff" ? task.record : null;

	return (
		<AssignSheet
			open
			onClose={onClose}
			title={`Handler · ${taskKindLabel(task)}`}
			stage={stageForRoles}
			staff={assignees}
			branch={task.branch}
			currentName={current}
			keepName={handoff && onKeepHandler && handoffOffersKeep(handoff) ? handoff.fromOpsUserName : null}
			keepOpsUserId={handoff && onKeepHandler && handoffOffersKeep(handoff) ? handoff.fromOpsUserId : null}
			withReason={Boolean(handoff)}
			why={handoff ? `${task.title} — ${task.subtitle}` : `${task.title} · ${task.subtitle}`}
			coverage={task.kind !== "travel"}
			onAssign={async (placement) => {
				const to = assignees.find((a) => a.opsUserId === placement.opsUserId);
				if (!to) throw new Error("Staff member not found");
				await onAssign(to, placement);
				onClose();
			}}
			onKeep={
				onKeepHandler
					? async (reason) => {
							await onKeepHandler(reason);
							onClose();
						}
					: undefined
			}
			onLeaveOpen={onLeaveOpen}
		/>
	);
}

export function PendingTaskTable({
	items,
	assignees,
	canAssignWork,
	onAssign,
	onKeepHandler,
	onLeaveOpen,
	onAssigned,
	onSelect,
	selectedId,
	emptyLabel,
	groupByPerson = false,
}: {
	items: PendingTask[];
	assignees: Assignee[];
	canAssignWork: boolean;

	onAssign: (task: PendingTask, to: Assignee, placement: HandlerPlacement) => Promise<unknown>;
	onKeepHandler?: (task: PendingTask, reason?: string) => Promise<unknown>;
	onLeaveOpen?: (task: PendingTask, branch: string) => Promise<unknown>;
	onAssigned: () => void | Promise<void>;
	onSelect?: (task: PendingTask) => void;
	selectedId?: string | null;
	emptyLabel?: string;
	/** Group rows under the person they belong to — the morning read as people, not tickets. */
	groupByPerson?: boolean;
}) {
	const { canSeeAllBranches } = useOpsAuth();
	// Group headers: one per distinct name, in queue order.
	const groups = groupByPerson
		? items.reduce<{ name: string; rows: PendingTask[] }[]>((acc, t) => {
				const last = acc[acc.length - 1];
				if (last && last.name === t.title) last.rows.push(t);
				else acc.push({ name: t.title, rows: [t] });
				return acc;
			}, [])
		: null;
	const [booking, setBooking] = useState<Booking | null>(null);
	const [task, setTask] = useState<PendingTask | null>(null);
	const [justAssigned, setJustAssigned] = useState<string | null>(null);

	const isAssignable = (t: PendingTask) =>
		canAssignWork &&
		(t.kind === "booking" ||
			t.kind === "consultation" ||
			t.kind === "application" ||
			(t.kind === "travel" && t.action === "assign") ||
			t.action === "resolve");

	return (
		<>
			{justAssigned && <p className="ops-panel__ok">{justAssigned}</p>}

			{items.length === 0 ? (
				<p className="ops-panel__muted">{emptyLabel ?? "Nothing pending right now."}</p>
			) : (
				<div className="ops-table-wrap">
					<table className="ops-table">
						<thead>
							<tr>
								<th style={{ width: "2.5rem" }} title="Priority — ink density, top of the queue first" />
								<th>Task</th>
								<th>Type</th>
								<th>When / Details</th>
								{canSeeAllBranches && <th>Branch</th>}
								<th>Handler</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{(groups ?? [{ name: "", rows: items }]).flatMap((g) => {
								const header =
									groups && g.rows.length > 0 ? (
										<tr key={`group-${g.name}`} className="ops-table__group">
											<td colSpan={canSeeAllBranches ? 7 : 6} style={{ paddingTop: "0.9rem", paddingBottom: "0.2rem", borderBottom: "none" }}>
												<span className="eyebrow" style={{ margin: 0 }}>
													{g.name} · {g.rows.length} thing{g.rows.length === 1 ? "" : "s"}
												</span>
											</td>
										</tr>
									) : null;
								const rows = g.rows.map((t) => {
								// The handler action shows only for open seats — a handoff
								// is open by definition (its seat is being decided now).
								const seatOpen = !t.owner || t.owner === "— open" || t.owner === "Unassigned" || t.owner === "—";
								const canAssign = isAssignable(t) && (seatOpen || t.action === "resolve");
								const selected = selectedId === t.id;
								const overdue = isOverdue(t);
								const notches = priorityNotches(t.priority);
								return (
									<tr
										key={t.id}
										className={[
											onSelect ? "ops-tr--pick" : "",
											selected ? "ops-tr--sel" : "",
											overdue && !selected ? "ops-tr--over" : "",
										]
											.filter(Boolean)
											.join(" ") || undefined}
										tabIndex={onSelect ? 0 : undefined}
										aria-selected={onSelect ? selected : undefined}
										onClick={onSelect ? () => onSelect(t) : undefined}
										onKeyDown={
											onSelect
												? (e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															onSelect(t);
														}
													}
												: undefined
										}
									>
										<td className="mono" title={notches === 3 ? "Urgent — top of the queue" : notches === 2 ? "Soon" : "Routine"} style={{ letterSpacing: "0.05em", whiteSpace: "nowrap", opacity: selected ? 1 : undefined }}>
											<span>{"●".repeat(notches)}</span>
											<span style={{ opacity: 0.3 }}>{"●".repeat(3 - notches)}</span>
										</td>
										<td>
											<strong>{groups ? taskActionLabel(t) : t.title}</strong>
											{overdue && <span className="ops-pill" style={{ marginLeft: "0.4rem", fontWeight: 700 }}>Overdue</span>}
											<div className="ops-table__sub" title={t.subtitle} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "22rem" }}>{t.subtitle}</div>
											{t.kind === "booking" && (
												<div className="ops-table__sub">{t.record.clientEmail}</div>
											)}
											{t.isLive && (
												<span
													className="ops-pill"
													style={{
														marginTop: "0.25rem",
														background: "var(--foreground)",
														color: "var(--background)",
														fontWeight: "bold",
													}}
												>
													LIVE NOW
												</span>
											)}
										</td>
										<td>
											<span className="ops-badge">{TASK_KIND_LABEL[t.kind]}</span>
											<div className="ops-table__sub">{taskActionLabel(t)}</div>
										</td>
										<td className="ops-table__when" title={t.at ? new Date(t.at).toLocaleString() : undefined}>{whenLabel(t.at)}</td>
										{canSeeAllBranches && <td>{branchName(t.branch || "") || "—"}</td>}
										<td>{seatOpen ? <span className="town--none">— open</span> : t.owner}</td>
										<td
											style={{ textAlign: "right", whiteSpace: "nowrap" }}
											onClick={(e) => e.stopPropagation()}
										>
											{canAssign ? (
												<button
													type="button"
													className="btn btn--primary btn--sm"
													onClick={() =>
														t.kind === "booking" ? setBooking(t.record) : setTask(t)
													}
												>
													Handler…
												</button>
											) : (
												<Link to={t.linkTo} className="btn btn--ghost btn--sm">
													Open →
												</Link>
											)}
										</td>
									</tr>
								);
								});
								return header ? [header, ...rows] : rows;
							})}
						</tbody>
					</table>
				</div>
			)}

			{booking && (
				<AssignDialog
					booking={booking}
					onClose={() => setBooking(null)}
					onAssigned={(updated) => {
						setBooking(null);
						setJustAssigned(
							`${updated.clientName} assigned to ${updated.employeeName}.${
								updated.meetingUrl
									? " Meeting link created and sent."
									: " You can add a video meeting link in the Consultations module if required."
							}`,
						);
						void onAssigned();
					}}
				/>
			)}

			{task && (
				<AssignTaskDialog
					task={task}
					assignees={assignees}
					onClose={() => setTask(null)}
					onAssign={(to, placement) =>
						onAssign(task, to, placement).then(() => {
							void onAssigned();
						})
					}
					onKeepHandler={
						onKeepHandler
							? (reason) =>
									onKeepHandler(task, reason).then(() => {
										void onAssigned();
									})
							: undefined
					}
					onLeaveOpen={
						onLeaveOpen
							? (branch) =>
									onLeaveOpen(task, branch).then(() => {
										void onAssigned();
									})
							: undefined
					}
				/>
			)}
		</>
	);
}

/* ── The queue as a task ledger ──────────────────────────────────────── */

type TaskSection = { band: QueueBand; count: number; note?: string; rows: PendingTask[] };

function taskSections(items: PendingTask[], now: Date): TaskSection[] {
	const by: Record<QueueBand, PendingTask[]> = { today: [], overdue: [], rest: [] };
	for (const t of items) by[queueBand(t, now)].push(t);
	const live = by.today.filter((t) => t.isLive).length;
	const oldestMs = by.overdue.reduce((max, t) => {
		const d = t.due ? new Date(t.due).getTime() : Number.NaN;
		return Number.isNaN(d) ? max : Math.max(max, now.getTime() - d);
	}, 0);
	const oldestDays = Math.floor(oldestMs / 86_400_000);
	// Overdue leads — the stalest work ages worst, so it heads the day.
	return (
		[
			{ band: "overdue", count: by.overdue.length, note: oldestDays >= 1 ? `oldest ${oldestDays} day${oldestDays === 1 ? "" : "s"}` : undefined, rows: by.overdue },
			{ band: "today", count: by.today.length, note: live > 0 ? `${live} live now` : undefined, rows: by.today },
			{ band: "rest", count: by.rest.length, rows: by.rest },
		] as TaskSection[]
	).filter((s) => s.count > 0);
}

/**
 * A client's tasks cluster under one separator — grouping survives, but
 * the row stays the unit of work instead of hiding inside a person-card.
 * Groups keep first-occurrence order; a lone task renders bare.
 */
function clusterRows(rows: PendingTask[]): { client: string; tasks: PendingTask[] }[] {
	const out: { client: string; tasks: PendingTask[] }[] = [];
	const idx = new Map<string, number>();
	for (const t of rows) {
		const i = idx.get(t.title);
		if (i === undefined) {
			idx.set(t.title, out.length);
			out.push({ client: t.title, tasks: [t] });
		} else {
			out[i].tasks.push(t);
		}
	}
	return out;
}

/** The when cell: a deadline beats an activity stamp, and pills name states. */
function taskWhen(t: PendingTask, now: Date): ReactNode {
	if (t.isLive) {
		const time = t.due
			? new Date(t.due).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
			: "now";
		return <span className="ops-pill ops-pill--live">Live {time}</span>;
	}
	if (isOverdue(t, now)) {
		const days = t.due ? Math.floor((now.getTime() - new Date(t.due).getTime()) / 86_400_000) : 0;
		return <span className="ops-pill ops-pill--strong">{days >= 1 ? `${days}d over` : "Overdue"}</span>;
	}
	if (t.due && isDueToday(t, now)) {
		return `today ${new Date(t.due).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
	}
	return timeAgo(t.at);
}

/**
 * The Workspace queue: one row per task, banded by the day. The kicker
 * states the work once — ACTION · KIND — the client and ref carry the
 * title, and the handler action sits on the row it staffs rather than
 * guessing at the first assignable thing inside a card.
 */
export function PendingTaskRows({
	items,
	assignees,
	canAssignWork,
	onAssign,
	onKeepHandler,
	onLeaveOpen,
	onAssigned,
	onSelect,
	selectedId,
	emptyLabel,
}: {
	items: PendingTask[];
	assignees: Assignee[];
	canAssignWork: boolean;
	onAssign: (task: PendingTask, to: Assignee, placement: HandlerPlacement) => Promise<unknown>;
	onKeepHandler?: (task: PendingTask, reason?: string) => Promise<unknown>;
	onLeaveOpen?: (task: PendingTask, branch: string) => Promise<unknown>;
	onAssigned: () => void | Promise<void>;
	onSelect: (task: PendingTask) => void;
	selectedId?: string | null;
	emptyLabel?: string;
}) {
	const [booking, setBooking] = useState<Booking | null>(null);
	const [task, setTask] = useState<PendingTask | null>(null);
	const [justAssigned, setJustAssigned] = useState<string | null>(null);
	const { canSeeAllBranches, opsUser } = useOpsAuth();
	const isMe = (t: PendingTask) => t.owner === opsUser?.name || t.owner === opsUser?.email;
	const now = new Date();
	const sections = taskSections(items, now);
	// Row numbers across every section — computed once, not mutated during render.
	const ranks = useMemo(() => {
		const m = new Map<string, number>();
		let r = 0;
		for (const s of sections) for (const g of clusterRows(s.rows)) for (const t of g.tasks) m.set(t.id, ++r);
		return m;
		// eslint-disable-next-line react-hooks/exhaustive-deps -- sections is derived from items
	}, [items]);

	const isOpen = (t: PendingTask) =>
		!t.owner || t.owner === "— open" || t.owner === "Unassigned" || t.owner === "—";
	const isAssignable = (t: PendingTask) =>
		canAssignWork &&
		(t.kind === "booking" ||
			t.kind === "consultation" ||
			t.kind === "application" ||
			(t.kind === "travel" && t.action === "assign") ||
			t.action === "resolve") &&
		(isOpen(t) || t.action === "resolve");

	return (
		<>
			{justAssigned && <p className="ops-panel__ok" style={{ margin: "0.75rem 1rem 0" }}>{justAssigned}</p>}
			{items.length === 0 ? (
				<p className="ops-people__empty">{emptyLabel ?? "Nothing pending right now."}</p>
			) : (
				<div className="ops-bands" style={{ padding: 0 }}>
					{sections.map((section) => (
						<div key={section.band}>
							<div className={`ops-band${section.band === "overdue" ? " ops-band--hot" : ""}`}>
								<span className="ops-band__name">
									{QUEUE_BAND_LABEL[section.band]} · {section.count}
								</span>
								{section.note && <span className="ops-band__note">{section.note}</span>}
							</div>
							{clusterRows(section.rows).map((group) => (
								<div key={`${section.band}-${group.client}`}>
									{group.tasks.length > 1 && (
										<div className="tgroup">
											{group.client} · {group.tasks.length} tasks
										</div>
									)}
									{group.tasks.map((t) => {
										const rank = ranks.get(t.id) ?? 0;
										const selected = selectedId === t.id;
										const canAssign = isAssignable(t);
										const open = isOpen(t);
										return (
											<div
												key={t.id}
												className={`trow${selected ? " trow--on" : ""}`}
												role="button"
												tabIndex={0}
												aria-pressed={selected}
												onClick={() => onSelect(t)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														onSelect(t);
													}
												}}
											>
												<span className="trank">{String(rank).padStart(2, "0")}</span>
												<div style={{ minWidth: 0 }}>
													<p className="tkick">
														{taskActionLabel(t)} · {taskKindLabel(t)}
													</p>
													<p className="tname">
														{group.tasks.length > 1 ? taskRef(t) : t.title}
														{t.meta ? <span className="tname__ref">{t.meta}</span> : null}
													</p>
													<p className="tsub" title={t.subtitle}>
														{t.subtitle}
														{t.kind === "booking" ? ` · ${t.record.clientEmail}` : ""}
													</p>
												</div>
												<span className="twhen">{taskWhen(t, now)}</span>
												<span className={`town${open ? " town--none" : ""}`}>
													{open ? "— open" : isMe(t) ? <span className="town__you">You</span> : t.owner}
													{t.kind === "consultation" && t.record.coordinatorName ? (
														<span className="town__coord" title={`Steered by ${t.record.coordinatorName}`}>
															→ {t.record.coordinatorName.split(" ")[0]}
														</span>
													) : null}
												</span>
												{canSeeAllBranches ? (
													<span className="tbranch">{branchName(t.branch || "") || "—"}</span>
												) : (
													<span className="tbranch" />
												)}
												<span onClick={(e) => e.stopPropagation()}>
													{canAssign ? (
														<button
															type="button"
															className="btn btn--primary btn--sm"
															onClick={() => (t.kind === "booking" ? setBooking(t.record) : setTask(t))}
														>
															Handler…
														</button>
													) : (
														<Link to={t.linkTo} className="btn btn--ghost btn--sm">
															Open →
														</Link>
													)}
												</span>
											</div>
										);
									})}
								</div>
							))}
						</div>
					))}
				</div>
			)}

			{booking && (
				<AssignDialog
					booking={booking}
					onClose={() => setBooking(null)}
					onAssigned={(updated) => {
						setBooking(null);
						setJustAssigned(
							`${updated.clientName} assigned to ${updated.employeeName}.${
								updated.meetingUrl
									? " Meeting link created and sent."
									: " You can add a video meeting link in the Consultations module if required."
							}`,
						);
						void onAssigned();
					}}
				/>
			)}

			{task && (
				<AssignTaskDialog
					task={task}
					assignees={assignees}
					onClose={() => setTask(null)}
					onAssign={(to, placement) =>
						onAssign(task, to, placement).then(() => {
							void onAssigned();
						})
					}
					onKeepHandler={
						onKeepHandler
							? (reason) =>
									onKeepHandler(task, reason).then(() => {
										void onAssigned();
									})
							: undefined
					}
					onLeaveOpen={
						onLeaveOpen
							? (branch) =>
									onLeaveOpen(task, branch).then(() => {
										void onAssigned();
									})
							: undefined
					}
				/>
			)}
		</>
	);
}

export function PendingTasks({
	title = "Pending Tasks",
	branchFilter = "all",
}: {
	title?: string;
	branchFilter?: string;
}) {
	const { canAssignWork } = useOpsAuth();
	const { assignees, assignConsultation, assignApplication, referConsultation, referApplication, resolveHandoff } = useCases();
	const { items, loading, error, refresh } = useWorkQueue(branchFilter);

	const doAssign = useCallback(
		async (task: PendingTask, to: Assignee, placement: HandlerPlacement) => {
			if (task.kind === "consultation") {
				return assignConsultation(task.record.id, to, { scope: placement.scope, branch: placement.branch });
			}
			if (task.kind === "application") {
				return assignApplication(task.record.id, to, { scope: placement.scope, branch: placement.branch });
			}
			if (task.kind === "handoff" && task.action === "resolve") {
				return resolveHandoff(task.record.id, "assign", {
					opsUserId: to.opsUserId,
					reason: placement.reason,
					scope: placement.scope,
					branch: placement.branch,
				});
			}
			if (task.kind === "travel" && to.opsUserId) {
				return applicationsApi.assignTravelHandler(task.record.id, to.opsUserId);
			}
			throw new Error("This task cannot be assigned from here.");
		},
		[assignConsultation, assignApplication, resolveHandoff],
	);

	const doKeepHandler = useCallback(
		async (task: PendingTask, reason?: string) => {
			if (task.kind === "handoff" && task.action === "resolve") {
				return resolveHandoff(task.record.id, "keep", { reason: reason || undefined });
			}
			throw new Error("This task does not support keeping the previous handler.");
		},
		[resolveHandoff],
	);

	// "Leave it open" refers the file to the chosen branch — the receiving
	// desk staffs it from their own queue. Bookings keep their own dialog.
	const doLeaveOpen = useCallback(
		async (task: PendingTask, branch: string) => {
			if (task.kind === "consultation") return referConsultation(task.record.id, branch);
			if (task.kind === "application" || task.kind === "visa") return referApplication(task.record.id, branch);
			if (task.kind === "handoff" && task.record.applicationId) return referApplication(task.record.applicationId, branch);
			if (task.kind === "travel") return referApplication(task.record.applicationId, branch);
			throw new Error("This task cannot be referred from here.");
		},
		[referConsultation, referApplication],
	);

	if (!canAssignWork) return null;

	return (
		<section className="ops-panel" aria-labelledby="pending-heading">
			<header className="ops-panel__head">
				<h2 id="pending-heading" className="section-title">
					{title}
					{items.length > 0 && <span className="ops-pill">{items.length}</span>}
				</h2>
				<button type="button" className="btn btn--ghost btn--sm" onClick={refresh}>
					Refresh
				</button>
			</header>

			{error && <p className="ops-modal__error">{error}</p>}

			{loading ? (
				<p className="ops-panel__muted">Loading…</p>
			) : (
				<PendingTaskTable
					items={items}
					assignees={assignees}
					canAssignWork={canAssignWork}
					onAssign={doAssign}
					onKeepHandler={doKeepHandler}
					onLeaveOpen={doLeaveOpen}
					onAssigned={refresh}
					emptyLabel="Nothing waiting to be assigned. All caught up."
				/>
			)}
		</section>
	);
}