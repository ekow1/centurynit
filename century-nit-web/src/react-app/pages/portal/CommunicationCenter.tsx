import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { meApi } from "century-nit-core";
import type { CommunicationContext, ChatConversation, ChatMessage, QuotedMessage } from "century-nit-shared";
import {
	ensureChatUiStyles,
	MessageList,
	Composer,
	type MessageActionsConfig,
} from "century-nit-chat-ui";
import { useCommunicationChat } from "../../hooks/useCommunicationChat";
import { useChatStream } from "../../hooks/useChatStream";
import { useAiChat } from "../../hooks/useAiChat";
import { useAppState } from "../../context/AppState";

/**
 * Context-Aware Communication Hub for the Century NIT Client Portal.
 *
 * Three channels:
 *   - SUPPORT: 24/7 helpdesk, routed via `meApi.routeCommunication()`.
 *   - OFFICER: the applicant's assigned stage officer, routed with
 *     `{ stageKey }` so the backend picks the conversation tied to the
 *     applicant's current journey stage.
 *   - AI: a knowledge assistant streamed from the Workers AI edge endpoint
 *     (`POST /ai/chat`) via `useAiChat`.
 *
 * Support + Officer use the shared `MessageList` + `Composer` from
 * `century-nit-chat-ui` and subscribe to real-time SSE via
 * `useCommunicationChat`. AI is stateless (history replayed each turn).
 */

type ActiveChannel = "ai" | "support" | "officer";

/** Pane inside the window: the inbox list is home; chat/new-request drill in. */
type PaneView = "list" | "chat" | "new-request";

const REQUEST_CATEGORIES: { key: string; label: string }[] = [
	{ key: "payment", label: "Payment" },
	{ key: "documents", label: "Documents" },
	{ key: "application", label: "Application" },
	{ key: "visa", label: "Visa" },
	{ key: "departure", label: "Departure" },
	{ key: "account", label: "Account" },
	{ key: "other", label: "Other" },
];

type AIMessage = {
	id: string;
	sender: "user" | "ai";
	text: string;
	at: string;
};

/** Officer card extracted from the `stage_officer` variant of CurrentContact. */
interface OfficerCard {
	name: string;
	role: string;
	branch: string;
	stageLabel: string;
}

/** Narrow the CurrentContact union to an officer card, or null. */
function officerCard(ctx: CommunicationContext | null): (OfficerCard & { presence?: string | null; availabilityNote?: string | null }) | null {
	const c = ctx?.current;
	if (!c || c.kind !== "stage_officer") return null;
	return {
		name: c.contact.name,
		role: c.contact.role ?? "",
		branch: c.contact.branch ?? "",
		stageLabel: c.stageLabel,
		presence: c.contact.presence,
		availabilityNote: c.contact.availabilityNote,
	};
}

export function CommunicationCenter() {
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);

	// Pages can open the chat from in-content actions (e.g. "Message us" on the
	// waiting screens). The widget owns the launcher, they just signal intent.
	useEffect(() => {
		const openChat = () => setOpen(true);
		window.addEventListener("century:open-chat", openChat);
		return () => window.removeEventListener("century:open-chat", openChat);
	}, []);
	const [activeChannel, setActiveChannel] = useState<ActiveChannel>("ai");
	const [pane, setPane] = useState<PaneView>("list");
	const [context, setContext] = useState<CommunicationContext | null>(null);
	const [error, setError] = useState<string | null>(null);

	// New-request intake (inside the window — the portal has no help page).
	const [reqCategory, setReqCategory] = useState("other");
	const [reqSubject, setReqSubject] = useState("");
	const [reqBody, setReqBody] = useState("");
	const [reqSending, setReqSending] = useState(false);
	// Files picked on the intake form — raw File objects; they stage only once
	// the request exists (attachments bind to a conversation id).
	const [reqFiles, setReqFiles] = useState<File[]>([]);
	const reqFileRef = useRef<HTMLInputElement>(null);
	// CSAT after resolve — one rating per conversation per view.
	const [csatSent, setCsatSent] = useState<Record<string, boolean>>({});
	// FAB pulse on inbound message while closed.
	const [pulse, setPulse] = useState(false);
	// Idle teaser — the launcher tells first-time visitors what it can do.
	const [teaser, setTeaser] = useState(false);

	// Journey state. Feeds the AI prompt so answers are personalised to the
	// applicant's actual stage, next step and payment signals (not generic FAQ).
	const { application, journeyPhase, pendingAction } = useAppState();

	// Communication chat (support + officer share one routed conversation).
	const chat = useCommunicationChat(open);
	const [draft, setDraft] = useState("");
	const [replyTo, setReplyTo] = useState<QuotedMessage | null>(null);
	const [pendingFiles, setPendingFiles] = useState<{ name: string; attachmentId: string }[]>([]);
	const [uploading, setUploading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// AI chat. Streamed from the Workers AI edge endpoint. Context carries the
	// live journey signals so the assistant answers with the applicant's real
	// stage, next unlock, pending action and invoice states (worker caps at 6).
	const aiChat = useAiChat("portal-comm", {
		getContext: () => ({
			stage: journeyPhase.label,
			nextUnlock: journeyPhase.nextUnlock ?? "",
			pendingAction: pendingAction?.title ?? "",
			applicationInvoice: application.applicationInvoice.status,
			visaInvoice: application.visaInvoice.status,
		}),
	});
	const aiMessages: AIMessage[] = useMemo(
		() =>
			aiChat.messages.map((m) => ({
				id: m.id,
				sender: m.role === "user" ? "user" : "ai",
				text: m.content,
				at: m.at,
			})),
		[aiChat.messages],
	);
	const aiTyping = aiChat.typing;
	const [aiDraft, setAiDraft] = useState("");

	/* Load communication context (conversations + assigned officer) */
	const loadContext = useCallback(async () => {
		try {
			const ctx = await meApi.getCommunicationContext();
			setContext(ctx);
			setError(null);
			return ctx;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't load communication context");
			return null;
		}
	}, []);

	// The badge has to work while the window is closed — that's its whole job.
	// Context loads once on mount and refreshes on any inbound SSE message;
	// the 30s refresh only matters while the window is open.
	useEffect(() => {
		void loadContext();
	}, [loadContext]);
	useEffect(() => {
		if (!open) return;
		const id = setInterval(loadContext, 30_000);
		return () => clearInterval(id);
	}, [open, loadContext]);

	// Peek card: the last inbound staff message floats above the launcher
	// while the window is closed. Dismissed ids are remembered for the session.
	// Clicking it opens the thread it came from, not just the widget.
	const [peek, setPeek] = useState<{ id: string; convId: string | null; who: string; text: string } | null>(null);
	const peekDismissed = useRef<Set<string>>(new Set());

	useChatStream(useCallback((ev) => {
		if (ev.type !== "chat.message") return;
		const m = ev.message;
		if (m.senderOpsUserId == null) return; // own message — no badge, no peek
		if (!open) {
			void loadContext();
			if (!peekDismissed.current.has(m.id)) {
				setPeek({ id: m.id, convId: ev.conversationId ?? null, who: m.senderName ?? "Century NIT", text: m.content });
			}
			// Amber pulse for ~3s so a fresh reply is visible even with the peek dismissed.
			setPulse(true);
			setTimeout(() => setPulse(false), 3200);
		} else if (pane === "list") {
			// Sitting on the inbox — a new message should re-band/rebadge the row now.
			void loadContext();
		}
	}, [open, pane, loadContext]));

	useEffect(() => {
		if (open) setPeek(null);
	}, [open]);

	// Idle teaser: with zero unread and zero messages the square FAB alone says
	// nothing. Show the hint on first visits (max twice, then it retires) and on
	// hover — an invitation, never a nag.
	const TEASER_KEY = "century.chat-teaser-seen";
	useEffect(() => {
		if (open || peek) return;
		try {
			const seen = Number(localStorage.getItem(TEASER_KEY) ?? "0");
			if (seen < 2) {
				const t = setTimeout(() => {
					setTeaser(true);
					localStorage.setItem(TEASER_KEY, String(seen + 1));
					setTimeout(() => setTeaser(false), 6000);
				}, 2500);
				return () => clearTimeout(t);
			}
		} catch { /* storage blocked — hover still works */ }
	}, [open, peek]);

	// Esc collapses the window to the launcher.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	const totalUnread = useMemo(
		() => context?.conversations.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0,
		[context],
	);
	const officer = useMemo(() => officerCard(context), [context]);
	const isOfficerAssigned = officer !== null;

	/* The inbox: every client-facing conversation in one list, newest activity
	   first, banded by who owes the next move. An unread thread always sits in
	   NEEDS YOUR REPLY regardless of its request status — the badge means the
	   ball is with the applicant. */
	const inboxBands = useMemo(() => {
		const convs = (context?.conversations ?? []).filter((c) => c.audience !== "internal");
		const sorted = [...convs].sort(
			(a, b) =>
				new Date(b.lastMessageAt ?? b.updatedAt).getTime() -
				new Date(a.lastMessageAt ?? a.updatedAt).getTime(),
		);
		return {
			waiting: sorted.filter((c) => c.status === "open" && (c.waitingOn === "client" || c.unreadCount > 0)),
			open: sorted.filter((c) => c.status === "open" && c.waitingOn !== "client" && c.unreadCount === 0),
			resolved: sorted.filter((c) => c.status !== "open"),
		};
	}, [context]);

	/* Read-cursor marker: the unread count at the moment a thread was opened.
	   The divider sits above the first of those trailing inbound messages. */
	const [unreadSeed, setUnreadSeed] = useState<{ convId: string; count: number } | null>(null);
	const seedUnread = useCallback(
		(convId: string) => {
			const conv = context?.conversations.find((c) => c.id === convId);
			setUnreadSeed({ convId, count: conv?.unreadCount ?? 0 });
		},
		[context],
	);
	const firstUnreadId = useMemo(() => {
		if (!unreadSeed || unreadSeed.convId !== chat.conversationId || unreadSeed.count <= 0) return null;
		let remaining = unreadSeed.count;
		for (let i = chat.messages.length - 1; i >= 0; i--) {
			const m = chat.messages[i];
			if (m.senderOpsUserId == null || m.deletedAt) continue;
			remaining -= 1;
			if (remaining === 0) return m.id;
		}
		return chat.messages[0]?.id ?? null;
	}, [unreadSeed, chat.conversationId, chat.messages]);

	/* Open a thread inside the window — the rightful session for any row. */
	const openThread = useCallback(async (convId: string, type: string) => {
		setPane("chat");
		setActiveChannel(type === "support" ? "support" : "officer");
		seedUnread(convId);
		await chat.openConversation(convId);
	}, [chat, seedUnread]);

	/* New-request intake — same window, one POST. */
	const submitRequest = useCallback(async () => {
		if (!reqSubject.trim() || !reqBody.trim() || reqSending) return;
		setReqSending(true);
		try {
			const conv = await meApi.createCommunicationRequest({
				category: reqCategory,
				subject: reqSubject.trim(),
				content: reqBody.trim(),
				caseId: application.applicationId ?? undefined,
			});
			// Attachments come second — staging needs the conversation id that
			// only exists after the request lands. One upload per file, then a
			// single follow-up message binds them all.
			if (reqFiles.length) {
				const ids: string[] = [];
				for (const file of reqFiles) {
					const staged = await meApi.stageCommunicationAttachment(conv.id, {
						fileName: file.name,
						contentType: file.type || "application/octet-stream",
						sizeBytes: file.size,
					});
					const res = await fetch(staged.uploadUrl, {
						method: "PUT",
						headers: { "Content-Type": file.type || "application/octet-stream", ...staged.headers },
						body: file,
					});
					if (!res.ok) throw new Error(`Upload failed (${res.status})`);
					ids.push(staged.attachmentId);
				}
				if (ids.length) {
					await meApi.sendCommunicationMessage(conv.id, "📎 Attachment", { attachmentIds: ids });
				}
			}
			setReqSubject("");
			setReqBody("");
			setReqCategory("other");
			setReqFiles([]);
			void loadContext();
			setPane("chat");
			setActiveChannel("support");
			await chat.openConversation(conv.id);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't send the request");
		} finally {
			setReqSending(false);
		}
	}, [reqSubject, reqBody, reqCategory, reqFiles, reqSending, application.applicationId, chat, loadContext]);

	/* CSAT on a resolved thread. */
	const rateThread = useCallback(async (convId: string, score: 1 | 5) => {
		try {
			await meApi.rateCommunicationConversation(convId, { score });
			setCsatSent((prev) => ({ ...prev, [convId]: true }));
			void loadContext();
		} catch { /* rating is best-effort — the resolve already landed */ }
	}, [loadContext]);

	// "Seen" receipt: a staff participant's read cursor passed the client's
	// last own message.
	const seenBy = useMemo(() => {
		const conv = context?.conversations.find((c) => c.id === chat.conversationId);
		const lastOwn = [...chat.messages].reverse().find((m) => m.senderOpsUserId == null && !m.deletedAt);
		if (!conv || !lastOwn) return null;
		const seen = conv.participants.find(
			(p) => p.lastReadAt != null && new Date(p.lastReadAt) >= new Date(lastOwn.createdAt),
		);
		return seen?.name ?? null;
	}, [context, chat.conversationId, chat.messages]);

	/* Switch channel — the direct-line rows route to (or create) their thread. */
	const handleSelectChannel = useCallback(async (channel: ActiveChannel) => {
		setActiveChannel(channel);
		setPane("chat");
		setError(null);
		setReplyTo(null);
		setDraft("");

		if (channel === "support") {
			const id = await chat.route();
			if (id) seedUnread(id);
		} else if (channel === "officer") {
			if (!context || !isOfficerAssigned) return;
			const id = await chat.route({ stageKey: context.activeStageKey ?? undefined });
			if (id) seedUnread(id);
		}
	}, [chat, context, isOfficerAssigned, seedUnread]);

	// Initialize the support conversation when a routed support view opens empty.
	useEffect(() => {
		if (open && activeChannel === "support" && !chat.conversationId && pane === "chat") {
			void handleSelectChannel("support");
		}
	}, [open, activeChannel, chat.conversationId, pane, handleSelectChannel]);

	// Opening the launcher lands on the inbox — the list itself shows which
	// thread needs attention (unread pill + WAITING ON YOU band).
	const openLauncher = useCallback(() => {
		setOpen((prev) => {
			if (prev) return false;
			setPane("list");
			return true;
		});
	}, []);

	useEffect(() => {
		const handler = (e: CustomEvent<{ channel?: ActiveChannel }>) => {
			setOpen(true);
			if (e.detail?.channel) {
				void handleSelectChannel(e.detail.channel);
			} else {
				setPane("list");
			}
		};
		window.addEventListener("open-chat", handler as EventListener);
		return () => window.removeEventListener("open-chat", handler as EventListener);
	}, [handleSelectChannel]);

	// Unread count rides the browser tab title — `(3) Century NIT — …`. Reads
	// the live title each run so a late-arriving brand title isn't clobbered;
	// our own "(n) " prefix is stripped before re-prepending.
	useEffect(() => {
		const base = document.title.replace(/^\(\d+\)\s*/, "");
		document.title = totalUnread > 0 ? `(${totalUnread}) ${base}` : base;
		return () => {
			document.title = document.title.replace(/^\(\d+\)\s*/, "");
		};
	}, [totalUnread]);

	// Notification deep links land on /portal/home?chat=<conversationId>
	// (there is no /portal/support page). The param is consumed so a later
	// refresh doesn't force the widget back open.
	const [searchParams, setSearchParams] = useSearchParams();
	useEffect(() => {
		const target = searchParams.get("chat");
		if (!target) return;
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			next.delete("chat");
			return next;
		}, { replace: true });
		setOpen(true);
		if (target === "officer") {
			void handleSelectChannel("officer");
		} else if (target === "open" || target === "support") {
			void handleSelectChannel("support");
		} else {
			const conv = context?.conversations.find((c) => c.id === target);
			void openThread(target, conv?.type ?? "support");
		}
	}, [searchParams, setSearchParams, handleSelectChannel, openThread, context]);

	/* Send message (support + officer) */
	const handleSend = useCallback(async (text: string) => {
		if (!text.trim() && pendingFiles.length === 0) return;
		await chat.send(text.trim() || "📎 Attachment", { attachmentIds: pendingFiles.map((f) => f.attachmentId) });
		setDraft("");
		setReplyTo(null);
		setPendingFiles([]);
		void loadContext();
	}, [chat, loadContext, pendingFiles]);

	/* Attachments: stage → PUT to the presigned URL → the ids bind on send. */
	const onFilesPicked = useCallback(
		async (files: FileList | null) => {
			if (!files || !chat.conversationId) return;
			setUploading(true);
			try {
				for (const file of Array.from(files)) {
					const staged = await meApi.stageCommunicationAttachment(chat.conversationId, {
						fileName: file.name,
						contentType: file.type || "application/octet-stream",
						sizeBytes: file.size,
					});
					const res = await fetch(staged.uploadUrl, {
						method: "PUT",
						headers: { "Content-Type": file.type || "application/octet-stream", ...staged.headers },
						body: file,
					});
					if (!res.ok) throw new Error(`Upload failed (${res.status})`);
					setPendingFiles((prev) => [...prev, { name: file.name, attachmentId: staged.attachmentId }]);
				}
			} catch (e) {
				setError(e instanceof Error ? e.message : "Upload failed");
			} finally {
				setUploading(false);
				if (fileInputRef.current) fileInputRef.current.value = "";
			}
		},
		[chat.conversationId],
	);

	/* AI assistant (streamed from Workers AI edge endpoint) */
	const handleSendAi = useCallback((e?: FormEvent, customQuery?: string) => {
		if (e) e.preventDefault();
		const query = (customQuery || aiDraft).trim();
		if (!query || aiTyping) return;
		if (!customQuery) setAiDraft("");
		void aiChat.send(query);
	}, [aiDraft, aiTyping, aiChat]);

	/* Escalation: AI → human (Phase 2 handoff). Routes the Support thread
	   and posts the AI transcript as a handoff message, so staff see the
	   question and what the AI already answered without the applicant
	   re-explaining. Posts once per question. Repeat clicks (or a routing
	   failure) fall back to the Phase 1 draft prefill. */
	const lastEscalatedRef = useRef<string | null>(null);
	const [escalating, setEscalating] = useState(false);

	const handleEscalate = useCallback(async () => {
		if (escalating) return;
		const lastUser = [...aiChat.messages].reverse().find((m) => m.role === "user");
		const question = lastUser?.content.trim() ?? "";
		setEscalating(true);
		try {
			await handleSelectChannel("support");
			if (!question || lastEscalatedRef.current === question) {
				if (question) setDraft(question);
				return;
			}
			lastEscalatedRef.current = question;
			// Last substantive AI reply. Skip the welcome banner and error stubs.
			const lastAnswer = [...aiChat.messages]
				.reverse()
				.find(
					(m) =>
							m.role === "assistant" &&
							!m.id.endsWith("-welcome") &&
							m.content.trim() !== "" &&
							!m.content.startsWith("Sorry"),
				);
			const reply = (lastAnswer?.content ?? "").trim();
			const handoff = [
				"[AI handoff] I was chatting with the AI assistant and would like a human to help.",
				`My question: "${question}"`,
				reply ? `The AI replied: "${reply.length > 300 ? `${reply.slice(0, 300)}…` : reply}"` : "",
			]
				.filter(Boolean)
				.join("\n");
			await chat.send(handoff);
		} catch {
			// Handoff post failed. Fall back to the Phase 1 behaviour so the
			// applicant's question is never lost.
			setDraft(question);
		} finally {
			setEscalating(false);
		}
	}, [aiChat.messages, handleSelectChannel, chat, escalating]);

	/* Shared component callbacks (support + officer) */
	const isOwn = useCallback(
		(m: ChatMessage) => m.senderOpsUserId == null,
		[],
	);

	const actionsConfig = useMemo<MessageActionsConfig>(() => ({
		reply: true,
		react: false,
		forward: false,
		copy: true,
		edit: false,
		delete: false,
		more: false,
	}), []);

	const bubbleProps = useMemo(() => ({
		actions: actionsConfig,
		onReply: (m: ChatMessage) => {
			if (m.deletedAt) return;
			setReplyTo({
				id: m.id,
				senderName: m.senderName,
				content: m.content,
				deleted: m.deletedAt !== null && m.deletedAt !== undefined,
			});
		},
		onQuoteClick: () => {},
	}), [actionsConfig]);

	ensureChatUiStyles();

	const officerFirstName = officer?.name.split(" ")[0] ?? "your officer";

	/* Inbox row helpers — avatar initials, relative time, one row per thread. */
	const convAvatar = (c: ChatConversation): string => {
		const owner = c.participants.find((p) => p.role === "owner");
		const src = owner?.name ?? (c.type === "support" ? "Century Support" : (c.subject ?? c.title));
		const ini = src.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
		return ini || "··";
	};

	const relTime = (iso?: string | null): string => {
		if (!iso) return "";
		const t = new Date(iso).getTime();
		const diff = Date.now() - t;
		if (!Number.isFinite(diff) || diff < 0) return "";
		if (diff < 60_000) return "now";
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
		if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
		return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
	};

	const renderConvRow = (c: ChatConversation, dimmed = false) => {
		const unread = c.unreadCount > 0;
		const preview = c.lastMessage
			? c.lastMessage.deletedAt
				? "Message deleted"
				: `${c.lastMessage.senderOpsUserId != null ? (c.lastMessage.senderName ?? "Desk") : "You"}: ${c.lastMessage.content}`
			: "No messages yet";
		return (
			<button
				key={c.id}
				type="button"
				style={{ ...reqRowStyle, opacity: dimmed ? 0.6 : 1, flexDirection: "row", gap: "8px", alignItems: "flex-start", textAlign: "left" }}
				onClick={() => void openThread(c.id, c.type)}
			>
				<span style={rowAvaStyle}>{convAvatar(c)}</span>
				<span style={{ flex: 1, minWidth: 0 }}>
					<span style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
						<span
							style={{
								...reqSubjectStyle,
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								fontWeight: unread ? 800 : 600,
							}}
						>
							{c.subject ?? c.title}
						</span>
						<span style={rowTimeStyle}>{relTime(c.lastMessageAt ?? c.updatedAt)}</span>
					</span>
					<span
						style={{
							...reqMetaStyle,
							display: "block",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							...(unread ? { color: "#000000", fontWeight: 600 } : {}),
						}}
					>
						{preview}
					</span>
					<span style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "3px" }}>
						{c.status === "open" && c.waitingOn === "client" && <span style={rowTagWaitStyle}>WAITING ON YOU</span>}
						{c.status !== "open" && <span style={rowTagStyle}>RESOLVED</span>}
						{(c.category ?? c.type) && <span style={rowTagStyle}>{(c.category ?? c.type).toUpperCase()}</span>}
						{unread && <span style={unreadPillStyle}>{c.unreadCount}</span>}
					</span>
				</span>
			</button>
		);
	};

	const officerPresence =
		officer?.presence && officer.presence !== "offline"
			? `● ${officer.presence === "available" ? "online" : officer.presence.replace("_", " ")}`
			: null;

	// The thread currently open, looked up in the context list for its
	// subject/reference/status — the header names the thread, not the channel.
	const activeConv = useMemo(
		() => context?.conversations.find((c) => c.id === chat.conversationId) ?? null,
		[context, chat.conversationId],
	);

	const headMeta =
		pane === "list"
			? { ini: "CN", name: "Messages", sub: "Support · your officer · Century AI", ai: false }
			: pane === "new-request"
				? { ini: "CS", name: "New request", sub: "Straight to the support desk", ai: false }
				: activeChannel === "ai"
					? { ini: "AI", name: "Century AI", sub: "Instant · knows your journey stage", ai: true }
					: activeChannel === "support"
						? {
								ini: "CS",
								name: activeConv?.subject ?? "Century Support",
								sub: activeConv?.reference
									? `${activeConv.reference} · ${activeConv.status}`
									: "Desk open · replies within the hour",
								ai: false,
							}
						: {
								ini: (activeConv?.title ?? officer?.name ?? "··").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
								name: activeConv?.title ?? officer?.name ?? "Assigned officer",
								sub: officer
									? `${officerPresence ? `${officerPresence} · ` : ""}${officer.availabilityNote ?? officer.role ?? "Officer"}${officer.branch ? ` · ${officer.branch}` : ""}`
									: "Being assigned",
								ai: false,
							};

	return (
		<>
			{/* Launcher: live badge + last-message peek. The badge is SSE-fed and
			    works while the window is closed — that is its whole job. */}
			<div className="cchat-launch">
				{!open && !peek && teaser ? (
					<button
						type="button"
						className="cchat-peek cchat-peek--teaser"
						onClick={openLauncher}
					>
						<b>Need a hand?</b>
						Ask the AI — instant · or message the desk
					</button>
				) : null}
				{!open && peek ? (
					<button
						type="button"
						className="cchat-peek"
						onClick={() => {
							setOpen(true);
							if (peek.convId) {
								const c = context?.conversations.find((x) => x.id === peek.convId);
								void openThread(peek.convId, c?.type ?? "support");
							} else {
								setPane("list");
							}
						}}
					>
						<b>{peek.who}</b>
						{peek.text.slice(0, 90)}{peek.text.length > 90 ? "…" : ""}
						<span
							className="cchat-peek__x"
							role="button"
							tabIndex={0}
							aria-label="Dismiss preview"
							onClick={(e) => {
								e.stopPropagation();
								peekDismissed.current.add(peek.id);
								setPeek(null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.stopPropagation();
									peekDismissed.current.add(peek.id);
									setPeek(null);
								}
							}}
						>
							✕
						</span>
					</button>
				) : null}
				<button
					type="button"
					className={`cchat-fab${pulse && !open ? " cchat-fab--pulse" : ""}`}
					onClick={() => {
						if (open) setOpen(false);
						else openLauncher();
					}}
					onMouseEnter={() => {
						if (!open && !peek && totalUnread === 0) setTeaser(true);
					}}
					onMouseLeave={() => setTeaser(false)}
					aria-label={open ? "Close chat" : "Open chat"}
				>
					{open ? (
						<span style={{ fontSize: "14px", lineHeight: 1 }}>✕</span>
					) : (
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="square"
							strokeLinejoin="miter"
						>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
					)}
					{totalUnread > 0 && !open && <span className="cchat-fab__badge">{totalUnread}</span>}
				</button>
			</div>

			{/* Floating Hub Window */}
			{open && (
				<div className={`cchat-win cn-chat${expanded ? " cchat-win--xl" : ""}`}>
					{/* Header: the inbox identity on the list; back + party in a thread */}
					<header className="cchat-win__head">
						{pane !== "list" && (
							<button
								type="button"
								onClick={() => setPane("list")}
								title="All conversations"
								aria-label="Back to messages"
								style={{
									border: "none",
									background: "none",
									cursor: "pointer",
									fontSize: "10px",
									fontWeight: 700,
									fontFamily: "var(--font-mono, monospace)",
									letterSpacing: "0.08em",
									color: "var(--foreground, #000)",
									padding: "0 6px 0 0",
								}}
							>
								←
							</button>
						)}
						<span className={`cchat-ava${headMeta.ai ? " cchat-ava--ai" : ""}`}>{headMeta.ini}</span>
						<div className="cchat-win__who">
							<p className="cchat-win__name">{headMeta.name}</p>
							<p className="cchat-win__sub">{headMeta.sub}</p>
						</div>
						<div className="cchat-win__ctl">
							<button
								type="button"
								onClick={() => setOpen(false)}
								title="Minimize"
								aria-label="Minimize"
							>
								—
							</button>
							<button
								type="button"
								className="cchat-win__xl"
								onClick={() => setExpanded((prev) => !prev)}
								title={expanded ? "Restore" : "Expand"}
								aria-label={expanded ? "Restore" : "Expand"}
							>
								{expanded ? "⤡" : "⤢"}
							</button>
							<button
								type="button"
								onClick={() => setOpen(false)}
								title="Close"
								aria-label="Close"
							>
								✕
							</button>
						</div>
					</header>

					{/* Context strip: what this pane is for, right now. */}
					<div className="cchat-strip">
						<span>
							{pane === "list"
								? "ALL CONVERSATIONS"
								: pane === "new-request"
									? "NEW REQUEST"
									: activeChannel === "support"
										? (activeConv?.waitingOn === "client" ? "WAITING ON YOUR REPLY" : "SUPPORT THREAD")
										: activeChannel === "officer"
											? `${officer?.stageLabel ?? activeConv?.title ?? "Officer"} · direct thread`.toUpperCase()
											: `Context: ${journeyPhase.label}${pendingAction ? ` · ${pendingAction.title}` : ""}`.toUpperCase()}
						</span>
						{pane === "chat" && activeChannel === "support" && (
							<button
								type="button"
								className="cchat-strip__link"
								onClick={() => setPane("new-request")}
							>
								+ New request
							</button>
						)}
					</div>

					{/* Error Notification */}
					{error && (
						<div style={errorBannerStyle}>
							<span>{error}</span>
							<button type="button" onClick={() => setError(null)} style={errorCloseStyle}>✕</button>
						</div>
					)}

					{/* Body */}
					<div style={bodyStyle}>
						{/* Inbox — every conversation in one list, banded by who owes
						    the next move. A row opens the rightful session. */}
						{pane === "list" && (
							<div style={streamContainerStyle}>
								<div style={reqListStyle}>
									<p style={reqBandStyle}>DIRECT LINES</p>
									<button
										type="button"
										style={{ ...reqRowStyle, flexDirection: "row", gap: "8px", alignItems: "flex-start", textAlign: "left" }}
										onClick={() => void handleSelectChannel("ai")}
									>
										<span style={{ ...rowAvaStyle, background: "#000000", color: "#ffffff" }}>AI</span>
										<span style={{ flex: 1, minWidth: 0 }}>
											<span style={reqSubjectStyle}>Century AI</span>
											<span style={{ ...reqMetaStyle, display: "block" }}>
												Instant answers — knows your journey stage
											</span>
										</span>
									</button>
									{isOfficerAssigned && (
										<button
											type="button"
											style={{ ...reqRowStyle, flexDirection: "row", gap: "8px", alignItems: "flex-start", textAlign: "left" }}
											onClick={() => void handleSelectChannel("officer")}
										>
											<span style={rowAvaStyle}>
												{(officer?.name ?? "··").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
											</span>
											<span style={{ flex: 1, minWidth: 0 }}>
												<span style={reqSubjectStyle}>{officer?.name ?? "Assigned officer"}</span>
												<span style={{ ...reqMetaStyle, display: "block" }}>
													{officerPresence ?? officer?.role ?? "Officer"} · {officer?.stageLabel ?? "your stage"}
												</span>
											</span>
										</button>
									)}
									{inboxBands.waiting.length > 0 && (
										<>
											<p style={reqBandStyle}>NEEDS YOUR REPLY</p>
											{inboxBands.waiting.map((c) => renderConvRow(c))}
										</>
									)}
									{inboxBands.open.length > 0 && (
										<>
											<p style={reqBandStyle}>OPEN</p>
											{inboxBands.open.map((c) => renderConvRow(c))}
										</>
									)}
									{inboxBands.resolved.length > 0 && (
										<>
											<p style={reqBandStyle}>RESOLVED</p>
											{inboxBands.resolved.map((c) => renderConvRow(c, true))}
										</>
									)}
									{inboxBands.waiting.length + inboxBands.open.length + inboxBands.resolved.length === 0 && (
										<p style={{ fontSize: "11px", color: "#52525b", textAlign: "center", padding: "24px 12px" }}>
											No conversations yet — message the desk below, or ask the AI above.
										</p>
									)}
								</div>
								<button type="button" style={reqNewBtnStyle} onClick={() => setPane("new-request")}>
									+ NEW REQUEST
								</button>
							</div>
						)}

						{/* New-request intake — category → subject → message. */}
						{pane === "new-request" && (
							<div style={streamContainerStyle}>
								<div style={reqFormStyle}>
									<p style={reqBandStyle}>NEW REQUEST</p>
									<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
										{REQUEST_CATEGORIES.map((cat) => (
											<button
												key={cat.key}
												type="button"
												style={{ ...quickChipStyle, ...(reqCategory === cat.key ? reqCatOnStyle : {}) }}
												onClick={() => setReqCategory(cat.key)}
											>
												{cat.label}
											</button>
										))}
									</div>
									<input
										type="text"
										value={reqSubject}
										onChange={(e) => setReqSubject(e.target.value)}
										placeholder="Subject — what's this about?"
										style={reqInputStyle}
										maxLength={255}
									/>
									<textarea
										value={reqBody}
										onChange={(e) => setReqBody(e.target.value)}
										placeholder="Tell the desk what you need…"
										style={reqTextareaStyle}
										rows={4}
										maxLength={5000}
									/>
									<input
										ref={reqFileRef}
										type="file"
										multiple
										style={{ display: "none" }}
										onChange={(e) => {
											setReqFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
											if (reqFileRef.current) reqFileRef.current.value = "";
										}}
									/>
									{reqFiles.length > 0 && (
										<div style={attachTrayStyle}>
											{reqFiles.map((f, i) => (
												<span key={`${f.name}-${i}`} style={attachChipStyle}>
													📎 {f.name}
													<button
														type="button"
														style={attachRemoveStyle}
														onClick={() => setReqFiles((prev) => prev.filter((_, j) => j !== i))}
													>
														×
													</button>
												</span>
											))}
										</div>
									)}
									<button
										type="button"
										style={reqAttachBtnStyle}
										onClick={() => reqFileRef.current?.click()}
									>
										+ Attach a file
									</button>
									<button
										type="button"
										style={{ ...reqNewBtnStyle, marginTop: 0, opacity: reqSubject.trim() && reqBody.trim() && !reqSending ? 1 : 0.5 }}
										disabled={!reqSubject.trim() || !reqBody.trim() || reqSending}
										onClick={() => void submitRequest()}
									>
										{reqSending ? "SENDING…" : "SEND REQUEST"}
									</button>
									<button type="button" style={reqAiHintStyle} onClick={() => handleSelectChannel("ai")}>
										Try the AI first — answers instantly
									</button>
								</div>
							</div>
						)}

						{/* Support + Officer channels. Shared components */}
						{pane === "chat" && (activeChannel === "support" || activeChannel === "officer") && (
							activeChannel === "officer" && !isOfficerAssigned && !chat.conversationId ? (
								<div style={unassignedStateStyle}>
									<div style={{ fontSize: "12px", fontWeight: 700, color: "#000000", marginBottom: "8px", letterSpacing: "0.04em" }}>
										CONSULTANT BEING ASSIGNED
									</div>
									<p style={{ fontSize: "11px", color: "#52525b", lineHeight: 1.5, maxWidth: "280px", margin: "0 auto 16px" }}>
										Your dedicated specialist will appear here once your application milestone or consultation is active.
									</p>
									<button
										type="button"
										onClick={() => handleSelectChannel("support")}
										style={switchChannelActionBtnStyle}
									>
										SWITCH TO SUPPORT
									</button>
								</div>
							) : (
								<div style={streamContainerStyle}>
									{/* Messages. Shared MessageList */}
									<MessageList
										messages={chat.messages}
										typing={chat.typing}
										isOwn={isOwn}
										bubbleProps={bubbleProps}
										unreadFromId={firstUnreadId}
										header={
											chat.loading && chat.messages.length === 0 ? (
												<div style={{ textAlign: "center", color: "var(--cn-chat-muted-fg)", fontSize: 12, padding: 16 }}>
													Loading conversation...
												</div>
											) : chat.messages.length === 0 ? (
												<div style={emptySupportPromptStyle}>
													<p style={{ fontWeight: 700, fontSize: "12px", color: "#000000", marginBottom: "6px", letterSpacing: "0.04em" }}>
														{activeChannel === "support" ? "DIRECT SUPPORT QUEUE" : "DIRECT OFFICER THREAD"}
													</p>
													<p style={{ fontSize: "11px", color: "#52525b", marginBottom: "12px", lineHeight: 1.4 }}>
														{activeChannel === "support"
															? "Send a message directly to central support. Responses appear here in real-time."
															: `Connected directly with ${officer?.name ?? "your officer"}.`}
													</p>
													{activeChannel === "support" && (
														<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
															{["Payment & Invoices", "Document Review Status", "Visa Consultation"].map((t) => (
																<button
																	key={t}
																	type="button"
																	onClick={() => setDraft(`Inquiry: ${t} - `)}
																	style={quickChipStyle}
																>
																	{t}
																</button>
															))}
														</div>
													)}
												</div>
											) : null
										}
									/>

									{/* Resolved strip + CSAT. A new message reopens it. */}
									{chat.conversationStatus === "closed" && (
										<div style={resolvedBarStyle}>
											<span>Resolved. Send a message to reopen</span>
											{chat.conversationId && !csatSent[chat.conversationId] ? (
												<span style={{ display: "inline-flex", gap: "6px", marginLeft: "8px" }}>
													<button type="button" style={csatBtnStyle} onClick={() => void rateThread(chat.conversationId!, 5)} aria-label="This solved it">
														👍
													</button>
													<button type="button" style={csatBtnStyle} onClick={() => void rateThread(chat.conversationId!, 1)} aria-label="Not solved">
														👎
													</button>
												</span>
											) : csatSent[chat.conversationId ?? ""] ? (
												<span style={{ marginLeft: "8px" }}>· rated</span>
											) : null}
										</div>
									)}

									{/* Seen receipt: a staff read cursor passed your last message. */}
									{seenBy && (
										<div style={seenStyle}>Seen by {seenBy}</div>
									)}

									{/* Staged attachments */}
									{pendingFiles.length > 0 && (
										<div style={attachTrayStyle}>
											{pendingFiles.map((f) => (
												<span key={f.attachmentId} style={attachChipStyle}>
													📎 {f.name}
													<button
														type="button"
														style={attachRemoveStyle}
														onClick={() => setPendingFiles((prev) => prev.filter((x) => x.attachmentId !== f.attachmentId))}
														aria-label={`Remove ${f.name}`}
													>
														×
													</button>
												</span>
											))}
										</div>
									)}

									{/* Composer. Shared */}
									<Composer
										value={draft}
										onChange={setDraft}
										onSend={handleSend}
										sending={chat.sending}
										replyTo={replyTo}
										onCancelReply={() => setReplyTo(null)}
										onAttach={() => fileInputRef.current?.click()}
										placeholder={uploading ? "Uploading…" : activeChannel === "support" ? "Type a message…" : `Message ${officerFirstName}…`}
									/>
								</div>
							)
						)}

						{/* AI channel. Scripted, local-only */}
						{pane === "chat" && activeChannel === "ai" && (
							<div style={streamContainerStyle}>
								<div style={messageListStyle}>
									{aiMessages.map((m) => {
										const isMe = m.sender === "user";
										return (
											<div
												key={m.id}
												style={{
													...messageRowStyle,
													justifyContent: isMe ? "flex-end" : "flex-start",
												}}
											>
												<div
													style={{
														...messageBubbleStyle,
														...(isMe ? myBubbleStyle : theirBubbleStyle),
													}}
												>
													<div style={bubbleAuthorStyle}>{isMe ? "YOU" : "CENTURY AI"}</div>
													<div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
													{isMe ? m.text : renderAiText(m.text)}
												</div>
													<div style={bubbleTimeStyle}>
														{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</div>
												</div>
											</div>
										);
									})}
									{aiTyping && (
										<div style={{ padding: "8px 12px", color: "#52525b", fontSize: "11px", fontFamily: "monospace" }}>
											GENERATING RESPONSE...
										</div>
									)}
								</div>

									{/* Escalation: persistent affordance to reach a human. Posts the
									    AI transcript into the Support thread on switch. */}
									<button
										type="button"
										disabled={escalating}
										onClick={() => void handleEscalate()}
										style={{ ...escalateBarStyle, ...(escalating ? escalateBarDisabledStyle : {}) }}
									>
										{escalating ? "CONNECTING TO SUPPORT…" : "TALK TO A HUMAN →"}
									</button>

								{/* AI Quick Prompts */}
								<div style={aiPromptsRowStyle}>
									{["Visa requirements", "Scholarships", "Required documents", "Payment plan"].map((prompt) => (
										<button
											key={prompt}
											type="button"
											onClick={() => handleSendAi(undefined, prompt)}
											style={aiQuickChipStyle}
										>
											{prompt}
										</button>
									))}
								</div>

								{/* Same Composer as the Support and Officer channels — one input and
								    send affordance across every chat surface. */}
								<Composer
									value={aiDraft}
									onChange={setAiDraft}
									onSend={(text) => {
										setAiDraft("");
										void aiChat.send(text);
									}}
									sending={aiTyping}
									placeholder="Ask Century AI…"
								/>
							</div>
						)}
					</div>
				</div>
			)}

			<input
				ref={fileInputRef}
				type="file"
				multiple
				style={{ display: "none" }}
				onChange={(e) => void onFilesPicked(e.target.files)}
			/>
		</>
	);
}

/* Shell styles (header, tabs, AI channel) */
/* Support + Officer channels use the shared chat-ui components which style  */
/* themselves via --cn-chat-* tokens. AI keeps its inline bubbles since it's  */
/* a scripted local-only surface with no server backing.                      */

const resolvedBarStyle: CSSProperties = {
	padding: "8px 12px",
	fontSize: "10px",
	fontFamily: "monospace",
	fontWeight: 700,
	letterSpacing: "0.06em",
	textTransform: "uppercase",
	color: "#52525b",
	background: "#f4f4f5",
	borderTop: "1px dashed #a1a1aa",
	textAlign: "center",
};

const attachTrayStyle: CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: "4px",
	padding: "6px 10px",
	borderTop: "1px solid #e4e4e7",
};

const attachChipStyle: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
	border: "1px solid #18181b",
	background: "#f4f4f5",
	fontFamily: "monospace",
	fontSize: "10px",
	padding: "2px 6px",
};

const attachRemoveStyle: CSSProperties = {
	border: "none",
	background: "none",
	cursor: "pointer",
	fontSize: "12px",
	lineHeight: 1,
	padding: 0,
};

const bodyStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const streamContainerStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
};

const emptySupportPromptStyle: CSSProperties = {
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	borderRadius: "0px",
	padding: "14px",
	margin: "auto 0",
};

const quickChipStyle: CSSProperties = {
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	color: "#71717a",
	fontSize: "10px",
	fontFamily: "monospace",
	padding: "4px 8px",
	borderRadius: "0px",
	cursor: "pointer",
};

const unassignedStateStyle: CSSProperties = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: "30px 20px",
	textAlign: "center",
};

const switchChannelActionBtnStyle: CSSProperties = {
	background: "#ffffff",
	color: "#000000",
	border: "none",
	borderRadius: "0px",
	padding: "8px 14px",
	fontWeight: 700,
	fontSize: "11px",
	fontFamily: "monospace",
	letterSpacing: "0.04em",
	cursor: "pointer",
};

/* AI channel inline styles (scripted, no shared components) */

const messageListStyle: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "12px",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
};

const messageRowStyle: CSSProperties = {
	display: "flex",
	width: "100%",
};

const messageBubbleStyle: CSSProperties = {
	maxWidth: "75%",
	padding: "10px 14px",
	fontSize: "13px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	lineHeight: "1.4",
};

const myBubbleStyle: CSSProperties = {
	background: "#18181b",
	color: "#ffffff",
	border: "none",
	borderRadius: "0",
};

const theirBubbleStyle: CSSProperties = {
	background: "#f4f4f5",
	color: "#18181b",
	border: "none",
	borderLeft: "2.5px solid #5b21b6",
	borderRadius: "0",
};

const bubbleAuthorStyle: CSSProperties = {
	fontSize: "9px",
	fontWeight: 700,
	fontFamily: "monospace",
	letterSpacing: "0.06em",
	opacity: 0.6,
	marginBottom: "4px",
};

const bubbleTimeStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	opacity: 0.5,
	marginTop: "4px",
	textAlign: "right",
};

const aiPromptsRowStyle: CSSProperties = {
	display: "flex",
	gap: "6px",
	overflowX: "auto",
	padding: "6px 10px",
	background: "#ffffff",
	borderTop: "1px solid #e4e4e7",
};

const escalateBarStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: "6px",
	width: "calc(100% - 32px)",
	margin: "10px 16px 0",
	padding: "8px 12px",
	background: "#ffffff",
	border: "1px solid #18181b",
	color: "#18181b",
	fontSize: "11px",
	fontWeight: 700,
	fontFamily: "monospace",
	letterSpacing: "0.06em",
	cursor: "pointer",
	transition: "background 0.15s ease, color 0.15s ease",
};

const escalateBarDisabledStyle: CSSProperties = {
	opacity: 0.55,
	cursor: "wait",
};

const aiQuickChipStyle: CSSProperties = {
	whiteSpace: "nowrap",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	color: "#52525b",
	fontSize: "10px",
	fontFamily: "monospace",
	padding: "3px 6px",
	borderRadius: "0px",
	cursor: "pointer",
};

/**
 * Linkify portal routes in CENTURY AI replies. Only `/portal/*` tokens become
 * links — the signed-in tier may point into the account, but nothing else
 * (no staff console paths, no external URLs) is ever made clickable.
 */
function renderAiText(text: string) {
	return text.split(/(\s+)/).map((tok, i) => {
		const path = tok.replace(/[.,;:!?'"()\]]+$/, "");
		if (!/^\/portal\/[a-z0-9\-/]*$/i.test(path)) return <span key={i}>{tok}</span>;
		const trail = tok.slice(path.length);
		return (
			<span key={i}>
				<Link to={path} style={aiLinkStyle}>
					{path}
				</Link>
				{trail}
			</span>
		);
	});
}

const aiLinkStyle: CSSProperties = {
	color: "#b45309",
	borderBottom: "1px solid #e8a33d",
	fontFamily: "monospace",
	fontSize: "11px",
	fontWeight: 700,
	textDecoration: "none",
};

const errorBannerStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	background: "#18181b",
	color: "#ffffff",
	padding: "6px 10px",
	fontSize: "10px",
	fontFamily: "monospace",
	borderBottom: "1px solid #3f3f46",
};

const errorCloseStyle: CSSProperties = {
	background: "transparent",
	border: "none",
	color: "#ffffff",
	cursor: "pointer",
	fontWeight: 700,
};

/* Requests pane + intake + receipts (square-corner language throughout) */

const reqListStyle: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "10px 12px",
	display: "flex",
	flexDirection: "column",
	gap: "6px",
};

const reqBandStyle: CSSProperties = {
	fontSize: "9px",
	fontWeight: 700,
	fontFamily: "monospace",
	letterSpacing: "0.08em",
	color: "#71717a",
	margin: "10px 0 2px",
};

const reqRowStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "3px",
	textAlign: "left",
	background: "#ffffff",
	border: "1px solid #e4e4e7",
	borderRadius: 0,
	padding: "9px 10px",
	cursor: "pointer",
};

const reqSubjectStyle: CSSProperties = {
	fontSize: "12px",
	fontWeight: 700,
	color: "#18181b",
};

const reqMetaStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	letterSpacing: "0.04em",
	color: "#71717a",
};

const rowAvaStyle: CSSProperties = {
	width: "30px",
	height: "30px",
	flex: "none",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	border: "1.5px solid #000000",
	background: "#f4f4f5",
	fontSize: "10px",
	fontWeight: 700,
};

const rowTimeStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	color: "#a1a1aa",
	flex: "none",
};

const rowTagStyle: CSSProperties = {
	fontSize: "8px",
	fontWeight: 700,
	fontFamily: "monospace",
	letterSpacing: "0.08em",
	padding: "1px 4px",
	border: "1px solid #d4d4d8",
	color: "#71717a",
};

const rowTagWaitStyle: CSSProperties = {
	...rowTagStyle,
	background: "var(--accent, #b45309)",
	borderColor: "var(--accent, #b45309)",
	color: "#ffffff",
};

const unreadPillStyle: CSSProperties = {
	marginLeft: "auto",
	minWidth: "16px",
	height: "16px",
	padding: "0 4px",
	background: "var(--bad, #b91c1c)",
	color: "#ffffff",
	fontSize: "9px",
	fontWeight: 700,
	fontFamily: "monospace",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const reqNewBtnStyle: CSSProperties = {
	margin: "0 12px 12px",
	padding: "10px",
	background: "#18181b",
	color: "#ffffff",
	border: "none",
	borderRadius: 0,
	fontSize: "11px",
	fontWeight: 700,
	fontFamily: "monospace",
	letterSpacing: "0.06em",
	cursor: "pointer",
};

const reqFormStyle: CSSProperties = {
	flex: 1,
	overflowY: "auto",
	padding: "12px",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
};

const reqInputStyle: CSSProperties = {
	background: "#f4f4f5",
	border: "1px solid #e4e4e7",
	borderRadius: 0,
	color: "#18181b",
	padding: "10px 12px",
	fontSize: "13px",
	fontFamily: "system-ui, -apple-system, sans-serif",
	outline: "none",
};

const reqTextareaStyle: CSSProperties = {
	...reqInputStyle,
	resize: "vertical",
	minHeight: "80px",
};

const reqCatOnStyle: CSSProperties = {
	background: "#18181b",
	color: "#ffffff",
	borderColor: "#18181b",
};

const reqAttachBtnStyle: CSSProperties = {
	alignSelf: "flex-start",
	background: "none",
	border: "1px dashed #d4d4d8",
	borderRadius: 0,
	color: "#52525b",
	fontSize: "10px",
	fontFamily: "monospace",
	letterSpacing: "0.04em",
	cursor: "pointer",
	padding: "5px 10px",
};

const reqAiHintStyle: CSSProperties = {
	background: "none",
	border: "none",
	color: "#71717a",
	fontSize: "10px",
	fontFamily: "monospace",
	letterSpacing: "0.04em",
	cursor: "pointer",
	textAlign: "center",
	padding: "4px",
	textDecoration: "underline",
};

const csatBtnStyle: CSSProperties = {
	background: "#ffffff",
	border: "1px solid #d4d4d8",
	borderRadius: 0,
	padding: "2px 8px",
	cursor: "pointer",
	fontSize: "12px",
	lineHeight: 1.4,
};

const seenStyle: CSSProperties = {
	fontSize: "9px",
	fontFamily: "monospace",
	letterSpacing: "0.04em",
	color: "#a1a1aa",
	textAlign: "right",
	padding: "2px 14px 6px",
};
