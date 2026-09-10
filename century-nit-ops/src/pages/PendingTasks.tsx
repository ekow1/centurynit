import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, bookingsApi } from "century-nit-core/api";
import type { Assignee } from "century-nit-core/ops";
import type { Booking } from "century-nit-shared";
import type { Lead } from "century-nit-core";
import { useOpsAuth } from "./OpsAuthContext";
import { useCases } from "../hooks/useCases";
import { useInvoiceApi } from "../hooks/useInvoiceApi";
import { apiFetch } from "../lib/api";
import { API_PREFIX } from "century-nit-shared";
import { AssignDialog } from "./UnassignedBookings";
import {
	buildInvoiceRows,
	buildPendingTasks,
	formatBookingWhenCompact,
	PRIORITY,
	sortTasks,
	taskActionLabel,
	TASK_KIND_LABEL,
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
	const eligibleAssignees = assignees.filter(
		(a) => a.branch === task.branch || !task.branch || task.branch === "",
	);
	// Fall back to all staff when the branch filter produces an empty list —
	// otherwise the dropdown says "No staff are configured for this branch"
	// and the manager cannot assign at all (e.g. consultation branch has no
	// matching staff, or the applicant's branch was never set).
	const assigneeOptions = eligibleAssignees.length > 0 ? eligibleAssignees : assignees;
	const [assigneeId, setAssigneeId] = useState("");
	const [reason, setReason] = useState("");
	const [assigning, setAssigning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function doAssign() {
		const to = assignees.find((a) => a.email === assigneeId || a.opsUserId === assigneeId);
		if (!to) return;
		setAssigning(true);
		setError(null);
		try {
			await onAssign(to, reason || undefined);
			onClose();
		} catch (err) {
			setError(
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: "Could not assign. Please try again.",
			);
			setAssigning(false);
		}
	}

	return (
		<div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label="Assign task">
			<div className="ops-modal">
				<header className="ops-modal__head">
					<div>
						<h2 className="ops-modal__title">Assign {taskActionLabel(task).toLowerCase()}</h2>
						<p className="ops-modal__sub">
							{task.title} · {task.subtitle}
						</p>
					</div>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
						Close
					</button>
				</header>

				{error && <p className="ops-modal__error">{error}</p>}

				{assigneeOptions.length === 0 ? (
					<p className="ops-modal__muted">No staff are configured for this branch.</p>
				) : (
					<label className="field" style={{ marginBottom: "0.75rem" }}>
						<span className="field-label">Assign to</span>
						<select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
							<option value="">Select staff…</option>
							{assigneeOptions.map((a) => (
								<option key={a.email} value={a.email}>
									{a.name}
									{a.role ? ` — ${a.role}` : ""}
									{a.branch ? ` · ${a.branch}` : ""}
								</option>
							))}
						</select>
					</label>
				)}

				{task.kind === "handoff" && (
					<label className="field" style={{ marginBottom: "0.75rem" }}>
						<span className="field-label">Reason (optional)</span>
						<input
							className="input"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="Why this assignment"
						/>
					</label>
				)}

				<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
					{task.kind === "handoff" && onKeepHandler && (
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							disabled={assigning}
							onClick={() => {
								setAssigning(true);
								setError(null);
								onKeepHandler(reason || undefined)
									.then(() => onClose())
									.catch((err) => {
										setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not resolve");
										setAssigning(false);
									});
							}}
						>
							{assigning
								? "Resolving…"
								: task.record?.fromOpsUserName
									? `Keep ${task.record.fromOpsUserName}`
									: "Keep previous handler"}
						</button>
					)}
					<button
						type="button"
						className="btn btn--primary btn--sm"
						disabled={!assigneeId || assigning}
					onClick={doAssign}
					>
						{assigning ? "Assigning…" : "Assign"}
					</button>
				</div>

				<p className="ops-modal__foot">
					Assigning notifies the staff member and moves the item out of the pending queue.
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
}) {
	const [booking, setBooking] = useState<Booking | null>(null);
	const [task, setTask] = useState<PendingTask | null>(null);
	const [justAssigned, setJustAssigned] = useState<string | null>(null);

	const isAssignable = (t: PendingTask) =>
		canAssignWork && (t.action === "assign" || t.action === "resolve");

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
								<th>Task</th>
								<th>Type</th>
								<th>When / Details</th>
								<th>Branch</th>
								<th>Owner</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{items.map((t) => {
								const canAssign = isAssignable(t);
								const selected = selectedId === t.id;
								return (
									<tr
										key={t.id}
										onClick={onSelect ? () => onSelect(t) : undefined}
										style={{
											...(selected
												? { background: "var(--foreground)", color: "var(--background)" }
												: {}),
											...(onSelect ? { cursor: "pointer" } : {}),
										}}
									>
										<td>
											<strong>{t.title}</strong>
											<div className="ops-table__sub">{t.subtitle}</div>
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
											<span className="ops-pill">{TASK_KIND_LABEL[t.kind]}</span>
											<div className="ops-table__sub">{taskActionLabel(t)}</div>
										</td>
										<td>{t.meta}</td>
										<td>{t.branch || "—"}</td>
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
		invoiceRows,
		invoices,
		leads,
		liveIds,
		bookings,
		inBranch,
	]);

	const doAssign = useCallback(
		async (task: PendingTask, to: Assignee, reason?: string) => {
			if (task.kind === "consultation" && task.action === "assign") {
				return assignConsultation(task.record.id, to);
			}
			if (task.kind === "application" && task.action === "assign") {
				return assignApplication(task.record.id, to);
			}
			if (task.kind === "handoff" && task.action === "resolve") {
				return resolveHandoff(task.record.id, "assign", {
					opsUserId: to.opsUserId,
					reason: reason || undefined,
				});
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