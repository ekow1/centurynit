import { useCallback, useContext, createContext, useState, type ReactNode } from "react";

type PreviewDoc = {
	name: string;
	category?: string;
	status?: string;
	docKey?: string;
	documentId?: string;
};

type ActivityEntry = {
	id: string;
	at: string;
	actor: string;
	action: string;
	detail: string;
};

export type RecentRecord = {
	path: string;
	title: string;
	subtitle: string;
	type: string;
};

interface OpsStateContextValue {
	isCommandOpen: boolean;
	openCommandPalette: () => void;
	closeCommandPalette: () => void;
	previewDoc: PreviewDoc | null;
	openDocPreview: (doc: PreviewDoc) => void;
	closeDocPreview: () => void;
	resetOpsState: () => void;
	activityLog: ActivityEntry[];
	logActivity: (actor: string, action: string, detail: string) => void;
	recentRecords: RecentRecord[];
	pushRecentRecord: (rec: RecentRecord) => void;
}

const OpsStateContext = createContext<OpsStateContextValue | null>(null);

export function OpsStateProvider({ children }: { children: ReactNode }) {
	const [isCommandOpen, setIsCommandOpen] = useState(false);
	const [previewDoc, setPreviewDoc] = useState<PreviewDoc | null>(null);
	const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
	const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);

	const openCommandPalette = useCallback(() => setIsCommandOpen(true), []);
	const closeCommandPalette = useCallback(() => setIsCommandOpen(false), []);
	const openDocPreview = useCallback((doc: PreviewDoc) => setPreviewDoc(doc), []);
	const closeDocPreview = useCallback(() => setPreviewDoc(null), []);

	const pushRecentRecord = useCallback((rec: RecentRecord) => {
		setRecentRecords((prev) => {
			const deduped = prev.filter((r) => r.path !== rec.path);
			return [rec, ...deduped].slice(0, 6);
		});
	}, []);

	const logActivity = useCallback((actor: string, action: string, detail: string) => {
		setActivityLog((prev) =>
			[
				{
					id: `log-${Date.now()}`,
					at: new Date().toISOString(),
					actor,
					action,
					detail,
				},
				...prev,
			].slice(0, 40),
		);
	}, []);

	const resetOpsState = useCallback(() => {
		setActivityLog([]);
		setPreviewDoc(null);
		setIsCommandOpen(false);
		setRecentRecords([]);
	}, []);

	const value: OpsStateContextValue = {
		isCommandOpen,
		openCommandPalette,
		closeCommandPalette,
		previewDoc,
		openDocPreview,
		closeDocPreview,
		resetOpsState,
		activityLog,
		logActivity,
		recentRecords,
		pushRecentRecord,
	};

	return <OpsStateContext.Provider value={value}>{children}</OpsStateContext.Provider>;
}

export function useOpsState() {
	const ctx = useContext(OpsStateContext);
	if (!ctx) throw new Error("useOpsState must be used within OpsStateProvider");
	return ctx;
}
