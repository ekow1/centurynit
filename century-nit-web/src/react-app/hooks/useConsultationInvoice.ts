import { useEffect, useState } from "react";
import { meApi } from "century-nit-core/api";
import type { ApiInvoice } from "century-nit-shared";
import { useAppState } from "../context/AppState";

/** The paid consultation invoice, or null while loading / when none is on file. */
export function useConsultationInvoice(): { invoice: ApiInvoice | null; loaded: boolean } {
	const { syncTick } = useAppState();
	const [invoice, setInvoice] = useState<ApiInvoice | null>(null);
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		let cancelled = false;
		meApi.invoices({ type: "consultation" })
			.then((res) => {
				if (cancelled) return;
				const live = res.invoices.filter((i) => i.status !== "void").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
				setInvoice(live[0] ?? null);
			})
			.catch(() => { if (!cancelled) setInvoice(null); })
			.finally(() => { if (!cancelled) setLoaded(true); });
		return () => { cancelled = true; };
	}, [syncTick]);
	return { invoice, loaded };
}
