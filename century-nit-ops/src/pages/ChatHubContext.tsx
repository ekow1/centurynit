import { createContext, useContext, type ReactNode } from "react";

/**
 * Lets any component in the ops console open a chat session — either a
 * direct message with a specific staff member, or an existing conversation
 * by its ID — without importing or controlling the CommunicationHub directly.
 *
 * CommunicationHub registers its implementations via `registerOpenDM()` and
 * `registerOpenConversation()` on mount; everyone else calls the hooks.
 */

type OpenDMFn = (opsUserId: string) => Promise<void>;
type OpenConversationFn = (conversationId: string) => Promise<void>;

const ChatHubContext = createContext<{
	openDM: OpenDMFn;
	openConversation: OpenConversationFn;
} | null>(null);

/** Mutable holders — CommunicationHub writes its implementations here on mount. */
const dmSlot: { current: OpenDMFn | null } = { current: null };
const convSlot: { current: OpenConversationFn | null } = { current: null };

export function registerOpenDM(fn: OpenDMFn) {
	dmSlot.current = fn;
}

export function registerOpenConversation(fn: OpenConversationFn) {
	convSlot.current = fn;
}

export function ChatHubProvider({ children }: { children: ReactNode }) {
	const openDM: OpenDMFn = async (opsUserId) => {
		if (dmSlot.current) await dmSlot.current(opsUserId);
	};
	const openConversation: OpenConversationFn = async (conversationId) => {
		if (convSlot.current) await convSlot.current(conversationId);
	};
	return (
		<ChatHubContext.Provider value={{ openDM, openConversation }}>
			{children}
		</ChatHubContext.Provider>
	);
}

export function useChatHub() {
	const ctx = useContext(ChatHubContext);
	if (!ctx) return { openDM: async () => {}, openConversation: async () => {} };
	return ctx;
}
