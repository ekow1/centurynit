import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
	useChatConversations,
	useChatMessages,
} from "../hooks/useChatApi";
import {
	getCommunicationStaffDirectory,
	updateCommunicationPresence,
	communicationHeartbeat,
	createStageAssignment,
	listStageAssignments,
	createChatConversation,
	type ChatConversation,
	type ChatMessage,
	type StaffDirectoryEntryDetailed,
	type StaffPresence,
	type StageAssignment,
} from "../lib/api";
import { useOpsAuth, type OpsRole } from "./OpsAuthContext";
import { roleCanAccess } from "century-nit-shared";

/**
 * OPS Staff Communication Hub — the floating widget for staff.
 *
 * Three modes (§6):
 *   Staff   — directory with presence + load; start DMs / internal chats.
 *   Cases   — customer-visible case-linked conversations (the customer's
 *             threads, viewed from the staff side).
 *   Internal— staff↔staff / case notes / escalations; never exposed to
 *             customers.
 *
 * Reuses the existing `/chat/*` endpoints for messaging (the service already
 * handles the new conversation types and symmetric participants). Adds the
 * `/communication/*` endpoints for presence, the detailed staff directory, and
 * stage assignments.
 */

const HEARTBEAT_MS = 60_000;

type Mode = "staff" | "cases" | "internal";

const PRESENCE_DOT: Record<StaffPresence, string> = {
	available: "#10b981",
	busy: "#f59e0b",
	on_leave: "#a78bfa",
	offline: "#94a3b8",
};

const PRESENCE_LABEL: Record<StaffPresence, string> = {
	available: "Available",
	busy: "Busy",
	on_leave: "On leave",
	offline: "Offline",
};

const CASE_TYPES = new Set(["applicant", "support", "case", "stage", "entity"]);
const INTERNAL_TYPES = new Set(["direct", "group", "internal", "escalation"]);

export function CommunicationHub() {
	const { opsRole } = useOpsAuth();
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [mode, setMode] = useState<Mode>("staff");
	const [activeConvId, setActiveConvId] = useState<string | null>(null);
	const [directory, setDirectory] = useState<StaffDirectoryEntryDetailed[]>([]);
	const [dirLoading, setDirLoading] = useState(false);
	const [assignments, setAssignments] = useState<StageAssignment[]>([]);
	const [assignCaseId, setAssignCaseId] = useState("");
	const [assignStage, setAssignStage] = useState("document_verification");
	const [assignOpsUserId, setAssignOpsUserId] = useState("");
	const [assigning, setAssigning] = useState(false);
	const [presenceStatus, setPresenceStatus] = useState<StaffPresence>("available");
	const [error, setError] = useState<string | null>(null);

	const { conversations, loading: convsLoading, refresh: refreshConvs } = useChatConversations();
	const { messages, hasMore, loading: msgsLoading, sending, load, loadMore, send, markRead } =
		useChatMessages(activeConvId);

	const canAssign = useMemo(
		() => opsRole === "manager" || opsRole === "coordinator" || opsRole === "super_admin",
		[opsRole],
	);

	/* ── Presence heartbeat ── */
	useEffect(() => {
		if (!roleCanAccess(opsRole as OpsRole, "chat")) return;
		void communicationHeartbeat().catch(() => {});
		const id = setInterval(() => {
			void communicationHeartbeat().catch(() => {});
		}, HEARTBEAT_MS);
		return () => clearInterval(id);
	}, [opsRole]);

	/* ── Staff directory (with presence + load) ── */
	const loadDirectory = useCallback(async () => {
		setDirLoading(true);
		try {
			const res = await getCommunicationStaffDirectory();
			setDirectory(res.staff);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't load staff directory");
		} finally {
			setDirLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open && mode === "staff") void loadDirectory();
	}, [open, mode, loadDirectory]);

	/* ── Set presence ── */
	const changePresence = useCallback(async (status: StaffPresence) => {
		setPresenceStatus(status);
		try {
			await updateCommunicationPresence(status);
			void loadDirectory();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't update presence");
		}
	}, [loadDirectory]);

	/* ── Filter conversations by mode ── */
	const filtered = useMemo(() => {
		const byMode =
			mode === "cases" ? conversations.filter((c) => CASE_TYPES.has(c.type)) : mode === "internal" ? conversations.filter((c) => INTERNAL_TYPES.has(c.type)) : conversations;
		return byMode.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}, [conversations, mode]);

	const totalUnread = useMemo(
		() => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
		[conversations],
	);

	/* ── Open a conversation ── */
	const openConversation = useCallback(
		(conv: ChatConversation) => {
			setActiveConvId(conv.id);
			void load();
			void markRead();
			void refreshConvs();
		},
		[load, markRead, refreshConvs],
	);

	/* ── Start a DM with a staff member ── */
	const startDM = useCallback(
		async (entry: StaffDirectoryEntryDetailed) => {
			try {
				const conv = await createChatConversation({ participantOpsUserId: entry.opsUserId });
				openConversation(conv);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Couldn't start conversation");
			}
		},
		[openConversation],
	);

	/* ── Stage assignment (manager/coordinator) ── */
	const refreshAssignments = useCallback(async () => {
		if (!assignCaseId) return;
		try {
			const res = await listStageAssignments(assignCaseId);
			setAssignments(res.assignments);
		} catch {
			setAssignments([]);
		}
	}, [assignCaseId]);

	useEffect(() => {
		if (open && canAssign) void refreshAssignments();
	}, [open, canAssign, refreshAssignments]);

	const submitAssignment = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!assignCaseId || !assignOpsUserId) return;
			setAssigning(true);
			try {
				await createStageAssignment({
					applicationId: assignCaseId,
					stage: assignStage,
					opsUserId: assignOpsUserId,
				});
				setAssignCaseId("");
				setAssignOpsUserId("");
				void refreshAssignments();
				void refreshConvs();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Couldn't assign officer");
			} finally {
				setAssigning(false);
			}
		},
		[assignCaseId, assignOpsUserId, assignStage, refreshAssignments, refreshConvs],
	);

	/* ── Send message in active conversation ── */
	const [draft, setDraft] = useState("");
	const onSend = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!draft.trim() || !activeConvId) return;
			try {
				await send(draft.trim());
				setDraft("");
				void refreshConvs();
			} catch {
				/* handled by hook */
			}
		},
		[draft, activeConvId, send, refreshConvs],
	);

	const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

	/* ── Render ── */
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				style={fabStyle}
				aria-label="Open staff communication hub"
			>
				<span style={{ fontSize: 18 }}>💬</span>
				<span style={{ fontWeight: 600, fontSize: 13 }}>Communication</span>
				{totalUnread > 0 && <span style={badgeStyle}>{totalUnread}</span>}
			</button>

			{open && (
				<div style={{ ...panelStyle, ...(expanded ? expandedPanelStyle : {}) }}>
					<div style={headerStyle}>
						<span style={{ fontWeight: 700, fontSize: 15 }}>Staff Communication Hub</span>
						<div style={{ display: "flex", gap: 8 }}>
							<button type="button" onClick={() => setExpanded((x) => !x)} style={iconBtnStyle} title={expanded ? "Collapse" : "Expand"}>
								{expanded ? "⤡" : "⛶"}
							</button>
							<button type="button" onClick={() => setOpen(false)} style={iconBtnStyle} title="Close">
								×
							</button>
						</div>
					</div>

					<div style={modeBarStyle}>
						{(["staff", "cases", "internal"] as Mode[]).map((m) => (
							<button
								key={m}
								type="button"
								onClick={() => setMode(m)}
								style={{ ...modeBtnStyle, ...(mode === m ? { background: "#4f46e5", color: "#fff" } : {}) }}
							>
								{m === "staff" ? "Staff" : m === "cases" ? "Cases" : "Internal"}
							</button>
						))}
						<div style={{ flex: 1 }} />
						<label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
							<span>Presence:</span>
							<select
								value={presenceStatus}
								onChange={(e) => void changePresence(e.target.value as StaffPresence)}
								style={selectStyle}
							>
								<option value="available">Available</option>
								<option value="busy">Busy</option>
								<option value="on_leave">On leave</option>
								<option value="offline">Offline</option>
							</select>
						</label>
					</div>

					<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
						{/* Left rail */}
						<div style={railStyle}>
							{mode === "staff" && (
								<div style={{ overflowY: "auto", flex: 1 }}>
									{dirLoading && <div style={emptyStyle}>Loading staff…</div>}
									{!dirLoading && directory.length === 0 && <div style={emptyStyle}>No staff found.</div>}
									{directory.map((s) => (
										<button
											key={s.opsUserId}
											type="button"
											onClick={() => startDM(s)}
											style={dirRowStyle}
										>
											<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
												<span style={{ ...dotStyle, background: PRESENCE_DOT[s.presence] }} />
												<span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
												{s.unreadCount > 0 && <span style={miniBadgeStyle}>{s.unreadCount}</span>}
											</div>
											<div style={{ fontSize: 11, opacity: 0.7 }}>
												{s.role}{s.branch ? ` · ${s.branch}` : ""}
											</div>
											<div style={{ fontSize: 11, opacity: 0.7 }}>
												{PRESENCE_LABEL[s.presence]}
												{s.activeCaseCount > 0 ? ` · ${s.activeCaseCount} active` : ""}
											</div>
										</button>
									))}
								</div>
							)}

							{mode !== "staff" && (
								<div style={{ overflowY: "auto", flex: 1 }}>
									{convsLoading && <div style={emptyStyle}>Loading…</div>}
									{!convsLoading && filtered.length === 0 && (
										<div style={emptyStyle}>
											{mode === "cases" ? "No case conversations." : "No internal conversations."}
										</div>
									)}
									{filtered.map((c) => (
										<button
											key={c.id}
											type="button"
											onClick={() => openConversation(c)}
											style={{ ...convRowStyle, ...(c.id === activeConvId ? { background: "#eef2ff" } : {}) }}
										>
											<span style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</span>
											<span style={{ fontSize: 11, opacity: 0.7, display: "flex", gap: 6 }}>
												<span>{typeLabel(c.type)}</span>
												{c.unreadCount > 0 && <span style={miniBadgeStyle}>{c.unreadCount}</span>}
											</span>
										</button>
									))}
								</div>
							)}

							{canAssign && (
								<div style={assignBoxStyle}>
									<div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>
										Stage assignment
									</div>
									<form onSubmit={submitAssignment} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
										<input
											placeholder="Application ID (uuid)"
											value={assignCaseId}
											onChange={(e) => setAssignCaseId(e.target.value)}
											style={assignInputStyle}
										/>
										<select value={assignStage} onChange={(e) => setAssignStage(e.target.value)} style={selectStyle}>
											<option value="document_verification">Document Verification</option>
											<option value="school_submission">School Submission</option>
											<option value="offer_letter_review">Offer Letter Review</option>
											<option value="visa_processing">Visa Processing</option>
											<option value="payment_execution">Payment Execution</option>
											<option value="travel_assistance">Travel Assistance</option>
										</select>
										<select value={assignOpsUserId} onChange={(e) => setAssignOpsUserId(e.target.value)} style={selectStyle}>
											<option value="">Select officer…</option>
											{directory.map((d) => (
												<option key={d.opsUserId} value={d.opsUserId}>
													{d.name} ({d.role})
												</option>
											))}
										</select>
										<button type="submit" disabled={!assignCaseId || !assignOpsUserId || assigning} style={assignBtnStyle}>
											{assigning ? "Assigning…" : "Assign officer"}
										</button>
									</form>
									{assignments.length > 0 && (
										<div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>
											{assignments.slice(0, 4).map((a) => (
												<div key={a.id}>
													{a.stage}: {a.opsUserName ?? a.opsUserId.slice(0, 8)} · {a.status}
												</div>
											))}
										</div>
									)}
								</div>
							)}
						</div>

						{/* Thread */}
						<div style={threadStyle}>
							{activeConv ? (
								<>
									<div style={threadHeaderStyle}>
										<span style={{ fontWeight: 700, fontSize: 14 }}>{activeConv.title}</span>
										<span style={{ fontSize: 11, opacity: 0.7 }}>
											{typeLabel(activeConv.type)}
											{activeConv.linkedEntityType ? ` · ${activeConv.linkedEntityType}` : ""}
											{activeConv.stageKey ? ` · ${stageLabel(activeConv.stageKey)}` : ""}
											{activeConv.status === "closed" ? " · Closed" : ""}
										</span>
									</div>
									<div style={messagesStyle}>
										{hasMore && (
											<button type="button" onClick={loadMore} style={loadMoreStyle}>
												{msgsLoading ? "Loading…" : "Load older"}
											</button>
										)}
										{messages.map((m) => (
											<OpsMessageBubble key={m.id} message={m} />
										))}
										{messages.length === 0 && !msgsLoading && (
											<div style={{ textAlign: "center", opacity: 0.6, fontSize: 13, padding: 24 }}>
												No messages yet.
											</div>
										)}
									</div>
									<form onSubmit={onSend} style={composerStyle}>
										<input
											value={draft}
											onChange={(e) => setDraft(e.target.value)}
											placeholder="Type a message…"
											style={inputStyle}
											disabled={sending}
										/>
										<button type="submit" disabled={!draft.trim() || sending} style={sendBtnStyle}>
											Send
										</button>
									</form>
								</>
							) : (
								<div style={emptyThreadStyle}>
									<p style={{ fontWeight: 600 }}>Staff Communication Hub</p>
									<p style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
										{mode === "staff"
											? "Pick a colleague to start a direct message."
											: mode === "cases"
												? "Open a case-linked conversation to message the customer."
												: "Internal notes and staff discussions — never shown to customers."}
									</p>
								</div>
							)}
						</div>
					</div>

					{error && (
						<div style={errorStyle}>
							{error}
							<button type="button" onClick={() => setError(null)} style={{ marginLeft: 8 }}>
								Dismiss
							</button>
						</div>
					)}
				</div>
			)}
		</>
	);
}

/* ── Subcomponents ── */

function OpsMessageBubble({ message }: { message: ChatMessage }) {
	const isSystem = message.messageType === "system";
	const isSelf = message.senderOpsUserId; // staff; self-detection refined with current staff id if needed
	if (isSystem) {
		return (
			<div style={systemMsgStyle}>
				<span>{message.content}</span>
			</div>
		);
	}
	return (
		<div style={{ display: "flex", justifyContent: isSelf ? "flex-end" : "flex-start", margin: "4px 0" }}>
			<div style={{ ...bubbleStyle, ...(isSelf ? { background: "#4f46e5", color: "#fff" } : {}) }}>
				{!isSelf && <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{message.senderName}</div>}
				<div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</div>
			</div>
		</div>
	);
}

/* ── Helpers ── */

function typeLabel(type: ChatConversation["type"]): string {
	const map: Record<ChatConversation["type"], string> = {
		direct: "DM",
		entity: "Case",
		group: "Group",
		applicant: "Customer",
		support: "Support",
		case: "Case",
		stage: "Stage",
		internal: "Internal",
		escalation: "Escalation",
	};
	return map[type] ?? type;
}

function stageLabel(key: string): string {
	const map: Record<string, string> = {
		document_verification: "Document Verification",
		school_submission: "School Submission",
		offer_letter_review: "Offer Letter Review",
		visa_processing: "Visa Processing",
		payment_execution: "Payment Execution",
		travel_assistance: "Travel Assistance",
		completed: "Completed",
	};
	return map[key] ?? key;
}

/* ── Styles ── */

const fabStyle: CSSProperties = {
	position: "fixed",
	bottom: 24,
	right: 24,
	zIndex: 9999,
	display: "flex",
	alignItems: "center",
	gap: 10,
	padding: "10px 16px",
	background: "#0f172a",
	color: "#fff",
	border: "none",
	borderRadius: 999,
	boxShadow: "0 8px 24px rgba(15, 23, 42, 0.35)",
	cursor: "pointer",
	fontFamily: "inherit",
};

const badgeStyle: CSSProperties = {
	background: "#ef4444",
	color: "#fff",
	borderRadius: 999,
	padding: "1px 8px",
	fontSize: 11,
	fontWeight: 700,
};

const panelStyle: CSSProperties = {
	position: "fixed",
	bottom: 92,
	right: 24,
	zIndex: 9998,
	width: "min(440px, calc(100vw - 32px))",
	height: "min(600px, calc(100vh - 120px))",
	background: "#fff",
	borderRadius: 16,
	boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	fontFamily: "inherit",
	color: "#0f172a",
};

const expandedPanelStyle: CSSProperties = {
	width: "min(960px, 92vw)",
	height: "min(720px, 88vh)",
};

const headerStyle: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "12px 16px",
	borderBottom: "1px solid #e2e8f0",
	background: "#f8fafc",
};

const modeBarStyle: CSSProperties = {
	display: "flex",
	gap: 4,
	padding: "8px 12px",
	borderBottom: "1px solid #e2e8f0",
	alignItems: "center",
};

const modeBtnStyle: CSSProperties = {
	padding: "4px 12px",
	borderRadius: 8,
	border: "1px solid #e2e8f0",
	background: "#fff",
	cursor: "pointer",
	fontSize: 12,
	fontWeight: 600,
	fontFamily: "inherit",
};

const iconBtnStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	cursor: "pointer",
	fontSize: 16,
	padding: "4px 8px",
	borderRadius: 6,
};

const railStyle: CSSProperties = {
	width: 240,
	borderRight: "1px solid #e2e8f0",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	background: "#fafbfc",
};

const selectStyle: CSSProperties = {
	padding: "4px 8px",
	border: "1px solid #cbd5e1",
	borderRadius: 6,
	fontSize: 12,
	fontFamily: "inherit",
	background: "#fff",
};

const dotStyle: CSSProperties = {
	display: "inline-block",
	width: 8,
	height: 8,
	borderRadius: "50%",
};

const emptyStyle: CSSProperties = {
	padding: 12,
	fontSize: 12,
	opacity: 0.6,
};

const dirRowStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 2,
	width: "100%",
	padding: "8px 12px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #f1f5f9",
	cursor: "pointer",
	textAlign: "left",
	fontFamily: "inherit",
};

const convRowStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	gap: 2,
	width: "100%",
	padding: "8px 12px",
	background: "transparent",
	border: "none",
	borderBottom: "1px solid #f1f5f9",
	cursor: "pointer",
	textAlign: "left",
	fontFamily: "inherit",
};

const miniBadgeStyle: CSSProperties = {
	background: "#ef4444",
	color: "#fff",
	borderRadius: 999,
	padding: "0 6px",
	fontSize: 10,
	fontWeight: 700,
};

const assignBoxStyle: CSSProperties = {
	borderTop: "1px solid #e2e8f0",
	padding: 10,
	display: "flex",
	flexDirection: "column",
	gap: 4,
};

const assignInputStyle: CSSProperties = {
	padding: "4px 8px",
	border: "1px solid #cbd5e1",
	borderRadius: 6,
	fontSize: 11,
	fontFamily: "inherit",
};

const assignBtnStyle: CSSProperties = {
	background: "#4f46e5",
	color: "#fff",
	border: "none",
	padding: "6px 12px",
	borderRadius: 6,
	cursor: "pointer",
	fontWeight: 600,
	fontSize: 12,
};

const threadStyle: CSSProperties = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	minWidth: 0,
	background: "#fff",
};

const threadHeaderStyle: CSSProperties = {
	padding: "10px 16px",
	borderBottom: "1px solid #e2e8f0",
	display: "flex",
	flexDirection: "column",
	gap: 2,
};

const messagesStyle: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "12px 16px",
	display: "flex",
	flexDirection: "column",
	gap: 2,
	background: "#f8fafc",
};

const bubbleStyle: CSSProperties = {
	maxWidth: "78%",
	padding: "8px 12px",
	borderRadius: 12,
	background: "#fff",
	border: "1px solid #e2e8f0",
	fontSize: 13,
};

const systemMsgStyle: CSSProperties = {
	alignSelf: "center",
	background: "#f1f5f9",
	color: "#475569",
	fontSize: 12,
	padding: "6px 12px",
	borderRadius: 8,
	margin: "6px 0",
	textAlign: "center",
	maxWidth: "90%",
};

const composerStyle: CSSProperties = {
	display: "flex",
	gap: 8,
	padding: 12,
	borderTop: "1px solid #e2e8f0",
	background: "#fff",
};

const inputStyle: CSSProperties = {
	flex: 1,
	padding: "8px 12px",
	border: "1px solid #cbd5e1",
	borderRadius: 8,
	fontFamily: "inherit",
	fontSize: 13,
};

const sendBtnStyle: CSSProperties = {
	background: "#4f46e5",
	color: "#fff",
	border: "none",
	padding: "8px 16px",
	borderRadius: 8,
	cursor: "pointer",
	fontWeight: 600,
};

const emptyThreadStyle: CSSProperties = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	textAlign: "center",
	padding: 24,
	gap: 12,
};

const loadMoreStyle: CSSProperties = {
	alignSelf: "center",
	background: "transparent",
	border: "1px solid #cbd5e1",
	padding: "4px 12px",
	borderRadius: 999,
	cursor: "pointer",
	fontSize: 12,
	margin: "4px 0",
};

const errorStyle: CSSProperties = {
	padding: "8px 12px",
	background: "#fef2f2",
	color: "#b91c1c",
	fontSize: 12,
	borderTop: "1px solid #fecaca",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
};
