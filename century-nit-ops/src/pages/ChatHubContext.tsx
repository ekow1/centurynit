import { createContext, useContext, type ReactNode } from "react";

/**
 * Lets any component in the ops console open a direct-message chat with a
 * specific staff member by their opsUserId — without importing or
 * controlling the CommunicationHub directly.
 *
 * CommunicationHub registers its `startDM` implementation via
 * `registerOpenDM()` on mount; everyone else calls `useChatHub().openDM(opsUserId)`.
 */

type OpenDMFn = (opsUserId: string) => Promise<void>;

const ChatHubContext = createContext<{ openDM: OpenDMFn } | null>(null);

/** Mutable holder — CommunicationHub writes its implementation here on mount. */
const slot: { current: OpenDMFn | null } = { current: null };

export function registerOpenDM(fn: OpenDMFn) {
	slot.current = fn;
}

export function ChatHubProvider({ children }: { children: ReactNode }) {
	const openDM: OpenDMFn = async (opsUserId) => {
		if (slot.current) await slot.current(opsUserId);
	};
	return <ChatHubContext.Provider value={{ openDM }}>{children}</ChatHubContext.Provider>;
}

export function useChatHub() {
	const ctx = useContext(ChatHubContext);
	if (!ctx) return { openDM: async () => {} };
	return ctx;
}
