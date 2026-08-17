import { useMemo, useState } from "react";
import { useOpsAuth } from "./OpsAuthContext";
import { useTicketsApi } from "../hooks/useTicketsApi";
import { branchName } from "century-nit-core/ops";
import type {
	InternalTicket,
	TicketCategory,
	TicketPriority,
	TicketStatus,
} from "./OpsStateContext";

/**
 * Helpdesk.
 *
 * Two queues in one place, deliberately kept visually distinct:
 *  - **External** — raised by applicants from the client portal. Customer
 *    facing: every staff reply is shown to the applicant, so these carry
 *    identity, a case reference, and a conversation thread.
 *  - **Internal** — staff to staff. Never leaves the Operations Center.
 *
 * Manager and coordinator triage both and route them to a colleague or escalate
 * to system administration. Everyone else sees only what is assigned to them.
 */

const STATUSES: TicketStatus[] = ["Open", "In Progress", "Waiting", "Resolved"];
const PRIORITIES: TicketPriority[] = ["Low", "Medium", "High", "Urgent"];
const CATEGORIES: TicketCategory[] = [
	"Technical",
	"Application",
	"Documents",
	"Billing",
	"Visa",
	"Other",
];

type Queue = "external" | "internal";

export function EnterpriseHelpdesk() {
	const { opsUser, opsRole } = useOpsAuth();

	const {
		tickets: allTickets,
		error: ticketsError,
		staffList,
		assignTicket,
		escalateTicket,
		updateTicketStatus,
		replyToTicket,
		createTicket,
	} = useTicketsApi();

	const [queue, setQueue] = useState<Queue>("external");
	const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
	const [search, setSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [composing, setComposing] = useState(false);
	const [reply, setReply] = useState("");

	const [form, setForm] = useState({
		title: "",
		description: "",
		category: "Technical" as TicketCategory,
		priority: "Medium" as TicketPriority,
	});

	const by = opsUser?.name ?? "Staff";
	/** Manager and coordinator are the triage desk; admin handles escalations */
	const canTriage = opsRole === "manager" || opsRole === "coordinator";
	const isAdmin = opsRole === "admin";

	const scoped = useMemo(() => {
		if (canTriage) return allTickets;
		if (isAdmin) return allTickets.filter((t) => t.escalatedToAdmin || t.source === "internal");
		return allTickets.filter(
			(t) => t.assignedToEmail === opsUser?.email || t.createdBy === opsUser?.name,
		);
	}, [allTickets, canTriage, isAdmin, opsUser]);

	const inQueue = scoped.filter((t) => t.source === queue);

	const filtered = inQueue.filter((t) => {
		if (statusFilter !== "all" && t.status !== statusFilter) return false;
		if (!search) return true;
		const hay = `${t.ref} ${t.title} ${t.createdBy} ${t.applicantRef ?? ""}`.toLowerCase();
		return hay.includes(search.toLowerCase());
	});

	const selected = scoped.find((t) => t.id === selectedId) ?? null;

	const counts = useMemo(() => {
		const ext = scoped.filter((t) => t.source === "external");
		const int = scoped.filter((t) => t.source === "internal");
		return {
			external: ext.length,
			internal: int.length,
			untriaged: ext.filter((t) => !t.assignedTo && !t.escalatedToAdmin && t.status !== "Resolved").length,
			urgent: scoped.filter((t) => t.priority === "Urgent" && t.status !== "Resolved").length,
		};
	}, [scoped]);

	function submitNew(e: React.FormEvent) {
		e.preventDefault();
		if (!form.title.trim() || !form.description.trim()) return;
		createTicket({
			title: form.title.trim(),
			description: form.description.trim(),
			category: form.category,
			priority: form.priority,
		});
		setForm({ title: "", description: "", category: "Technical", priority: "Medium" });
		setComposing(false);
	}

	function sendReply() {
		if (!selected || !reply.trim()) return;
		replyToTicket(selected.id, reply.trim(), by, "staff");
		setReply("");
	}

	return (
		<div className="page-content fade-in hd-page">
			<div className="admin-section-head" style={{ marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Helpdesk</h1>
					<p className="lead mt-1">
						{canTriage
							? "Client requests from the portal and internal staff tickets. Triage, assign, or escalate."
							: "Tickets assigned to you, and the ones you raised."}
					</p>
				</div>
				<button type="button" className="btn btn--primary btn--sm" onClick={() => setComposing(true)}>
					+ Raise internal ticket
				</button>
			</div>

			{ticketsError && <p className="muted mt-2" style={{ color: "var(--error, #b00)" }}>{ticketsError}</p>}

			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
				<HdStat label="From clients" value={counts.external} note="Raised in the portal" />
				<HdStat label="Internal" value={counts.internal} note="Staff to staff" />
				<HdStat label="Awaiting triage" value={counts.untriaged} note="Unassigned client tickets" accent={counts.untriaged > 0} />
				<HdStat label="Urgent" value={counts.urgent} note="Open at top priority" inverted />
			</div>

			{/* Queue switch — external and internal never share a list */}
			<div className="hd-queues" role="tablist" aria-label="Ticket queues">
				<button
					role="tab"
					aria-selected={queue === "external"}
					className={`hd-queue${queue === "external" ? " hd-queue--active" : ""}`}
					onClick={() => {
						setQueue("external");
						setSelectedId(null);
					}}
				>
					<span className="hd-queue__dot hd-queue__dot--external" aria-hidden />
					Client requests
					<span className="hd-queue__count">{counts.external}</span>
				</button>
				<button
					role="tab"
					aria-selected={queue === "internal"}
					className={`hd-queue${queue === "internal" ? " hd-queue--active" : ""}`}
					onClick={() => {
						setQueue("internal");
						setSelectedId(null);
					}}
				>
					<span className="hd-queue__dot hd-queue__dot--internal" aria-hidden />
					Internal
					<span className="hd-queue__count">{counts.internal}</span>
				</button>
			</div>

			{composing ? (
				<form className="card admin-form-card hd-compose" onSubmit={submitNew}>
					<h2 className="admin-form-card__title">New internal ticket</h2>
					<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
						<label className="hd-field">
							<span className="eyebrow">Title</span>
							<input
								className="input input--full-border"
								value={form.title}
								onChange={(e) => setForm({ ...form, title: e.target.value })}
								placeholder="e.g. Consultant dropdown disabled on case 402"
							/>
						</label>
						<div className="hd-field-row">
							<label className="hd-field">
								<span className="eyebrow">Category</span>
								<select
									className="input input--full-border"
									value={form.category}
									onChange={(e) => setForm({ ...form, category: e.target.value as TicketCategory })}
								>
									{CATEGORIES.map((c) => (
										<option key={c}>{c}</option>
									))}
								</select>
							</label>
							<label className="hd-field">
								<span className="eyebrow">Priority</span>
								<select
									className="input input--full-border"
									value={form.priority}
									onChange={(e) => setForm({ ...form, priority: e.target.value as TicketPriority })}
								>
									{PRIORITIES.map((p) => (
										<option key={p}>{p}</option>
									))}
								</select>
							</label>
						</div>
					</div>
					<label className="hd-field" style={{ marginTop: "1rem" }}>
						<span className="eyebrow">Description</span>
						<textarea
							className="input input--full-border"
							rows={4}
							value={form.description}
							onChange={(e) => setForm({ ...form, description: e.target.value })}
							placeholder="What happened, and what did you expect instead?"
						/>
					</label>
					<div className="admin-form-card__actions">
						<button type="submit" className="btn btn--primary btn--sm" disabled={!form.title.trim() || !form.description.trim()}>
							Raise ticket
						</button>
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => setComposing(false)}>
							Cancel
						</button>
					</div>
				</form>
			) : null}

			<div className="ops-split hd-split">
				{/* Queue list */}
				<div className="ops-split__list hd-list">
					<div className="hd-list__head">
						<input
							type="search"
							className="input input--sm"
							placeholder="Search ref, subject, client…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							style={{ width: "100%" }}
						/>
						<div className="admin-env-tabs" style={{ marginTop: "0.5rem" }}>
							{(["all", ...STATUSES] as const).map((s) => (
								<button
									key={s}
									className={`admin-env-tab${statusFilter === s ? " admin-env-tab--active" : ""}`}
									onClick={() => setStatusFilter(s)}
								>
									{s === "all" ? "All" : s}
								</button>
							))}
						</div>
					</div>

					<div className="hd-list__body">
						{filtered.length === 0 ? (
							<p className="muted hd-empty">
								{queue === "external" ? "No client requests match." : "No internal tickets match."}
							</p>
						) : (
							filtered.map((t) => (
								<button
									key={t.id}
									className={`hd-row${selectedId === t.id ? " hd-row--active" : ""}`}
									onClick={() => {
										setSelectedId(t.id);
										setReply("");
									}}
								>
									<span className="hd-row__top">
										<span className="hd-row__ref mono">{t.ref}</span>
										<PriorityTag priority={t.priority} />
									</span>
									<span className="hd-row__title">{t.title}</span>
									<span className="hd-row__meta mono">
										{t.source === "external" ? t.createdBy : `Raised by ${t.createdBy}`}
										{t.applicantRef ? ` · ${t.applicantRef}` : ""}
									</span>
									<span className="hd-row__foot">
										<StatusTag status={t.status} />
										<span className="hd-row__owner mono">
											{t.escalatedToAdmin
												? "→ System admin"
												: t.assignedTo || "Unassigned"}
										</span>
									</span>
								</button>
							))
						)}
					</div>
				</div>

				{/* Detail */}
				<div className="ops-split__detail hd-detail">
					{!selected ? (
						<div className="hd-placeholder">
							<p className="muted">Select a ticket to read the thread and route it.</p>
						</div>
					) : (
						<TicketDetail
							ticket={selected}
							canTriage={canTriage}
							by={by}
							staffList={staffList}
							reply={reply}
							setReply={setReply}
							onSend={sendReply}
							onAssign={(to) => assignTicket(selected.id, to, by)}
							onEscalate={() => escalateTicket(selected.id, by)}
							onStatus={(s) => updateTicketStatus(selected.id, s, by)}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function TicketDetail({
	ticket,
	canTriage,
	by,
	staffList,
	reply,
	setReply,
	onSend,
	onAssign,
	onEscalate,
	onStatus,
}: {
	ticket: InternalTicket;
	canTriage: boolean;
	by: string;
	staffList: { id: string; name: string; email: string; role: string; branch: string | null }[];
	reply: string;
	setReply: (v: string) => void;
	onSend: () => void;
	onAssign: (to: { name: string; email: string } | null) => void;
	onEscalate: () => void;
	onStatus: (s: TicketStatus) => void;
}) {
	const external = ticket.source === "external";

	return (
		<>
			<header className={`hd-head${external ? " hd-head--external" : ""}`}>
				<div className="hd-head__main">
					<div className="hd-head__tags">
						<span className={`hd-source hd-source--${ticket.source}`}>
							{external ? "Client request" : "Internal"}
						</span>
						<span className="hd-head__ref mono">{ticket.ref}</span>
						<PriorityTag priority={ticket.priority} />
					</div>
					<h2 className="hd-head__title">{ticket.title}</h2>
					<p className="hd-head__meta mono">
						{external ? ticket.createdBy : `Raised by ${ticket.createdBy}`}
						{ticket.createdByEmail ? ` · ${ticket.createdByEmail}` : ""}
						{ticket.applicantRef ? ` · ${ticket.applicantRef}` : ""}
						{` · ${ticket.category}`}
					</p>
				</div>
				<div className="hd-head__status">
					<select
						className="input input--sm"
						value={ticket.status}
						onChange={(e) => onStatus(e.target.value as TicketStatus)}
						aria-label="Ticket status"
					>
						{STATUSES.map((s) => (
							<option key={s}>{s}</option>
						))}
					</select>
				</div>
			</header>

			{/* Routing — the triage desk's controls */}
			<div className="hd-route">
				<div className="hd-route__current">
					<span className="eyebrow">Assigned to</span>
					<span className="hd-route__who">
						{ticket.escalatedToAdmin
							? "System administration"
							: ticket.assignedTo || "Nobody — awaiting triage"}
					</span>
				</div>
				{canTriage ? (
					<div className="hd-route__actions">
						<select
							className="input input--sm"
							value={ticket.assignedToEmail}
							onChange={(e) => {
								const to = staffList.find((s) => s.email === e.target.value);
								onAssign(to ? { name: to.name, email: to.email } : null);
							}}
							aria-label="Assign ticket"
						>
							<option value="">Assign to…</option>
							{staffList.map((s) => (
								<option key={s.email} value={s.email}>
									{s.name} · {s.role} · {branchName(s.branch ?? "")}
								</option>
							))}
						</select>
						<button
							type="button"
							className="btn btn--ghost btn--sm"
							onClick={onEscalate}
							disabled={ticket.escalatedToAdmin}
						>
							{ticket.escalatedToAdmin ? "With system admin" : "Escalate to system admin"}
						</button>
					</div>
				) : (
					<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
						Only a manager or coordinator can route tickets.
					</span>
				)}
			</div>

			{/* Thread */}
			<div className="hd-thread">
				{external ? (
					<p className="hd-thread__notice mono">
						Replies here are shown to the applicant in their portal.
					</p>
				) : null}

				{ticket.messages.length === 0 ? (
					<div className="hd-msg hd-msg--staff">
						<p className="hd-msg__body">{ticket.description}</p>
						<p className="hd-msg__meta mono">
							{ticket.createdBy} · {new Date(ticket.createdAt).toLocaleString()}
						</p>
					</div>
				) : (
					ticket.messages.map((m) => (
						<div key={m.id} className={`hd-msg hd-msg--${m.role}`}>
							<p className="hd-msg__body">{m.body}</p>
							<p className="hd-msg__meta mono">
								{m.author} · {new Date(m.at).toLocaleString()}
							</p>
						</div>
					))
				)}
			</div>

			<div className="hd-reply">
				<textarea
					className="input input--full-border"
					rows={3}
					value={reply}
					onChange={(e) => setReply(e.target.value)}
					placeholder={external ? `Reply to ${ticket.createdBy}…` : `Add a note as ${by}…`}
				/>
				<div className="hd-reply__actions">
					<button type="button" className="btn btn--primary btn--sm" onClick={onSend} disabled={!reply.trim()}>
						{external ? "Send reply" : "Post note"}
					</button>
					{ticket.status !== "Resolved" ? (
						<button type="button" className="btn btn--ghost btn--sm" onClick={() => onStatus("Resolved")}>
							Mark resolved
						</button>
					) : null}
				</div>
			</div>
		</>
	);
}

function StatusTag({ status }: { status: TicketStatus }) {
	return <span className={`hd-status hd-status--${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</span>;
}

function PriorityTag({ priority }: { priority: TicketPriority }) {
	return <span className={`hd-prio hd-prio--${priority.toLowerCase()}`}>{priority}</span>;
}

function HdStat({
	label,
	value,
	note,
	inverted,
	accent,
}: {
	label: string;
	value: number;
	note: string;
	inverted?: boolean;
	accent?: boolean;
}) {
	return (
		<div
			className="card"
			style={
				inverted
					? { background: "var(--foreground)", color: "var(--background)" }
					: accent
						? { borderColor: "var(--foreground)", borderWidth: "2px" }
						: undefined
			}
		>
			<p className="eyebrow" style={inverted ? { color: "var(--muted)" } : undefined}>
				{label}
			</p>
			<p className="page-title mt-1" style={{ fontSize: "1.75rem", ...(inverted ? { color: "var(--background)" } : {}) }}>
				{value}
			</p>
			<p className="muted mt-1" style={{ fontSize: "var(--text-xs)", ...(inverted ? { color: "var(--muted)" } : {}) }}>
				{note}
			</p>
		</div>
	);
}
