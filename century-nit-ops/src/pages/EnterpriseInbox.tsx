import { useMemo, useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useCasesApi } from "../hooks/useCasesApi";
import { useOpsNotifications } from "../hooks/useOpsNotifications";
import { documentsApi } from "century-nit-core/api";
import type { ApplicantDocument } from "century-nit-shared";
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
	const { consultations, applications, applicants } = useCasesApi();
	const { notifications: realNotifications, unreadCount: realUnreadCount, markRead, markAllRead } = useOpsNotifications();
	const [apiLeads, setApiLeads] = useState<ApiLead[]>([]);
	const [reviewDocuments, setReviewDocuments] = useState<ApplicantDocument[]>([]);
	const [filter, setFilter] = useState<"all" | "unread">("all");
	const navigate = useNavigate();

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

	const loadReviewDocuments = useCallback(async () => {
		try {
			const res = await documentsApi.list();
			if (res?.documents) {
				// A document that is UPLOADED is awaiting staff review.
				setReviewDocuments(res.documents.filter((d) => d.status === "UPLOADED"));
			}
		} catch {
			// ignore if offline or forbidden
		}
	}, []);

	useEffect(() => {
		void loadApiLeads();
		void loadReviewDocuments();
		const leadTimer = setInterval(loadApiLeads, 30000);
		const docTimer = setInterval(loadReviewDocuments, 30000);
		return () => {
			clearInterval(leadTimer);
			clearInterval(docTimer);
		};
	}, [loadApiLeads, loadReviewDocuments]);

	const meEmail = opsUser?.email ?? "";

	const notifications = useMemo<NotificationItem[]>(() => {
		const items: NotificationItem[] = [];

		for (const c of consultations) {
			const isMine = c.assignedOfficerEmail === meEmail;
			if (c.status === "Under Review" && !c.assignedOfficerEmail) {
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
			const isMine = a.assignedStaffEmail === meEmail;
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

		const scopedApplicants = scopeRecords(applicants, (a) => a.assignedOfficerEmail === meEmail);
		for (const a of scopedApplicants) {
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

		// Real documents awaiting review — pulled from the documents API, where a
		// status of UPLOADED means the applicant has uploaded it and it is waiting
		// on staff. (The old heuristic filtered mock `requestedDocuments` on a
		// "Pending Review" status that never existed in the enum, so it never showed
		// anything.)
		for (const d of reviewDocuments) {
			items.push({
				id: `doc-${d.id}`,
				type: "document",
				title: `Document pending review: ${d.documentType}`,
				detail: `${d.fileName}${d.ownerEmail ? ` · ${d.ownerEmail}` : ""}`,
				time: relativeTime(d.uploadedAt ?? d.createdAt),
				link: "/documents",
				unread: true,
			});
		}

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

		return items.sort((a, b) => {
			if (a.unread !== b.unread) return a.unread ? -1 : 1;
			return 0;
		});
	}, [consultations, applications, applicants, apiLeads, reviewDocuments, meEmail, opsRole, scopeRecords, hasPermission]);

	const filtered = filter === "unread" ? notifications.filter((n) => n.unread) : notifications;
	const unreadCount = notifications.filter((n) => n.unread).length;
	const totalUnread = realUnreadCount + unreadCount;

	const handleNotificationClick = useCallback(
		(id: string, link: string | null) => {
			void markRead(id);
			if (link) navigate(link);
		},
		[markRead, navigate],
	);

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem" }}>
				<div>
					<h1 className="page-title">Notifications</h1>
					<p className="lead mt-2">
						{totalUnread > 0 ? `${totalUnread} unread notification${totalUnread > 1 ? "s" : ""}` : "You're all caught up"}
					</p>
				</div>
				<div style={{ display: "flex", gap: "0.5rem" }}>
					{realUnreadCount > 0 && (
						<button
							type="button"
							className="btn btn--sm btn--ghost"
							onClick={() => void markAllRead()}
						>
							Mark all read
						</button>
					)}
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

			{/* Real, server-pushed notifications */}
			{realNotifications.length > 0 && (
				<div className="card" style={{ marginBottom: "1.5rem" }}>
					<p className="eyebrow" style={{ padding: "0.85rem 1rem 0.5rem", fontSize: "0.6rem" }}>
						Inbox
					</p>
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{realNotifications.map((n) => (
							<li
								key={n.id}
								style={{
									display: "flex",
									alignItems: "flex-start",
									gap: "0.85rem",
									padding: "0.85rem 1rem",
									borderBottom: "1px solid var(--border-light)",
									background: n.read ? "transparent" : "var(--muted)",
									cursor: n.link ? "pointer" : "default",
								}}
								onClick={() => handleNotificationClick(n.id, n.link)}
								role={n.link ? "button" : undefined}
							>
								<span
									style={{
										width: "8px",
										height: "8px",
										borderRadius: "50%",
										background: n.read ? "var(--muted-foreground)" : "#3b82f6",
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
												color: "var(--muted-foreground)",
											}}
										>
											{n.type}
										</span>
										{!n.read && (
											<span
												style={{
													fontFamily: "var(--font-mono)",
													fontSize: "0.6rem",
													textTransform: "uppercase",
													letterSpacing: "0.08em",
													color: "#3b82f6",
												}}
											>
												New
											</span>
										)}
									</div>
									<p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{n.title}</p>
									{n.body && (
										<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.15rem" }}>{n.body}</p>
									)}
								</div>
								<span className="muted" style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
									{relativeTime(n.createdAt)}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			<p className="eyebrow" style={{ marginBottom: "0.5rem", fontSize: "0.6rem" }}>Case activity</p>
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
