import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useOpsAuth, type OpsRole } from "./OpsAuthContext";
import {
	useChatConversations,
	useChatMessages,
	useStaffDirectory,
} from "../hooks/useChatApi";
import { roleCanAccess, type ChatConversation, type ChatMessage, type QuotedMessage } from "century-nit-shared";
import {
	ensureChatUiStyles,
	MessageList,
	Composer,
	type MessageActionsConfig,
} from "century-nit-chat-ui";
import {
	setChatConversationStatus,
	setChatConversationOwner,
	getChatConversationContext,
	stageChatAttachment,
	uploadStagedAttachment,
	type ChatConversationContext,
} from "../lib/api";

/**
 * Helpdesk — client conversation queue.
 *
 * Client requests (support / case / stage / applicant conversations) raised
 * from the portal land in the same chat system the OPS console uses for
 * messaging, so there is one thread model platform-wide — no separate ticket
 * store. This page is the triage surface: every client-facing conversation,
 * unread-first, with inline replying via the shared MessageList + Composer.
 *
 * Lifecycle: conversations carry `status` (open / closed / archived) and an
 * `owner` participant role. Resolve writes a system divider into the thread;
 * a client reply auto-reopens. `visibility: "internal"` posts a staff-only
 * note that never reaches the portal.
 */

const CLIENT_TYPES = new Set(["applicant", "support", "case", "stage", "entity"]);

const TYPE_LABELS: Record<string, string> = {
	support: "Support",
	case: "Case",
	stage: "Stage",
	applicant: "Applicant",
	entity: "Conversation",
};

type Filter = "all" | "awaiting" | "unread" | "mine" | "unclaimed" | "support" | "case" | "stage" | "applicant";
const CHIPS: { id: Filter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "awaiting", label: "Awaiting reply" },
	{ id: "unread", label: "Unread" },
	{ id: "unclaimed", label: "Unclaimed" },
	{ id: "mine", label: "Mine" },
	{ id: "support", label: "Support" },
	{ id: "case", label: "Case" },
	{ id: "stage", label: "Stage" },
	{ id: "applicant", label: "Applicant" },
];

const SNIPPETS: { id: string; label: string; body: string }[] = [
	{ id: "ack", label: "Acknowledge", body: "Thanks for reaching out — I'm looking into this now and will come back to you shortly." },
	{ id: "docs", label: "Request documents", body: "Could you upload the requested document here? A clear photo or PDF works — I'll confirm receipt as soon as it lands." },
	{ id: "payment", label: "Payment received", body: "Your payment has been received and allocated to your invoice. The updated receipt is in your portal under Money." },
	{ id: "visa", label: "Visa update", body: "Your application is with the visa team. We'll message you the moment there's a decision or if anything further is needed." },
	{ id: "close", label: "Resolve + close", body: "Glad we could get this sorted. I'll mark this request resolved — reply here any time and it reopens automatically." },
];

/** The client wrote last and nobody has answered. */
const awaitingReply = (c: ChatConversation) => Boolean(c.lastMessage?.senderUserId) || (c.unreadCount || 0) > 0;
const isClosed = (c: ChatConversation) => c.status === "closed" || c.status === "archived";

/** The owner participant, when one has claimed/been assigned the thread. */
function ownerOf(c: ChatConversation): { opsUserId: string; name: string } | null {
	const p = c.participants.find((x) => x.role === "owner");
	return p ? { opsUserId: p.opsUserId, name: p.name } : null;
}

/** How long the client has been waiting, in hours; 0 when not waiting. */
function waitingHours(c: ChatConversation, now: number): number {
	if (!awaitingReply(c) || isClosed(c)) return 0;
	const at = new Date(c.lastMessage?.createdAt ?? c.updatedAt).getTime();
	return Number.isNaN(at) ? 0 : Math.max(0, (now - at) / 3_600_000);
}
const waitLabel = (h: number) => (h < 1 ? "just now" : h < 24 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} d`);
/** The client's name: the last client message's author, else the title (support/applicant threads are titled by the client). */
function clientName(c: ChatConversation): string {
	if (c.lastMessage?.senderUserId) return c.lastMessage.senderName;
	if (c.type === "support" || c.type === "applicant") return c.title || "Client";
	return c.title || "Conversation";
}
/** "Support · APP-2026-0142", "Stage · Consultation" — the thread's subject without opening it. */
function kickerOf(c: ChatConversation): string {
	const type = TYPE_LABELS[c.type] ?? c.type;
	if (c.type === "case" || c.type === "stage") return `${type} · ${c.title}`;
	if (c.linkedEntityType) return `${type} · ${c.linkedEntityType}`;
	return type;
}
function entityLink(c: ChatConversation): { to: string; label: string } | null {
	if (!c.linkedEntityId) return null;
	if (c.linkedEntityType === "application") return { to: `/applications?id=${c.linkedEntityId}`, label: "Open case" };
	if (c.linkedEntityType === "consultation") return { to: `/consultations?id=${c.linkedEntityId}`, label: "Open consultation" };
	return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function EnterpriseHelpdesk() {
	const { opsUser, opsRole } = useOpsAuth();
	const [searchParams] = useSearchParams();
	const canChat = roleCanAccess(opsRole as OpsRole, "chat");

	// The conversation id is the URL's source of truth, so /helpdesk?id=… deep
	// links (e.g. from the Team Assignments board) open a thread directly.
	// Anything that isn't a UUID (stale /chat?id=<ref> links, case refs pasted
	// into the bar) must not reach the API — it validates the path as uuid and
	// would 400 every messages/context/read call against it.
	const rawConvId = searchParams.get("id") || null;
	const activeConvId = rawConvId && UUID_RE.test(rawConvId) ? rawConvId : null;
	// /helpdesk?client=<clientUserId> — deep link from the client directory
	// record pane; narrows the queue to that account's threads.
	const clientFilter = searchParams.get("client") || null;

	const { conversations, loading: convsLoading, refresh: refreshConvs } = useChatConversations(canChat);
	const directory = useStaffDirectory();
	const [filter, setFilter] = useState<Filter>("all");
	const [showClosed, setShowClosed] = useState(false);
	const [search, setSearch] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [noteMode, setNoteMode] = useState(false);
	const [showSnippets, setShowSnippets] = useState(false);
	const [showReassign, setShowReassign] = useState(false);
	const [pendingFiles, setPendingFiles] = useState<{ name: string; attachmentId: string }[]>([]);
	const [uploading, setUploading] = useState(false);
	const [context, setContext] = useState<ChatConversationContext | null>(null);
	const [statusBusy, setStatusBusy] = useState(false);
	const [replyTo, setReplyTo] = useState<QuotedMessage | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isTypingRef = useRef(false);

	const {
		messages,
		hasMore,
		loading: msgsLoading,
		sending,
		typing,
		load,
		loadMore,
		send,
		edit,
		delete: deleteMessage,
		react,
		signalTyping,
		markRead,
	} = useChatMessages(activeConvId);

	/* ── Client-facing queue ── */
	const queue = useMemo(() => {
		if (!Array.isArray(conversations)) return [];
		return conversations
			.filter((c) => c && CLIENT_TYPES.has(c.type))
			.filter((c) => !clientFilter || c.clientUserId === clientFilter)
			.sort((a, b) => ((b.lastMessageAt ?? b.updatedAt) || "").localeCompare(a.lastMessageAt ?? a.updatedAt ?? ""));
	}, [conversations, clientFilter]);

	const now = Date.now();
	const isMine = useCallback((c: ChatConversation) => {
		const owner = ownerOf(c);
		return Boolean(opsUser) && owner?.opsUserId === opsUser!.opsUserId;
	}, [opsUser]);
	const isUnclaimed = useCallback((c: ChatConversation) => !ownerOf(c), []);

	const stats = useMemo(() => {
		const open = queue.filter((c) => !isClosed(c));
		const waiting = open.filter(awaitingReply);
		const longest = waiting.reduce((m, c) => Math.max(m, waitingHours(c, now)), 0);
		return {
			open: open.length,
			unread: queue.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
			awaiting: waiting.length,
			unclaimed: open.filter(isUnclaimed).length,
			longest,
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is this render's clock
	}, [queue]);

	const counts = useMemo<Record<Filter, number>>(() => {
		const open = queue.filter((c) => !isClosed(c));
		return {
			all: open.length,
			awaiting: open.filter(awaitingReply).length,
			unread: open.filter((c) => (c.unreadCount || 0) > 0).length,
			unclaimed: open.filter(isUnclaimed).length,
			mine: open.filter(isMine).length,
			support: open.filter((c) => c.type === "support").length,
			case: open.filter((c) => c.type === "case").length,
			stage: open.filter((c) => c.type === "stage").length,
			applicant: open.filter((c) => c.type === "applicant").length,
		};
	}, [queue, isMine, isUnclaimed]);

	const filtered = useMemo(() => {
		let list = queue;
		if (filter === "unread") list = list.filter((c) => (c.unreadCount || 0) > 0);
		else if (filter === "awaiting") list = list.filter(awaitingReply);
		else if (filter === "mine") list = list.filter(isMine);
		else if (filter === "unclaimed") list = list.filter(isUnclaimed);
		else if (filter !== "all") list = list.filter((c) => c.type === filter);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(c) =>
					c.title.toLowerCase().includes(q) ||
					(c.lastMessage?.content ?? "").toLowerCase().includes(q) ||
					(c.lastMessage?.senderName ?? "").toLowerCase().includes(q) ||
					c.participants.some((p) => p.name.toLowerCase().includes(q)),
			);
		}
		return list;
	}, [queue, filter, search, isMine, isUnclaimed]);

	/** Bands by who owes the next word: waiting on you (longest first), in conversation, resolved (folded). */
	const bands = useMemo(() => {
		const waiting = filtered.filter((c) => !isClosed(c) && awaitingReply(c)).sort((a, b) => waitingHours(b, now) - waitingHours(a, now));
		const talking = filtered.filter((c) => !isClosed(c) && !awaitingReply(c));
		const closed = filtered.filter(isClosed);
		return [
			{ id: "waiting", label: "Awaiting reply", note: "longest wait first", rows: waiting },
			{ id: "talking", label: "In conversation", note: "you replied last", rows: talking },
			{ id: "closed", label: "Resolved", note: showClosed ? "hide" : "show ▸", rows: closed },
		].filter((b) => b.rows.length > 0);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is this render's clock
	}, [filtered, showClosed]);

	const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
	const activeInQueue = activeConv && CLIENT_TYPES.has(activeConv.type);
	const activeOwner = activeConv ? ownerOf(activeConv) : null;

	const isOwn = useCallback(
		(m: ChatMessage) => m.senderOpsUserId != null && m.senderOpsUserId === opsUser?.opsUserId,
		[opsUser?.opsUserId],
	);

	const actionsConfig = useMemo<MessageActionsConfig>(() => ({
		reply: true,
		react: true,
		copy: true,
		edit: true,
		delete: true,
		forward: false,
		more: false,
	}), []);

	const bubbleCallbacks = useMemo(() => ({
		actions: actionsConfig,
		onReply: (m: ChatMessage) => {
			if (m.deletedAt) return;
			setReplyTo({
				id: m.id,
				senderName: m.senderName,
				content: m.content,
				deleted: m.deletedAt !== null && m.deletedAt !== undefined,
			});
			setEditingId(null);
		},
		onEdit: (m: ChatMessage) => {
			if (m.deletedAt || !isOwn(m)) return;
			setEditingId(m.id);
			setDraft(m.content);
			setReplyTo(null);
		},
		onDelete: (m: ChatMessage) => {
			if (m.deletedAt || !isOwn(m)) return;
			void deleteMessage(m.id);
		},
	}), [actionsConfig, isOwn, deleteMessage]);

	/* ── Open conversation: reset composer state, then load + mark read ── */
	const openConversation = useCallback((conv: ChatConversation) => {
		setReplyTo(null);
		setEditingId(null);
		setDraft("");
		setNoteMode(false);
		setPendingFiles([]);
		setShowSnippets(false);
		setShowReassign(false);
		window.history.replaceState(null, "", `/helpdesk?id=${conv.id}`);
	}, []);

	useEffect(() => {
		if (activeConvId) {
			void load();
			void markRead().then(() => refreshConvs());
		}
	}, [activeConvId, load, markRead, refreshConvs]);

	/* Context rail — one round trip per open thread. */
	useEffect(() => {
		if (!activeConvId || !activeInQueue) {
			setContext(null);
			return;
		}
		let cancelled = false;
		getChatConversationContext(activeConvId)
			.then((ctx) => { if (!cancelled) setContext(ctx); })
			.catch(() => { if (!cancelled) setContext(null); });
		return () => { cancelled = true; };
	}, [activeConvId, activeInQueue]);

	// Keep the badge clear on the thread the user is actively reading.
	const messageCount = messages.length;
	useEffect(() => {
		if (!activeConvId || !activeInQueue || messageCount === 0) return;
		if (typeof document !== "undefined" && document.hidden) return;
		void markRead().then(() => refreshConvs());
	}, [activeConvId, activeInQueue, messageCount, markRead, refreshConvs]);

	/* ── Resolve / reopen / reassign ── */
	const setStatus = useCallback(
		async (status: "open" | "closed" | "archived") => {
			if (!activeConvId) return;
			setStatusBusy(true);
			try {
				await setChatConversationStatus(activeConvId, status);
				await refreshConvs();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to update conversation");
			} finally {
				setStatusBusy(false);
			}
		},
		[activeConvId, refreshConvs],
	);

	const assignOwner = useCallback(
		async (targetOpsUserId: string | null) => {
			if (!activeConvId) return;
			setStatusBusy(true);
			setShowReassign(false);
			try {
				await setChatConversationOwner(activeConvId, targetOpsUserId);
				await refreshConvs();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to reassign");
			} finally {
				setStatusBusy(false);
			}
		},
		[activeConvId, refreshConvs],
	);

	/* ── Attachments: stage → upload → bind on send ── */
	const handleAttach = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const onFilesPicked = useCallback(
		async (files: FileList | null) => {
			if (!files || !activeConvId) return;
			setUploading(true);
			try {
				for (const file of Array.from(files)) {
					const staged = await stageChatAttachment(activeConvId, {
						fileName: file.name,
						contentType: file.type || "application/octet-stream",
						sizeBytes: file.size,
					});
					const attachmentId = await uploadStagedAttachment(staged, file);
					setPendingFiles((prev) => [...prev, { name: file.name, attachmentId }]);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Upload failed");
			} finally {
				setUploading(false);
				if (fileInputRef.current) fileInputRef.current.value = "";
			}
		},
		[activeConvId],
	);

	/* ── Send / edit / typing ── */
	const handleSend = useCallback(
		async (text: string) => {
			if (!activeConvId || (!text.trim() && pendingFiles.length === 0)) return;
			try {
				if (editingId) {
					await edit(editingId, text);
					setEditingId(null);
				} else {
					await send(text.trim() || "📎 Attachment", {
						replyToId: replyTo?.id,
						attachmentIds: pendingFiles.map((f) => f.attachmentId),
						visibility: noteMode ? "internal" : "public",
					});
					setReplyTo(null);
					setPendingFiles([]);
				}
				setDraft("");
				void refreshConvs();
				if (isTypingRef.current) {
					isTypingRef.current = false;
					void signalTyping(false);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to send message");
			}
		},
		[activeConvId, editingId, replyTo, pendingFiles, noteMode, send, edit, refreshConvs, signalTyping],
	);

	const handleTyping = useCallback(() => {
		if (!activeConvId) return;
		if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
		if (!isTypingRef.current) {
			isTypingRef.current = true;
			void signalTyping(true);
		}
		typingTimerRef.current = setTimeout(() => {
			isTypingRef.current = false;
			void signalTyping(false);
		}, 2500);
	}, [activeConvId, signalTyping]);

	return (
		<div className="page-content fade-in hd-page">
			<div className="admin-section-head" style={{ marginBottom: "1rem" }}>
				<div>
					<h1 className="page-title">Helpdesk</h1>
					<p className="lead mt-1">Every client conversation, the ones waiting on you first.</p>
				</div>
			</div>

			{!canChat ? (
				<p className="muted mt-2" style={{ color: "var(--error, #b00)" }}>
					This role can&apos;t access the client conversation queue.
				</p>
			) : (
				<>
					{error && (
						<p className="muted mt-2" style={{ color: "var(--error, #b00)" }}>{error}</p>
					)}

					<div className="dash-day" style={{ margin: "0 0 1rem" }}>
						<span>
							<strong>{stats.open}</strong> <span className="dash-day__date">open</span>
						</span>
						<span>
							<strong>{stats.awaiting}</strong> <span className="dash-day__date">awaiting reply</span>
						</span>
						<span>
							<strong>{stats.unclaimed}</strong> <span className="dash-day__date">unclaimed</span>
						</span>
						<span>
							<strong>{stats.unread}</strong> <span className="dash-day__date">unread</span>
						</span>
						<span>
							<strong>{stats.longest > 0 ? waitLabel(stats.longest) : "—"}</strong> <span className="dash-day__date">longest wait</span>
						</span>
						<span className="dash-day__sep" aria-hidden>
							|
						</span>
						<Link to="/workspace" className="dash-link">
							Open the Worklist →
						</Link>
					</div>

					<div className="ops-split hd-split">
						{/* Queue list */}
						<div className="ops-split__list hd-list">
							<div className="hd-list__head">
								<div className="cn-scaffold__chips" role="tablist" aria-label="Conversations">
									{CHIPS.map((f) => {
										const n = counts[f.id];
										const on = filter === f.id;
										if (n === 0 && !["all", "awaiting", "unread", "mine", "unclaimed"].includes(f.id)) return null;
										return (
											<button
												key={f.id}
												type="button"
												role="tab"
												aria-selected={on}
												className="ops-pill"
												onClick={() => setFilter(f.id)}
												style={{
													cursor: "pointer",
													marginLeft: 0,
													border: "1px solid var(--border)",
													background: on ? "var(--foreground)" : "transparent",
													color: on ? "var(--background)" : n === 0 ? "var(--muted-foreground)" : "var(--foreground)",
													fontWeight: f.id === "awaiting" && n > 0 && !on ? 700 : 500,
												}}
											>
												{f.label}
												<span className="mono" style={{ marginLeft: "0.4rem", opacity: on ? 0.85 : 0.6 }}>
													{n}
												</span>
											</button>
										);
									})}
								</div>
								<input
									type="search"
									className="cn-search"
									placeholder="Search client, request…"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									aria-label="Search conversations"
									style={{ marginTop: "0.5rem" }}
								/>
								{clientFilter && (
									<p className="mono muted" style={{ fontSize: "var(--text-xs)", margin: "0.5rem 0 0" }}>
										Filtered to one client · <Link to="/helpdesk" className="dash-link">clear</Link>
									</p>
								)}
							</div>

							<div className="hd-list__body">
								{convsLoading ? (
									<p className="muted hd-empty">Loading conversations…</p>
								) : bands.length === 0 ? (
									<p className="muted hd-empty">No client requests match.</p>
								) : (
									bands.map((band) => (
										<div key={band.id}>
											<div
												className={`ops-band hd-band${band.id === "closed" ? " ops-band--toggle" : ""}`}
												role={band.id === "closed" ? "button" : undefined}
												tabIndex={band.id === "closed" ? 0 : undefined}
												onClick={band.id === "closed" ? () => setShowClosed((v) => !v) : undefined}
												onKeyDown={
													band.id === "closed"
														? (e) => {
																if (e.key === "Enter" || e.key === " ") {
																	e.preventDefault();
																	setShowClosed((v) => !v);
																}
															}
														: undefined
												}
											>
												<span className="ops-band__name">
													{band.label} · {band.rows.length}
												</span>
												<span className="ops-band__note">{band.note}</span>
											</div>
											{(band.id !== "closed" || showClosed) &&
												band.rows.map((c) => {
													const hours = waitingHours(c, now);
													const link = entityLink(c);
													const owner = ownerOf(c);
													return (
														<button
															key={c.id}
															type="button"
															className={`hd-row${activeConvId === c.id ? " hd-row--active" : ""}${hours >= 24 ? " hd-row--wait" : ""}`}
															onClick={() => openConversation(c)}
														>
															<span className="hd-row__line">
																<span className="hd-row__main">
																	<span className="hd-row__ref mono">{kickerOf(c)}</span>
																	<span className="hd-row__title">{clientName(c)}</span>
																	<span className="hd-row__meta">
																		{c.lastMessage
																			? `${c.lastMessage.senderUserId ? c.lastMessage.senderName : "You"}: ${c.lastMessage.content}`
																			: link
																				? link.label.replace("Open ", "")
																				: c.participants.map((p) => p.name).join(", ")}
																	</span>
																</span>
																<span className="hd-row__side">
																	<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
																		{convTime(c.lastMessage?.createdAt ?? c.lastMessageAt ?? c.updatedAt)}
																	</span>
																	{c.unreadCount > 0 ? <span className="hd-row__unread mono">{c.unreadCount}</span> : null}
																	{hours > 0 && band.id === "waiting" ? <span className={`hd-row__wait mono${hours >= 24 ? " hd-row__wait--long" : ""}`}>waiting {waitLabel(hours)}</span> : null}
																	{isClosed(c) ? (
																		<span className="hd-row__owner mono">{c.status}</span>
																	) : (
																		<span className="hd-row__owner mono">
																			{owner ? (owner.opsUserId === opsUser?.opsUserId ? "you" : owner.name) : "unclaimed"}
																		</span>
																	)}
																</span>
															</span>
														</button>
													);
												})}
										</div>
									))
								)}
							</div>
						</div>

						{/* Thread + context rail */}
						<div className="ops-split__detail hd-detail">
							{!activeConv || !activeInQueue ? (
								<div className="hd-placeholder">
									<p className="muted">Select a client request to read the thread and reply.</p>
								</div>
							) : (
								<div className="hd-thread-wrap">
									<ConversationThread
										conversation={activeConv}
										messages={messages}
										hasMore={hasMore}
										msgsLoading={msgsLoading}
										sending={sending}
										typing={typing}
										draft={draft}
										noteMode={noteMode}
										replyTo={replyTo}
										editingId={editingId}
										pendingFiles={pendingFiles}
										uploading={uploading}
										showSnippets={showSnippets}
										showReassign={showReassign}
										directory={directory}
										owner={activeOwner}
										isOwner={activeOwner?.opsUserId === opsUser?.opsUserId}
										statusBusy={statusBusy}
										isOwn={isOwn}
										bubbleCallbacks={bubbleCallbacks}
										onDraftChange={setDraft}
										onSend={handleSend}
										onTyping={handleTyping}
										onCancelReply={() => setReplyTo(null)}
										onCancelEdit={() => setEditingId(null)}
										onToggleNote={() => setNoteMode((v) => !v)}
										onToggleSnippets={() => setShowSnippets((v) => !v)}
										onToggleReassign={() => setShowReassign((v) => !v)}
										onSnippet={(body) => { setDraft(body); setShowSnippets(false); }}
										onAttach={handleAttach}
										onRemoveFile={(id) => setPendingFiles((prev) => prev.filter((f) => f.attachmentId !== id))}
										onResolve={() => void setStatus("closed")}
										onReopen={() => void setStatus("open")}
										onReassign={(id) => void assignOwner(id)}
										onClaim={() => opsUser && void assignOwner(opsUser.opsUserId)}
										onLoadMore={loadMore}
										onBack={() => {
											window.history.replaceState(null, "", "/helpdesk");
										}}
										onReact={(messageId, emoji) => void react(messageId, emoji)}
										onQuoteClick={(messageId) => {
											const el = document.getElementById(`msg-${messageId}`);
											if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
										}}
									/>
									<ContextRail context={context} conversation={activeConv} />
								</div>
							)}
						</div>
					</div>

					<input
						ref={fileInputRef}
						type="file"
						multiple
						style={{ display: "none" }}
						onChange={(e) => void onFilesPicked(e.target.files)}
					/>
				</>
			)}
		</div>
	);
}

/* ── Context rail ───────────────────────────────────────────────────────── */

function ContextRail({
	context,
	conversation,
}: {
	context: ChatConversationContext | null;
	conversation: ChatConversation;
}) {
	return (
		<aside className="hd-rail">
			<div className="hd-rail__block">
				<div className="hd-rail__label">Client</div>
				{context?.client ? (
					<>
						<div className="hd-rail__title">{context.client.name}</div>
						<div className="hd-rail__line">{context.client.email ?? "—"}</div>
						<div className="hd-rail__line">
							{[context.client.branch, context.client.targetCountry].filter(Boolean).join(" · ") || "—"}
						</div>
						{context.client.memberSince && (
							<div className="hd-rail__line">Client since {new Date(context.client.memberSince).toLocaleDateString()}</div>
						)}
					</>
				) : (
					<div className="hd-rail__line">No applicant record linked.</div>
				)}
			</div>

			<div className="hd-rail__block">
				<div className="hd-rail__label">Journey</div>
				{context && context.cases.length > 0 ? (
					context.cases.map((c) => (
						<Link key={c.id} to={`/applications?id=${c.id}`} className="hd-rail__link">
							<span className="mono">{c.appNumber}</span>
							<span className="hd-rail__line">{c.stageLabel} · {c.status}</span>
						</Link>
					))
				) : (
					<div className="hd-rail__line">No open cases.</div>
				)}
			</div>

			<div className="hd-rail__block">
				<div className="hd-rail__label">Money</div>
				{context && context.money.length > 0 ? (
					context.money.map((m, i) => (
						<div key={i} className="hd-rail__line">
							<span className="mono">{m.invoiceNumber}</span> — {m.type} · {m.status}
						</div>
					))
				) : (
					<div className="hd-rail__line">No invoices.</div>
				)}
			</div>

			<div className="hd-rail__block">
				<div className="hd-rail__label">Next appointment</div>
				{context?.nextAppointment ? (
					<div className="hd-rail__line">
						{context.nextAppointment.serviceName} —{" "}
						{new Date(context.nextAppointment.startsAt).toLocaleString([], {
							weekday: "short",
							month: "short",
							day: "numeric",
							hour: "numeric",
							minute: "2-digit",
						})}
					</div>
				) : (
					<div className="hd-rail__line">None booked.</div>
				)}
			</div>

			<div className="hd-rail__block">
				<div className="hd-rail__label">Thread</div>
				<div className="hd-rail__line">
					{context?.owner ? `Owner: ${context.owner.name}` : "Unclaimed"}
				</div>
				<div className="hd-rail__line">{context?.messageCount ?? conversation.participants.length ? `${context?.messageCount ?? 0} messages` : ""}</div>
				<div className="hd-rail__line">{conversation.status}</div>
			</div>
		</aside>
	);
}

/* ── Conversation Thread (shared chat-ui components) ────────────────────── */

interface ConversationThreadProps {
	conversation: ChatConversation;
	messages: ChatMessage[];
	hasMore: boolean;
	msgsLoading: boolean;
	sending: boolean;
	typing: { name?: string } | null;
	draft: string;
	noteMode: boolean;
	replyTo: QuotedMessage | null;
	editingId: string | null;
	pendingFiles: { name: string; attachmentId: string }[];
	uploading: boolean;
	showSnippets: boolean;
	showReassign: boolean;
	directory: { opsUserId: string; name: string; role: string }[];
	owner: { opsUserId: string; name: string } | null;
	isOwner: boolean;
	statusBusy: boolean;
	isOwn: (m: ChatMessage) => boolean;
	bubbleCallbacks: {
		actions: MessageActionsConfig;
		onReply: (m: ChatMessage) => void;
		onEdit: (m: ChatMessage) => void;
		onDelete: (m: ChatMessage) => void;
	};
	onDraftChange: (v: string) => void;
	onSend: (text: string) => void;
	onTyping: () => void;
	onCancelReply: () => void;
	onCancelEdit: () => void;
	onToggleNote: () => void;
	onToggleSnippets: () => void;
	onToggleReassign: () => void;
	onSnippet: (body: string) => void;
	onAttach: () => void;
	onRemoveFile: (attachmentId: string) => void;
	onResolve: () => void;
	onReopen: () => void;
	onReassign: (opsUserId: string | null) => void;
	onClaim: () => void;
	onLoadMore: () => void;
	onBack: () => void;
	onReact: (messageId: string, emoji: string) => void;
	onQuoteClick: (messageId: string) => void;
}

function ConversationThread({
	conversation,
	messages,
	hasMore,
	msgsLoading,
	sending,
	typing,
	draft,
	noteMode,
	replyTo,
	editingId,
	pendingFiles,
	uploading,
	showSnippets,
	showReassign,
	directory,
	owner,
	isOwner,
	statusBusy,
	isOwn,
	bubbleCallbacks,
	onDraftChange,
	onSend,
	onTyping,
	onCancelReply,
	onCancelEdit,
	onToggleNote,
	onToggleSnippets,
	onToggleReassign,
	onSnippet,
	onAttach,
	onRemoveFile,
	onResolve,
	onReopen,
	onReassign,
	onClaim,
	onLoadMore,
	onBack,
	onReact,
	onQuoteClick,
}: ConversationThreadProps) {
	ensureChatUiStyles();

	const closed = isClosed(conversation);

	const showAuthor = useCallback(
		(m: ChatMessage) => {
			const isGroup = conversation.type === "group" || conversation.type === "entity";
			return isGroup && !isOwn(m);
		},
		[conversation, isOwn],
	);

	const bubbleProps = useMemo(() => ({
		actions: bubbleCallbacks.actions,
		onReply: bubbleCallbacks.onReply,
		onEdit: bubbleCallbacks.onEdit,
		onDelete: bubbleCallbacks.onDelete,
		onQuoteClick,
		onReact: (message: ChatMessage, emoji: string) => onReact(message.id, emoji),
	}), [bubbleCallbacks, onQuoteClick, onReact]);

	return (
		<div style={streamContainerStyle}>
			<div style={threadHeaderStyle}>
				<button
					type="button"
					onClick={onBack}
					style={backBtnStyle}
					aria-label="Back to conversations"
				>
					←
				</button>
				<div style={{ minWidth: 0, flex: 1 }}>
					<div className="cn-detailhead__kicker" style={{ marginBottom: 0 }}>{kickerOf(conversation)}</div>
					<div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clientName(conversation)}</div>
					<div style={{ fontSize: 10, color: "#52525b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
						{conversation.participants.length > 0 ? `with ${conversation.participants.map((p) => p.name).join(", ")}` : ""}
						{conversation.status !== "open" ? ` · ${conversation.status}` : ""}
						{owner ? ` · ${isOwner ? "you" : owner.name}` : " · unclaimed"}
					</div>
				</div>
				{(() => {
					const link = entityLink(conversation);
					return link ? (
						<Link to={link.to} className="btn btn--ghost btn--sm" style={{ flexShrink: 0 }}>
							{link.label} →
						</Link>
					) : conversation.linkedEntityType ? (
						<span style={stagePillMiniStyle}>{conversation.linkedEntityType.toUpperCase()}</span>
					) : null;
				})()}
				{/* Lifecycle + ownership controls */}
				{closed ? (
					<button type="button" className="btn btn--ghost btn--sm" onClick={onReopen} disabled={statusBusy}>
						Reopen
					</button>
				) : (
					<button type="button" className="btn btn--primary btn--sm" onClick={onResolve} disabled={statusBusy}>
						Resolve ✓
					</button>
				)}
				{!owner && !closed && (
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClaim} disabled={statusBusy}>
						Claim
					</button>
				)}
				<div style={{ position: "relative" }}>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onToggleReassign} disabled={statusBusy}>
						Reassign
					</button>
					{showReassign && (
						<div className="hd-pop">
							{owner && (
								<button type="button" className="hd-pop__row" onClick={() => onReassign(null)}>
									— Release (unclaim)
								</button>
							)}
							{directory.map((s) => (
								<button
									key={s.opsUserId}
									type="button"
									className="hd-pop__row"
									onClick={() => onReassign(s.opsUserId)}
								>
									{s.name} <span className="muted mono" style={{ fontSize: 10 }}>{s.role.toUpperCase()}</span>
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			<MessageList
				messages={messages}
				typing={typing}
				isOwn={isOwn}
				showAuthor={showAuthor}
				bubbleProps={bubbleProps}
				onQuoteClick={onQuoteClick}
				header={
					hasMore ? (
						<button
							type="button"
							onClick={onLoadMore}
							style={{
								display: "block",
								margin: "0 auto 12px",
								padding: "4px 12px",
								background: "transparent",
								border: "1px solid var(--cn-chat-border)",
								borderRadius: "var(--cn-chat-radius-pill)",
								fontSize: 10,
								cursor: "pointer",
								fontFamily: "var(--cn-chat-font-mono)",
								color: "var(--cn-chat-muted-fg)",
							}}
						>
							LOAD EARLIER
						</button>
					) : msgsLoading && messages.length === 0 ? (
						<div style={{ textAlign: "center", color: "var(--cn-chat-muted-fg)", fontSize: 12, padding: 16 }}>
							Loading messages...
						</div>
					) : null
				}
			/>

			{/* Staged attachments */}
			{pendingFiles.length > 0 && (
				<div className="hd-attach-tray">
					{pendingFiles.map((f) => (
						<span key={f.attachmentId} className="hd-attach">
							📎 {f.name}
							<button type="button" onClick={() => onRemoveFile(f.attachmentId)} aria-label={`Remove ${f.name}`}>×</button>
						</span>
					))}
				</div>
			)}

			{/* Reply ⇄ Note toggle + tools */}
			<div className="hd-composer-bar">
				<div className="hd-composer-bar__mode" role="tablist" aria-label="Message mode">
					<button
						type="button"
						role="tab"
						aria-selected={!noteMode}
						className={`hd-mode${noteMode ? "" : " hd-mode--on"}`}
						onClick={() => noteMode && onToggleNote()}
					>
						Reply
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={noteMode}
						className={`hd-mode${noteMode ? " hd-mode--on" : ""}`}
						onClick={() => !noteMode && onToggleNote()}
						title="Staff-only note — the client never sees it"
					>
						Note
					</button>
				</div>
				<button type="button" className="hd-tool" onClick={onToggleSnippets} title="Canned replies">
					Snippets
				</button>
				<button type="button" className="hd-tool" onClick={onAttach} disabled={uploading} title="Attach a file">
					{uploading ? "Uploading…" : "📎"}
				</button>
			</div>
			{showSnippets && (
				<div className="hd-snips">
					{SNIPPETS.map((s) => (
						<button key={s.id} type="button" className="hd-snips__row" onClick={() => onSnippet(s.body)}>
							<strong>{s.label}</strong>
							<span className="muted">{s.body.slice(0, 72)}…</span>
						</button>
					))}
				</div>
			)}
			{noteMode && (
				<div className="hd-note-hint mono">
					NOTE — visible to staff only. The client never sees this.
				</div>
			)}

			<Composer
				value={draft}
				onChange={onDraftChange}
				onSend={onSend}
				sending={sending}
				replyTo={replyTo}
				onCancelReply={onCancelReply}
				editing={!!editingId}
				onCancelEdit={onCancelEdit}
				onTyping={onTyping}
				placeholder={
					editingId
						? "Edit message…"
						: replyTo
							? `Reply to ${replyTo.senderName}…`
							: noteMode
								? "Write a staff-only note…"
								: closed
									? "Replying reopens this thread…"
									: "Reply to the client…"
				}
			/>
		</div>
	);
}

function convTime(iso?: string) {
	if (!iso) return "";
	const date = new Date(iso);
	const now = new Date();
	const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
	if (diffDays === 0) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
	return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const streamContainerStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const threadHeaderStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 10,
	padding: "10px 16px",
	background: "#ffffff",
	borderBottom: "1px solid #f4f4f5",
	flexShrink: 0,
};

const backBtnStyle: CSSProperties = {
	background: "none",
	border: "none",
	cursor: "pointer",
	padding: 0,
	fontSize: 16,
	color: "#18181b",
	flexShrink: 0,
	lineHeight: 1,
};

const stagePillMiniStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	fontWeight: 700,
	color: "#52525b",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	padding: "2px 5px",
	borderRadius: "0px",
	flexShrink: 0,
};
