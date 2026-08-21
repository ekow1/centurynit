import { useChatHub } from "./ChatHubContext";

/**
 * Shows the assigned staff member's name with a chat icon button.
 * Clicking the icon opens a direct-message conversation with that
 * staff member in the CommunicationHub.
 *
 * Renders nothing if there's no staff ID — unassigned rows don't get one.
 */
export function StaffChatBadge({
	opsUserId,
	name,
	email,
}: {
	opsUserId: string | null | undefined;
	name: string;
	email?: string | null;
}) {
	const { openDM } = useChatHub();

	if (!opsUserId || !name) {
		return <span className="staff-chat-badge staff-chat-badge--none">Unassigned</span>;
	}

	return (
		<span className="staff-chat-badge">
			<span className="staff-chat-badge__name" title={email ?? undefined}>{name}</span>
			<button
				type="button"
				className="staff-chat-badge__btn"
				title={`Message ${name}`}
				aria-label={`Message ${name}`}
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void openDM(opsUserId);
				}}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
				</svg>
			</button>
		</span>
	);
}
