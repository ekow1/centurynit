import { createContext, useContext, type ReactNode } from "react";
import { useCasesApi } from "./useCasesApi";

/**
 * Shared cases store.
 *
 * `useCasesApi` polls `/staff`, `/applications`, `/consultations`, and
 * `/applicants` every 30s. Before this provider, every page that needed case
 * data (`EnterpriseDashboard`, `EnterpriseCases`, `EnterpriseConsultations`,
 * `EnterpriseApplicants`, `EnterpriseVisa`, `EnterpriseTravel`,
 * `EnterpriseWorkflow`, `EnterpriseFinance`, `EnterpriseReports`,
 * `EnterpriseInbox`, `EnterpriseInvoices`, `EnterpriseLedger`,
 * `EnterprisePaymentsLog`, `OpsCommandPalette`, and the scholarship modals)
 * mounted its own `useCasesApi` instance. Navigating between them tore down
 * one 30s interval and started another, firing a fresh `Promise.all` burst on
 * every route change — a polling storm of 4 requests every few seconds.
 *
 * Mounting this provider once in `EnterpriseLayout` means a single 30s poll
 * feeds every page. The underlying `useCasesApi` is unchanged — it still
 * owns the state, the interval, and all the mutation helpers — so the
 * consumer API (`const { applications } = useCases()`) is identical.
 */
type CasesValue = ReturnType<typeof useCasesApi>;

const CasesContext = createContext<CasesValue | null>(null);

export function CasesProvider({ children }: { children: ReactNode }) {
	const value = useCasesApi();
	return <CasesContext.Provider value={value}>{children}</CasesContext.Provider>;
}

export function useCases(): CasesValue {
	const ctx = useContext(CasesContext);
	if (!ctx) throw new Error("useCases must be used within CasesProvider");
	return ctx;
}
