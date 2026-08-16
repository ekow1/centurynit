import { useMemo, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import { LEAD_STAGE_LABELS } from "century-nit-core";
import { money } from "./currency";
import { API_PREFIX } from "century-nit-shared";
import { apiFetch } from "../lib/api";

interface ApiLead {
	id: string;
	name: string;
	email: string;
	phone: string | null;
	source: string;
	stage: "New Lead" | "Contacted" | "Consultation Booked" | "Assessment Complete" | "Enrolled" | "Lost";
	targetCountry: string | null;
	assignedStaffId: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

type NotificationItem = {
	id: string;
	type: "assignment" | "document" | "lead" | "consultation" | "application" | "finance" | "system";
	title: string;
	detail: string;
	time: string;
	link?: string;
	unread: boolean;
};

function relativeTime(iso: string) {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.round(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

const TYPE_META: Record<NotificationItem["type"], { label: string; color: string }> = {
	assignment: { label: "Assignment", color: "#3b82f6" },
	document: { label: "Document", color: "#f59e0b" },
	lead: { label: "Lead", color: "#8b5cf6" },
	consultation: { label: "Consultation", color: "#06b6d4" },
	application: { label: "Application", color: "#10b981" },
	finance: { label: "Finance", color: "#ef4444" },
	system: { label: "System", color: "#6b7280" },
};

export function EnterpriseInbox() {
	const { opsUser, opsRole, scopeRecords, hasPermission } = useOpsAuth();
	const { consultations, applications, applicants, leads, activityLog, liveCase } = useOpsState();
	const [apiLeads, setApiLeads] = useState<ApiLead[]>([]);
	const [filter, setFilter] = useState<"all" | "unread">("all");

	const loadApiLeads = useCallback(async () => {
		try {
			const res = await apiFetch<{ leads: ApiLead[] }>(`${API_PREFIX}/leads`);
			if (res && Array.isArray(res.leads)) {
				setApiLeads(res.leads);
			}
		} catch {
			// ignore if offline
		}
	}, []);

	useEffect(() => {
		void loadApiLeads();
		const timer = setInterval(loadApiLeads, 10000);
		return () => clearInterval(timer);
	}, [loadApiLeads]);

	const me = opsUser?.name ?? "";

	const notifications = useMemo<NotificationItem[]>(() => {
		const items: NotificationItem[] = [];

		if (liveCase?.present && liveCase.email) {
			items.push({
				id: "live-portal-session-notif",
				type: "lead",
				title: `Active client portal session: ${liveCase.name}`,
				detail: `Signed in as ${liveCase.email} · Current stage: ${liveCase.stageLabel || "New Client"}`,
				time: relativeTime(liveCase.updatedAt || new Date().toISOString()),
				link: "/leads",
				unread: true,
			});
		}

		for (const c of consultations) {
			const isMine = c.assignedOfficer === me;
			if (c.status === "Under Review" && !c.assignedOfficer) {
				items.push({
					id: `unassigned-c-${c.id}`,
					type: "consultation",
					title: `Unassigned consultation: ${c.applicantName}`,
					detail: `Booked for ${c.dateTime} · ${c.targetCountry}`,
					time: c.dateTime,
					link: "/consultations",
					unread: true,
				});
			}
			if (isMine && c.status === "Assigned" && !c.slotConfirmed) {
				items.push({
					id: `confirm-c-${c.id}`,
					type: "assignment",
					title: `Confirm your slot: ${c.applicantName}`,
					detail: `Scheduled for ${c.dateTime}`,
					time: c.dateTime,
					link: "/consultations",
					unread: true,
				});
			}
			if (isMine && c.status === "In Assessment") {
				items.push({
					id: `assess-c-${c.id}`,
					type: "consultation",
					title: `Assessment pending: ${c.applicantName}`,
					detail: `In assessment · ${c.targetCountry}`,
					time: c.dateTime,
					link: "/consultations",
					unread: false,
				});
			}
		}

		for (const a of applications) {
			const isMine = a.assignedStaff === me;
			if (isMine && a.status === "Under Review") {
				items.push({
					id: `app-review-${a.id}`,
					type: "application",
					title: `Application under review: ${a.applicantName}`,
					detail: `${a.appId} · ${a.university} · ${a.stage}`,
					time: a.submittedDate,
					link: "/applications",
					unread: false,
				});
			}
			const unchecked = a.checklist.filter((c) => !c.checked).length;
			if (unchecked > 0 && (isMine || opsRole === "manager" || opsRole === "coordinator")) {
				items.push({
					id: `app-checklist-${a.id}`,
					type: "application",
					title: `${unchecked} checklist items open: ${a.applicantName}`,
					detail: `${a.appId} · ${a.university}`,
					time: a.submittedDate,
					link: "/applications",
					unread: false,
				});
			}
		}

		const scopedApplicants = scopeRecords(applicants, (a) => a.assignedOfficer === me);
		for (const a of scopedApplicants) {
			const pending = a.documents.filter((d) => d.status === "Pending Review");
			for (const d of pending) {
				items.push({
					id: `doc-${a.id}-${d.name}`,
					type: "document",
					title: `Document pending review: ${d.name}`,
					detail: `${a.name} · ${a.applicantId}`,
					time: d.date,
					link: "/documents",
					unread: true,
				});
			}
			const outstanding = money(a.financials.outstanding);
			if (outstanding > 0 && hasPermission("finance")) {
				items.push({
					id: `fin-${a.id}`,
					type: "finance",
					title: `Outstanding balance: ${a.name}`,
					detail: `${a.financials.outstanding} · ${a.financials.plan}`,
					time: a.enrolledDate,
					link: "/finance",
					unread: false,
				});
			}
		}

		// Real-time captured CRM leads from PostgreSQL database
		for (const al of apiLeads) {
			if (al.stage === "New Lead" || al.stage === "Contacted") {
				items.push({
					id: `api-lead-${al.id}`,
					type: "lead",
					title: `New client lead: ${al.name}`,
					detail: `${al.source || "Portal Sign-In"} · ${al.email}${al.phone && al.phone !== "-" ? ` · ${al.phone}` : ""}`,
					time: relativeTime(al.createdAt || al.updatedAt),
					link: "/leads",
					unread: al.stage === "New Lead",
				});
			}
		}

		const scopedLeads = scopeRecords(leads, (l) => l.assignedTo === me);
		for (const l of scopedLeads) {
			if (l.stage === "new" || l.stage === "contacted") {
				items.push({
					id: `lead-${l.id}`,
					type: "lead",
					title: `Lead needs follow-up: ${l.name}`,
					detail: `${LEAD_STAGE_LABELS[l.stage]} · ${l.country} · ${l.degreeLevel}`,
					time: l.lastContactAt,
					link: "/leads",
					unread: l.stage === "new",
				});
			}
		}

		for (const e of activityLog.slice(0, 10)) {
			items.push({
				id: `log-${e.id}`,
				type: "system",
				title: `${e.action} - ${e.actor}`,
				detail: e.detail,
				time: relativeTime(e.at),
				link: "/workflow",
				unread: false,
			});
		}

		return items.sort((a, b) => {
			if (a.unread !== b.unread) return a.unread ? -1 : 1;
			return 0;
		});
	}, [consultations, applications, applicants, leads, apiLeads, activityLog, me, opsRole, scopeRecords, hasPermission]);

	const filtered = filter === "unread" ? notifications.filter((n) => n.unread) : notifications;
	const unreadCount = notifications.filter((n) => n.unread).length;

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem" }}>
				<div>
					<h1 className="page-title">Notifications</h1>
					<p className="lead mt-2">
						{unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "You're all caught up"}
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					<button
						type="button"
						className={`btn btn--sm ${filter === "all" ? "btn--primary" : "btn--ghost"}`}
						onClick={() => setFilter("all")}
					>
						All ({notifications.length})
					</button>
					<button
						type="button"
						className={`btn btn--sm ${filter === "unread" ? "btn--primary" : "btn--ghost"}`}
						onClick={() => setFilter("unread")}
					>
						Unread ({unreadCount})
					</button>
				</div>
			</div>

			<div className="card">
				{filtered.length === 0 ? (
					<p className="muted" style={{ padding: "2rem", textAlign: "center", fontSize: "var(--text-sm)" }}>
						No notifications{filter === "unread" ? " unread" : ""}.
					</p>
				) : (
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{filtered.map((n) => {
							const meta = TYPE_META[n.type];
							return (
								<li
									key={n.id}
									style={{
										display: "flex",
										alignItems: "flex-start",
										gap: "0.85rem",
										padding: "0.85rem 1rem",
										borderBottom: "1px solid var(--border-light)",
										background: n.unread ? "var(--muted)" : "transparent",
									}}
								>
									<span
										style={{
											width: "8px",
											height: "8px",
											borderRadius: "50%",
											background: meta.color,
											flexShrink: 0,
											marginTop: "0.4rem",
										}}
										aria-hidden
									/>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.15rem" }}>
											<span
												style={{
													fontFamily: "var(--font-mono)",
													fontSize: "0.6rem",
													textTransform: "uppercase",
													letterSpacing: "0.08em",
													color: meta.color,
												}}
											>
												{meta.label}
											</span>
											{n.unread && (
												<span
													style={{
														fontFamily: "var(--font-mono)",
														fontSize: "0.6rem",
														textTransform: "uppercase",
														letterSpacing: "0.08em",
														color: "var(--muted-foreground)",
													}}
												>
													New
												</span>
											)}
										</div>
										<p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{n.title}</p>
										<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>{n.detail}</p>
									</div>
									<div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem", flexShrink: 0 }}>
										<span className="muted" style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>{n.time}</span>
										{n.link && (
											<Link to={n.link} className="link-arrow" style={{ fontSize: "var(--text-xs)" }}>
												View →
											</Link>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
