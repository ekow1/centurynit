import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useOpsAuth, type OpsRole } from "./OpsAuthContext";
import {
	useChatConversations,
	useChatMessages,
	useCreateConversation,
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
	listClientUsers,
	setChatConversationStatus,
	setChatConversationOwner,
	getChatConversationContext,
	stageChatAttachment,
	uploadStagedAttachment,
	createChatRequest,
	setChatWaitingOn,
	escalateChatConversation,
	listCannedReplies,
	getDeskStats,
	type CannedReply,
	type DeskStats,
	type ChatConversationContext,
	type ClientUser,
} from "../lib/api";
import { Sheet } from "century-nit-core/ui";
import { useCases } from "../hooks/useCases";
import { useUrlParam } from "../hooks/useUrlParam";

/**
 * Helpdesk - client conversation queue.
 *
 * Client requests (support / case / stage / applicant conversations) raised
 * from the portal land in the same chat system the OPS console uses for
 * messaging, so there is one thread model platform-wide - no separate ticket
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

type Filter = "all" | "awaiting" | "waiting" | "unclaimed" | "mine" | "breaching";
type TypeFacet = "" | "support" | "case" | "stage" | "applicant";
type SortMode = "recent" | "waiting";

const FILTERS: Filter[] = ["all", "awaiting", "waiting", "unclaimed", "mine", "breaching"];
const FILTER_LABELS: Record<Filter, string> = {
	all: "All",
	awaiting: "Awaiting reply",
	waiting: "Waiting on client",
	unclaimed: "Unclaimed",
	mine: "Mine",
	breaching: "Breaching",
};
const TYPE_FACETS: { id: TypeFacet; label: string }[] = [
	{ id: "", label: "Any type" },
	{ id: "support", label: "Support" },
	{ id: "case", label: "Case" },
	{ id: "stage", label: "Stage" },
	{ id: "applicant", label: "Applicant" },
];

const SNIPPETS: { id: string; label: string; body: string }[] = [
	{ id: "ack", label: "Acknowledge", body: "Thanks for reaching out - I'm looking into this now and will come back to you shortly." },
	{ id: "docs", label: "Request documents", body: "Could you upload the requested document here? A clear photo or PDF works - I'll confirm receipt as soon as it lands." },
	{ id: "payment", label: "Payment received", body: "Your payment has been received and allocated to your invoice. The updated receipt is in your portal under Money." },
	{ id: "visa", label: "Visa update", body: "Your application is with the visa team. We'll message you the moment there's a decision or if anything further is needed." },
	{ id: "close", label: "Resolve + close", body: "Glad we could get this sorted. I'll mark this request resolved - reply here any time and it reopens automatically." },
];

/**
 * "Awaiting reply" means exactly one thing: the last PUBLIC message came
 * from the client. The server computes it (an internal note must not clear
 * it, and the viewer's unread cursor must not set it); the local check is a
 * fallback for payloads that predate the field.
 */
const awaitingReply = (c: ChatConversation) => c.awaitingReply ?? Boolean(c.lastMessage?.senderUserId);
const isClosed = (c: ChatConversation) => c.status === "closed" || c.status === "archived";
/** Open + not waiting on us = the ball is with the client. */
const waitingOnClient = (c: ChatConversation) =>
	!isClosed(c) && (c.waitingOn === "client" || (!awaitingReply(c) && c.lastMessage != null));
/** Past first-response or resolution target — settings from the desk stats. */
const isBreaching = (c: ChatConversation, s: DeskStats | null, now: number) => {
	if (isClosed(c) || !s) return false;
	const ageMin = (now - new Date(c.createdAt).getTime()) / 60000;
	const resAgeH = (now - new Date(c.lastMessageAt ?? c.updatedAt).getTime()) / 3600000;
	return (c.firstResponseAt == null && ageMin > s.settings.firstResponseMinutes) || resAgeH > s.settings.resolutionHours;
};

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
/** "Support · APP-2026-0142", "Stage · Consultation" - the thread's subject without opening it. */
function kickerOf(c: ChatConversation): string {
	const type = TYPE_LABELS[c.type] ?? c.type;
	// Requests carry a subject — show it; the category tags along.
	if (c.subject) return `${c.category ? `${c.category.toUpperCase()} · ` : ""}${c.subject}`;
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
	const [searchParams, setSearchParams] = useSearchParams();
	// The page lives under the `helpdesk` module; the shared chat backend
	// accepts either `helpdesk` or `chat`, so gate the queue on whichever the
	// role holds rather than dead-ending helpdesk-only roles on a 403.
	const canChat = roleCanAccess(opsRole as OpsRole, "helpdesk") || roleCanAccess(opsRole as OpsRole, "chat");

	// The conversation id is the URL's source of truth, so /helpdesk?id=… deep
	// links (e.g. from the Team Assignments board) open a thread directly.
	// Anything that isn't a UUID (stale /chat?id=<ref> links, case refs pasted
	// into the bar) must not reach the API - it validates the path as uuid and
	// would 400 every messages/context/read call against it.
	const rawConvId = searchParams.get("id") || null;
	const activeConvId = rawConvId && UUID_RE.test(rawConvId) ? rawConvId : null;
	// /helpdesk?client=<clientUserId> - deep link from the client directory
	// record pane; narrows the queue to that account's threads.
	const clientFilter = searchParams.get("client") || null;

	const { conversations, loading: convsLoading, error: convsError, forbidden: convsForbidden, refresh: refreshConvs } = useChatConversations(canChat, "desk");
	const directory = useStaffDirectory();
	const { applications } = useCases();
	const { create, creating } = useCreateConversation();

	// Filter state lives in the URL - a filtered queue is a shareable link.
	const [filter, setFilter] = useUrlParam<Filter>("f", { allowed: FILTERS, fallback: "all" });
	const [typeFacet, setTypeFacet] = useUrlParam<TypeFacet>("type", { allowed: ["", "support", "case", "stage", "applicant"], fallback: "" });
	const [unreadOnly, setUnreadOnly] = useUrlParam<"" | "1">("unread", { allowed: ["", "1"], fallback: "" });
	const [sortMode, setSortMode] = useUrlParam<SortMode>("sort", { allowed: ["recent", "waiting"], fallback: "recent" });
	// ?new=1 opens the start-a-thread sheet; ?client= pre-fills its picker.
	const [newOpen, setNewOpen] = useUrlParam<"" | "1">("new", { allowed: ["", "1"], fallback: "" });
	// ?log=1 opens the Log-request sheet — staff intake for phone/walk-in
	// requests and internal tickets.
	const [logOpen, setLogOpen] = useUrlParam<"" | "1">("log", { allowed: ["", "1"], fallback: "" });
	const [desk, setDesk] = useState<DeskStats | null>(null);
	const [snippets, setSnippets] = useState<CannedReply[]>([]);
	const [showClosed, setShowClosed] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [railOpen, setRailOpen] = useState(false);
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

	// Desk stats refresh alongside the queue; canned replies load once.
	useEffect(() => {
		if (!canChat) return;
		getDeskStats().then(setDesk).catch(() => {});
	}, [canChat, conversations]);
	useEffect(() => {
		if (!canChat) return;
		listCannedReplies().then((r) => { if (r.length) setSnippets(r); }).catch(() => {});
	}, [canChat]);

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
			waiting: open.filter(waitingOnClient).length,
			unclaimed: open.filter(isUnclaimed).length,
			mine: open.filter(isMine).length,
			breaching: open.filter((c) => isBreaching(c, desk, now)).length,
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is this render's clock
	}, [queue, isMine, isUnclaimed, desk]);

	const filtered = useMemo(() => {
		let list = queue;
		if (filter === "awaiting") list = list.filter(awaitingReply);
		else if (filter === "waiting") list = list.filter(waitingOnClient);
		else if (filter === "mine") list = list.filter(isMine);
		else if (filter === "unclaimed") list = list.filter(isUnclaimed);
		else if (filter === "breaching") list = list.filter((c) => isBreaching(c, desk, now));
		if (typeFacet) list = list.filter((c) => c.type === typeFacet);
		if (unreadOnly === "1") list = list.filter((c) => (c.unreadCount || 0) > 0);
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
		if (sortMode === "waiting") {
			list = [...list].sort((a, b) => waitingHours(b, now) - waitingHours(a, now));
		}
		return list;
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is this render's clock
	}, [queue, filter, typeFacet, unreadOnly, sortMode, search, isMine, isUnclaimed, desk]);

	/** Bands by who owes the next word: breaching SLA, waiting on us (longest
	    first), waiting on the client, resolved (folded). */
	const bands = useMemo(() => {
		const breaching = filtered.filter((c) => isBreaching(c, desk, now)).sort((a, b) => waitingHours(b, now) - waitingHours(a, now));
		const breachingIds = new Set(breaching.map((c) => c.id));
		const waiting = filtered.filter((c) => !isClosed(c) && !breachingIds.has(c.id) && awaitingReply(c)).sort((a, b) => waitingHours(b, now) - waitingHours(a, now));
		const waitingClient = filtered.filter((c) => !isClosed(c) && !breachingIds.has(c.id) && !awaitingReply(c) && waitingOnClient(c));
		const talking = filtered.filter((c) => !isClosed(c) && !breachingIds.has(c.id) && !awaitingReply(c) && !waitingOnClient(c));
		const closed = filtered.filter(isClosed);
		return [
			{ id: "breaching", label: "Breaching", note: "past first-response or resolution target", rows: breaching },
			{ id: "waiting", label: "Awaiting reply", note: "longest wait first", rows: waiting },
			{ id: "waiting_client", label: "Waiting on client", note: "ball is with them", rows: waitingClient },
			{ id: "talking", label: "In conversation", note: "you replied last", rows: talking },
			{ id: "closed", label: "Resolved", note: showClosed ? "hide" : "show ▸", rows: closed },
		].filter((b) => b.rows.length > 0);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is this render's clock
	}, [filtered, showClosed, desk]);

	const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
	const activeInQueue = activeConv && CLIENT_TYPES.has(activeConv.type);
	const activeOwner = activeConv ? ownerOf(activeConv) : null;

	// The drawer opens itself when a deep link set one of its facets.
	const drawerActive = drawerOpen || Boolean(typeFacet) || unreadOnly === "1" || sortMode !== "recent";

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

	// A non-uuid ?id is a dead deep link - drop it so refresh/share don't replay it.
	useEffect(() => {
		if (rawConvId && !UUID_RE.test(rawConvId)) {
			setSearchParams((prev) => {
				const p = new URLSearchParams(prev);
				p.delete("id");
				return p;
			}, { replace: true });
		}
	}, [rawConvId, setSearchParams]);

	/* ── Open conversation: reset composer state, then load + mark read ── */
	const openConversation = useCallback((conv: ChatConversation) => {
		setReplyTo(null);
		setEditingId(null);
		setDraft("");
		setNoteMode(false);
		setPendingFiles([]);
		setShowSnippets(false);
		setShowReassign(false);
			setRailOpen(false);
		// Raw history.replaceState bypasses React Router - useSearchParams never
		// sees it, so the detail pane never opens. setSearchParams notifies it.
		setSearchParams((prev) => {
			const p = new URLSearchParams(prev);
			p.set("id", conv.id);
			return p;
		}, { replace: true });
	}, [setSearchParams]);

	useEffect(() => {
		if (activeConvId) {
			void load();
			void markRead().then(() => refreshConvs());
		}
	}, [activeConvId, load, markRead, refreshConvs]);

	/* Context rail - one round trip per open thread. */
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

	// Canned replies — managed rows when the desk has created any, the
	// built-in five otherwise. {{client.firstName}} fills at insert time.
	const activeSnippetList = useMemo(() => {
		const src = snippets.length ? snippets : SNIPPETS;
		const first = activeConv ? clientName(activeConv).split(" ")[0] : "";
		return src.map((s) => ({
			id: s.id,
			label: s.label,
			body: first ? s.body.replace(/\{\{\s*client\.firstName\s*\}\}/g, first) : s.body,
		}));
	}, [snippets, activeConv]);

	/* ── Waiting-on + escalation ── */
	const toggleWaiting = useCallback(async () => {
		if (!activeConvId || !activeConv) return;
		setStatusBusy(true);
		try {
			await setChatWaitingOn(activeConvId, activeConv.waitingOn === "client" ? "us" : "client");
			await refreshConvs();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update waiting state");
		} finally {
			setStatusBusy(false);
		}
	}, [activeConvId, activeConv, refreshConvs]);

	const doEscalate = useCallback(async (reason: string) => {
		if (!activeConvId || !reason.trim()) return;
		setStatusBusy(true);
		try {
			await escalateChatConversation(activeConvId, reason.trim());
			await refreshConvs();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to escalate");
		} finally {
			setStatusBusy(false);
		}
	}, [activeConvId, refreshConvs]);

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
				{canChat && (
					<div style={{ display: "flex", gap: "0.5rem" }}>
						<button type="button" className="btn btn--ghost" onClick={() => setLogOpen("1")}>
							+ Log request
						</button>
						<button type="button" className="btn btn--primary" onClick={() => setNewOpen("1")}>
							+ New conversation
						</button>
					</div>
				)}
			</div>

			{!canChat || convsForbidden ? (
				<p className="muted mt-2" style={{ color: "var(--error, #b00)" }}>
					Your role can view the helpdesk but can&apos;t open threads - chat access required. Ask a manager.
				</p>
			) : (
				<>
					{(error || convsError) && (
						<p className="muted mt-2" style={{ color: "var(--error, #b00)" }}>
							{error ?? convsError}{" "}
							{convsError && (
								<button type="button" className="dash-link" onClick={() => void refreshConvs()}>
									Retry
								</button>
							)}
						</p>
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
							<strong>{stats.longest > 0 ? waitLabel(stats.longest) : "-"}</strong> <span className="dash-day__date">longest wait</span>
						</span>
						{desk && desk.breaching > 0 && (
							<span style={{ color: "var(--warn, #b45309)" }}>
								<strong>{desk.breaching}</strong> <span className="dash-day__date">breaching</span>
							</span>
						)}
						{desk?.medianFirstResponseMinutes != null && (
							<span>
								<strong>{desk.medianFirstResponseMinutes < 60 ? `${desk.medianFirstResponseMinutes}m` : `${Math.round(desk.medianFirstResponseMinutes / 60)}h`}</strong>{" "}
								<span className="dash-day__date">median first reply</span>
							</span>
						)}
						{desk?.csatAvg != null && (
							<span>
								<strong>{desk.csatAvg}/5</strong> <span className="dash-day__date">CSAT</span>
							</span>
						)}
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
								<div className="hd-filters" role="tablist" aria-label="Conversations">
									{FILTERS.map((f) => {
										const n = counts[f];
										const on = filter === f;
										return (
											<button
												key={f}
												type="button"
												role="tab"
												aria-selected={on}
												className={`hd-chip${on ? " hd-chip--on" : ""}${f === "breaching" && n > 0 && !on ? " hd-chip--hot" : ""}`}
												onClick={() => setFilter(f)}
											>
												{FILTER_LABELS[f]} · {n}
											</button>
										);
									})}
									<button
										type="button"
										className={`hd-chip hd-chip--more${drawerActive ? " hd-chip--on" : ""}`}
										aria-expanded={drawerActive}
										onClick={() => setDrawerOpen((v) => !v)}
									>
										Filters {drawerActive ? "▴" : "▾"}
									</button>
								</div>
								{drawerActive && (
									<div className="hd-filters" role="group" aria-label="Refine" style={{ marginTop: "0.5rem" }}>
										{TYPE_FACETS.map((t) => (
											<button
												key={t.id || "any"}
												type="button"
												className={`hd-chip${typeFacet === t.id ? " hd-chip--on" : ""}`}
												aria-pressed={typeFacet === t.id}
												onClick={() => setTypeFacet(t.id)}
											>
												{t.label}
											</button>
										))}
										<button
											type="button"
											className={`hd-chip${unreadOnly === "1" ? " hd-chip--on" : ""}`}
											aria-pressed={unreadOnly === "1"}
											onClick={() => setUnreadOnly(unreadOnly === "1" ? "" : "1")}
										>
											Unread only
										</button>
										<select
											className="cn-select"
											value={sortMode}
											onChange={(e) => setSortMode(e.target.value as SortMode)}
											aria-label="Sort"
											style={{ marginLeft: "0.4rem" }}
										>
											<option value="recent">Sort · recent</option>
											<option value="waiting">Sort · longest waiting</option>
										</select>
									</div>
								)}
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
									<div className="hd-empty">
										<p className="muted">
											{queue.length === 0 && !search.trim()
												? "No client conversations yet - start one with + New conversation."
												: "No client requests match."}
										</p>
										{queue.length === 0 && !search.trim() && (
											<button type="button" className="btn btn--primary btn--sm" style={{ marginTop: "0.6rem" }} onClick={() => setNewOpen("1")}>
												+ New conversation
											</button>
										)}
									</div>
								) : (
									bands.map((band) => (
										<div key={band.id}>
											<div
												className={`ops-band hd-band${band.id === "breaching" ? " ops-band--hot" : ""}${band.id === "closed" ? " ops-band--toggle" : ""}`}
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
										<span className="hd-row__kick">{kickerOf(c)}</span>
										<span className="hd-row__who">
											<span className="hd-row__name">{clientName(c)}</span>
											<span className="hd-row__time">{convTime(c.lastMessage?.createdAt ?? c.lastMessageAt ?? c.updatedAt)}</span>
										</span>
										<span className="hd-row__snip">
											{c.lastMessage
												? `${c.lastMessage.senderUserId ? c.lastMessage.senderName : "You"}: ${c.lastMessage.content}`
												: link
													? link.label
													: c.participants.map((p) => p.name).join(", ")}
										</span>
										<span className="hd-row__tail">
											{hours > 0 ? <span className={`hd-tag${hours >= 24 ? " hd-tag--red" : ""}`}>waiting {waitLabel(hours)}</span> : null}
											{isClosed(c) ? (
												<span className="hd-tag">{c.status}</span>
											) : (
												<span className="hd-tag">{owner ? (owner.opsUserId === opsUser?.opsUserId ? "you" : owner.name) : "unclaimed"}</span>
											)}
											{c.unreadCount > 0 ? <span className="hd-unread">{c.unreadCount}</span> : null}
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
										snippetList={activeSnippetList}
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
										onToggleWaiting={() => void toggleWaiting()}
										onEscalate={(reason) => void doEscalate(reason)}
										onReopen={() => void setStatus("open")}
										onReassign={(id) => void assignOwner(id)}
										onClaim={() => opsUser && void assignOwner(opsUser.opsUserId)}
										onLoadMore={loadMore}
										onBack={() => {
											setSearchParams((prev) => {
												const p = new URLSearchParams(prev);
												p.delete("id");
												return p;
											}, { replace: true });
										}}
									onToggleRail={() => setRailOpen((v) => !v)}
										onReact={(messageId, emoji) => void react(messageId, emoji)}
										onQuoteClick={(messageId) => {
											const el = document.getElementById(`msg-${messageId}`);
											if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
										}}
									/>
								<ContextRail context={context} conversation={activeConv} open={railOpen} onClose={() => setRailOpen(false)} />
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

			{/* Mount only while open - state resets naturally on close. */}
			{newOpen === "1" && (
			<NewConversationSheet
				open
				prefillClientId={clientFilter}
				conversations={conversations}
				applications={applications}
				creating={creating}
				onClose={() => setNewOpen(null)}
				onSubmit={async ({ clientUserId, linkedEntityType, linkedEntityId, stageKey, initialMessage }) => {
					// Throws on failure - the sheet shows the error inline.
					const conv = await create({
						clientUserId,
						linkedEntityType,
						linkedEntityId,
						stageKey,
						initialMessage,
					});
					setNewOpen(null);
					setSearchParams((prev) => {
						const p = new URLSearchParams(prev);
						p.delete("new");
						p.set("id", conv.id);
						return p;
					}, { replace: true });
					void refreshConvs();
				}}
			/>
			)}

			{logOpen === "1" && (
				<LogRequestSheet
					open
					directory={directory}
					onClose={() => setLogOpen(null)}
					onSubmit={async (body) => {
						const conv = await createChatRequest(body);
						setLogOpen(null);
						setSearchParams((prev) => {
							const p = new URLSearchParams(prev);
							p.delete("log");
							if (!body.internal) p.set("id", conv.id);
							return p;
						}, { replace: true });
						void refreshConvs();
					}}
				/>
			)}
		</div>
	);
}

/* ── Context rail ───────────────────────────────────────────────────────── */

function ContextRail({
	context,
	conversation,
	open,
	onClose,
}: {
	context: ChatConversationContext | null;
	conversation: ChatConversation;
	open: boolean;
	onClose: () => void;
}) {
	const stClass = (s: string) =>
		/paid|settled|done|complet|accept|granted|resolved|closed/i.test(s)
			? "hd-st hd-st--ok"
			: /overdue|declin|breach|fail/i.test(s)
				? "hd-st hd-st--bad"
				: "hd-st hd-st--open";
	return (
		<aside className={`hd-rail${open ? " hd-rail--open" : ""}`}>
			<div className="hd-sect">
				<h4 className="hd-sect__h">
					Client
					<button type="button" className="hd-sect__x" onClick={onClose} aria-label="Close details">×</button>
				</h4>
				{context?.client ? (
					<>
						<p className="hd-sect__title">{context.client.name}</p>
						<p className="hd-kvline">{context.client.email ?? "-"}</p>
						<p className="hd-kvline">
							{[context.client.branch, context.client.targetCountry].filter(Boolean).join(" → ") || "-"}
						</p>
						{context.client.memberSince && (
							<p className="hd-kvline">Client since {new Date(context.client.memberSince).toLocaleDateString()}</p>
						)}
					</>
				) : (
					<p className="hd-kvline">No applicant record linked.</p>
				)}
			</div>

			<div className="hd-sect">
				<h4 className="hd-sect__h">Journey</h4>
				{context && context.cases.length > 0 ? (
					<div className="hd-journey">
						{context.cases.map((c) => (
							<Link key={c.id} to={`/applications?id=${c.id}`} className="hd-jrow">
								<span className="mono">{c.appNumber}</span>
								<span className={stClass(c.status)}>{c.stageLabel} · {c.status}</span>
							</Link>
						))}
					</div>
				) : (
					<p className="hd-kvline">No open cases.</p>
				)}
			</div>

			<div className="hd-sect">
				<h4 className="hd-sect__h">Money</h4>
				{context && context.money.length > 0 ? (
					context.money.map((m, i) => (
						<div key={i} className="hd-kv">
							<b className="mono">{m.invoiceNumber}</b>
							<span className={stClass(m.status)}>{m.type} · {m.status}</span>
						</div>
					))
				) : (
					<p className="hd-kvline">No invoices.</p>
				)}
			</div>

			<div className="hd-sect">
				<h4 className="hd-sect__h">Next appointment</h4>
				{context?.nextAppointment ? (
					<p className="hd-kvline">
						{context.nextAppointment.serviceName} —{" "}
						{new Date(context.nextAppointment.startsAt).toLocaleString([], {
							weekday: "short",
							month: "short",
							day: "numeric",
							hour: "numeric",
							minute: "2-digit",
						})}
					</p>
				) : (
					<p className="hd-kvline">None booked.</p>
				)}
			</div>

			<div className="hd-sect">
				<h4 className="hd-sect__h">Thread</h4>
				<div className="hd-kv"><b>Owner</b><span>{context?.owner ? context.owner.name : "Unclaimed"}</span></div>
				<div className="hd-kv"><b>Messages</b><span>{context?.messageCount ?? 0}</span></div>
				<div className="hd-kv"><b>Status</b><span className={stClass(conversation.status)}>{conversation.status}</span></div>
				<div className="hd-kv"><b>Waiting on</b><span>{conversation.waitingOn === "client" ? "client" : "us"}</span></div>
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
	snippetList: { id: string; label: string; body: string }[];
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
	onToggleWaiting: () => void;
	onEscalate: (reason: string) => void;
	onLoadMore: () => void;
	onBack: () => void;
	onToggleRail: () => void;
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
	snippetList,
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
	onToggleWaiting,
	onEscalate,
	onLoadMore,
	onBack,
	onToggleRail,
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

	const [escalateOpen, setEscalateOpen] = useState(false);
	const [escalateReason, setEscalateReason] = useState("");

	return (
		<div style={streamContainerStyle}>
			<div className="hd-thead">
				<button type="button" onClick={onBack} className="hd-back" aria-label="Back to conversations">←</button>
				<div className="hd-thead__id">
					<p className="hd-thead__kick">{kickerOf(conversation)}</p>
					<h2 className="hd-thead__title">{clientName(conversation)}</h2>
					<p className="hd-thead__sub">
						{conversation.participants.length > 0 ? `with ${conversation.participants.map((p) => p.name).join(", ")}` : ""}
						{conversation.status !== "open" ? ` · ${conversation.status}` : ""}
						{owner ? ` · ${isOwner ? "you" : owner.name}` : " · unclaimed"}
						{" · replies go to the portal"}
					</p>
				</div>
				<div className="hd-thead__actions">
					{(() => {
						const link = entityLink(conversation);
						return link ? (
							<Link to={link.to} className="btn btn--ghost btn--sm">{link.label} →</Link>
						) : conversation.linkedEntityType ? (
							<span className="hd-st">{conversation.linkedEntityType}</span>
						) : null;
					})()}
					{closed ? (
						<button type="button" className="btn btn--ghost btn--sm" onClick={onReopen} disabled={statusBusy}>Reopen</button>
					) : (
						<button type="button" className="btn btn--primary btn--sm" onClick={onResolve} disabled={statusBusy}>Resolve ✓</button>
					)}
					{!owner && !closed && (
						<button type="button" className="btn btn--ghost btn--sm" onClick={onClaim} disabled={statusBusy}>Claim</button>
					)}
					<div className="hd-popwrap">
						<button type="button" className="btn btn--ghost btn--sm" onClick={onToggleReassign} disabled={statusBusy}>Reassign</button>
						{showReassign && (
							<div className="hd-pop">
								{owner && (
									<button type="button" className="hd-pop__row" onClick={() => onReassign(null)}>- Release (unclaim)</button>
								)}
								{directory.map((s) => (
									<button key={s.opsUserId} type="button" className="hd-pop__row" onClick={() => onReassign(s.opsUserId)}>
										{s.name} <span className="muted mono" style={{ fontSize: 10 }}>{s.role.toUpperCase()}</span>
									</button>
								))}
							</div>
						)}
					</div>
					{!closed && (
						<button type="button" className="btn btn--ghost btn--sm" onClick={onToggleWaiting} disabled={statusBusy} title="Flip whose move it is — the queue bands on this">
							{conversation.waitingOn === "client" ? "⌛ client" : "⌛ us"}
						</button>
					)}
					<div className="hd-popwrap">
						<button type="button" className="btn btn--ghost btn--sm hd-btn--warn" onClick={() => setEscalateOpen((v) => !v)} disabled={statusBusy} title="Send to the manager queue">Escalate</button>
						{escalateOpen && (
							<div className="hd-pop" style={{ minWidth: "16rem", padding: "0.6rem" }}>
								<input
									className="cn-search"
									style={{ width: "100%", marginTop: 0, marginBottom: "0.5rem" }}
									placeholder="Why escalate? (one line)"
									value={escalateReason}
									onChange={(e) => setEscalateReason(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && escalateReason.trim()) onEscalate(escalateReason);
									}}
									autoFocus
								/>
								<button type="button" className="btn btn--primary btn--sm" style={{ width: "100%" }} disabled={!escalateReason.trim() || statusBusy} onClick={() => onEscalate(escalateReason)}>
									Escalate to managers
								</button>
							</div>
						)}
					</div>
					<button type="button" className="btn btn--ghost btn--sm hd-railtoggle" onClick={onToggleRail}>Details</button>
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
			<div className="hd-tabs" role="tablist" aria-label="Message mode">
				<button
					type="button"
					role="tab"
					aria-selected={!noteMode}
					className={`hd-tab${noteMode ? "" : " hd-tab--on"}`}
					onClick={() => noteMode && onToggleNote()}
				>
					Reply
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={noteMode}
					className={`hd-tab hd-tab--note${noteMode ? " hd-tab--on" : ""}`}
					onClick={() => !noteMode && onToggleNote()}
					title="Staff-only note - the client never sees it"
				>
					Note
				</button>
				<button
					type="button"
					className={`hd-tab${showSnippets ? " hd-tab--on" : ""}`}
					onClick={onToggleSnippets}
				>
					Snippets {showSnippets ? "▴" : "▾"}
				</button>
				<span className="hd-tabs__sp" />
				<button type="button" className="hd-tab hd-tab--aux" onClick={onAttach} disabled={uploading}>
					{uploading ? "Uploading…" : "Attach"}
				</button>
			</div>
			{showSnippets && (
				<div className="hd-snips">
					{snippetList.map((s) => (
						<button key={s.id} type="button" className="hd-snips__row" onClick={() => onSnippet(s.body)}>
							<strong>{s.label}</strong>
							<span className="muted">{s.body.slice(0, 72)}…</span>
						</button>
					))}
				</div>
			)}
			{noteMode && (
				<div className="hd-note-hint mono">
					NOTE - visible to staff only. The client never sees this.
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

/* ── New conversation sheet - staff-initiated client threads ────────────── */

type Regarding =
	| { kind: "support" }
	| { kind: "case"; applicationId: string }
	| { kind: "stage"; applicationId: string; stageKey: string }
	| { kind: "consultation"; consultationId: string };

function NewConversationSheet({
	open,
	prefillClientId,
	conversations,
	applications,
	creating,
	onClose,
	onSubmit,
}: {
	open: boolean;
	prefillClientId: string | null;
	conversations: ChatConversation[];
	applications: { id: string; appId: string; stage: string; status: string; applicantUserId?: string | null; email?: string }[];
	creating: boolean;
	onClose: () => void;
	onSubmit: (body: {
		clientUserId: string;
		linkedEntityType?: string;
		linkedEntityId?: string;
		stageKey?: string;
		initialMessage?: string;
	}) => Promise<void>;
}) {
	// The sheet only mounts its contents while open (see the render guard in
	// the parent), so state starts fresh on every open - no reset effect.
	const [clients, setClients] = useState<ClientUser[]>([]);
	const [clientsLoading, setClientsLoading] = useState(true);
	const [clientQuery, setClientQuery] = useState("");
	const [client, setClient] = useState<ClientUser | null>(null);
	const [regarding, setRegarding] = useState<Regarding>({ kind: "support" });
	const [message, setMessage] = useState("");
	const [sheetError, setSheetError] = useState<string | null>(null);

	// Load the client directory on mount; prefill from ?client=.
	useEffect(() => {
		let on = true;
		listClientUsers()
			.then((res) => {
				if (!on) return;
				const list = Array.isArray(res?.clients) ? res.clients : [];
				setClients(list);
				if (prefillClientId) {
					setClient(list.find((c) => c.id === prefillClientId) ?? null);
				}
			})
			.catch(() => { if (on) setSheetError("Could not load the client list"); })
			.finally(() => { if (on) setClientsLoading(false); });
		return () => { on = false; };
	}, [prefillClientId]);

	const clientMatches = useMemo(() => {
		const q = clientQuery.trim().toLowerCase();
		const list = q
			? clients.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
			: clients;
		return list.slice(0, 6);
	}, [clients, clientQuery]);

	// This client's open cases + current stage - the "Regarding" options.
	const clientCases = useMemo(() => {
		if (!client) return [];
		return applications.filter(
			(a) => (a.applicantUserId && a.applicantUserId === client.id) || (a.email && a.email === client.email),
		);
	}, [applications, client]);

	// Warn when an open thread already exists for this client - the API joins
	// it rather than forking a second one.
	const existingThread = useMemo(() => {
		if (!client) return null;
		return conversations.find(
			(c) => CLIENT_TYPES.has(c.type) && c.clientUserId === client.id && !isClosed(c),
		) ?? null;
	}, [conversations, client]);

	const pick = (c: ClientUser) => {
		setClient(c);
		setClientQuery("");
		setRegarding({ kind: "support" });
	};

	const submit = () => {
		if (!client) { setSheetError("Pick a client first"); return; }
		if (!message.trim()) { setSheetError("Write the first message - the client needs something to see"); return; }
		setSheetError(null);
		const body: Parameters<typeof onSubmit>[0] = {
			clientUserId: client.id,
			initialMessage: message.trim(),
		};
		if (regarding.kind === "case") {
			body.linkedEntityType = "application";
			body.linkedEntityId = regarding.applicationId;
		} else if (regarding.kind === "stage") {
			body.linkedEntityType = "application";
			body.linkedEntityId = regarding.applicationId;
			body.stageKey = regarding.stageKey;
		} else if (regarding.kind === "consultation") {
			body.linkedEntityType = "consultation";
			body.linkedEntityId = regarding.consultationId;
		}
		void onSubmit(body).catch((err) => {
			setSheetError(err instanceof Error ? err.message : "Could not start the conversation");
		});
	};

	return (
		<Sheet open={open} onClose={onClose} title="New conversation">
			<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
				<div>
					<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						Client
					</p>
					{client ? (
						<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: "1px solid var(--border)", padding: "0.45rem 0.6rem" }}>
							<strong style={{ fontSize: "0.8rem" }}>{client.name}</strong>
							<span className="muted mono" style={{ fontSize: "0.65rem" }}>{client.email}</span>
							<button type="button" className="dash-link" style={{ marginLeft: "auto" }} onClick={() => setClient(null)}>
								change
							</button>
						</div>
					) : (
						<>
							<input
								className="cn-search"
								style={{ width: "100%", marginTop: 0 }}
								placeholder={clientsLoading ? "Loading clients…" : "Search clients by name or email…"}
								value={clientQuery}
								onChange={(e) => setClientQuery(e.target.value)}
								aria-label="Search clients"
							/>
							<div style={{ border: "1px solid var(--border)", borderTop: 0 }}>
								{clientMatches.map((c) => (
									<button
										key={c.id}
										type="button"
										onClick={() => pick(c)}
										style={{ display: "block", width: "100%", textAlign: "left", padding: "0.45rem 0.6rem", background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
									>
										<strong style={{ fontSize: "0.78rem" }}>{c.name}</strong>
										<span className="muted mono" style={{ fontSize: "0.62rem", marginLeft: "0.5rem" }}>{c.email}</span>
									</button>
								))}
								{!clientsLoading && clientMatches.length === 0 && (
									<p className="muted" style={{ padding: "0.6rem", fontSize: "0.74rem" }}>No clients match.</p>
								)}
							</div>
						</>
					)}
					{existingThread && (
						<p className="mono muted" style={{ fontSize: "0.62rem", marginTop: "0.35rem" }}>
							Already has an open thread - you&apos;ll join it, not duplicate it.
						</p>
					)}
				</div>

				<div>
					<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						Regarding
					</p>
					<div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
						<button
							type="button"
							className="ops-pill"
							aria-pressed={regarding.kind === "support"}
							onClick={() => setRegarding({ kind: "support" })}
							style={{
								cursor: "pointer",
								border: "1px solid var(--border)",
								background: regarding.kind === "support" ? "var(--foreground)" : "transparent",
								color: regarding.kind === "support" ? "var(--background)" : "var(--foreground)",
							}}
						>
							General support
						</button>
						{clientCases.map((a) => (
							<button
								key={a.id}
								type="button"
								className="ops-pill"
								aria-pressed={regarding.kind === "case" && regarding.applicationId === a.id}
								onClick={() => setRegarding({ kind: "case", applicationId: a.id })}
								style={{
									cursor: "pointer",
									border: "1px solid var(--border)",
									background: regarding.kind === "case" && regarding.applicationId === a.id ? "var(--foreground)" : "transparent",
									color: regarding.kind === "case" && regarding.applicationId === a.id ? "var(--background)" : "var(--foreground)",
								}}
							>
								Case · {a.appId}
							</button>
						))}
						{clientCases.map((a) => (
							<button
								key={`${a.id}-stage`}
								type="button"
								className="ops-pill"
								aria-pressed={regarding.kind === "stage" && regarding.applicationId === a.id}
								onClick={() => setRegarding({ kind: "stage", applicationId: a.id, stageKey: a.stage })}
								style={{
									cursor: "pointer",
									border: "1px dashed var(--border)",
									background: regarding.kind === "stage" && regarding.applicationId === a.id ? "var(--foreground)" : "transparent",
									color: regarding.kind === "stage" && regarding.applicationId === a.id ? "var(--background)" : "var(--foreground)",
								}}
							>
								Stage · {a.appId} - {a.stage}
							</button>
						))}
					</div>
				</div>

				<div>
					<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						First message
					</p>
					<textarea
						className="cn-search"
						style={{ width: "100%", marginTop: 0, minHeight: "4.5rem", resize: "vertical", fontFamily: "inherit" }}
						placeholder={client ? `Hi ${client.name.split(" ")[0]} - ` : "Write the first message…"}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						aria-label="First message"
					/>
					<div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
						{SNIPPETS.slice(0, 3).map((s) => (
							<button
								key={s.id}
								type="button"
								className="ops-pill"
								onClick={() => setMessage(s.body)}
								style={{ cursor: "pointer", border: "1px dashed var(--border)", background: "transparent", color: "var(--muted-foreground)" }}
							>
								{s.label}
							</button>
						))}
					</div>
				</div>

				{sheetError && (
					<p style={{ color: "var(--error, #b00)", fontSize: "0.74rem" }}>{sheetError}</p>
				)}

				<div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
					<button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="btn btn--primary btn--sm" disabled={creating} onClick={submit}>
						{creating ? "Starting…" : "Start thread →"}
					</button>
				</div>
			</div>
		</Sheet>
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



/* ── Log-request sheet — staff intake for phone/walk-in requests and
    internal tickets. Same object the portal intake produces. ───────────── */

const REQUEST_CATEGORIES: { key: string; label: string }[] = [
	{ key: "payment", label: "Payment" },
	{ key: "documents", label: "Documents" },
	{ key: "application", label: "Application" },
	{ key: "visa", label: "Visa" },
	{ key: "departure", label: "Departure" },
	{ key: "account", label: "Account" },
	{ key: "other", label: "Other" },
];

function LogRequestSheet({
	open,
	directory,
	onClose,
	onSubmit,
}: {
	open: boolean;
	directory: { opsUserId: string; name: string; role: string }[];
	onClose: () => void;
	onSubmit: (body: {
		clientUserId?: string;
		category: string;
		subject: string;
		content: string;
		internal?: boolean;
		assigneeOpsUserId?: string;
		priority?: "normal" | "high" | "urgent";
	}) => Promise<void>;
}) {
	const [internal, setInternal] = useState(false);
	const [clients, setClients] = useState<ClientUser[]>([]);
	const [clientQuery, setClientQuery] = useState("");
	const [client, setClient] = useState<ClientUser | null>(null);
	const [category, setCategory] = useState("other");
	const [subject, setSubject] = useState("");
	const [note, setNote] = useState("");
	const [priority, setPriority] = useState<"normal" | "high" | "urgent">("normal");
	const [assignee, setAssignee] = useState("");
	const [sheetError, setSheetError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let on = true;
		listClientUsers()
			.then((res) => { if (on) setClients(Array.isArray(res?.clients) ? res.clients : []); })
			.catch(() => {});
		return () => { on = false; };
	}, []);

	const clientMatches = useMemo(() => {
		const q = clientQuery.trim().toLowerCase();
		return (q
			? clients.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
			: clients
		).slice(0, 6);
	}, [clients, clientQuery]);

	const submit = () => {
		if (!internal && !client) { setSheetError("Pick the client this request is for"); return; }
		if (!subject.trim() || !note.trim()) { setSheetError("Subject and a first note are required"); return; }
		setSheetError(null);
		setBusy(true);
		void onSubmit({
			clientUserId: internal ? undefined : client!.id,
			category,
			subject: subject.trim(),
			content: note.trim(),
			internal,
			assigneeOpsUserId: assignee || undefined,
			priority,
		}).catch((err) => {
			setBusy(false);
			setSheetError(err instanceof Error ? err.message : "Could not log the request");
		});
	};

	return (
		<Sheet open={open} onClose={onClose} title="Log a request">
			<div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
				{/* On behalf of: a client, or internal (ops-only ticket). */}
				<div>
					<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						On behalf of
					</p>
					<div style={{ display: "flex", gap: "0.4rem" }}>
						<button
							type="button"
							className="ops-pill"
							onClick={() => setInternal(false)}
							style={{
								cursor: "pointer", marginLeft: 0, border: "1px solid var(--border)",
								background: !internal ? "var(--foreground)" : "transparent",
								color: !internal ? "var(--background)" : "var(--foreground)",
							}}
						>
							A client
						</button>
						<button
							type="button"
							className="ops-pill"
							onClick={() => setInternal(true)}
							style={{
								cursor: "pointer", marginLeft: 0, border: "1px solid var(--border)",
								background: internal ? "var(--foreground)" : "transparent",
								color: internal ? "var(--background)" : "var(--foreground)",
							}}
						>
							Internal (IT / finance / manager)
						</button>
					</div>
				</div>

				{!internal && (
					<div>
						<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
							Client
						</p>
						{client ? (
							<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: "1px solid var(--border)", padding: "0.45rem 0.6rem" }}>
								<strong style={{ fontSize: "0.8rem" }}>{client.name}</strong>
								<span className="muted mono" style={{ fontSize: "0.65rem" }}>{client.email}</span>
								<button type="button" className="dash-link" style={{ marginLeft: "auto" }} onClick={() => setClient(null)}>
									change
								</button>
							</div>
						) : (
							<>
								<input
									className="cn-search"
									style={{ width: "100%", marginTop: 0 }}
									placeholder="Search clients by name or email…"
									value={clientQuery}
									onChange={(e) => setClientQuery(e.target.value)}
									aria-label="Search clients"
								/>
								<div style={{ border: "1px solid var(--border)", borderTop: 0 }}>
									{clientMatches.map((c) => (
										<button
											key={c.id}
											type="button"
											onClick={() => { setClient(c); setClientQuery(""); }}
											style={{
												display: "block", width: "100%", textAlign: "left",
												background: "none", border: "none", borderBottom: "1px solid var(--border)",
												padding: "0.45rem 0.6rem", cursor: "pointer",
											}}
										>
											<strong style={{ fontSize: "0.8rem" }}>{c.name}</strong>{" "}
											<span className="muted mono" style={{ fontSize: "0.65rem" }}>{c.email}</span>
										</button>
									))}
								</div>
							</>
						)}
					</div>
				)}

				<div>
					<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						Category
					</p>
					<div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
						{REQUEST_CATEGORIES.map((cat) => (
							<button
								key={cat.key}
								type="button"
								className="ops-pill"
								onClick={() => setCategory(cat.key)}
								style={{
									cursor: "pointer", marginLeft: 0, border: "1px solid var(--border)",
									background: category === cat.key ? "var(--foreground)" : "transparent",
									color: category === cat.key ? "var(--background)" : "var(--foreground)",
								}}
							>
								{cat.label}
							</button>
						))}
					</div>
				</div>

				<div>
					<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						Subject
					</p>
					<input
						className="cn-search"
						style={{ width: "100%", marginTop: 0 }}
						placeholder={internal ? "What needs doing?" : "What did the client ask for?"}
						value={subject}
						onChange={(e) => setSubject(e.target.value)}
						maxLength={255}
					/>
				</div>

				<div>
					<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
						{internal ? "Details" : "First note — what they said"}
					</p>
					<textarea
						className="cn-search"
						style={{ width: "100%", marginTop: 0, minHeight: "5rem", resize: "vertical" }}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						maxLength={5000}
					/>
				</div>

				<div style={{ display: "flex", gap: "0.8rem" }}>
					<div style={{ flex: 1 }}>
						<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
							Priority
						</p>
						<select className="cn-select" style={{ width: "100%" }} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
							<option value="normal">Normal</option>
							<option value="high">High</option>
							<option value="urgent">Urgent</option>
						</select>
					</div>
					<div style={{ flex: 1 }}>
						<p className="mono muted" style={{ fontSize: "var(--text-xs)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
							Assign to
						</p>
						<select className="cn-select" style={{ width: "100%" }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
							<option value="">Queue (unclaimed)</option>
							{directory.map((s) => (
								<option key={s.opsUserId} value={s.opsUserId}>{s.name}</option>
							))}
						</select>
					</div>
				</div>

				{sheetError && <p className="muted" style={{ color: "var(--error, #b00)", margin: 0 }}>{sheetError}</p>}

				<button type="button" className="btn btn--primary" disabled={busy} onClick={submit}>
					{busy ? "Logging…" : internal ? "Log internal ticket" : "Log request — appears on the client's portal"}
				</button>
			</div>
		</Sheet>
	);
}
