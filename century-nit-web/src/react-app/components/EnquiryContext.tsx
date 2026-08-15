import {
	createContext,
	useContext,
	useState,
	type CSSProperties,
	type ReactNode,
	type Dispatch,
	type SetStateAction,
} from "react";

export type EnquiryTab = "ai" | "whatsapp" | "email";

type EnquiryContextValue = {
	open: boolean;
	setOpen: Dispatch<SetStateAction<boolean>>;
	tab: EnquiryTab;
	setTab: Dispatch<SetStateAction<EnquiryTab>>;
	openEnquiry: (tab?: EnquiryTab) => void;
};

const EnquiryContext = createContext<EnquiryContextValue | null>(null);

export function EnquiryProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<EnquiryTab>("ai");

	function openEnquiry(t?: EnquiryTab) {
		if (t) setTab(t);
		setOpen(true);
	}

	return (
		<EnquiryContext.Provider value={{ open, setOpen, tab, setTab, openEnquiry }}>
			{children}
		</EnquiryContext.Provider>
	);
}

export function useEnquiry() {
	const ctx = useContext(EnquiryContext);
	if (!ctx) throw new Error("useEnquiry must be used within EnquiryProvider");
	return ctx;
}

type EnquiryButtonProps = {
	children: ReactNode;
	variant?: "primary" | "secondary" | "ghost" | "inverted";
	size?: "md" | "sm";
	block?: boolean;
	arrow?: boolean;
	tab?: EnquiryTab;
	style?: CSSProperties;
	className?: string;
};

export function EnquiryButton({
	children,
	variant = "secondary",
	size = "md",
	block,
	arrow,
	tab,
	style,
	className = "",
}: EnquiryButtonProps) {
	const { openEnquiry } = useEnquiry();

	const cls = [
		"btn",
		`btn--${variant}`,
		size === "sm" ? "btn--sm" : "",
		block ? "btn--block" : "",
		className,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<button
			type="button"
			className={cls}
			onClick={() => openEnquiry(tab)}
			style={style}
		>
			{children}
			{arrow ? <span aria-hidden>→</span> : null}
		</button>
	);
}
