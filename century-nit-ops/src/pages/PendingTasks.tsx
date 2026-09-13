import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, applicationsApi, bookingsApi } from "century-nit-core/api";
import type { Assignee } from "century-nit-core/ops";
import type { Booking } from "century-nit-shared";
import { OPS_BRANCHES } from "century-nit-core/ops";
import type { Lead } from "century-nit-core";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { apiFetch } from "../lib/api";
import { API_PREFIX } from "century-nit-shared";
import { AssignControl } from "century-nit-core/ui";
import { AssignDialog } from "./UnassignedBookings";
import {
	buildInvoiceRows,
	buildPendingTasks,
	formatBookingWhenCompact,
	isOverdue,
	priorityNotches,
	queueBand,
	QUEUE_BAND_LABEL,
	type QueueBand,
	handoffOffersKeep,
	PRIORITY,
	sortTasks,
	taskActionLabel,
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

export function AssignTaskDialog({
	task,
	assignees,
	onClose,
	onAssign,
	onKeepHandler,
}: {
	task: PendingTask;
	assignees: Assignee[];
	onClose: () => void;
	onAssign: (to: Assignee, reason?: string) => Promise<unknown>;
	onKeepHandler?: (reason?: string) => Promise<unknown>;
}) {
	// Which stage the picker is staffing — decides which roles are offered.
	const stageForRoles =
		task.kind === "handoff"
			? task.record.stage
			: task.kind === "travel"
				? "travel_assistance"
				: task.kind === "application"
					? "school_submission"
					: "consultation";
	const current = task.owner && task.owner !== "Unassigned" ? task.owner : null;

	return (
		<div
			className="ops-modal-backdrop"
			role="dialog"
			aria-modal="true"
			aria-label={current ? "Reassign task" : "Assign task"}
		>
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">
							{current ? "Reassign" : "Assign"} {taskActionLabel(task).toLowerCase()}
						</h2>
						<p className="ops-modal__sub">
							{task.title} · {task.subtitle}
						</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
						Close
					</button>
				</header>

				<AssignControl
					stage={stageForRoles}
					staff={assignees}
					branch={task.branch}
					currentName={current}
					keepName={task.kind === "handoff" && onKeepHandler && handoffOffersKeep(task.record) ? task.record.fromOpsUserName : null}
					withReason={task.kind === "handoff"}
					onAssign={async (opsUserId, reason) => {
						const to = assignees.find((a) => a.opsUserId === opsUserId);
						if (!to) throw new Error("Staff member not found");
						await onAssign(to, reason);
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
				/>

				<p className="ops-modal__foot">
					{current
						? "Reassigning transfers ownership to the new staff member and notifies them."
						: "Assigning notifies the staff member and moves the item out of the pending queue."}
				</p>
			</div>
		</div>
	);
}

export function PendingTaskTable({
	items,
	assignees,
	canAssignWork,
	onAssign,
	onKeepHandler,
	onAssigned,
	onSelect,
	selectedId,
	emptyLabel,
	groupByPerson = false,
}: {
	items: PendingTask[];
	assignees: Assignee[];
	canAssignWork: boolean;

	onAssign: (task: PendingTask, to: Assignee, reason?: string) => Promise<unknown>;
	onKeepHandler?: (task: PendingTask, reason?: string) => Promise<unknown>;
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
								<th>Assigned</th>
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
								// Assign shows only for unowned work — a handoff is unowned
								// by definition (its "owner" column is the previous handler).
								const canAssign =
									isAssignable(t) && (t.owner === "Unassigned" || t.action === "resolve");
								const selected = selectedId === t.id;
								const overdue = isOverdue(t);
								const notches = priorityNotches(t.priority);
								return (
									<tr
										key={t.id}
										onClick={onSelect ? () => onSelect(t) : undefined}
										style={{
											...(selected
												? { background: "var(--foreground)", color: "var(--background)" }
												: {}),
											...(onSelect ? { cursor: "pointer" } : {}),
											...(overdue && !selected ? { boxShadow: "inset 4px 0 0 var(--foreground)" } : {}),
										}}
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
										{canSeeAllBranches && <td>{OPS_BRANCHES.find(b => b.id === t.branch)?.name || t.branch || "—"}</td>}
										<td>{t.owner}</td>
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
													{t.kind === "booking" ? "Assign employee" : "Assign"}
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
					onAssign={(to, reason) =>
						onAssign(task, to, reason).then(() => {
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
				/>
			)}
		</>
	);
}

/* ── The queue as people ─────────────────────────────────────────────── */

/** One card per client per band: their things together. */
type PersonCard = { name: string; things: PendingTask[]; due: number };

function personCards(rows: PendingTask[], byDue: boolean): PersonCard[] {
	const byName = new Map<string, PersonCard>();
	for (const t of rows) {
		const card = byName.get(t.title) ?? { name: t.title, things: [], due: Number.POSITIVE_INFINITY };
		card.things.push(t);
		const due = t.due ? new Date(t.due).getTime() : Number.NaN;
		if (!Number.isNaN(due)) card.due = Math.min(card.due, due);
		byName.set(t.title, card);
	}
	// Queue order puts a client where their most urgent thing sits; the
	// Today band reads by the clock instead — the earliest slot first.
	const cards = [...byName.values()];
	if (byDue) cards.sort((a, b) => a.due - b.due || a.name.localeCompare(b.name));
	return cards;
}

type CardSection = { band: QueueBand | null; count: number; note?: string; cards: PersonCard[] };

function cardSections(items: PendingTask[], bands: boolean, now: Date): CardSection[] {
	if (!bands) return [{ band: null, count: items.length, cards: personCards(items, false) }];
	const by: Record<QueueBand, PendingTask[]> = { today: [], overdue: [], rest: [] };
	for (const t of items) by[queueBand(t, now)].push(t);
	const live = by.today.filter((t) => t.isLive).length;
	const oldestMs = by.overdue.reduce((max, t) => {
		const d = t.due ? new Date(t.due).getTime() : Number.NaN;
		return Number.isNaN(d) ? max : Math.max(max, now.getTime() - d);
	}, 0);
	const oldestDays = Math.floor(oldestMs / 86_400_000);
	return (
		[
			{ band: "today", count: by.today.length, note: live > 0 ? `${live} live now` : undefined, cards: personCards(by.today, true) },
			{ band: "overdue", count: by.overdue.length, note: oldestDays >= 1 ? `oldest ${oldestDays} day${oldestDays === 1 ? "" : "s"}` : undefined, cards: personCards(by.overdue, false) },
			{ band: "rest", count: by.rest.length, cards: personCards(by.rest, false) },
		] as CardSection[]
	).filter((s) => s.count > 0);
}

/** The card's head stamp: the earliest deadline, or when the thing last moved. */
function cardWhen(card: PersonCard, now: Date): string {
	if (Number.isFinite(card.due)) {
		const d = new Date(card.due);
		const today = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
		if (today) return `Today ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
		return `Due ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
	}
	return whenLabel(card.things[0]?.at);
}

/**
 * The Workspace queue: person cards in the day's bands. The same tasks and
 * the same Assign affordances as the table; a thing is clicked to preview
 * it in the rail, the card's foot assigns an unowned one.
 */
export function PendingTaskCards({
	items,
	assignees,
	canAssignWork,
	onAssign,
	onKeepHandler,
	onAssigned,
	onSelect,
	selectedId,
	emptyLabel,
	bands = false,
}: {
	items: PendingTask[];
	assignees: Assignee[];
	canAssignWork: boolean;
	onAssign: (task: PendingTask, to: Assignee, reason?: string) => Promise<unknown>;
	onKeepHandler?: (task: PendingTask, reason?: string) => Promise<unknown>;
	onAssigned: () => void | Promise<void>;
	onSelect: (task: PendingTask) => void;
	selectedId?: string | null;
	emptyLabel?: string;
	/** Cut the queue into Today (by the clock) · Overdue · Everything else. */
	bands?: boolean;
}) {
	const { canSeeAllBranches } = useOpsAuth();
	const [booking, setBooking] = useState<Booking | null>(null);
	const [task, setTask] = useState<PendingTask | null>(null);
	const [justAssigned, setJustAssigned] = useState<string | null>(null);
	const now = new Date();
	// Cheap for a queue's worth of tasks; recomputed with the clock each render.
	const sections = cardSections(items, bands, now);

	const isAssignable = (t: PendingTask) =>
		canAssignWork &&
		(t.kind === "booking" ||
			t.kind === "consultation" ||
			t.kind === "application" ||
			(t.kind === "travel" && t.action === "assign") ||
			t.action === "resolve") &&
		(t.owner === "Unassigned" || t.action === "resolve");

	return (
		<>
			{justAssigned && <p className="ops-panel__ok" style={{ margin: "0.75rem 1rem 0" }}>{justAssigned}</p>}
			{items.length === 0 ? (
				<p className="ops-people__empty">{emptyLabel ?? "Nothing pending right now."}</p>
			) : (
				<div className="ops-bands">
					{sections.map((section) => (
						<div key={section.band ?? "all"}>
							{section.band && (
								<div className="ops-band">
									<span className="ops-band__name">
										{QUEUE_BAND_LABEL[section.band]} · {section.count}
									</span>
									{section.note && <span className="ops-band__note">{section.note}</span>}
								</div>
							)}
							<div className="ops-people">
								{section.cards.map((card) => {
									const live = card.things.some((t) => t.isLive);
									const overdue = card.things.some((t) => isOverdue(t, now));
									const toAssign = card.things.find(isAssignable) ?? null;
									const owners = [...new Set(card.things.map((t) => t.owner).filter((o) => o && o !== "Unassigned"))];
									const branch = card.things[0]?.branch;
									const branchName = branch ? OPS_BRANCHES.find((b) => b.id === branch)?.name || branch : null;
									return (
										<div key={`${section.band ?? "all"}-${card.name}`} className={`ops-person${live ? " ops-person--live" : ""}${overdue ? " ops-person--overdue" : ""}`}>
											<div className="ops-person__head">
												<span className="ops-person__name" title={card.name}>
													{card.name}
													{card.things.length > 1 && <span className="ops-person__count">{card.things.length} things</span>}
												</span>
												<span className="ops-person__when">{cardWhen(card, now)}</span>
											</div>
											<ul className="ops-things">
												{card.things.map((t) => {
													const selected = selectedId === t.id;
													const late = isOverdue(t, now);
													const notches = priorityNotches(t.priority);
													const pick = () => onSelect(t);
													return (
														<li
															key={t.id}
															className={`ops-thing${selected ? " ops-thing--selected" : ""}`}
															role="button"
															tabIndex={0}
															aria-pressed={selected}
															onClick={pick}
															onKeyDown={(e) => {
																if (e.key === "Enter" || e.key === " ") {
																	e.preventDefault();
																	pick();
																}
															}}
														>
															<span className="ops-meter" aria-hidden title={notches === 3 ? "Urgent — top of the queue" : notches === 2 ? "Soon" : "Routine"}>
																<span>{"●".repeat(notches)}</span>
																<span className="ops-meter__off">{"●".repeat(3 - notches)}</span>
															</span>
															<div className="ops-thing__main">
																<div className="ops-thing__top">
																	<span className="ops-thing__kicker">
																		{taskActionLabel(t)} <span className="ops-thing__kind">· {TASK_KIND_LABEL[t.kind]}</span>
																	</span>
																	{t.isLive && <span className="ops-pill ops-pill--live">LIVE NOW</span>}
																	{late && <span className="ops-pill ops-pill--strong">Overdue</span>}
																</div>
																<div className="ops-thing__sub" title={t.subtitle}>
																	{t.subtitle}
																	{t.kind === "booking" ? ` · ${t.record.clientEmail}` : ""}
																</div>
															</div>
															<span className="ops-thing__arrow" aria-hidden>
																→
															</span>
														</li>
													);
												})}
											</ul>
											<div className="ops-person__foot">
												<span className="ops-person__meta">
													{canSeeAllBranches && branchName ? `${branchName} · ` : ""}
													{owners.length > 0 ? `Assigned: ${owners.join(", ")}` : "Unassigned"}
												</span>
												{toAssign && (
													<button
														type="button"
														className="cn-row__assign"
														onClick={() => (toAssign.kind === "booking" ? setBooking(toAssign.record) : setTask(toAssign))}
													>
														{toAssign.kind === "booking" ? "Assign employee" : "Assign"}
													</button>
												)}
											</div>
										</div>
									);
								})}
							</div>
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
					onAssign={(to, reason) =>
						onAssign(task, to, reason).then(() => {
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
	const { opsUser, canAssignWork, scopeRecords } = useOpsAuth();
	const {
		consultations,
		applications,
		applicants,
		assignees,
		handoffs,
		travelRequests,
		loading: casesLoading,
		error: casesError,
		refresh,
		assignConsultation,
		assignApplication,
		resolveHandoff,
	} = useCases();
	const { invoices, loading: invoicesLoading } = useInvoiceApi();

	const [bookings, setBookings] = useState<Booking[] | null>(null);
	const [bookingsError, setBookingsError] = useState<string | null>(null);
	const [leads, setLeads] = useState<Lead[]>([]);
	const [liveIds, setLiveIds] = useState<Set<string>>(new Set());

	const loadBookings = useCallback(() => {
		bookingsApi
			.list({ status: "UNASSIGNED" })
			.then((res) => {
				setBookings(res.bookings);
				setBookingsError(null);
			})
			.catch((err: unknown) => {
				setBookings([]);
				setBookingsError(
					err instanceof ApiError && err.isUnauthenticated
						? "Sign in to view bookings."
						: err instanceof Error
							? err.message
							: "Could not load bookings.",
				);
			});
	}, []);

	useEffect(loadBookings, [loadBookings]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await apiFetch<{ leads: (Lead & { targetCountry?: string; assignedStaffName?: string; updatedAt?: string; createdAt?: string })[] }>(`${API_PREFIX}/leads`);
				if (cancelled) return;
				const mapped = (res.leads || []).map((l) => ({
					...l,
					country: l.country || l.targetCountry || "Ghana",
					assignedTo: l.assignedTo || l.assignedStaffName || "Unassigned",
					lastContactAt: l.lastContactAt || l.updatedAt || l.createdAt || new Date().toISOString(),
					phone: l.phone || "—",
				}));
				setLeads(mapped);
			} catch {
				if (!cancelled) setLeads([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const fetchLive = async () => {
			try {
				const res = await bookingsApi.liveMeetings();
				if (!cancelled) setLiveIds(new Set(res.bookings.map((b) => b.id)));
			} catch {
				/* ignore */
			}
		};
		void fetchLive();
		const id = setInterval(fetchLive, 60_000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

	const scopedConsultations = useMemo(
		() =>
			scopeRecords(
				consultations,
				(c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
			),
		[scopeRecords, consultations, opsUser],
	);
	const scopedApplications = useMemo(
		() =>
			scopeRecords(
				applications,
				(a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name,
			),
		[scopeRecords, applications, opsUser],
	);
	const scopedApplicants = useMemo(
		() =>
			scopeRecords(
				applicants,
				(a) => a.assignedOfficerEmail === opsUser?.email || a.assignedOfficer === opsUser?.name,
			),
		[scopeRecords, applicants, opsUser],
	);

	const inBranch = useCallback(
		<T extends { branch: string }>(list: T[]) =>
			branchFilter === "all" ? list : list.filter((x) => x.branch === branchFilter),
		[branchFilter],
	);

	const invoiceRows = useMemo(() => buildInvoiceRows(invoices), [invoices]);

	const items = useMemo<PendingTask[]>(() => {
		const built = buildPendingTasks({
			consultations: inBranch(scopedConsultations),
			applications: inBranch(scopedApplications),
			applicants: inBranch(scopedApplicants),
			handoffs,
			travelRequests,
			invoiceRows,
			invoices,
			leads,
			liveBookingIds: liveIds,
			excludeBookingIds: new Set((bookings ?? []).map((b) => b.id)),
		});
		const bookingTasks: PendingTask[] = (bookings ?? []).map((b) => ({
			id: `booking-${b.id}`,
			category: "needs_assignment",
			kind: "booking",
			action: "assign",
			record: b,
			at: b.startsAt,
			due: b.startsAt,
			title: b.clientName,
			subtitle: b.serviceName,
			meta: formatBookingWhenCompact(b),
			branch: "",
			owner: "Unassigned",
			linkTo: "/consultations",
			priority: PRIORITY.assign_consultation,
			isLive: liveIds.has(b.id),
		}));
		return sortTasks([...built, ...bookingTasks]);
	}, [
		scopedConsultations,
		scopedApplications,
		scopedApplicants,
		handoffs,
		travelRequests,
		invoiceRows,
		invoices,
		leads,
		liveIds,
		bookings,
		inBranch,
	]);

	const doAssign = useCallback(
		async (task: PendingTask, to: Assignee, reason?: string) => {
			if (task.kind === "consultation") {
				return assignConsultation(task.record.id, to);
			}
			if (task.kind === "application") {
				return assignApplication(task.record.id, to);
			}
			if (task.kind === "handoff" && task.action === "resolve") {
				return resolveHandoff(task.record.id, "assign", {
					opsUserId: to.opsUserId,
					reason: reason || undefined,
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

	if (!canAssignWork) return null;

	const loading = (casesLoading || invoicesLoading) && items.length === 0;

	return (
		<section className="ops-panel" aria-labelledby="pending-heading">
			<header className="ops-panel__head">
				<h2 id="pending-heading" className="section-title">
					{title}
					{items.length > 0 && <span className="ops-pill">{items.length}</span>}
				</h2>
				<button
					type="button"
					className="btn btn--ghost btn--sm"
					onClick={() => {
						loadBookings();
						void refresh();
					}}
				>
					Refresh
				</button>
			</header>

			{(bookingsError || casesError) && (
				<p className="ops-modal__error">{bookingsError ?? casesError}</p>
			)}

			{loading ? (
				<p className="ops-panel__muted">Loading…</p>
			) : (
				<PendingTaskTable
					items={items}
					assignees={assignees}
					canAssignWork={canAssignWork}
					onAssign={doAssign}
					onKeepHandler={doKeepHandler}
					onAssigned={() => {
						loadBookings();
						void refresh();
					}}
					emptyLabel="Nothing waiting to be assigned. All caught up."
				/>
			)}
		</section>
	);
}